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
    """Combine the (possibly user-edited) style header with the product descriptor.

    Design notes (positive-spec, research-aligned):
    - The header (primacy) defines the *scene*: camera, lighting, background,
      composition, and whether a model is present.
    - The body (middle) is a *product descriptor* — objective form/color/material/
      finish/parts of the product itself. By contract from system.md/analysis_rules.md
      it does not contain verbs like "모델이 들고" / "착용한 채로", so we no longer
      need negative directives to suppress them.
    - The closer (recency) restates the scene as a positive directive, anchored to
      the reference image's product identity (Ruiz+ 2023 DreamBooth-style anchoring).
    - Liu+ 2023 ("Lost in the Middle"): text encoders attend most to start/end —
      hence the sandwich. The middle carries identity, the ends carry scene.
    """
    header = style_header.strip()
    body = analysis_prompt.strip()
    if not body:
        return header
    if scene_compose:
        # Lookbook / scene-composed custom: a model wears or carries the product.
        return (
            f"{header}\n\n"
            f"[Product descriptor — 아래는 reference image 속 상품의 외형 정의이다.\n"
            f"형태·색상·재질·로고·디테일 정보를 제공하며 장면 구성과는 별개이다.]\n\n"
            f"{body}\n\n"
            f"[최종 구성] 위 descriptor 가 정의한 상품을 한 명의 패션 모델이 자연스럽게 착용·소지한 "
            f"1024×1024 정방형 fashion editorial 컷. 미니멀 라이트 그레이 스튜디오, 부드러운 자연광. "
            f"모델 얼굴은 프레임 밖 또는 시선 회피. 데일리한 자연스러운 포즈. "
            f"상품 정체성(형태·색상·재질·로고·비율)은 descriptor 와 reference image 그대로 보존한다."
        )
    # Product-only studio packshot (front / side / back / custom-without-compose).
    return (
        f"{header}\n\n"
        f"[Product descriptor — 아래는 reference image 속 상품의 외형 정의이다.\n"
        f"형태·색상·재질·로고·디테일 정보를 제공하며 카메라 시점은 위 header 가 결정한다.]\n\n"
        f"{body}\n\n"
        f"[최종 구성] 위 descriptor 가 정의한 상품 1개의 단독 studio packshot. "
        f"1024×1024 정방형, seamless 순백 #FFFFFF 배경. "
        f"카메라 시점은 header 의 spec(0° 정면 / 90° 측면 / 180° 후면)을 따른다. "
        f"피사체는 프레임 정중앙에 단독으로 놓인 상품 자체. 매거진 등급 e-commerce hero shot. "
        f"상품 정체성(형태·색상·재질·로고·비율)은 descriptor 와 reference image 그대로 보존한다."
    )


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
