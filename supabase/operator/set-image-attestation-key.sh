#!/usr/bin/env bash
# ===========================================================================
# OPERATOR ONLY. Run once per environment (and again to rotate the key).
# ===========================================================================
# Generates the HMAC key that lets the app server vouch for product photos it
# has decoded and re-encoded. The same key is stored in:
#   1. Supabase Vault, as secret "borrownest_image_attestation" (read only by
#      the attach_product_image() database function), and
#   2. .env.local, as IMAGE_ATTESTATION_SECRET (server-only, never NEXT_PUBLIC).
#
# Usage, from the project root, with DATABASE_URL in .env.db:
#   bash supabase/operator/set-image-attestation-key.sh
#
# The key is never printed. Restart `npm run dev` / redeploy afterwards.
set -euo pipefail

cd "$(dirname "$0")/../.."
[ -f .env.db ] || { echo "Missing .env.db with DATABASE_URL" >&2; exit 1; }
set -a; . ./.env.db; set +a

key="$(openssl rand -hex 32)"

psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -v key="$key" <<'SQL'
-- psql variables are not expanded inside $$ blocks, so pass it via a setting.
select set_config('bn.key', :'key', false) \gset bn_
do $$ begin
  if exists (select 1 from vault.secrets where name = 'borrownest_image_attestation') then
    perform vault.update_secret(
      (select id from vault.secrets where name = 'borrownest_image_attestation'),
      current_setting('bn.key'));
  else
    perform vault.create_secret(current_setting('bn.key'), 'borrownest_image_attestation',
      'HMAC key: server-verified product photo uploads');
  end if;
end $$;
SQL

# Replace or append the env entry without echoing the key.
touch .env.local
grep -v '^IMAGE_ATTESTATION_SECRET=' .env.local > .env.local.tmp || true
printf 'IMAGE_ATTESTATION_SECRET=%s\n' "$key" >> .env.local.tmp
mv .env.local.tmp .env.local
chmod 600 .env.local
unset key

echo "Image attestation key stored in Vault and .env.local."
