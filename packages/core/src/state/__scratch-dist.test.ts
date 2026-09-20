/* scratch: 找重复触发 v2 —— 只在牌堆游标真的推进时算一次「触发」 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { decideAction } from '../ai/policy.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const players = () => [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const }));

describe('scratch duplicate detection v2', () => {
  run('scan', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    const topo = {
      nodes: map.nodes,
      lands: map.lands,
      facilities: map.facilities,
      commercials: map.commercials,
      landscapes: map.landscapes,
    };
    const problems: string[] = [];
    let fires = 0;
    for (let seed = 1; seed <= 5; seed++) {
      let state: GameState = newGame({ map, players: players(), seed });
      let nCur = state.newsDeck.cursor;
      let fCur = state.fortuneDeck.cursor;
      const newsSeen: number[] = [];
      const fortSeen: number[] = [];
      for (let steps = 0; steps < 200_000; steps++) {
        const a = decideAction({ state, map });
        if (a === null) break;
        const before = state;
        const next = reduce(state, a, topo);
        if (next === state) break;
        state = next;
        const nChanged = state.newsDeck.cursor !== nCur;
        const fChanged = state.fortuneDeck.cursor !== fCur;
        if (nChanged) {
          nCur = state.newsDeck.cursor;
          const ev = state.lastEvent;
          if (ev !== null && ev.kind === 'news') {
            fires++;
            if (newsSeen.includes(ev.id)) {
              const at = newsSeen.indexOf(ev.id);
              problems.push(`seed ${seed}: news ${ev.id} 两次触发，间隔 ${newsSeen.length - at} 张 turn=${state.turnCount}`);
            }
            newsSeen.push(ev.id);
            if (newsSeen.length % 36 === 0 && new Set(newsSeen).size < 36) {
              problems.push(`seed ${seed}: 一轮 36 张里只有 ${new Set(newsSeen).size} 个不同事件`);
            }
          }
        }
        if (fChanged) {
          fCur = state.fortuneDeck.cursor;
          const ev = state.lastEvent;
          if (ev !== null && ev.kind === 'fortune') {
            fires++;
            if (fortSeen.includes(ev.id)) {
              const at = fortSeen.indexOf(ev.id);
              problems.push(`seed ${seed}: fortune ${ev.id} 两次触发，间隔 ${fortSeen.length - at} 张 turn=${state.turnCount}`);
            }
            fortSeen.push(ev.id);
          }
        }
        void before;
      }
      console.log(`seed ${seed}: news ${newsSeen.length} 次 / distinct ${new Set(newsSeen).size}; fortune ${fortSeen.length} 次 / distinct ${new Set(fortSeen).size}`);
    }
    console.log('total fires', fires, 'problems', problems.length);
    for (const p of problems.slice(0, 30)) console.log(p);
    expect(true).toBe(true);
  }, 120_000);
});
