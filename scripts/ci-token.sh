#!/usr/bin/env bash
# Make the Cloudflare token the deploy workflow uses and store it as the repo's
# CLOUDFLARE_API_TOKEN secret. The token goes straight from Cloudflare to GitHub and is never printed.
#
#   CF_TOKEN_MANAGER=... scripts/ci-token.sh
#
# CF_TOKEN_MANAGER is a Cloudflare token that can create other tokens. It can't read zones, so the
# zone id is set below (it's on the askscottpierce.com overview page).
set -euo pipefail

REPO=ddrscott/stick-fight
ZONE=askscottpierce.com
ZONE_ID=${ZONE_ID:-2bb94441da63139badff2bbed65ba351}   # askscottpierce.com; CF_TOKEN_MANAGER can't read zones
NAME="stick-fight GitHub Actions deploy"
# Account-level permission groups, by their exact Cloudflare names. Add "D1 Write" when the
# workflow applies D1 migrations, "Workers KV Storage Write" when it writes KV, and so on.
ACCOUNT_GROUPS=("Workers Scripts Write" "D1 Write")
API=https://api.cloudflare.com/client/v4

: "${CF_TOKEN_MANAGER:?Set CF_TOKEN_MANAGER to a Cloudflare token that can create tokens.}"
cf() { curl -fsS -H "Authorization: Bearer $CF_TOKEN_MANAGER" -H "Content-Type: application/json" "$@"; }

account=$(gh variable get CLOUDFLARE_ACCOUNT_ID -R "$REPO")

groups=$(cf "$API/user/tokens/permission_groups")
group() {
  local id
  id=$(jq -r --arg n "$1" '.result[] | select(.name == $n) | .id' <<<"$groups")
  [ -n "$id" ] || { echo "Cloudflare has no permission group named \"$1\"." >&2; exit 1; }
  echo "$id"
}

account_ids=$(for g in "${ACCOUNT_GROUPS[@]}"; do group "$g"; done | jq -R '{id: .}' | jq -s .)
body=$(jq -n --arg name "$NAME" --arg account "$account" --arg zone "$ZONE_ID" \
  --argjson acct "$account_ids" --arg routes "$(group "Workers Routes Write")" '{
    name: $name,
    policies: [
      { effect: "allow", resources: { ("com.cloudflare.api.account." + $account): "*" }, permission_groups: $acct },
      { effect: "allow", resources: { ("com.cloudflare.api.account.zone." + $zone): "*" }, permission_groups: [{ id: $routes }] }
    ]
  }')

cf -X POST "$API/user/tokens" -d "$body" | jq -er '.result.value' | gh secret set CLOUDFLARE_API_TOKEN -R "$REPO"
echo "Created \"$NAME\" and saved it as CLOUDFLARE_API_TOKEN on $REPO."
