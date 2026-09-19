#!/usr/bin/env bash
# 全屏幕截图扫描的驱动（W-12）
# SPDX-License-Identifier: GPL-3.0-or-later
#
# 干什么：8 张地图 × 每一屏，各钉住截一张到 .qa-tmp/sweep/，
#         收集每屏的 console error，最后生成一页缩略图墙 .qa-tmp/sweep/index.html。
#
# 用法：
#   pnpm dev                                   # 另开一个终端
#   bash tools/sweep-screens.sh                # 全跑（约 5–10 分钟）
#   MAPS="0 7" ONLY="game stock" bash tools/sweep-screens.sh   # 只跑一部分
#
# ⚠️ 与 tools/soak-browser.js 同一条坑：页面动作一律走 `browse eval <file>`
#    （`browse js "$(cat …)"` 解析多行脚本会出问题）。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
B="${BROWSE:-$HOME/.agents/skills/gstack/browse/dist/browse}"
URL="${SWEEP_URL:-http://localhost:5173/?screen=game&humans=1&ai=3&seed=7&chars=0,3,5,7}"
OUT="$ROOT/.qa-tmp/sweep"
JS=/tmp/sweep-screens.js
MAPS="${MAPS:-0 1 2 3 4 5 6 7}"
BASE=(title setup options saveload lobby aiSettings intro assets inventory stock game)
OVERLAYS=(help bigMap magic lottery minigame eventBox shop bank bail)

if [ ! -x "$B" ]; then
  echo "找不到 browse：$B（用 BROWSE=… 指一个）" >&2
  exit 2
fi
mkdir -p "$OUT"
rm -f "$OUT"/*.png
: > "$OUT/summary.tsv"
: > "$OUT/console.log"
cp "$ROOT/tools/sweep-screens.js" "$JS"

shoot() { # $1=map $2=screen
  local map="$1" screen="$2" st errs
  "$B" console --clear >/dev/null 2>&1
  "$B" js "globalThis.__swTarget='$screen'" >/dev/null 2>&1
  st="$("$B" eval "$JS" 2>&1 | tail -1)"
  local file="$OUT/map${map}_${screen}.png"
  "$B" screenshot "$file" >/dev/null 2>&1
  if [ ! -s "$file" ]; then st="$st | screenshot-missing"; fi
  errs="$("$B" console --errors 2>/dev/null | tr '\n' ' ' | tr '\t' ' ' | cut -c1-300)"
  # browse 在没有 error 时打的是这句人话，不是空输出
  case "$errs" in *"(no console errors)"*) errs="" ;; esac
  printf 'map%s\t%s\t%s\t%s\n' "$map" "$screen" "$st" "$errs" >> "$OUT/summary.tsv"
  if [ -n "$errs" ]; then printf 'map%s\t%s\t%s\n' "$map" "$screen" "$errs" >> "$OUT/console.log"; fi
  printf 'map%s %-14s %s %s\n' "$map" "$screen" "$st" "${errs:+‹errors›}"
}

for map in $MAPS; do
  echo "── 地圖 $map ──"
  "$B" goto "${URL}&map=${map}" >/dev/null 2>&1
  "$B" wait --load >/dev/null 2>&1
  sleep 1
  for s in "${BASE[@]}"; do
    [ -n "${ONLY:-}" ] && [[ " $ONLY " != *" $s "* ]] && continue
    shoot "$map" "$s"
  done
  for s in "${OVERLAYS[@]}"; do
    [ -n "${ONLY:-}" ] && [[ " $ONLY " != *" $s "* ]] && continue
    # ★ 每扇浮窗前**重新载入一次**：上一扇（尤其魔法屋那种没有 pending 的演出屏）
    #   会留在屏上盖住下一扇 —— 不重载就会把魔法屋当成樂透截下来（实测踩过）。
    "$B" goto "${URL}&map=${map}" >/dev/null 2>&1
    "$B" wait --load >/dev/null 2>&1
    sleep 0.5
    shoot "$map" "$s"
  done
done

python3 - "$OUT" <<'PY'
import html, sys
from pathlib import Path

out = Path(sys.argv[1])
rows = []
for line in (out / "summary.tsv").read_text(encoding="utf-8").splitlines():
    parts = line.split("\t")
    if len(parts) < 3:
        continue
    rows.append({"map": parts[0], "screen": parts[1], "status": parts[2],
                 "errors": parts[3] if len(parts) > 3 else ""})

shots = {(r["map"], r["screen"]): r for r in rows}
maps = sorted({r["map"] for r in rows}, key=lambda m: int(m.replace("map", "")))
screens = []
for r in rows:
    if r["screen"] not in screens:
        screens.append(r["screen"])

ok = [r for r in rows if '"ok":true' in r["status"]]
bad = [r for r in rows if '"ok":true' not in r["status"]]
errs = [r for r in rows if r["errors"].strip()]

p = [html.escape("")]
body = []
body.append("<!doctype html><meta charset='utf-8'><title>全屏扫描（W-12）</title>")
body.append("<style>body{font-family:-apple-system,sans-serif;margin:16px;background:#222;color:#eee}"
            "table{border-collapse:collapse}td{vertical-align:top;padding:4px}"
            "img{width:320px;display:block;border:1px solid #555}.bad{color:#f88}.err{color:#fd8}"
            "h2{margin-top:24px}code{color:#8cf}</style>")
body.append(f"<h1>全屏扫描（W-12）</h1><p>截图 <b>{len(rows)}</b> 张；"
            f"钉住成功 <b>{len(ok)}</b>、打不开 <b class='bad'>{len(bad)}</b>、"
            f"有 console error <b class='err'>{len(errs)}</b> 屏。</p>")
if bad:
    body.append("<p class='bad'>打不开的（见 tools/sweep-screens.js 的 RECIPES）：<br>"
                + "<br>".join(f"{r['map']} / {r['screen']} —— <code>{html.escape(r['status'][:160])}</code>" for r in bad)
                + "</p>")
if errs:
    body.append("<p class='err'>有 console error 的屏：<br>"
                + "<br>".join(f"{r['map']} / {r['screen']} —— <code>{html.escape(r['errors'][:200])}</code>" for r in errs)
                + "</p>")
for m in maps:
    body.append(f"<h2>{html.escape(m)}</h2><table><tr>")
    for s in screens:
        r = shots.get((m, s))
        if r is None:
            continue
        png = f"{m}_{s}.png"
        mark = "" if '"ok":true' in r["status"] else " <span class='bad'>✗</span>"
        body.append(f"<td><div>{html.escape(s)}{mark}</div>"
                    f"<a href='{png}'><img src='{png}' loading='lazy'></a></td>")
    body.append("</tr></table>")
(out / "index.html").write_text("\n".join(body), encoding="utf-8")
print(f"index.html：{len(rows)} 张，成功 {len(ok)}，打不开 {len(bad)}，有 error {len(errs)}")
PY
echo "缩略图墙：$OUT/index.html"
echo "console 汇总：$OUT/console.log"
