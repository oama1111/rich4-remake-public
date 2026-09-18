#!/usr/bin/env python3
"""① f68/f70/f72 改为**有符号**解析（神明三项修正可为负，@source 月度评分写的是 (int16)）；
② 追加「构造字节」测试，把三处修复钉死（两个样本这几格全 0，天然不可观测）。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# ── ① save.ts：有符号解析 ────────────────────────────────────────────
P1 = ROOT / "packages/core/src/loaders/save.ts"
old1 = """    f68: view.getUint16(o + 0x44, true),
    f70: view.getUint16(o + 0x46, true),
    f72: view.getUint16(o + 0x48, true),"""
new1 = """    // ★ 这三项是**神明附身的三项修正**，**可为负**（土地公 −500、大窮神 +200…）：
    //   `rules/objects.ts` 的 `GOD_MODIFIERS` 表；写侧 `@source 0x40ead7`（附身）、
    //   清侧 `0x40e14d`。原版自己也是按**有符号**读的 —— 月度评分那段明确写着
    //   `(int16)player[0x44]`（`rules/monthly.ts` 的 @source `rich4.asm:16680`）⇒ 用 getInt16。
    //   （两份样本这三格全 0，所以「无符号」也能过逐字节往返 —— 又一次"样本不可观测"。）
    f68: view.getInt16(o + 0x44, true),
    f70: view.getInt16(o + 0x46, true),
    f72: view.getInt16(o + 0x48, true),"""
src = P1.read_text(encoding="utf-8")
assert src.count(old1) == 1
P1.write_text(src.replace(old1, new1, 1), encoding="utf-8")
print("✓ save.ts 有符号解析")

# ── ② 测试 ───────────────────────────────────────────────────────────
P2 = ROOT / "packages/core/src/loaders/save-writer.test.ts"
BLOCK = r'''
/**
 * ★★ 「写了但读错/没读」的三个字段 —— **只能靠构造字节验证**。
 *
 * 两个真实存档在 `player+0x43`、`+0x44/0x46/0x48`、`+0x66/+0x67` 上**全是 0**
 * （实测），所以「逐字节往返相等」在这里是**空的**。本用例往真档里写非 0 值再走
 * 完整导入→导出，因此是可证伪的：若哪天有人把映射退回
 * `savedTrafficMethod: f67` / `misfortune: 0`，它会立刻红。
 *
 * 三处修复（第 36 条）：
 *  1. `misfortune`/`fortune`/`luck` ← `+0x44/0x46/0x48`（**有符号**）：先前硬编码 0，
 *     而写侧一直在写 ⇒ 带神明附身的存档读回来三项修正全丢。
 *  2. `savedTrafficMethod` ← `+0x66`（先前读 `+0x43` —— 全 exe 无读无写的死字节）。
 *  3. `savedNdices` ← `+0x67`（先前读 `+0x44`，其实是 misfortune）。
 *     且这两项**写侧先前从来没写** ⇒ 「梦游中被存档→读回→醒来」会把
 *     trafficMethod/ndices 还原成 undefined。
 */
describe('★★ 神明三项修正 + 夢遊卡备份字段（构造字节验证）', () => {
  for (const path of SAVES) {
    const t = existsSync(path) && existsSync(MAP) ? it : it.skip;
    t(`${path.split('/').pop()}：+0x44/46/48 与 +0x66/67 非 0 时能逐字节往返`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      // 构造：玩家 0 = 天使的三项修正（-100/60/60）+ 夢遊备份（2/3）
      const bent = new Uint8Array(bytes);
      const o = 0x0010;
      bent[o + 0x44] = 0x9c; bent[o + 0x45] = 0xff; // -100（i16 补码）
      bent[o + 0x46] = 0x3c; bent[o + 0x47] = 0x00; // 60
      bent[o + 0x48] = 0x3c; bent[o + 0x49] = 0x00; // 60
      bent[o + 0x66] = 2; // savedTrafficMethod
      bent[o + 0x67] = 3; // savedNdices

      const save = parseSave(bent);
      const { state } = importOriginalSave(save, parseMap(new Uint8Array(readFileSync(MAP))));
      const p0 = state.players[0]!;
      // 1. 有符号导入（这正是 `rules/objects.ts` 里**天使**那一行）
      expect(p0.misfortune).toBe(-100);
      expect(p0.fortune).toBe(60);
      expect(p0.luck).toBe(60);
      // 2/3. 夢遊备份读的是 +0x66/+0x67
      expect(p0.savedTrafficMethod).toBe(2);
      expect(p0.savedNdices).toBe(3);

      // 写回：carry 清零也必须一致（证明这三项来自 GameState 而非 carry）
      const zeroed = new Uint8Array(ORIGINAL_STATE_BLOCK_SIZE);
      const out = writeStateBlock({ state, carry: zeroed, mapDataSize: save.mapData.length });
      expect(Array.from(out.subarray(o + 0x44, o + 0x4a))).toEqual([0x9c, 0xff, 0x3c, 0x00, 0x3c, 0x00]);
      expect(Array.from(out.subarray(o + 0x66, o + 0x68))).toEqual([2, 3]);
    });
  }
});
'''
src2 = P2.read_text(encoding="utf-8").rstrip("\n") + "\n" + BLOCK
P2.write_text(src2, encoding="utf-8")
print("✓ 已追加构造字节测试")
