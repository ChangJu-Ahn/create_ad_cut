"""Gallery routes: browse past sessions with their inputs and generations.

Each card surfaces the original image, a truncated analysis prompt, and up to
four most-recent generated thumbnails so a seller can quickly recognise the
session and jump into its detail view. The endpoints are tolerant of legacy
documents that may be missing `input`, `analysis`, or `generations` fields —
the goal is to never 500 just because a historical session is incomplete.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status

from app.schemas import (
    GalleryCard,
    GalleryList,
    GalleryThumbnail,
    SessionView,
)
from app.services import blob, cosmos

from .sessions import _to_session_view

router = APIRouter(prefix="/gallery", tags=["gallery"])

# Cap the per-card prompt preview at a length that comfortably fits two lines
# in the card UI without overwhelming the layout. The frontend still ellipses
# visually via CSS, but trimming on the server keeps payloads small.
PROMPT_SUMMARY_LEN = 140

# Maximum number of generation thumbnails per card. Matches the four built-in
# shot modes (lookbook/front/side/back) that the UX surfaces by default.
THUMBNAIL_LIMIT = 4


def _safe_iso(value: Any, fallback: str = "1970-01-01T00:00:00+00:00") -> datetime:
    """Best-effort ISO parse — legacy docs occasionally have missing timestamps."""
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            pass
    return datetime.fromisoformat(fallback)


def _summarise_prompt(prompt_md: str | None) -> str:
    if not prompt_md:
        return ""
    # Collapse whitespace to keep the preview a single line.
    flat = " ".join(prompt_md.split())
    if len(flat) <= PROMPT_SUMMARY_LEN:
        return flat
    return flat[: PROMPT_SUMMARY_LEN - 1].rstrip() + "…"


def _to_gallery_card(doc: dict[str, Any]) -> GalleryCard:
    session_id = doc.get("sessionId") or doc.get("id") or ""

    input_blob = (doc.get("input") or {}).get("blob")
    input_url = blob.sas_url(input_blob) if input_blob else None

    analysis = doc.get("analysis") or {}
    prompt_md = analysis.get("promptMd")

    # Newest-first thumbnails. Generations are appended in creation order, so
    # reversing gives us the most recent renders without an extra sort.
    raw_gens = list(doc.get("generations") or [])
    thumbs: list[GalleryThumbnail] = []
    for g in reversed(raw_gens):
        blob_name = g.get("blob")
        if not blob_name:
            continue
        mode = g.get("mode") or "custom"
        thumbs.append(
            GalleryThumbnail(
                id=g.get("id") or mode,
                mode=mode,
                label=g.get("label") or mode,
                imageUrl=blob.sas_url(blob_name),
            )
        )
        if len(thumbs) >= THUMBNAIL_LIMIT:
            break

    created = _safe_iso(doc.get("createdAt"))
    updated = _safe_iso(doc.get("updatedAt"), fallback=doc.get("createdAt") or "1970-01-01T00:00:00+00:00")

    return GalleryCard(
        sessionId=session_id,
        createdAt=created,
        updatedAt=updated,
        inputImageUrl=input_url,
        promptSummary=_summarise_prompt(prompt_md),
        promptMd=prompt_md,
        thumbnails=thumbs,
        generationCount=len(raw_gens),
    )


@router.get("", response_model=GalleryList)
def list_gallery(
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
) -> GalleryList:
    """Latest-first list of past sessions with card-ready projections."""
    docs, total = cosmos.list_sessions(limit=limit, offset=offset)
    items = [_to_gallery_card(d) for d in docs]
    return GalleryList(items=items, total=total, limit=limit, offset=offset)


@router.get("/{session_id}", response_model=SessionView)
def get_gallery_item(session_id: str) -> SessionView:
    """Detail view for a single gallery entry (reuses the session projection)."""
    doc = cosmos.get_session(session_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "session_not_found", "message": f"Session {session_id} not found."},
        )
    return _to_session_view(doc)
