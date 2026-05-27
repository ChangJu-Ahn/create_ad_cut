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
        "description": "흰 배경 단독 정면 컷 (toe-cap head-on)",
        # gpt-image-2 의 `images.edit` 는 input_fidelity='low' 여도 reference image
        # 의 기하학적 시점을 강하게 유지한다. 신발의 0° head-on toe-cap 같이 학습
        # 분포에서 드문 시점은 reference 가 있으면 측면으로 떨어진다. 그래서
        # FRONT 만 text-only `images.generate` 로 보내고 product descriptor 만 으로
        # 정체성을 보존한다.
        "useReference": False,
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
    # ──────────────────────────────────────────────────────────────────
    # Lookbook — fashion editorial 착용컷.
    # Positive spec: 학습 데이터에 풍부한 패션 에디토리얼 어휘로 시나리오를 정의.
    # ──────────────────────────────────────────────────────────────────
    "lookbook": (
        "Fashion editorial lookbook shot. 1024×1024 정방형. "
        "장면 구성: 한 명의 패션 모델이 reference image 의 상품을 자연스럽게 착용·소지한 모습. "
        "[가방류] 모델이 한 손으로 들거나, 어깨에 메거나, 크로스바디로 멘 모습. "
        "[의류] 모델이 입고 자연스럽게 선 모습. "
        "[신발] 모델이 신고 걷거나 선 모습. "
        "구도: 모델의 상반신~무릎 또는 전신이 프레임 안에 보이며 상품이 착용 맥락 안에서 도드라진다. "
        "모델 얼굴은 프레임 밖으로 크롭하거나 시선을 옆으로 돌린다. "
        "조명: 부드러운 자연광 (window-light 분위기), 톤은 뉴트럴. "
        "배경: 미니멀 라이트 그레이 스튜디오 사이클로라마, 데일리한 자연스러운 포즈. "
        "Reference image 의 상품 정체성(형태·색상·재질·로고·비율)은 그대로 보존하며, "
        "아래 product descriptor 는 그 상품의 외형 정의로 사용한다."
    ),
    # ──────────────────────────────────────────────────────────────────
    # Front — studio packshot, 0° front elevation.
    # Positive vocabulary: "studio packshot", "ghost mannequin", "isolated",
    # "seamless white cyc" — diffusion 모델 학습 데이터에 풍부한 표현으로
    # 원하는 분포를 직접 명시 (Saharia+ 2022 Imagen, Ruiz+ 2023 DreamBooth).
    # ──────────────────────────────────────────────────────────────────
    "front": (
        "Studio packshot — strict head-on orthographic front elevation (0°) of one isolated product. "
        "이 컷은 절대 e-commerce 'hero 3/4 shot' 이 아니다. 기술 도면의 정면 입면도(front elevation drawing)의 사진 버전으로 생각하라. "
        "1024×1024 정방형, seamless 순백 #FFFFFF 배경 (white cyc). "
        "카메라: 광축이 상품 정면에 정확히 수직 (yaw=0°, pitch=0°, roll=0°). "
        "카메라 높이는 상품 중심과 같은 높이 — 위에서 내려다보거나(top-down, bird's eye) 아래에서 올려다보지 않는다. "
        "85mm-equivalent 렌즈, telephoto-flat 원근, 좌우 완전 대칭. "
        "피사체: 아래 product descriptor 가 정의하는 상품 1개가 프레임 정중앙에 단독으로 놓여 있다 (frame 높이의 약 70% 차지). "
        "[가방류] 본체의 앞면 패널이 카메라를 정면으로 마주보고 자체적으로 곧게 서 있다. "
        "측면 거싯이나 옆구리가 보이면 안 된다. 핸들/스트랩은 본체 위에 좌우 대칭으로 정돈. "
        "[의류] Ghost mannequin (invisible mannequin) 위에 형태가 잡혀 있고, 어깨선·앞 여밈·로고가 좌우 완전 대칭으로 카메라를 마주본다. "
        "옆 봉제선이나 옆구리 핏이 드러나면 안 된다. "
        "[신발 — 핵심] 카메라가 신발 한 짝의 토캡(앞코)을 정면으로 응시하는 toe-cap-on perspective. "
        "신발은 바닥에 놓여 있고 토코가 카메라를 향한다. 카메라는 바닥에서 약간 높은 신발 중심 높이, 신발 앞코를 정면으로 응시. "
        "보이는 부위: 토박스 앞면 전체, 슈레이스 양쪽 열이 좌우 평행하게 정대칭, 텅(tongue) 정면, 발등 라인, 아웃솔 앞코 끝 모서리만 얇은 수준으로 살짝. "
        "보이지 않는 부위: 신발의 측면 갑피 전체, 사이드 아웃솔 측벽, 힐 컵 전체 (힐은 토캡 뒤로 완전히 가려짐). "
        "한 짝만 단독 배치 (한 켤레 두 짝이 아니라 1짝). "
        "조명: 대형 softbox 정면 key + 양옆 약한 fill, exposure ETTR, 중성 화이트 밸런스. 그림자: 피사체 바로 아래 부드러운 contact shadow 한 줄. "
        "스타일: clean magazine-grade product photography, technical e-commerce front elevation. "
        "⚠️ 재차 확인하자면 — 이 컷은 'product photo from the side'가 아니다. 카메라는 신발 앞코 정면을 보고 있다. 측면이나 3/4 각도가 보이면 출력 실패이다."
    ),
    # ──────────────────────────────────────────────────────────────────
    # Side — studio packshot, 90° profile elevation.
    # ──────────────────────────────────────────────────────────────────
    "side": (
        "Studio packshot — pure profile (90° side elevation) of one isolated product. "
        "1024×1024 정방형, seamless 순백 #FFFFFF 배경 (white cyc). "
        "카메라: 상품을 정면 기준 90° 회전시킨 옆모습, 광축이 상품 측면에 수직. "
        "85mm-equivalent 렌즈, 두께감·옆선·사이드 실루엣이 명확히 드러나는 구도. "
        "피사체: reference image 의 상품 1개가 프레임 정중앙에 단독으로 놓여 있다. "
        "[가방류] 본체의 옆 패널이 카메라를 마주본다. 본체 두께, 사이드 거싯(옆구리), "
        "스트랩이 본체에 붙는 연결부, 옆면 지퍼·포켓 디테일이 명확히 드러난다. 핸들은 위로 정돈. "
        "[의류] Ghost mannequin 위에 형태가 잡혀 있으며 어깨 라인, 소매 곡선, 옆구리 핏, "
        "옆 봉제선이 90° 옆모습으로 드러난다. "
        "[신발] 한 짝이 토캡→힐로 이어지는 사이드 라인 전체를 보여주는 90° 측면으로 놓여 있다. "
        "갑피(어퍼)와 아웃솔, 힐 컵 옆면이 분명히 드러난다. "
        "조명: 대형 softbox 정면 key + 양옆 약한 fill, exposure ETTR, 중성 화이트 밸런스. "
        "그림자: 피사체 바로 아래에 부드러운 contact shadow 한 줄. "
        "스타일: clean magazine-grade product photography. "
        "Reference image 의 상품 정체성을 그대로 보존하며, 아래 product descriptor 는 외형 정의로 사용한다. "
        "카메라 시점은 본 spec 의 90° 옆모습을 따른다."
    ),
    # ──────────────────────────────────────────────────────────────────
    # Back — studio packshot, 180° rear elevation.
    # ──────────────────────────────────────────────────────────────────
    "back": (
        "Studio packshot — rear elevation (180° back view) of one isolated product. "
        "1024×1024 정방형, seamless 순백 #FFFFFF 배경 (white cyc). "
        "카메라: 상품을 정면 기준 180° 회전시킨 뒷모습, 등판/뒷판이 프레임 정중앙에서 카메라를 마주본다. "
        "85mm-equivalent 렌즈, 좌우 대칭, 평면적 정수직 구도. "
        "피사체: reference image 의 상품 1개가 프레임 정중앙에 단독으로 놓여 있다. "
        "[가방류] 몸에 닿는 백패널이 카메라를 마주본다. 뒤 포켓, 브랜드 라벨, "
        "백패널 봉제·마감, 스트랩이 본체에 부착되는 후면부 디테일이 핵심. "
        "[의류] Ghost mannequin 위에 형태가 잡혀 있으며 등판이 카메라를 마주본다. "
        "후면 네크 라벨, 등판 봉제선, 후면 포켓, 뒷 절개선이 드러난다. "
        "[신발] 한 짝의 힐 컵과 백 카운터가 카메라를 마주본다. 힐 로고, 풀탭, 뒤꿈치 마감이 보인다. "
        "조명: 대형 softbox 정면 key + 양옆 약한 fill, exposure ETTR, 중성 화이트 밸런스. "
        "그림자: 피사체 바로 아래에 부드러운 contact shadow 한 줄. "
        "스타일: clean magazine-grade product photography. "
        "Reference image 의 상품 정체성을 그대로 보존하며, 아래 product descriptor 는 외형 정의로 사용한다. "
        "카메라 시점은 본 spec 의 180° 후면을 따른다."
    ),
}


def header_for(mode: BuiltInMode) -> str:
    """Return the style header for `mode`. Raises KeyError on unknown mode."""
    return STYLE_HEADERS[mode]
