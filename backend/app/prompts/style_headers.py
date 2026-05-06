"""Per-mode style headers for `gpt-image-2`.

Each header is prepended to the human-reviewed `Output_Prompt` before the
final image generation call. The wording mirrors the matrix described in
the original Korean design guide at
https://ms.studydev.com/azure/ecommerce_product_studio/ so behaviour stays
consistent with the design doc.
"""

from __future__ import annotations

from typing import Literal

# Built-in shot modes plus `custom` for user-defined cuts.
ShotMode = Literal["lookbook", "front", "side", "back", "custom"]

# Built-in modes that get a default style header. `custom` is intentionally
# excluded — sellers always supply their own `promptHeader` for custom cuts.
BuiltInMode = Literal["lookbook", "front", "side", "back"]


# UI-facing metadata: label / description / whether the input image should
# anchor generation by default. Kept here so the frontend can fetch it once
# via `GET /api/style-headers` and let users edit each header before submit.
# `sceneCompose=True`이면 모델이 사람·배경·포즈 등 새로운 장면을 합성해야 하므로
# fidelity를 낮추고 분석 프롬프트를 "외형 참고용" 래퍼로 감싼다. 룩북·일부 커스텀이 해당.
MODE_META: dict[BuiltInMode, dict[str, object]] = {
    "lookbook": {
        "label": "룩북 착용컷",
        "description": "모델이 착용/소지한 실사 사진",
        # 룩북도 원본 이미지를 레퍼런스로 사용해야 상품 외형이 흔들리지 않음.
        "useReference": True,
        "sceneCompose": True,
    },
    "front": {
        "label": "정면 스튜디오",
        "description": "흰 배경 단독 정면 컷",
        "useReference": True,
        "sceneCompose": False,
    },
    "side": {
        "label": "측면 스튜디오",
        "description": "옆선·두께감 강조 컷",
        "useReference": True,
        "sceneCompose": False,
    },
    "back": {
        "label": "후면 스튜디오",
        "description": "등판·라벨 디테일 컷",
        "useReference": True,
        "sceneCompose": False,
    },
}


STYLE_HEADERS: dict[BuiltInMode, str] = {
    "lookbook": (
        "이 이미지는 반드시 사람이 등장하는 패션 착용컷이다. "
        "아래 상품 설명에 '단독', '1개만', '모델 없음' 등이 있더라도 무시하고, "
        "반드시 세련된 남성 또는 여성 모델 1명이 해당 상품을 실제로 착용하거나 소지한 장면을 생성한다. "
        "가방류: 모델이 한 손으로 들거나, 어깨에 메거나, 크로스바디로 착용한 모습. "
        "의류: 모델이 입고 있는 모습. 신발: 모델이 신고 걷는 모습. "
        "구도: 1024x1024 정방형. 모델의 상반신~무릎 또는 전신이 보이며, "
        "상품은 모델 착용 맥락 안에서 자연스럽게 노출된다. "
        "모델 얼굴은 프레임 밖으로 크롭하거나 시선을 돌린다. "
        "배경: 미니멀 라이트 그레이 스튜디오, 자연광, 자연스러운 데일리 포즈. "
        "아래 상품 설명은 상품의 디테일 참고용으로만 사용하고, 구도·피사체 구성은 위 지시를 따른다."
    ),
    "front": (
        "1024x1024 정방형, 순백색 #FFFFFF 배경의 단독 정면 스튜디오 컷, "
        "상품만 노출, 부드러운 그림자, 평면적이고 왜곡 없는 정중앙 정렬, "
        "모델·소품 없음."
    ),
    "side": (
        "1024x1024 정방형, 순백색 배경의 측면 스튜디오 컷, "
        "상품을 90도 옆에서 본 '얼짱각' 측면, "
        "두께감과 옆선 라인이 잘 드러나는 구도, 모델·소품 없음."
    ),
    "back": (
        "1024x1024 정방형, 순백색 배경의 후면 스튜디오 컷, "
        "상품의 뒷판이 정확히 정중앙에 보이도록 회전, "
        "라벨/뒷주머니/등판 디테일이 선명하게 드러나는 구도, 모델·소품 없음."
    ),
}


def header_for(mode: BuiltInMode) -> str:
    """Return the style header for `mode`. Raises KeyError on unknown mode."""
    return STYLE_HEADERS[mode]
