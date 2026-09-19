/*
 * 地图数据块写出 —— 逐字节往返验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 方法与状态块完全相同：**carry 打底、已建模字段覆盖、逐字节比对**。
 * ⚠️ 名字是 Big5，web 没有编码器 ⇒ 名字字节走 carry（见 `map-writer.ts` 的说明）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseMap } from './map.ts';
import { parseSave } from './save.ts';
import { writeMapBlock } from './map-writer.ts';

const ROOT = (process.env.RICH4_WORKSPACE ?? '');
const SAVES = [`${ROOT}/Rich4/Save0.dat`, `${ROOT}/Rich4/SAVE1.DAT`];

describe('★ 地图数据块：往返逐字节', () => {
  for (const path of SAVES) {
    const t = existsSync(path) ? it : it.skip;
    const name = path.split('/').pop()!;

    t(`${name}：carry=原文时逐字节相等`, () => {
      const save = parseSave(new Uint8Array(readFileSync(path)));
      const map = parseMap(save.mapData);
      const out = writeMapBlock(map, save.mapData);
      expect(out).toHaveLength(save.mapData.length);
      expect(Buffer.from(out).equals(Buffer.from(save.mapData))).toBe(true);
    });

    t(`${name}：字段确实**从 map 对象写出**（改动即反映到字节）`, () => {
      const save = parseSave(new Uint8Array(readFileSync(path)));
      const map = parseMap(save.mapData);
      if (map.lands.length === 0) return; // SAVE1 是一张没有住宅地的图

      // 证伪式断言：把 1 号地的 owner 改成 7，写出的那一个字节必须变成 7。
      // 若实现是"照抄 carry"，这个断言会失败。
      const landOff = readU32(save.mapData, 0x0c);
      const id = map.lands[0]!.id;
      const mutated = {
        ...map,
        lands: map.lands.map((l) => (l.id === id ? { ...l, owner: 7, level: 3 } : l)),
      };
      const zeroed = new Uint8Array(save.mapData.length);
      const dv = new DataView(zeroed.buffer);
      for (const o of [0x04, 0x0c, 0x14, 0x1c, 0x24]) dv.setUint32(o, readU32(save.mapData, o), true);

      const out = writeMapBlock(mutated, zeroed);
      expect(out[landOff + id * 0x34 + 0x19], '住宅 owner').toBe(7);
      expect(out[landOff + id * 0x34 + 0x1a], '住宅 level').toBe(3);

      // 节点表同理（`type` 在 +0x20）
      const nodeOff = readU32(save.mapData, 0x04);
      const nid = map.nodes[0]!.id;
      const mut2 = { ...map, nodes: map.nodes.map((n) => (n.id === nid ? { ...n, type: 9 } : n)) };
      const out2 = writeMapBlock(mut2, zeroed);
      expect(new DataView(out2.buffer).getUint16(nodeOff + nid * 0x28 + 0x20, true), '节点 type').toBe(9);
    });
  }
});

function readU32(b: Uint8Array, o: number): number {
  return ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0;
}
