"""Tests for the gallery list endpoint."""

from __future__ import annotations

from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _seed_session(
    fake_state: dict[str, Any],
    session_id: str,
    *,
    created_at: str,
    prompt: str | None = "분석 결과 본문",
    input_blob: str | None = "sessions/s/input.png",
    n_gens: int = 5,
) -> None:
    generations = [
        {
            "id": f"gen-{i}",
            "mode": ["lookbook", "front", "side", "back", "custom"][i % 5],
            "label": f"컷 {i}",
            "blob": f"sessions/{session_id}/gen-{i}.png",
            "promptHeader": "헤더",
            "usedPrompt": "헤더 + 본문",
            "createdAt": f"2026-05-01T00:00:{i:02d}+00:00",
        }
        for i in range(n_gens)
    ]
    fake_state["sessions"][session_id] = {
        "id": session_id,
        "sessionId": session_id,
        "createdAt": created_at,
        "updatedAt": created_at,
        "input": {"blob": input_blob} if input_blob else None,
        "analysis": {"promptMd": prompt} if prompt is not None else None,
        "generations": generations,
    }


async def test_gallery_list_empty(client: AsyncClient) -> None:
    r = await client.get("/api/gallery")
    assert r.status_code == 200
    body = r.json()
    assert body["items"] == []
    assert body["page"] == {"page": 1, "pageSize": 12, "total": 0, "hasMore": False}


async def test_gallery_list_orders_desc_and_truncates_thumbnails(
    client: AsyncClient, fake_state: dict[str, Any]
) -> None:
    _seed_session(fake_state, "s-old", created_at="2026-05-01T00:00:00+00:00", n_gens=5)
    _seed_session(fake_state, "s-new", created_at="2026-05-02T00:00:00+00:00", n_gens=2)

    r = await client.get("/api/gallery")
    assert r.status_code == 200
    body = r.json()
    assert [i["sessionId"] for i in body["items"]] == ["s-new", "s-old"]
    assert body["page"]["total"] == 2

    old_card = body["items"][1]
    assert old_card["generationCount"] == 5
    # Capped at 4 thumbnails for the card grid.
    assert len(old_card["thumbnails"]) == 4
    assert all(t["imageUrl"].startswith("https://") for t in old_card["thumbnails"])
    assert old_card["inputImageUrl"].startswith("https://")
    assert old_card["promptSummary"] == "분석 결과 본문"


async def test_gallery_list_pagination(
    client: AsyncClient, fake_state: dict[str, Any]
) -> None:
    for i in range(5):
        _seed_session(
            fake_state,
            f"s-{i}",
            created_at=f"2026-05-0{i + 1}T00:00:00+00:00",
            n_gens=1,
        )

    r = await client.get("/api/gallery", params={"page": 1, "pageSize": 2})
    body = r.json()
    assert [i["sessionId"] for i in body["items"]] == ["s-4", "s-3"]
    assert body["page"] == {"page": 1, "pageSize": 2, "total": 5, "hasMore": True}

    r = await client.get("/api/gallery", params={"page": 3, "pageSize": 2})
    body = r.json()
    assert [i["sessionId"] for i in body["items"]] == ["s-0"]
    assert body["page"]["hasMore"] is False


async def test_gallery_tolerates_missing_fields(
    client: AsyncClient, fake_state: dict[str, Any]
) -> None:
    # Legacy doc with no analysis / input / generations should still render.
    fake_state["sessions"]["legacy"] = {
        "id": "legacy",
        "sessionId": "legacy",
        "createdAt": "2026-05-01T00:00:00+00:00",
        "updatedAt": "2026-05-01T00:00:00+00:00",
        # input/analysis/generations intentionally missing.
    }
    r = await client.get("/api/gallery")
    assert r.status_code == 200
    body = r.json()
    assert len(body["items"]) == 1
    card = body["items"][0]
    assert card["inputImageUrl"] is None
    assert card["promptSummary"] is None
    assert card["thumbnails"] == []
    assert card["generationCount"] == 0


async def test_gallery_skips_unparseable_documents(
    client: AsyncClient, fake_state: dict[str, Any]
) -> None:
    # Document without a usable createdAt is skipped instead of 500'ing.
    fake_state["sessions"]["broken"] = {"id": "broken", "sessionId": "broken"}
    _seed_session(fake_state, "ok", created_at="2026-05-02T00:00:00+00:00", n_gens=0)

    r = await client.get("/api/gallery")
    assert r.status_code == 200
    body = r.json()
    assert [i["sessionId"] for i in body["items"]] == ["ok"]


async def test_gallery_prompt_summary_truncates_long_text(
    client: AsyncClient, fake_state: dict[str, Any]
) -> None:
    long_prompt = "가" * 500
    _seed_session(
        fake_state,
        "s-long",
        created_at="2026-05-02T00:00:00+00:00",
        prompt=long_prompt,
        n_gens=0,
    )
    r = await client.get("/api/gallery")
    summary = r.json()["items"][0]["promptSummary"]
    assert summary.endswith("…")
    assert len(summary) <= 160
