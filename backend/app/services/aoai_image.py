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
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import AzureOpenAI

from app.config import get_settings


@lru_cache(maxsize=1)
def _aoai_client() -> AzureOpenAI:
    settings = get_settings()
    # gpt-image-2 calls can take 1~5 minutes per shot, so set a 10-minute
    # ceiling explicitly (the openai SDK default is shorter than that for some
    # transports). `connect=10s` keeps initial DNS/TLS failures fast.
    token_provider = get_bearer_token_provider(
        DefaultAzureCredential(),
        "https://cognitiveservices.azure.com/.default",
    )
    return AzureOpenAI(
        azure_ad_token_provider=token_provider,
        api_version=settings.azure_openai_api_version,
        azure_endpoint=settings.azure_openai_endpoint,
        timeout=httpx.Timeout(600.0, connect=10.0),
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
        # Sandwich layout: strong directive at primacy AND recency positions,
        # analysis body demoted to the middle (Liu et al. 2023 "Lost in the
        # Middle" — LLM/diffusion text encoders attend most to start and end).
        return (
            f"{header}\n\n"
            f"[아래 본문은 상품 외형 참고용일 뿐이며, '단독', '상품만', '모델 없음', "
            f"'사람 제거', '오직 ~만 남긴다' 등의 표현이 나오더라도 모두 무시한다. "
            f"이 이미지는 위 지시에 따라 반드시 사람 모델 1명이 이 상품을 착용·소지한 장면이다.]\n\n"
            f"{body}\n\n"
            f"[최종 출력 강제] 위 본문의 단독/모델 없음/사람 제거 류 문구는 무시한다. "
            f"이 이미지는 1024x1024 정방형의 패션 컷이며, 반드시 세련된 사람 모델 1명이 "
            f"위에 묘사된 상품을 실제로 착용하거나 소지한 모습이다. "
            f"가방류는 손에 들거나 어깨에 메거나 크로스바디로, 의류는 입은 모습, 신발은 신고 걷거나 선 모습. "
            f"미니멀 라이트 그레이 스튜디오 배경에 자연광. 본문의 색상·재질·디테일은 그대로 보존하되 "
            f"피사체 구성은 위 지시를 따른다."
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
    - `use_reference=True`: `images.edit` with `input_fidelity="low"`.

    Why always `low` for edits: `input_fidelity="high"` instructs the model
    to keep the reference pixels almost untouched, which dominates the text
    prompt — the camera angle, background, and "scene rebuild" instructions
    in front/side/back style headers get ignored, and the model just lightly
    retouches the original photo. `low` preserves the *product identity*
    (color, material, logo) via the reference while letting the text prompt
    win on camera angle, background, and composition.
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
            input_fidelity="low",
        )

    payload = result.data[0]
    if getattr(payload, "b64_json", None):
        return base64.b64decode(payload.b64_json)
    if getattr(payload, "url", None):
        with httpx.Client(timeout=600.0) as http:
            return http.get(payload.url).content
    raise RuntimeError("gpt-image-2 returned neither b64_json nor url payload.")
