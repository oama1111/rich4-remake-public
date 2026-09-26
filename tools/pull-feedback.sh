#!/bin/bash
# 把线上的一键回报拉回本机看（需求方 2026-09-22）
#   bash tools/pull-feedback.sh            # 拉到 ./feedback/（已 .gitignore），并列出每一份的一句话摘要
#   bash tools/pull-feedback.sh --replay   # 拉完再逐份跑 tools/replay-report.ts 验指纹
# 服务器 / 密钥按 docs/deploy.md 的那台；改了机器就改下面两行。
set -euo pipefail
HOST=${RICH4_HOST:-root@<SERVER_IP>}
KEY=${RICH4_KEY:-~/.ssh/<DEPLOY_KEY>}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/feedback"
mkdir -p "$DEST"
rsync -az -e "ssh -i $KEY -o IdentitiesOnly=yes" "$HOST:/srv/rich4/feedback/" "$DEST/"
echo "拉到 ${DEST}（共 $(ls "$DEST"/*.json 2>/dev/null | wc -l | tr -d ' ') 份）"
echo
node -e '
const fs=require("fs"),path=require("path");
const dir=process.argv[1];
for (const f of fs.readdirSync(dir).filter(f=>f.endsWith(".json")).sort()) {
  try {
    const r=JSON.parse(fs.readFileSync(path.join(dir,f),"utf8"));
    const e=r.env||{};
    console.log(`${f}\n   ${r.reason}  ${e.player||"?"}  第${e.turnCount??"?"}回合 ${e.phase||""}/${e.pending??"-"} ${e.overlay?"屏="+e.overlay:""} ${e.net?"联机":"单机"}\n   「${(r.note||"").replace(/\s+/g," ").slice(0,120)}」`);
  } catch (err) { console.log(`${f}\n   （读不出来：${err.message}）`); }
}' "$DEST"
if [ "${1:-}" = "--replay" ]; then
  echo; for f in "$DEST"/*.json; do echo "== $(basename "$f")"; node --experimental-transform-types "$ROOT/tools/replay-report.ts" "$f" 2>&1 | tail -3; done
fi
