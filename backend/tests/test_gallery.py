"""Gallery route tests — list + detail projections from session docs."""

from __future__ import annotations

from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _seed(fake_state: dict[str, Any], session_id: str, *, gens: int = 0, created_at: str | None = None,
          prompt_md: str | None = "## 분석 결과\n- 색상: 파랑\n- 소재: 면",
          with_input: bool = True) -> None:
    doc: dict[str, Any] = {
        "id": session_id,
        "sessionId": session_id,
        "createdAt": created_at or "2026-05-01T00:00:00+00:00",
        "updatedAt": created_at or "2026-05-01T00:00:00+00:00",
        "input": {"blob": f"sessions/{session_id}/input.png"} if with_input else None,
        "analysis": {"promptMd": prompt_md} if prompt_md is not None else None,
        "generations": [
            {
                "id": f"gen-{i}",
                "mode": ["lookbook", "front", "side", "back", "custom"][i % 5],
                "label": f"label-{i}",
                "blob": f"sessions/{session_id}/gen-{i}.png",
                "promptHeader": "header",
                "usedPrompt": "used",
                "createdAt": f"2026-05-01T00:00:{i:02d}+00:00",
            }
            for i in range(gens)
        ],
    }
    fake_state["sessions"][session_id] = doc


async def test_gallery_list_empty(client: AsyncClient) -> None:
    r = await client.get("/api/gallery")
    assert r.status_code == 200
    body = r.json()
    assert body == {"items": [], "total": 0, "limit": 20, "offset": 0}


async def test_gallery_list_newest_first_with_thumbnails(
    client: AsyncClient, fake_state: dict[str, Any]
) -> None:
    _seed(fake_state, "old", gens=2, created_at="2026-05-01T00:00:00+00:00")
    _seed(fake_state, "new", gens=6, created_at="2026-05-02T00:00:00+00:00")

    r = await client.get("/api/gallery")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 2
    assert [c["sessionId"] for c in body["items"]] == ["new", "old"]

    new_card = body["items"][0]
    # Cap at 4 thumbnails, newest first.
    assert len(new_card["thumbnails"]) == 4
    assert new_card["generationCount"] == 6
    assert new_card["thumbnails"][0]["id"] == "gen-5"
    assert new_card["thumbnails"][0]["imageUrl"].startswith("https://")
    assert new_card["inputImageUrl"].startswith("https://")
    assert "분석 결과" in new_card["promptSummary"]
    # Single-line summary — no embedded newlines after squashing.
    assert "\n" not in new_card["promptSummary"]


async def test_gallery_list_pagination(client: AsyncClient, fake_state: dict[str, Any]) -> None:
    for i in range(3):
        _seed(fake_state, f"s{i}", gens=1, created_at=f"2026-05-0{i + 1}T00:00:00+00:00")
    r = await client.get("/api/gallery?limit=1&offset=1")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 3
    assert body["limit"] == 1
    assert body["offset"] == 1
    assert len(body["items"]) == 1
    # Newest is s2 → offset 1 selects s1.
    assert body["items"][0]["sessionId"] == "s1"


async def test_gallery_list_tolerates_missing_fields(
    client: AsyncClient, fake_state: dict[str, Any]
) -> None:
    # No input, no analysis, no generations.
    _seed(fake_state, "bare", gens=0, prompt_md=None, with_input=False)
    r = await client.get("/api/gallery")
    assert r.status_code == 200
    card = r.json()["items"][0]
    assert card["sessionId"] == "bare"
    assert card["inputImageUrl"] is None
    assert card["promptSummary"] == ""
    assert card["thumbnails"] == []
    assert card["generationCount"] == 0


async def test_gallery_detail_ok(client: AsyncClient, fake_state: dict[str, Any]) -> None:
    _seed(fake_state, "abc", gens=2)
    r = await client.get("/api/gallery/abc")
    assert r.status_code == 200
    body = r.json()
    assert body["sessionId"] == "abc"
    assert len(body["generations"]) == 2
    assert body["inputImageUrl"].startswith("https://")


async def test_gallery_detail_404(client: AsyncClient) -> None:
    r = await client.get("/api/gallery/nope")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "session_not_found"
