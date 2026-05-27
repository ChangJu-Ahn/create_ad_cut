"""End-to-end smoke test for the four routes using httpx AsyncClient.

We use `httpx.AsyncClient` + `ASGITransport` (not `TestClient`) because the
generate route now spawns a background `asyncio.create_task`. With the sync
`TestClient` that task never gets a chance to run between polls; the async
client shares the loop and lets the task progress naturally.
"""

from __future__ import annotations

import asyncio
import io

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.main import app

HEADERS = {"X-API-Key": "test-key"}


def _png_bytes() -> bytes:
    img = Image.new("RGB", (256, 256), (200, 150, 100))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def _wait_for_job(
    client: AsyncClient, session_id: str, job_id: str, timeout_s: float = 5.0
) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout_s
    while asyncio.get_event_loop().time() < deadline:
        r = await client.get(
            f"/api/sessions/{session_id}/generate/jobs/{job_id}", headers=HEADERS
        )
        assert r.status_code == 200, r.text
        body = r.json()
        if body["status"] != "running":
            return body
        await asyncio.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish within {timeout_s}s")


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def test_full_flow_smoke(client: AsyncClient) -> None:
    # 1. healthz (root and api both 200)
    assert (await client.get("/healthz")).status_code == 200
    assert (await client.get("/api/healthz")).status_code == 200

    # 1b. version endpoint
    r = await client.get("/api/version")
    assert r.status_code == 200
    assert "version" in r.json()

    # 2. unauthorized when X-API-Key missing
    r = await client.post("/api/sessions")
    assert r.status_code == 401

    # 3. create session
    r = await client.post("/api/sessions", headers=HEADERS)
    assert r.status_code == 201
    session_id = r.json()["sessionId"]

    # 4. analyze (multipart)
    files = {"image": ("input.png", _png_bytes(), "image/png")}
    r = await client.post(
        f"/api/sessions/{session_id}/analyze", headers=HEADERS, files=files
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "분석" in body["promptMd"]
    assert not body["promptMd"].startswith("#")
    assert body["inputImageUrl"].startswith("https://")

    # 5. patch prompt
    r = await client.patch(
        f"/api/sessions/{session_id}/prompt",
        headers=HEADERS,
        json={"promptMd": "사람이 검수한 프롬프트"},
    )
    assert r.status_code == 200
    assert "검수한" in r.json()["promptMd"]

    # 6. generate 4 built-in modes + 1 custom cut → 202 + jobId
    r = await client.post(
        f"/api/sessions/{session_id}/generate",
        headers=HEADERS,
        json={
            "items": [
                {"mode": "lookbook"},
                {"mode": "front"},
                {"mode": "side"},
                {"mode": "back"},
                {
                    "mode": "custom",
                    "label": "남자 모델 룩북",
                    "promptHeader": "1024x1024 정방형, 남성 모델 데일리 컷",
                    "useReference": False,
                },
            ]
        },
    )
    assert r.status_code == 202, r.text
    initial = r.json()
    assert initial["status"] == "running"
    assert {it["mode"] for it in initial["items"]} == {
        "lookbook",
        "front",
        "side",
        "back",
        "custom",
    }
    job_id = initial["jobId"]

    final = await _wait_for_job(client, session_id, job_id)
    assert final["status"] == "done", final
    assert all(it["status"] == "done" for it in final["items"])
    assert all(it["generationId"] for it in final["items"])

    # 7. session view returns persisted state (5 generations stacked)
    r = await client.get(f"/api/sessions/{session_id}", headers=HEADERS)
    assert r.status_code == 200
    view = r.json()
    assert view["promptMd"].endswith("검수한 프롬프트")
    assert len(view["generations"]) == 5
    for g in view["generations"]:
        assert len(g["usedPrompt"]) > 0
        assert g["id"]

    # 8. regenerate one cut → appended, history grows to 6
    r = await client.post(
        f"/api/sessions/{session_id}/generate",
        headers=HEADERS,
        json={
            "items": [
                {
                    "mode": "front",
                    "promptHeader": "1024x1024 정면 컷, 더 강한 백라이트로 재생성",
                }
            ]
        },
    )
    assert r.status_code == 202
    await _wait_for_job(client, session_id, r.json()["jobId"])
    r = await client.get(f"/api/sessions/{session_id}", headers=HEADERS)
    assert len(r.json()["generations"]) == 6


async def test_generate_requires_analysis(client: AsyncClient) -> None:
    r = await client.post("/api/sessions", headers=HEADERS)
    sid = r.json()["sessionId"]
    r = await client.post(
        f"/api/sessions/{sid}/generate",
        headers=HEADERS,
        json={"items": [{"mode": "front"}]},
    )
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "prerequisites_missing"


async def test_custom_requires_label_and_header(client: AsyncClient) -> None:
    r = await client.post("/api/sessions", headers=HEADERS)
    sid = r.json()["sessionId"]
    files = {"image": ("input.png", _png_bytes(), "image/png")}
    await client.post(f"/api/sessions/{sid}/analyze", headers=HEADERS, files=files)

    r = await client.post(
        f"/api/sessions/{sid}/generate",
        headers=HEADERS,
        json={"items": [{"mode": "custom"}]},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "custom_prompt_required"


async def test_get_job_404(client: AsyncClient) -> None:
    r = await client.post("/api/sessions", headers=HEADERS)
    sid = r.json()["sessionId"]
    r = await client.get(
        f"/api/sessions/{sid}/generate/jobs/does-not-exist", headers=HEADERS
    )
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "job_not_found"


async def test_unsupported_media_type(client: AsyncClient) -> None:
    r = await client.post("/api/sessions", headers=HEADERS)
    sid = r.json()["sessionId"]
    files = {"image": ("input.gif", b"GIF89a", "image/gif")}
    r = await client.post(
        f"/api/sessions/{sid}/analyze", headers=HEADERS, files=files
    )
    assert r.status_code == 415


async def test_style_headers_endpoint(client: AsyncClient) -> None:
    r = await client.get("/api/style-headers", headers=HEADERS)
    assert r.status_code == 200
    headers = r.json()
    assert {h["mode"] for h in headers} == {"lookbook", "front", "side", "back"}
    for h in headers:
        assert h["label"] and h["header"]
