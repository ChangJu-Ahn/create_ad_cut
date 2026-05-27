"""Expose the built-in shot mode metadata (label / default header / fidelity).

The frontend fetches this once on page load so each cut card can render the
default style header in an editable textarea.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth import require_api_key
from app.prompts.style_headers import MODE_META, STYLE_HEADERS
from app.schemas import StyleHeaderInfo

router = APIRouter(tags=["style-headers"], dependencies=[Depends(require_api_key)])


@router.get("/style-headers", response_model=list[StyleHeaderInfo])
def list_style_headers() -> list[StyleHeaderInfo]:
    return [
        StyleHeaderInfo(
            mode=mode,
            label=str(meta["label"]),
            description=str(meta["description"]),
            header=STYLE_HEADERS[mode],
            useReference=bool(meta["useReference"]),
            sceneCompose=bool(meta["sceneCompose"]),
        )
        for mode, meta in MODE_META.items()
    ]


@router.get("/modes")
def list_modes() -> dict[str, list[str]]:
    return {"modes": list(MODE_META.keys())}
