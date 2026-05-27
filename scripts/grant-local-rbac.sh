#!/usr/bin/env bash
# Grant the current az-logged-in user the three data-plane roles required
# for running the backend locally against cloud Cosmos/Blob/AOAI.
#
# Roles:
#   - Storage Blob Data Contributor   (storage account)
#   - Cognitive Services OpenAI User  (AOAI account)
#   - Cosmos DB Built-in Data Contributor  (Cosmos data plane, NOT ARM)
#
# All resource names are read from the active azd environment. Idempotent.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v az >/dev/null 2>&1 || ! command -v azd >/dev/null 2>&1; then
  echo "❌ az + azd CLIs required." >&2
  exit 1
fi

PRINCIPAL_ID=$(az ad signed-in-user show --query id -o tsv)
SUB_ID=$(az account show --query id -o tsv)

# Pull resource names from azd outputs
eval "$(azd env get-values | grep -E '^(AZURE_RESOURCE_GROUP|STORAGE_ACCOUNT_NAME|AZURE_OPENAI_NAME|COSMOS_ACCOUNT_NAME)=' | sed 's/^/export /')"

: "${AZURE_RESOURCE_GROUP:?AZURE_RESOURCE_GROUP missing from azd env}"
: "${STORAGE_ACCOUNT_NAME:?STORAGE_ACCOUNT_NAME missing from azd env}"
: "${AZURE_OPENAI_NAME:?AZURE_OPENAI_NAME missing from azd env}"
: "${COSMOS_ACCOUNT_NAME:?COSMOS_ACCOUNT_NAME missing from azd env}"

STORAGE_SCOPE="/subscriptions/${SUB_ID}/resourceGroups/${AZURE_RESOURCE_GROUP}/providers/Microsoft.Storage/storageAccounts/${STORAGE_ACCOUNT_NAME}"
AOAI_SCOPE="/subscriptions/${SUB_ID}/resourceGroups/${AZURE_RESOURCE_GROUP}/providers/Microsoft.CognitiveServices/accounts/${AZURE_OPENAI_NAME}"

echo "→ Storage Blob Data Contributor on $STORAGE_ACCOUNT_NAME"
az role assignment create \
  --assignee-object-id "$PRINCIPAL_ID" \
  --assignee-principal-type User \
  --role "Storage Blob Data Contributor" \
  --scope "$STORAGE_SCOPE" >/dev/null 2>&1 \
  && echo "   ✅ granted" \
  || echo "   ↳ already present (or insufficient permission)"

echo "→ Cognitive Services OpenAI User on $AZURE_OPENAI_NAME"
az role assignment create \
  --assignee-object-id "$PRINCIPAL_ID" \
  --assignee-principal-type User \
  --role "Cognitive Services OpenAI User" \
  --scope "$AOAI_SCOPE" >/dev/null 2>&1 \
  && echo "   ✅ granted" \
  || echo "   ↳ already present (or insufficient permission)"

echo "→ Cosmos DB Built-in Data Contributor on $COSMOS_ACCOUNT_NAME"
# Cosmos data plane is NOT an ARM role; uses sqlRoleAssignments.
az cosmosdb sql role assignment create \
  --account-name "$COSMOS_ACCOUNT_NAME" \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --scope "/" \
  --principal-id "$PRINCIPAL_ID" \
  --role-definition-id 00000000-0000-0000-0000-000000000002 >/dev/null 2>&1 \
  && echo "   ✅ granted" \
  || echo "   ↳ already present (or insufficient permission)"

echo ""
echo "🎉 Local data-plane RBAC done. Token propagation can take ~1 min."
echo "   Try: cd backend && uvicorn app.main:app --reload"
