from __future__ import annotations

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services import cosmos


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def test_post_create_success(client: AsyncClient) -> None:
    r = await client.post("/api/board/posts", json={"author": "테스터", "content": "첫 글"})
    assert r.status_code == 201
    body = r.json()
    assert body["type"] == "post"
    assert body["author"] == "테스터"
    assert body["content"] == "첫 글"
    assert body["id"].startswith("post-")
    assert body["sessionId"] == body["id"]


async def test_post_empty_content_400(client: AsyncClient) -> None:
    r = await client.post("/api/board/posts", json={"author": "A", "content": "   "})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "validation_error"


async def test_post_content_too_long_400(client: AsyncClient) -> None:
    r = await client.post("/api/board/posts", json={"author": "A", "content": "가" * 1001})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "validation_error"


async def test_post_anonymous_default(client: AsyncClient) -> None:
    r = await client.post("/api/board/posts", json={"content": "작성자 없음"})
    assert r.status_code == 201
    assert r.json()["author"] == "익명"


async def test_get_posts_latest_first(client: AsyncClient, monkeypatch) -> None:
    times = iter(
        [
            "2026-05-01T00:00:01+00:00",
            "2026-05-01T00:00:03+00:00",
            "2026-05-01T00:00:02+00:00",
        ]
    )
    monkeypatch.setattr(cosmos, "now_iso", lambda: next(times))

    await client.post("/api/board/posts", json={"author": "u1", "content": "old"})
    await client.post("/api/board/posts", json={"author": "u2", "content": "new"})
    await client.post("/api/board/posts", json={"author": "u3", "content": "mid"})

    r = await client.get("/api/board/posts?limit=50")
    assert r.status_code == 200
    assert [p["content"] for p in r.json()] == ["new", "mid", "old"]


async def test_sessions_flow_still_works(client: AsyncClient) -> None:
    created = await client.post("/api/sessions")
    assert created.status_code == 201
    session_id = created.json()["sessionId"]

    fetched = await client.get(f"/api/sessions/{session_id}")
    assert fetched.status_code == 200
    body = fetched.json()
    assert body["sessionId"] == session_id
    assert body["generations"] == []
