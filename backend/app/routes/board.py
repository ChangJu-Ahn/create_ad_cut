"""Board (게시판) routes — minimal list / create / detail flow.

Scope (per the demo issue): list posts, create a post with the minimum
fields, read a single post by id. Comments / likes / attachments are
intentionally out of scope.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status

from app.schemas import BoardPostIn, BoardPostList, BoardPostListItem, BoardPostOut
from app.services import cosmos

router = APIRouter(prefix="/board", tags=["board"])

logger = logging.getLogger(__name__)

# Soft cap on excerpt length to keep the list payload small.
_EXCERPT_MAX = 120


def _post_doc_to_out(doc: dict[str, Any]) -> BoardPostOut:
    return BoardPostOut(
        postId=doc["postId"],
        title=doc["title"],
        body=doc["body"],
        author=doc.get("author"),
        createdAt=datetime.fromisoformat(doc["createdAt"]),
        updatedAt=datetime.fromisoformat(doc["updatedAt"]),
    )


def _post_doc_to_list_item(doc: dict[str, Any]) -> BoardPostListItem:
    body = doc.get("body") or ""
    excerpt = body.strip().replace("\n", " ")
    if len(excerpt) > _EXCERPT_MAX:
        excerpt = excerpt[:_EXCERPT_MAX].rstrip() + "…"
    return BoardPostListItem(
        postId=doc["postId"],
        title=doc["title"],
        author=doc.get("author"),
        createdAt=datetime.fromisoformat(doc["createdAt"]),
        excerpt=excerpt,
    )


@router.post("", response_model=BoardPostOut, status_code=status.HTTP_201_CREATED)
def create_post(body: BoardPostIn) -> BoardPostOut:
    post_id = uuid.uuid4().hex
    author = body.author.strip() if body.author else None
    doc = cosmos.create_board_post(
        post_id=post_id,
        title=body.title.strip(),
        body=body.body,
        author=author or None,
    )
    return _post_doc_to_out(doc)


@router.get("", response_model=BoardPostList)
def list_posts(limit: int = Query(20, ge=1, le=100)) -> BoardPostList:
    """List recent posts. Best-effort: a single malformed document is
    skipped rather than failing the whole response so the demo list stays
    usable even if older data is inconsistent.
    """
    items: list[BoardPostListItem] = []
    try:
        docs = cosmos.list_board_posts(limit=limit)
    except Exception:  # pragma: no cover - defensive logging
        logger.exception("board: list query failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "board_list_unavailable", "message": "Failed to list board posts."},
        ) from None

    for doc in docs:
        try:
            items.append(_post_doc_to_list_item(doc))
        except Exception:  # pragma: no cover - defensive
            logger.warning("board: skipping malformed post doc id=%s", doc.get("postId"))
            continue
    return BoardPostList(items=items)


@router.get("/{post_id}", response_model=BoardPostOut)
def get_post(post_id: str) -> BoardPostOut:
    doc = cosmos.get_board_post(post_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "post_not_found", "message": f"Post {post_id} not found."},
        )
    return _post_doc_to_out(doc)
