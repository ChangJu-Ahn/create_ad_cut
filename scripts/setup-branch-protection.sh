#!/usr/bin/env bash
# One-time bootstrap: enforce branch protection on `main`.
#
# Requirements:
#   - GitHub CLI (`gh`) authenticated as a repo admin
#   - You are at the repo root
#
# What it sets:
#   - Required PR review (1 approver)
#   - Required status checks: ci-backend / test, ci-frontend / build
#   - Dismiss stale reviews on new commits
#   - Require linear history & block force pushes
#
# Re-run safe: GitHub overwrites with the new settings.

set -euo pipefail

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
BRANCH="${1:-main}"

echo "→ Protecting ${REPO}@${BRANCH}"

gh api -X PUT "repos/${REPO}/branches/${BRANCH}/protection" \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "ci-backend / test",
      "ci-frontend / build"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON

echo "✅ Branch protection applied to ${BRANCH}."
echo "   Verify: gh api repos/${REPO}/branches/${BRANCH}/protection | jq"
