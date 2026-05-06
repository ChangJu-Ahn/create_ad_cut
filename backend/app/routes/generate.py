"""Async multi-shot image generation route.

`gpt-image-2` calls can take 1~5 minutes per shot. The total wall time for a
batch (lookbook + 3 studio cuts + 1~4 customs) easily exceeds proxy timeouts
(SWA Linked Backend caps around ~4 minutes). To stay reliable behind any
gateway we run jobs **asynchronously**:

  1. `POST /sessions/{id}/generate` validates input, persists a `job` entry
     into the session document with `status="running"` and one item per
     requested shot, then **returns 202 immediately** with the job id and the
     initial item list. A background `asyncio` task starts the actual work.
  2. The background task runs all shots **in parallel** (`asyncio.gather`) and
     atomically appends each finished image to `session.generations` while
     marking the corresponding job item `status="done"` (or `"failed"`).
  3. `GET /sessions/{id}/generate/jobs/{jobId}` returns the current job
     state. Clients poll this until `status` is no longer `"running"`.

Per-session asyncio locks serialise concurrent Cosmos read-modify-write so
parallel shot completions do not trample each other's updates within a
single ACA replica.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
from collections import defaultdict
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import require_api_key
from app.config import get_settings
from app.prompts.style_headers import MODE_META, STYLE_HEADERS
from app.schemas import (
    GenerateIn,
    GenerateItem,
    GenerateJobItem,
    GenerateJobOut,
)
from app.services import aoai_image, blob, cosmos

router = APIRouter(prefix="/sessions", tags=["generate"], dependencies=[Depends(require_api_key)])

_log = logging.getLogger(__name__)

# Per-session asyncio locks. Two `_render_one_for_job` coroutines for the same
# session must not interleave their read-modify-write of the Cosmos document.
_session_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

# Cap how many jobs we keep embedded in the session document so it never
# approaches Cosmos's 2 MB item limit even after many regenerations.
_MAX_JOBS_PER_SESSION = 20


def _download_blob(blob_name: str) -> bytes:
    settings = get_settings()
    client = blob._service_client().get_blob_client(  # noqa: SLF001 — internal helper reuse
        container=settings.blob_container_name, blob=blob_name
    )
    return client.download_blob().readall()


def _resolve_item(item: GenerateItem) -> tuple[str, str, str, bool, bool]:
    """Resolve user input into (generation_id, label, promptHeader, useReference, sceneCompose).

    Validates `custom` mode requirements; raises 400 on missing label/header.
    A fresh `generation_id` is minted on every call.
    """
    gen_id = secrets.token_hex(6)

    if item.mode == "custom":
        if not (item.promptHeader and item.promptHeader.strip()):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "custom_prompt_required", "message": "Custom 모드는 promptHeader가 필요합니다."},
            )
        if not (item.label and item.label.strip()):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "custom_label_required", "message": "Custom 모드는 label이 필요합니다."},
            )
        use_reference = True if item.useReference is None else item.useReference
        scene_compose = False if item.sceneCompose is None else item.sceneCompose
        return gen_id, item.label.strip(), item.promptHeader.strip(), use_reference, scene_compose

    meta = MODE_META[item.mode]  # type: ignore[index]
    label = (item.label or str(meta["label"])).strip()
    header = (item.promptHeader or STYLE_HEADERS[item.mode]).strip()  # type: ignore[index]
    use_reference = bool(meta["useReference"]) if item.useReference is None else item.useReference
    scene_compose = bool(meta["sceneCompose"]) if item.sceneCompose is None else item.sceneCompose
    return gen_id, label, header, use_reference, scene_compose


def _resolve_label(item: GenerateItem) -> str:
    """Display label only — used when seeding the job record."""
    if item.mode == "custom":
        return (item.label or "").strip()
    meta = MODE_META[item.mode]  # type: ignore[index]
    return (item.label or str(meta["label"])).strip()


def _patch_job_item(doc: dict[str, Any], job_id: str, temp_id: str, **patch: Any) -> None:
    """In-place: update one item of one job and recompute the job's roll-up status."""
    for job in doc.get("jobs", []):
        if job.get("jobId") != job_id:
            continue
        for it in job.get("items", []):
            if it.get("tempId") == temp_id:
                it.update(patch)
        statuses = [it["status"] for it in job["items"]]
        if all(s == "done" for s in statuses):
            job["status"] = "done"
        elif all(s == "failed" for s in statuses):
            job["status"] = "failed"
        elif all(s in ("done", "failed") for s in statuses):
            job["status"] = "partial"
        else:
            job["status"] = "running"
        job["updatedAt"] = cosmos.now_iso()
        return


def _job_to_out(session_id: str, job: dict[str, Any]) -> GenerateJobOut:
    return GenerateJobOut(
        sessionId=session_id,
        jobId=job["jobId"],
        status=job["status"],
        items=[GenerateJobItem(**i) for i in job["items"]],
        createdAt=datetime.fromisoformat(job["createdAt"]),
        updatedAt=datetime.fromisoformat(job["updatedAt"]),
    )


async def _render_one_for_job(
    session_id: str,
    job_id: str,
    temp_id: str,
    item: GenerateItem,
    prompt_md: str,
    reference_bytes: bytes,
    reference_content_type: str,
) -> None:
    """Render one shot end-to-end, then atomically persist the result + job state."""
    lock = _session_locks[session_id]

    try:
        async with lock:
            doc = cosmos.get_session(session_id) or {}
            _patch_job_item(doc, job_id, temp_id, status="running")
            cosmos.upsert_session(doc)

        gen_id, label, header, use_reference, scene_compose = _resolve_item(item)
        effective_prompt_md = prompt_md if item.includeAnalysisPrompt else ""

        image_bytes = await asyncio.to_thread(
            aoai_image.render_image,
            effective_prompt_md,
            reference_bytes,
            header,
            use_reference,
            scene_compose,
            "input.png",
            reference_content_type,
        )
        blob_name = f"sessions/{session_id}/gen_{gen_id}.png"
        await asyncio.to_thread(blob.upload_bytes, blob_name, image_bytes, "image/png")

        used_prompt = aoai_image.build_prompt(header, effective_prompt_md, use_reference, scene_compose)
        created_at = cosmos.now_iso()
        persisted = {
            "id": gen_id,
            "mode": item.mode,
            "label": label,
            "blob": blob_name,
            "promptHeader": header,
            "usedPrompt": used_prompt,
            "createdAt": created_at,
        }

        async with lock:
            doc = cosmos.get_session(session_id) or {}
            doc.setdefault("generations", []).append(persisted)
            _patch_job_item(doc, job_id, temp_id, status="done", generationId=gen_id)
            cosmos.upsert_session(doc)

    except Exception as exc:  # noqa: BLE001 — we want every failure recorded
        _log.exception("generate job %s item %s failed", job_id, temp_id)
        async with lock:
            doc = cosmos.get_session(session_id) or {}
            _patch_job_item(doc, job_id, temp_id, status="failed", error=str(exc)[:500])
            cosmos.upsert_session(doc)


@router.post("/{session_id}/generate", response_model=GenerateJobOut, status_code=status.HTTP_202_ACCEPTED)
async def generate(session_id: str, body: GenerateIn) -> GenerateJobOut:
    doc = cosmos.get_session(session_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "session_not_found", "message": f"Session {session_id} not found."},
        )

    analysis = doc.get("analysis") or {}
    prompt_md: str | None = analysis.get("promptMd")
    input_meta = doc.get("input") or {}
    blob_name: str | None = input_meta.get("blob")
    content_type: str = input_meta.get("contentType", "image/png")

    if not prompt_md or not blob_name:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "prerequisites_missing",
                "message": "Run analyze (and optionally update prompt) before generate.",
            },
        )

    # Up-front validation — raises 400 immediately on bad custom items.
    items_with_temp: list[tuple[str, GenerateItem]] = []
    for it in body.items:
        _resolve_item(it)
        items_with_temp.append((secrets.token_hex(8), it))

    now = cosmos.now_iso()
    job_id = secrets.token_hex(8)
    job_record: dict[str, Any] = {
        "jobId": job_id,
        "status": "running",
        "createdAt": now,
        "updatedAt": now,
        "items": [
            {
                "tempId": tid,
                "mode": it.mode,
                "label": _resolve_label(it),
                "status": "pending",
                "generationId": None,
                "error": None,
            }
            for tid, it in items_with_temp
        ],
    }

    lock = _session_locks[session_id]
    async with lock:
        doc = cosmos.get_session(session_id) or {}
        jobs = doc.setdefault("jobs", [])
        jobs.append(job_record)
        if len(jobs) > _MAX_JOBS_PER_SESSION:
            del jobs[: len(jobs) - _MAX_JOBS_PER_SESSION]
        cosmos.upsert_session(doc)

    reference_bytes = await asyncio.to_thread(_download_blob, blob_name)

    async def _spawn() -> None:
        await asyncio.gather(
            *(
                _render_one_for_job(session_id, job_id, tid, it, prompt_md, reference_bytes, content_type)
                for tid, it in items_with_temp
            ),
            return_exceptions=True,
        )

    asyncio.create_task(_spawn())

    return _job_to_out(session_id, job_record)


@router.get("/{session_id}/generate/jobs/{job_id}", response_model=GenerateJobOut)
def get_job(session_id: str, job_id: str) -> GenerateJobOut:
    doc = cosmos.get_session(session_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "session_not_found", "message": f"Session {session_id} not found."},
        )
    for job in doc.get("jobs", []):
        if job.get("jobId") == job_id:
            return _job_to_out(session_id, job)
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"code": "job_not_found", "message": f"Job {job_id} not found in session {session_id}."},
    )
