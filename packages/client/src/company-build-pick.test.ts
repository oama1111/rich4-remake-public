/*
 * 建設公司选地 = 点地图（20260925-153539948）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方回报「建设公司加盖房子不是展现列表，是我可以自己在地图上任意选择」。
 * 原版 `0x0041aa6a` / `0x0041acff push 0x2090086 / call 0x446ae8` 是点地图的拾取窗：
 * 地块 | 設施 | 贴边推镜头，右键可取消，指针 = 图 9 起 3 帧（与機器工人同一组）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseMap, type GameState, type MapTopology } from '@rich4/core';
import { COMPANY_BUILD_PARAM, PICK_CLASS, pickClasses, pickCursorSpec, startPick } from './picking.ts';

const DIR = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map';
const run = existsSync(DIR) ? it : it.skip;

describe('建設公司选地的拾取参数 0x2090086', () => {
  it('地块 + 設施 + 贴边推镜头；不含格子；右键可取消；指针 = 准星图 9 起 3 帧', () => {
    const cls = pickClasses(COMPANY_BUILD_PARAM);
    expect(cls & PICK_CLASS.land).not.toBe(0);
    expect(cls & PICK_CLASS.facility).not.toBe(0);
    expect(cls & PICK_CLASS.edgeScroll).not.toBe(0);
    expect(cls & PICK_CLASS.node).toBe(0);
    expect(cls & PICK_CLASS.required).toBe(0);
    expect(pickCursorSpec(COMPANY_BUILD_PARAM)).toEqual({ image: 9, frames: 3, ticks: 10 });
  });

  run('每张地图：core 给的每一个候选（全图地块 / 設施）在地图上都有一处能点的落点，且落在实例坐标上', () => {
    // 地图文件 = `globalMapId * 2 + 1`（@source assets.ts 的 readMapData；同 core soak.test.ts 的八张图）
    const files = [0, 1, 2, 3, 4, 5, 6, 7].map((id) => `${String(id * 2 + 1).padStart(4, '0')}.bin`);
    for (const f of files) {
      const map = parseMap(new Uint8Array(readFileSync(`${DIR}/${f}`))) as unknown as MapTopology;
      const choices = [
        ...(map.lands ?? []).map((l) => 0x7d0 + l.id),
        ...(map.facilities ?? []).map((x) => 0xfa0 + x.id),
      ];
      const s = startPick({} as GameState, map, { kind: 'build', choices }, 'none', COMPANY_BUILD_PARAM);
      expect(s.cancellable, f).toBe(true);
      const codes = s.candidates.map((c) => c.code).sort((a, b) => a! - b!);
      expect(codes, f).toEqual([...choices].sort((a, b) => a - b));
      for (const c of s.candidates) {
        const code = c.code!;
        const inst = code >= 0xfa0
          ? map.facilities?.find((x) => x.id === code - 0xfa0)
          : map.lands?.find((x) => x.id === code - 0x7d0);
        expect({ x: c.wx, y: c.wy }, `${f} ${code}`).toEqual({ x: inst!.x, y: inst!.y });
      }
    }
  });

  it('main.ts：chooseBuildTarget 不摆列表壳，改走拾取；选中发 buildTarget、右键发 declineDecision', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(src).toContain("if (state.pending?.kind === 'chooseBuildTarget') return null;");
    expect(src).toContain("{ kind: 'build', choices: pend.choices }, 'none', COMPANY_BUILD_PARAM");
    expect(src).toContain("dispatch({ type: 'buildTarget', entityId: hit.code })");
    expect(src).toContain("else if (source.kind === 'build') dispatch({ type: 'declineDecision' });");
  });
});
