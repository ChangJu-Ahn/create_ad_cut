"""Gallery routes — browse previously generated ad cuts across all sessions.

The gallery is a read-only projection over the embedded ``generations[]``
arrays of every session document in Cosmos. SAS URLs are minted on every
read so the frontend always receives fresh, time-limited links.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status

from app.schemas import GalleryDetail, GalleryItem, GalleryListOut
from app.services import blob, cosmos

router = APIRouter(prefix="/gallery", tags=["gallery"])


@router.get("", response_model=GalleryListOut)
def list_gallery(
    limit: int = Query(20, ge=1, le=100, description="Page size (1~100)."),
    offset: int = Query(0, ge=0, description="Number of items to skip — newest first."),
) -> GalleryListOut:
    """Paginated list of generations across all sessions, newest first.

    Fetches ``limit + 1`` rows to determine whether another page exists
    without requiring a separate COUNT query.
    """
    rows = cosmos.list_generations(limit + 1, offset)
    has_more = len(rows) > limit
    page = rows[:limit]
    items = [
        GalleryItem(
            id=r["id"],
            sessionId=r["sessionId"],
            mode=r["mode"],
            label=r.get("label") or r["mode"],
            imageUrl=blob.sas_url(r["blob"]),
            createdAt=datetime.fromisoformat(r["createdAt"]),
        )
        for r in page
    ]
    return GalleryListOut(
        items=items,
        limit=limit,
        offset=offset,
        nextOffset=offset + limit if has_more else None,
    )


@router.get("/{generation_id}", response_model=GalleryDetail)
def get_gallery_item(generation_id: str) -> GalleryDetail:
    """Detail view for a single generation, including session context."""
    row = cosmos.find_generation(generation_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "generation_not_found",
                "message": f"Generation {generation_id} not found.",
            },
        )
    gen = row["generation"]
    input_blob = (row.get("input") or {}).get("blob")
    analysis = row.get("analysis") or {}
    return GalleryDetail(
        id=gen["id"],
        sessionId=row["sessionId"],
        mode=gen["mode"],
        label=gen.get("label") or gen["mode"],
        imageUrl=blob.sas_url(gen["blob"]),
        promptHeader=gen.get("promptHeader", ""),
        usedPrompt=gen.get("usedPrompt", ""),
        createdAt=datetime.fromisoformat(gen["createdAt"]),
        inputImageUrl=blob.sas_url(input_blob) if input_blob else None,
        promptMd=analysis.get("promptMd"),
    )
