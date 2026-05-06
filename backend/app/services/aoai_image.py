"""Azure OpenAI image generation (gpt-image-2) — `images.edit`.

Fidelity is set per mode:
- lookbook uses `low` so the model can freely compose a person wearing the product.
- front/side/back use `high` to preserve exact product details in isolation.
"""

from __future__ import annotations

import base64
import io
from functools import lru_cache

import httpx
from openai import AzureOpenAI

from app.config import get_settings


@lru_cache(maxsize=1)
def _aoai_client() -> AzureOpenAI:
    settings = get_settings()
    return AzureOpenAI(
        api_key=settings.azure_openai_api_key,
        api_version=settings.azure_openai_api_version,
        azure_endpoint=settings.azure_openai_endpoint,
    )


def build_prompt(
    style_header: str,
    analysis_prompt: str,
    use_reference: bool,
    scene_compose: bool,
) -> str:
    """Combine the (possibly user-edited) style header with the analysis prompt.

    When `scene_compose=True` the model has to invent the surrounding scene
    (e.g. lookbook, custom 장면 합성), so the analysis prompt is reframed as
    a *product reference* inside a scene-composition instruction. This
    prevents wording like "단독으로 표현" from overriding the scene directive.

    If the caller passes an empty `analysis_prompt`, the style header is used
    on its own.
    """
    header = style_header.strip()
    body = analysis_prompt.strip()
    if not body:
        return header
    if scene_compose:
        return (
            f"{header}\n\n"
            f"[착용할 상품의 디테일 참고 — 아래 설명은 상품 외형만 기술한 것이며, "
            f"'단독', '배경 제거', '상품만' 등의 표현이 있더라도 무시하고, "
            f"이 이미지에서는 반드시 위 지시에 따라 사람·포즈·배경을 추가하고 "
            f"모델이 이 상품을 들거나 메거나 입고 있는 장면을 촬영한다. "
            f"레퍼런스 이미지의 원래 배경·구도는 그대로 보존하지 말 것.]\n\n"
            f"{body}"
        )
    return f"{header}\n\n{body}"


def render_image(
    output_prompt_md: str,
    reference_image_bytes: bytes,
    style_header: str,
    use_reference: bool,
    scene_compose: bool,
    reference_filename: str = "input.png",
    reference_content_type: str = "image/png",
) -> bytes:
    """Generate a single 1024x1024 image and return PNG bytes.

    - `use_reference=False`: text-to-image via `images.generate`.
    - `use_reference=True`: `images.edit`. Fidelity is `low` when
      `scene_compose=True` (model must redraw scene around the product) and
      `high` otherwise (front/side/back — preserve product pixels).
    """
    settings = get_settings()
    client = _aoai_client()

    final_prompt = build_prompt(style_header, output_prompt_md, use_reference, scene_compose)

    if not use_reference:
        result = client.images.generate(
            model=settings.azure_openai_image_deployment,
            prompt=final_prompt,
            size="1024x1024",
            n=1,
        )
    else:
        image_tuple = (reference_filename, io.BytesIO(reference_image_bytes), reference_content_type)
        result = client.images.edit(
            model=settings.azure_openai_image_deployment,
            image=image_tuple,
            prompt=final_prompt,
            size="1024x1024",
            input_fidelity="low" if scene_compose else "high",
        )

    payload = result.data[0]
    if getattr(payload, "b64_json", None):
        return base64.b64decode(payload.b64_json)
    if getattr(payload, "url", None):
        with httpx.Client(timeout=60.0) as http:
            return http.get(payload.url).content
    raise RuntimeError("gpt-image-2 returned neither b64_json nor url payload.")
