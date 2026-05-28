"""Shared pytest fixtures.

Sets all required environment variables BEFORE the app is imported so
`pydantic-settings` validation passes without a real `.env` file. Also
patches the external service clients with in-memory fakes.
"""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import MagicMock

import pytest

# --- Env vars required by app.config.Settings -------------------------------
os.environ.setdefault("AZURE_OPENAI_ENDPOINT", "https://example.openai.azure.com/")
os.environ.setdefault("AZURE_OPENAI_API_KEY", "test-aoai-key")
os.environ.setdefault("AZURE_OPENAI_API_VERSION", "2025-04-01-preview")
os.environ.setdefault("AZURE_OPENAI_ANALYSIS_DEPLOYMENT", "gpt-5.5")
os.environ.setdefault("AZURE_OPENAI_IMAGE_DEPLOYMENT", "gpt-image-2")
os.environ.setdefault("AZURE_STORAGE_ACCOUNT_NAME", "teststorage")
os.environ.setdefault("BLOB_CONTAINER_NAME", "studio")
os.environ.setdefault("SAS_TTL_MINUTES", "15")
os.environ.setdefault("COSMOS_ENDPOINT", "https://test.documents.azure.com:443/")
os.environ.setdefault("COSMOS_DATABASE_NAME", "studio")
os.environ.setdefault("COSMOS_CONTAINER_NAME", "sessions")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:5173")


# --- In-memory fakes --------------------------------------------------------
@pytest.fixture
def fake_state() -> dict[str, Any]:
    """Shared state across cosmos / blob / aoai fakes inside a single test."""
    return {"sessions": {}, "blobs": {}}


@pytest.fixture(autouse=True)
def patch_externals(monkeypatch: pytest.MonkeyPatch, fake_state: dict[str, Any]) -> None:
    from app.services import aoai_analyze, aoai_image, blob, cosmos

    # ---- cosmos ----
    def _create_session(session_id: str) -> dict[str, Any]:
        # Each session gets a strictly-increasing createdAt so ordering
        # tests (e.g. gallery latest-first) are deterministic.
        seq = fake_state.setdefault("session_seq", 0) + 1
        fake_state["session_seq"] = seq
        now = f"2026-05-01T00:00:{seq:02d}+00:00"
        doc = {
            "id": session_id,
            "sessionId": session_id,
            "createdAt": now,
            "updatedAt": now,
            "input": None,
            "analysis": None,
            "generations": [],
        }
        fake_state["sessions"][session_id] = doc
        return doc

    def _get_session(session_id: str) -> dict[str, Any] | None:
        return fake_state["sessions"].get(session_id)

    def _upsert_session(doc: dict[str, Any]) -> dict[str, Any]:
        doc["updatedAt"] = "2026-05-01T00:00:01+00:00"
        fake_state["sessions"][doc["sessionId"]] = doc
        return doc

    monkeypatch.setattr(cosmos, "create_session", _create_session)
    monkeypatch.setattr(cosmos, "get_session", _get_session)
    monkeypatch.setattr(cosmos, "upsert_session", _upsert_session)
    monkeypatch.setattr(cosmos, "now_iso", lambda: "2026-05-01T00:00:02+00:00")

    def _list_sessions(limit: int, offset: int) -> list[dict[str, Any]]:
        all_docs = sorted(
            fake_state["sessions"].values(),
            key=lambda d: d.get("createdAt", ""),
            reverse=True,
        )
        return all_docs[offset : offset + limit]

    monkeypatch.setattr(cosmos, "list_sessions", _list_sessions)

    # ---- blob ----
    def _ensure_container() -> None:
        return None

    def _upload_bytes(blob_name: str, data: bytes, content_type: str) -> str:
        fake_state["blobs"][blob_name] = (data, content_type)
        return blob_name

    def _sas_url(blob_name: str) -> str:
        return f"https://example.blob.core.windows.net/studio/{blob_name}?sig=fake"

    monkeypatch.setattr(blob, "ensure_container", _ensure_container)
    monkeypatch.setattr(blob, "upload_bytes", _upload_bytes)
    monkeypatch.setattr(blob, "sas_url", _sas_url)

    # Replace the internal service-client accessor used by generate._download_blob
    fake_blob_client = MagicMock()
    fake_blob_client.download_blob.return_value.readall.return_value = b"reference-bytes"
    fake_service = MagicMock()
    fake_service.get_blob_client.return_value = fake_blob_client
    monkeypatch.setattr(blob, "_service_client", lambda: fake_service)

    # ---- AOAI ----
    monkeypatch.setattr(
        aoai_analyze,
        "analyze_image",
        lambda image_bytes, detail_note=None: "샘플 분석 결과입니다.",
    )
    monkeypatch.setattr(
        aoai_image,
        "render_image",
        lambda prompt_md, ref_bytes, style_header, use_reference, scene_compose, ref_filename="input.png", ref_content_type="image/png": (
            f"PNG-bytes:{style_header[:24]}".encode()
        ),
    )
