/*
 * 神明离身升天（`god_detach` VA 0x0040e32c）—— 单测（第十二份试玩回报 #1）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  applyBankruptcy,
  applyDispelCard,
  makeGameState,
  makeNode,
  reduce,
  type GameState,
  type MapTopology,
} from '@rich4/core';

import {
  GOD_ASCEND_FRAME_MS,
  GOD_ASCEND_MAX_FRAMES,
  GOD_ASCEND_MAX_MS,
  GOD_ASCEND_RISE,
  GOD_ASCEND_SOUND,
  godAscendPoseAt,
  godAscendTrigger,
} from './god-ascend-fx.ts';
import { stageBusy, type StageFlags } from './stage-gate.ts';

const ROOT = process.env.RICH4_WORKSPACE ?? '';
const EXE = `${ROOT}/Rich4/rich4.exe`;
const runExe = existsSync(EXE) ? it : it.skip;

/** VA → 文件偏移（与 `tools/disasm.py` 的 `SECTIONS` 同一张表）*/
function exeBytes(va: number, n: number): string {
  const d = readFileSync(EXE);
  const off = va >= 0x463000 ? 398848 + (va - 0x463000) : 1024 + (va - 0x401000);
  return Buffer.from(d.subarray(off, off + n)).toString('hex');
}

describe('常量 —— 逐字节钉在 exe 上', () => {
  runExe('音效：`push 0x4823e2 / call 0x4542ce`，表项 [0x4823e2] = 54', () => {
    // 0040e46f  6a 00 / 68 e2 23 48 00 / e8 …
    expect(exeBytes(0x40e46f, 8)).toBe('6a0068e2234800e8');
    const d = readFileSync(EXE);
    expect(d.readUInt32LE(398848 + (0x4823e2 - 0x463000))).toBe(GOD_ASCEND_SOUND);
    expect(GOD_ASCEND_SOUND).toBe(54);
  });

  runExe('每帧 60 ms / 至多 24 帧 / 每帧升 10 px / 8 张图轮转 / 棋盘顶边 0x28', () => {
    expect(exeBytes(0x40e525, 3)).toBe('6a3ce8'); // push 0x3c / call 0x45285e
    expect(GOD_ASCEND_FRAME_MS).toBe(0x3c);
    expect(exeBytes(0x40e52f, 4)).toBe('4383fb18'); // inc ebx / cmp ebx, 0x18
    expect(GOD_ASCEND_MAX_FRAMES).toBe(0x18);
    expect(exeBytes(0x40e539, 5)).toBe('836c24280a'); // sub dword [esp+0x28], 0xa
    expect(GOD_ASCEND_RISE).toBe(10);
    expect(exeBytes(0x40e549, 3)).toBe('83e107'); // and ecx, 7
    expect(exeBytes(0x40e5ea, 5)).toBe('837c241c28'); // cmp dword [esp+0x1c], 0x28
  });

  runExe('只拆不演的那道闸是 `cmp dword [player+0x32], 0`（一个 dword = +0x32..+0x35）', () => {
    expect(exeBytes(0x40e356, 9)).toBe('83bb9a6b490000740f');
  });

  runExe('任期递减：`dec dh / mov [..+0x496d0c], dh / jne` → `call 0x40e32c`', () => {
    expect(exeBytes(0x41cc8f, 11)).toBe('fece8834c50c6d49007509');
    expect(exeBytes(0x41cc9b, 5)).toBe('e88c16ffff'); // call 0x40e32c
  });
});

/** 玩家 0 身上附着种类 `type` 的神（槽 = 种类，神明这一段两者相等）*/
function withGod(type: number, days = 7, over: Partial<GameState> = {}): GameState {
  const base = makeGameState(over);
  return {
    ...base,
    players: base.players.map((p, i) => (i === 0 ? { ...p, godInfo: type } : p)),
    objects: base.objects.map((o, i) =>
      i === type - 1 ? { ...o, type, state: days, attached: 1, nodeId: base.players[0]!.nodeId } : o,
    ),
  };
}

describe('godAscendTrigger —— 三个调用点都演、破产与关押不演', () => {
  it('★ 任期届满：走真 reduce 的 endTurn（3 号 → 0 号，给 0 号走一天）⇒ 演', () => {
    const topo: MapTopology = { nodes: [makeNode({ id: 1, adjacent: [1] })] };
    const before = withGod(4, 1, { currentPlayer: 3, phase: 'turnEnd' });
    const after = reduce(before, { type: 'endTurn' }, topo);
    expect(after.currentPlayer).toBe(0);
    expect(after.players[0]!.godInfo).toBe(0);
    expect(godAscendTrigger(before, after)).toEqual([{ player: 0, objectIndex: 3, type: 4 }]);
  });

  it('★ 任期还剩 2 天：这一拍只减到 1、不演（大福神照样在）', () => {
    const topo: MapTopology = { nodes: [makeNode({ id: 1, adjacent: [1] })] };
    const before = withGod(4, 2, { currentPlayer: 3, phase: 'turnEnd' });
    const after = reduce(before, { type: 'endTurn' }, topo);
    expect(after.players[0]!.godInfo).toBe(4);
    expect(after.objects[3]!.state).toBe(1);
    expect(godAscendTrigger(before, after)).toEqual([]);
  });

  it('送神符（卡 22，`0x444cc4` → `0x40e32c`）⇒ 演', () => {
    const before = withGod(7);
    const r = applyDispelCard(before.players[0]!);
    expect(r.ok).toBe(true);
    const after: GameState = { ...before, players: before.players.map((p, i) => (i === 0 ? r.player : p)) };
    expect(godAscendTrigger(before, after)).toEqual([{ player: 0, objectIndex: 6, type: 7 }]);
  });

  it('换神（`0x40eb3f`：旧神先送走）⇒ 旧的那一尊演', () => {
    const before = withGod(1);
    const after: GameState = {
      ...before,
      players: before.players.map((p, i) => (i === 0 ? { ...p, godInfo: 3 } : p)),
    };
    expect(godAscendTrigger(before, after)).toEqual([{ player: 0, objectIndex: 0, type: 1 }]);
  });

  it('★ 可證偽：破产（`0x40ce40` 裸 `0x40e14d`，不经 `0x40e32c`）⇒ 不演', () => {
    const before = withGod(4);
    const after = applyBankruptcy(before, 0);
    expect(after.players[0]!.godInfo).toBe(0);
    expect(godAscendTrigger(before, after)).toEqual([]);
  });

  it.each(['inHotel', 'disappearing', 'inPrison', 'inHospital'] as const)(
    '★ 可證偽：%s ≠ 0（`0x40e356` 那个 dword）⇒ 只拆不演',
    (key) => {
      const before = withGod(4);
      const after: GameState = {
        ...before,
        players: before.players.map((p, i) =>
          i === 0 ? { ...p, godInfo: 0, blocking: { ...p.blocking, [key]: 2 } } : p,
        ),
      };
      expect(godAscendTrigger(before, after)).toEqual([]);
    },
  );

  it('冬眠（+0x36）不在那个 dword 里 ⇒ 照演', () => {
    const before = withGod(4);
    const after: GameState = {
      ...before,
      players: before.players.map((p, i) =>
        i === 0 ? { ...p, godInfo: 0, blocking: { ...p.blocking, sleeping: 3 } } : p,
      ),
    };
    expect(godAscendTrigger(before, after)).toHaveLength(1);
  });

  it('godInfo 没变 ⇒ 不演', () => {
    const s = withGod(4);
    expect(godAscendTrigger(s, s)).toEqual([]);
  });
});

describe('godAscendPoseAt —— 先升、先转、再贴；高过棋盘顶边或满 24 帧就收', () => {
  const box = { anchorY: 40, height: 48 };
  it('第 0 帧：上升 10、图号 +1', () => {
    expect(godAscendPoseAt(0, 300, 7, () => box)).toEqual({ frame: 0, dy: -10, image: 0 });
  });

  it('每 60 ms 一帧', () => {
    expect(godAscendPoseAt(59, 300, 2, () => box)?.frame).toBe(0);
    expect(godAscendPoseAt(60, 300, 2, () => box)).toEqual({ frame: 1, dy: -20, image: 4 });
  });

  it('满 24 帧收（第 24 帧不画）', () => {
    expect(godAscendPoseAt(23 * 60, 1000, 0, () => box)?.frame).toBe(23);
    expect(godAscendPoseAt(24 * 60, 1000, 0, () => box)).toBeNull();
    expect(GOD_ASCEND_MAX_MS).toBe(24 * 60);
  });

  it('底边（y − anchorY + height）高过棋盘顶边的那一帧不上屏', () => {
    // baseY = 100：第 k 帧底边 = 100 − 10(k+1) − 40 + 48 = 98 − 10k；k = 9 → 8、k = 10 → −2
    expect(godAscendPoseAt(9 * 60, 100, 0, () => box)?.frame).toBe(9);
    expect(godAscendPoseAt(10 * 60, 100, 0, () => box)).toBeNull();
  });

  it('图还没解好 ⇒ 只按帧数上限判', () => {
    expect(godAscendPoseAt(10 * 60, 100, 0, () => null)?.frame).toBe(10);
  });
});

describe('台上还忙着 —— 升天是阻塞的（演完才拆、才说「一場惡夢～」）', () => {
  it('godAscend 一位就足以让 stageBusy 为真', () => {
    const idle: StageFlags = {
      blockingPresentation: false,
      boardFilm: false,
      pendingBoardFilm: false,
      pendingBoardFilmAfter: false,
      buildFx: false,
      pendingBuildFx: false,
      objectFlight: false,
      walkDone: true,
      diceFxActive: false,
      tollFlash: false,
      godLine: false,
      godAscend: false,
      bankruptFx: false,
    };
    expect(stageBusy(idle)).toBe(false);
    expect(stageBusy({ ...idle, godAscend: true })).toBe(true);
  });
});

describe('main.ts 接线 —— 排在新神影片之前、影片等它、渲染器拿到它', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  it('startActionFx 里 startGodAscend 在 startGodFx 之前', () => {
    const a = src.indexOf('  startGodAscend(before, state);');
    const b = src.indexOf('  startGodFx(before, state);');
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
  });
  it('tickBoardFilm 起播前等升天演完；每帧推进 tickGodAscend', () => {
    expect(src).toContain('if (godAscend !== null) return;');
    expect(src).toContain("if (screen === 'game') tickGodAscend(performance.now());");
    expect(src).toContain('godAscend: godAscend !== null,');
  });
});
