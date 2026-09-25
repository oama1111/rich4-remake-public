/*
 * FU-5 可观测性扫描：AI 出牌「预演顺延」在当前 registry 下还会不会真的发生
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 背景（`docs/audit/provenance-ai-move.md` 的 FU-5 / V-9）：原版 AI 的 8 格出牌循环里，
 * **第一张过 `0x41e69e` 的卡直接出**（`0x00441e00 call [0x475d5c + id*4]`，返回值不看，
 * `0x441e07` 出栈返回）；本引擎先用 `canUseCard` 预演一遍，不生效就试下一张（防活锁）。
 *
 * 这个脚本按 `decideCard` 的循环逐帧复算，数两个数：
 *   · 判定函数肯出的次数（过了個性闸门且 `aiCardChoice` 返回了目标）
 *   · 其中被预演（`canUseCard`）挡下的次数 —— 这就是「顺延」真正发生的次数
 *
 * 用法：
 *   node --experimental-transform-types tools/audit/fu5-card-rehearsal-scan.ts [seed 数]
 *
 * 结果（2026-09-25，seed 1..20、每局 ≤4 万步）：肯出 806 次，预演挡下 **0** 次
 * ⇒ 合并后的 registry 已经能表达 AI 会选的每一个目标，这条偏差当前不可观测。
 */
import { readFileSync } from 'node:fs';
import { parseMap } from '../../packages/core/src/loaders/map.ts';
import { newGame } from '../../packages/core/src/rules/new-game.ts';
import { allEffectiveFacilities, allEffectiveLands, reduce } from '../../packages/core/src/state/reduce.ts';
import { decideAction, toCardTarget } from '../../packages/core/src/ai/policy.ts';
import { aiCardChoice, cardsToConsider, cardLoopEsiAfterFill } from '../../packages/core/src/ai/card-policy.ts';
import { aiCanUseCards, personalityAllowsLazy } from '../../packages/core/src/ai/personality.ts';
import { canUseCard } from '../../packages/core/src/state/preview.ts';
import { WatcomRng } from '../../packages/core/src/rng/watcom.ts';
import { CARDS } from '../../packages/data/src/index.ts';

const ROOT = process.env.RICH4_WORKSPACE ?? '/Volumes/Kingston/大富翁4重制版';
const map = parseMap(new Uint8Array(readFileSync(`${ROOT}/extracted/map/0001.bin`)));
const seedCount = Number(process.argv[2] ?? 20);

let accepted = 0;
let blocked = 0;
const blockedCards = new Map<number, number>();

for (let seed = 1; seed <= seedCount; seed++) {
  let state = newGame({
    map,
    players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    seed,
  });
  for (let step = 0; step < 40_000; step++) {
    const action = decideAction({ state, map });
    if (action === null) break;
    // 复刻 decideCard 的循环，只数数、不改变对局
    if (state.phase === 'awaitingRoll' && state.aiStep === 2 && state.aiBranch === 1) {
      const me = state.players[state.currentPlayer];
      if (me !== undefined && me.cards.length > 0 && aiCanUseCards(me.aiFlags)) {
        const rng = new WatcomRng();
        rng.setState(state.rngState);
        const roll = (): number => rng.next();
        const start = me.cards.length > 8 ? roll() % me.cards.length : 0;
        const view = {
          state,
          topo: map,
          meIndex: state.currentPlayer,
          me,
          lands: allEffectiveLands(state, map),
          facilities: allEffectiveFacilities(state, map),
          cardLoopEsi: cardLoopEsiAfterFill(me.cards.length, start),
          roll,
        };
        for (const id of cardsToConsider(me.cards, start)) {
          const f7 = CARDS.find((c) => c.id === id)?.f7 ?? 0;
          if (!personalityAllowsLazy(f7, me.personality, () => roll() % 3)) continue;
          const choice = aiCardChoice(id, view);
          if (choice === null) continue;
          accepted++;
          // 原版到这里就把这一张打出去了（不看效果函数的返回值）
          if (!canUseCard(state, map, id, toCardTarget(choice, state.currentPlayer))) {
            blocked++;
            blockedCards.set(id, (blockedCards.get(id) ?? 0) + 1);
          }
          break;
        }
      }
    }
    const next = reduce(state, action, map);
    if (next === state) break;
    state = next;
  }
}

console.log(`seed 1..${seedCount}：判定函数肯出 ${accepted} 次，预演挡下 ${blocked} 次`);
if (blockedCards.size > 0) {
  console.log('被挡的卡号:', [...blockedCards.entries()].sort((a, b) => b[1] - a[1]));
}
