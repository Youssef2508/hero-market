#!/bin/sh
# Read-only security smoke test of a HeroMarket cloud (pre-production audit). Changes nothing: every
# request is either a read or is refused before it reaches the business code.
#
#   sh scripts/cloud-smoke.sh https://heromarket.duckdns.org
#   sh scripts/cloud-smoke.sh https://localhost --insecure        (CI: Caddy's internal CA)
set -u
base="${1:?usage: cloud-smoke.sh <https://address> [--insecure]}"
k="${2:-}"
fail=0
ok() { echo "ok    $1"; }
bad() { echo "FAIL  $1"; fail=1; }
post() { curl -s $k -m 20 -X POST -H 'content-type: application/json' "$@"; }

# The page, its security headers and its Content-Security-Policy.
headers=$(curl -s $k -m 20 -D - -o /tmp/hm-smoke-page.html "$base/")
for h in 'strict-transport-security' 'x-content-type-options: nosniff' 'x-frame-options: deny' 'referrer-policy: no-referrer'; do
  echo "$headers" | tr 'A-Z' 'a-z' | grep -q "^$h" && ok "header $h" || bad "header $h missing"
done
echo "$headers" | tr 'A-Z' 'a-z' | grep -q '^server:' && bad 'Server header present' || ok 'no Server header'
grep -q "script-src 'self' 'sha256-" /tmp/hm-smoke-page.html && ok 'CSP: scripts from the site only' || bad 'CSP script-src missing'
grep -q "unsafe-eval" /tmp/hm-smoke-page.html && bad 'CSP allows unsafe-eval' || ok 'CSP: no unsafe-eval'

# Plain http only redirects to https.
loc=$(curl -s -m 20 -o /dev/null -w '%{redirect_url}' "$(echo "$base" | sed 's/^https:/http:/')/")
case "$loc" in https://*) ok "http redirects to $loc" ;; *) bad "http does not redirect to https ($loc)" ;; esac

# Health and first-run state.
[ "$(curl -s $k -m 20 -o /dev/null -w '%{http_code}' "$base/api/health")" = 200 ] && ok 'health 200' || bad 'health not 200'

# What only the shop PC does is refused here before anything runs.
for op in auth.setup auth.recover auth.setPassword sync.pair sync.unlink backup.export backup.restore system.reset; do
  r=$(post -d '{"username":"smoke","password":"Smoke-test-only-9"}' "$base/api/$op")
  echo "$r" | grep -Eq '"code":"(shop_only|unauthorized|forbidden)"|"statusCode":404' && ok "$op refused or absent" || bad "$op answered: $r"
done

# Every other operation needs a session; a cookie alone (without the page's own header) is refused.
for op in operations.list clients.list sales.page users.list settings.get expenses.list; do
  r=$(post -d '{}' "$base/api/$op")
  echo "$r" | grep -q '"code":"unauthorized"' && ok "$op needs a session" || bad "$op without a session: $r"
done
r=$(post -H 'cookie: hm_session=0000000000000000000000000000000000000000000000000000000000000000' -d '{}' "$base/api/clients.list")
echo "$r" | grep -q '"code":"unauthorized"' && ok 'cookie without the page header refused' || bad "cookie alone: $r"
r=$(post -H 'authorization: Bearer forged-token' -d '{}' "$base/api/clients.list")
echo "$r" | grep -q '"code":"unauthorized"' && ok 'forged bearer token refused' || bad "forged token: $r"

# Errors say nothing about the inside; oversized bodies are refused.
r=$(post -d '{"username":' "$base/api/auth.login")
echo "$r" | grep -qi 'stack\|at \|node_modules\|/app/' && bad "error leaks internals: $r" || ok 'malformed JSON: no internals in the answer'
code=$(head -c 30000000 /dev/zero | tr '\0' 'a' | curl -s $k -m 60 -o /dev/null -w '%{http_code}' -H 'Expect:' -X POST -H 'content-type: application/json' --data-binary @- "$base/api/auth.login")
# Refused as the caller's error: 413 from the service, or 400 when the proxy cut the body short.
case "$code" in 413|400) ok "oversized body refused ($code)" ;; *) bad "oversized body answered $code" ;; esac
curl -s $k --path-as-is -m 20 "$base/api/../../etc/passwd" | grep -q 'root:' && bad 'path traversal served a file' || ok 'path traversal not served'

[ $fail = 0 ] && echo 'cloud smoke: all checks passed' || echo 'cloud smoke: FAILURES'
exit $fail
