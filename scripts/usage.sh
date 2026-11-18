#!/bin/bash
# 使われた数を数える（呼んでくれた別々の人＝送り元のハッシュの数）。wrangler のログインを使い、鍵は画面に出さない。
# 使い方: bash scripts/usage.sh [日数=14]
set -euo pipefail
DAYS="${1:-14}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# wrangler を一度動かすと、ログインの札が新しくなる
(cd "$ROOT" && npx wrangler whoami >/dev/null 2>&1) || true
CFG="$HOME/.wrangler/config/default.toml"
[ -f "$CFG" ] || CFG="$HOME/Library/Preferences/.wrangler/config/default.toml"
TOKEN=$(/usr/bin/grep -m1 '^oauth_token' "$CFG" | sed 's/.*= *"\(.*\)"/\1/')
ACCOUNT="${CLOUDFLARE_ACCOUNT_ID:-ffa9a931fec21b22273fd2c311bb771d}"
q(){
  curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/analytics_engine/sql" -H "Authorization: Bearer $TOKEN" --data "$1" \
    | python3 -c "import sys,json
t=sys.stdin.read()
try:
  d=json.loads(t); print(json.dumps(d.get('data',d),ensure_ascii=False))
except Exception:
  print(t[:300])"
}
echo "== 直近${DAYS}日: 呼んでくれた別々の人（送り元の印は 2026-11-18 から2週ごとに作り替える。期間をまたぐと同じ人が2回数えられる）と呼び出しの数"
q "SELECT count(DISTINCT index1) AS callers, sum(_sample_interval) AS requests FROM jp_business_id_mcp_usage WHERE timestamp > NOW() - INTERVAL '${DAYS}' DAY AND blob1 = 'tools/call' FORMAT JSON"
echo "== 道具ごと"
q "SELECT blob2 AS tool, count(DISTINCT index1) AS callers, sum(_sample_interval) AS requests FROM jp_business_id_mcp_usage WHERE timestamp > NOW() - INTERVAL '${DAYS}' DAY AND blob1 = 'tools/call' GROUP BY tool ORDER BY requests DESC FORMAT JSON"
echo "== つないだだけの人（initialize）"
q "SELECT count(DISTINCT index1) AS callers FROM jp_business_id_mcp_usage WHERE timestamp > NOW() - INTERVAL '${DAYS}' DAY AND blob1 = 'initialize' FORMAT JSON"
