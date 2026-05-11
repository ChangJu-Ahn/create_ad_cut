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
        "1024x1024 정방형, 순백색 #FFFFFF 배경의 정면 스튜디오 컷. "
        "카메라 시점: 정확히 0도 정면, 상품의 정면이 정중앙에서 카메라를 마주본다. "
        "원근 왜곡 최소, 좌우 완전 대칭, 평면적이고 정수직 구도. "
        "[가방류] 핸들·스트랩이 자연스럽게 위로 정돈된 상태에서 본체 정면이 카메라를 마주본다. "
        "측면 두께는 살짝만 노출되어 부피감만 암시한다. "
        "[의류] 인비저블 마네킹 또는 펼친 평면 정면, 좌우 대칭. "
        "[신발] 토캡(앞코)이 카메라 정면을 향한 정면 컷, 발등 라인이 완전히 보인다. "
        "부드러운 자연광과 옅은 floor shadow. 모델·손·소품·텍스트·로고 워터마크 없음. "
        "[중요] 아래 상품 설명에 측면/후면/모델이 들고 있는 모습 등이 묘사되어 있더라도 "
        "그 시점은 모두 무시하고, 반드시 위에 명시한 0도 정면 시점으로만 상품을 다시 촬영한 듯한 결과를 생성한다."
    ),
    "side": (
        "1024x1024 정방형, 순백색 #FFFFFF 배경의 90도 측면 스튜디오 컷. "
        "카메라 시점: 정확히 90도 옆모습 (정면도 후면도 아닌, 상품을 90도 회전한 순수 측면). "
        "두께감·옆선·사이드 실루엣이 명확히 드러나는 '얼짱각' 구도. "
        "[가방류] 본체의 옆 패널이 카메라를 마주본다. 본체 두께, 사이드 거싯(옆구리), "
        "스트랩이 본체에 붙는 연결부, 옆면 지퍼나 포켓 디테일이 명확히 보인다. 핸들은 위로 자연스럽게. "
        "[의류] 사이드 실루엣 — 어깨 라인, 소매 곡선, 옆구리 핏, 옆 봉제선이 드러나는 90도 옆모습. "
        "[신발] 토캡→힐로 이어지는 사이드 라인 전체가 옆에서 보이는 90도 측면. "
        "갑피(어퍼)와 아웃솔, 힐 컵 옆면이 분명히 드러난다. "
        "부드러운 자연광과 옅은 floor shadow. 모델·손·소품·텍스트·로고 워터마크 없음. "
        "[중요] 아래 상품 설명이 정면 각도나 후면 각도를 묘사하더라도 그 시점은 모두 무시하고, "
        "반드시 90도 회전된 측면 시점으로 상품을 다시 촬영한 듯한 결과를 생성한다."
    ),
    "back": (
        "1024x1024 정방형, 순백색 #FFFFFF 배경의 180도 후면 스튜디오 컷. "
        "카메라 시점: 정확히 180도 회전된 뒷모습 (상품의 등판/뒷판이 정중앙에서 카메라를 마주본다). "
        "정면이나 측면이 아니라 분명히 '뒤에서 본' 시점. "
        "[가방류] 몸에 닿는 백패널이 카메라를 마주본다. 뒤 포켓, 브랜드 라벨, "
        "백패널 봉제·마감, 스트랩이 본체에 부착되는 후면부 디테일이 핵심. "
        "[의류] 등판이 카메라를 마주본다. 후면 네크 라벨, 등판 봉제선, 후면 포켓, 뒷 디테일, 뒷 절개선이 드러난다. "
        "[신발] 힐 컵과 백 카운터가 카메라를 마주본다. 힐 로고, 풀탭, 뒤꿈치 마감이 분명히 보인다. "
        "부드러운 자연광과 옅은 floor shadow. 모델·손·소품·텍스트·로고 워터마크 없음. "
        "[중요] 아래 상품 설명이 정면 각도나 측면 각도를 묘사하더라도 그 시점은 모두 무시하고, "
        "반드시 180도 회전된 후면 시점으로 상품을 다시 촬영한 듯한 결과를 생성한다. "
        "원본 이미지가 정면이라면 머릿속으로 180도 돌려서 등판을 그린다."
    ),
}


def header_for(mode: BuiltInMode) -> str:
    """Return the style header for `mode`. Raises KeyError on unknown mode."""
    return STYLE_HEADERS[mode]
