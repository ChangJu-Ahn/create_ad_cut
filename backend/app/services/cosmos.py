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


# ---- Board posts ---------------------------------------------------------
#
# Posts share the `sessions` container to avoid extra infra. Each post doc
# stores its `postId` in both `id` and the `sessionId` partition-key field
# (so reads/writes stay single-partition) and is tagged with `type="post"`
# so list queries can skip session documents.

_POST_TYPE = "post"


def create_board_post(post_id: str, title: str, body: str, author: str | None) -> dict[str, Any]:
    now = now_iso()
    doc = {
        "id": post_id,
        "sessionId": post_id,
        "type": _POST_TYPE,
        "postId": post_id,
        "title": title,
        "body": body,
        "author": author,
        "createdAt": now,
        "updatedAt": now,
    }
    return container().create_item(doc)


def get_board_post(post_id: str) -> dict[str, Any] | None:
    try:
        doc = container().read_item(item=post_id, partition_key=post_id)
    except CosmosResourceNotFoundError:
        return None
    if doc.get("type") != _POST_TYPE:
        return None
    return doc


def list_board_posts(limit: int = 20) -> list[dict[str, Any]]:
    query = (
        "SELECT c.postId, c.title, c.author, c.body, c.createdAt "
        "FROM c WHERE c.type = @type ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit"
    )
    params = [{"name": "@type", "value": _POST_TYPE}, {"name": "@limit", "value": int(limit)}]
    return list(
        container().query_items(
            query=query,
            parameters=params,
            enable_cross_partition_query=True,
        )
    )
