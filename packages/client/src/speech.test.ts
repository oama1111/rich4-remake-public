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
import {
  makeGameState,
  makePlayer,
  WHO_PLAYS_COMPUTER,
  WHO_PLAYS_DEAD,
  WHO_PLAYS_HUMAN,
  type GameState,
} from '@rich4/core';
import { cardLineVoice, SPEECH_EVENTS_PER_CHARACTER, speechEmojiImage, speechIndex } from '@rich4/data';
import {
  DETECTORS,
  MONEY_TIER_HIGH,
  MONEY_TIER_LOW,
  MONEY_TIER_MID,
  detectBankrupt,
  detectDreamCard,
  detectHospitalEntered,
  detectHotelStay,
  detectLevelFive,
  detectMoneyGained,
  detectMoneyPaid,
  detectPointsGained,
  detectPrisonEntered,
  detectTurnStartBlocked,
  detectVictory,
  cardPlaySpeech,
  gainEventFor,
  mostHostilePlayer,
  payTierFor,
  smallGainTierFor,
  smallLossTierFor,
  speechEventsFor,
  speechResourceFor,
  speechResourcesFor,
} from './speech.ts';

// ============================================================
//  构造 before/after
// ============================================================

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState;

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
      expect(speechEventsFor(base, after)).toEqual([{ player: 1, event }]);
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
    expect(speechEventsFor(before, after)).toEqual([{ player: 0, event: 1 }]);
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
    const evs = speechEventsFor(before, after);
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

  it('坐牢 ⇒ 事件 19', () => {
    const [b, a] = blocked((s) => {
      s.players[1]!.blocking.inPrison = 2;
    });
    expect(detectTurnStartBlocked(b, a)).toEqual([{ player: 1, event: 19 }]);
  });

  it('住院 ⇒ 事件 20', () => {
    const [b, a] = blocked((s) => {
      s.players[1]!.blocking.inHospital = 2;
    });
    expect(detectTurnStartBlocked(b, a)).toEqual([{ player: 1, event: 20 }]);
  });

  it('冬眠 ⇒ 事件 21', () => {
    const [b, a] = blocked((s) => {
      s.players[1]!.blocking.sleeping = 2;
    });
    expect(detectTurnStartBlocked(b, a)).toEqual([{ player: 1, event: 21 }]);
  });

  it('★ 冬眠那一支还要求住宿/消失为 0（`cmp dword [eax+50],0 / jne`）', () => {
    const [b, a] = blocked((s) => {
      s.players[1]!.blocking.sleeping = 2;
      s.players[1]!.blocking.inHotel = 1;
    });
    expect(detectTurnStartBlocked(b, a)).toEqual([]);
  });

  it('★ 住宿/消失原本就**不出语音**（只出状态文字）', () => {
    const [b, a] = blocked((s) => {
      s.players[1]!.blocking.inHotel = 4;
    });
    expect(detectTurnStartBlocked(b, a)).toEqual([]);
  });

  it('坐牢与住院可以同时命中（原版三条 if 各自独立）', () => {
    const [b, a] = blocked((s) => {
      s.players[1]!.blocking.inPrison = 2;
      s.players[1]!.blocking.inHospital = 2;
    });
    expect(detectTurnStartBlocked(b, a)).toEqual([
      { player: 1, event: 19 },
      { player: 1, event: 20 },
    ]);
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

describe('進帳 ⇒ 事件 6/7/8', () => {
  it('本月收入 +9000 ⇒ 事件 6', () => {
    const [b, a] = to((s) => {
      s.players[1]!.monthlyReceived += 9000;
    });
    expect(detectMoneyGained(b, a)).toEqual([{ player: 1, event: 6 }]);
  });

  it('+3000 ⇒ 事件 8；+1000 ⇒ 不吭声', () => {
    const [b, a] = to((s) => {
      s.players[1]!.monthlyReceived += 3000;
    });
    expect(detectMoneyGained(b, a)).toEqual([{ player: 1, event: 8 }]);

    const [b2, a2] = to((s) => {
      s.players[2]!.monthlyReceived += 1000;
    });
    expect(detectMoneyGained(b2, a2)).toEqual([]);
  });

  it('★ 物價指數 2 时门槛翻倍（9000 只够最低档）', () => {
    const [b, a] = step((before, after) => {
      before.priceIndex = 2;
      after.priceIndex = 2;
      after.players[0]!.monthlyReceived += 9000;
    });
    expect(detectMoneyGained(b, a)).toEqual([{ player: 0, event: 8 }]);
  });
});

describe('付錢 / 罰款 ⇒ 事件 9..11 / 12..14 / 18', () => {
  it('付给另一个玩家 ⇒ 9（付方）+ 6（收方）', () => {
    const [b, a] = to((s) => {
      s.players[0]!.monthlyPaid += 9000;
      s.players[1]!.monthlyReceived += 9000;
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

  it('★ 没有收款玩家、公库涨了 ⇒ 走罰款那一家（12..14）', () => {
    const [b, a] = to((s) => {
      s.players[0]!.monthlyPaid += 100;
      s.pool += 100;
    });
    expect(detectMoneyPaid(b, a)).toEqual([{ player: 0, event: 14 }]);

    const [b2, a2] = to((s) => {
      s.players[0]!.monthlyPaid += 9000;
      s.pool += 9000;
    });
    expect(detectMoneyPaid(b2, a2)).toEqual([{ player: 0, event: 12 }]);
  });

  it('★ 钱进了企业（没人涨收入、公库也没涨）就不吭声', () => {
    const [b, a] = to((s) => {
      s.players[0]!.monthlyPaid += 9000;
      s.companyFunds[3] = (s.companyFunds[3] ?? 0) + 9000;
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
    });
    expect(speechEventsFor(b, a)).toEqual([
      { player: 0, event: 9 },
      { player: 1, event: 6 },
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
    expect(speechEventsFor(b, a)).toEqual([
      { player: 0, event: 19 },
      { player: 0, event: 24 },
    ]);
  });

  it('状态没动 ⇒ 一句话都不说', () => {
    const [b, a] = to(() => {});
    expect(speechEventsFor(b, a)).toEqual([]);
  });

  it('对默认局做一次自比为「无变化」的调用：不抛异常', () => {
    const s = makeGameState();
    expect(() => speechEventsFor(s, clone(s))).not.toThrow();
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
