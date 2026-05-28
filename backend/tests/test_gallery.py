"""Tests for the gallery list + detail routes."""

from __future__ import annotations

import io

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.main import app


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
    assert body == {"items": [], "limit": 12, "offset": 0, "hasMore": False}


async def test_gallery_handles_session_without_input_or_analysis(client: AsyncClient) -> None:
    # A bare session (no analyze call) must not 500 — every nested
    # field on the document is potentially missing.
    r = await client.post("/api/sessions")
    assert r.status_code == 201

    r = await client.get("/api/gallery")
    assert r.status_code == 200
    body = r.json()
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert item["inputImageUrl"] is None
    assert item["promptSummary"] is None
    assert item["generationCount"] == 0
    assert item["thumbnails"] == []


async def test_gallery_orders_latest_first_and_paginates(client: AsyncClient) -> None:
    ids: list[str] = []
    for _ in range(3):
        r = await client.post("/api/sessions")
        ids.append(r.json()["sessionId"])

    # Analyze the most recent so its summary has a prompt + input image.
    files = {"image": ("input.png", _png_bytes(), "image/png")}
    await client.post(f"/api/sessions/{ids[-1]}/analyze", files=files)

    r = await client.get("/api/gallery", params={"limit": 2, "offset": 0})
    assert r.status_code == 200
    body = r.json()
    assert body["limit"] == 2
    assert body["offset"] == 0
    assert body["hasMore"] is True
    assert [it["sessionId"] for it in body["items"]] == [ids[2], ids[1]]
    # Latest one (analyzed) carries the input image url + prompt summary.
    assert body["items"][0]["inputImageUrl"].startswith("https://")
    assert body["items"][0]["promptSummary"]

    r = await client.get("/api/gallery", params={"limit": 2, "offset": 2})
    body = r.json()
    assert [it["sessionId"] for it in body["items"]] == [ids[0]]
    assert body["hasMore"] is False


async def test_gallery_detail_returns_session_view(client: AsyncClient) -> None:
    r = await client.post("/api/sessions")
    sid = r.json()["sessionId"]
    files = {"image": ("input.png", _png_bytes(), "image/png")}
    await client.post(f"/api/sessions/{sid}/analyze", files=files)

    r = await client.get(f"/api/gallery/{sid}")
    assert r.status_code == 200
    body = r.json()
    assert body["sessionId"] == sid
    assert body["inputImageUrl"].startswith("https://")
    assert body["promptMd"]


async def test_gallery_detail_404(client: AsyncClient) -> None:
    r = await client.get("/api/gallery/does-not-exist")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "session_not_found"
