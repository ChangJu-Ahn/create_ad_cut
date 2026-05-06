"""Azure Blob Storage integration: upload + per-blob user-delegation SAS URL.

Auth: AAD via DefaultAzureCredential (works for `az login` locally and
system-assigned managed identity in Container Apps). The storage account
in this project has `allowSharedKeyAccess: false` enforced by Azure Policy,
so SAS URLs must be signed with a user delegation key (not an account key).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from functools import lru_cache

from azure.identity import DefaultAzureCredential
from azure.storage.blob import (
    BlobSasPermissions,
    BlobServiceClient,
    ContentSettings,
    generate_blob_sas,
)

from app.config import get_settings


@lru_cache(maxsize=1)
def _credential() -> DefaultAzureCredential:
    return DefaultAzureCredential()


@lru_cache(maxsize=1)
def _service_client() -> BlobServiceClient:
    settings = get_settings()
    return BlobServiceClient(account_url=settings.blob_account_url, credential=_credential())


def ensure_container() -> None:
    """Create the blob container on first use. Idempotent."""
    settings = get_settings()
    client = _service_client().get_container_client(settings.blob_container_name)
    try:
        client.create_container()
    except Exception:  # noqa: BLE001 — container may already exist; SDK raises ResourceExistsError.
        pass


def upload_bytes(blob_name: str, data: bytes, content_type: str) -> str:
    """Upload `data` to `blob_name` (overwrite) and return its absolute blob path."""
    settings = get_settings()
    blob_client = _service_client().get_blob_client(
        container=settings.blob_container_name, blob=blob_name
    )
    blob_client.upload_blob(
        data,
        overwrite=True,
        content_settings=ContentSettings(content_type=content_type),
    )
    return blob_name


def sas_url(blob_name: str) -> str:
    """Issue a short-lived read-only SAS URL signed with a user delegation key.

    Requires the caller's identity to have at least `Storage Blob Data Reader`
    on the storage account so it can request a delegation key.
    """
    settings = get_settings()
    service = _service_client()
    now = datetime.now(timezone.utc)
    expiry = now + timedelta(minutes=settings.sas_ttl_minutes)

    # User delegation keys are valid for up to 7 days; we keep them short so
    # rotation/revocation is fast. Reusing them across many SAS issuances is
    # fine, but for simplicity we fetch a fresh one each call.
    udk = service.get_user_delegation_key(key_start_time=now, key_expiry_time=expiry)

    sas = generate_blob_sas(
        account_name=service.account_name,
        container_name=settings.blob_container_name,
        blob_name=blob_name,
        user_delegation_key=udk,
        permission=BlobSasPermissions(read=True),
        expiry=expiry,
    )
    return f"{service.url}{settings.blob_container_name}/{blob_name}?{sas}"
