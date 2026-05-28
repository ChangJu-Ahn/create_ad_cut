"""Gallery routes — browse past generation sessions.

The gallery surfaces every session created across the app so sellers can
revisit prior runs. It reuses the existing session document shape: a
session card pulls `input.blob`, `analysis.promptMd` and up to four
`generations[]` items, all of which may be missing for sessions that
never made it past upload. Every field access is therefore defensive so
half-finished sessions never surface as a 500.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status

from app.routes.sessions import _to_session_view
from app.schemas import (
    GalleryListOut,
    GallerySessionSummary,
    GalleryThumbnail,
    SessionView,
)
from app.services import blob, cosmos

router = APIRouter(prefix="/gallery", tags=["gallery"])

THUMBNAIL_LIMIT = 4


@router.get("", response_model=GalleryListOut)
def list_gallery(
    limit: int = Query(12, ge=1, le=50, description="Max sessions to return per page."),
    offset: int = Query(0, ge=0, description="0-based offset into the latest-first order."),
) -> GalleryListOut:
    # Over-fetch by one to detect whether another page exists without a
    # separate COUNT query.
    docs = cosmos.list_sessions(limit=limit + 1, offset=offset)
    has_more = len(docs) > limit
    page = docs[:limit]
    return GalleryListOut(
        items=[_to_summary(d) for d in page],
        limit=limit,
        offset=offset,
        hasMore=has_more,
    )


@router.get("/{session_id}", response_model=SessionView)
def get_gallery_detail(session_id: str) -> SessionView:
    doc = cosmos.get_session(session_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "session_not_found", "message": f"Session {session_id} not found."},
        )
    return _to_session_view(doc)


def _to_summary(doc: dict[str, Any]) -> GallerySessionSummary:
    """Project a Cosmos session document into the gallery card payload.

    Every nested field is optional in older sessions — never raise here.
    """
    input_blob = (doc.get("input") or {}).get("blob")
    input_url = blob.sas_url(input_blob) if input_blob else None

    analysis = doc.get("analysis") or {}
    prompt_summary = analysis.get("promptMd") or None

    generations = list(doc.get("generations") or [])
    # Show the most recent first; cap at THUMBNAIL_LIMIT.
    generations_sorted = sorted(
        generations,
        key=lambda g: g.get("createdAt", ""),
        reverse=True,
    )[:THUMBNAIL_LIMIT]
    thumbnails: list[GalleryThumbnail] = []
    for g in generations_sorted:
        blob_name = g.get("blob")
        if not blob_name:
            continue
        thumbnails.append(
            GalleryThumbnail(
                id=g.get("id") or g.get("mode") or "",
                mode=g.get("mode") or "custom",
                label=g.get("label") or g.get("mode") or "",
                imageUrl=blob.sas_url(blob_name),
            )
        )

    return GallerySessionSummary(
        sessionId=doc["sessionId"],
        createdAt=_parse_dt(doc.get("createdAt")),
        updatedAt=_parse_dt(doc.get("updatedAt") or doc.get("createdAt")),
        inputImageUrl=input_url,
        promptSummary=prompt_summary,
        generationCount=len(generations),
        thumbnails=thumbnails,
    )


def _parse_dt(value: str | None) -> datetime:
    """Best-effort ISO parse; fall back to epoch so missing values never 500."""
    if not value:
        return datetime.fromtimestamp(0)
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return datetime.fromtimestamp(0)
