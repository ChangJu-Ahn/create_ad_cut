"""API key authentication dependency."""

from __future__ import annotations

from fastapi import Header, HTTPException, status

from app.config import get_settings


async def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """Validate the `X-API-Key` header against the configured backend key."""
    settings = get_settings()
    if not x_api_key or x_api_key != settings.backend_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "unauthorized", "message": "Invalid or missing X-API-Key."},
        )
