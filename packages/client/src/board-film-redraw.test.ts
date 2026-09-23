/*
 * 棋盘影片的**片中重画**（`flags` 第三字节）—— 第十四份試玩回報两条
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 *   · 「警车特效细节不好，应该是经过角色后角色就消失了」
 *   · 「狗咬人咬完之后狗的模型应该就消失了」
 *
 * 根因：`fcn_0045144f` 的 `flags >> 16 & 0xff`（`[0x48c85c]`）是「第几个计数时按**当前状态**
 * 重画一次底下的棋盘」（`0x004512bf call 0x40829d(-1, 0)`）。先前被当成脏矩形细节没做
 * （`docs/deviations/Q-TOOL-6.md` ⑤-5），于是整段影片期间棋盘都按 before 画：
 * 警车开过去人还站着、狗咬完狗还蹲着（接着 6.2 秒救护车期间也一直在）。
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { WHO_PLAYS_WRECKED, makeGameState, makePlayer, type MapObject } from '@rich4/core';

import { beginBoardFilm, boardFilmRedrawFrame, boardFilmRedrawn, type BoardFilmSpec } from './board-film.ts';
import { CONFINE_HOSPITAL, CONFINE_PRISON } from './confine-fx.ts';
import { visibleBoardState } from './deferred-board.ts';
import { ABDUCT_FILM, ABROAD_FILM } from './disappear-fx.ts';
import { DOG_BITE_FILM, DOG_SCARED_FILM, EXPLOSION_FILM, filmPrecedesSendToHospital } from './dog-fx.ts';

const ROOT = process.env.RICH4_WORKSPACE ?? '';
const EXE = `${ROOT}/Rich4/rich4.exe`;
const runExe = existsSync(EXE) ? it : it.skip;

/** `rich4.exe` 的 VA → 文件偏移（与 `tools/disasm.py` 的换算同一条）*/
function exeBytes(va: number, n: number): number[] {
  const d = readFileSync(EXE);
  const off = 1024 + (va - 0x401000);
  return [...d.subarray(off, off + n)];
}

describe('★ 回 exe 钉：`fcn_0045144f` 的片中重画', () => {
  runExe('`fcn_00450ced`：flags 第三字节 → [0x48c85c]', () => {
    // 00450dcd mov eax, ebx / sar eax, 0x10 / and eax, 0xff / mov [0x48c85c], eax
    expect(exeBytes(0x450dcd, 15)).toEqual([
      0x89, 0xd8, 0xc1, 0xf8, 0x10, 0x25, 0xff, 0x00, 0x00, 0x00, 0xa3, 0x5c, 0xc8, 0x48, 0x00,
    ]);
  });

  runExe('逐帧：计数先 +1（`0x0045117d`），再与 [0x48c85c] 比（0xff = 每帧）', () => {
    // 0045117d mov edx, [0x48c874] / inc edx
    expect(exeBytes(0x45117d, 7)).toEqual([0x8b, 0x15, 0x74, 0xc8, 0x48, 0x00, 0x42]);
    // 004511e3 mov ebp,[0x48c85c] / test ebp,ebp / je / cmp ebp,0xff / je / cmp ebp,[0x48c874] / jne
    expect(exeBytes(0x4511e3, 0x22)).toEqual([
      0x8b, 0x2d, 0x5c, 0xc8, 0x48, 0x00, 0x85, 0xed, 0x0f, 0x84, 0x85, 0x01, 0x00, 0x00, 0x81, 0xfd, 0xff, 0x00,
      0x00, 0x00, 0x74, 0x0c, 0x3b, 0x2d, 0x74, 0xc8, 0x48, 0x00, 0x0f, 0x85, 0x71, 0x01, 0x00, 0x00,
    ]);
  });

  runExe('命中那一帧：`push 0 / push -1 / call 0x40829d` —— 按当前状态重画整块棋盘', () => {
    // call 的相对位移：0x40829d − (0x4512bf + 5) = −0x49027 → d9 6f fb ff
    expect(exeBytes(0x4512bb, 9)).toEqual([0x6a, 0x00, 0x6a, 0xff, 0xe8, 0xd9, 0x6f, 0xfb, 0xff]);
  });

  runExe('四个调用点的 flags：入獄 0x120001、住院 0x1e0001、狗咬 0x30001；状态都在片子之前写下', () => {
    expect(exeBytes(0x43d6a0, 5)).toEqual([0x68, 0x01, 0x00, 0x12, 0x00]); // 入獄
    expect(exeBytes(0x43ed4c, 5)).toEqual([0x68, 0x01, 0x00, 0x1e, 0x00]); // 住院
    expect(exeBytes(0x41b8c3, 5)).toEqual([0x68, 0x01, 0x00, 0x03, 0x00]); // 狗咬
    // 入獄：0x0043d647 起把監獄坐标写进 player+0x08/+0x0a —— 在 0x0043d6aa 播片之前
    expect(exeBytes(0x43d647, 7)).toEqual([0x66, 0x89, 0xb3, 0x70, 0x6b, 0x49, 0x00]);
    // 惡犬：0x0041b845 push 0xb / call 0x40e14d（remove_object）—— 在 0x0041b8cd 播片之前
    expect(exeBytes(0x41b845, 7)).toEqual([0x6a, 0x0b, 0xe8, 0x01, 0x29, 0xff, 0xff]);
  });
});

describe('boardFilmRedrawFrame：各段影片的重画计数', () => {
  it.each<[string, BoardFilmSpec, number]>([
    ['入獄（警车）', CONFINE_PRISON, 0x12],
    ['住院（救护车）', CONFINE_HOSPITAL, 0x1e],
    ['狗咬', DOG_BITE_FILM, 3],
    ['狗被车吓退', DOG_SCARED_FILM, 1],
    ['地雷 / 炸彈爆炸', EXPLOSION_FILM, 3],
    ['飛碟綁架', ABDUCT_FILM, 0x1c],
    ['出國（飛機）', ABROAD_FILM, 0x14],
  ])('%s', (_name, spec, n) => {
    expect(boardFilmRedrawFrame(spec)).toBe(n);
  });

  it('flags 只有低位（神明那几段 = 1）⇒ 0 = 不重画', () => {
    expect(boardFilmRedrawFrame({ ...CONFINE_PRISON, flags: 1 })).toBe(0);
  });
});

describe('boardFilmRedrawn：计数 = N 发生在第 N−1 帧刚贴上那一拍', () => {
  it('★ 入獄：第 17 帧（1207 ms，警车正盖在人身上）起棋盘就是新的', () => {
    const film = beginBoardFilm(CONFINE_PRISON, 1000);
    expect(boardFilmRedrawn(film, 1000 + 17 * 71 - 1)).toBe(false);
    expect(boardFilmRedrawn(film, 1000 + 17 * 71)).toBe(true);
    expect(boardFilmRedrawn(film, 1000 + 35 * 71)).toBe(true);
  });

  it('★ 住院：第 29 帧（2900 ms，救护车停在人身上）', () => {
    const film = beginBoardFilm(CONFINE_HOSPITAL, 0);
    expect(boardFilmRedrawn(film, 2899)).toBe(false);
    expect(boardFilmRedrawn(film, 2900)).toBe(true);
  });

  it('★ 狗咬：第 2 帧（228 ms，打斗烟尘罩住人和狗）', () => {
    const film = beginBoardFilm(DOG_BITE_FILM, 0);
    expect(boardFilmRedrawn(film, 227)).toBe(false);
    expect(boardFilmRedrawn(film, 228)).toBe(true);
  });

  it('N = 1 ⇒ 第 0 帧就重画（狗被车吓退）', () => {
    expect(boardFilmRedrawn(beginBoardFilm(DOG_SCARED_FILM, 500), 500)).toBe(true);
  });

  it('N = 0 ⇒ 永远不重画；N = 0xff ⇒ 每帧都重画；N > 帧数 ⇒ 计数到不了', () => {
    expect(boardFilmRedrawn(beginBoardFilm({ ...CONFINE_PRISON, flags: 1 }, 0), 1e9)).toBe(false);
    expect(boardFilmRedrawn(beginBoardFilm({ ...CONFINE_PRISON, flags: 0xff0001 }, 0), 0)).toBe(true);
    expect(boardFilmRedrawn(beginBoardFilm({ ...CONFINE_PRISON, flags: 0x240001 }, 0), 1e9)).toBe(false);
    // N = 帧数：最后一帧贴上那一拍计数恰好到 N
    expect(boardFilmRedrawn(beginBoardFilm({ ...CONFINE_PRISON, flags: 0x230001 }, 0), 34 * 71)).toBe(true);
  });
});

describe('★ 狗咬 → 救护车：第一段重画之后狗没了、乞丐还站在原格', () => {
  const obj = (type: number, nodeId: number): MapObject => ({ type, nodeId, attached: 0, state: 0 });
  const before = makeGameState({
    objects: [obj(11, 7)],
    players: [makePlayer({ index: 0, nodeId: 7, xpos: 100, ypos: 200, whoPlays: 1 })],
  });
  const after = makeGameState({
    objects: [obj(11, 0)],
    players: [
      makePlayer({
        index: 0,
        nodeId: 23,
        xpos: 900,
        ypos: 900,
        whoPlays: 1,
        blocking: { ...before.players[0]!.blocking, inHospital: 3 },
      }),
    ],
  });

  it('狗咬 / 爆炸之后还要 send_to_hospital；狗被车吓退不用', () => {
    expect(filmPrecedesSendToHospital(DOG_BITE_FILM)).toBe(true);
    expect(filmPrecedesSendToHospital(EXPLOSION_FILM)).toBe(true);
    expect(filmPrecedesSendToHospital(DOG_SCARED_FILM)).toBe(false);
    expect(filmPrecedesSendToHospital(CONFINE_HOSPITAL)).toBe(false);
  });

  it('重画之前：狗在 7 号格、人在 7 号格（乞丐）', () => {
    const drawn = visibleBoardState(after, before);
    expect(drawn.objects[0]!.nodeId).toBe(7);
    expect(drawn.players[0]!.nodeId).toBe(7);
  });

  it('★ 狗咬片重画之后（放开物件、人仍按住）：狗没了，人仍是乞丐站在 7 号格', () => {
    const drawn = visibleBoardState(after, before, false, false);
    expect(drawn.objects).toBe(after.objects);
    expect(drawn.objects[0]!.nodeId).toBe(0);
    const p = drawn.players[0]!;
    expect(p.nodeId).toBe(7);
    expect(p.xpos).toBe(100);
    expect(p.blocking.inHospital).toBe(0);
    expect(p.whoPlays & WHO_PLAYS_WRECKED).toBe(WHO_PLAYS_WRECKED);
  });

  it('★ 救护车片重画之后（快照放掉）：整份 after —— 人进了醫院（隐掉）', () => {
    expect(visibleBoardState(after, null)).toBe(after);
  });
});

describe('★ main.ts 接线（源码钉子）', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('tickBoardFilm 在「播完没」之前先看片中重画', () => {
    const body = src.slice(src.indexOf('function tickBoardFilm('));
    const redraw = body.indexOf('applyBoardFilmRedraw(film, now);');
    const done = body.indexOf('if (!boardFilmDone(film, now)) {');
    expect(redraw).toBeGreaterThan(0);
    expect(redraw).toBeLessThan(done);
  });

  it('重画：后面还要 send_to_hospital ⇒ 只放物件/等级；否则整份放掉', () => {
    expect(src).toContain('if (pendingBoardFilmAfter !== null || filmPrecedesSendToHospital(film.spec)) {');
    expect(src).toContain('boardFilmRedrawKeepsPlayersFor = deferredBoardBefore;');
  });

  it('boardDrawState 两处都把「只按住人」传给 boardStateForFilm', () => {
    expect(
      src.split('boardFilmWindowFlags(), !released && !playersOnly, !playersOnly)').length - 1,
    ).toBe(2);
  });
});

describe('★ 关押 / 消失影片前后的镜头（core `confineViewTargets`）接线', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('两处起播都照 ① 移镜头、收屏照 ② 移', () => {
    expect(src.split("applyFilmView(pending, 'from');").length - 1).toBe(1);
    expect(src.split("applyFilmView(after, 'from');").length - 1).toBe(1);
    expect(src).toContain("applyFilmView(film.spec, 'to');");
  });

  it('目标只来自 core：startConfineFx / startDisappearFx 都调 confineViewTargets', () => {
    expect(src.split('confineViewTargets(before, after)').length - 1).toBe(2);
  });

  it('「動畫過程」关着 / 加刑：没有影片，① ② 背靠背 ⇒ 直接停在 ②', () => {
    const body = src.slice(src.indexOf('function startConfineFx('));
    const gate = body.indexOf('if (kind === null || !options.animation) {');
    expect(gate).toBeGreaterThan(body.indexOf('confineViewTargets(before, after)'));
  });

  it('排在 lastViewTarget 之后（卡片自己的 view_to 在前、send_to_* 那一次在后）', () => {
    const body = src.slice(src.indexOf('function syncViewTarget('));
    expect(body.indexOf('const q = queuedFilmView;')).toBeGreaterThan(body.indexOf('state.lastViewTarget'));
  });
});
