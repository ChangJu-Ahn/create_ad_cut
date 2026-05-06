"""Human-reviewed prompt update route."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import require_api_key
from app.schemas import PromptUpdateIn, PromptUpdateOut
from app.services import cosmos

router = APIRouter(prefix="/sessions", tags=["prompt"], dependencies=[Depends(require_api_key)])


@router.patch("/{session_id}/prompt", response_model=PromptUpdateOut)
def update_prompt(session_id: str, body: PromptUpdateIn) -> PromptUpdateOut:
    doc = cosmos.get_session(session_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "session_not_found", "message": f"Session {session_id} not found."},
        )
    if doc.get("analysis") is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "analysis_missing",
                "message": "Run analyze before updating the prompt.",
            },
        )

    doc["analysis"]["promptMd"] = body.promptMd
    doc["analysis"]["reviewedAt"] = cosmos.now_iso()
    cosmos.upsert_session(doc)

    return PromptUpdateOut(
        sessionId=session_id,
        promptMd=body.promptMd,
        updatedAt=datetime.fromisoformat(doc["updatedAt"]),
    )
