"""Gallery API smoke tests."""

from __future__ import annotations

import io
from typing import Any

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.main import app
from app.services import cosmos


def _png_bytes() -> bytes:
    img = Image.new("RGB", (32, 32), (10, 20, 30))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def test_gallery_empty(client: AsyncClient) -> None:
    r = await client.get("/api/gallery")
    assert r.status_code == 200
    body = r.json()
    assert body == {"items": [], "total": 0, "limit": 20, "offset": 0}


async def test_gallery_detail_404(client: AsyncClient) -> None:
    r = await client.get("/api/gallery/does-not-exist")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "session_not_found"


async def test_gallery_list_handles_legacy_docs(
    client: AsyncClient, fake_state: dict[str, Any]
) -> None:
    """Sessions missing input/analysis/generations must not crash the API."""
    fake_state["sessions"]["legacy"] = {
        "id": "legacy",
        "sessionId": "legacy",
        "createdAt": "2020-01-01T00:00:00+00:00",
        "updatedAt": "2020-01-01T00:00:00+00:00",
        # input/analysis/generations intentionally omitted
    }

    r = await client.get("/api/gallery")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    card = body["items"][0]
    assert card["sessionId"] == "legacy"
    assert card["inputImageUrl"] is None
    assert card["promptSummary"] == ""
    assert card["thumbnails"] == []
    assert card["generationCount"] == 0


async def test_gallery_list_and_detail(
    client: AsyncClient, fake_state: dict[str, Any]
) -> None:
    # Create a session + run analyze so the doc carries input + analysis.
    r = await client.post("/api/sessions")
    sid = r.json()["sessionId"]
    files = {"image": ("input.png", _png_bytes(), "image/png")}
    r = await client.post(f"/api/sessions/{sid}/analyze", files=files)
    assert r.status_code == 200

    # Inject 5 fake generations directly to exercise the 4-thumbnail cap +
    # newest-first ordering without paying for a real generate job.
    doc = fake_state["sessions"][sid]
    doc["generations"] = [
        {
            "id": f"g{i}",
            "mode": "front",
            "label": f"front-{i}",
            "blob": f"sessions/{sid}/g{i}.png",
            "promptHeader": "",
            "usedPrompt": "p",
            "createdAt": f"2026-05-01T00:00:0{i}+00:00",
        }
        for i in range(5)
    ]
    cosmos.upsert_session(doc)

    # List
    r = await client.get("/api/gallery?limit=10&offset=0")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] >= 1
    card = next(c for c in body["items"] if c["sessionId"] == sid)
    assert card["inputImageUrl"].startswith("https://")
    assert card["promptSummary"]  # non-empty truncated prompt
    assert card["generationCount"] == 5
    assert len(card["thumbnails"]) == 4
    # Newest first — generation g4 should lead.
    assert card["thumbnails"][0]["id"] == "g4"
    for t in card["thumbnails"]:
        assert t["imageUrl"].startswith("https://")

    # Pagination — limit=1 returns one item, total unchanged.
    r = await client.get("/api/gallery?limit=1&offset=0")
    assert r.status_code == 200
    paged = r.json()
    assert len(paged["items"]) == 1
    assert paged["total"] == body["total"]

    # Detail mirrors the existing session view shape.
    r = await client.get(f"/api/gallery/{sid}")
    assert r.status_code == 200
    detail = r.json()
    assert detail["sessionId"] == sid
    assert len(detail["generations"]) == 5
    assert detail["inputImageUrl"].startswith("https://")


async def test_gallery_prompt_summary_truncates(
    client: AsyncClient, fake_state: dict[str, Any]
) -> None:
    long_prompt = "가" * 500
    fake_state["sessions"]["long"] = {
        "id": "long",
        "sessionId": "long",
        "createdAt": "2026-05-01T00:00:00+00:00",
        "updatedAt": "2026-05-01T00:00:00+00:00",
        "input": None,
        "analysis": {"promptMd": long_prompt},
        "generations": [],
    }
    r = await client.get("/api/gallery")
    card = next(c for c in r.json()["items"] if c["sessionId"] == "long")
    assert card["promptSummary"].endswith("…")
    assert len(card["promptSummary"]) <= 140
