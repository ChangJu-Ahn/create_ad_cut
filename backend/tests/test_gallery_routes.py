"""Gallery route tests — list (paging, newest-first, empty) + detail (200, 404)."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _seed(fake_state: dict[str, Any], n_per_session: int = 2, n_sessions: int = 3) -> list[str]:
    """Seed sessions with `n_per_session` generations each. Returns generation ids in created order."""
    created_ids: list[str] = []
    counter = 0
    for s in range(n_sessions):
        sid = f"sess{s:02d}"
        fake_state["sessions"][sid] = {
            "id": sid,
            "sessionId": sid,
            "createdAt": "2026-05-01T00:00:00+00:00",
            "updatedAt": "2026-05-01T00:00:00+00:00",
            "input": {"blob": f"sessions/{sid}/input.png", "contentType": "image/png"},
            "analysis": {"promptMd": f"prompt for {sid}"},
            "generations": [
                {
                    "id": f"gen{(gid := f'{s}{i}')}",
                    "mode": "lookbook" if i % 2 == 0 else "front",
                    "label": f"라벨 {gid}",
                    "blob": f"sessions/{sid}/gen_{gid}.png",
                    "promptHeader": "header...",
                    "usedPrompt": "full prompt...",
                    # Monotonically increasing timestamp so the global "newest-first"
                    # order is the reverse of insertion order across all sessions.
                    "createdAt": f"2026-05-01T00:00:{counter:02d}+00:00",
                }
                for i in range(n_per_session)
            ],
        }
        # capture in insertion order
        for g in fake_state["sessions"][sid]["generations"]:
            created_ids.append(g["id"])
            counter += 1
        # Recompute timestamps so they are globally unique
        for idx, g in enumerate(fake_state["sessions"][sid]["generations"]):
            g["createdAt"] = f"2026-05-01T00:00:{(s * n_per_session + idx):02d}+00:00"
    return created_ids


def test_gallery_list_empty(client: TestClient, fake_state: dict[str, Any]) -> None:
    r = client.get("/api/gallery")
    assert r.status_code == 200
    body = r.json()
    assert body == {"items": [], "limit": 20, "offset": 0, "nextOffset": None}


def test_gallery_list_newest_first_and_paging(client: TestClient, fake_state: dict[str, Any]) -> None:
    ids_in_order = _seed(fake_state, n_per_session=2, n_sessions=3)  # 6 generations
    newest_to_oldest = list(reversed(ids_in_order))

    # Page 1: limit=4 → first 4 newest, nextOffset=4
    r = client.get("/api/gallery", params={"limit": 4, "offset": 0})
    assert r.status_code == 200
    body = r.json()
    assert [it["id"] for it in body["items"]] == newest_to_oldest[:4]
    assert body["nextOffset"] == 4
    assert body["limit"] == 4 and body["offset"] == 0
    # SAS url + session id wiring
    assert body["items"][0]["imageUrl"].startswith("https://")
    assert body["items"][0]["sessionId"].startswith("sess")

    # Page 2: offset=4, limit=4 → remaining 2, nextOffset=null
    r = client.get("/api/gallery", params={"limit": 4, "offset": 4})
    body = r.json()
    assert [it["id"] for it in body["items"]] == newest_to_oldest[4:]
    assert body["nextOffset"] is None


def test_gallery_list_param_validation(client: TestClient) -> None:
    assert client.get("/api/gallery", params={"limit": 0}).status_code == 422
    assert client.get("/api/gallery", params={"limit": 101}).status_code == 422
    assert client.get("/api/gallery", params={"offset": -1}).status_code == 422


def test_gallery_detail_ok(client: TestClient, fake_state: dict[str, Any]) -> None:
    ids = _seed(fake_state, n_per_session=1, n_sessions=2)
    target = ids[0]
    r = client.get(f"/api/gallery/{target}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == target
    assert body["sessionId"] == "sess00"
    assert body["imageUrl"].startswith("https://")
    assert body["inputImageUrl"].startswith("https://")
    assert body["promptMd"] == "prompt for sess00"
    assert body["usedPrompt"] == "full prompt..."


def test_gallery_detail_404(client: TestClient) -> None:
    r = client.get("/api/gallery/nope-nope")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "generation_not_found"
