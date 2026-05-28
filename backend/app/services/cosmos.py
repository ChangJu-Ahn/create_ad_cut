"""Cosmos DB (NoSQL) singleton + session document helpers.

Auth: AAD via DefaultAzureCredential (works for `az login` locally and
system-assigned managed identity in Container Apps). The Cosmos account
in this project has `disableLocalAuth: true` enforced by Azure Policy.

Modeling notes (per Azure Cosmos DB best practices):
- Partition key `/sessionId` — high cardinality, every read/write is single-partition.
- A single document embeds `input`, `analysis`, `generations[]` because they
  are always fetched together and well below the 2 MB item limit.
"""

from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

from azure.cosmos import ContainerProxy, CosmosClient
from azure.cosmos.exceptions import CosmosResourceNotFoundError
from azure.identity import DefaultAzureCredential

from app.config import get_settings


@lru_cache(maxsize=1)
def _credential() -> DefaultAzureCredential:
    return DefaultAzureCredential()


@lru_cache(maxsize=1)
def _client() -> CosmosClient:
    settings = get_settings()
    return CosmosClient(url=settings.cosmos_endpoint, credential=_credential())


@lru_cache(maxsize=1)
def container() -> ContainerProxy:
    settings = get_settings()
    # NB: with AAD auth + Azure Policy enforcing `disableLocalAuth=true`,
    # `create_database_if_not_exists` requires control-plane RBAC. The
    # database + container are created up-front by Bicep, so we just bind.
    db = _client().get_database_client(settings.cosmos_database_name)
    return db.get_container_client(settings.cosmos_container_name)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_session(session_id: str) -> dict[str, Any] | None:
    try:
        return container().read_item(item=session_id, partition_key=session_id)
    except CosmosResourceNotFoundError:
        return None


def upsert_session(doc: dict[str, Any]) -> dict[str, Any]:
    doc["updatedAt"] = now_iso()
    return container().upsert_item(doc)


def create_session(session_id: str) -> dict[str, Any]:
    now = now_iso()
    doc = {
        "id": session_id,
        "sessionId": session_id,
        "createdAt": now,
        "updatedAt": now,
        "input": None,
        "analysis": None,
        "generations": [],
    }
    return container().create_item(doc)


def list_sessions(limit: int) -> list[dict[str, Any]]:
    """Return recent sessions newest-first, projecting only the gallery fields.

    Cross-partition by design (one session = one partition); we keep `limit`
    small (UI default 50) so RU cost stays bounded.
    """
    query = (
        f"SELECT TOP {int(limit)} c.id, c.sessionId, c.createdAt, c.updatedAt, "
        "c.input, c.analysis.promptMd AS promptMd, c.generations "
        "FROM c ORDER BY c.createdAt DESC"
    )
    return list(
        container().query_items(
            query=query,
            enable_cross_partition_query=True,
        )
    )
