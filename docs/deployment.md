# 배포 가이드

## 인증 모델 한눈에

| 대상 | 인증 |
|---|---|
| 외부 → 백엔드 | `X-API-Key` 헤더 (`BACKEND_API_KEY`, ACA secret) |
| 백엔드 → Azure OpenAI / Cosmos DB / Blob Storage | **AAD (DefaultAzureCredential)** — ACA 에 attach 된 **User-assigned Managed Identity** |
| ACA → ACR | User-assigned Managed Identity + AcrPull (IaC 가 먼저 부여 후 ACA 생성) |

UAMI 에는 IaC 가 다음 역할을 자동 부여합니다.

- ACR `AcrPull`
- Storage `Storage Blob Data Contributor`
- Cosmos `Cosmos DB Built-in Data Contributor`
- Azure OpenAI `Cognitive Services OpenAI User`

로컬에서 백엔드를 돌릴 때는 본인의 `az login` ID 에도 위 네 역할 중 사용할 데이터 plane 역할(Storage Blob Data Contributor + Cosmos Data Contributor + Cognitive Services OpenAI User) 부여가 필요합니다 (§2 참고).

---

## 0. 사전 준비 사항

- Azure 구독 — Owner 또는 (Contributor + User Access Administrator)
- 해당 구독에 다음 quota 가 남아 있을 것:
  - 안석 모델 — 기본 `gpt-5.4` (`AZURE_OPENAI_ANALYSIS_MODEL` 로 다른 모델 지정 가능)
  - 이미지 모델 — 기본 `gpt-image-2` (`AZURE_OPENAI_IMAGE_MODEL` 로 다른 모델 지정 가능)
- Azure CLI / azd / Node.js 20 / Python 3.10+

Azure OpenAI 리소스 자체는 IaC 가 구독 안에 새로 만듭니다.

---

## 1. 인프라 + 백엔드 + 프론트엔드 배포

### A. 로컬 azd (권장)

```bash
azd auth login
az login
azd env new dev
azd env set AZURE_LOCATION eastus2
azd up
```

이게 끝입니다. UAMI / ACR / Storage / Cosmos / Azure OpenAI account + 두 개의 모델 deployment(`gpt-5.4`, `gpt-image-2`) / Container Apps Environment / Container App / Static Web App 을 한 번에 만듬니다. `BACKEND_API_KEY` 는 환경별 결정적 해시로 자동 생성되어 ACA secret 으로 주입됩니다.

다른 region/모델/capacity 를 쓰고 싶으면 `azd up` 전에 덮어쓰세요.

```bash
azd env set AZURE_OPENAI_LOCATION                eastus2
azd env set AZURE_OPENAI_ANALYSIS_MODEL          gpt-5
azd env set AZURE_OPENAI_ANALYSIS_MODEL_VERSION  2025-08-07
azd env set AZURE_OPENAI_ANALYSIS_CAPACITY       25
azd env set AZURE_OPENAI_IMAGE_MODEL             gpt-image-1.5
azd env set AZURE_OPENAI_IMAGE_MODEL_VERSION     2025-12-16
azd env set AZURE_OPENAI_IMAGE_DEPLOYMENT        gpt-image-1.5
```

> 이미 이 저장소를 포크/클론해서 작업 중이면 `azd init -t .` 는 실행하지 않습니다.
> 해당 명령은 템플릿 소스 바깥 경로에서 새 프로젝트를 만들 때만 사용합니다.

### B. 단계별 (azd 없이 az CLI 만)

검증된 시퀀스입니다.

```bash
RG="rg-create-ad-cut-dev"
LOC="eastus2"
ENV="dev"

# 1) Resource group
az group create -n $RG -l $LOC --tags project=create-ad-cut env=$ENV

# 2) Bicep 배포 (UAMI + RBAC + AOAI + ACR + Storage + Cosmos + ACA + SWA)
az deployment group create -g $RG -n create-ad-cut -f infra/main.bicep \
  --parameters environmentName=$ENV location=$LOC

# 3) 백엔드 이미지 빌드 (ACR Tasks)
ACR_NAME=$(az deployment group show -g $RG -n create-ad-cut --query properties.outputs.ACR_NAME.value -o tsv)
az acr build -r $ACR_NAME -t create-ad-cut-backend:v1 -f backend/Dockerfile backend

# 4) ACA 에 첫 이미지 푸시 + 포트(8000) 정렬
ACA_NAME=$(az deployment group show -g $RG -n create-ad-cut --query properties.outputs.BACKEND_NAME.value -o tsv)
LOGIN=$(az acr show -n $ACR_NAME --query loginServer -o tsv)
az containerapp update         -g $RG -n $ACA_NAME --image "$LOGIN/create-ad-cut-backend:v1"
az containerapp ingress update -g $RG -n $ACA_NAME --type external --target-port 8000

# 5) 프론트엔드 빌드 + SWA 배포
SWA_NAME=$(az deployment group show -g $RG -n create-ad-cut --query properties.outputs.SWA_NAME.value -o tsv)
SWA_TOKEN=$(az staticwebapp secrets list -n $SWA_NAME -g $RG --query properties.apiKey -o tsv)
(cd frontend && npm install && npm run build)
npm install -g @azure/static-web-apps-cli
swa deploy frontend/dist --deployment-token $SWA_TOKEN --env production
```

> **참고**: Bicep 의 ACA 모듈은 placeholder 이미지(MCR quickstart, port 80)로 시작한 다음 azd / az CLI 단계에서 실 백엔드 이미지(port 8000)로 교체됩니다. UAMI 와 AcrPull RBAC 가 ACA 보다 먼저 생성되므로 새 RG 에서도 첫 배포가 바로 성공합니다.

혹시 `Operation expired` / `ContainerAppOperationInProgress` 가 보이면 (이전에 남은 잠금이 있을 때) :

```bash
az deployment group cancel -g $RG -n backend
azd deploy
```

---

## 2. 로컬 백엔드를 클라우드 데이터에 붙이기

Azure 리소스가 한 번 만들어지면 백엔드는 로컬에서 그대로 띄워도 됩니다.

```pwsh
# 사용자 본인에게 데이터 plane RBAC 부여 (1회)
$USER = az ad signed-in-user show --query id -o tsv
$ST   = az storage account show -g $RG -n <storage-account> --query id -o tsv
az role assignment create --assignee-object-id $USER --assignee-principal-type User `
  --role "Storage Blob Data Contributor" --scope $ST
az cosmosdb sql role assignment create -g $RG -a <cosmos-account> --scope "/" `
  --principal-id $USER --role-definition-id "00000000-0000-0000-0000-000000000002"

# backend/.env 작성 (예시 값은 azd env get-values 또는 deployment outputs 에서)
# AZURE_STORAGE_ACCOUNT_NAME=<storage>
# COSMOS_ENDPOINT=https://<cosmos>.documents.azure.com:443/
# (그 외 BACKEND_API_KEY, AZURE_OPENAI_*)

cd backend
python -m venv .venv ; .\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
uvicorn app.main:app --reload   # http://localhost:8000

# 프론트엔드는 별도 셸에서
cd frontend
npm run dev                     # http://localhost:5173 (Vite proxy → /api/*)
```

---

## 3. `BACKEND_API_KEY` 안내 — 어디에 입력하고, 어디에서 가져오는가

### 3-1. 구조

| 위치 | 설명 |
|---|---|
| **원본 (single source of truth)** | Azure Container Apps 의 secret store. secret 이름 `backend-api-key`, env 변수 `BACKEND_API_KEY` 가 `secretRef: backend-api-key` 로 바인딩됨. |
| **사용 주체** | 모든 비-`healthz` 호출이 `X-API-Key: <BACKEND_API_KEY>` 헤더를 요구. |
| **프론트 보관 위치** | 브라우저 `localStorage` (키: `create-ad-cut.apiKey`). 로그아웃 없이 동일 도메인에서만 재사용. |
| **서버 저장** | 없음. 요청마다 [`backend/app/auth.py`](../backend/app/auth.py) 의 `require_api_key` 가 상수 비교해 적립 또는 401 반환. |

### 3-2. UI 입력 흐름

1. 맨 위 이미지 참조. SWA hostname 에 접속 → 헤더 우측 상단 **“API Key 설정”** 링크 클릭.
2. 모달 창이 뜨면서 **“Backend API Key”** 입력란이 나타남.
3. `BACKEND_API_KEY` 값 붙여넣고 **“저장”** → 브라우저 `localStorage` 에 보관.
4. 이후 모든 `/api/*` 요청에 자동으로 헤더가 붙음.

   > 만료 / 도만 / 섬에서 테스트 중이라 키를 모르는 동료가 많으면 아래 3-3 에서 관리자가 1회 가져와 전달하면 됩니다.

### 3-3. 키 가져오기 (관리자용)

```pwsh
$RG  = "rg-create-ad-cut-dev"
$ACA = (az containerapp list -g $RG --query "[0].name" -o tsv)

# (a) env 에 평문으로 명시되어 있으면 대개 여기서 나옴
az containerapp show -g $RG -n $ACA `
  --query "properties.template.containers[0].env[?name=='BACKEND_API_KEY'].value | [0]" -o tsv

# (b) 대신 secretRef 로 묶여 있으면 (이 리포의 Bicep 처림) secret store 에서 직접 꺼내야 함
az containerapp secret show -g $RG -n $ACA --secret-name backend-api-key --query value -o tsv
```

둘 중 하나에서 값이 나와야 정상입니다. 한 줄로 자동 fallback 해서 이더보고 싶다면:

```pwsh
$key = az containerapp show -g $RG -n $ACA `
  --query "properties.template.containers[0].env[?name=='BACKEND_API_KEY'].value | [0]" -o tsv
if (-not $key) { $key = az containerapp secret show -g $RG -n $ACA --secret-name backend-api-key --query value -o tsv }
Write-Host "BACKEND_API_KEY = $key"
```

### 3-4. 권한 제약

| 필요 작업 | 최소 권한 |
|---|---|
| ACA 메타데이터 조회 (FQDN, image 등) | `Reader` |
| **secret 값 읽기** (`az containerapp secret show`) | **`Container Apps Contributor` 또는 `Contributor`** — `Reader` 는 평문 secret 에 접근 불가 |
| secret 값 교체 (`az containerapp secret set`) | `Container Apps Contributor` |

그 외 제약:

- 이 명령들은 **Azure Policy 의 `disableLocalAuth=true`** 을 켜도 문제 없음 (control plane 명령, AAD 로그인 인증).
- ACA 가 **placeholder 이미지로 멈춰 있는 상태**에서도 secret 조회는 동작 (revision 상태와 무관).
- secret 값을 **JSON output 으로 명시적으로 꺼내면 상스 history · 셋셍 log · CI artifact** 에 남을 수 있음. 설명·데모 목적이면 다 쓰고 나서 반드시 3-5 회전.

### 3-5. 키 회전

```pwsh
$RG  = "rg-create-ad-cut-dev"
$ACA = (az containerapp list -g $RG --query "[0].name" -o tsv)
$new = [guid]::NewGuid().ToString()

az containerapp secret set -g $RG -n $ACA --secrets backend-api-key=$new
az containerapp update     -g $RG -n $ACA   # 새 secret 으로 revision 재생성

Write-Host "새 BACKEND_API_KEY = $new (프론트에서 API Key 설정 다시 입력 필요)"
```

회전 수간

- 이전 키는 즉시 무효화 → 프론트 로그인한 사용자는 다음 호출에서 401 을 받아 다시 입력을 요구받음.
- GitHub Actions 를 쓰고 있으면 GitHub repo Secrets 의 `BACKEND_API_KEY` (아래 4장 표) 도 같이 교체.

---

## 4. CI/CD (GitHub Actions)

```pwsh
az ad sp create-for-rbac `
  --name "github-create-ad-cut" `
  --role contributor `
  --scopes /subscriptions/<SUBSCRIPTION_ID> `
  --json-auth | clip
```

복사된 JSON 을 GitHub repo Secrets 에 `AZURE_CREDENTIALS` 로 저장합니다.

> SP 는 `Microsoft.Authorization/roleAssignments/write` 권한이 필요합니다
> (AcrPull / Storage / Cosmos data role 부여용). User Access Administrator
> 또는 Owner 역할을 같은 스코프에 추가하세요.

| 종류 | 이름 | 값 |
|---|---|---|
| Secret | `AZURE_CREDENTIALS` | 위에서 만든 SP JSON |
| Secret | `BACKEND_API_KEY` | `azd env get-value BACKEND_API_KEY` 또는 ACA secret store 에서 복사 |
| Secret | `SWA_DEPLOYMENT_TOKEN` | provision 후 SWA 콘솔에서 복사 |
| Variable | `AZURE_RG` | provision 후 생성된 Resource Group 이름 |
| Variable | `ACR_NAME` | provision 후 ACR 이름 |
| Variable | `ACA_NAME` | provision 후 Container App 이름 |

- `frontend/**` 변경 → `deploy-frontend.yml` 자동 실행
- `backend/**` 변경 → `deploy-backend.yml` (ACR push + ACA revision update)
- 인프라 변경은 `Actions → deploy-infra → Run workflow`

---

## 5. 검증

```bash
SWA="https://<swa-hostname>"
KEY="<BACKEND_API_KEY>"
curl "$SWA/api/healthz"
curl -X POST "$SWA/api/sessions" -H "X-API-Key: $KEY"
```

SWA 호스트를 브라우저로 열어 4단계 흐름이 동작하는지 확인합니다.

---

## FAQ

**Q. ACA 가 처음에 “Failed to provision revision: Operation expired” 로 실패합니다.**
A. placeholder 이미지(port 80)와 ingress targetPort(8000) 불일치 때문입니다. 위 단계 3~4 로 진짜 백엔드 이미지를 ACR 에 푸시 후 `az containerapp update` 한 번이면 회복합니다.

**Q. SWA 호스트로 호출하면 401 인데 ACA 호스트로 직접 호출해도 401 입니다.**
A. 정상입니다. SWA Linked Backend 는 ACA 에 EasyAuth 를 자동 활성화해 직접 호출을 차단합니다. SWA 호스트(`https://<swa>/api/...`) 로만 접근하세요.

**Q. Cosmos / Storage 가 401 (`Local Authorization is disabled` / `KeyBasedAuthenticationNotPermitted`) 을 반환합니다.**
A. AAD 인증 누락입니다. 위 “2. 로컬 백엔드” 의 RBAC 명령을 본인 ID 에 부여하세요. 클라우드 측 ACA 는 IaC 가 UAMI 에 자동으로 역할을 부여합니다.

**Q. SWA Linked Backend region 오류가 납니다.**
A. `infra/main.bicep` 의 `staticWebAppLocation` 을 호환 region(`eastus2`, `westus2`, `centralus`, `northeurope`, `westeurope` 등)으로 명시하세요.

**Q. AOAI 호출이 401 입니다.**
A. 보통 다음 중 하나입니다: (1) 이 IaC 는 AAD 호출이므로 API 키는 쓰이지 않습니다. 로컬에서 돌린다면 본인 ID 에 `Cognitive Services OpenAI User` 역할이 AOAI 계정 스코프에 부여되었는지 확인. (2) 클라우드에서 잘 되다가 이런다면 ACA 에 attach 된 UAMI 가 올바른지 (`AZURE_USER_ASSIGNED_IDENTITY_CLIENT_ID` env 가 본 컸테이너에 `AZURE_CLIENT_ID` 로 들어가 있는지). (3) `AZURE_OPENAI_ENDPOINT` 가 `/` 로 끝나는지, deployment 이름이 정확한지 (`gpt-5.4` vs `gpt-5-4`) Azure Portal 의 Deployments 탭에서 확인.
