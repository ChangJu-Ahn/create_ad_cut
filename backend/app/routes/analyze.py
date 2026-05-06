"""Image upload + multimodal analysis route."""

from __future__ import annotations

import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.auth import require_api_key
from app.config import get_settings
from app.schemas import AnalyzeOut
from app.services import aoai_analyze, blob, cosmos

router = APIRouter(prefix="/sessions", tags=["analyze"], dependencies=[Depends(require_api_key)])

ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_INPUT_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("/{session_id}/analyze", response_model=AnalyzeOut)
async def analyze(
    session_id: str,
    image: UploadFile = File(..., description="Input product photo (PNG/JPEG/WEBP, ≤10MB)."),
    detail_note: str | None = Form(default=None),
) -> AnalyzeOut:
    settings = get_settings()
    doc = cosmos.get_session(session_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "session_not_found", "message": f"Session {session_id} not found."},
        )
    if image.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail={
                "code": "unsupported_media_type",
                "message": f"Allowed types: {sorted(ALLOWED_CONTENT_TYPES)}",
            },
        )

    body = await image.read()
    if len(body) > MAX_INPUT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={"code": "image_too_large", "message": "Image must be 10 MB or smaller."},
        )

    blob.ensure_container()
    suffix = (image.filename or "input.png").rsplit(".", 1)[-1].lower()
    blob_name = f"sessions/{session_id}/input.{suffix}"
    blob.upload_bytes(blob_name, body, image.content_type)

    # Analysis call is blocking I/O; offload so we don't tie up the event loop.
    prompt_md = await asyncio.to_thread(aoai_analyze.analyze_image, body, detail_note)

    doc["input"] = {"blob": blob_name, "contentType": image.content_type}
    doc["analysis"] = {
        "promptMd": prompt_md,
        "model": settings.azure_openai_analysis_deployment,
        "analyzedAt": cosmos.now_iso(),
    }
    cosmos.upsert_session(doc)

    return AnalyzeOut(
        sessionId=session_id,
        inputImageUrl=blob.sas_url(blob_name),
        promptMd=prompt_md,
        model=settings.azure_openai_analysis_deployment,
        analyzedAt=datetime.fromisoformat(doc["analysis"]["analyzedAt"]),
    )
