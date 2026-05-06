# 배포 가이드

## 인증 모델 한눈에

| 대상 | 인증 |
|---|---|
| 외부 → 백엔드 | `X-API-Key` 헤더 (`BACKEND_API_KEY`) |
| 백엔드 → Azure OpenAI | API Key (다른 구독의 사전 배포 리소스이므로 키 사용) |
| 백엔드 → Cosmos DB / Blob Storage | **AAD (DefaultAzureCredential)** — `disableLocalAuth=true` / `allowSharedKeyAccess=false` 정책 환경에서 표준 |
| ACA → ACR | System-assigned Managed Identity + AcrPull |

로컬 개발자의 `az login` ID 와 ACA 의 system-assigned MI 두 군데 모두에
**Storage Blob Data Contributor** + **Cosmos DB Built-in Data Contributor**
역할이 부여되어야 합니다.

---

## 0. 사전 배포된 Azure OpenAI 확인

이 리포의 IaC 는 Azure OpenAI 리소스를 만들지 않습니다. 다음이 이미 있어야 합니다.

- Azure OpenAI 리소스 1개
- 분석용 deployment: `gpt-5.4` 또는 `gpt-5.5`
- 이미지 생성 deployment: `gpt-image-2`

엔드포인트 URL 과 API 키를 메모해 두세요.

---

## 1. 인프라 + 백엔드 + 프론트엔드 배포

### A. 로컬 azd (1회 셋업)

```pwsh
az login
azd init -t .
azd env new dev
azd env set AZURE_LOCATION eastus2
azd env set AZURE_OPENAI_ENDPOINT  https://<your-aoai>.openai.azure.com/
azd env set AZURE_OPENAI_API_KEY   <key>
azd env set BACKEND_API_KEY        $(New-Guid)
azd up
```

### B. 단계별 (azd 없이 az CLI 만)

이 리포가 검증된 시퀀스입니다.

```pwsh
$RG    = "rg-create-ad-cut-dev"
$LOC   = "eastus2"
$ENV   = "dev"

# 1) Resource group
az group create -n $RG -l $LOC --tags project=create-ad-cut env=$ENV

# 2) Bicep 배포 (인프라 + 빈 ACA + SWA + 데이터 plane RBAC)
az deployment group create -g $RG -n create-ad-cut -f infra/main.bicep `
  --parameters environmentName=$ENV location=$LOC `
    azureOpenAiEndpoint='https://<your-aoai>.openai.azure.com/' `
    azureOpenAiApiKey='<aoai-key>' `
    azureOpenAiAnalysisDeployment=gpt-5.4 `
    azureOpenAiImageDeployment=gpt-image-2 `
    backendApiKey='<random-guid>'

# 3) 백엔드 이미지 빌드 (Docker Desktop 없이 ACR Tasks 로 빌드)
$ACR_NAME = az deployment group show -g $RG -n create-ad-cut --query properties.outputs.ACR_NAME.value -o tsv
az acr build -r $ACR_NAME -t create-ad-cut-backend:v1 -f backend/Dockerfile backend

# 4) ACA 에 첫 이미지 푸시
$ACA_NAME = az deployment group show -g $RG -n create-ad-cut --query properties.outputs.BACKEND_NAME.value -o tsv
$LOGIN    = az acr show -n $ACR_NAME --query loginServer -o tsv
az containerapp update -g $RG -n $ACA_NAME --image "$LOGIN/create-ad-cut-backend:v1"

# 5) 프론트엔드 빌드 + SWA 배포
$SWA_NAME  = az deployment group show -g $RG -n create-ad-cut --query properties.outputs.SWA_NAME.value -o tsv
$SWA_TOKEN = az staticwebapp secrets list -n $SWA_NAME -g $RG --query properties.apiKey -o tsv
Push-Location frontend ; npm install ; npm run build ; Pop-Location
npm install -g @azure/static-web-apps-cli
swa deploy frontend/dist --deployment-token $SWA_TOKEN --env production
```

> **주의:** Bicep 의 첫 배포에서 ACA 가 placeholder 이미지(`hello-world`,
> port 80)로 시작하기 때문에 “Failed to provision revision” 으로 실패할
> 수 있습니다. 이 경우 위 3~4 단계로 정상 이미지를 푸시하면 자동 회복됩니다.

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

## 3. CI/CD (GitHub Actions)

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
| Secret | `AZURE_OPENAI_ENDPOINT` | `https://<your-aoai>.openai.azure.com/` |
| Secret | `AZURE_OPENAI_API_KEY` | AOAI key |
| Secret | `BACKEND_API_KEY` | 임의 랜덤 문자열 |
| Secret | `SWA_DEPLOYMENT_TOKEN` | provision 후 SWA 콘솔에서 복사 |
| Variable | `AZURE_RG` | provision 후 생성된 Resource Group 이름 |
| Variable | `ACR_NAME` | provision 후 ACR 이름 |
| Variable | `ACA_NAME` | provision 후 Container App 이름 |

- `frontend/**` 변경 → `deploy-frontend.yml` 자동 실행
- `backend/**` 변경 → `deploy-backend.yml` (ACR push + ACA revision update)
- 인프라 변경은 `Actions → deploy-infra → Run workflow`

---

## 4. 검증

```pwsh
$SWA = "https://<swa-hostname>"
$KEY = "<BACKEND_API_KEY>"
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
A. AAD 인증 누락입니다. 위 “2. 로컬 백엔드” 의 RBAC 명령을 본인 ID + ACA system-assigned MI 양쪽에 부여하세요.

**Q. SWA Linked Backend region 오류가 납니다.**
A. `infra/main.bicep` 의 `staticWebAppLocation` 을 호환 region(`eastus2`, `westus2`, `centralus`, `northeurope`, `westeurope` 등)으로 명시하세요.

**Q. AOAI 호출이 401 입니다.**
A. `AZURE_OPENAI_ENDPOINT` 가 `/` 로 끝나는지, deployment 이름이 정확한지(`gpt-5.4` vs `gpt-5-4`) Azure Portal 의 Deployments 탭에서 확인합니다.
