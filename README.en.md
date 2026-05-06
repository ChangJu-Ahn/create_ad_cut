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

- Pre-deployed Azure OpenAI resource with `gpt-5.4` (or `gpt-5.5`) and `gpt-image-2` deployments. **The IaC does NOT create AOAI.**
- Endpoint URL + API key are passed in as parameters and stored as Container App secrets.

## Quick start

```bash
azd init -t .
azd env new dev
azd env set AZURE_OPENAI_ENDPOINT  https://<your-aoai>.openai.azure.com/
azd env set AZURE_OPENAI_API_KEY   <your-aoai-key>
azd env set BACKEND_API_KEY        <random-string>
azd up
```

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
