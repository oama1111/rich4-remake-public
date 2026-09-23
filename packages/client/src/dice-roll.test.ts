/*
 * 掷骰那一段的三段时序
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉住的是**时长与顺序**，不是点数 —— 点数由 core 决定，这里只负责「什么时候画」。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DICE_HOLD_MS, DiceRollFx } from './dice-roll.ts';
import type { LoadedFlic } from './assets.ts';

/** 造一段假影片：`n` 帧、每帧 `ms` 毫秒 */
function fakeFlic(n: number, ms: number): LoadedFlic {
  return {
    frames: Array.from({ length: n }, () => ({}) as unknown as ImageBitmap),
    width: 189,
    height: 285,
    frameMs: ms,
    close: () => {},
  };
}

const TICK = 80;

describe('DiceRollFx —— 预动作 → 滚骰 → 定格', () => {
  it('★ 预动作要整整 `每向帧数` 个 tick 才算数满（走路 = 9）', () => {
    const fx = new DiceRollFx();
    fx.begin(1000, 9, TICK, 1);
    expect(fx.phase).toBe('anticipate');
    expect(fx.wantsRoll).toBe(true);
    // 数到第 8 个 tick 还没到
    expect(fx.anticipationDone(1000 + 8 * TICK)).toBe(false);
    // 第 9 个 tick 到点
    expect(fx.anticipationDone(1000 + 9 * TICK)).toBe(true);
  });

  it('★ 催过一次就不会重复催 —— 一个回合只掷一次', () => {
    const fx = new DiceRollFx();
    fx.begin(0, 9, TICK, 1);
    fx.markRollRequested();
    expect(fx.wantsRoll).toBe(false);
  });

  it('★ 滚骰时长 = 帧数 × FLIC 头里的每帧毫秒（36 × 14 = 504）', () => {
    const fx = new DiceRollFx();
    fx.begin(0, 9, TICK, 2);
    fx.markRollRequested();
    fx.roll(0, [3, 5], fakeFlic(36, 14));
    expect(fx.phase).toBe('tumble');
    expect(fx.tumbleMs()).toBe(504);
  });

  it('★ 影片逐帧推进，**播完停下**（flags bit2 没置位 = 不循环）', () => {
    const fx = new DiceRollFx();
    fx.begin(0, 9, TICK, 1);
    fx.roll(0, [4], fakeFlic(36, 14));
    expect(fx.flicFrame(0)).toBe(0);
    expect(fx.flicFrame(14)).toBe(1);
    expect(fx.flicFrame(35 * 14)).toBe(35);
    // 播完停在最后一帧，不会绕回 0
    expect(fx.flicFrame(36 * 14 - 1)).toBe(35);
  });

  it('★ 滚完之后盖点数、留 500 ms（@source VA 0x004196da）', () => {
    const fx = new DiceRollFx();
    fx.begin(0, 9, TICK, 2);
    fx.roll(0, [2, 6], fakeFlic(36, 14));
    // 滚骰中不画点数
    expect(fx.pips(200)).toBeNull();
    // 滚完进定格
    expect(fx.pips(504)).toEqual([2, 6]);
    expect(fx.pips(504 + DICE_HOLD_MS - 1)).toEqual([2, 6]);
    expect(DICE_HOLD_MS).toBe(500);
  });

  it('★ 500 ms 定格走完就自动收摊，走子才能开始', () => {
    const fx = new DiceRollFx();
    fx.begin(0, 9, TICK, 1);
    fx.roll(0, [5], fakeFlic(36, 14));
    expect(fx.phase).toBe('tumble');
    expect(fx.active).toBe(true);
    expect(fx.pips(504)).toEqual([5]);
    expect(fx.phase).toBe('hold');
    expect(fx.done(504 + DICE_HOLD_MS)).toBe(true);
    expect(fx.active).toBe(false);
    expect(fx.pips(504 + DICE_HOLD_MS)).toBeNull();
  });

  it('★ 整段期间角色都摆「手持骰子」那一组（原版切成走子是在 500 ms 之后）', () => {
    const fx = new DiceRollFx();
    expect(fx.characterPose).toBeNull();
    fx.begin(0, 9, TICK, 1);
    expect(fx.characterPose).toBe('dice');
    fx.roll(0, [1], fakeFlic(36, 14));
    expect(fx.characterPose).toBe('dice');
    fx.pips(504);
    expect(fx.characterPose).toBe('dice');
    fx.done(504 + DICE_HOLD_MS);
    expect(fx.characterPose).toBeNull();
  });

  it('影片还没到货时不炸，也不画影片', () => {
    const fx = new DiceRollFx();
    fx.begin(0, 9, TICK, 1);
    fx.roll(0, [1], null);
    expect(fx.flicFrame(100)).toBeNull();
    expect(fx.flicBitmap(100)).toBeNull();
    expect(fx.tumbleMs()).toBe(0);
  });

  it('收摊后一切归零', () => {
    const fx = new DiceRollFx();
    fx.begin(0, 9, TICK, 1);
    fx.roll(0, [1], fakeFlic(36, 14));
    fx.cancel();
    expect(fx.active).toBe(false);
    expect(fx.pips(1000)).toBeNull();
    expect(fx.flicFrame(1000)).toBeNull();
  });
});

describe('★ 相位推进不依赖绘制（2026-09-16 长跑抓到的硬卡死）', () => {
  it('★★ tick() 必须**在结束那一拍**就报「播完了」（掷完骰子人不走的真根因）', () => {
    // 病根：`dicePoll` 在函数中部调 `tick()`，那一拍 `hold → idle`；
    // 而重排写在函数尾 `if (active) setTimeout(dicePoll, 16)` —— 结束时 active
    // 已是 false，于是**最后一次补驱动被吞掉**，`scheduleHumanTurn`/`scheduleAi`
    // 又以 `active` 为闸 ⇒ 真人永久停在 `moving`、棋子一步不走。
    // 修法：`tick()` 显式回传「这一拍刚播完」，调用方据此补驱动。
    const fx = new DiceRollFx();
    const t0 = 3_000_000;
    fx.begin(t0, 4, 24, 1);
    fx.markRollRequested();
    // ★ 必须给 FLIC：`tumbleMs()` = 帧数 × 每帧毫秒（36 × 14 = 504）
    const tRoll = t0 + 4 * 24 + 1;
    fx.roll(tRoll, [3], fakeFlic(36, 14));
    expect(fx.tick(tRoll), '进滚骰那一拍不算结束').toBe(false);
    expect(fx.tick(tRoll + 1), '滚骰中不算结束').toBe(false);
    // 滚骰 504 ms 那一拍进定格（那时还不算结束），定格再走满 500 ms 才算
    expect(fx.tick(tRoll + 504), '刚进定格不算结束').toBe(false);
    expect(fx.tick(tRoll + 504 + DICE_HOLD_MS - 1), '定格差 1 ms 不算结束').toBe(false);
    // ★ 跨过定格边界的那一拍：必须报 true，且**只报这一次**
    expect(fx.tick(tRoll + 504 + DICE_HOLD_MS), '跨过定格边界必须报结束').toBe(true);
    expect(fx.active).toBe(false);
    expect(fx.tick(tRoll + 504 + DICE_HOLD_MS + 16), '结束只报一次，不重复').toBe(false);
  });

  it('★ 只调 tick()、一次都不画，也必须从 tumble 走到 idle', () => {
    const fx = new DiceRollFx();
    const t0 = 1_000_000;
    fx.begin(t0, 4, 24, 1);
    fx.roll(t0, [3], null);
    // 预动作走完 → 进入滚骰
    fx.markRollRequested();
    const tRoll = t0 + 4 * 24 + 1;
    fx.tick(tRoll);
    // 之后一路只 tick（模拟「整屏接管、棋盘不画」的那段时间）
    let now = tRoll;
    for (let i = 0; i < 500 && fx.active; i++) {
      now += 16;
      fx.tick(now);
    }
    expect(fx.active, '光靠 tick() 就该走完，不能等绘制').toBe(false);
  });

  it('★ 不调 tick() 时（老行为）相位确实卡住 —— 说明这条闸曾经多脆', () => {
    const fx = new DiceRollFx();
    const t0 = 2_000_000;
    fx.begin(t0, 4, 24, 1);
    fx.roll(t0, [3], null);
    fx.markRollRequested();
    // 只推进时间、不调 tick 也不画
    expect(fx.active).toBe(true);
  });

  it('★ main.ts 的 dicePoll 必须真的调它（结构断言，防止又被挪回绘制里）', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    // ★ 必须是 `const ended = diceFx.tick(now);` —— 结束那一拍的补驱动全靠这个返回值
    expect(src).toContain('const ended = diceFx.tick(now);');
    expect(src).toContain('if (ended) {');
  });

  it('★★ diceFx 收摊后必须补一次回合驱动，且**两条收尾路都要补**（结构断言）', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    // 补驱动抽成一个函数：`scheduleAi` 与 `scheduleHumanTurn` **两个都要**，
    // 少一个就会有一类座位永久停在 awaitingRoll/moving（真人卡死、电脑卡死各一处）。
    const at = src.indexOf('function resumeTurnDriver(): void {');
    expect(at, 'dicePoll 的补驱动必须抽成 resumeTurnDriver').toBeGreaterThan(0);
    const body = src.slice(at, src.indexOf('\n}', at));
    expect(body, '补驱动必须叫 scheduleAi').toContain('scheduleAi();');
    expect(body, '补驱动必须叫 scheduleHumanTurn').toContain('scheduleHumanTurn();');
    // 三条收尾路：① 入口进来时已 idle ② 这一拍刚播完 ③ 联机超时 cancel
    expect(src.split('resumeTurnDriver();').length - 1).toBeGreaterThanOrEqual(3);
    const dicePollAt = src.indexOf('function dicePoll(): void {');
    const dicePollBody = src.slice(dicePollAt, src.indexOf('\nfunction resumeTurnDriver', dicePollAt));
    expect(dicePollBody.split('resumeTurnDriver();').length - 1, 'dicePoll 内三条分支都要补').toBe(3);
  });

  it('★ 被拒的掷骰必须重排驱动，不许静默丢弃（结构断言）', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    // requestRoll 返回布尔：拿不到就说清楚
    expect(src).toContain('function requestRoll(): boolean');
    expect(src).toContain('if (diceFx.active) return false;');
    // 三条调用路（AI / 键盘 / GO 钮）都要能重排
    expect(src).toContain('if (!requestRoll()) scheduleAi();');
    expect(src.split('if (!requestRoll()) scheduleHumanTurn();').length - 1).toBe(3);
    // 自己起动画那条岔路也要挂上 dicePoll（否则没人推进相位）
    const beginAt = src.indexOf('diceFx.begin(performance.now(), diceAnticipateTicks(me)');
    const afterBegin = src.slice(beginAt, beginAt + 400);
    expect(afterBegin, 'applyAction 里自己起的动画也得挂 dicePoll').toContain('setTimeout(dicePoll, 16)');
  });
});

/*
 * 联机预测 —— 第九份试玩回报「多人模式下玩家扔骰子有个很明显的延迟卡顿」（2026-09-22）
 *
 * 死锁形状（改动前）：`pumpNetInbox` 的 `diceFxActive` 闸只能由 `applyAction(rollDice)`
 * → `diceFx.roll()` 清掉，而 `applyAction` 正被这道闸挡着 ⇒ 每掷空转到 3 秒超时。
 * 现在：dispatch 那一刻就 `predictRoll()` 开滚（滚骰画面**不含点数**，所以不必猜点数），
 * 回包只负责把权威点数补上。
 */
describe('DiceRollFx.predictRoll —— 联机预测（先滚起来，点数后补）', () => {
  it('★ 预动作期间可以预测开滚，且**不预设任何点数**', () => {
    const fx = new DiceRollFx();
    fx.begin(1000, 9, TICK, 2);
    expect(fx.predictRoll(1000, fakeFlic(36, 14))).toBe(true);
    expect(fx.phase).toBe('tumble');
    // 点数还没到 —— 这正是「不必猜点数」的证据
    expect(fx.dice).toEqual([]);
    expect(fx.diceCount, '颗数不该被预测改掉').toBe(2);
    // 滚骰段照旧按 FLIC 自己的帧数 × 每帧毫秒走
    expect(fx.tumbleMs()).toBe(36 * 14);
  });

  it('★ 没解好的影片不预测（否则 tumbleMs() = 0，相位会当场滑过去）', () => {
    const fx = new DiceRollFx();
    fx.begin(1000, 9, TICK, 1);
    expect(fx.predictRoll(1000, null)).toBe(false);
    expect(fx.phase, '留在预动作，退回老路').toBe('anticipate');
  });

  it('不在预动作时预测是空操作（别把别人的动画顶掉）', () => {
    const fx = new DiceRollFx();
    expect(fx.predictRoll(1000, fakeFlic(36, 14))).toBe(false);
    expect(fx.phase).toBe('idle');
  });

  it('★★ 权威点数到达时**接着滚**，不重启相位、不重算起始时刻', () => {
    const fx = new DiceRollFx();
    fx.begin(1000, 9, TICK, 1);
    fx.predictRoll(2000, fakeFlic(36, 14));
    // 预测起播后 200 ms（= 14 帧）—— 回包到了
    fx.roll(2200, [5, 3], fakeFlic(36, 14));
    expect(fx.phase).toBe('tumble');
    // ★ 起始时刻仍是 2000：帧号从 **200 ms** 算起（第 14 帧），不是从 2200 重头
    expect(fx.flicFrame(2200)).toBe(14);
    expect(fx.dice).toEqual([5, 3]);
    expect(fx.diceCount).toBe(2);
  });

  it('★ 回包迟到（已进定格）也只在原地补点数，不回头再滚一遍', () => {
    const fx = new DiceRollFx();
    fx.begin(1000, 9, TICK, 1);
    fx.predictRoll(2000, fakeFlic(36, 14));
    // 滚骰 504 ms 走完 → hold；此刻点数还没到（空数组 = 一张点数图都不画）
    expect(fx.pips(2600)).toEqual([]);
    fx.roll(2600, [6], fakeFlic(36, 14));
    expect(fx.phase).toBe('hold');
    expect(fx.pips(2600)).toEqual([6]);
    // 定格没被重置：2000 + 504 = 2504 起算，500 ms 后收摊
    expect(fx.done(3004)).toBe(true);
  });

  it('单机那条路一个字没变：roll() 从预动作正常起步', () => {
    const fx = new DiceRollFx();
    fx.begin(1000, 9, TICK, 1);
    fx.roll(1720, [4], fakeFlic(36, 14));
    expect(fx.phase).toBe('tumble');
    expect(fx.flicFrame(1720)).toBe(0);
    expect(fx.pips(1720 + 36 * 14)).toEqual([4]);
  });
});

/*
 * 死锁那一处（`pumpNetInbox`）的接线钉子 —— 这段在 websocket 回调/定时器里，
 * 仓里没有 `pumpNetInbox` 的单测，故用原始码钉（与 `feedback-button.test.ts` 同法）。
 */
describe('pumpNetInbox —— 放行自己在等的那条 rollDice', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const pump = src.slice(src.indexOf('function pumpNetInbox('), src.indexOf('function startNetTick('));

  it('本机发出的 rollDice 会置位「在等回包」，并带一条兜底撤位', () => {
    expect(src).toContain('let awaitingOwnRoll = false;');
    const dispatchAt = src.indexOf('function dispatch(action: Action): void {');
    const dispatchBody = src.slice(dispatchAt, dispatchAt + 1200);
    expect(dispatchBody).toContain("if (action.type === 'rollDice') {");
    expect(dispatchBody).toContain('awaitingOwnRoll = true;');
    // ★ 这一位会让队首的 rollDice 绕过整个节拍闸 ⇒ 必须有兜底，不能一直挂着
    expect(dispatchBody).toContain('awaitingOwnRoll = false;');
    expect(dispatchBody).toContain('ROLL_WAIT_TIMEOUT_MS');
  });

  it('★★ 队首是自己等的那条 rollDice ⇒ 不走 diceFxActive 那道闸', () => {
    expect(pump).toContain('const ownRollEcho = awaitingOwnRoll && head !== undefined && head.action.type === \'rollDice\';');
    expect(pump).toContain('if (!ownRollEcho && holdForActorWalk(');
  });

  it('回包落地 / 3 秒超时 / 服务器拒绝 三条路都要清掉这一位', () => {
    const applyNetAt = src.indexOf('function applyNetAction(');
    const applyNetBody = src.slice(applyNetAt, src.indexOf('function pumpNetInbox('));
    expect(applyNetBody).toContain("if (item.action.type === 'rollDice') awaitingOwnRoll = false;");

    const dicePollAt = src.indexOf('function dicePoll(): void {');
    const dicePollBody = src.slice(dicePollAt, src.indexOf('\nfunction resumeTurnDriver', dicePollAt));
    expect(dicePollBody, '超时那条要清').toContain('awaitingOwnRoll = false;');

    const errAt = src.indexOf('onError: (message) => {');
    const errBody = src.slice(errAt, errAt + 500);
    expect(errBody, '被拒那条要清 + 收掉预测动画').toContain('awaitingOwnRoll = false;');
    expect(errBody).toContain('diceFx.cancel();');
  });

  it('★ dispatch 那一刻就预测开滚（别白等一个 RTT）', () => {
    const dicePollAt = src.indexOf('function dicePoll(): void {');
    const dicePollBody = src.slice(dicePollAt, src.indexOf('\nfunction resumeTurnDriver', dicePollAt));
    expect(dicePollBody).toContain('diceFx.predictRoll(performance.now(), diceFlic.get(diceFx.diceCount) ?? null)');
    // 预测起播时音效也要跟着响，且 applyAction 不能放第二遍
    expect(dicePollBody).toContain('playDiceSound();');
    const applyAt = src.indexOf('function applyAction(action: Action): void {');
    const applyBody = src.slice(applyAt, applyAt + 3000);
    expect(applyBody).toContain("const predicted = diceFx.phase === 'tumble' || diceFx.phase === 'hold';");
    expect(applyBody).toContain('if (!predicted) playDiceSound();');
  });
});

describe('★★ 掷骰姿停在哪一帧（第十四份试玩回报 #3「扔完骰子后应该是手上没骰子的模型」）', () => {
  // 那一组图每向 N 帧：前几帧捧着骰子、最后一帧骰子已出手（宮本寶藏 Data.mkf #256：0..5 捧骰、8 空手）。
  // @source 0x0040dee4 帧号清 0；0x0040d975 数到 N 那一 tick 不重画、直接掷；
  //   fcn_00419572（滚骰 + 500 ms 定格）不调 0x40829d ⇒ 屏幕停在第 N−1 帧。
  it('★ 预动作从第 0 帧起、一 tick 一帧', () => {
    const fx = new DiceRollFx();
    expect(fx.poseFrame(0)).toBeNull();
    fx.begin(1000, 9, TICK, 1);
    expect(fx.poseFrame(1000)).toBe(0);
    expect(fx.poseFrame(1000 + TICK)).toBe(1);
    expect(fx.poseFrame(1000 + 8 * TICK + 79)).toBe(8);
  });

  it('★★ 滚骰 + 定格整段**定在最后一帧**（N−1 = 空手），不跟任何计数器转', () => {
    const fx = new DiceRollFx();
    fx.begin(0, 9, TICK, 1);
    fx.roll(9 * TICK, [4], fakeFlic(36, 14));
    for (const t of [9 * TICK, 9 * TICK + 100, 9 * TICK + 504, 9 * TICK + 504 + 499]) {
      expect(fx.poseFrame(t), `t=${t}`).toBe(8);
    }
    // 定格走完 → 不再盖姿态（原版 0x0040da37 切成走子）
    expect(fx.poseFrame(9 * TICK + 504 + DICE_HOLD_MS)).toBeNull();
  });

  it('★ 每向帧数不是 9 的载具也一样（N−1 随 begin 给的帧数走）', () => {
    const fx = new DiceRollFx();
    fx.begin(0, 4, TICK, 2);
    fx.roll(0, [1, 2], fakeFlic(36, 14));
    expect(fx.poseFrame(10)).toBe(3);
  });

  it('★ 接线：主循环把帧号交给渲染器，渲染器按它取图而不是全局走路帧', () => {
    const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(main).toContain('characterPoseFrame: diceFx.poseFrame(performance.now()),');
    const render = readFileSync(new URL('./render.ts', import.meta.url), 'utf8');
    expect(render).toContain('input.characterPose ?? null, input.characterPoseFrame ?? null');
    expect(render).toContain('directionalImage(count, dir, frameNow)');
    expect(render).toContain('const frameNow = fixedFrame ?? this.#walkFrame;');
  });
});
