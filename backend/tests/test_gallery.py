"""Tests for the Gallery list/detail endpoints."""

from __future__ import annotations

from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services import cosmos


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _seed(fake_state: dict[str, Any], session_id: str, created_at: str, *,
          generations: int = 2,
          input_blob: str | None = "input.png",
          prompt_md: str | None = "분석 결과 프롬프트") -> None:
    gens = []
    for i in range(generations):
        gens.append({
            "id": f"{session_id}-g{i}",
            "mode": "front" if i % 2 == 0 else "side",
            "label": "정면" if i % 2 == 0 else "측면",
            "blob": f"{session_id}/gen{i}.png",
            "promptHeader": "header",
            "usedPrompt": "header + prompt",
            "createdAt": f"{created_at[:19]}.{i:02d}+00:00",
        })
    fake_state["sessions"][session_id] = {
        "id": session_id,
        "sessionId": session_id,
        "createdAt": created_at,
        "updatedAt": created_at,
        "input": {"blob": input_blob} if input_blob else None,
        "analysis": {"promptMd": prompt_md} if prompt_md else None,
        "generations": gens,
    }


async def test_gallery_list_empty(client: AsyncClient) -> None:
    r = await client.get("/api/gallery")
    assert r.status_code == 200
    body = r.json()
    assert body == {"items": [], "limit": 20, "offset": 0, "hasMore": False}


async def test_gallery_list_orders_newest_first_and_paginates(
    client: AsyncClient, fake_state: dict[str, Any]
) -> None:
    _seed(fake_state, "s-old", "2026-04-01T00:00:00+00:00")
    _seed(fake_state, "s-mid", "2026-04-15T00:00:00+00:00")
    _seed(fake_state, "s-new", "2026-05-01T00:00:00+00:00")

    r = await client.get("/api/gallery?limit=2&offset=0")
    assert r.status_code == 200
    body = r.json()
    assert [it["sessionId"] for it in body["items"]] == ["s-new", "s-mid"]
    assert body["hasMore"] is True
    assert body["limit"] == 2

    r = await client.get("/api/gallery?limit=2&offset=2")
    body = r.json()
    assert [it["sessionId"] for it in body["items"]] == ["s-old"]
    assert body["hasMore"] is False


async def test_gallery_item_shape(client: AsyncClient, fake_state: dict[str, Any]) -> None:
    _seed(fake_state, "s-1", "2026-05-01T00:00:00+00:00", generations=5,
          prompt_md=("긴 분석 프롬프트 " * 30))
    r = await client.get("/api/gallery")
    item = r.json()["items"][0]
    assert item["sessionId"] == "s-1"
    assert item["inputImageUrl"].startswith("https://")
    # Up to 4 thumbnails.
    assert len(item["thumbnails"]) == 4
    assert item["generationCount"] == 5
    for t in item["thumbnails"]:
        assert t["imageUrl"].startswith("https://")
        assert t["id"]
    # Server-side summary is truncated with an ellipsis.
    assert item["promptSummary"].endswith("…")
    assert "\n" not in item["promptSummary"]


async def test_gallery_handles_missing_fields(
    client: AsyncClient, fake_state: dict[str, Any]
) -> None:
    # A doc with no input, no analysis, no generations should still render.
    fake_state["sessions"]["bare"] = {
        "id": "bare",
        "sessionId": "bare",
        "createdAt": "2026-05-02T00:00:00+00:00",
        "updatedAt": "2026-05-02T00:00:00+00:00",
    }
    # Garbage doc with no createdAt should be skipped, not 500.
    fake_state["sessions"]["garbage"] = {"id": "garbage", "sessionId": "garbage"}
    # Generation entry missing blob should be skipped without breaking the list.
    fake_state["sessions"]["partial"] = {
        "id": "partial",
        "sessionId": "partial",
        "createdAt": "2026-05-03T00:00:00+00:00",
        "updatedAt": "2026-05-03T00:00:00+00:00",
        "input": {},
        "analysis": "not-a-dict",
        "generations": [
            {"id": "x", "mode": "front", "label": "정면"},  # no blob
            {"id": "y", "mode": "back", "label": "후면", "blob": "partial/y.png",
             "createdAt": "2026-05-03T00:00:01+00:00"},
            "not-a-dict",
        ],
    }

    r = await client.get("/api/gallery")
    assert r.status_code == 200
    body = r.json()
    ids = [it["sessionId"] for it in body["items"]]
    assert "bare" in ids
    assert "partial" in ids
    assert "garbage" not in ids
    partial = next(it for it in body["items"] if it["sessionId"] == "partial")
    assert len(partial["thumbnails"]) == 1
    assert partial["thumbnails"][0]["id"] == "y"
    assert partial["generationCount"] == 2  # only dict entries count


async def test_gallery_detail_returns_session_view(
    client: AsyncClient, fake_state: dict[str, Any]
) -> None:
    _seed(fake_state, "s-1", "2026-05-01T00:00:00+00:00")
    r = await client.get("/api/gallery/s-1")
    assert r.status_code == 200
    body = r.json()
    assert body["sessionId"] == "s-1"
    assert body["promptMd"] == "분석 결과 프롬프트"
    assert body["inputImageUrl"].startswith("https://")
    assert len(body["generations"]) == 2


async def test_gallery_detail_404(client: AsyncClient) -> None:
    r = await client.get("/api/gallery/missing")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "session_not_found"


def test_list_sessions_query_shape() -> None:
    """The real ``cosmos.list_sessions`` issues a cross-partition ordered query."""
    import inspect
    # Read straight from the source file because the autouse fixture replaces
    # the module attribute with an in-memory fake.
    src = inspect.getsource(inspect.getmodule(cosmos))
    list_src = src.split("def list_sessions", 1)[1].split("\ndef ", 1)[0]
    assert "ORDER BY c.createdAt DESC" in list_src
    assert "enable_cross_partition_query=True" in list_src
    assert "OFFSET" in list_src and "LIMIT" in list_src
