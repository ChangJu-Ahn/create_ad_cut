# create-ad-cut (English summary)

> 한국어 README is the source of truth → [README.md](./README.md)

## What it does

Turn a single product photo into 4 ad-ready shots — `lookbook`, `front`, `side`, `back` — by chaining:

1. **Analysis** with Azure OpenAI `gpt-5.4` / `gpt-5.5` (multimodal) producing a Korean `Output_Prompt`.
2. **Human review** of the prompt (5-minute pass to fix asymmetry, color order, hidden parts).
3. **Generation** with Azure OpenAI `gpt-image-2` (`images.edit`, `input_fidelity=high`) producing 1024×1024 images per mode in parallel.

## Stack

- Backend: **FastAPI on Azure Container Apps** (Python 3.12, multi-stage Dockerfile, non-root)
- Frontend: **React + Vite + TypeScript on Azure Static Web Apps** (Linked Backend → ACA, no CORS)
- Storage: **Azure Blob Storage** (private container, 15-min SAS URLs)
- State: **Azure Cosmos DB (NoSQL)** — `/sessionId` partition key, single embedded document per session
- IaC: **Bicep + azd** (`azd up` deploys infra + backend)
- CI/CD: **GitHub Actions** with `AZURE_CREDENTIALS` (Service Principal Secret)

## Pre-requisites

- Azure subscription with Owner (or Contributor + User Access Administrator).
- Azure OpenAI quota for `gpt-5.4` and `gpt-image-2` in your target region. If those models or capacity are unavailable, override the model defaults (see below). **The AOAI account itself IS created by this IaC.**

## Quick start (fork & clone)

```bash
# After forking on GitHub and cloning your fork
cd create_ad_cut
azd auth login
az login
azd env new dev
azd env set AZURE_LOCATION eastus2
azd up
```

That's it. `azd up` provisions everything: a user-assigned managed identity, ACR, Storage, Cosmos, Azure OpenAI account + `gpt-5.4` and `gpt-image-2` deployments, the Container App (FastAPI backend), and the Static Web App with a Linked Backend. The `BACKEND_API_KEY` is generated deterministically per environment and injected as an ACA secret. AOAI is called via AAD using the UAMI (no API key copying).

To override defaults (region, model, capacity) before `azd up`:

```bash
azd env set AZURE_OPENAI_LOCATION                eastus2
azd env set AZURE_OPENAI_ANALYSIS_MODEL          gpt-5
azd env set AZURE_OPENAI_ANALYSIS_MODEL_VERSION  2025-08-07
azd env set AZURE_OPENAI_ANALYSIS_CAPACITY       25
azd env set AZURE_OPENAI_IMAGE_MODEL             gpt-image-1.5
azd env set AZURE_OPENAI_IMAGE_MODEL_VERSION     2025-12-16
azd env set AZURE_OPENAI_IMAGE_DEPLOYMENT        gpt-image-1.5
```

> Do **not** run `azd init -t .` inside the cloned repo — that command is for
> creating a brand-new project from a template, and will fail with a
> "directory overlaps with template source" error when run here.

## Endpoints (auth: `X-API-Key`)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/sessions` | – | `{sessionId}` |
| POST | `/sessions/{id}/analyze` | multipart `image` (+ optional `detail_note`) | `{promptMd, inputImageUrl}` |
| PATCH | `/sessions/{id}/prompt` | `{promptMd}` | `{sessionId, promptMd, updatedAt}` |
| POST | `/sessions/{id}/generate` | `{modes: ["lookbook","front","side","back"]}` | `{results: [{mode, imageUrl}]}` |
| GET | `/sessions/{id}` | – | full session view (refreshed SAS URLs) |
| GET | `/healthz` | – | `{status:"ok"}` |

## License

MIT.
