#!/usr/bin/env bash
# Create a deployment Service Principal and push GitHub Secrets/Variables.
# Idempotent — safe to re-run.
#
# Prereqs: azd, az (logged in), gh (logged in), jq
# Run from repo root: ./scripts/setup-github-secrets.sh

set -euo pipefail

# `azd env get-value` writes update-check notices to stdout. Strip them.
azd_get() {
  azd env get-value "$1" 2>/dev/null \
    | grep -Ev '^(Update available|To update,|$)' \
    | head -1
}

echo "==> Reading azd environment values"
RG=$(azd_get AZURE_RESOURCE_GROUP)
ACR=$(azd_get ACR_NAME)
ACA=$(azd_get BACKEND_NAME)
SWA=$(azd_get SWA_NAME)
SUB=$(az account show --query id -o tsv)

for var in RG ACR ACA SWA SUB; do
  val="${!var}"
  if [ -z "$val" ]; then
    echo "ERROR: $var is empty. Run 'azd env refresh' or 'azd provision' first." >&2
    exit 1
  fi
done

echo "  Subscription : $SUB"
echo "  ResourceGroup: $RG"
echo "  ACR          : $ACR"
echo "  ACA          : $ACA"
echo "  SWA          : $SWA"

SP_NAME="sp-create-ad-cut-deploy"
SCOPE="/subscriptions/${SUB}/resourceGroups/${RG}"

echo
echo "==> Creating/refreshing Service Principal: $SP_NAME"
# create-for-rbac is idempotent on --name: it rotates the password if SP exists.
SP_JSON=$(az ad sp create-for-rbac \
  --name "$SP_NAME" \
  --role Contributor \
  --scopes "$SCOPE" \
  --sdk-auth 2>/dev/null)

SP_APP_ID=$(echo "$SP_JSON" | jq -r .clientId)
echo "  clientId: $SP_APP_ID"

echo
echo "==> Granting AcrPush on $ACR"
ACR_ID=$(az acr show -n "$ACR" --query id -o tsv)
az role assignment create \
  --assignee "$SP_APP_ID" \
  --role AcrPush \
  --scope "$ACR_ID" \
  --only-show-errors >/dev/null 2>&1 \
  || echo "  (already granted)"

echo
echo "==> Fetching SWA deployment token"
SWA_TOKEN=$(az staticwebapp secrets list -n "$SWA" --query properties.apiKey -o tsv)
if [ -z "$SWA_TOKEN" ]; then
  echo "ERROR: SWA token empty" >&2
  exit 1
fi

echo
echo "==> Pushing GitHub Secrets"
gh secret set AZURE_CREDENTIALS    --body "$SP_JSON"
gh secret set SWA_DEPLOYMENT_TOKEN --body "$SWA_TOKEN"

echo
echo "==> Pushing GitHub Variables"
gh variable set AZURE_RG --body "$RG"
gh variable set ACR_NAME --body "$ACR"
gh variable set ACA_NAME --body "$ACA"

echo
echo "Done. Verify with:"
echo "  gh secret list"
echo "  gh variable list"
