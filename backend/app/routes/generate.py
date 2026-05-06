"""Multi-shot image generation route — runs all requested shots in parallel.

Each call appends to `session.generations`. Built-in modes use a default
style header that the caller may override; `custom` mode requires the caller
to supply both a `label` and a `promptHeader`. Sellers can therefore queue
4 fixed cuts + up to 4 freely-prompted variants in a single request, or
re-render an already-generated cut with a tweaked header to compare.
"""

from __future__ import annotations

import asyncio
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import require_api_key
from app.config import get_settings
from app.prompts.style_headers import MODE_META, STYLE_HEADERS
from app.schemas import GenerateIn, GenerateItem, GenerateOut, GenerationResult, ShotMode
from app.services import aoai_image, blob, cosmos

router = APIRouter(prefix="/sessions", tags=["generate"], dependencies=[Depends(require_api_key)])


def _download_blob(blob_name: str) -> bytes:
    settings = get_settings()
    client = blob._service_client().get_blob_client(  # noqa: SLF001 — internal helper reuse
        container=settings.blob_container_name, blob=blob_name
    )
    return client.download_blob().readall()


def _resolve_item(item: GenerateItem) -> tuple[str, str, str, bool, bool]:
    """Resolve user input into (generation_id, label, promptHeader, useReference, sceneCompose)."""
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
        # 커스텀은 기본적으로 원본 사진을 레퍼런스로 사용, 장면 합성은 기본 OFF.
        use_reference = True if item.useReference is None else item.useReference
        scene_compose = False if item.sceneCompose is None else item.sceneCompose
        return gen_id, item.label.strip(), item.promptHeader.strip(), use_reference, scene_compose

    meta = MODE_META[item.mode]  # type: ignore[index]
    label = (item.label or str(meta["label"])).strip()
    header = (item.promptHeader or STYLE_HEADERS[item.mode]).strip()  # type: ignore[index]
    use_reference = bool(meta["useReference"]) if item.useReference is None else item.useReference
    scene_compose = bool(meta["sceneCompose"]) if item.sceneCompose is None else item.sceneCompose
    return gen_id, label, header, use_reference, scene_compose


async def _render_one(
    session_id: str,
    item: GenerateItem,
    prompt_md: str,
    reference_bytes: bytes,
    reference_content_type: str,
) -> tuple[GenerationResult, dict]:
    gen_id, label, header, use_reference, scene_compose = _resolve_item(item)
    # `includeAnalysisPrompt=False`이면 사용자가 직접 작성/편집한 promptHeader만
    # 사용하고 분석 프롬프트는 결합하지 않는다. 디폴트는 True.
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
    blob.upload_bytes(blob_name, image_bytes, "image/png")

    used_prompt = aoai_image.build_prompt(header, effective_prompt_md, use_reference, scene_compose)
    created_at = cosmos.now_iso()
    result = GenerationResult(
        id=gen_id,
        mode=item.mode,
        label=label,
        imageUrl=blob.sas_url(blob_name),
        promptHeader=header,
        usedPrompt=used_prompt,
        createdAt=datetime.fromisoformat(created_at),
    )
    persisted = {
        "id": gen_id,
        "mode": item.mode,
        "label": label,
        "blob": blob_name,
        "promptHeader": header,
        "usedPrompt": used_prompt,
        "createdAt": created_at,
    }
    return result, persisted


@router.post("/{session_id}/generate", response_model=GenerateOut)
async def generate(session_id: str, body: GenerateIn) -> GenerateOut:
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

    reference_bytes = await asyncio.to_thread(_download_blob, blob_name)

    rendered = await asyncio.gather(
        *(_render_one(session_id, it, prompt_md, reference_bytes, content_type) for it in body.items)
    )

    # Append to persisted history — never replace prior generations so sellers
    # can compare across re-runs.
    existing = list(doc.get("generations") or [])
    for _, persisted in rendered:
        existing.append(persisted)
    doc["generations"] = existing
    cosmos.upsert_session(doc)

    return GenerateOut(sessionId=session_id, results=[r for r, _ in rendered])
