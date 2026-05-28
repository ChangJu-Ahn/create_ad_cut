"""Gallery (history) routes — read-only list/detail of past sessions."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status

from app.routes.sessions import _to_session_view
from app.schemas import (
    GalleryItem,
    GalleryListOut,
    GalleryThumbnail,
    SessionView,
)
from app.services import blob, cosmos

router = APIRouter(prefix="/gallery", tags=["gallery"])

# How many of the most recent generation thumbnails are shown on each card.
_THUMBNAIL_LIMIT = 4
# Maximum characters of the analysis prompt shown on the card preview.
_PROMPT_SUMMARY_CHARS = 160


@router.get("", response_model=GalleryListOut)
def list_gallery(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> GalleryListOut:
    """Return session cards ordered by ``createdAt`` desc with offset pagination.

    The endpoint is defensive: malformed or partial session documents are
    skipped instead of raising 500, so a single bad record never breaks the
    whole list.
    """
    # Fetch one extra so we can tell the client whether more results exist
    # without paying for a count query.
    docs = cosmos.list_sessions(limit=limit + 1, offset=offset)
    has_more = len(docs) > limit
    docs = docs[:limit]

    items: list[GalleryItem] = []
    for doc in docs:
        item = _to_gallery_item(doc)
        if item is not None:
            items.append(item)

    return GalleryListOut(items=items, limit=limit, offset=offset, hasMore=has_more)


@router.get("/{session_id}", response_model=SessionView)
def get_gallery_session(session_id: str) -> SessionView:
    """Detail view for a gallery card — reuses the canonical SessionView."""
    doc = cosmos.get_session(session_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "session_not_found", "message": f"Session {session_id} not found."},
        )
    return _to_session_view(doc)


# ---- helpers -------------------------------------------------------------


def _parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _summarize_prompt(prompt_md: str | None) -> str | None:
    if not prompt_md:
        return None
    # Collapse whitespace so the card preview is a single tidy line; the UI
    # handles the final ellipsis via CSS, but we cap server-side too to keep
    # response payloads small.
    flat = " ".join(prompt_md.split())
    if len(flat) <= _PROMPT_SUMMARY_CHARS:
        return flat
    return flat[:_PROMPT_SUMMARY_CHARS].rstrip() + "…"


def _to_gallery_item(doc: dict[str, Any]) -> GalleryItem | None:
    """Project a Cosmos session document into a gallery card.

    Returns ``None`` if the document is too malformed to be displayed (no id
    or no timestamps).
    """
    session_id = doc.get("sessionId") or doc.get("id")
    created_at = _parse_iso(doc.get("createdAt"))
    updated_at = _parse_iso(doc.get("updatedAt")) or created_at
    if not session_id or created_at is None:
        return None

    input_doc = doc.get("input") or {}
    input_blob = input_doc.get("blob") if isinstance(input_doc, dict) else None
    input_url: str | None = None
    if isinstance(input_blob, str) and input_blob:
        try:
            input_url = blob.sas_url(input_blob)
        except Exception:  # noqa: BLE001 — never fail the whole list on one bad blob.
            input_url = None

    analysis_doc = doc.get("analysis") or {}
    prompt_md = analysis_doc.get("promptMd") if isinstance(analysis_doc, dict) else None
    prompt_summary = _summarize_prompt(prompt_md)

    raw_generations = doc.get("generations") or []
    if not isinstance(raw_generations, list):
        raw_generations = []

    # Most recent first, limited to _THUMBNAIL_LIMIT.
    sorted_gens = sorted(
        (g for g in raw_generations if isinstance(g, dict)),
        key=lambda g: g.get("createdAt") or "",
        reverse=True,
    )
    thumbnails: list[GalleryThumbnail] = []
    for g in sorted_gens[:_THUMBNAIL_LIMIT]:
        gen_blob = g.get("blob")
        if not isinstance(gen_blob, str) or not gen_blob:
            continue
        try:
            image_url = blob.sas_url(gen_blob)
        except Exception:  # noqa: BLE001
            continue
        thumbnails.append(
            GalleryThumbnail(
                id=str(g.get("id") or g.get("mode") or ""),
                mode=str(g.get("mode") or "custom"),
                label=str(g.get("label") or g.get("mode") or ""),
                imageUrl=image_url,
            )
        )

    return GalleryItem(
        sessionId=str(session_id),
        createdAt=created_at,
        updatedAt=updated_at or created_at,
        inputImageUrl=input_url,
        promptSummary=prompt_summary,
        promptMd=prompt_md if isinstance(prompt_md, str) else None,
        thumbnails=thumbnails,
        generationCount=len([g for g in raw_generations if isinstance(g, dict)]),
    )
