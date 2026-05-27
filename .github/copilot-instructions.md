# 개발 기본 지침

코딩 작업 시 따라야 할 기본 행동 지침입니다.

**Tradeoff:** 이 지침은 속도보다 신중함을 우선합니다. 사소한 작업에서는 판단에 따라 유연하게 적용하세요.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Agentic DevOps Rules

**이 리포는 사람과 코딩 에이전트가 같은 main 을 공유하는 Agentic DevOps 데모입니다. 아래 규칙은 협업 안전을 위한 필수 가드레일입니다.**

### Branch & PR

- **모든 변경은 PR 로만**. `main` 에 직접 푸시하지 마세요.
- 작업 브랜치 이름: `agent/<short-slug>` (예: `agent/add-retry-on-aoai`)
- 한 PR = 한 가지 변경. 청소·리팩토링·기능을 한 PR 에 섞지 마세요.

### Before committing

다음 명령이 통과해야 커밋합니다:

```bash
cd backend && pytest && ruff check .
cd frontend && npm run typecheck
```

테스트가 깨지면 코드를 고치거나 테스트를 같이 수정하세요 — 테스트를 우회(`-k`, `xfail`)하지 마세요.

### Restricted paths (CODEOWNERS enforced)

다음 경로는 사람 리뷰 없이 머지 불가:

- `.github/workflows/**` — CI/CD 파이프라인
- `infra/**` — Bicep / azd 인프라
- `.github/copilot-instructions.md` — 이 파일

위 경로를 수정해야 하면 **PR 본문 첫 줄에 `⚠️ Restricted path change` 표기** + 변경 이유 명시.

### Secrets — never in code

- API 키, 토큰, 커넥션 스트링, GUID 시크릿을 **소스 / 주석 / `.env` 예시 / 로그** 에 넣지 마세요.
- 새 시크릿이 필요하면 PR 본문에 "New secret required: `<name>`" 만 적고, 값은 owner 가 GitHub Secrets 에 직접 추가.
- AOAI / Storage / Cosmos 는 `DefaultAzureCredential` 만 사용 — 키 기반 인증 코드 추가 금지.

### External dependencies

- 새 npm / pip 의존성을 추가하면 PR 본문에 **이름·버전·라이선스·도입 이유** 4줄 명시.
- 라이선스가 MIT/Apache-2.0/BSD 외이면 머지 보류하고 owner 확인 요청.

### Preview before merge

- PR 이 열리면 `deploy-pr-preview` 가 backend revision (`pr-<N>`) 을, SWA 가 frontend staging 을 만듭니다.
- 작업 완료 시 PR 댓글에 게시된 **preview URL 로 실제 동작을 확인**한 뒤 reviewer 에게 알리세요.
