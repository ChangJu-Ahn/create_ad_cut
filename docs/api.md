# API 명세 (Backend)

모든 비-`healthz` 엔드포인트는 `X-API-Key: <BACKEND_API_KEY>` 헤더가 필요하며,
모든 경로는 `/api` 접두사 아래에 있습니다.

> 베이스 URL
> - 로컬: `http://localhost:8000` → 호출은 `/api/...`
> - 운영: `https://<swa-hostname>` (SWA Linked Backend 가 `/api/*` 를 ACA 로 프록시; 접두사 stripping 없음)

## 1. POST `/api/sessions`

새 세션을 생성합니다.

```bash
curl -X POST $BASE/api/sessions \
  -H "X-API-Key: $API_KEY"
```

**201**

```json
{ "sessionId": "f3a1c8d2...", "createdAt": "2026-05-01T10:00:00+00:00" }
```

---

## 2. POST `/api/sessions/{id}/analyze`

이미지를 업로드하고 분석합니다.

- `multipart/form-data`
- 필드: `image` (PNG/JPEG/WEBP, ≤10MB), `detail_note` (선택, 사람이 미리 적어두는 보정 노트)

```bash
curl -X POST $BASE/api/sessions/$SID/analyze \
  -H "X-API-Key: $API_KEY" \
  -F "image=@./input.png;type=image/png" \
  -F "detail_note=이미지 기준 왼쪽 소매에 하늘색+검정 띠가 있다."
```

**200**

```json
{
  "sessionId": "f3a1c8d2...",
  "inputImageUrl": "https://<acct>.blob.core.windows.net/studio/sessions/.../input.png?sig=...",
  "promptMd": "# Output_Prompt\n...",
  "model": "gpt-5.4",
  "analyzedAt": "2026-05-01T10:00:25+00:00"
}
```

오류:
- `415` 지원되지 않는 미디어 타입
- `413` 10MB 초과

---

## 3. PATCH `/api/sessions/{id}/prompt`

검수된 `Output_Prompt` 로 갱신합니다.

```bash
curl -X PATCH $BASE/api/sessions/$SID/prompt \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"promptMd":"# Output_Prompt\n사람이 검수한 본문..."}'
```

**200**

```json
{ "sessionId": "f3a1c8d2...", "promptMd": "# Output_Prompt\n...", "updatedAt": "..." }
```

오류:
- `409` `analysis_missing` — analyze 가 먼저 실행되어야 함

---

## 4. POST `/api/sessions/{id}/generate`

선택한 컷을 병렬로 생성합니다 (단일 컷 평균 30~60초). 호출할 때마다 결과가
`session.generations`에 **누적**되므로, 같은 모드를 새 프롬프트로 재호출하면
이전 버전과 비교할 수 있는 새 이미지가 추가됩니다.

요청 본문:
- `items[]` — 1~8개. 각 item:
  - `mode`: `lookbook` | `front` | `side` | `back` | `custom`
  - `label` (선택, custom은 필수): 표시용 이름
  - `promptHeader` (선택, custom은 필수): 사용자 수정 스타일 헤더. 빌트인 모드에서는 생략하면 기본 헤더가 사용됨
  - `useReference` (선택): true면 `images.edit`(원본 앵커), false면 `images.generate`(텍스트 프롬프트만). 생략 시 모드별 기본값(`lookbook=false`, 그 외 `true`)

```bash
curl -X POST $BASE/api/sessions/$SID/generate \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      { "mode": "lookbook" },
      { "mode": "front" },
      { "mode": "side" },
      { "mode": "back" },
      {
        "mode": "custom",
        "label": "남자 모델 룩북",
        "promptHeader": "1024x1024 정방형, 30대 남성 모델이 도시 야외에서 자연광으로 상품을 자연스럽게 착용한 데일리 컷.",
        "useReference": false
      }
    ]
  }'
```

**200**

```json
{
  "sessionId": "f3a1c8d2...",
  "results": [
    {
      "id": "9a4b7c1e2f30",
      "mode": "lookbook",
      "label": "룩북 착용컷",
      "imageUrl": "https://...?sig=...",
      "promptHeader": "이 이미지는 반드시 사람이 등장하는...",
      "usedPrompt": "이 이미지는 반드시 ...\n\n[착용할 상품의 디테일 참고...]\n\n...",
      "createdAt": "..."
    }
  ]
}
```

오류:
- `409` `prerequisites_missing` — analyze 가 먼저 실행되어야 함
- `400` `custom_prompt_required` / `custom_label_required` — `mode=custom`인데 promptHeader 또는 label 누락

---

## 4-1. GET `/api/style-headers`

빌트인 모드 4종의 라벨/설명/기본 스타일 헤더/기본 useReference 값을 반환합니다.
프론트엔드 생성 페이지가 컷별 프롬프트를 사용자에게 노출/편집하기 위해 사용합니다.

```bash
curl $BASE/api/style-headers -H "X-API-Key: $API_KEY"
```

**200**

```json
[
  {
    "mode": "lookbook",
    "label": "룩북 착용컷",
    "description": "모델이 착용/소지한 실사 사진",
    "header": "이 이미지는 반드시 사람이 등장하는...",
    "useReference": false
  }
]
```

---

## 5. GET `/api/sessions/{id}`

세션 전체 상태를 반환합니다. 모든 SAS URL 은 호출 시점 기준으로 새로 발급됩니다.

```bash
curl $BASE/api/sessions/$SID -H "X-API-Key: $API_KEY"
```

**200**

```json
{
  "sessionId": "f3a1c8d2...",
  "createdAt": "...",
  "updatedAt": "...",
  "inputImageUrl": "https://...?sig=...",
  "promptMd": "# Output_Prompt\n...",
  "generations": [
    {
      "id": "9a4b7c1e2f30",
      "mode": "lookbook",
      "label": "룩북 착용컷",
      "imageUrl": "https://...?sig=...",
      "promptHeader": "이 이미지는 반드시 사람이 등장하는...",
      "usedPrompt": "...",
      "createdAt": "..."
    }
  ]
}
```

---

## 6. Health endpoints

- `GET /api/healthz` — application healthz (외부 호출 + SWA proxy)
- `GET /healthz` — bare-path healthz, ACA liveness probe 전용 (auth 불필요)

```bash
curl $BASE/api/healthz
```

**200**

```json
{ "status": "ok" }
```

---

## 오류 형식

모든 4xx/5xx 응답은 다음 형식을 따릅니다.

```json
{ "detail": { "code": "session_not_found", "message": "Session ... not found." } }
```
