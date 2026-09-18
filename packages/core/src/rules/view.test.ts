/*
 * 地图视角档位（`<` / `>` 热键 / `[0x499088]` / 存档 `+0x2743`）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { VIEW_ROTATION_COUNT, rotateViewBy } from './view.ts';
import { newGame } from './new-game.ts';
import { reduce } from '../state/reduce.ts';
import { existsSync, readFileSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { topoOf } from '../testing/factories.ts';

const ROOT = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版';
const MAP = `${ROOT}/extracted/map/0001.bin`;
const haveMap = existsSync(MAP);
const run = haveMap ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
const players = () => [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const }));

describe('★ rotateViewBy：8 档取模（原版 `[0x499088]` 取低 3 位）', () => {
  it('一个方向走 8 步回到原点', () => {
    for (let start = 0; start < VIEW_ROTATION_COUNT; start++) {
      expect(rotateViewBy(start, VIEW_ROTATION_COUNT)).toBe(start);
      expect(rotateViewBy(start, -VIEW_ROTATION_COUNT)).toBe(start);
    }
  });

  it('两向对称，且负值不会漏出去', () => {
    expect(rotateViewBy(0, -1)).toBe(7);
    expect(rotateViewBy(7, 1)).toBe(0);
    expect(rotateViewBy(0, -9)).toBe(7);
    expect(rotateViewBy(3, 13)).toBe(0);
    for (let v = 0; v < VIEW_ROTATION_COUNT; v++) {
      for (const d of [-17, -9, -1, 0, 1, 9, 17]) {
        const r = rotateViewBy(v, d);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(VIEW_ROTATION_COUNT);
      }
    }
  });

  it('非法输入按 0 处理（不抛、不漏 NaN）', () => {
    expect(rotateViewBy(Number.NaN, 1)).toBe(1);
    expect(rotateViewBy(2, Number.NaN)).toBe(2);
    expect(rotateViewBy(2.7, 1.2)).toBe(3); // 先 trunc 再取模
  });
});

describe('★ reducer 的 rotateView：档位住在状态里', () => {
  run('转一步 +1 / -1，8 步回到原点；delta=0 返回原对象', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 3 });
    expect(s0.viewRotation).toBe(0);

    const plus = reduce(s0, { type: 'rotateView', delta: 1 }, topo);
    expect(plus.viewRotation).toBe(1);
    expect(plus).not.toBe(s0); // 变了就换对象

    expect(reduce(s0, { type: 'rotateView', delta: 0 }, topo)).toBe(s0); // 没变就原样

    let s = s0;
    for (let i = 0; i < VIEW_ROTATION_COUNT; i++) s = reduce(s, { type: 'rotateView', delta: 1 }, topo);
    expect(s.viewRotation).toBe(0);

    // 反向一步 = 7
    expect(reduce(s0, { type: 'rotateView', delta: -1 }, topo).viewRotation).toBe(7);
  });
});

describe('★★ 视角档位进存档（`+0x2743`，D-06 的另一半）', () => {
  run('转过的档位会被写出、也能再读回来', async () => {
    const { OFFSET, parseSave } = await import('../loaders/save.ts');
    const { importOriginalSave } = await import('../loaders/savegame.ts');
    const { ORIGINAL_STATE_BLOCK_SIZE, writeStateBlock } = await import('../loaders/save-writer.ts');

    const map = loadMap();
    const topo = topoOf(map);
    let s = newGame({ map, players: players(), seed: 3 });
    s = reduce(s, { type: 'rotateView', delta: 5 }, topo);
    expect(s.viewRotation).toBe(5);

    // 写：carry 清零也要写出 5（`0x2743` 属完全建模）
    const zeroed = new Uint8Array(ORIGINAL_STATE_BLOCK_SIZE);
    const out = writeStateBlock({ state: s, carry: zeroed, mapDataSize: 1 });
    expect(out[OFFSET.viewRotation]).toBe(5);

    // 读：把该字节塞进一份真存档的副本再走导入路径
    const SAVE = `${ROOT}/Rich4/Save0.dat`;
    if (!existsSync(SAVE)) return;
    const bytes = new Uint8Array(readFileSync(SAVE));
    bytes[OFFSET.viewRotation] = 5;
    const save = parseSave(bytes);
    const { state } = importOriginalSave(save, parseMap(save.mapData));
    expect(state.viewRotation).toBe(5);
    void topo;
  });
});
