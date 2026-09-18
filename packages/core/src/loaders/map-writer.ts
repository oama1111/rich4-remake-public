/*
 * 原版「地图数据块」的写出
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 与 `save-writer.ts`（状态块）同一套方法：**carry 打底、已建模字段覆盖、逐字节比对**。
 *
 * ⚠️ **不写名字**。地图记录里的 `name` 是 **Big5** 字节，而 web 平台只有 UTF-8 的
 * `TextEncoder`，没有 Big5 编码器 ⇒ 名字字节**只能走 carry**。
 * 这是本模块唯一的"技术性缺口"，不是没做完：要写名字就得自带一张 Big5 表
 * （或从 `@rich4/data` 的名称表按 id 反查原始字节）。
 *
 * @source 字段偏移全部照 `loaders/map.ts` 的 `parseMap`（逐字段带 @source），
 *   写出即其逆。规格见 `rich4-spec/docs/systems/map-format.md`。
 */

import type { Rich4Map } from './map.ts';
import { COMMERCIAL_SIZE, FACILITY_SIZE, LANDSCAPE_SIZE, LAND_SIZE, NODE_SIZE } from './map.ts';

function i16(buf: Uint8Array, off: number, v: number): void {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >> 8) & 0xff;
}

function u16(buf: Uint8Array, off: number, v: number): void {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >> 8) & 0xff;
}

function u32(buf: Uint8Array, off: number, v: number): void {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >>> 8) & 0xff;
  buf[off + 2] = (v >>> 16) & 0xff;
  buf[off + 3] = (v >>> 24) & 0xff;
}

/** 已建模的地图块字段（供测试断言与文档引用） */
export const MODELED_MAP_FIELDS: readonly string[] = [
  'header(10×u32)',
  'node: x/y/adjacentSlots/type/decorIndex/flags',
  'land: x/y/priceStatus/type/owner/level/facing/landPrice/housePrice/rentByLevel/flast',
  'facility: x/y/type/owner/level/facing/priceStatus/researchProject/researchDays/landPrice/rateByLevel/flast',
  'commercial: x/y/stockIndex/type/facing/spriteIndex/landPrice/assetValue/owner/ranking/funds/profit/shares',
  'landscape: x/y/facing/spriteIndex',
];

/**
 * 写出地图数据块。
 *
 * @param map   解析后的地图（`parseMap` 的结果）
 * @param carry 原始字节（通常就是 `save.mapData`）。**必须与 `map` 同源**，
 *              否则写出的是"地图 A 的字段 + 地图 B 的名字/未建模字节"。
 * @param dataSize 写进 `landscapeOff + (numLandscapes+1)*0x1c`
 *                 （@source `0x00407cac`–`0x00407cc9`，见 `map-format.md`）
 */
export function writeMapBlock(map: Rich4Map, carry: Uint8Array, dataSize?: number): Uint8Array {
  const out = new Uint8Array(carry.length);
  out.set(carry);

  // ── 头部 10 个 u32 ─────────────────────────────
  const nodes = map.nodes;
  const lands = map.lands;
  const facilities = map.facilities;
  const commercials = map.commercials;
  const landscapes = map.landscapes;
  // 各表的 offset 沿用 carry 的原值（写出时不重排布局）
  const nodeOff = readU32(carry, 0x04);
  const landOff = readU32(carry, 0x0c);
  const facilityOff = readU32(carry, 0x14);
  const commercialOff = readU32(carry, 0x1c);
  const landscapeOff = readU32(carry, 0x24);
  u32(out, 0x00, nodes.length);
  u32(out, 0x08, lands.length);
  u32(out, 0x10, facilities.length);
  u32(out, 0x18, commercials.length);
  u32(out, 0x20, landscapes.length);

  // ── 节点表 ────────────────────────────────────
  for (const n of nodes) {
    const o = nodeOff + n.id * NODE_SIZE;
    i16(out, o + 0x00, n.x);
    i16(out, o + 0x02, n.y);
    for (let a = 0; a < 4; a++) u16(out, o + 0x18 + a * 2, n.adjacentSlots[a] ?? 0);
    u16(out, o + 0x20, n.type);
    u16(out, o + 0x22, n.decorIndex);
    u32(out, o + 0x24, n.flags);
  }

  // ── 住宅地表 ──────────────────────────────────
  for (const l of lands) {
    const o = landOff + l.id * LAND_SIZE;
    i16(out, o + 0x00, l.x);
    i16(out, o + 0x02, l.y);
    out[o + 0x17] = l.priceStatus & 0xff;
    out[o + 0x18] = l.type & 0xff;
    out[o + 0x19] = l.owner & 0xff;
    out[o + 0x1a] = l.level & 0xff;
    out[o + 0x1b] = l.facing & 0xff;
    u16(out, o + 0x1c, l.landPrice);
    u16(out, o + 0x1e, l.housePrice);
    for (let lv = 0; lv < 6; lv++) u16(out, o + 0x20 + lv * 2, l.rentByLevel[lv] ?? 0);
    u32(out, o + 0x30, l.flast);
  }

  // ── 設施表 ────────────────────────────────────
  for (const f of facilities) {
    const o = facilityOff + f.id * FACILITY_SIZE;
    i16(out, o + 0x00, f.x);
    i16(out, o + 0x02, f.y);
    out[o + 0x18] = f.type & 0xff;
    out[o + 0x19] = f.owner & 0xff;
    out[o + 0x1a] = f.level & 0xff;
    out[o + 0x1b] = f.facing & 0xff;
    out[o + 0x1c] = f.priceStatus & 0xff;
    out[o + 0x1d] = (f.researchProject ?? 0) & 0xff;
    out[o + 0x1e] = (f.researchDays ?? 0) & 0xff;
    u16(out, o + 0x22, f.landPrice);
    for (let lv = 0; lv < 6; lv++) u16(out, o + 0x24 + lv * 2, f.rateByLevel[lv] ?? 0);
    u32(out, o + 0x34, f.flast);
  }

  // ── 上市企业表 ────────────────────────────────
  for (const c of commercials) {
    const o = commercialOff + c.id * COMMERCIAL_SIZE;
    i16(out, o + 0x00, c.x);
    i16(out, o + 0x02, c.y);
    out[o + 0x19] = c.stockIndex & 0xff;
    out[o + 0x1a] = c.type & 0xff;
    out[o + 0x1b] = (c.facing ?? 0) & 0xff;
    u16(out, o + 0x20, c.spriteIndex);
    u16(out, o + 0x22, c.landPrice);
    u32(out, o + 0x24, c.assetValue);
    out[o + 0x18] = c.owner & 0xff;
    // ★★ 运行时四项（先前一直靠 carry ⇒ 玩过之后写的还是装载时的旧值）：
    //   持股排名 `+0x1c..+0x1f`（值 = 玩家下标 + 1，0 = 空位）、
    //   累積盈餘 `+0x28`（**有符号**，每月 15 日分红后清零）、
    //   累計盈餘 `+0x2c`（**有符号**，从不清零）、
    //   自留股数 `+0x30`（`10000 − 流通股数`；静态地图文件里恒 0，存档里才是真值）。
    //   @source 解析侧 `map.ts` 的 `parseCommercials`（同一组偏移，逐字段带注释）。
    for (let r = 0; r < 4; r++) out[o + 0x1c + r] = (c.ranking[r] ?? 0) & 0xff;
    u32(out, o + 0x28, c.funds); // 负数走 `>>>` 的补码，与 getInt32 对称
    u32(out, o + 0x2c, c.profit);
    u32(out, o + 0x30, c.shares);
  }

  // ── 特殊景观表 ────────────────────────────────
  for (const s of landscapes) {
    const o = landscapeOff + s.id * LANDSCAPE_SIZE;
    i16(out, o + 0x00, s.x);
    i16(out, o + 0x02, s.y);
    out[o + 0x18] = (s.facing ?? 0) & 0xff;
    u16(out, o + 0x1a, s.spriteIndex);
  }

  // ── 末尾的长度字段（`map_data_size`） ──────────
  if (dataSize !== undefined) {
    // 它的位置就是「景观表最后一项之后」，与 `parseMap` 的同一式子
    u32(out, landscapeOff + (landscapes.length + 1) * LANDSCAPE_SIZE, dataSize);
  }

  return out;
}

function readU32(buf: Uint8Array, off: number): number {
  return (
    ((buf[off] ?? 0) |
      ((buf[off + 1] ?? 0) << 8) |
      ((buf[off + 2] ?? 0) << 16) |
      ((buf[off + 3] ?? 0) << 24)) >>>
    0
  );
}
