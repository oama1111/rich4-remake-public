/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 底图与节点坐标的对齐
 *
 * ★ 这组用例是 .gnd 块尺寸取 32×32 的**决定性证据**，也是
 *   「节点坐标无需平移」这一结论的唯一依据。
 *
 * ⚠️ 这里**不引用 @rich4/core**：素材管线不该依赖游戏规则包。
 *   节点表只需要头两个字段和每项的 x/y，就地读几个字节即可，
 *   格式见 core 的 loaders/map.ts（节点 40 字节，+0x00 x、+0x02 y）。
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { decodeGround } from './ground.ts';

const DIR = (process.env.RICH4_WORKSPACE ?? '') + '/assets-clean/map';
const have = existsSync(`${DIR}/0000.gnd`) ? it : it.skip;
const res = (n: number): Uint8Array =>
  new Uint8Array(readFileSync(`${DIR}/${String(n).padStart(4, '0')}.${n % 2 === 0 ? 'gnd' : 'bin'}`));

const ground = (m: number) => decodeGround(res(m * 2));

/** 只读节点的 x/y —— 节点 40 字节，表从下标 1 开始 */
function nodeXY(mapId: number): { x: number; y: number }[] {
  const d = res(mapId * 2 + 1);
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const count = v.getUint32(0x00, true);
  const off = v.getUint32(0x04, true);
  const out: { x: number; y: number }[] = [];
  for (let i = 1; i <= count; i++) {
    const o = off + i * 40;
    out.push({ x: v.getInt16(o, true), y: v.getInt16(o + 2, true) });
  }
  return out;
}

/** 深蓝的海 —— 蓝明显高于红绿 */
const isSea = (r: number, g: number, b: number): boolean => b > r + 20 && b > g + 20;

describe('★ 底图与节点坐标', () => {
  have('★ 八张图的节点全部落在 2304 × 2304 之内', () => {
    for (let m = 0; m < 8; m++) {
      const g = ground(m);
      for (const n of nodeXY(m)) {
        expect(n.x, `地图 ${m}`).toBeGreaterThanOrEqual(0);
        expect(n.y, `地图 ${m}`).toBeGreaterThanOrEqual(0);
        expect(n.x, `地图 ${m}`).toBeLessThan(g.width);
        expect(n.y, `地图 ${m}`).toBeLessThan(g.height);
      }
    }
  });

  have('★ 块尺寸若取 38×27，地图 2 的节点会越出底图 —— 这条推翻了先前的读法', () => {
    // 38×27 → 2736 × 1944。地图 2 的节点 y 最大 2160 > 1944。
    const ys = nodeXY(2).map((n) => n.y);
    expect(Math.max(...ys)).toBeGreaterThan(1944);
    expect(Math.max(...ys)).toBeLessThan(2304);
  });

  have('★ 节点按零偏移画上去，绝大多数落在非海面上', () => {
    // 格式解对之后（用上块排布表），零偏移得 87/103；
    // 在 ±200 像素内扫描到的最优偏移也只有 91——零偏移已在最优解附近。
    //
    // ⚠️ 这仍**不是**「零偏移最优」的严格证明：用颜色判「是不是海」
    //   是弱判据，峰又宽又平，它奖励的是「多少点落在大块绿色里」。
    //   真正的依据是形状吻合（路线沿海岸走一圈、两串支线分别通向澎湖
    //   与绿岛/兰屿），那一点只能靠眼睛，故不写成断言。
    const g = ground(0);
    const nodes = nodeXY(0);
    let onLand = 0;
    for (const n of nodes) {
      const o = (n.y * g.width + n.x) * 4;
      if (!isSea(g.rgba[o]!, g.rgba[o + 1]!, g.rgba[o + 2]!)) onLand++;
    }
    expect(onLand / nodes.length, `${onLand}/${nodes.length} 在非海面上`).toBeGreaterThan(0.8);
  });

  have('★ 节点云与岛的位置相称 —— 两者质心相距不到图宽的 1/8', () => {
    // 比「逐点判海」稳的一条：节点云的质心应当落在陆地质心附近。
    // 块宽取错（38×27）时两者会差出几百像素。
    const g = ground(0);
    const nodes = nodeXY(0);
    let lx = 0;
    let ly = 0;
    let ln = 0;
    for (let y = 0; y < g.height; y += 8) {
      for (let x = 0; x < g.width; x += 8) {
        const o = (y * g.width + x) * 4;
        if (isSea(g.rgba[o]!, g.rgba[o + 1]!, g.rgba[o + 2]!)) continue;
        lx += x;
        ly += y;
        ln++;
      }
    }
    const nx = nodes.reduce((a, n) => a + n.x, 0) / nodes.length;
    const ny = nodes.reduce((a, n) => a + n.y, 0) / nodes.length;
    const dx = Math.abs(nx - lx / ln);
    const dy = Math.abs(ny - ly / ln);
    expect(Math.hypot(dx, dy), `质心相距 (${dx.toFixed(0)}, ${dy.toFixed(0)})`).toBeLessThan(
      g.width / 8,
    );
  });
});
