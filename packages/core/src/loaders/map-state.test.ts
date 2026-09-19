/*
 * 地图块写出：**实时状态**必须合进静态地图模板
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版把归属/等级/种类/涨价档/地契到期日都存在**地图块**里，而本引擎的实时值住在
 * `GameState` 的扁平数组里（`landOwner` / `facilityLevel` / …）。
 * `writeMapBlock` 原本直接读 `map.lands[i].owner` ⇒ 写出的永远是**装载时**的归属。
 *
 * 为什么一直没被测出来：两份真实存档「读进来再写回去」逐字节相等 —— 那一刻
 * state 与 map 恰好一致（本文件第 1 组用例把这条实测钉住）。所以必须**改动状态**再写，
 * 才能把这个坑暴露出来（第 2 组）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseSave } from './save.ts';
import { COMMERCIAL_SIZE, FACILITY_SIZE, LAND_SIZE, parseMap } from './map.ts';
import { importOriginalSave } from './savegame.ts';
import { withLiveMapState } from './map-state.ts';
import { writeMapBlock } from './map-writer.ts';
import { ORIGINAL_STATE_BLOCK_SIZE, writeOriginalSaveFile } from './save-writer.ts';

const ROOT = (process.env.RICH4_WORKSPACE ?? '');
const SAVES = [`${ROOT}/Rich4/Save0.dat`, `${ROOT}/Rich4/SAVE1.DAT`];

const u32 = (b: Uint8Array, o: number): number =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
const u16 = (b: Uint8Array, o: number): number => (b[o]! | (b[o + 1]! << 8)) >>> 0;

/** 从写出文件里取出地图块的某张表的某项某字段 */
function mapByte(
  out: Uint8Array,
  table: 'land' | 'facility' | 'commercial',
  id: number,
  field: number,
): number {
  const base = ORIGINAL_STATE_BLOCK_SIZE;
  const off = u32(out, base + (table === 'land' ? 0x0c : table === 'facility' ? 0x14 : 0x1c));
  const size = table === 'land' ? LAND_SIZE : table === 'facility' ? FACILITY_SIZE : COMMERCIAL_SIZE;
  return out[base + off + id * size + field]!;
}

describe('★ 装载后 state 与 map 一致 —— 这就是往返测试测不出坑的原因', () => {
  for (const path of SAVES) {
    const t = existsSync(path) ? it : it.skip;
    t(`${path.split('/').pop()}：55 块地 / 8 处設施 / 企業的归属全一致`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      const save = parseSave(bytes);
      const map = parseMap(save.mapData);
      const { state } = importOriginalSave(save, parseMap(save.mapData));
      const landMismatch = map.lands.filter((l) => (state.landOwner[l.id] ?? -1) !== l.owner);
      const facMismatch = map.facilities.filter((f) => (state.facilityOwner[f.id] ?? -1) !== f.owner);
      expect(landMismatch.map((l) => l.id)).toEqual([]);
      expect(facMismatch.map((f) => f.id)).toEqual([]);
      // 于是「合并前后」写出的地图块逐字节相同
      const carry = bytes.subarray(ORIGINAL_STATE_BLOCK_SIZE, ORIGINAL_STATE_BLOCK_SIZE + save.mapData.length);
      expect(
        Buffer.from(writeMapBlock(withLiveMapState(map, state), carry)).equals(
          Buffer.from(writeMapBlock(map, carry)),
        ),
      ).toBe(true);
    });
  }
});

describe('★★ 改动状态后写出 ⇒ 地图块必须反映实时值（第 39 条）', () => {
  const path = SAVES[0]!;
  const t = existsSync(path) ? it : it.skip;

  t('地块 + 設施 + 企業的每个「会变」字段都写进去了', () => {
    const bytes = new Uint8Array(readFileSync(path));
    const save = parseSave(bytes);
    const map = parseMap(save.mapData);
    const { state } = importOriginalSave(save, parseMap(save.mapData));
    const land = map.lands[0]!;
    const fac = map.facilities[0]!;
    const com = map.commercials[0]!;

    // 构造一个「玩过几步」的状态：每个字段都改成与地图初值不同的值
    const bent = {
      ...state,
      landOwner: state.landOwner.map((v, i) => (i === land.id ? 3 : v)),
      landLevel: state.landLevel.map((v, i) => (i === land.id ? 4 : v)),
      landType: state.landType.map((v, i) => (i === land.id ? 1 : v)),
      landPriceStatus: state.landPriceStatus.map((v, i) => (i === land.id ? 0x50 : v)),
      landTenure: state.landTenure.map((v, i) => (i === land.id ? 0x07e5060f : v)),
      landPrice: state.landPrice.map((v, i) => (i === land.id ? 4321 : v)),
      facilityOwner: state.facilityOwner.map((v, i) => (i === fac.id ? 2 : v)),
      facilityLevel: state.facilityLevel.map((v, i) => (i === fac.id ? 3 : v)),
      facilityType: state.facilityType.map((v, i) => (i === fac.id ? 4 : v)),
      facilityPriceStatus: state.facilityPriceStatus.map((v, i) => (i === fac.id ? 0x51 : v)),
      facilityTenure: state.facilityTenure.map((v, i) => (i === fac.id ? 0x07e5060f : v)),
      facilityResearchProject: state.facilityResearchProject.map((v, i) => (i === fac.id ? 2 : v)),
      facilityResearchDays: state.facilityResearchDays.map((v, i) => (i === fac.id ? 9 : v)),
      commercialOwners: state.commercialOwners.map((o, i) => (i === com.id ? { ...o, owner: 4 } : o)),
    };

    const out = writeOriginalSaveFile({ state: bent, map, carry: bytes });

    expect(mapByte(out, 'land', land.id, 0x19), '地块 owner').toBe(3);
    expect(mapByte(out, 'land', land.id, 0x1a), '地块 level').toBe(4);
    expect(mapByte(out, 'land', land.id, 0x18), '地块 type').toBe(1);
    expect(mapByte(out, 'land', land.id, 0x17), '地块 priceStatus').toBe(0x50);
    expect(u32(out, ORIGINAL_STATE_BLOCK_SIZE + u32(out, ORIGINAL_STATE_BLOCK_SIZE + 0x0c) + land.id * LAND_SIZE + 0x30), '地块 flast').toBe(0x07e5060f);
    expect(
      u16(out, ORIGINAL_STATE_BLOCK_SIZE + u32(out, ORIGINAL_STATE_BLOCK_SIZE + 0x0c) + land.id * LAND_SIZE + 0x1c),
      '地块 landPrice',
    ).toBe(4321);

    expect(mapByte(out, 'facility', fac.id, 0x19), '設施 owner').toBe(2);
    expect(mapByte(out, 'facility', fac.id, 0x1a), '設施 level').toBe(3);
    expect(mapByte(out, 'facility', fac.id, 0x18), '設施 type').toBe(4);
    expect(mapByte(out, 'facility', fac.id, 0x1c), '設施 priceStatus').toBe(0x51);
    expect(mapByte(out, 'facility', fac.id, 0x1d), '設施 researchProject').toBe(2);
    expect(mapByte(out, 'facility', fac.id, 0x1e), '設施 researchDays').toBe(9);
    expect(
      u32(out, ORIGINAL_STATE_BLOCK_SIZE + u32(out, ORIGINAL_STATE_BLOCK_SIZE + 0x14) + fac.id * FACILITY_SIZE + 0x34),
      '設施 flast',
    ).toBe(0x07e5060f);

    expect(mapByte(out, 'commercial', com.id, 0x18), '企業 owner').toBe(4);
  });

  t('★ 直接对比：不合并时写出的仍是装载时的旧值（可证伪）', () => {
    const bytes = new Uint8Array(readFileSync(path));
    const save = parseSave(bytes);
    const map = parseMap(save.mapData);
    const { state } = importOriginalSave(save, parseMap(save.mapData));
    const land = map.lands[0]!;
    const bent = { ...state, landOwner: state.landOwner.map((v, i) => (i === land.id ? 3 : v)) };

    const merged = withLiveMapState(map, bent);
    expect(merged.lands[0]!.owner).toBe(3);
    // 原地图模板本身没被改（纯函数）
    expect(map.lands[0]!.owner).toBe(land.owner);
    expect(land.owner).not.toBe(3); // 样本上这个字段本来不是 3，断言才有意义
  });
});

describe('★ 快照的地图副本也由该快照状态派生', () => {
  const path = SAVES[0]!;
  const t = existsSync(path) ? it : it.skip;

  t('给 snapshots 时，每玩家的地图副本反映的是那份状态', () => {
    const bytes = new Uint8Array(readFileSync(path));
    const save = parseSave(bytes);
    const map = parseMap(save.mapData);
    const { state } = importOriginalSave(save, parseMap(save.mapData));
    const M = save.mapData.length;
    const land = map.lands[0]!;

    const snap = { ...state, landOwner: state.landOwner.map((v, i) => (i === land.id ? 3 : v)) };
    const out = writeOriginalSaveFile({
      state,
      map,
      carry: bytes,
      snapshots: [snap, null, null, null],
    });

    // 第 0 槽的地图副本 + 0x0c 处的 landOff，再 + id*0x34 + 0x19
    const copyStart = ORIGINAL_STATE_BLOCK_SIZE + M + 10008;
    const landOff = u32(out, copyStart + 0x0c);
    expect(out[copyStart + landOff + land.id * LAND_SIZE + 0x19]).toBe(3);
    // 没有快照的槽保持 carry（与从前一致）
    const slot1 = ORIGINAL_STATE_BLOCK_SIZE + M + (10008 + M);
    expect(
      Buffer.from(out.subarray(slot1 + 10008, slot1 + 10008 + M)).equals(
        Buffer.from(bytes.subarray(slot1 + 10008, slot1 + 10008 + M)),
      ),
    ).toBe(true);
  });
});

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
