"""Anonymous board routes."""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status

from app.schemas import BoardPostIn, BoardPostOut
from app.services import cosmos

router = APIRouter(prefix="/board", tags=["board"])


def _validation_error(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"code": "validation_error", "message": message},
    )


@router.post("/posts", response_model=BoardPostOut, status_code=status.HTTP_201_CREATED)
def create_post(body: BoardPostIn) -> BoardPostOut:
    content = body.content.strip()
    if not content:
        raise _validation_error("content must be between 1 and 1000 characters.")
    if len(content) > 1000:
        raise _validation_error("content must be between 1 and 1000 characters.")

    author = (body.author or "").strip() or "익명"
    if len(author) > 50:
        raise _validation_error("author must be 50 characters or fewer.")

    post_id = f"post-{uuid.uuid4().hex}"
    doc = {
        "id": post_id,
        "type": "post",
        "sessionId": post_id,
        "author": author,
        "content": content,
        "createdAt": cosmos.now_iso(),
    }
    created = cosmos.create_post(doc)
    return BoardPostOut(
        id=created["id"],
        type=created["type"],
        sessionId=created["sessionId"],
        author=created["author"],
        content=created["content"],
        createdAt=datetime.fromisoformat(created["createdAt"]),
    )


@router.get("/posts", response_model=list[BoardPostOut])
def get_posts(limit: int = Query(default=50, ge=1, le=100)) -> list[BoardPostOut]:
    docs = cosmos.list_posts(limit)
    return [
        BoardPostOut(
            id=doc["id"],
            type=doc["type"],
            sessionId=doc["sessionId"],
            author=doc["author"],
            content=doc["content"],
            createdAt=datetime.fromisoformat(doc["createdAt"]),
        )
        for doc in docs
    ]
