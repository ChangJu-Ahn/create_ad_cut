"""End-to-end smoke test for the four routes using FastAPI TestClient."""

from __future__ import annotations

import io

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app

client = TestClient(app)
HEADERS = {"X-API-Key": "test-key"}


def _png_bytes() -> bytes:
    img = Image.new("RGB", (256, 256), (200, 150, 100))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_full_flow_smoke() -> None:
    # 1. healthz (root and api both 200)
    assert client.get("/healthz").status_code == 200
    assert client.get("/api/healthz").status_code == 200

    # 2. unauthorized when X-API-Key missing
    r = client.post("/api/sessions")
    assert r.status_code == 401

    # 3. create session
    r = client.post("/api/sessions", headers=HEADERS)
    assert r.status_code == 201
    session_id = r.json()["sessionId"]

    # 4. analyze (multipart)
    files = {"image": ("input.png", _png_bytes(), "image/png")}
    r = client.post(f"/api/sessions/{session_id}/analyze", headers=HEADERS, files=files)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "분석" in body["promptMd"]  # “샘플 분석 결과입니다.”
    assert not body["promptMd"].startswith("#")  # # Output_Prompt 제거됨
    assert body["inputImageUrl"].startswith("https://")

    # 5. patch prompt
    r = client.patch(
        f"/api/sessions/{session_id}/prompt",
        headers=HEADERS,
        json={"promptMd": "사람이 검수한 프롬프트"},
    )
    assert r.status_code == 200
    assert "검수한" in r.json()["promptMd"]

    # 6. generate 4 built-in modes + 1 custom cut
    r = client.post(
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
                    "promptHeader": "1024x1024 정방형, 남성 모델이 상품을 자연스럽게 착용한 데일리 컷",
                    "useReference": False,
                },
            ]
        },
    )
    assert r.status_code == 200, r.text
    results = r.json()["results"]
    assert {g["mode"] for g in results} == {"lookbook", "front", "side", "back", "custom"}
    assert any(g["label"] == "남자 모델 룩북" for g in results)
    for g in results:
        assert g["imageUrl"].startswith("https://")
        assert len(g["usedPrompt"]) > 0  # style header + analysis prompt 포함
        assert g["id"]  # 고유 id 부여됨

    # 7. session view returns persisted state (5 generations stacked)
    r = client.get(f"/api/sessions/{session_id}", headers=HEADERS)
    assert r.status_code == 200
    view = r.json()
    assert view["promptMd"].endswith("검수한 프롬프트")
    assert len(view["generations"]) == 5
    for g in view["generations"]:
        assert len(g["usedPrompt"]) > 0
        assert g["id"]

    # 8. regenerate one cut with a tweaked header → appended, history grows to 6
    r = client.post(
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
    assert r.status_code == 200
    r = client.get(f"/api/sessions/{session_id}", headers=HEADERS)
    assert len(r.json()["generations"]) == 6


def test_generate_requires_analysis() -> None:
    r = client.post("/api/sessions", headers=HEADERS)
    sid = r.json()["sessionId"]
    r = client.post(
        f"/api/sessions/{sid}/generate", headers=HEADERS, json={"items": [{"mode": "front"}]}
    )
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "prerequisites_missing"


def test_custom_requires_label_and_header() -> None:
    r = client.post("/api/sessions", headers=HEADERS)
    sid = r.json()["sessionId"]
    files = {"image": ("input.png", _png_bytes(), "image/png")}
    client.post(f"/api/sessions/{sid}/analyze", headers=HEADERS, files=files)

    r = client.post(
        f"/api/sessions/{sid}/generate",
        headers=HEADERS,
        json={"items": [{"mode": "custom"}]},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "custom_prompt_required"


def test_style_headers_endpoint() -> None:
    r = client.get("/api/style-headers", headers=HEADERS)
    assert r.status_code == 200
    headers = r.json()
    assert {h["mode"] for h in headers} == {"lookbook", "front", "side", "back"}
    for h in headers:
        assert h["label"] and h["header"]


def test_unsupported_media_type() -> None:
    r = client.post("/api/sessions", headers=HEADERS)
    sid = r.json()["sessionId"]
    files = {"image": ("input.gif", b"GIF89a", "image/gif")}
    r = client.post(f"/api/sessions/{sid}/analyze", headers=HEADERS, files=files)
    assert r.status_code == 415
