#!/usr/bin/env python3
"""第 41 条：① 审计脚本补上「助手调用」的偏移（`writePlayerBlock(out, state, 0x0010)`）；
② 追加构造字节测试（landTenureIndex / 胜利条件在两个样本里恒 0，样本不可观测）。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# ── ① 审计脚本：补助手调用 ───────────────────────────────────────────
P0 = ROOT / "tools/scratch/audit-state-block.py"
s0 = P0.read_text(encoding="utf-8")
old0 = """# 循环里的 `0x0654 + p.index * 15 + k` 这类：取基址
for m in re.finditer(r"(0x[0-9a-f]{4,}) \\+ ", body):
    writes.add(int(m.group(1), 16))"""
new0 = """# 循环里的 `0x0654 + p.index * 15 + k` 这类：取基址
for m in re.finditer(r"(0x[0-9a-f]{4,}) \\+ ", body):
    writes.add(int(m.group(1), 16))
# ⚠️ 助手调用里的字面偏移，例如 `writePlayerBlock(out, state, 0x0010)`
#    —— 第一版漏了这条，把玩家块误报成"整块走 carry"。
for m in re.finditer(r"\\w+\\(out, state, (0x[0-9a-f]+)", body):
    writes.add(int(m.group(1), 16))"""
assert s0.count(old0) == 1
P0.write_text(s0.replace(old0, new0, 1), encoding="utf-8")
print("✓ 审计脚本补助手调用")

# ── ② 测试 ───────────────────────────────────────────────────────────
P = ROOT / "packages/core/src/loaders/save-writer.test.ts"
BLOCK = r'''
/**
 * ★★ 第 41 条并入完全建模的 8 个块 —— 其中 5 个在两个样本里**本身就非零**
 * （`tools` 多人有道具、`toolStock` = [9,1,10,10,9,9,5,1]、`gameMap/gameStage` = (3,0)/(3,1)、
 * `initialFund` = 300000），所以上面那条「carry 清零后仍逐字节相等」已经把
 * **它们真的从 `GameState` 写出来**证死了。
 *
 * 剩下三个（`landTenureIndex` `0x267e`、两条勝利條件 `0x2682/0x2686`）
 * 在两个样本里**恒为 0** ⇒ 只能**构造字节**来钉。
 */
describe('★★ 只在样本里恒 0 的三个块（构造字节验证，第 41 条）', () => {
  for (const path of SAVES) {
    const t = existsSync(path) && existsSync(MAP) ? it : it.skip;
    t(`${path.split('/').pop()}：土地權限档位 + 两条勝利條件写出后能读回`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      const save = parseSave(bytes);
      const { state } = importOriginalSave(save, parseMap(new Uint8Array(readFileSync(MAP))));
      // 先确认这三格在样本里确实是 0（否则这条用例就不是"构造"而是"复读"）
      const u32at = (b: Uint8Array, o: number): number =>
        (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
      expect(u32at(bytes, 0x267e)).toBe(0);
      expect(u32at(bytes, 0x2682)).toBe(0);
      expect(u32at(bytes, 0x2686)).toBe(0);

      const bent = {
        ...state,
        landTenureIndex: 3,
        winConditions: { targetDays: 300, targetWealth: 2_000_000 },
      };
      const zeroed = new Uint8Array(ORIGINAL_STATE_BLOCK_SIZE);
      const out = writeStateBlock({ state: bent, carry: zeroed, mapDataSize: save.mapData.length });
      expect(u32at(out, 0x267e), '土地權限档位').toBe(3);
      expect(u32at(out, 0x2682), '勝利條件·天').toBe(300);
      expect(u32at(out, 0x2686), '勝利條件·資產').toBe(2_000_000);
    });
  }

  for (const path of SAVES) {
    const t = existsSync(path) && existsSync(MAP) ? it : it.skip;
    t(`${path.split('/').pop()}：gameMap/gameStage 是 globalMapId 的两位拆分`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      const save = parseSave(bytes);
      const { state } = importOriginalSave(save, parseMap(new Uint8Array(readFileSync(MAP))));
      expect(state.globalMapId).toBe(save.gameStage * 4 + save.gameMap);
      const zeroed = new Uint8Array(ORIGINAL_STATE_BLOCK_SIZE);
      const out = writeStateBlock({ state, carry: zeroed, mapDataSize: save.mapData.length });
      expect(out[0x0008]! | (out[0x0009]! << 8)).toBe(save.gameMap);
      expect(out[0x000a]! | (out[0x000b]! << 8)).toBe(save.gameStage);
      // 非平凡：样本的 map/stage 不是 (0,0)
      expect(save.gameMap + save.gameStage).toBeGreaterThan(0);
    });
  }
});
'''
src = P.read_text(encoding="utf-8").rstrip("\n") + "\n" + BLOCK
P.write_text(src, encoding="utf-8")
print("✓ 已追加测试")
