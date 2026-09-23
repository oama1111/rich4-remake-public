/*
 * 語音触发点探测器 —— 单测
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 本文件**只构造 before/after 两份 `GameState`**，不碰 DOM、不碰音频、
 * 不动 PRNG（这正是本卡把探测器做成纯函数的目的）。
 *
 * 每一条断言对应 exe 里的一处取证点，VA 写在 `speech.ts` 的同名探测器上；
 * 这里只挑几处把**阈值方向**钉死（`>` 还是 `>=`、中间档取哪一句），
 * 因为那些方向错了单看代码是看不出来的。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  applyDispelCard,
  attachGod,
  makeGameState,
  makeLand,
  makeNode,
  makePlayer,
  reduce,
  WHO_PLAYS_COMPUTER,
  WHO_PLAYS_DEAD,
  WHO_PLAYS_HUMAN,
  type GameState,
  type MapTopology,
  type NoticeKey,
} from '@rich4/core';
import { cardLineVoice, SPEECH_EVENTS_PER_CHARACTER, speechEmojiImage, speechIndex } from '@rich4/data';
import {
  BIG_WEALTH_GOD_TYPE,
  DETECTORS,
  HOSTILE_GOD_TYPES,
  MONEY_TIER_HIGH,
  MONEY_TIER_LOW,
  MONEY_TIER_MID,
  OPENING_SPEECH_EVENT,
  SMALL_WEALTH_GOD_TYPE,
  SMALL_WEALTH_LINE_MIN,
  detectAreaMonopoly,
  detectBankrupt,
  detectBigWealthLine,
  detectDreamCard,
  detectGodArrived,
  detectGodLeft,
  detectHospitalEntered,
  detectHotelStay,
  detectLandGodLine,
  detectLevelFive,
  detectLuckyGodLine,
  detectMoneyGained,
  detectMoneyPaid,
  detectPointsGained,
  detectPrisonEntered,
  detectSmallWealthLine,
  detectTurnStartBlocked,
  detectVictory,
  cardPlaySpeech,
  gainEventFor,
  mostHostilePlayer,
  openingSpeech,
  payTierFor,
  smallGainTierFor,
  smallLossTierFor,
  speechEventsFor,
  speechLinesFor,
  speechResourceFor,
  speechResourcesFor,
  TOOL_LINE_ORDER,
  detectNoticeSay,
  ownToolLineSpoken,
  toolUseSpeechLines,
  type SayEvent,
} from './speech.ts';
import { deferSpeech } from './stage-gate.ts';

// ============================================================
//  构造 before/after
// ============================================================

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState;

/**
 * 只留「谁 / 哪一句 / **次序**」三位再比。
 *
 * `SayEvent` 上还挂着别的卡加的可选字段（W-50 的 `expression?` = `player_say` 的
 * 第 2 个实参，逐**事件**取值、由 `expressionOf()` 钉在它自己的用例里）。
 * 那一位不归 W-51 管，两张卡的取值也不该互相绑死 ⇒ 这里先投影掉。
 * W-51 关心的三样（`player` / `event` / `order`）一个不少地留着。
 */
const said = (
  events: readonly SayEvent[],
): { player: number; event: number; order: SayEvent['order'] }[] =>
  events.map(({ player, event, order }) => ({ player, event, order }));

/**
 * 造一对状态：`before` 是默认局，`after` 是它的副本，再由回调分别改。
 * 回调拿到的是**可写的**两份，便于构造「跃迁」（如 `inPrison` 0 → 3）。
 */
function step(mutate: (before: GameState, after: GameState) => void): [GameState, GameState] {
  const before = makeGameState();
  const after = clone(before);
  mutate(before, after);
  return [before, after];
}

/** 只改 after 的简写 */
function to(mutate: (after: GameState) => void): [GameState, GameState] {
  return step((_before, after) => mutate(after));
}

// ============================================================
//  分档阈值 —— 逐个照抄 exe
// ============================================================

describe('★ 得點券格 / 小遊戲不玩的台词 —— 通道 2 钉住（test_points_squares.py 18/18）', () => {
  it('★★ `lastEvent.phraseIndex` 直接用**角色台词表**的事件号（50 點 0/1、30 點 2）', () => {
    const base = makeGameState({ currentPlayer: 1 });
    for (const event of [0, 1, 2]) {
      const after = { ...base, lastEvent: { kind: 'minigameDecline' as const, id: 0, phraseIndex: event } };
      expect(said(speechEventsFor(base, after))).toEqual([{ player: 1, event, order: 'afterStage' }]);
    }
  });

  it('★ 有这条 lastEvent 时 `pointsGained`（`0x44f230` 档位表）**不再开口**，避免同一笔说两句', () => {
    const before = makeGameState({
      players: [makePlayer({ index: 0, points: 100 }), makePlayer({ index: 1, points: 0 })],
      currentPlayer: 0,
    });
    const after = {
      ...before,
      players: [makePlayer({ index: 0, points: 150 }), makePlayer({ index: 1, points: 0 })],
      lastEvent: { kind: 'minigameDecline' as const, id: 0, phraseIndex: 1 },
    };
    // 只有角色台词表那一条（50 點的 +50 本来会命中 `0x44f230` 的档位）
    expect(said(speechEventsFor(before, after))).toEqual([{ player: 0, event: 1, order: 'afterStage' }]);
  });

  it('★★ 那条 lastEvent 是**上一条 action 留下的**（引用没变）⇒ 不再重说（试玩回报：台词一直重复）', () => {
    // `lastEvent` 不是瞬态字段：core 写下之后一直留到下一个事件。之后的每一条 action
    // （走一格 / 結算 / 换人）`before.lastEvent === after.lastEvent` ⇒ 一句都不该说。
    const lastEvent = { kind: 'minigameDecline' as const, id: 0, phraseIndex: 1 };
    const before = makeGameState({ currentPlayer: 1, lastEvent });
    const walked = { ...before, stepsRemaining: 3 };
    expect(said(speechEventsFor(before, walked))).toEqual([]);
    const nextPlayer = { ...before, currentPlayer: 2 };
    expect(said(speechEventsFor(before, nextPlayer))).toEqual([]);
  });

  it('★ 同上：留着旧 lastEvent 时，**新的**點入帳照旧走档位表（先前会被一直捂住）', () => {
    const lastEvent = { kind: 'minigameDecline' as const, id: 0, phraseIndex: 1 };
    const before = makeGameState({
      players: [makePlayer({ index: 0, points: 0 }), makePlayer({ index: 1, points: 0 })],
      currentPlayer: 0,
      lastEvent,
    });
    const after = {
      ...before,
      players: [makePlayer({ index: 0, points: 150 }), makePlayer({ index: 1, points: 0 })],
    };
    const evs = said(speechEventsFor(before, after));
    expect(evs).toHaveLength(1);
    expect(evs[0]!.player).toBe(0);
  });

  it('★ 连着两次得 50 點：第二次是**新写的对象** ⇒ 照说', () => {
    const before = makeGameState({
      currentPlayer: 1,
      lastEvent: { kind: 'minigameDecline' as const, id: 0, phraseIndex: 1 },
    });
    const after = { ...before, lastEvent: { kind: 'minigameDecline' as const, id: 0, phraseIndex: 1 } };
    expect(said(speechEventsFor(before, after))).toEqual([{ player: 1, event: 1, order: 'afterStage' }]);
  });

  it('没有那条 lastEvent 时，點入帳照旧走档位表（护栏）', () => {
    const before = makeGameState({
      players: [makePlayer({ index: 0, points: 0 }), makePlayer({ index: 1, points: 0 })],
      currentPlayer: 0,
    });
    const after = {
      ...before,
      players: [makePlayer({ index: 0, points: 150 }), makePlayer({ index: 1, points: 0 })],
    };
    const evs = said(speechEventsFor(before, after));
    expect(evs).toHaveLength(1);
    expect(evs[0]!.player).toBe(0);
  });
});

describe('★ 分档阈值与 exe 写死的数一致', () => {
  it('6000 / 5000 / 2000 档的常数（0x2328 = 9000）', () => {
    expect(MONEY_TIER_HIGH).toBe(0x2328);
    expect(MONEY_TIER_HIGH).toBe(9000);
    expect(MONEY_TIER_MID).toBe(5000);
    expect(MONEY_TIER_LOW).toBe(2000);
  });
});

describe('進帳 6/7/8 @ fcn_0044f354（9000 / 5000 / 2000 × 物價指數）', () => {
  it('物價指數 1 时的三段', () => {
    expect(gainEventFor(9000, 1)).toBe(6); // ≥ 9000 → 6
    expect(gainEventFor(8999, 1)).toBe(6); // 中间档：原版 rand&1，取 0 ⇒ 6
    expect(gainEventFor(5000, 1)).toBe(6);
    expect(gainEventFor(4999, 1)).toBe(8); // ≥ 2000 → 8
    expect(gainEventFor(2000, 1)).toBe(8);
  });

  it('★ 低于 2000 × 物價指數**不吭声**（原版 `jl` 直接返回）', () => {
    expect(gainEventFor(1999, 1)).toBeNull();
    expect(gainEventFor(1, 1)).toBeNull();
    expect(gainEventFor(0, 1)).toBeNull();
  });

  it('★ 三档都随物價指數放大（阈值是 9000×PI 而不是常数）', () => {
    expect(gainEventFor(18_000, 2)).toBe(6);
    expect(gainEventFor(17_999, 2)).toBe(6);
    expect(gainEventFor(10_000, 2)).toBe(6);
    expect(gainEventFor(9_999, 2)).toBe(8);
    expect(gainEventFor(4_000, 2)).toBe(8);
    expect(gainEventFor(3_999, 2)).toBeNull();
  });
});

describe('付錢 / 罰款 9..11 与 12..14 @ fcn_0044f42d / fcn_0044f567', () => {
  it('★ 最低档是「> 0」，没有 2000 那道线（与進帳不同）', () => {
    expect(payTierFor(9000, 1)).toBe(0); // → 9 / 12
    expect(payTierFor(8999, 1)).toBe(0); // 中间档取 0
    expect(payTierFor(5000, 1)).toBe(0);
    expect(payTierFor(4999, 1)).toBe(2); // → 11 / 14
    expect(payTierFor(1, 1)).toBe(2);
  });

  it('0 或负数不吭声（`test ebx,ebx / jle`）', () => {
    expect(payTierFor(0, 1)).toBeNull();
    expect(payTierFor(-5, 1)).toBeNull();
  });
});

describe('小额获得 100 / 50 @ fcn_0044f230', () => {
  it('★ 边界：100 本身落在中间档（`jle 0x64`）', () => {
    expect(smallGainTierFor(101)).toBe(0);
    expect(smallGainTierFor(100)).toBe(0);
    expect(smallGainTierFor(51)).toBe(0);
  });

  it('★ 50 本身落在最低档（`jle 0x32`）', () => {
    expect(smallGainTierFor(50)).toBe(2);
    expect(smallGainTierFor(1)).toBe(2);
    expect(smallGainTierFor(0)).toBeNull();
  });
});

describe('小额损失 6 / 3 @ fcn_0044f2c2', () => {
  it('★ 边界：6 与 3 本身都落下一档', () => {
    expect(smallLossTierFor(7)).toBe(0);
    expect(smallLossTierFor(6)).toBe(0);
    expect(smallLossTierFor(4)).toBe(0);
    expect(smallLossTierFor(3)).toBe(2);
    expect(smallLossTierFor(1)).toBe(2);
    expect(smallLossTierFor(0)).toBeNull();
  });
});

// ============================================================
//  狀態跃迁型探测器
// ============================================================

describe('入狱 / 住院 / 夢遊（「新判」那一条路径）', () => {
  it('入狱：inPrison 0 → 非 0 ⇒ 事件 19（由入狱者本人说）', () => {
    const [b, a] = to((s) => {
      s.players[1]!.blocking.inPrison = 3;
    });
    expect(detectPrisonEntered(b, a)).toEqual([{ player: 1, event: 19 }]);
  });

  it('★ 加刑（本来就在牢里）不说 —— 原版 `test dh,dh / jne 加刑路径`', () => {
    const [b, a] = step((before, after) => {
      before.players[2]!.blocking.inPrison = 3;
      after.players[2]!.blocking.inPrison = 5;
    });
    expect(detectPrisonEntered(b, a)).toEqual([]);
  });

  it('住院：inHospital 0 → 非 0 ⇒ 事件 20', () => {
    const [b, a] = to((s) => {
      s.players[3]!.blocking.inHospital = 3;
    });
    expect(detectHospitalEntered(b, a)).toEqual([{ player: 3, event: 20 }]);
  });

  it('夢遊卡：sleepWalking 0 → 非 0 ⇒ 事件 21（说的人是**目标**）', () => {
    const [b, a] = to((s) => {
      s.players[2]!.blocking.sleepWalking = 5;
    });
    expect(detectDreamCard(b, a)).toEqual([{ player: 2, event: 21 }]);
  });

  it('状态没变就不说', () => {
    const [b, a] = to(() => {});
    expect(detectPrisonEntered(b, a)).toEqual([]);
    expect(detectHospitalEntered(b, a)).toEqual([]);
    expect(detectDreamCard(b, a)).toEqual([]);
  });
});

describe('回合開始被阻 @ fcn_0040c912（turnStart → turnEnd）', () => {
  const blocked = (mutate: (s: GameState) => void): [GameState, GameState] =>
    step((before, after) => {
      before.phase = 'turnStart';
      after.phase = 'turnEnd';
      after.currentPlayer = 1;
      mutate(after);
    });

  // ★ 第十三份試玩回報：哪几句要说由 core 掷（`GameState.lastBlockedSays`，各 1/2，见
  //   core `blocked-says.test.ts`）；这里只验「照 core 的结果说、顺序不变、没有就不说」。
  it('照 core 掷出的 `lastBlockedSays` 说：坐牢 ⇒ 事件 19', () => {
    const [b, a] = blocked((s) => {
      s.players[1]!.blocking.inPrison = 2;
      s.lastBlockedSays = [19];
    });
    expect(detectTurnStartBlocked(b, a)).toEqual([{ player: 1, event: 19 }]);
  });

  it('★ 计数非 0 但 core 掷到「不说」⇒ 不说（原版 `test al,1 / je` 那一半）', () => {
    const [b, a] = blocked((s) => {
      s.players[1]!.blocking.inHospital = 2;
      s.lastBlockedSays = [];
    });
    expect(detectTurnStartBlocked(b, a)).toEqual([]);
  });

  it('坐牢与住院可以同时命中，顺序 = core 记的顺序（原版三条 if 各自独立）', () => {
    const [b, a] = blocked((s) => {
      s.players[1]!.blocking.inPrison = 2;
      s.players[1]!.blocking.inHospital = 2;
      s.lastBlockedSays = [19, 20];
    });
    expect(detectTurnStartBlocked(b, a)).toEqual([
      { player: 1, event: 19 },
      { player: 1, event: 20 },
    ]);
  });

  it('冬眠 ⇒ 事件 21', () => {
    const [b, a] = blocked((s) => {
      s.players[1]!.blocking.sleeping = 2;
      s.lastBlockedSays = [21];
    });
    expect(detectTurnStartBlocked(b, a)).toEqual([{ player: 1, event: 21 }]);
  });

  it('★ 住宿/消失原本就**不出语音**（core 不掷、不记）', () => {
    const [b, a] = blocked((s) => {
      s.players[1]!.blocking.inHotel = 4;
    });
    expect(detectTurnStartBlocked(b, a)).toEqual([]);
  });

  it('★ 不是 turnStart → turnEnd 的那种跃迁就不算（例如 settling → turnEnd）', () => {
    const [b, a] = step((before, after) => {
      before.phase = 'settling';
      after.phase = 'turnEnd';
      after.players[0]!.blocking.inPrison = 2;
    });
    expect(detectTurnStartBlocked(b, a)).toEqual([]);
  });
});

describe('破產 / 勝利', () => {
  it('出局 ⇒ 事件 25（由破产者本人说）', () => {
    const [b, a] = to((s) => {
      s.players[2]!.whoPlays = WHO_PLAYS_DEAD;
    });
    expect(detectBankrupt(b, a)).toEqual([{ player: 2, event: 25 }]);
  });

  it('★ 终局那一次破产**不说** 25（原版在函数开头就 `jmp` 走了）', () => {
    const [b, a] = step((before, after) => {
      for (const s of [before, after]) {
        s.players[2]!.whoPlays = WHO_PLAYS_DEAD;
        s.players[3]!.whoPlays = WHO_PLAYS_DEAD;
      }
      after.players[1]!.whoPlays = WHO_PLAYS_DEAD;
      after.phase = 'gameOver';
    });
    expect(detectBankrupt(b, a)).toEqual([]);
    // 而存活者说勝利宣言
    expect(detectVictory(b, a)).toEqual([{ player: 0, event: 24 }]);
  });

  it('只剩一名**人类** ⇒ 事件 24', () => {
    const [b, a] = step((before, after) => {
      for (const s of [before, after]) {
        s.players[1]!.whoPlays = WHO_PLAYS_DEAD;
        s.players[2]!.whoPlays = WHO_PLAYS_DEAD;
      }
      after.players[3]!.whoPlays = WHO_PLAYS_DEAD;
    });
    expect(detectVictory(b, a)).toEqual([{ player: 0, event: 24 }]);
  });

  it('★ 只剩一名**电脑** ⇒ 不喊（原版只数 `who_plays & 1`）', () => {
    const [b, a] = step((before, after) => {
      for (const s of [before, after]) {
        s.players[1]!.whoPlays = WHO_PLAYS_DEAD;
        s.players[2]!.whoPlays = WHO_PLAYS_DEAD;
      }
      after.players[3]!.whoPlays = WHO_PLAYS_DEAD;
      after.players[0]!.whoPlays = WHO_PLAYS_COMPUTER;
    });
    expect(detectVictory(b, a)).toEqual([]);
  });

  it('人还多着就不说勝利宣言', () => {
    const [b, a] = to((s) => {
      s.players[3]!.whoPlays = WHO_PLAYS_DEAD;
    });
    expect(detectVictory(b, a)).toEqual([]);
  });

  it('★ 托管中的人类（who_plays = 1|4 = 5）仍算人类', () => {
    const [b, a] = step((before, after) => {
      for (const s of [before, after]) {
        s.players[1]!.whoPlays = WHO_PLAYS_DEAD;
        s.players[2]!.whoPlays = WHO_PLAYS_DEAD;
      }
      after.players[3]!.whoPlays = WHO_PLAYS_DEAD;
      for (const s of [before, after]) s.players[0]!.whoPlays = WHO_PLAYS_HUMAN | 0x04;
    });
    expect(detectVictory(b, a)).toEqual([{ player: 0, event: 24 }]);
  });
});

describe('最敵對玩家 @ VA 0x0040d2d3', () => {
  it('取敵意最高的那一个', () => {
    const s = makeGameState();
    s.players[0]!.hostility = [0, 3, 9, 1];
    expect(mostHostilePlayer(s, 0)).toBe(2);
  });

  it('★ 全为 0 时返回 −1（原版 `max` 初值 0、严格大于才换人）', () => {
    const s = makeGameState();
    expect(mostHostilePlayer(s, 0)).toBe(-1);
  });

  it('★ 并列时取下标小的（严格大于才换人）', () => {
    const s = makeGameState();
    s.players[0]!.hostility = [0, 4, 4, 0];
    expect(mostHostilePlayer(s, 0)).toBe(1);
  });

  it('★ 出局的人不算（`who_plays == 0` 跳过）', () => {
    const s = makeGameState();
    s.players[0]!.hostility = [0, 9, 5, 0];
    s.players[1]!.whoPlays = WHO_PLAYS_DEAD;
    expect(mostHostilePlayer(s, 0)).toBe(2);
  });
});

// ============================================================
//  金额分档型探测器
// ============================================================

// ★★ 第十四份（需求方拍板照原版）：「進帳」只认原版调了 `0x44f354` 的那几处 —— core 交 `lastGainSays`
describe('進帳 ⇒ 事件 6/7/8', () => {
  it('9000 ⇒ 事件 6', () => {
    const [b, a] = to((s) => {
      s.lastGainSays = [{ player: 1, amount: 9000 }];
    });
    expect(detectMoneyGained(b, a)).toEqual([{ player: 1, event: 6 }]);
  });

  it('3000 ⇒ 事件 8；1000 ⇒ 不吭声', () => {
    const [b, a] = to((s) => {
      s.lastGainSays = [{ player: 1, amount: 3000 }];
    });
    expect(detectMoneyGained(b, a)).toEqual([{ player: 1, event: 8 }]);

    const [b2, a2] = to((s) => {
      s.lastGainSays = [{ player: 2, amount: 1000 }];
    });
    expect(detectMoneyGained(b2, a2)).toEqual([]);
  });

  it('★ 物價指數 2 时门槛翻倍（9000 只够最低档）', () => {
    const [b, a] = step((before, after) => {
      before.priceIndex = 2;
      after.priceIndex = 2;
      after.lastGainSays = [{ player: 0, amount: 9000 }];
    });
    expect(detectMoneyGained(b, a)).toEqual([{ player: 0, event: 8 }]);
  });

  it('★★ 没有提示 ⇒ 谁进了钱都**不说**（樂透 / 拍賣 / 分紅 / 理賠… 原版都不调 `0x44f354`）', () => {
    const [b, a] = to((s) => {
      s.players[1]!.monthlyReceived += 9000;
    });
    expect(detectMoneyGained(b, a)).toEqual([]);
  });

  it('★ 提示是上一条留下来的（引用没换）⇒ 不再说', () => {
    const says = [{ player: 1, amount: 9000 }];
    const b: GameState = { ...makeGameState(), lastGainSays: says };
    expect(detectMoneyGained(b, { ...b })).toEqual([]);
  });
});

describe('付錢 / 罰款 ⇒ 事件 9..11 / 12..14 / 18', () => {
  it('付给另一个玩家 ⇒ 9（付方）+ 6（收方）', () => {
    const [b, a] = to((s) => {
      s.players[0]!.monthlyPaid += 9000;
      s.players[1]!.monthlyReceived += 9000;
      s.lastGainSays = [{ player: 1, amount: 9000 }];
    });
    expect(detectMoneyPaid(b, a)).toEqual([{ player: 0, event: 9 }]);
    expect(detectMoneyGained(b, a)).toEqual([{ player: 1, event: 6 }]);
  });

  it('小额付给玩家 ⇒ 事件 11（最低档是「> 0」）', () => {
    const [b, a] = to((s) => {
      s.players[0]!.monthlyPaid += 100;
      s.players[1]!.monthlyReceived += 100;
    });
    expect(detectMoneyPaid(b, a)).toEqual([{ player: 0, event: 11 }]);
  });

  // ★★ 第十四份試玩回報 #1（Charles）：「为什么交保险这个倒霉的事情触发的是高兴的玩家台词」。
  //   先前这里钉的是「没有收款玩家、公库涨了 ⇒ 12..14」—— 那是读错了 `fcn_0044f567`：
  //   它全 exe 只有 3 个调用点（`0x0044ce7e` / `0x0044d028` 命運罰金被神明挡掉、
  //   `0x0041d7c1` 大財神把费用减到 0），**全是「没付钱」的庆幸话**（「上帝保佑～」/「哈哈哈，很羨慕吧！」）。
  //   真付了罰款的命運走共用尾巴 `0x0044cef9 call 0x44f42d` ⇒ 付錢那一档 9..11。
  it('★★ 命運罰款（進公庫）⇒ 抽到的人说**付錢**那一档 9..11，不是 12..14（@source 0x0044cef9 call 0x44f42d）', () => {
    for (const id of [14, 15, 16, 17, 18, 19, 23, 24, 26, 30]) {
      const [b, a] = to((s) => {
        s.players[0]!.monthlyPaid += 100;
        s.pool += 100;
        s.lastEvent = { kind: 'fortune', id };
      });
      expect(detectMoneyPaid(b, a)).toEqual([{ player: 0, event: 11 }]);

      const [b2, a2] = to((s) => {
        s.players[0]!.monthlyPaid += 9000;
        s.pool += 9000;
        s.lastEvent = { kind: 'fortune', id };
      });
      expect(detectMoneyPaid(b2, a2)).toEqual([{ player: 0, event: 9 }]);
    }
  });

  it('★★ 其余进公库的钱（乞丐 / 大窮神 / 新聞的稅…）原版都不经过 0x44f42d / 0x44f567 ⇒ 不说；**12..14 永远不因付钱而说**', () => {
    const [b, a] = to((s) => {
      s.players[0]!.monthlyPaid += 9000;
      s.pool += 9000;
    });
    expect(detectMoneyPaid(b, a)).toEqual([]);
    // 新聞（例：所得稅）—— 同一条 action 里多人一起进公库
    const [b2, a2] = to((s) => {
      s.players[0]!.monthlyPaid += 9000;
      s.players[1]!.monthlyPaid += 100;
      s.pool += 9100;
      s.lastEvent = { kind: 'news', id: 11 };
    });
    expect(detectMoneyPaid(b2, a2)).toEqual([]);
    // 命運，但不是罰款尾巴那一族（例：命運 4 挪用存款）⇒ 也不说
    const [b3, a3] = to((s) => {
      s.players[0]!.monthlyPaid += 9000;
      s.pool += 9000;
      s.lastEvent = { kind: 'fortune', id: 4 };
    });
    expect(detectMoneyPaid(b3, a3)).toEqual([]);
  });

  it('★ 命運罰款：`lastEvent` 是**上一条**留下来的 ⇒ 不认（判据是引用换了）', () => {
    const [b, a] = step((before, after) => {
      before.lastEvent = { kind: 'fortune', id: 30 };
      after.players[0]!.monthlyPaid += 9000;
      after.pool += 9000;
    });
    // `clone` 让 after.lastEvent 与 before.lastEvent 引用不同 —— 手动接回同一个对象
    const same: GameState = { ...a, lastEvent: b.lastEvent };
    expect(detectMoneyPaid(b, same)).toEqual([]);
  });

  it('★ 命運罰款把人付到破產出局 ⇒ 不说（@source 0x0044ced1 `[cur+0x15] == 0` 跳过台词）', () => {
    const [b, a] = to((s) => {
      s.players[0]!.monthlyPaid += 9000;
      s.players[0]!.whoPlays = WHO_PLAYS_DEAD;
      s.pool += 9000;
      s.lastEvent = { kind: 'fortune', id: 30 };
    });
    expect(detectMoneyPaid(b, a)).toEqual([]);
  });

  it('★★ 回报现场：命運 30「付保險金」5000 元（物價 1）⇒ 宮本寶藏说 9「啊啊啊…世事無常…」，不是 12「哈哈哈，很羨慕吧！」', () => {
    const [b, a] = to((s) => {
      s.players[0]!.character = 6; // 宮本寶藏
      s.players[0]!.monthlyPaid += 5000;
      s.pool += 5000;
      s.lastEvent = { kind: 'fortune', id: 30 };
    });
    const lines = speechLinesFor(a, speechEventsFor(b, a));
    expect(lines.map((l) => l.bubble.lines.join(''))).toEqual(['啊啊啊…世事無常…']);
  });

  it('★★ 钱进了企业（董事長收費 / 保險費）⇒ 付款人**照样**说 9..11（第八份试玩回报 #1；@source 0x0041b006 call 0x44f42d）', () => {
    // 先前这里钉的是「不吭声」—— 那是读漏了企業收費尾巴上的那一句 `call 0x44f42d`
    const [b, a] = to((s) => {
      s.players[0]!.monthlyPaid += 9000;
      s.companyFunds[3] = (s.companyFunds[3] ?? 0) + 9000;
    });
    expect(detectMoneyPaid(b, a)).toEqual([{ player: 0, event: 9 }]);
    const [b2, a2] = to((s) => {
      s.players[0]!.monthlyPaid += 100;
      s.companyFunds[0] = (s.companyFunds[0] ?? 0) + 100;
    });
    expect(detectMoneyPaid(b2, a2)).toEqual([{ player: 0, event: 11 }]);
  });

  it('付了钱但钱去向不明（没人收、公库没涨、企業也没涨）⇒ 不吭声（护栏）', () => {
    const [b, a] = to((s) => {
      s.players[0]!.monthlyPaid += 9000;
    });
    expect(detectMoneyPaid(b, a)).toEqual([]);
  });

  it('★ 被「最敵對玩家」拿走 ≥ 5000 × 物價指數 ⇒ 事件 18（顶替 9..11）', () => {
    const [b, a] = step((before, after) => {
      before.players[0]!.hostility = [0, 5, 1, 0];
      after.players[0]!.hostility = [0, 5, 1, 0];
      after.players[0]!.monthlyPaid += 6000;
      after.players[1]!.monthlyReceived += 6000;
    });
    expect(detectMoneyPaid(b, a)).toEqual([{ player: 0, event: 18 }]);
  });

  it('★ 收款方不是最敵對的那一个 ⇒ 照常说 9..11', () => {
    const [b, a] = step((before, after) => {
      before.players[0]!.hostility = [0, 1, 5, 0]; // 最敵對是 2 号
      after.players[0]!.hostility = [0, 1, 5, 0];
      after.players[0]!.monthlyPaid += 6000;
      after.players[1]!.monthlyReceived += 6000; // 却付给了 1 号
    });
    expect(detectMoneyPaid(b, a)).toEqual([{ player: 0, event: 9 }]);
  });

  it('★ 金额不足 5000 × 物價指數 ⇒ 即使是最敵對也只说 9..11', () => {
    const [b, a] = step((before, after) => {
      before.players[0]!.hostility = [0, 5, 0, 0];
      after.players[0]!.hostility = [0, 5, 0, 0];
      after.players[0]!.monthlyPaid += 4999;
      after.players[1]!.monthlyReceived += 4999;
    });
    expect(detectMoneyPaid(b, a)).toEqual([{ player: 0, event: 11 }]);
  });

  it('没花钱就不说', () => {
    const [b, a] = to(() => {});
    expect(detectMoneyPaid(b, a)).toEqual([]);
  });
});

describe('旅館住宿 ⇒ 事件 3/4/5（金额 = 住店天数）', () => {
  it('住 7 天（+0x32 = 6）⇒ 事件 3', () => {
    const [b, a] = to((s) => {
      s.players[0]!.blocking.inHotel = 6;
    });
    expect(detectHotelStay(b, a)).toEqual([{ player: 0, event: 3 }]);
  });

  it('住 4 天（+0x32 = 3）⇒ 事件 3', () => {
    const [b, a] = to((s) => {
      s.players[0]!.blocking.inHotel = 3;
    });
    expect(detectHotelStay(b, a)).toEqual([{ player: 0, event: 3 }]);
  });

  it('住 3 天（+0x32 = 2）⇒ 事件 5', () => {
    const [b, a] = to((s) => {
      s.players[0]!.blocking.inHotel = 2;
    });
    expect(detectHotelStay(b, a)).toEqual([{ player: 0, event: 5 }]);
  });

  it('★ 住 1 天时 +0x32 挂 0x80（待释放位），反推仍是 1 天 ⇒ 事件 5', () => {
    const [b, a] = to((s) => {
      s.players[0]!.blocking.inHotel = 0x80;
    });
    expect(detectHotelStay(b, a)).toEqual([{ player: 0, event: 5 }]);
  });

  it('本来就在住店 ⇒ 不算新的一次', () => {
    const [b, a] = step((before, after) => {
      before.players[0]!.blocking.inHotel = 2;
      after.players[0]!.blocking.inHotel = 6;
    });
    expect(detectHotelStay(b, a)).toEqual([]);
  });
});

describe('加蓋到頂（等級 4 → 5）⇒ 事件 15', () => {
  it('地块升到 5 级 ⇒ 事件 15（由当前玩家说）', () => {
    const [b, a] = step((before, after) => {
      before.landLevel = [4, 3, 0, 0];
      after.landLevel = [5, 3, 0, 0];
      after.currentPlayer = 0;
    });
    expect(detectLevelFive(b, a)).toEqual([{ player: 0, event: 15 }]);
  });

  it('設施升到 5 级也算（同一槽位在 0x0041ab4a 也出现）', () => {
    const [b, a] = step((before, after) => {
      before.facilityLevel[2] = 4;
      after.facilityLevel[2] = 5;
      after.currentPlayer = 1;
    });
    expect(detectLevelFive(b, a)).toEqual([{ player: 1, event: 15 }]);
  });

  it('★ 只有「正好等于 5」才算：升到 4 级、或已经是 5 级都不说', () => {
    const [b, a] = step((before, after) => {
      before.landLevel = [3];
      after.landLevel = [4];
    });
    expect(detectLevelFive(b, a)).toEqual([]);

    const [b2, a2] = step((before, after) => {
      before.landLevel = [5];
      after.landLevel = [5];
    });
    expect(detectLevelFive(b2, a2)).toEqual([]);
  });
});

describe('點入帳 ⇒ 事件 0/1/2', () => {
  it('+150 點 ⇒ 事件 0', () => {
    const [b, a] = to((s) => {
      s.players[2]!.points += 150;
    });
    expect(detectPointsGained(b, a)).toEqual([{ player: 2, event: 0 }]);
  });

  it('+50 點（「得５０點」那类）⇒ 事件 2', () => {
    const [b, a] = to((s) => {
      s.players[2]!.points += 50;
    });
    expect(detectPointsGained(b, a)).toEqual([{ player: 2, event: 2 }]);
  });

  it('花掉點數（增量为负）不说', () => {
    const [b, a] = to((s) => {
      s.players[2]!.points -= 30;
    });
    expect(detectPointsGained(b, a)).toEqual([]);
  });
});

// ============================================================
//  汇总
// ============================================================

describe('speechEventsFor —— 有序列的探测器数组', () => {
  it('探测器表：名字唯一、每个都带取证 VA', () => {
    const names = DETECTORS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    for (const d of DETECTORS) {
      expect(d.source.length, `${d.name} 没有取证 VA`).toBeGreaterThan(0);
      for (const va of d.source) {
        expect(va, `${d.name} 的 VA 0x${va.toString(16)}`).toBeGreaterThanOrEqual(0x401000);
        expect(va, `${d.name} 的 VA 0x${va.toString(16)}`).toBeLessThan(0x463000);
      }
    }
  });

  it('★ 付方先开口、收方后开口（照原版的调用次序）', () => {
    const [b, a] = to((s) => {
      s.players[0]!.monthlyPaid += 9000;
      s.players[1]!.monthlyReceived += 9000;
      s.lastGainSays = [{ player: 1, amount: 9000 }];
    });
    expect(said(speechEventsFor(b, a))).toEqual([
      { player: 0, event: 9, order: 'afterStage' },
      { player: 1, event: 6, order: 'afterStage' },
    ]);
  });

  it('一个动作里可以同时命中好几条（入狱 + 破產 + 胜利）', () => {
    const [b, a] = step((before, after) => {
      for (const s of [before, after]) {
        s.players[2]!.whoPlays = WHO_PLAYS_DEAD;
        s.players[3]!.whoPlays = WHO_PLAYS_DEAD;
      }
      after.players[1]!.whoPlays = WHO_PLAYS_DEAD;
      after.players[0]!.blocking.inPrison = 3;
      after.phase = 'gameOver';
    });
    expect(said(speechEventsFor(b, a))).toEqual([
      { player: 0, event: 19, order: 'afterStage' },
      { player: 0, event: 24, order: 'afterStage' },
    ]);
  });

  it('状态没动 ⇒ 一句话都不说', () => {
    const [b, a] = to(() => {});
    expect(said(speechEventsFor(b, a))).toEqual([]);
  });

  it('对默认局做一次自比为「无变化」的调用：不抛异常', () => {
    const s = makeGameState();
    expect(() => said(speechEventsFor(s, clone(s)))).not.toThrow();
  });
});

describe('★ 越界不播（不夹取、不抛）', () => {
  it('正常参数换算成 Speaking.mkf 资源号', () => {
    const s = makeGameState();
    expect(speechResourceFor(s, { player: 0, event: 0 })).toBe(1050);
    // 角色 2（錢夫人）事件 19 → 1050 + 27×2 + 19 = 1123
    expect(speechResourceFor(s, { player: 2, event: 19 })).toBe(1123);
    expect(speechResourceFor(s, { player: 2, event: 19 })).toBe(speechIndex(2, 19));
  });

  it('角色号越界 ⇒ null（而 speechIndex 会抛）', () => {
    const s = makeGameState();
    for (const bad of [-1, 12, 99, 1.5, Number.NaN]) {
      s.players[0]!.character = bad;
      expect(speechResourceFor(s, { player: 0, event: 0 }), `角色号 ${bad}`).toBeNull();
      expect(() => speechIndex(bad, 0), `角色号 ${bad} 应让 speechIndex 抛`).toThrow(RangeError);
    }
  });

  it('事件号越界 ⇒ null（而 speechIndex 会抛）', () => {
    const s = makeGameState();
    for (const bad of [-1, SPEECH_EVENTS_PER_CHARACTER, 100, Number.NaN]) {
      expect(speechResourceFor(s, { player: 0, event: bad }), `事件号 ${bad}`).toBeNull();
      expect(() => speechIndex(0, bad), `事件号 ${bad} 应让 speechIndex 抛`).toThrow(RangeError);
    }
  });

  it('玩家下标越界 ⇒ null', () => {
    const s = makeGameState();
    for (const bad of [-1, 4, 99]) {
      expect(speechResourceFor(s, { player: bad, event: 0 }), `玩家 ${bad}`).toBeNull();
    }
  });

  it('speechResourcesFor 把不合法的直接丢掉，其余顺序不变', () => {
    const s = makeGameState();
    s.players[1]!.character = 12; // 越界
    expect(
      speechResourcesFor(s, [
        { player: 0, event: 0 },
        { player: 1, event: 0 },
        { player: 2, event: 19 },
        { player: 9, event: 5 },
      ]),
    ).toEqual([1050, 1123]);
  });
});

// ============================================================
//  卡牌使用者台词（`lastCardPlay` → 卡牌台词表 0x48123a）
// ============================================================

describe('★★ 卡牌使用者台词 —— 一条**非状态跃迁**的台词通道', () => {
  /** 造一对状态：after 带一个「刚用出 cardId」的提示 */
  function played(who: number, character: number, cardId: number,
                  block: Partial<GameState['players'][number]['blocking']> = {}) {
    const before = makeGameState({
      currentPlayer: who,
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, character: i === who ? character : i }),
      ),
      lastCardPlay: null,
    });
    const after: GameState = {
      ...clone(before),
      lastCardPlay: { player: who, cardId },
      players: before.players.map((p, i) => (i === who ? { ...p, blocking: { ...p.blocking, ...block } } : p)),
    };
    return [before, after] as const;
  }

  it('★★ 文本 / 语音 / 卡号都来自**卡牌台词表**（不是角色台词表）', () => {
    const [before, after] = played(0, 0, 22);
    const [b] = cardPlaySpeech(before, after);
    expect(b).toMatchObject({
      player: 0,
      character: 0,
      cardId: 22,
      event: 21, // = 卡号 − 1（表 B 的槽位）
      lines: ['快滾！', '我不需要你！'],
      voice: 447, // 426 + 52×0 + 21
      emoji: null,
    });
    // 与数据层公式一致
    expect(b!.voice).toBe(cardLineVoice(0, 22));
  });

  it('★ 角色 1（不同角色 ⇒ 不同台词与语音号）', () => {
    const [before, after] = played(1, 1, 23);
    const [b] = cardPlaySpeech(before, after);
    expect(b!.lines).toEqual(['天靈靈地靈靈！']);
    expect(b!.voice).toBe(cardLineVoice(1, 23));
  });

  it('★★ 金貝貝（角色 11）整列是表情图：没有字幕，但**照样有语音**', () => {
    const [before, after] = played(0, 11, 23);
    const [b] = cardPlaySpeech(before, after);
    expect(b!.lines).toEqual([]);
    expect(b!.emoji).toBe(speechEmojiImage(12)); // `#1020@12`
    expect(b!.voice).toBe(1020); // 426 + 52×11 + 22
  });

  it('★★ 原版 `player_say` 的三道闸：消失中 / 夢遊 / 冬眠 ⇒ **一个字都不说**', () => {
    for (const block of [{ disappearing: 3 }, { sleepWalking: 5 }, { sleeping: 5 }]) {
      const [before, after] = played(0, 0, 22, block);
      expect(cardPlaySpeech(before, after)).toEqual([]);
    }
  });

  it('★ 監獄 / 醫院 / 住宿**不在**那三道闸里 ⇒ 照说', () => {
    for (const block of [{ inPrison: 3 }, { inHospital: 3 }, { inHotel: 2 }]) {
      const [before, after] = played(0, 0, 22, block);
      expect(cardPlaySpeech(before, after)).toHaveLength(1);
    }
  });

  it('★ 提示没变（同一次用卡被重复渲染）⇒ 不重复说', () => {
    const [before, after] = played(0, 0, 22);
    const same: GameState = { ...after, lastCardPlay: after.lastCardPlay };
    // `before.lastCardPlay` 与 `after.lastCardPlay` 是**同一个对象**时才算「没变」
    const repeat: GameState = { ...clone(before), lastCardPlay: null };
    expect(cardPlaySpeech(repeat, repeat)).toEqual([]);
    expect(cardPlaySpeech(after, same)).toEqual([]);
  });

  it('★ 卡号越界 ⇒ 不抛、返回空（表现层不因坏状态炸掉）', () => {
    const [before, after] = played(0, 0, 99);
    expect(cardPlaySpeech(before, after)).toEqual([]);
  });
});

// ============================================================
//  ★★ 过路费：**谁付**谁说话 —— 人机都要（试玩回报第 4 份 #6）
// ============================================================
//
// 回 exe 取证（租子结算那一段，`0x00419f20..0x0041a008`）：
//   · **付款方**：`0x00419f67`（有同盟那一支）/ `0x00419fe0`（无同盟）都是
//     `push 金額 / push 付款人 / call 0x44f42d` —— **前面没有 `who_plays` 闸门**；
//     設施那一支同形（`0x0041a71e`）；
//   · **收款方**：`0x00419fa1` / `0x00419ff0` / `0x0041a735` 的
//     `call 0x44f354(地主, 金額)`。
//   ⇒ 原版**不分人机**，谁付谁就说 9/10/11。
//
// 本引擎的判据是 `monthlyPaid` 的增量（哪个玩家都算），而电脑那条 action
// 通道**过去**是绕开 `notifyApplied` 自己 `reduce` 的直路 —— 那正是
// 「NPC 交过路费时没有台词」这一类现象的根因。2026-09-19 起两条来源共用
// `notifyApplied`（`main.ts`），下面三条钉住它。

describe('★★ 过路费台词：付款方（真人 / 电脑）都要开口', () => {
  /** 一格是玩家 1 的地（3 级）的小地图；玩家 0 站在那一格上 */
  const topo: MapTopology = {
    nodes: [
      makeNode({ id: 1, adjacent: [2], adjacentSlots: [2, 0, 0, 0], walkable: true }),
      makeNode({ id: 2, type: 0x7d0 + 1, adjacent: [1], adjacentSlots: [1, 0, 0, 0], walkable: true }),
    ],
    // owner 是 1 基：2 = 玩家 1
    lands: [makeLand({ id: 1, name: '測試路', type: 0, owner: 2, level: 3, landPrice: 1000 })],
  };

  /** 玩家 0 落在玩家 1 的地上、结算过路费；`payer` 决定他是人是电脑 */
  function landOnOtherLand(payer: number): [GameState, GameState] {
    const before = makeGameState({
      players: [
        makePlayer({ index: 0, whoPlays: payer, nodeId: 2, cash: 500_000 }),
        makePlayer({ index: 1, nodeId: 1, cash: 10_000 }),
        makePlayer({ index: 2, nodeId: 1 }),
        makePlayer({ index: 3, nodeId: 1 }),
      ],
      currentPlayer: 0,
      phase: 'settling',
      landOwner: [0, 2],
      landLevel: [0, 3],
      landType: [0, 0],
    });
    return [before, reduce(before, { type: 'settle' }, topo)];
  }

  it('★★ 电脑（AI）付我过路费 ⇒ **付款的那个电脑**说 9..11，我作为地主说 6..8', () => {
    const [before, after] = landOnOtherLand(WHO_PLAYS_COMPUTER);
    // 这一笔确实由 0 号（电脑）付、1 号（真人）收
    expect(after.players[0]!.monthlyPaid).toBeGreaterThan(0);
    expect(after.players[1]!.monthlyReceived).toBeGreaterThan(0);
    const events = said(speechEventsFor(before, after));
    expect(events).toContainEqual({ player: 0, event: 11, order: 'afterStage' });
    expect(events).toContainEqual({ player: 1, event: 8, order: 'afterStage' });
  });

  it('★ 反过来（真人付给电脑）同样是**付款人**说 9..11 —— 原版不分人机', () => {
    const [before, after] = landOnOtherLand(WHO_PLAYS_HUMAN);
    expect(said(speechEventsFor(before, after))).toContainEqual({ player: 0, event: 11, order: 'afterStage' });
  });

  it('★★ 反例（可证伪）：抹掉付款人的 `monthlyPaid` 增量 ⇒ 他那句就没了', () => {
    const [before, after] = landOnOtherLand(WHO_PLAYS_COMPUTER);
    const muted: GameState = {
      ...after,
      players: after.players.map((p, i) =>
        i === 0 ? { ...p, monthlyPaid: before.players[0]!.monthlyPaid } : p,
      ),
    };
    expect(said(speechEventsFor(before, muted))).not.toContainEqual({ player: 0, event: 11 });
  });
});

describe('★★ `notifyApplied` 必须是两条来源共用的出口', () => {
  it('定义 1 处 + 调用 2 处（真人 `applyAction` / 电脑 `scheduleAi` 的 reduce 直路）', () => {
    // 只要电脑那条直路再一次绕开它，本用例就变红 —— 那正是
    // 「NPC 付过路费没台词 / 电脑用道具没动效」这一族的根因（Q-TOOL-5 ⑤14 同一教训）。
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    // ★ D-MAGIC-16（2026-09-23）：第 3 处调用是魔法屋逐人分段（`tickMagicSequence`）按每一段再走一遍
    expect(src.split('notifyApplied(').length - 1).toBe(4);
    expect(src).toContain('notifyApplied(before);');
    expect(src).toContain('notifyApplied(beat.before);');
  });
});

// ============================================================
//  ★ 16 / 17 —— 同一街區獨佔 ≥ 3 塊（`fcn_0044f627` @ VA 0x0044f627）
// ============================================================

describe('★ 同一街區獨佔 —— 16（買地）/ 17（加蓋）', () => {
  /**
   * 三条街的地块表：`忠孝東路` = 1..4、`信義路` = 9、`和平東路` = 10。
   * 原版比较的是 `land + 0x04` 那个名字串（`call 0x458370` = strcmp），
   * 所以「街區」= **同名**的地块集合（实测地图 0：`台北市` = 地块 1..4 …）。
   */
  const lands = [
    makeLand({ id: 1, name: '忠孝東路' }),
    makeLand({ id: 2, name: '忠孝東路' }),
    makeLand({ id: 3, name: '忠孝東路' }),
    makeLand({ id: 4, name: '忠孝東路' }),
    makeLand({ id: 9, name: '信義路' }),
    makeLand({ id: 10, name: '和平東路' }),
  ];
  const topo: MapTopology = { nodes: [makeNode({ id: 1 })], lands };

  /** `p0` 已经拥有 `忠孝東路` 的哪几块（`landOwner` 是 1 基：1 = 玩家 0） */
  function monopolyBefore(owned: readonly number[], pend: GameState['pending']): GameState {
    const landOwner = new Array<number>(11).fill(0);
    for (const id of owned) landOwner[id] = 1;
    return makeGameState({
      currentPlayer: 0,
      landOwner,
      landLevel: new Array<number>(11).fill(0),
      pending: pend,
    });
  }

  it('買下第 3 块同名地 ⇒ 说 16（`0x0041a13e push 0` → 第二参 = 0 那一支 @ 0x0044f6d5）', () => {
    const before = monopolyBefore([1, 2], {
      kind: 'buyLand',
      landId: 3,
      name: '忠孝東路',
      price: 1000,
    });
    const after: GameState = { ...before, landOwner: [...before.landOwner], pending: null };
    after.landOwner[3] = 1;
    expect(detectAreaMonopoly(before, after, topo)).toEqual([{ player: 0, event: 16 }]);
    expect(said(speechEventsFor(before, after, topo))).toContainEqual({ player: 0, event: 16, order: 'afterStage' });
  });

  it('★ 可证伪：只獨佔 2 块 ⇒ 一句都不说（`cmp edi,3 / jl` @ 0x0044f66a）', () => {
    const before = monopolyBefore([1], {
      kind: 'buyLand',
      landId: 2,
      name: '忠孝東路',
      price: 1000,
    });
    const after: GameState = { ...before, landOwner: [...before.landOwner], pending: null };
    after.landOwner[2] = 1;
    expect(detectAreaMonopoly(before, after, topo)).toEqual([]);
  });

  it('★ 可证伪：不是「落点买地/加蓋」那一条路（如購地卡/拍賣直接改归属）⇒ 不说', () => {
    // pending 为空，但归属确实变成了 3 块 —— 原版那两条路根本不调 `0x44f627`
    const before = monopolyBefore([1, 2], null);
    const after: GameState = { ...before, landOwner: [...before.landOwner] };
    after.landOwner[3] = 1;
    expect(detectAreaMonopoly(before, after, topo)).toEqual([]);
  });

  it('★ 可证伪：買地那一步没有真的易主（reducer 没落地）⇒ 不说', () => {
    const before = monopolyBefore([1, 2, 3], {
      kind: 'buyLand',
      landId: 4,
      name: '忠孝東路',
      price: 1000,
    });
    // after 的归属原样（卡片/钱不够那种被拒的动作）
    const after: GameState = { ...before, landOwner: [...before.landOwner] };
    expect(detectAreaMonopoly(before, after, topo)).toEqual([]);
  });

  it('加蓋後仍是第 3 块（等級 ≠ 5）⇒ 说 17（`0x00419a31 push 1` @ 0x0044f6ab）', () => {
    const before = monopolyBefore([1, 2, 3], {
      kind: 'upgradeLand',
      landId: 3,
      name: '忠孝東路',
      cost: 200,
    });
    before.landLevel[3] = 2;
    const after: GameState = {
      ...before,
      landOwner: [...before.landOwner],
      landLevel: [...before.landLevel],
      pending: null,
    };
    after.landLevel[3] = 3;
    expect(detectAreaMonopoly(before, after, topo)).toEqual([{ player: 0, event: 17 }]);
  });

  it('★ 可证伪：加蓋**剛好到 5 級** ⇒ 那一步改说事件 15，不说 17（`0x004199eb cmp byte [esi+0x1a],5 / jne`）', () => {
    const before = monopolyBefore([1, 2, 3], {
      kind: 'upgradeLand',
      landId: 3,
      name: '忠孝東路',
      cost: 200,
    });
    before.landLevel[3] = 4;
    const after: GameState = {
      ...before,
      landOwner: [...before.landOwner],
      landLevel: [...before.landLevel],
      pending: null,
    };
    after.landLevel[3] = 5;
    expect(detectAreaMonopoly(before, after, topo)).toEqual([]);
  });

  it('★ 可证伪：加蓋那一步没有真的升一级 ⇒ 不说', () => {
    const before = monopolyBefore([1, 2, 3], {
      kind: 'upgradeLand',
      landId: 3,
      name: '忠孝東路',
      cost: 200,
    });
    before.landLevel[3] = 2;
    const after: GameState = { ...before, landOwner: [...before.landOwner], pending: null };
    expect(detectAreaMonopoly(before, after, topo)).toEqual([]);
  });

  it('★ 可证伪：3 块地分属**不同**街區（名字不同）⇒ 不说', () => {
    const before = monopolyBefore([1, 9], {
      kind: 'buyLand',
      landId: 10,
      name: '和平東路',
      price: 1000,
    });
    const after: GameState = { ...before, landOwner: [...before.landOwner], pending: null };
    after.landOwner[10] = 1;
    // 1 = 忠孝東路、9 = 信義路、10 = 和平東路 —— 各 1 块
    expect(detectAreaMonopoly(before, after, topo)).toEqual([]);
  });

  it('★ 可证伪：没有 `topo`（街區归属缺席）⇒ 这条探测器不出声，其余槽位照旧', () => {
    const before = monopolyBefore([1, 2], {
      kind: 'buyLand',
      landId: 3,
      name: '忠孝東路',
      price: 1000,
    });
    const after: GameState = { ...before, landOwner: [...before.landOwner], pending: null };
    after.landOwner[3] = 1;
    expect(detectAreaMonopoly(before, after)).toEqual([]);
    expect(said(speechEventsFor(before, after))).toEqual([]);
  });

  it('★ 街區名取自**地图**（不是 `pending.name`）：地图里那块叫别的名字 ⇒ 不说', () => {
    const otherTopo: MapTopology = {
      nodes: [makeNode({ id: 1 })],
      lands: lands.map((l) => (l.id === 3 ? { ...l, name: '其他路' } : l)),
    };
    const before = monopolyBefore([1, 2], {
      kind: 'buyLand',
      landId: 3,
      name: '忠孝東路',
      price: 1000,
    });
    const after: GameState = { ...before, landOwner: [...before.landOwner], pending: null };
    after.landOwner[3] = 1;
    // 忠孝東路 只剩 1、2 两块（3 归到「其他路」）⇒ 不到 3
    expect(detectAreaMonopoly(before, after, otherTopo)).toEqual([]);
  });
});

// ============================================================
//  ★ 22 / 23 —— 神明（`god_activate` 0x0040ead7 / `0x40e32c`）
// ============================================================

describe('★ 神明 —— 22（附身）/ 23（離身）', () => {
  /** 把某个 handle（1 基物件下标）的种类改成 `type` */
  function withType(s: GameState, handle: number, type: number): GameState {
    const objects = s.objects.map((o, i) => (i === handle - 1 ? { ...o, type } : o));
    return { ...s, objects };
  }

  it('小窮神（種類 5）附身 ⇒ 說 22（`0x0040ef2f`，取串位移 `0x4808a2` = 事件 22）', () => {
    const before = makeGameState({ currentPlayer: 1 });
    const after = withType(
      { ...before, players: before.players.map((p, i) => (i === 1 ? { ...p, godInfo: 5 } : p)) },
      5,
      5,
    );
    expect(detectGodArrived(before, after)).toEqual([{ player: 1, event: 22 }]);
  });

  it('★ 五種神明都會說（種類 5/6/7/8/15，`0x40e618..0x40e62f` 那條門檻）', () => {
    expect([...HOSTILE_GOD_TYPES]).toEqual([5, 6, 7, 8, 15]);
    for (const [handle, type] of [
      [5, 5],
      [6, 6],
      [7, 7],
      [8, 8],
      [15, 15],
    ] as const) {
      const before = makeGameState();
      const after = withType(
        { ...before, players: before.players.map((p, i) => (i === 0 ? { ...p, godInfo: handle } : p)) },
        handle,
        type,
      );
      expect(detectGodArrived(before, after), `種類 ${type}`).toEqual([{ player: 0, event: 22 }]);
    }
  });

  it('★ 可證偽：小財神（種類 1）附身 ⇒ 不說（那一支的實作 0x40ec14 沒有任何 player_say）', () => {
    const before = makeGameState();
    const after = withType(
      { ...before, players: before.players.map((p, i) => (i === 0 ? { ...p, godInfo: 1 } : p)) },
      1,
      1,
    );
    expect(detectGodArrived(before, after)).toEqual([]);
  });

  it('★ 可證偽：`godInfo` 沒變（沒換神）⇒ 不說', () => {
    const before = makeGameState();
    const after = { ...before };
    expect(detectGodArrived(before, after)).toEqual([]);
    expect(detectGodLeft(before, after)).toEqual([]);
  });

  it('★ 可證偽：附身那一刻那個人正在**夢遊**（`player_say` 第二道閘 `0x44ef86`）⇒ 不說 22', () => {
    const before = makeGameState();
    const after = withType(
      {
        ...before,
        players: before.players.map((p, i) =>
          i === 0 ? { ...p, godInfo: 5, blocking: { ...p.blocking, sleepWalking: 4 } } : p,
        ),
      },
      5,
      5,
    );
    expect(detectGodArrived(before, after)).toEqual([]);
  });

  it('★ 可證偽：神明離身時那個人正在睡（`0x44ef93`）⇒ 不說', () => {
    const before = makeGameState();
    const before2 = withType(
      { ...before, players: before.players.map((p, i) => (i === 0 ? { ...p, godInfo: 5 } : p)) },
      5,
      5,
    );
    const after = {
      ...before2,
      players: before2.players.map((p, i) =>
        i === 0 ? { ...p, godInfo: 0, blocking: { ...p.blocking, sleeping: 3 } } : p,
      ),
    };
    expect(detectGodLeft(before2, after)).toEqual([]);
    expect(detectGodArrived(before2, after)).toEqual([]);
  });

  it('★ 可證偽：種類 10（惡魔）離身 —— 送神符送得走它，但 `0x40e618` 那條門檻不含 10 ⇒ 不說', () => {
    const before = makeGameState();
    const before2 = withType(
      { ...before, players: before.players.map((p, i) => (i === 0 ? { ...p, godInfo: 10 } : p)) },
      10,
      10,
    );
    const after = {
      ...before2,
      players: before2.players.map((p, i) => (i === 0 ? { ...p, godInfo: 0 } : p)),
    };
    expect(detectGodLeft(before2, after)).toEqual([]);
  });

  it('★ 可證偽：任期屆滿 / 送神符 —— `[player+0x32]` 那個 dword 有一位非 0（如坐牢）就不說（`0x0040e356`）', () => {
    const before = makeGameState();
    const before2 = withType(
      { ...before, players: before.players.map((p, i) => (i === 0 ? { ...p, godInfo: 5 } : p)) },
      5,
      5,
    );
    const after = {
      ...before2,
      players: before2.players.map((p, i) =>
        i === 0 ? { ...p, godInfo: 0, blocking: { ...p.blocking, inPrison: 2 } } : p,
      ),
    };
    expect(detectGodLeft(before2, after)).toEqual([]);
  });

  it('任期屆滿（種類 5 → 無）⇒ 說 23（`0x41cc9b` / `0x40e64a`）', () => {
    const before = makeGameState();
    const before2 = withType(
      { ...before, players: before.players.map((p, i) => (i === 0 ? { ...p, godInfo: 5 } : p)) },
      5,
      5,
    );
    const after = {
      ...before2,
      players: before2.players.map((p, i) => (i === 0 ? { ...p, godInfo: 0 } : p)),
    };
    expect(detectGodLeft(before2, after)).toEqual([{ player: 0, event: 23 }]);
  });

  it('★ 可證偽：**破產**清 `godInfo` 不說 23 —— 原版那條走裸的 `0x40e14d`（`0x40ce40`），不經 `0x40e32c`', () => {
    const before = makeGameState();
    const before2 = withType(
      { ...before, players: before.players.map((p, i) => (i === 0 ? { ...p, godInfo: 5 } : p)) },
      5,
      5,
    );
    const after = {
      ...before2,
      players: before2.players.map((p, i) =>
        i === 0 ? { ...p, godInfo: 0, whoPlays: WHO_PLAYS_DEAD } : p,
      ),
    };
    expect(detectGodLeft(before2, after)).not.toContainEqual({ player: 0, event: 23 });
  });

  it('★★ 換神：**先**舊神離身（23）**再**新神附身（22），順序同 `0x40eb3f` → `0x40ec0d`', () => {
    const before = makeGameState();
    const before2 = withType(
      { ...before, players: before.players.map((p, i) => (i === 0 ? { ...p, godInfo: 5 } : p)) },
      5,
      5,
    );
    const after = withType(
      {
        ...before2,
        players: before2.players.map((p, i) => (i === 0 ? { ...p, godInfo: 7 } : p)),
      },
      7,
      7,
    );
    expect(said(speechEventsFor(before2, after))).toEqual([
      { player: 0, event: 23, order: 'afterStage' },
      { player: 0, event: 22, order: 'beforeStage' },
    ]);
  });

  it('★ 走 core 的 `attachGod`（= `0x40ead7`）：附身小窮神 ⇒ 22；再換大衰神 ⇒ 23 然後 22', () => {
    const before = makeGameState();
    const world = {
      players: before.players,
      objects: before.objects,
      tools: before.tools,
      toolStock: before.toolStock,
    };
    // handle 5 = objects[4]，初始種類表（`0x47ed3c`）裡正是 5 = 小窮神
    expect(before.objects[4]!.type).toBe(5);
    const a1 = attachGod(world, 0, 5);
    expect(a1.ok).toBe(true);
    const after1: GameState = { ...before, players: a1.players, objects: a1.objects };
    expect(said(speechEventsFor(before, after1))).toEqual([{ player: 0, event: 22, order: 'beforeStage' }]);

    // handle 7 = objects[6]，種類 7 = 小衰神 —— 換神：舊的（5）先走
    expect(before.objects[6]!.type).toBe(7);
    const a2 = attachGod(
      { players: a1.players, objects: a1.objects, tools: a1.tools, toolStock: a1.toolStock },
      0,
      7,
    );
    expect(a2.ok).toBe(true);
    const after2: GameState = { ...after1, players: a2.players, objects: a2.objects };
    expect(said(speechEventsFor(after1, after2))).toEqual([
      { player: 0, event: 23, order: 'afterStage' },
      { player: 0, event: 22, order: 'beforeStage' },
    ]);
  });

  it('★ 走 core 的**送神符**（`applyDispelCard` = 卡 22，`0x444cc4` → `0x40e32c`）⇒ 23', () => {
    const base = makeGameState();
    const before: GameState = {
      ...base,
      players: base.players.map((p, i) => (i === 0 ? { ...p, godInfo: 7 } : p)),
    };
    expect(before.objects[6]!.type).toBe(7);
    const r = applyDispelCard(before.players[0]!);
    expect(r.ok).toBe(true);
    expect(r.player.godInfo).toBe(0);
    const after: GameState = {
      ...before,
      players: before.players.map((p, i) => (i === 0 ? r.player : p)),
    };
    expect(said(speechEventsFor(before, after))).toEqual([{ player: 0, event: 23, order: 'afterStage' }]);
  });
});

// ============================================================
//  ★ 16 / 17 —— 走**真 reducer** 的那条路（钉住 `pending.kind` 的形状）
// ============================================================

describe('★ 同一街區獨佔：走真 reduce（落点 → 買地 / 加蓋）', () => {
  /** 三条同名地块 + 一个站在地块 1 上的玩家 0 */
  const landTopo: MapTopology = {
    nodes: [
      makeNode({
        id: 1,
        adjacent: [1],
        type: 0x7d0 + 1,
        ref: { kind: 'land', index: 1 },
      }),
    ],
    lands: [
      makeLand({ id: 1, name: '忠孝東路', landPrice: 1000, housePrice: 200 }),
      makeLand({ id: 2, name: '忠孝東路', landPrice: 1000, housePrice: 200 }),
      makeLand({ id: 3, name: '忠孝東路', landPrice: 1000, housePrice: 200 }),
    ],
  };

  it('`reduce(buyLand)` 之後 `said(speechEventsFor(before, after, topo))` 出 16', () => {
    const before = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 1, cash: 500_000 })],
      phase: 'awaitingDecision',
      // 已经擁有 2、3 两块 → 買下 1 就是第 3 块
      landOwner: [0, 0, 1, 1],
      landLevel: [0, 0, 0, 0],
      pending: { kind: 'buyLand', landId: 1, name: '忠孝東路', price: 1000 },
    });
    const after = reduce(before, { type: 'buyLand' }, landTopo);
    expect(after).not.toBe(before);
    expect(after.landOwner[1]).toBe(1);
    expect(said(speechEventsFor(before, after, landTopo))).toContainEqual({ player: 0, event: 16, order: 'afterStage' });
  });

  it('★ 可證偽：走同一條路但只獨佔 2 块 ⇒ 不出 16', () => {
    const before = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 1, cash: 500_000 })],
      phase: 'awaitingDecision',
      landOwner: [0, 0, 1, 0],
      landLevel: [0, 0, 0, 0],
      pending: { kind: 'buyLand', landId: 1, name: '忠孝東路', price: 1000 },
    });
    const after = reduce(before, { type: 'buyLand' }, landTopo);
    expect(after.landOwner[1]).toBe(1);
    expect(said(speechEventsFor(before, after, landTopo))).not.toContainEqual({ player: 0, event: 16 });
  });

  it('`reduce(upgradeLand)` 之後出 17（等級 0 → 1，沒到 5）', () => {
    const before = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 1, cash: 500_000 })],
      phase: 'awaitingDecision',
      // 三块都是自己的（1 基 1 = 玩家 0）
      landOwner: [0, 1, 1, 1],
      landLevel: [0, 0, 0, 0],
      pending: { kind: 'upgradeLand', landId: 1, name: '忠孝東路', cost: 200 },
    });
    const after = reduce(before, { type: 'upgradeLand' }, landTopo);
    expect(after.landLevel[1]).toBe(1);
    expect(said(speechEventsFor(before, after, landTopo))).toContainEqual({ player: 0, event: 17, order: 'afterStage' });
  });
});

// ============================================================
//  ★ 26 —— 開局宣言（VA 0x00407946，全 exe 唯一一處）
// ============================================================

describe('★ 開局宣言 —— 26（`fcn_00407842`，不走 action）', () => {
  it('槽位號 = 26；當前玩家（`[0x49910c]`）說自己那一句', () => {
    expect(OPENING_SPEECH_EVENT).toBe(26);
    const s = makeGameState({
      currentPlayer: 3,
      players: [
        makePlayer({ index: 0, character: 0 }),
        makePlayer({ index: 1, character: 1 }),
        makePlayer({ index: 2, character: 2 }),
        makePlayer({ index: 3, character: 5 }),
      ],
    });
    const bubbles = openingSpeech(s);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]!.character).toBe(5);
    expect(bubbles[0]!.event).toBe(26);
    expect(bubbles[0]!.voice).toBe(speechIndex(5, 26));
    expect(bubbles[0]!.lines).toEqual(['本公主', '決不放棄！']);
  });

  it('★ 12 個角色各有自己那一句、語音號都 = `speechIndex(角色, 26)`', () => {
    for (let c = 0; c < 12; c++) {
      const s = makeGameState({
        currentPlayer: 0,
        players: [makePlayer({ index: 0, character: c })],
      });
      const b = openingSpeech(s)[0]!;
      expect(b.voice, `角色 ${c}`).toBe(1050 + 27 * c + 26);
    }
  });

  it('★ 可證偽：角色號越界 ⇒ 不吐段落（也**不拋**，與 `speechResourceFor` 同一條規矩）', () => {
    const s = makeGameState({ players: [makePlayer({ index: 0, character: 99 })] });
    expect(openingSpeech(s)).toEqual([]);
  });

  it('★ 可證偽：當前玩家下標越界 ⇒ 空', () => {
    const s = makeGameState({ currentPlayer: 7 });
    expect(openingSpeech(s)).toEqual([]);
  });

  it('★ 它**不經過** `speechEventsFor`：狀態沒動時照樣一句都不說', () => {
    const s = makeGameState();
    expect(said(speechEventsFor(s, clone(s)))).not.toContainEqual({ player: 0, event: 26 });
  });
});

// ============================================================
//  ★★ W-51 台词**时机** —— 每个探测器的 order 与裁定表逐条对
// ============================================================

describe('★★ W-51 台词时机：每个探测器的 order（W-50 §2.2 裁定表）', () => {
  /**
   * **一行一个探测器**。判据 = W-50 `docs/tasks/W-50-playtest5-stage-order.md` §2.2：
   *
   * - `§2.2 表` = 首席在表里**明写**了次序的那一行；
   * - `§2.2 规则` = 表尾那条（查 `docs/tasks/speech-callsites.md` 里同一次 `player_say`
   *   调用的行：「之前」列有影片/訊息框而「之后」列没有 ⇒ `afterStage`，反之 ⇒ `beforeStage`）；
   * - `⚠E-19` = 表尾的第三种情形（**两边都没有**，或同一个探测器的两个调用点互相矛盾）
   *   ⇒ 按 C 级上报 `docs/escalations.md` E-19，**暂定 `afterStage`**（照 §2.2 对
   *   `afterNotice` 的先例）。首席裁定后改 `DETECTORS` 里那一处、并改这里的期望值。
   */
  const ORDERS: readonly (readonly [string, 'beforeStage' | 'afterStage', string])[] = [
    ['prisonEntered', 'afterStage', '§2.2 表：送監獄 `0x0043d71c`（影片 → 镜头 → 台词）'],
    ['hospitalEntered', 'afterStage', '§2.2 表：送醫院 `0x0043edcb`（影片 → 镜头 → 台词）'],
    ['dreamCard', 'afterStage', '⚠E-19：调用点 `0x00444356` 前后两列都空'],
    ['turnStartBlocked', 'beforeStage', '§2.2 表：回合开始那三句（本回合第一件事）'],
    ['bankrupt', 'afterStage', '⚠E-19：调用点 `0x0040d249` 前后两列都空'],
    ['victory', 'afterStage', '⚠E-19：调用点 `0x0040d060` 前后两列都空'],
    ['levelFive', 'beforeStage', '★E-19 已结案：两个调用点 `0x00419a19` / `0x0041ab5b` 后面**紧跟** `0x40b0cd`（0x20b 烟花）⇒ 台词在前'],
    ['areaMonopoly', 'afterStage', '⚠E-19：调用点 `0x0044f6df`（叶子函数里）两列都空'],
    ['godLeft', 'afterStage', '⚠E-19：调用点 `0x0040e659` 前后两列都空'],
    ['godArrived', 'beforeStage', '§2.2 表：壞神附身 `0x0040ef44`…（台词 → 影片 → 神明窗）'],
    // ★ W-55 行 6/7 在同一工作区里并行落地的四条 —— 也在这张「一行一个探测器」的表里
    ['landGodLine', 'afterStage', '§2.2 表：土地公顯靈 `0x0040f8ab`（镜头 → 訊息框 → 台词）'],
    ['luckyGodLine', 'afterStage', '§2.2 表：福神顯靈 `0x0040fa1e/0x0040fa5c` 裁定 afterNotice；两档制下取 §2.2 兜底的 afterStage'],
    ['smallWealthLine', 'afterStage', '§2.2 表：小財神 `0x0040ecde`（神明台词窗 → 轉盤窗 → 收款 → 台词）'],
    ['bigWealthLine', 'afterStage', 'W-55 行 7（G34）：`0x0040ed85` 排在收款 `0x0040ed52` 之后（§2.2 表没有这一行）'],
    ['moneyPaid', 'afterStage', '§2.2 表：設施收費 `0x0041a71e`（轉盤 → 訊息框 → 收費 → 台词）'],
    ['shopGift', 'afterStage', '★W-67-a：董事長赠礼 —— 訊息框（0x464378）→ 台词（0x44f230）'],
    ['godCard', 'afterStage', '★第八份 #5：福神附身得卡 —— 开场白 → 卡面 → 訊息框（0x4632fd）→ 台词（0x44f230）'],
    ['moneyGained', 'afterStage', '⚠E-19：调用点 `0x0044f420` 前后两列都空'],
    ['noticeSay', 'afterStage', '第十四份：訊息框之后紧跟的那一句（框在前）'],
    ['hotelStay', 'afterStage', '⚠E-19：`0x0041a7e0` 所在函数没有 `player_say`；`0x0044f347` 两列都空'],
    ['pointsGained', 'afterStage', '⚠E-19：调用点 `0x0044f2b5` 前后两列都空'],
    ['pointsSquarePhrase', 'afterStage', '⚠E-19：`0x0041b211` 两列都空、`0x004154cf` 前有訊息框'],
    // ★★ 第九份试玩回报 #6：命運 0 強制拆除房屋 —— 镜头(`0x0044bee8`) → 赔款(`0x0044bf36`)
    //   → 镜头复位(`0x0044bf51`) → sleep 300(`0x0044bf5e`) → 台词(`0x0044bf9f`) ⇒ afterStage
    ['demolishedHouse', 'afterStage', '第九份 #6：`0x0044bf9f` 排在 sleep 300 与镜头复位之后'],
    // ★★ 第十二份：新聞 5/15/19/21 房主那句 —— view_to → mutate_land →（影片 → sleep）→ 台词（函数最后一步）
    ['newsPlaceOwner', 'afterStage', '第十二份：新聞 21 `0x0044ae84` 排在影片 `0x0044ae2c` 与 sleep 300 之后'],
    // ★ 魔法屋（2026-09-23）：加蓋 / 拆除两支 —— 訊息框 `0x440cac` → 影片 `0x45144f`（→ 0x20b）→ 台词 `0x004320a2`
    ['magicPonder', 'afterStage', '魔法屋：`0x004320a2` 排在 0x229 / 0x211 影片之后'],
    // ★ 魔法屋拍賣那一支：拍賣窗口 `0x43bde5` 关掉之后才说
    ['magicAuctionPonder', 'afterStage', '魔法屋：`0x004324d5` 拍賣之后 `jmp 0x4320a2`'],
  ];

  it.each(ORDERS)('%s ⇒ %s（%s）', (name, order) => {
    const d = DETECTORS.find((x) => x.name === name);
    expect(d, `探测器 ${name} 不在 DETECTORS 里`).toBeDefined();
    expect(d!.order).toBe(order);
  });

  it('★ 一个都不漏、一个都不多：DETECTORS 与这张表一一对应', () => {
    expect([...DETECTORS].map((d) => d.name).sort()).toEqual(ORDERS.map(([n]) => n).sort());
  });

  it('★ 每条 order 都是显式写的两个字面量之一（没有缺省值可漏）', () => {
    for (const d of DETECTORS) {
      expect(['beforeStage', 'afterStage'], `${d.name} 的 order`).toContain(d.order);
    }
  });

  it('★ `speechEventsFor` 把**探测器自己的** order 盖在每一条命中上', () => {
    const [b, a] = to((s) => {
      s.players[0]!.blocking.inPrison = 3;
    });
    expect(said(speechEventsFor(b, a))).toEqual([{ player: 0, event: 19, order: 'afterStage' }]);
  });

  it('★ 一次跃迁里两种 order 并存：換神 = 23（afterStage）+ 22（beforeStage）', () => {
    const world = (s: GameState) => ({
      players: s.players,
      objects: s.objects,
      tools: s.tools,
      toolStock: s.toolStock,
    });
    const s0 = makeGameState();
    const a1 = attachGod(world(s0), 0, 5); // 小窮神（種類 5）
    const s1: GameState = { ...s0, players: a1.players, objects: a1.objects };
    const a2 = attachGod(world(s1), 0, 7); // 換小衰神（種類 7）：舊神先走
    const s2: GameState = { ...s1, players: a2.players, objects: a2.objects };
    expect(said(speechEventsFor(s1, s2))).toEqual([
      { player: 0, event: 23, order: 'afterStage' },
      { player: 0, event: 22, order: 'beforeStage' },
    ]);
  });

  it('★ `speechLinesFor` 把段落与 order 一起交出来（`queueSpeech` 靠它分流）', () => {
    const [b, a] = to((s) => {
      s.players[0]!.blocking.inPrison = 3;
    });
    const lines = speechLinesFor(a, said(speechEventsFor(b, a)));
    expect(lines.map((l) => l.order)).toEqual(['afterStage']);
    expect(lines.map((l) => l.bubble.event)).toEqual([19]);
  });
});

// ============================================================
//  ★ W-55 行 6 / 7：神明落脚顯靈与財神的台词（`lastGodLine` / `lastGodPower`）
// ============================================================

describe('★ 土地公顯靈 —— 事件 0（`0x0040f8ab`，角色台词表 `[角色][0]`）', () => {
  const withNotice = (s: GameState, key: NoticeKey): GameState => ({
    ...s,
    notices: [...s.notices, { key, args: [] }],
  });

  it('★ 訊息框 `god.seize` 新出现 ⇒ 当前玩家说事件 0', () => {
    const before = makeGameState({ currentPlayer: 2 });
    const after = withNotice(before, 'god.seize');
    expect(detectLandGodLine(before, after)).toEqual([{ player: 2, event: 0 }]);
  });

  it('★ 可证伪：`god.seize` 上一条 action 就有（没新出现）⇒ 不说', () => {
    const before = withNotice(makeGameState(), 'god.seize');
    const after = withNotice(before, 'god.build');
    expect(detectLandGodLine(before, after)).toEqual([]);
  });

  it('★ 可证伪：别的框（拆屋/加倍/收租）一律不说 —— 只有 `god.seize` 是土地公', () => {
    const before = makeGameState();
    for (const key of ['god.demolish', 'god.build', 'rent.payOneOwner', 'points.card'] as const) {
      expect(detectLandGodLine(before, withNotice(before, key)), key).toEqual([]);
    }
  });

  it('★ `player_say` 三道闸（`0x44ef79/86/93`）：消失 / 夢遊 / 睡眠 任一非 0 ⇒ 不说', () => {
    for (const blocking of [
      { disappearing: 1 },
      { sleepWalking: 4 },
      { sleeping: 3 },
    ] as const) {
      const before = makeGameState();
      const after = withNotice(
        {
          ...before,
          players: before.players.map((p, i) =>
            i === 0 ? { ...p, blocking: { ...p.blocking, ...blocking } } : p,
          ),
        },
        'god.seize',
      );
      expect(detectLandGodLine(before, after), JSON.stringify(blocking)).toEqual([]);
    }
  });

  it('★ 坐牢 / 住院**不在**那三道闸里（照抄原版：`+0x34` / `+0x35` 不查）', () => {
    const before = makeGameState();
    const after = withNotice(
      {
        ...before,
        players: before.players.map((p, i) =>
          i === 0 ? { ...p, blocking: { ...p.blocking, inPrison: 2, inHospital: 3 } } : p,
        ),
      },
      'god.seize',
    );
    expect(detectLandGodLine(before, after)).toEqual([{ player: 0, event: 0 }]);
  });
});

describe('★ 福神顯靈（没到 5 级）—— 事件 0 / 1，取 core 交出来的 `rand()&1`', () => {
  /** 只带 `lastGodLine` 的最小跃迁 */
  function withLine(before: GameState, event: number, player = 0): [GameState, GameState] {
    const after: GameState = { ...before, lastGodLine: { player, event } };
    return [before, after];
  }

  it('★ 事件 0 与 事件 1 **两个槽位都能出**（不是恒取 0）', () => {
    for (const event of [0, 1]) {
      const [before, after] = withLine(makeGameState({ currentPlayer: 1 }), event, 1);
      expect(detectLuckyGodLine(before, after), `event ${event}`).toEqual([
        { player: 1, event },
      ]);
    }
  });

  it('★ 可证伪：同一个对象引用（上一条 action 留下的）⇒ 不说', () => {
    const probe: GameState = { ...makeGameState(), lastGodLine: { player: 0, event: 1 } };
    const after: GameState = { ...probe, rngState: probe.rngState + 1 };
    expect(detectLuckyGodLine(probe, after)).toEqual([]);
  });

  it('★ 没有提示（普通升級 / 到 5 级那一支）⇒ 不说', () => {
    const before = makeGameState();
    expect(detectLuckyGodLine(before, { ...before, lastGodLine: null })).toEqual([]);
    expect(detectLuckyGodLine(before, before)).toEqual([]);
  });

  it('★ 三道闸同样适用', () => {
    const before = makeGameState();
    const after: GameState = {
      ...before,
      players: before.players.map((p, i) =>
        i === 0 ? { ...p, blocking: { ...p.blocking, sleepWalking: 5 } } : p,
      ),
      lastGodLine: { player: 0, event: 1 },
    };
    expect(detectLuckyGodLine(before, after)).toEqual([]);
  });
});

describe('★ G33 小財神（`0x0040ecde`）—— 事件 8，`amount > 0x2bc` 才说', () => {
  function wealth(
    before: GameState,
    type: number,
    amount: number,
    over: Partial<GameState> = {},
  ): [GameState, GameState] {
    const after: GameState = { ...before, ...over, lastGodPower: { player: 0, type, amount } };
    return [before, after];
  }

  it('★ 阈值方向：**701 说、700 不说**（`cmp esi,0x2bc / jle`）', () => {
    expect(SMALL_WEALTH_LINE_MIN).toBe(700);
    const [b1, a1] = wealth(makeGameState(), SMALL_WEALTH_GOD_TYPE, 701);
    expect(detectSmallWealthLine(b1, a1)).toEqual([{ player: 0, event: 8 }]);
    const [b2, a2] = wealth(makeGameState(), SMALL_WEALTH_GOD_TYPE, 700);
    expect(detectSmallWealthLine(b2, a2)).toEqual([]);
    const [b3, a3] = wealth(makeGameState(), SMALL_WEALTH_GOD_TYPE, 0);
    expect(detectSmallWealthLine(b3, a3)).toEqual([]);
  });

  it('★ 大財神（種類 2）走到这条探测器 ⇒ 不说（走 `detectBigWealthLine`）', () => {
    const [b, a] = wealth(makeGameState(), BIG_WEALTH_GOD_TYPE, 999);
    expect(detectSmallWealthLine(b, a)).toEqual([]);
  });

  it('★ 终局码非 0（`after.phase === "gameOver"`）⇒ 不说 @source 0x0040ecac', () => {
    const start = makeGameState();
    const [b, a] = wealth(start, SMALL_WEALTH_GOD_TYPE, 999, { phase: 'gameOver' });
    expect(detectSmallWealthLine(b, a)).toEqual([]);
    // 反证：同一笔金额、非终局 ⇒ 说 —— 差异只来自那一道闸
    const [b2, a2] = wealth(start, SMALL_WEALTH_GOD_TYPE, 999);
    expect(detectSmallWealthLine(b2, a2)).toEqual([{ player: 0, event: 8 }]);
  });

  it('★ 可证伪：提示是上一条 action 留下的（引用相同）⇒ 不说', () => {
    const probe: GameState = {
      ...makeGameState(),
      lastGodPower: { player: 0, type: SMALL_WEALTH_GOD_TYPE, amount: 900 },
    };
    const after: GameState = { ...probe, rngState: probe.rngState + 1 };
    expect(detectSmallWealthLine(probe, after)).toEqual([]);
  });
});

describe('★ G34 大財神（`0x0040ed85`）—— 走「進帳」档位，闸门 = `≥ 5000×物價`', () => {
  function wealth(before: GameState, type: number, amount: number): [GameState, GameState] {
    const after: GameState = { ...before, lastGodPower: { player: 0, type, amount } };
    return [before, after];
  }

  it('★ 阈值方向：**5000×物價 说、少 1 元不说**', () => {
    const start = makeGameState({ priceIndex: 2 });
    const threshold = MONEY_TIER_MID * 2;
    const [b1, a1] = wealth(start, BIG_WEALTH_GOD_TYPE, threshold);
    expect(detectBigWealthLine(b1, a1)).toEqual([{ player: 0, event: 6 }]);
    const [b2, a2] = wealth(start, BIG_WEALTH_GOD_TYPE, threshold - 1);
    expect(detectBigWealthLine(b2, a2)).toEqual([]);
  });

  it('★ 事件号由 `gainEventFor` 给（≥5000 档 ⇒ 事件 6），不是写死的 6', () => {
    const start = makeGameState({ priceIndex: 1 });
    const [b, a] = wealth(start, BIG_WEALTH_GOD_TYPE, 9000);
    expect(gainEventFor(9000, 1)).toBe(6);
    expect(detectBigWealthLine(b, a)).toEqual([{ player: 0, event: 6 }]);
  });

  it('★ 小財神（種類 1）走到这条 ⇒ 不说', () => {
    const start = makeGameState();
    const [b, a] = wealth(start, SMALL_WEALTH_GOD_TYPE, 9999);
    expect(detectBigWealthLine(b, a)).toEqual([]);
  });
});

describe('★★ W-55：財神那一笔**让开**通用的進帳/付錢两条探测器', () => {
  it('★★ 小財神：附身者收款 6000 元 + `lastGodPower` ⇒ 通用 `moneyGained` **不开口**（原版那句是事件 8）', () => {
    const start = makeGameState({
      players: [makePlayer({ index: 0 }), makePlayer({ index: 1 })],
      currentPlayer: 0,
    });
    const before = start;
    const gained: GameState = {
      ...before,
      players: before.players.map((p, i) => (i === 0 ? { ...p, monthlyReceived: 6000 } : p)),
    };
    // ★ 第十四份：「進帳」只认 core 交出来的 `lastGainSays`（財神那一笔 core 不交）⇒ 本来就不开口
    expect(detectMoneyGained(before, gained)).toEqual([]);
    // 有財神提示时：让开，由 `detectSmallWealthLine` 独家负责
    const withHint: GameState = {
      ...gained,
      lastGodPower: { player: 0, type: SMALL_WEALTH_GOD_TYPE, amount: 500 },
    };
    expect(detectMoneyGained(before, withHint)).toEqual([]);
    // 500 ≤ 700 ⇒ 小財神那句也不说（原版就是一声不吭）
    expect(detectSmallWealthLine(before, withHint)).toEqual([]);
  });

  it('★ 大財神：附身者進帳 9000 ⇒ 通用路让开，`bigWealthLine` 独家说事件 6（**只说一次**）', () => {
    const before = makeGameState({
      players: [makePlayer({ index: 0 }), makePlayer({ index: 1 })],
      currentPlayer: 0,
    });
    const after: GameState = {
      ...before,
      players: before.players.map((p, i) => (i === 0 ? { ...p, monthlyReceived: 9000 } : p)),
      lastGodPower: { player: 0, type: BIG_WEALTH_GOD_TYPE, amount: 9000 },
    };
    expect(detectMoneyGained(before, after)).toEqual([]);
    expect(detectBigWealthLine(before, after)).toEqual([{ player: 0, event: 6 }]);
    // 合起来仍然只有一条
    expect(said(speechEventsFor(before, after)).filter((e) => e.player === 0 && e.event === 6)).toHaveLength(1);
  });

  it('★ 大財神：金额 3000（< 5000×物價）⇒ **谁都不说**（原版那一道闸拦住的正是它）', () => {
    const before = makeGameState({
      players: [makePlayer({ index: 0 }), makePlayer({ index: 1 })],
      currentPlayer: 0,
    });
    const after: GameState = {
      ...before,
      players: before.players.map((p, i) => (i === 0 ? { ...p, monthlyReceived: 3000 } : p)),
      lastGodPower: { player: 0, type: BIG_WEALTH_GOD_TYPE, amount: 3000 },
    };
    // 通用路本来会按 2000×物價 说事件 8 —— 让开之后一声不吭
    expect(detectMoneyGained(before, after)).toEqual([]);
    expect(detectBigWealthLine(before, after)).toEqual([]);
  });

  it('★ 財神提示里的那个人不被通用 `moneyPaid` 重复说（让开）', () => {
    const before = makeGameState({
      players: [makePlayer({ index: 0 }), makePlayer({ index: 1 })],
      currentPlayer: 0,
    });
    // 构造「附身者付 9000 给另一个玩家」的形状 ——
    // 这一条只钉「提示里那个人不被通用路重复说」这条不变量：
    // 没有提示时通用路按 `monthlyPaid` + 收款方 `monthlyReceived` 会说事件 9，有提示时让开。
    // （★ 第十四份 #1 之后「进公库」那一形状通用路本来就不说了，故改用付给玩家的形状。）
    const paid: GameState = {
      ...before,
      players: before.players.map((p, i) =>
        i === 0 ? { ...p, monthlyPaid: 9000 } : i === 1 ? { ...p, monthlyReceived: 9000 } : p,
      ),
    };
    expect(detectMoneyPaid(before, paid)).toEqual([{ player: 0, event: 9 }]);
    const withHint: GameState = {
      ...paid,
      lastGodPower: { player: 0, type: SMALL_WEALTH_GOD_TYPE, amount: 900 },
    };
    expect(detectMoneyPaid(before, withHint)).toEqual([]);
  });
});

describe('★ W-55 的探测器都在 `DETECTORS` 里、且 `order` 照 §2.2', () => {
  it('★ 四条新探测器各有一条 `order`（表里没有的那些按兜底 `afterStage`）', () => {
    const want: Record<string, string> = {
      // §2.2：土地公顯靈 —— 镜头 → 訊息框 → 台词
      landGodLine: 'afterStage',
      // §2.2 说 `afterNotice`，而 `SpeechOrder` 只有两档 ⇒ 兜底 `afterStage`
      luckyGodLine: 'afterStage',
      // §2.2：小財神 —— 神明台词窗 → 轉盤窗 → 收款 → 台词
      smallWealthLine: 'afterStage',
      // W-55 表尾指定 `afterStage`（收款之后才说）
      bigWealthLine: 'afterStage',
    };
    for (const [name, order] of Object.entries(want)) {
      const d = DETECTORS.find((x) => x.name === name);
      expect(d, name).toBeTruthy();
      expect(d!.order, name).toBe(order);
      expect(d!.source.length, name).toBeGreaterThan(0);
    }
  });

  it('★ 名词不重复（顺序表里一个名字只能有一条）', () => {
    const names = DETECTORS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ============================================================
//  ★★ 第十四份試玩回報
// ============================================================

describe('★★ 第十四份 #1 同类排查：保險理賠那一笔原版**不说**（`fcn_0044ba63` 里没有 player_say）', () => {
  it('★★ 保險期内抽到命運 30「付保險金」⇒ 只说付錢那一句 9，理赔那一笔**不**说「這是我應得的！」', () => {
    const [b, a] = step((before, after) => {
      before.players[0]!.insuranceDays = 30;
      after.players[0]!.insuranceDays = 30;
      after.players[0]!.monthlyPaid += 5000;
      after.pool += 5000;
      after.players[0]!.monthlyReceived += 5000; // 保險公司赔回（`0x0044cf11`）
      after.lastEvent = { kind: 'fortune', id: 30 };
    });
    expect(detectMoneyGained(b, a)).toEqual([]);
    expect(said(speechEventsFor(b, a)).map((e) => [e.player, e.event])).toEqual([[0, 9]]);
  });

  it('★ 冒貸（命運 2）的理赔 ⇒ 不说（@source 0x0044c218，前后没有 0x44f354）', () => {
    const [b, a] = step((before, after) => {
      before.players[0]!.insuranceDays = 30;
      after.players[0]!.monthlyReceived += 10000;
      after.lastEvent = { kind: 'fortune', id: 2 };
    });
    expect(detectMoneyGained(b, a)).toEqual([]);
  });

  it('★ 坐牢 / 住院 / 住旅館的理赔（2000×天×物價）⇒ 只说那一句（19 / 20 / 3..5），不说「蠅頭小利～」', () => {
    for (const field of ['inPrison', 'inHospital', 'inHotel'] as const) {
      const [b, a] = step((before, after) => {
        before.players[1]!.insuranceDays = 30;
        after.players[1]!.blocking[field] = 3;
        after.players[1]!.monthlyReceived += 6000;
      });
      expect(detectMoneyGained(b, a)).toEqual([]);
    }
  });
});

describe('★★ 第十四份 #2：道具台词**先说**、说完才起演出（`TOOL_LINE_ORDER`）', () => {
  it('★★ 次序是 `beforeStage` —— 13 件道具的 `player_say` 都在选格 / 大锤 / 投掷 / 爆炸之前（機器工人 0x004472ba → 0x0044735c）', () => {
    expect(TOOL_LINE_ORDER).toBe('beforeStage');
    // `beforeStage` 永不押后（台上再忙也立即入队 ⇒ 影片 / 建屋动效反过来等它说完）
    expect(deferSpeech(TOOL_LINE_ORDER, true)).toBe(false);
  });

  it('★ 用機器工人（9）⇒ 一句、次序 `beforeStage`', () => {
    const before = makeGameState();
    const after: GameState = { ...before, lastToolUsed: { player: 0, toolId: 9 } };
    const lines = toolUseSpeechLines(before, after);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.order).toBe('beforeStage');
    // 13 件都同一个次序
    for (let toolId = 1; toolId <= 13; toolId++) {
      const a: GameState = { ...before, lastToolUsed: { player: 0, toolId } };
      for (const l of toolUseSpeechLines(before, a)) expect(l.order).toBe('beforeStage');
    }
  });

  it('★ `main.ts` 不再把道具台词硬写成 `afterStage`（走 `toolUseSpeechLines`）', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(src).toContain('toolUseSpeechLines(before, after)');
    expect(src).not.toMatch(/\.\.\.toolBubbles\]\.map/);
    // 投掷也等台词说完（`beginObjectFlight` 的 `awaitSpeech`）
    expect(src).toContain('awaitSpeech: true');
  });
});

describe('★★ 第十四份：訊息框之后紧跟的那一句（`detectNoticeSay`）', () => {
  it('★ 免收九种 ⇒ 当前玩家事件 13（@source 0x0041d6dd）', () => {
    const [b, a] = to((s) => {
      s.notices = [{ key: 'rent.freePrison', args: ['x', '過路費'], say: { player: 0, event: 13 } }];
    });
    expect(detectNoticeSay(b, a)).toEqual([{ player: 0, event: 13 }]);
  });

  it('★★ 免付（`0x44f567`）按原额分档：≥9000 ⇒ 12、5000..9000 ⇒ 12（rand&1 取 0）、>0 ⇒ 14', () => {
    for (const [amount, event] of [[9000, 12], [5000, 12], [1200, 14]] as const) {
      const [b, a] = to((s) => {
        s.notices = [{ key: 'god.tollFree', args: ['過路費'], say: { player: 2, reliefAmount: amount } }];
      });
      expect(detectNoticeSay(b, a)).toEqual([{ player: 2, event }]);
    }
  });

  it('★ 同一份 notices（上一条留下的）⇒ 不再说；次序 `afterStage`（框在前）', () => {
    const [b] = to((s) => {
      s.notices = [{ key: 'rent.freeSealed', args: ['過路費'], say: { player: 0, event: 13 } }];
    });
    expect(detectNoticeSay(b, { ...b })).toEqual([]);
    expect(DETECTORS.find((d) => d.name === 'noticeSay')?.order).toBe('afterStage');
  });

  it('★★ 回报现场同类：宮本寶藏被神明免付 5000 ⇒ 说 12「哈哈哈，很羨慕吧！」—— 这回是**真的**逃过一劫', () => {
    const [b, a] = to((s) => {
      s.players[0]!.character = 6;
      s.notices = [{ key: 'blessing.penaltyVoid', args: ['小財神'], say: { player: 0, reliefAmount: 5000 } }];
    });
    const lines = speechLinesFor(a, speechEventsFor(b, a));
    expect(lines.map((l) => l.bubble.lines.join(''))).toEqual(['哈哈哈，很羨慕吧！']);
  });
});

describe('★★ 第十四份 #4：真人选定道具时先说，action 落地不再说第二遍', () => {
  const base = makeGameState({ turnCount: 7 });
  const used: GameState = { ...base, lastToolUsed: { player: 0, toolId: 9 } };

  it('同一回合、同一人、同一件 ⇒ 吞掉', () => {
    expect(ownToolLineSpoken(base, used, { player: 0, toolId: 9, turnCount: 7 })).toBe(true);
  });

  it('旁观端（没有本机记录）/ 换了一件 / 换了回合 ⇒ 照说', () => {
    expect(ownToolLineSpoken(base, used, null)).toBe(false);
    expect(ownToolLineSpoken(base, used, { player: 0, toolId: 2, turnCount: 7 })).toBe(false);
    expect(ownToolLineSpoken(base, used, { player: 0, toolId: 9, turnCount: 8 })).toBe(false);
  });

  it('`main.ts`：选格 / 骰面盘的道具先说再开界面（`sayOwnToolLine`），落地时吞掉本机说过的那句', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(src).toContain('sayOwnToolLine(id, () => startToolPick(id, param))');
    expect(src).toContain('sayOwnToolLine(id, () => openDicePick())');
    expect(src).toContain('ownToolLineSpoken(before, after, ownToolLine)');
  });

  it('★ #5 機器娃娃：那一趟押着等台词（`holdActorWalk`），台词说完才放（`tickDollRelease`）', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(src).toContain('renderer.holdActorWalk(specialSlotOf(ACTOR_DOLL))');
    expect(src).toContain('renderer.releaseActorWalks(performance.now())');
  });
});
