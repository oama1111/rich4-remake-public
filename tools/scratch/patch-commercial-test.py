#!/usr/bin/env python3
"""给 map-state.test.ts 追加：企業运行时四项（排名/累積盈餘/累計盈餘/自留股数）写回文件。"""
from pathlib import Path

P = Path(__file__).resolve().parents[2] / "packages/core/src/loaders/map-state.test.ts"

BLOCK = r'''
/**
 * ★★ 企業表的**运行时四项**：持股排名 `+0x1c..1f`、累積盈餘 `+0x28`、
 * 累計盈餘 `+0x2c`、自留股数 `+0x30`（第 40 条）。
 *
 * `writeMapBlock` 先前只写 `owner(+0x18)`，这四项**全部靠 carry**
 * ⇒ 玩过几步之后（企业收过费、分过红、买卖过自留股）写出的存档里
 * 企业金库与可售股数还是**装载时**的旧值。
 */
describe('★★ 企業运行时四项写出（第 40 条）', () => {
  const path = SAVES[0]!;
  const t = existsSync(path) ? it : it.skip;

  t('排名 / 累積盈餘 / 累計盈餘 / 自留股数 都从 GameState 写出', () => {
    const bytes = new Uint8Array(readFileSync(path));
    const save = parseSave(bytes);
    const map = parseMap(save.mapData);
    const { state } = importOriginalSave(save, parseMap(save.mapData));
    const com = map.commercials[0]!;

    const bent = {
      ...state,
      commercialOwners: state.commercialOwners.map((o, i) =>
        i === com.id ? { ...o, ranking: [2, 3, 0, 0] } : o,
      ),
      companyFunds: state.companyFunds.map((v, i) => (i === com.id ? 48000 : v)),
      companyProfit: state.companyProfit.map((v, i) => (i === com.id ? -30000 : v)),
      commercialShares: state.commercialShares.map((v, i) => (i === com.id ? 1234 : v)),
    };

    const out = writeOriginalSaveFile({ state: bent, map, carry: bytes });
    const base = ORIGINAL_STATE_BLOCK_SIZE;
    const o = base + u32(out, base + 0x1c) + com.id * COMMERCIAL_SIZE;

    expect(Array.from(out.subarray(o + 0x1c, o + 0x20)), '持股排名').toEqual([2, 3, 0, 0]);
    expect(u32(out, o + 0x28) | 0, '累積盈餘（有符号）').toBe(48000);
    expect(u32(out, o + 0x2c) | 0, '累計盈餘（有符号，可为负）').toBe(-30000);
    expect(u32(out, o + 0x30), '自留股数').toBe(1234);

    // 断言非平凡：地图模板里这四项确实不是上面那些值
    expect(com.ranking.join(',')).not.toBe('2,3,0,0');
    expect(com.shares).not.toBe(1234);
  });

  t('★ 对照：不合并时写出的仍是地图模板里的旧值（可证伪）', () => {
    const bytes = new Uint8Array(readFileSync(path));
    const save = parseSave(bytes);
    const map = parseMap(save.mapData);
    const { state } = importOriginalSave(save, parseMap(save.mapData));
    const com = map.commercials[0]!;
    const bent = {
      ...state,
      companyFunds: state.companyFunds.map((v, i) => (i === com.id ? 48000 : v)),
    };
    const merged = withLiveMapState(map, bent);
    expect(merged.commercials[0]!.funds).toBe(48000);
    expect(map.commercials[0]!.funds).toBe(com.funds); // 纯函数，模板未被改
  });
});
'''

src = P.read_text(encoding="utf-8").rstrip("\n") + "\n" + BLOCK
P.write_text(src, encoding="utf-8")
print("已追加；行数 =", len(src.split(chr(10))))
