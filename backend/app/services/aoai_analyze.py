"""Azure OpenAI multimodal analysis (gpt-5.4 / gpt-5.5).

Sends the original image plus a small set of automatic detail crops to the
analysis model so subtle details (left/right asymmetry, hem stripes, button
order) are easier to lock down. Returns the raw `Output_Prompt` markdown.
"""

from __future__ import annotations

import base64
import io
from functools import lru_cache
from pathlib import Path

from openai import AzureOpenAI
from PIL import Image

from app.config import get_settings

_PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompts"


@lru_cache(maxsize=1)
def _aoai_client() -> AzureOpenAI:
    settings = get_settings()
    return AzureOpenAI(
        api_key=settings.azure_openai_api_key,
        api_version=settings.azure_openai_api_version,
        azure_endpoint=settings.azure_openai_endpoint,
    )


@lru_cache(maxsize=1)
def _system_prompt() -> str:
    return (_PROMPT_DIR / "system.md").read_text(encoding="utf-8")


@lru_cache(maxsize=1)
def _analysis_rules() -> str:
    return (_PROMPT_DIR / "analysis_rules.md").read_text(encoding="utf-8")


def _to_data_url(image: Image.Image, fmt: str = "PNG") -> str:
    buf = io.BytesIO()
    image.save(buf, format=fmt)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    mime = "image/png" if fmt == "PNG" else f"image/{fmt.lower()}"
    return f"data:{mime};base64,{b64}"


def _detail_crops(image: Image.Image, target: int = 1024) -> list[Image.Image]:
    """Generate a small fixed set of detail crops (~7 images).

    Heuristic crops that have proven useful for clothing/accessory shots:
    left half, right half, top half, bottom half, bottom strip, left strip,
    right strip. Each is upscaled to `target` x `target` square.
    """
    w, h = image.size
    boxes = {
        "left_half": (0, 0, w // 2, h),
        "right_half": (w // 2, 0, w, h),
        "top_half": (0, 0, w, h // 2),
        "bottom_half": (0, h // 2, w, h),
        "bottom_strip": (0, int(h * 0.75), w, h),
        "left_strip": (0, 0, int(w * 0.25), h),
        "right_strip": (int(w * 0.75), 0, w, h),
    }
    crops: list[Image.Image] = []
    for box in boxes.values():
        c = image.crop(box).convert("RGB")
        c = c.resize((target, target), Image.LANCZOS)
        crops.append(c)
    return crops


def _build_user_content(detail_note: str | None) -> list[dict]:
    """Compose the user-message content array (text + image parts)."""
    rules = _analysis_rules()
    note = f"\n\n## 사람 검수 노트\n{detail_note.strip()}\n" if detail_note else ""
    return [{"type": "text", "text": rules + note}]


def analyze_image(image_bytes: bytes, detail_note: str | None = None) -> str:
    """Run multimodal analysis. Returns the raw `Output_Prompt` markdown."""
    settings = get_settings()
    client = _aoai_client()

    full = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    crops = _detail_crops(full)

    image_parts: list[dict] = [
        {"type": "image_url", "image_url": {"url": _to_data_url(full)}},
    ]
    image_parts.extend(
        {"type": "image_url", "image_url": {"url": _to_data_url(c)}} for c in crops
    )

    user_content = _build_user_content(detail_note) + image_parts

    completion = client.chat.completions.create(
        model=settings.azure_openai_analysis_deployment,
        messages=[
            {"role": "system", "content": _system_prompt()},
            {"role": "user", "content": user_content},
        ],
        max_completion_tokens=4096,
    )
    text = completion.choices[0].message.content or ""
    # Strip the legacy "# Output_Prompt" header if the model still emits it.
    text = text.strip()
    if text.startswith("# Output_Prompt"):
        text = text[len("# Output_Prompt"):].strip()
    return text
