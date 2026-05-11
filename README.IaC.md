# Azure IaC, 이 데모로 한눈에

> 이 문서는 `create-ad-cut` 데모 한 개로 **Azure가 IaC 측면에서 얼마나 강한지**를 설명합니다.
> "Azure는 포털에서 클릭하는 클라우드"라는 흔한 오해를 풀고, 이미 Terraform / GitHub Actions / Kubernetes
> 같은 도구에 익숙한 팀이 **추가 학습 비용 거의 없이** Azure로 이식할 수 있음을 코드 한 줄까지 함께 보여드립니다.
>
> 데모 자체의 사용법은 메인 [`README.md`](./README.md) 를, 운영/CI 가이드는
> [`docs/deployment.md`](./docs/deployment.md) 를 참고하세요.

---

## 0. 한 줄 요약

```bash
git clone <fork-url>
cd create-ad-cut
azd auth login && az login
azd env new dev
azd env set AZURE_LOCATION eastus2
azd up
```

이 다섯 줄로 만들어지는 것:

- User-assigned Managed Identity (UAMI)
- Log Analytics Workspace
- Container Apps Environment + Container App (FastAPI 백엔드)
- Container Registry
- Storage Account + private blob container
- Cosmos DB (NoSQL) account / database / container
- **Azure OpenAI account + 2개 모델 deployment** (`gpt-5.4`, `gpt-image-2`)
- Static Web App + ACA Linked Backend (EasyAuth 자동 활성)
- 위 5개 리소스에 대한 **AAD RBAC 4종이 UAMI 에 자동 부여**
  - ACR `AcrPull` / Storage `Storage Blob Data Contributor` / Cosmos `Cosmos DB Built-in Data Contributor` / AOAI `Cognitive Services OpenAI User`
- ACA secret 으로 들어가는 결정적(deterministic) `BACKEND_API_KEY`

**API 키 복사·붙여넣기·환경변수 손수 채우기 0회.** 모든 데이터 플레인 호출은 UAMI 의 AAD 토큰으로 이루어집니다.

---

## 1. "Azure = 포털"이 더 이상 맞지 않는 이유

| 오해 | 실제 |
|---|---|
| Azure는 포털에서만 만든다 | 포털은 *읽기/디버깅 UI*. 운영은 100% IaC 가능. |
| Bicep 은 Azure 전용이라 락인이 심하다 | Bicep 은 ARM JSON 의 얇은 DSL. 동일한 리소스를 **Terraform AzureRM provider** 로도 동일하게 표현 가능. (§5 비교 참고) |
| Azure 는 멀티 클라우드 도구와 잘 안 맞는다 | Terraform / Pulumi / Crossplane / Helm / Argo CD 모두 1급 지원. GitHub Actions / GitLab CI / Jenkins 도 OIDC 페더레이션으로 키 없이 인증. |
| 매니지드 ID 는 Azure 만의 트릭이다 | OIDC 워크로드 페더레이션으로 GitHub Actions, AKS, EKS, GKE 의 워크로드까지 **키 없이** Azure 리소스에 접근 가능. |

이 데모가 그걸 직접 보여줍니다 — 정확히 같은 토폴로지를 §5에서 Terraform 으로 리라이트한 예시까지 같이 둡니다.

---

## 2. 이 데모의 IaC 레이어 구조

```
┌──────────────────────────────────────────────────────────────────────┐
│  azure.yaml          (azd 매니페스트: services + hooks)               │
│  ├─ services.backend  → host=containerapp, project=./backend         │
│  └─ services.frontend → host=staticwebapp, dist=./dist               │
└──────────────────────────────────────────────────────────────────────┘
                             │  azd 가 호출
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│  infra/main.bicep         (resourceGroup scope, "조립도")            │
│  ├─ 1. uami                                                          │
│  ├─ 2. log / acr / storage / cosmos / openai                         │
│  ├─ 3. roleAssignments(UAMI ← 4 roles)                               │
│  ├─ 4. caenv → backend(ACA, dependsOn:[acrPull,aoaiUser])            │
│  └─ 5. swa(linkedBackend → backend)                                  │
└──────────────────────────────────────────────────────────────────────┘
                             │  ARM API 호출
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│  infra/modules/*.bicep    (각 리소스의 "부품")                        │
│  uami / loganalytics / containerregistry / storage / cosmos /        │
│  openai / containerappenv / containerapp / staticwebapp              │
└──────────────────────────────────────────────────────────────────────┘
```

**왜 이런 구조인가:**

- `azure.yaml` = "**무엇을** 배포할지" — 서비스 정의 + 빌드/푸시/배포 hook
- `infra/main.bicep` = "**어디에** 배포할지" — 리소스 그룹 안에 들어갈 모든 인프라
- `infra/modules/*.bicep` = "**어떻게**" — 각 리소스의 spec, 재사용/테스트 가능한 단위

이 분리는 Terraform 의 `main.tf` ↔ `modules/` 와 정확히 같은 패턴입니다. 다만 azd 는 **빌드/푸시/배포까지** 한 명령에 묶어줍니다.

---

## 3. `azd` 가 한 번에 해주는 일

`azd up` 한 줄이 실제로 하는 일을 단계별로 풀면:

| 단계 | 도구 | 무엇을 |
|---|---|---|
| 1. provision | Bicep → ARM | `infra/main.bicep` 을 컴파일해 ARM 에 제출. 50+ 리소스가 의존성 그래프대로 만들어짐 |
| 2. RBAC propagation | ARM | UAMI 의 4개 role assignment 가 먼저 끝난 뒤에야 ACA 가 생성됨 (Bicep `dependsOn`) |
| 3. build | ACR Tasks | `backend/Dockerfile` 을 **클라우드에서** 빌드 (로컬 Docker 불필요). `azure.yaml` 의 `remoteBuild: true` |
| 4. push | ACR | UAMI 의 AcrPush 권한으로 푸시 |
| 5. deploy | ACA revision | 새 이미지 태그로 revision 생성, 트래픽 100% 전환 |
| 6. frontend build | npm + Vite | `dist/` 산출 |
| 7. frontend deploy | SWA CLI | SWA 에 정적 자산 업로드 + Linked Backend 라우팅 활성 |
| 8. postdeploy hook | shell | ACA ingress targetPort 를 80(placeholder) → 8000(FastAPI) 로 정렬 |
| 9. outputs | azd env | `BACKEND_FQDN`, `SWA_HOSTNAME`, `BACKEND_API_KEY` 등을 `.azure/<env>/.env` 에 기록 |

이걸 손으로 할 때 필요한 명령 수: **30개 이상.** azd 한 줄이 그 30개를 결정적으로 묶습니다.

---

## 4. 핵심 설계 포인트 (이 레포에서 직접 확인 가능)

### 4-1. UAMI 를 ACA 보다 먼저 만든다 — 첫 배포 race 제거

> 파일: [`infra/main.bicep`](./infra/main.bicep), [`infra/modules/uami.bicep`](./infra/modules/uami.bicep)

```bicep
module uami 'modules/uami.bicep' = { /* 1순위로 생성 */ }

// UAMI 가 알려진 다음에야 4개 RBAC 부여
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.outputs.id, uami.outputs.principalId, 'AcrPull')
  scope: acrResource
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: uami.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

module backend 'modules/containerapp.bicep' = {
  // 4개 RBAC 가 *모두 끝난 다음* ACA 생성
  dependsOn: [acrPull, storageRole, cosmosRole, aoaiUserRole]
  params: { userAssignedIdentityId: uami.outputs.id, ... }
}
```

System-assigned MI 는 ACA 가 생긴 *후*에야 principalId 가 나오므로, 첫 revision 이 RBAC 전파를 기다리다 `Operation expired` 로 죽는 흔한 함정이 있습니다. **UAMI 패턴은 그 race 를 구조적으로 없앱니다** — 이 데모의 demo-v3 → demo-v4 두 번의 클린 배포로 검증됨.

### 4-2. `disableLocalAuth = true` 와 함께 사는 법

> 파일: [`infra/modules/openai.bicep`](./infra/modules/openai.bicep)

```bicep
resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  properties: {
    disableLocalAuth: true   // API 키 자체가 비활성화됨
    customSubDomainName: name
  }
}
```

엔터프라이즈 정책으로 `disableLocalAuth=true` 가 강제되는 환경이 늘고 있습니다 (Cosmos `disableLocalAuth`, Storage `allowSharedKeyAccess=false`, AOAI 등). 이 상태에서는 `listKeys()` 가 실패합니다. 해법은 **모든 데이터 플레인 호출을 AAD 로 전환**하는 것:

```python
# backend/app/services/aoai_image.py
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import AzureOpenAI

cred = DefaultAzureCredential()
token_provider = get_bearer_token_provider(cred, "https://cognitiveservices.azure.com/.default")

client = AzureOpenAI(
    azure_endpoint=settings.azure_openai_endpoint,
    api_version=settings.azure_openai_api_version,
    azure_ad_token_provider=token_provider,   # ← 키 대신 토큰
)
```

ACA 컨테이너 안에서 `DefaultAzureCredential` 은 환경변수 `AZURE_CLIENT_ID` 로 UAMI 를 자동 선택해 IMDS 에서 토큰을 가져옵니다. **사람도 코드도 키를 만진 적이 없습니다.**

### 4-3. 결정적 secret — 동일 환경이면 키도 동일

```bicep
var effectiveBackendApiKey = empty(backendApiKey)
  ? uniqueString(subscription().id, resourceGroup().id, environmentName, 'backend-api-key')
  : backendApiKey
```

같은 구독·RG·환경명에서는 `azd up` 을 100번 다시 돌려도 같은 키가 나옵니다 → 팀원이 각자 받은 fork 가 같은 환경을 공유하기 쉬워지고, 의도적으로 키를 회전하려면 단순히 `azd env set BACKEND_API_KEY <new>` 로 덮어쓰면 됩니다.

### 4-4. SWA Linked Backend = 1단계 zero-trust

```bicep
// infra/modules/staticwebapp.bicep
resource link 'Microsoft.Web/staticSites/linkedBackends@2023-12-01' = {
  parent: swa
  name: 'backend'
  properties: { backendResourceId: containerAppId, region: location }
}
```

이 한 블록이 **자동으로**:
- SWA 의 `/api/*` 를 ACA 로 same-origin proxy
- ACA 에 EasyAuth(AAD 인증) 활성화 — 외부 직접 호출은 `401`
- SWA 호스트로 들어온 요청만 통과

즉, 클라이언트가 `/api/...` 를 호출할 때 CORS·키·토큰을 신경 쓸 필요가 없고, 동시에 ACA 가 인터넷에 노출돼도 SWA hostname 이 아닌 트래픽은 거부됩니다.

---

## 5. 같은 인프라를 Terraform 으로 — 1:1 비교

Bicep ↔ Terraform AzureRM 은 **거의 동일한 추상화 단위**를 가집니다. 학습 곡선이 작음을 직접 보여드립니다.

### 5-1. UAMI

<table>
<tr><th>Bicep (이 데모가 쓰는 것)</th><th>Terraform AzureRM</th></tr>
<tr>
<td>

```bicep
resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${env}'
  location: location
}
output principalId string = uami.properties.principalId
```

</td>
<td>

```hcl
resource "azurerm_user_assigned_identity" "this" {
  name                = "id-${var.env}"
  location            = var.location
  resource_group_name = var.rg
}

output "principal_id" {
  value = azurerm_user_assigned_identity.this.principal_id
}
```

</td></tr></table>

### 5-2. AcrPull RBAC + dependsOn

<table>
<tr><th>Bicep</th><th>Terraform</th></tr>
<tr>
<td>

```bicep
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, uami.principalId, 'AcrPull')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: uami.principalId
    principalType: 'ServicePrincipal'
  }
}

module backend 'containerapp.bicep' = {
  dependsOn: [acrPull]   // ★
  params: { ... }
}
```

</td>
<td>

```hcl
resource "azurerm_role_assignment" "acr_pull" {
  scope                = azurerm_container_registry.this.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.this.principal_id
}

resource "azurerm_container_app" "backend" {
  depends_on = [azurerm_role_assignment.acr_pull]   # ★
  # ...
}
```

</td></tr></table>

> 즉, **dependsOn 의 중요성**(§4-1) 은 Bicep / Terraform 둘 다에서 동일하게 지켜야 하는 패턴입니다. 도구가 바뀐다고 설계가 무력화되지 않습니다.

### 5-3. Azure OpenAI account + deployment

<table>
<tr><th>Bicep</th><th>Terraform</th></tr>
<tr>
<td>

```bicep
resource aoai 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: name
    disableLocalAuth: true
  }
}

resource analysis 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: aoai
  name: 'gpt-5.4'
  sku: { name: 'GlobalStandard', capacity: 50 }
  properties: {
    model: { format: 'OpenAI', name: 'gpt-5.4', version: '2026-03-05' }
  }
}
```

</td>
<td>

```hcl
resource "azurerm_cognitive_account" "aoai" {
  name                  = "aoai-${var.env}"
  kind                  = "OpenAI"
  sku_name              = "S0"
  custom_subdomain_name = "aoai-${var.env}"
  local_auth_enabled    = false
  # ...
}

resource "azurerm_cognitive_deployment" "analysis" {
  name                 = "gpt-5.4"
  cognitive_account_id = azurerm_cognitive_account.aoai.id
  model {
    format  = "OpenAI"
    name    = "gpt-5.4"
    version = "2026-03-05"
  }
  sku { name = "GlobalStandard"; capacity = 50 }
}
```

</td></tr></table>

> 차이는 신택스뿐. **속성·역할·실패 모드·운영 노하우는 그대로 옮겨갑니다.** 따라서 Terraform 에 익숙한 팀은 이 레포의 Bicep 을 30분이면 읽어낼 수 있고, 반대도 마찬가지입니다.

---

## 6. 비즈니스 시나리오 — 이 패턴이 어디서 빛나는가

### 6-1. 광고/이커머스 — 신상품 발매 → 24h 내 컷 자동 생성

**문제.** 새 SKU 1만 개. 디자이너 풀이 처리할 수 있는 컷은 하루 200장.

**이 데모의 패턴을 그대로 적용:**

- `azd env new prod-launch-2026q3` — **이벤트 단위 환경**을 1분에 만들기
- IaC 안의 `azureOpenAiImageCapacity` 를 50 → 500 으로 올리는 것만으로 capacity 확장
- 이벤트 끝나면 `azd down` 으로 통째 제거 → **비용이 0 으로 떨어짐**
- 다음 이벤트 때 같은 fork 에서 다시 `azd up` — 토폴로지가 코드라 재현이 보장됨

이걸 포털 클릭으로 한다고 상상해 보세요. 가능하지 않습니다.

### 6-2. 은행/제조 — "감사 가능한" 인프라

규제 환경에서는 누가 무엇을 만들었는지가 코드 PR 로 추적돼야 합니다.

- 모든 리소스는 `infra/*.bicep` 에 있음 → `git blame`, `git log` 가 그대로 감사 로그
- `disableLocalAuth=true`, `allowSharedKeyAccess=false` 같은 정책이 코드에 박혀 있음 → 누가 임의로 끄려면 PR 이 필요 → 4-eye review
- `azure.yaml` + GitHub Actions 로 main 브랜치 머지 = 운영 환경 변경 → 변경관리(CAB) 와 자연스럽게 정렬
- Azure Policy `Resource Should Use Managed Identity` 같은 규칙과 함께 쓰면 위반 자체가 deploy 시점에 차단

### 6-3. 스타트업/디지털 네이티브 — Day-1 부터 멀티 환경

```bash
azd env new dev
azd env new staging
azd env new prod
```

세 줄로 **격리된 RG 3개**가 나옵니다. 각각의 `BACKEND_API_KEY` 는 결정적 해시로 자동 분리. 같은 코드, 같은 IaC, 다른 환경. 환경별 quota/SKU 만 `azd env set` 으로 다르게 주면 끝.

---

## 7. DevOps 시나리오 — CI/CD 와의 결합

### 7-1. GitHub Actions + OIDC (키 0개)

```yaml
# .github/workflows/deploy.yml
permissions:
  id-token: write   # ← OIDC 토큰 발급용
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id:       ${{ vars.AZURE_CLIENT_ID }}
          tenant-id:       ${{ vars.AZURE_TENANT_ID }}
          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
          # ★ client-secret 없음. 워크로드 페더레이션으로 OIDC 토큰만 사용.

      - uses: Azure/setup-azd@v1
      - run: azd auth login --client-id ${{ vars.AZURE_CLIENT_ID }} --federated-credential-provider github --tenant-id ${{ vars.AZURE_TENANT_ID }}
      - run: azd up --no-prompt
        env:
          AZURE_ENV_NAME:  ${{ github.ref_name }}
          AZURE_LOCATION:  eastus2
```

핵심:
- 시크릿 0개. 키 누출 사고 자체가 불가능.
- 같은 워크플로우가 PR 별 **임시 환경**(`AZURE_ENV_NAME=pr-1234`)을 띄우고 머지 후 자동 정리하는 데도 그대로 쓰임.

### 7-2. Terraform + Azure 의 자연스러운 결합

이미 Terraform 으로 네트워크/공유 인프라를 운영 중이라면:

```hcl
# 회사 공통 hub-spoke 는 platform 팀이 Terraform 으로 관리
# 우리 앱은 그 spoke 를 input 으로 받아 Bicep / azd 로 위에 얹기

# platform-tf/outputs.tf
output "app_subnet_id"          { value = module.spoke.app_subnet_id }
output "private_dns_zone_acr"   { value = module.spoke.zone_acr_id }

# 우리 앱의 azd env
$ azd env set APP_SUBNET_ID    $(terraform -chdir=../platform-tf output -raw app_subnet_id)
$ azd env set ACR_DNS_ZONE_ID  $(terraform -chdir=../platform-tf output -raw private_dns_zone_acr)
$ azd up
```

→ Terraform 과 Bicep 은 *경쟁이 아니라 레이어*입니다. 보통 "**플랫폼은 Terraform, 앱은 Bicep+azd**" 가 가장 매끄럽지만, 단일 도구를 원하면 (5절처럼) Terraform 한 가지로도 100% 가능합니다.

### 7-3. Pull Request 별 임시 환경 (Preview environment)

```yaml
on:
  pull_request:
    types: [opened, synchronize, closed]

jobs:
  preview:
    if: github.event.action != 'closed'
    steps:
      - run: azd env new pr-${{ github.event.number }} --no-prompt
      - run: azd up --no-prompt
      - uses: peter-evans/create-or-update-comment@v4
        with:
          issue-number: ${{ github.event.number }}
          body: "Preview: https://${{ env.SWA_HOSTNAME }}"

  cleanup:
    if: github.event.action == 'closed'
    steps:
      - run: azd env select pr-${{ github.event.number }}
      - run: azd down --force --purge --no-prompt
```

이 데모의 IaC 가 idempotent 하기 때문에 가능한 시나리오입니다. PR 마다 *진짜* 동작하는 데모가 자동으로 만들어지고, 머지/닫힘과 동시에 사라지므로 비용 누적도 0.

---

## 8. 보안·거버넌스 체크리스트 (이 데모가 이미 충족)

| 항목 | 어떻게 |
|---|---|
| Managed Identity 사용 | UAMI + `DefaultAzureCredential` (코드의 키 0개) |
| Local auth 비활성 | AOAI `disableLocalAuth=true`, Storage `allowSharedKeyAccess=false`, Cosmos `disableLocalAuth=true` |
| Least privilege | 4개 role 만 부여, 모두 데이터 플레인 한정 (Owner/Contributor 미사용) |
| Secret 회전 | `BACKEND_API_KEY` 결정적 + `azd env set` 으로 즉시 회전 |
| Audit | 모든 변경이 `infra/*.bicep` PR 로 남음 |
| Network exposure | ACA 외부 직접 호출은 EasyAuth 가 차단, SWA hostname 만 통과 |
| Image supply chain | ACR Tasks 로 클라우드에서 빌드 (로컬 환경 의존성 제거) |
| Cost teardown | `azd down --purge` 한 줄 — soft-delete 자원까지 청소 |

엔터프라이즈 customer review 에서 자주 들어오는 질문 90% 가 위 표 안에서 답이 나옵니다.

---

## 9. 다음 단계로 권하는 확장

이 데모를 그대로 두면서 **추가** 할 수 있는 것들. 모두 IaC 한 두 모듈을 더하면 됩니다.

- **App Insights / OpenTelemetry** — `infra/modules/appinsights.bicep` 추가, ACA 컨테이너에 환경변수 한 줄 주입
- **Front Door + WAF** — SWA 앞에 두어 글로벌 캐시 + L7 보호
- **Key Vault** — `BACKEND_API_KEY` 같은 secret 을 KV reference 로 ACA secret 에 마운트 (이미 IaC 에 슬롯이 있음, KV 모듈만 추가)
- **Private Endpoint + VNet 통합** — Storage / Cosmos / AOAI 를 모두 사설망으로. ACA Environment 를 internal-only 로 전환
- **Bicep → Terraform 자동 변환** — `aztfexport` 로 기존 RG 를 Terraform 으로 그대로 export 가능

---

## 10. 한 장 요약 (FAQ)

**Q. 이 데모를 보면 Azure IaC 의 어떤 점이 강하다는 건가?**
A. (1) UAMI + AAD 만으로 다섯 종 리소스에 키 없이 접근, (2) `azd up` 한 줄에 build/push/provision/deploy 가 결정적으로 묶임, (3) `disableLocalAuth=true` 같은 엔터프라이즈 정책과 자연스럽게 정렬, (4) Terraform 과 1:1 매핑되므로 도구 락인이 없음.

**Q. 우리는 이미 Terraform 을 쓰는데?**
A. 같은 토폴로지를 §5처럼 그대로 Terraform 으로 옮길 수 있습니다. 또는 §7-2처럼 Terraform(플랫폼) + azd(앱) 레이어를 같이 쓰는 패턴이 가장 흔합니다.

**Q. 우리는 GitOps 인데?**
A. ACA 는 ArgoCD 가 아니어도, GitHub Actions 만으로 GitOps 의 핵심 — 머지 = 배포 — 가 만들어집니다. AKS 라면 ArgoCD/Flux 그대로 사용 가능 (이 데모의 IaC 패턴은 AKS 로 갈아끼울 때도 UAMI + AAD 부분은 그대로 재사용됩니다).

**Q. 한국 리전에서 도는가?**
A. AOAI 모델 가용성이 region 별로 다릅니다. `azd env set AZURE_OPENAI_LOCATION koreacentral` 처럼 분리해서 지정 가능. 다른 리소스는 한국 리전에 그대로 만들어집니다.
