"""Gallery (생성 이력) routes.

Read-only projection over the existing Cosmos session documents. We reuse
`session.input`, `session.analysis`, and `session.generations` and tolerate
missing fields so legacy/partial documents never trigger a 500.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query

from app.schemas import (
    GalleryListOut,
    GalleryPageMeta,
    GallerySessionSummary,
    GalleryThumbnail,
)
from app.services import blob, cosmos

router = APIRouter(prefix="/gallery", tags=["gallery"])

# Number of generated images shown on each gallery card.
_MAX_THUMBS = 4
# Hard ceiling so a misbehaving client can't ask for the whole container.
_MAX_PAGE_SIZE = 50
# Trimmed prompt summary length shown on the card (full text lives in detail view).
_PROMPT_SUMMARY_CHARS = 160


def _parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _summarize_prompt(prompt_md: Any) -> str | None:
    if not isinstance(prompt_md, str):
        return None
    # Collapse markdown headings / whitespace into a single readable line so the
    # card preview stays compact regardless of how the analysis was formatted.
    cleaned = " ".join(
        line.lstrip("# ").strip()
        for line in prompt_md.splitlines()
        if line.strip()
    ).strip()
    if not cleaned:
        return None
    if len(cleaned) <= _PROMPT_SUMMARY_CHARS:
        return cleaned
    return cleaned[: _PROMPT_SUMMARY_CHARS - 1].rstrip() + "…"


def _safe_thumbnails(generations: Any) -> list[GalleryThumbnail]:
    if not isinstance(generations, list):
        return []
    # Newest-first so the card grid shows the most recent results.
    ordered = sorted(
        (g for g in generations if isinstance(g, dict)),
        key=lambda g: g.get("createdAt", ""),
        reverse=True,
    )
    out: list[GalleryThumbnail] = []
    for g in ordered:
        blob_name = g.get("blob")
        mode = g.get("mode")
        if not blob_name or not mode:
            continue
        try:
            image_url = blob.sas_url(blob_name)
        except Exception:
            # A single broken blob shouldn't drop the entire card.
            continue
        out.append(
            GalleryThumbnail(
                id=g.get("id") or mode,
                mode=mode,
                label=g.get("label") or mode,
                imageUrl=image_url,
            )
        )
        if len(out) >= _MAX_THUMBS:
            break
    return out


def _to_summary(doc: dict[str, Any]) -> GallerySessionSummary | None:
    session_id = doc.get("sessionId") or doc.get("id")
    created_at = _parse_iso(doc.get("createdAt"))
    if not session_id or created_at is None:
        # Skip documents we can't render safely instead of 500'ing the list.
        return None
    updated_at = _parse_iso(doc.get("updatedAt")) or created_at

    input_doc = doc.get("input") if isinstance(doc.get("input"), dict) else {}
    input_blob = input_doc.get("blob") if input_doc else None
    input_url: str | None = None
    if input_blob:
        try:
            input_url = blob.sas_url(input_blob)
        except Exception:
            input_url = None

    analysis = doc.get("analysis") if isinstance(doc.get("analysis"), dict) else {}
    prompt_summary = _summarize_prompt(analysis.get("promptMd") if analysis else None)

    generations = doc.get("generations") or []
    thumbnails = _safe_thumbnails(generations)

    return GallerySessionSummary(
        sessionId=session_id,
        createdAt=created_at,
        updatedAt=updated_at,
        inputImageUrl=input_url,
        promptSummary=prompt_summary,
        generationCount=sum(1 for g in generations if isinstance(g, dict)),
        thumbnails=thumbnails,
    )


@router.get("", response_model=GalleryListOut)
def list_gallery(
    page: int = Query(1, ge=1, description="1-based page number."),
    pageSize: int = Query(12, ge=1, le=_MAX_PAGE_SIZE, description="Cards per page."),
) -> GalleryListOut:
    """List sessions newest-first as gallery cards."""
    offset = (page - 1) * pageSize
    docs, total = cosmos.list_sessions(limit=pageSize, offset=offset)
    items = [s for s in (_to_summary(d) for d in docs) if s is not None]
    return GalleryListOut(
        items=items,
        page=GalleryPageMeta(
            page=page,
            pageSize=pageSize,
            total=total,
            hasMore=offset + len(items) < total,
        ),
    )
