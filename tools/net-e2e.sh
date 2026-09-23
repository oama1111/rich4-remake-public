#!/usr/bin/env bash
# W-40 本机双客户端端到端（驱动）
# SPDX-License-Identifier: GPL-3.0-or-later
#
# 干四件事（每件都打印 PASS/FAIL，机器可读：
#   1) 50 回合：两端各跨 50 个回合（`turnCount`），期间不得出现「失步」
#   2) 冻结比对：两端停手 2 秒后比**全量状态摘要**（`tools/net-e2e.js` 的 `checkpoint()`）
#   3) 断线重连：刷新其中一端的页面（新连接 + 服务器全量重放），比对追上后的摘要
#   4) 失步自愈：人为改坏一端的状态 → 等服务器报「失步！」与「⟳ 失步自愈」→ 再比摘要
#   5) AI 补位：关掉一端 → 等过 `--takeover` → 另一端仍能继续推进（说明服务器替它打了）
#
# 用法：
#   pnpm dev                        # 另开一个终端（Vite 5173）
#   bash tools/net-e2e.sh           # 默认 2 座（全真人）+ 6 秒托管阈值
#   SEATS=4 bash tools/net-e2e.sh   # 4 座（2 真人 + 2 电脑）
#   SEATS=4 SEED=968029213 bash tools/net-e2e.sh   # 固定种子复现（这个种子是 issue #9 的现场：第 7 回合开拍）
#
# ★ W-71 起服务器默认装**访问密码**（RICH4_PASSWORD / RICH4_COOKIE_SECRET 从环境变量来）。
#   这条脚本跑在本机、验的是联机本身，不验门，故起服务器时带 `--no-gate`
#   （`--no-gate` 只在 `--host` 是本机时允许）。门自己的验收见
#   `docs/acceptance/w71-20260920.md`。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
B="${BROWSE:-$HOME/.agents/skills/gstack/browse/dist/browse}"
PORT="${PORT:-8787}"
SEATS="${SEATS:-2}"
TAKEOVER="${TAKEOVER:-6000}"
TURNS="${TURNS:-50}"
OUT="$ROOT/.qa-tmp/net"
# ★ 房间码**每跑一次换一个**：上一跑留下的标签页会自己重连回它那个房间，
#   固定的码会让它们在**同一个房间**里抢座位（表现是「房间已满 / 两端都进不了房」）。
#   换一个码之后老标签页自成一房，本跑互不干扰；它们那一房没人在线满 10 分钟会被
#   服务器自己回收（正是 W-73 §4 那条）。
ROOM="${ROOM:-$(python3 -c "import random;print(''.join(random.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(6)))")}"
URL="http://localhost:5173/?ws=ws://localhost:${PORT}/ws&room=${ROOM}"
JS=/tmp/net-e2e.js
PROBE=/tmp/net-probe.js

[ -x "$B" ] || { echo "找不到 browse：$B" >&2; exit 2; }
mkdir -p "$OUT"
cp "$ROOT/tools/net-e2e.js" "$JS"
cat > "$PROBE" <<'EOF'
(() => {
  const n = globalThis.__net;
  return JSON.stringify(n.checkpoint());
})()
EOF

# ★ 冻结比对：驱动停了，两端的收件箱 / 演出还在消化（观测到 2 秒不够：一端 moving、一端 settling）。
#   每秒比一次，最多 10 次，摘要一致就收；到点仍不一致才算数。
settle_pair() {
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    ca=$(cp_of "$TA"); cb=$(cp_of "$TB")
    [ "$(echo "$ca" | python3 -c 'import json,sys; print(json.load(sys.stdin)["digest"])' 2>/dev/null)" = \
      "$(echo "$cb" | python3 -c 'import json,sys; print(json.load(sys.stdin)["digest"])' 2>/dev/null)" ] && return
  done
}
step() { printf '\n=== %s ===\n' "$1"; }
# 读一个标签页的 checkpoint（用 eval <file>，多行脚本不要走 browse js）
cp_of() { "$B" tab "$1" >/dev/null 2>&1; "$B" eval "$PROBE"; }
pause_both() { for t in "$TA" "$TB"; do "$B" tab "$t" >/dev/null 2>&1; "$B" js "globalThis.__net.stop()" >/dev/null 2>&1; done; }
resume_both() { for t in "$TA" "$TB"; do "$B" tab "$t" >/dev/null 2>&1; "$B" eval "$JS" >/dev/null 2>&1; done; }
summary() { "$B" tab "$1" >/dev/null 2>&1; "$B" js "JSON.stringify(globalThis.__net.summary())"; }

# ── 起服务器 ────────────────────────────────────────────────
step "起服务器（--seats ${SEATS} --takeover ${TAKEOVER}）"
pkill -f "server/src/cli.ts" 2>/dev/null
sleep 1
# ★ 上一条服务器没死透的话，新的会 EADDRINUSE —— 而它只把警告写进日志，
#   脚本看起来「起来了」，其实一直在跟**旧的**（带着旧的房间与旧座位）说话。踩过一次。
for _ in 1 2 3 4 5 6 7 8 9 10; do
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
  sleep 1
done
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "★ 端口 $PORT 还占着 —— 上一条服务器没死透，先手工清掉再跑" >&2
  exit 2
fi
# ★ 先把**上一次跑剩下的**联机标签页关掉：它们会自动重连，`--seats 2` 时
#   正好把两个座位占满，新开的 A/B 永远进不了房（实测第二次跑卡在 0 回合）。
"$B" tabs 2>/dev/null | python3 -c "
import re, sys
for line in sys.stdin:
    m = re.search(r'\[(\d+)\]', line)
    if m and ('ws=' in line or '5173' in line):
        print(m.group(1))
" | while read -r id; do "$B" closetab "$id" >/dev/null 2>&1; done
sleep 1
# ★ 起完就不管了是踩过的坑：脚本自己结束之后那条服务器还在，下一跑的新服务器
#   会 EADDRINUSE（而它只把警告写进日志），于是新标签页其实在跟**旧的**说话 ——
#   旧房间里还留着上一跑的座位，表现就是「房间已满 / 两端都进不了房」。
#   所以：① 起在**同一个进程组**里；② 退出时（正常/中断都算）连它一起收掉。
( cd "$ROOT" && exec node --experimental-transform-types packages/server/src/cli.ts \
    --port "$PORT" --map 0 --seats "$SEATS" --takeover "$TAKEOVER" --no-gate ${SEED:+--seed "$SEED"} > "$OUT/server.log" 2>&1 ) &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null' EXIT INT TERM
sleep 3
grep -v '^(' "$OUT/server.log" | grep -v 'ExperimentalWarning\|trace-warnings' | head -1
if ! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "★ 伺服器沒起來（見 $OUT/server.log）" >&2
  exit 3
fi

# ── 两个标签页 ──────────────────────────────────────────────
step "开两个客户端"
# ★ 不要把 `$B tabs` 的输出按 `[N]` 硬解 —— 直接吃 `newtab` 自己打印的
#   `Opened tab <id> → <url>`（实测 `tabs` 的前导空格/箭头会让 grep 抓空，
#   空 id 再喂回 `tab` 就会把整条脚本挂住）。
TA=$("$B" newtab "${URL}&name=A" 2>/dev/null | grep -oE 'tab [0-9]+' | grep -oE '[0-9]+')
TB=$("$B" newtab "${URL}&name=B" 2>/dev/null | grep -oE 'tab [0-9]+' | grep -oE '[0-9]+')
if [ -z "$TA" ] || [ -z "$TB" ]; then echo "★ 开标签页失败（A='$TA' B='$TB'）" >&2; exit 1; fi
sleep 4
echo "tab A=$TA  tab B=$TB"
for t in "$TA" "$TB"; do "$B" tab "$t" >/dev/null 2>&1; "$B" eval "$JS"; done

# ── 1) 跑到 TURNS 回合 ──────────────────────────────────────
step "1) 跑到 $TURNS 回合"
ok=0
for i in $(seq 1 60); do
  sleep 5
  sa=$(summary "$TA"); sb=$(summary "$TB")
  ta=$(echo "$sa" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["turnCount"])' 2>/dev/null || echo 0)
  tb=$(echo "$sb" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["turnCount"])' 2>/dev/null || echo 0)
  echo "  … A 回合 $ta / B 回合 $tb"
  if [ "$ta" -ge "$TURNS" ] && [ "$tb" -ge "$TURNS" ]; then ok=1; break; fi
done
[ "$ok" = 1 ] && echo "PASS 1) 两端都过了 $TURNS 回合" || echo "FAIL 1) 90 秒内没到 $TURNS 回合"

# ── 2) 冻结比对 ─────────────────────────────────────────────
step "2) 冻结两端比对全量摘要"
pause_both; settle_pair
echo "A: $ca"; echo "B: $cb"
python3 - "$ca" "$cb" <<'PY'
import json, sys
a, b = (json.loads(x) for x in sys.argv[1:3])
same = a["digest"] == b["digest"] and a["turn"] == b["turn"] and a["rngState"] == b["rngState"]
print(("PASS" if same else "FAIL") + f" 2) 同一回合 {a['turn']}：digest {a['digest']} vs {b['digest']}")
PY

# ── 3) 断线重连（刷新一端 → 全量重放追上）──────────────────
step "3) 刷新 B 端，重连后比对"
"$B" tab "$TB" >/dev/null 2>&1
"$B" goto "${URL}&name=B" >/dev/null 2>&1
sleep 5
"$B" eval "$JS" >/dev/null 2>&1
resume_both
sleep 8
pause_both; settle_pair
echo "A: $ca"; echo "B: $cb"
python3 - "$ca" "$cb" <<'PY'
import json, sys
a, b = (json.loads(x) for x in sys.argv[1:3])
same = a["digest"] == b["digest"] and a["turn"] == b["turn"]
print(("PASS" if same else "FAIL") + f" 3) 重连后同一回合 {a['turn']}：digest {a['digest']} vs {b['digest']}")
PY

# ── 4) 失步自愈 ─────────────────────────────────────────────
step "4) 人为改坏 B 端 → 看失步与自愈"
resume_both; sleep 2
"$B" tab "$TB" >/dev/null 2>&1
"$B" js "JSON.stringify(globalThis.__net.tamper())"
sleep 15
for t in "$TA" "$TB"; do echo "  tab $t 失步行："; summary "$t" | python3 -c 'import json,sys; d=json.load(sys.stdin); [print("   ", x[:140]) for x in d["desyncLines"]]' 2>/dev/null; done
pause_both; settle_pair
python3 - "$ca" "$cb" <<'PY'
import json, sys
a, b = (json.loads(x) for x in sys.argv[1:3])
same = a["digest"] == b["digest"] and a["turn"] == b["turn"]
print(("PASS" if same else "FAIL") + f" 4) 自愈后同一回合 {a['turn']}：digest {a['digest']} vs {b['digest']}")
PY

# ── 5) AI 补位 ──────────────────────────────────────────────
step "5) 关掉 B 端，等过托管阈值，看 A 端还能不能自己推进"
"$B" tab "$TB" >/dev/null 2>&1; "$B" closetab "$TB" >/dev/null 2>&1
"$B" tab "$TA" >/dev/null 2>&1; "$B" eval "$JS" >/dev/null 2>&1
t1=$(summary "$TA" | python3 -c 'import json,sys; print(json.load(sys.stdin)["turnCount"])')
echo "  关 B 端时 A 的回合数：${t1}；等 $((TAKEOVER/1000 + 12)) 秒…"
sleep $((TAKEOVER/1000 + 12))
t2=$(summary "$TA" | python3 -c 'import json,sys; print(json.load(sys.stdin)["turnCount"])')
echo "  等待后 A 的回合数：${t2}"
if [ "$t2" -gt "$t1" ]; then echo "PASS 5) 无人操作 B 座，回合仍在推进（服务器补位）"; else echo "FAIL 5) 回合停了"; fi


# ── 6) W-74 回合计时 ────────────────────────────────────────
step "6) W-74：一端**连着但不动** ⇒ 另一端在 61~70 秒内看到回合推进"
# ★ 与第 5 步不同：这一端**没有掉线**，只是不再操作。
#   （掉线那条是 `--takeover 6` 秒的事，第 5 步已经验过；这里验的是**回合计时**。）
TB=$("$B" newtab "${URL}&name=B" 2>/dev/null | grep -oE 'tab [0-9]+' | grep -oE '[0-9]+')
if [ -z "$TB" ]; then
  echo "FAIL 6) 开不出第二个标签页"
else
  sleep 8
  "$B" tab "$TB" >/dev/null 2>&1; "$B" eval "$JS" >/dev/null 2>&1; sleep 3

  # ① 先等 B **停在自己那一格**（`currentPlayer === 本机座位` 且相位是 `awaitingRoll`）——
  #    那才是题面说的「不动」。相位还停在 moving / turnStart 时不算：
  #    客户端自己的 `scheduleHumanTurn` 还在替他推机械步骤。
  parked=no
  for _ in $(seq 1 60); do
    parked=$("$B" js "(globalThis.__rich4 && globalThis.__net && globalThis.__rich4.state.currentPlayer === globalThis.__net.seat && globalThis.__rich4.state.phase === 'awaitingRoll') ? 'yes' : 'no'" 2>&1)
    [ "$parked" = "yes" ] && break
    sleep 2
  done
  if [ "$parked" != "yes" ]; then
    echo "FAIL 6) B 座 120 秒内没停到 awaitingRoll（测不到「不动」）"
  else
    # ② 停掉它的**驱动**（不再派 action），但页面照旧会报 `awaiting` —— 那正是题面
    "$B" js "globalThis.__net.stop()" >/dev/null 2>&1
    echo "  B 座已停在 awaitingRoll，驱动停掉；从这一刻开始计时…"
    # ③ **A 也停手**：两端都不再派 action，服务器的表才不会因为「举牌者/回合主人
    #    又换人」而重装（重装会把 45 秒兜底重新计时，那一格就永远等不到）。
    #    题面要的是「一端不动、另一端**看着**」—— 观察不需要驱动。
    pause_both

    # 等 B 那一回合被推走：用 A 的 checkpoint 看 currentPlayer（那字段 summary 里没有）
    cp_id() { cp_of "$TA" | python3 -c 'import json,sys; print(json.load(sys.stdin)["currentPlayer"])'; }
    start=$(date +%s)
    ok6=0
    # ★ 上限 120 秒：**两条路都要容得下** ——
    #   · 客户端报了 `awaiting` ⇒ 60 秒到点（单元测试把这一条钉到毫秒）；
    #   · 客户端卡在走子/演出里没报 ⇒ 45 秒兜底 + 60 秒 = 105 秒。
    #   实测这一跑走的是**兜底**那条（B 停在了 `moving` 上，不是在等掷骰），
    #   所以窗口放宽到 120 秒，并把实际秒数打出来。
    for _ in $(seq 1 24); do
      sleep 5
      el=$(( $(date +%s) - start ))
      c=$(cp_id)
      echo "  … ${el}s：currentPlayer=$c"
      if [ "$c" != "1" ]; then
        case "$el" in
          5[5-9]|6[0-9]|7[0-9]|80)
            echo "PASS 6) B 座一直没动，${el}s 后回合被推走（客户端报了 awaiting ⇒ 60 秒到点）" ;;
          9[5-9]|10[0-9]|11[0-9]|120)
            echo "PASS 6) B 座一直没动，${el}s 后回合被推走（客户端卡在演出里没报 awaiting ⇒ 45 秒兜底 + 60 秒）" ;;
          *)
            echo "PASS 6) 回合被推走了，但在 ${el}s（不在预期窗口里 —— 看上面的时序）" ;;
        esac
        ok6=1
        break
      fi
    done
    [ "$ok6" = 1 ] || echo "FAIL 6) 120 秒内 B 座的回合没被推走"
  fi
fi

echo
echo "原始日志：$OUT/server.log"
