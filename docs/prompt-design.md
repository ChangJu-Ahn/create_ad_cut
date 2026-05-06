# 프롬프트 설계 원칙

이 리포는 [reference/index.html](../reference/index.html) 의 분석/생성 분리 패턴을 그대로 따릅니다.

## 3-tier 구조

```
┌─────────────────────────────────────────────────────────────┐
│ system prompt  (app/prompts/system.md)        — 잘 안 바뀜  │
│   · 모델 역할, 출력 계약, 금지 사항, 좌표계                   │
├─────────────────────────────────────────────────────────────┤
│ user prompt   (app/prompts/analysis_rules.md) — 매번 동일   │
│   · 9개 카테고리 분석 규칙 + 사람이 추가하는 detail-note     │
├─────────────────────────────────────────────────────────────┤
│ style header  (app/prompts/style_headers.py)  — 모드별 분기  │
│   · gpt-image-2 호출 직전에 Output_Prompt 앞에 prepend       │
└─────────────────────────────────────────────────────────────┘
```

### 1) `system.md` — 절대 안 바뀌는 모델 행동

- 모델이 누구인지(시니어 디자이너 + 프롬프트 작성자)
- 출력 계약: 첫 줄 `# Output_Prompt`, 그 외 본문 없음
- 보존 키워드 강제: "정확히 보존", "임의로 변경하지 말 것"
- 좌표계 고정: 항상 "이미지 기준 왼쪽/오른쪽"

### 2) `analysis_rules.md` — 분석 체크리스트

9개 카테고리로 명시:

1. 형태·실루엣
2. 색상 (등장 순서)
3. 재질·텍스처
4. 마감부
5. 부속 요소
6. 좌우 비대칭
7. 가려진 부위
8. 비상품 요소 제거
9. 보존 키워드 강제

여기에 사람이 작성한 `detail_note` 가 마지막 섹션으로 합성됩니다.

### 3) `style_headers.py` — 모드별 스타일 헤더 + 메타데이터

```python
BuiltInMode = Literal["lookbook", "front", "side", "back"]

# `useReference` : True이면 images.edit 으로 원본 이미지를 앛커로 사용.
# `sceneCompose` : True이면 사람·배경 등 장면을 새로 합성해야 하므로
#                  fidelity를 low로 낮추고 분석 프롬프트를 "외형 참고용" 래퍼로 감싸다.
MODE_META = {
    "lookbook": {"label": "룩북 착용컷", "useReference": True,  "sceneCompose": True,  ...},
    "front":    {"label": "정면 스튜디오", "useReference": True,  "sceneCompose": False, ...},
    "side":     {"label": "측면 스튜디오", "useReference": True,  "sceneCompose": False, ...},
    "back":     {"label": "후면 스튜디오", "useReference": True,  "sceneCompose": False, ...},
}

STYLE_HEADERS = {
    "lookbook": "이 이미지는 반드시 사람이 등장하는 패션 착용컷이다. ...",
    "front":    "1024x1024 정방형, 순백색 #FFFFFF 배경의 단독 정면 ...",
    "side":     "1024x1024 정방형, 순백색 배경의 측면 스튜디오 컷, ...",
    "back":     "1024x1024 정방형, 순백색 배경의 후면 스튜디오 컷, ...",
}
```

새 모드(`flatlay`, `seasonal_outdoor` 등)를 추가하려면 이 두 딝셔너리에 한 줄씩 추가하고 `BuiltInMode` Literal 을 확장하면 됩니다. 사용자가 일회성으로 장면을 만들 때는 IaC 수정 없이 **`mode="custom"` 으로 자유롭게 추가 가능**합니다.

## 프롬프트 결합 로직 (`build_prompt`)

```
final_prompt = build_prompt(style_header, analysis_prompt, use_reference, scene_compose)
```

- `analysis_prompt == ""` (사용자가 "기존 분석 프롬프트 결합"을 끌 때) → 헤더만 사용
- `scene_compose=True` → 분석 프롬프트를 "[착용할 상품의 디테일 참고 — ...사람·포즈·배경을 추가하라]" 래퍼로 감싸 `'단독'/'배경 제거'` 같은 표현이 장면 지시를 덮어쓰지 않도록 유도
- 그 외 (점포컷 등) → 헤더 다음에 분석 프롬프트를 그대로 이어붙임

## 자동 detail crop

`services/aoai_analyze.py` 가 PIL 로 7장의 detail crop 을 만들어 원본과 함께 보냅니다 (좌/우 절반, 상/하 절반, 밑단 띠, 좌/우 띠). 작은 디테일 인식률이 눈에 띄게 좋아집니다.

> 주의: `crop` 이라는 단어는 결과 프롬프트에 노출되지 않도록 system 에서 금지합니다.

## 자주 빠지는 함정 (참조 문서 #pitfalls 와 동일)

1. **좌우 반전** — system 에서 좌표계 고정 + 마지막에 "좌우 반전 금지" 문장 강제
2. **밑단·디테일 누락** — `analysis_rules.md` 에 색상 순서 + 위치 명시 강제
3. **비상품 요소 보존** — 분석 단계에서 "대표 상품 1개만" 고정
4. **과도한 일반화** — 색상 개수/순서/상대 폭까지 적도록 강제
