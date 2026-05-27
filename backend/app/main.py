"""FastAPI application entrypoint for create-ad-cut backend."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routes import analyze, generate, prompt, sessions, style_headers

settings = get_settings()
logging.basicConfig(level=settings.log_level.upper())

app = FastAPI(
    title="create-ad-cut backend",
    version="0.1.0",
    description=(
        "FastAPI backend that turns a single product photo into 4-mode ad shots "
        "using Azure OpenAI gpt-5.x (analysis) + gpt-image-2 (generation)."
    ),
)

# CORS — local dev uses cors_origins; PR previews on SWA staging use
# cors_origin_regex so any per-PR hostname matches without redeploy.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# All app routes are mounted under `/api` so they line up with the SWA Linked
# Backend prefix (which forwards `/api/*` to ACA without stripping).
app.include_router(sessions.router, prefix="/api")
app.include_router(analyze.router, prefix="/api")
app.include_router(prompt.router, prefix="/api")
app.include_router(generate.router, prefix="/api")
app.include_router(style_headers.router, prefix="/api")


@app.get("/api/healthz", tags=["meta"])
def healthz_api() -> dict[str, str]:
    """Application healthz exposed through the SWA proxy and direct."""
    return {"status": "ok"}


@app.get("/api/version", tags=["meta"])
def version() -> dict[str, str]:
    """Returns the running app version — used to verify deployments."""
    return {"version": app.version}


@app.get("/healthz", tags=["meta"], include_in_schema=False)
def healthz_root() -> dict[str, str]:
    """Bare-path healthz for the ACA liveness probe (no `/api` prefix)."""
    return {"status": "ok"}
