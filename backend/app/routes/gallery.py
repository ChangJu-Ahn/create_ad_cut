"""Gallery routes.

Exposes a read-only projection of existing session documents for the
"생성 이력" screen. The endpoints are deliberately tolerant of legacy or
partial documents: missing `input`, `analysis`, or `generations` fields
must not produce 500s — they are surfaced as empty placeholders so the
client can render a friendly empty state instead.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status

from app.routes.sessions import _to_session_view
from app.schemas import GalleryCard, GalleryList, GalleryThumb, SessionView
from app.services import blob, cosmos

router = APIRouter(prefix="/gallery", tags=["gallery"])


# Up to 4 newest thumbnails per card, mirroring the issue's UX spec.
MAX_THUMBS = 4
# Single-line ellipsis-friendly prompt summary length cap.
PROMPT_SUMMARY_MAX = 200


def _parse_dt(value: Any, fallback: datetime | None = None) -> datetime:
    """Best-effort ISO datetime parse — never raise for malformed inputs."""
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            pass
    return fallback or datetime.fromtimestamp(0)


def _summarize_prompt(prompt_md: str | None) -> str:
    if not prompt_md:
        return ""
    # Collapse whitespace and strip markdown bullets/headers so the card
    # shows a clean one-liner that the client truncates with CSS.
    flat = " ".join(prompt_md.split())
    if len(flat) > PROMPT_SUMMARY_MAX:
        flat = flat[: PROMPT_SUMMARY_MAX - 1].rstrip() + "…"
    return flat


def _to_gallery_card(doc: dict[str, Any]) -> GalleryCard:
    session_id = doc.get("sessionId") or doc.get("id") or ""
    created_at = _parse_dt(doc.get("createdAt"))
    updated_at = _parse_dt(doc.get("updatedAt"), fallback=created_at)

    input_blob = (doc.get("input") or {}).get("blob")
    input_url = blob.sas_url(input_blob) if input_blob else None

    analysis = doc.get("analysis") or {}
    prompt_summary = _summarize_prompt(analysis.get("promptMd"))

    generations = list(doc.get("generations") or [])
    # Newest first; tolerate missing createdAt.
    generations.sort(key=lambda g: g.get("createdAt") or "", reverse=True)

    thumbs: list[GalleryThumb] = []
    for g in generations[:MAX_THUMBS]:
        gen_blob = g.get("blob")
        if not gen_blob:
            continue
        thumbs.append(
            GalleryThumb(
                id=g.get("id") or g.get("mode") or "",
                mode=g.get("mode", "") or "",
                label=g.get("label") or g.get("mode", "") or "",
                imageUrl=blob.sas_url(gen_blob),
            )
        )

    return GalleryCard(
        sessionId=session_id,
        createdAt=created_at,
        updatedAt=updated_at,
        inputImageUrl=input_url,
        promptSummary=prompt_summary,
        generationCount=len(generations),
        thumbnails=thumbs,
    )


@router.get("", response_model=GalleryList)
def list_gallery(
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
) -> GalleryList:
    """Paginated, newest-first list of session cards."""
    docs, total = cosmos.list_sessions(limit=limit, offset=offset)
    cards: list[GalleryCard] = []
    for doc in docs:
        try:
            cards.append(_to_gallery_card(doc))
        except Exception:
            # A single malformed document must not take down the whole page.
            continue
    return GalleryList(items=cards, total=int(total), limit=limit, offset=offset)


@router.get("/{session_id}", response_model=SessionView)
def get_gallery_detail(session_id: str) -> SessionView:
    """Detail view — reuses the session projection so URLs are fresh SAS."""
    doc = cosmos.get_session(session_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "session_not_found", "message": f"Session {session_id} not found."},
        )
    return _to_session_view(doc)
