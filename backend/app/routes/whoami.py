"""Temporary debug-only endpoint to surface the identity the backend sees."""

from __future__ import annotations

import base64
import json
import os

from azure.identity import DefaultAzureCredential
from fastapi import APIRouter

from app.config import get_settings

router = APIRouter(prefix="/debug", tags=["debug"])


def _decode_jwt_payload(token: str) -> dict:
    try:
        payload_b64 = token.split(".")[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)
        return json.loads(base64.urlsafe_b64decode(payload_b64))
    except Exception as exc:  # noqa: BLE001
        return {"_decode_error": f"{type(exc).__name__}: {exc}"}


@router.get("/whoami")
def whoami() -> dict:
    settings = get_settings()
    env_view = {
        "AZURE_CLIENT_ID": os.environ.get("AZURE_CLIENT_ID"),
        "AZURE_TENANT_ID": os.environ.get("AZURE_TENANT_ID"),
        "MSI_ENDPOINT_set": bool(os.environ.get("MSI_ENDPOINT")),
        "IDENTITY_ENDPOINT_set": bool(os.environ.get("IDENTITY_ENDPOINT")),
        "BLOB_ENDPOINT": settings.blob_account_url,
        "BLOB_CONTAINER_NAME": settings.blob_container_name,
    }

    out: dict = {"env": env_view}

    cred = DefaultAzureCredential()
    try:
        tok = cred.get_token("https://storage.azure.com/.default")
        out["storage_token"] = {
            "ok": True,
            "expires_on": tok.expires_on,
            "claims": _decode_jwt_payload(tok.token),
        }
    except Exception as exc:  # noqa: BLE001
        out["storage_token"] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

    try:
        tok2 = cred.get_token("https://cognitiveservices.azure.com/.default")
        out["aoai_token"] = {
            "ok": True,
            "expires_on": tok2.expires_on,
            "claims": _decode_jwt_payload(tok2.token),
        }
    except Exception as exc:  # noqa: BLE001
        out["aoai_token"] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

    return out
