"""Session lifecycle routes."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import require_api_key
from app.schemas import GenerationResult, SessionCreated, SessionView
from app.services import blob, cosmos

router = APIRouter(prefix="/sessions", tags=["sessions"], dependencies=[Depends(require_api_key)])


@router.post("", response_model=SessionCreated, status_code=status.HTTP_201_CREATED)
def create_session() -> SessionCreated:
    session_id = uuid.uuid4().hex
    doc = cosmos.create_session(session_id)
    return SessionCreated(sessionId=session_id, createdAt=datetime.fromisoformat(doc["createdAt"]))


@router.get("/{session_id}", response_model=SessionView)
def get_session(session_id: str) -> SessionView:
    doc = cosmos.get_session(session_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "session_not_found", "message": f"Session {session_id} not found."},
        )
    return _to_session_view(doc)


def _to_session_view(doc: dict[str, Any]) -> SessionView:
    """Project the Cosmos document into the public session view, refreshing SAS URLs."""
    input_blob = (doc.get("input") or {}).get("blob")
    input_url = blob.sas_url(input_blob) if input_blob else None

    generations = [
        GenerationResult(
            id=g.get("id", g.get("mode", "")),  # legacy docs fell back to mode-keyed ids
            mode=g["mode"],
            label=g.get("label", g["mode"]),
            imageUrl=blob.sas_url(g["blob"]),
            promptHeader=g.get("promptHeader", ""),
            usedPrompt=g.get("usedPrompt", ""),
            createdAt=datetime.fromisoformat(g["createdAt"]),
        )
        for g in doc.get("generations") or []
    ]

    analysis = doc.get("analysis") or {}
    return SessionView(
        sessionId=doc["sessionId"],
        createdAt=datetime.fromisoformat(doc["createdAt"]),
        updatedAt=datetime.fromisoformat(doc["updatedAt"]),
        inputImageUrl=input_url,
        promptMd=analysis.get("promptMd"),
        generations=generations,
    )
