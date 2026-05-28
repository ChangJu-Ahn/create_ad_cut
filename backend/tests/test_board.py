"""Tests for the /api/board routes."""

from __future__ import annotations

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def test_create_list_and_get_post(client: AsyncClient) -> None:
    # Empty board to start.
    r = await client.get("/api/board")
    assert r.status_code == 200
    assert r.json() == {"items": []}

    # Create.
    r = await client.post(
        "/api/board",
        json={"title": "  첫 게시글  ", "body": "본문 내용", "author": "  안창주 "},
    )
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["title"] == "첫 게시글"  # title trimmed
    assert created["author"] == "안창주"  # author trimmed
    assert created["body"] == "본문 내용"
    assert created["postId"]
    assert created["createdAt"]
    post_id = created["postId"]

    # List shows the post with an excerpt.
    r = await client.get("/api/board")
    assert r.status_code == 200
    body = r.json()
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert item["postId"] == post_id
    assert item["title"] == "첫 게시글"
    assert item["author"] == "안창주"
    assert item["excerpt"] == "본문 내용"

    # Detail.
    r = await client.get(f"/api/board/{post_id}")
    assert r.status_code == 200
    detail = r.json()
    assert detail["postId"] == post_id
    assert detail["body"] == "본문 내용"


async def test_get_post_404(client: AsyncClient) -> None:
    r = await client.get("/api/board/does-not-exist")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "post_not_found"


async def test_create_post_validation(client: AsyncClient) -> None:
    # Missing required body.
    r = await client.post("/api/board", json={"title": "제목만"})
    assert r.status_code == 422

    # Empty title rejected.
    r = await client.post("/api/board", json={"title": "", "body": "내용"})
    assert r.status_code == 422


async def test_list_limit_query(client: AsyncClient) -> None:
    for i in range(3):
        r = await client.post(
            "/api/board",
            json={"title": f"제목 {i}", "body": f"본문 {i}"},
        )
        assert r.status_code == 201

    r = await client.get("/api/board", params={"limit": 2})
    assert r.status_code == 200
    assert len(r.json()["items"]) == 2

    # Reject invalid limit (0 < limit <= 100).
    r = await client.get("/api/board", params={"limit": 0})
    assert r.status_code == 422

    r = await client.get("/api/board", params={"limit": 1000})
    assert r.status_code == 422


async def test_list_excerpt_truncated(client: AsyncClient) -> None:
    long_body = "가" * 500
    r = await client.post(
        "/api/board",
        json={"title": "긴 글", "body": long_body},
    )
    assert r.status_code == 201

    r = await client.get("/api/board")
    assert r.status_code == 200
    item = r.json()["items"][0]
    assert item["excerpt"].endswith("…")
    assert len(item["excerpt"]) <= 121  # 120 chars + ellipsis
