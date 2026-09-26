/*
 * 聯機開局的起點局面（v6）：客戶端 `initialNetState` 與服務器鏡像**逐字節同源**
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOBBY_DEFAULT_OPTIONS,
  deserializeGame,
  newGame,
  parseMap,
  serializeGame,
  stateFingerprint,
} from '@rich4/core';
import { initialNetState } from './net-start.ts';
import { defaultSaveName } from './net-save.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

const seats = [0, 1].map((i) => ({ seat: i, name: `P${i}`, character: i + 2, kind: 'human' as const }));

describe('★ initialNetState', () => {
  run('不帶快照 ⇒ newGame（種子 + 座位 + 開局設定 + 服務器給的開局日期）', () => {
    const map = loadMap();
    const s = initialNetState(
      { seed: 77, globalMapId: 0, seats, options: { ...LOBBY_DEFAULT_OPTIONS, fundIndex: 2 }, startDate: { year: 2003, month: 4, day: 5 } },
      map,
    );
    expect([s.year, s.month, s.day]).toEqual([2003, 4, 5]);
    expect(s.players.map((p) => p.character)).toEqual([2, 3]);
    // 舊服務器不帶日期 ⇒ core 缺省（與舊行為一致）
    const old = initialNetState({ seed: 77, globalMapId: 0, seats, options: LOBBY_DEFAULT_OPTIONS }, map);
    const ref = newGame({ map, globalMapId: 0, seed: 77, mode: 'multiplayer', players: seats.map((x) => ({ character: x.character, kind: x.kind })) });
    expect(stateFingerprint(old)).toBe(stateFingerprint(ref));
  });

  run('★ 帶快照 ⇒ 直接讀快照（種子、座位、設定一概不看）；指紋與存檔時一致', () => {
    const map = loadMap();
    const saved = newGame({ map, globalMapId: 0, seed: 99, mode: 'multiplayer', players: seats.map((x) => ({ character: x.character, kind: x.kind })) });
    const snapshot = serializeGame(saved);
    const s = initialNetState({ seed: 1, globalMapId: 5, seats: [], options: LOBBY_DEFAULT_OPTIONS, snapshot, startDate: { year: 1999, month: 1, day: 1 } }, map);
    expect(stateFingerprint(s)).toBe(stateFingerprint(saved));
    expect(serializeGame(s)).toBe(serializeGame(deserializeGame(snapshot)));
  });

  it('預設存檔名是局面日期', () => {
    expect(defaultSaveName({ year: 2010, month: 3, day: 5 })).toBe('2010 年 3 月 5 日');
  });
});
