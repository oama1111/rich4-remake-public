#!/usr/bin/env python3
"""第 37 条：命運事件的「神明加持」掷随机数**只在 50<值≤100 这一档**（原版如此）。
先前 `reduce.ts` 无条件 `rng.next()` ⇒ 每次带加持的命運事件都让随机序列多走一步。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# ── ① 修 reduce.ts ───────────────────────────────────────────────────
P1 = ROOT / "packages/core/src/state/reduce.ts"
E1 = [
    (
        "import 补阈值",
        "import { blessingFieldOf, blessingLevelFor } from '../rules/blessing.ts';",
        "import {\n  BLESSING_CHANCE_THRESHOLD,\n  BLESSING_DOUBLE_THRESHOLD,\n  blessingFieldOf,\n  blessingLevelFor,\n} from '../rules/blessing.ts';",
        1,
    ),
    (
        "条件掷随机数",
        """  const blessKind = fortuneEvent(effectiveId)?.blessing;
  const rng = new WatcomRng();
  rng.setState(withDeck.rngState);
  const coinFlip = rng.next() & 1;
  const blessLevel =
    blessKind === undefined
      ? 0
      : blessingLevelFor(blessingFieldOf(me, blessKind), coinFlip, blessKind);""",
        """  const blessKind = fortuneEvent(effectiveId)?.blessing;
  const rng = new WatcomRng();
  rng.setState(withDeck.rngState);
  // ★★ 只有 `50 < 加持值 ≤ 100` 这一档才掷一次 `rand() & 1`。
  //   @source `0x44b8c1` 的分档：`cmp si,0x64 / jle 查50`（>100 直接定档、**不掷**）
  //   → `cmp si,0x32 / jle 查负`（≤50 也**不掷**）→ 只有落在中间才 `call 0x456f2d`。
  //   ⚠️ 先前这里**无条件** `rng.next()`：于是每一次带神明加持的命運事件都会让
  //      随机序列多走一步（`rngState` 又写回了状态）⇒ 之后所有随机事件整体错位。
  //      这正是本文件第 8/9/10 条修过的同一类错误（簇 C）。
  let blessLevel = 0;
  if (blessKind !== undefined) {
    const blessValue = blessingFieldOf(me, blessKind);
    const needsRoll =
      blessValue > BLESSING_CHANCE_THRESHOLD && blessValue <= BLESSING_DOUBLE_THRESHOLD;
    const coinFlip = needsRoll ? rng.next() & 1 : 0;
    blessLevel = blessingLevelFor(blessValue, coinFlip, blessKind);
  }""",
        1,
    ),
]
src = P1.read_text(encoding="utf-8")
for name, old, new, want in E1:
    got = src.count(old)
    if got != want:
        raise SystemExit(f"✗ [reduce.ts/{name}] 期望 {want} 实际 {got}")
    src = src.replace(old, new, want)
    print(f"✓ reduce.ts / {name}")
P1.write_text(src, encoding="utf-8")

# ── ② 追加测试 ───────────────────────────────────────────────────────
P2 = ROOT / "packages/core/src/state/events-integration.test.ts"
BLOCK = r'''
/**
 * ★★ 「神明加持」的随机数消耗**只在 50 < 值 ≤ 100 这一档**（第 37 条）。
 *
 * @source `0x44b8c1`：`cmp si,0x64 / jle 查50`（>100 直接定档、不掷）
 *   → `cmp si,0x32 / jle 查负`（≤50 也不掷）→ 只有中间那一档 `call 0x456f2d`。
 *
 * 事件 2（冒貸，`blessing: 'penalty'`）本身不掷随机数，故它是干净的探针：
 * 加持值落在不掷的档位时，整场结算的 `rngState` 必须**一个字节都不动**。
 * 先前 `reduce.ts` 无条件 `rng.next()`，这两条会红。
 */
describe('★★ 命運「神明加持」的 rand 只在 50<值≤100 掷（第 37 条）', () => {
  /** 把命運牌堆拨到「下一张就是 2（冒貸）」，并把当前玩家的 fortune 设成给定值 */
  function setup(fortune: number): { state: GameState; topo: ReturnType<typeof topoOf> } | null {
    const map = loadMap();
    const topo = topoOf(map);
    const base = newGame({ map, players: players(), seed: 5 });
    const on = standOn(base, map, SPECIAL_KIND.FORTUNE);
    if (on === null) return null;
    const state: GameState = {
      ...on,
      fortuneDeck: { order: [2, ...on.fortuneDeck.order.filter((x) => x !== 2)], cursor: 0 },
      players: on.players.map((p, i) => (i === on.currentPlayer ? { ...p, fortune } : p)),
    };
    return { state, topo };
  }

  run('值 ∈ {>100, 101, 50, 0, 负} ⇒ 不掷：整场结算 rngState 原样', () => {
    for (const v of [200, 101, 50, 0, -1]) {
      const env = setup(v);
      if (env === null) return; // 这张图没有命運格
      const after = reduce(env.state, { type: 'settle' }, env.topo);
      expect(after.lastEvent?.kind).toBe('fortune');
      expect(after.lastEvent?.id).toBe(2); // 确实抽到了探针事件
      expect(after.rngState, `fortune=${v} 时不应消耗随机数`).toBe(env.state.rngState);
    }
  });

  run('值 = 75（与 100）⇒ 恰好前进一次（手工推一步作真值）', () => {
    for (const v of [75, 100]) {
      const env = setup(v);
      if (env === null) return;
      const rng = new WatcomRng();
      rng.setState(env.state.rngState);
      rng.next(); // 唯一的那一次
      const after = reduce(env.state, { type: 'settle' }, env.topo);
      expect(after.lastEvent?.id).toBe(2);
      expect(after.rngState, `fortune=${v} 应恰好前进一步`).toBe(rng.getState());
    }
  });
});
'''
src2 = P2.read_text(encoding="utf-8").rstrip("\n") + "\n" + BLOCK
# 补 import
old_imp = "import { topoOf } from '../testing/factories.ts';"
new_imp = "import { topoOf } from '../testing/factories.ts';\nimport { WatcomRng } from '../rules/rng.ts';"
assert src2.count(old_imp) == 1, src2.count(old_imp)
src2 = src2.replace(old_imp, new_imp, 1)
P2.write_text(src2, encoding="utf-8")
print("✓ 已追加测试")
