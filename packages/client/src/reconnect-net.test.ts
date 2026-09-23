/*
 * 联机中途进房（刷新 / 断线重连）与旁观魔法屋的接线钉子（第十二份試玩回報）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方回报（Charles，2026-09-23，联机 2 真人 + 2 电脑）：
 *   - `20260923-014329884`「断线重连后莫名其妙又进入魔法屋」
 *   - `20260923-014349833`「断线重连后所有文本提示又重新触发了一轮」
 *   - `20260923-013618309`「2个真人玩家时，触发魔法屋的玩家结束魔法屋回合，另一个真人玩家还在魔法屋里不会自动出去」
 *
 * 前两条的根因：刷新后服务器从 0 号补发整局，客户端把补发与实时广播走同一条
 * `onAction → pumpNetInbox → applyAction → notifyApplied → 各整屏 event()` 路，
 * 整局的訊息框 / 魔法屋 / 台词按节拍重演一遍（回报日志里第 25 回合那次魔法屋又出现了）。
 * 现在：服务器在 `start` 里带 `through`，`NetClient` 把补发攒齐交给 `onCatchUp`（行为由
 * `net-client.test.ts` / `hub.test.ts` 守着），宿主**静默**追上 —— 这里钉宿主那一半。
 *
 * ⚠️ 为什么用源码钉：这几段活在 `main.ts` 的 websocket 回调里，要真跑得整条
 *   `connectOnline` + 一个服务器。仓库对这类接线的既定做法就是源码钉
 *   （见 `intro-net.test.ts` / `feedback-button.test.ts`）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

const slice = (from: string, to: string): string => {
  const a = main.indexOf(from);
  const b = main.indexOf(to, a + from.length);
  return a < 0 || b < 0 ? '' : main.slice(a, b);
};

const catchUp = slice('function catchUpSilently(', 'function settleAfterSilentRebuild(');
const settle = slice('function settleAfterSilentRebuild(', 'function clearNetInbox(');
const onStart = slice('onStart: (start) => {', '// ★★ 第七份试玩回报第 1 条');
const onResync = slice('onResync: (r) => {', 'fingerprint: () => stateFingerprint(state),');
const pump = slice('function pumpNetInbox(', 'function startNetTick(');
const dispatchFn = slice('function dispatch(action: Action): void {', 'const recorder = new FlightRecorder();');
const awaitingFn = slice('function tickAwaiting(): void {', 'function noteAlive(): void {');

describe('第十二份試玩回報：中途进房静默追上', () => {
  it('切片都取到了（两端的锚点都还在）', () => {
    for (const [name, s] of Object.entries({ catchUp, settle, onStart, onResync, pump, dispatchFn, awaitingFn })) {
      expect(s.length, name).toBeGreaterThan(100);
    }
  });

  it('★ 补发交给 `catchUpSilently`（不进会起演出的收件箱）', () => {
    expect(main).toContain('onCatchUp: (items) => catchUpSilently(items),');
  });

  it('★★ 静默：只 reduce —— 不走 applyAction / notifyApplied / 各整屏 event / 收件箱节拍 / 台词', () => {
    expect(catchUp).toContain('reduce(state, item.action, topo)');
    for (const banned of ['applyAction(', 'applyNetAction(', 'notifyApplied(', '.event?.(', 'pumpNetInbox(', 'speechQueue.push(', 'startActionFx(']) {
      expect(catchUp, `catchUpSilently 不该调 ${banned}`).not.toContain(banned);
    }
  });

  it('★ 断线前已收下、还没播的那几条排在补发之前，一并静默施加（保持顺序）', () => {
    expect(catchUp).toContain('const queued = netInbox.splice(0);');
    expect(catchUp).toContain('[...queued, ...items]');
    expect(catchUp.indexOf('netInbox.splice(0)')).toBeLessThan(catchUp.indexOf('reduce(state, item.action, topo)'));
  });

  it('失步重放与中途追上共用同一段收尾；收尾照常铺起此刻仍挂着的场所（带人机闸）', () => {
    expect(catchUp).toContain('settleAfterSilentRebuild();');
    expect(onResync).toContain('settleAfterSilentRebuild();');
    expect(settle).toContain('if (!aiVenuePending(state)) {');
    for (const line of ['syncShopUi();', 'syncLoanUi();', 'syncAtmPending();', 'scheduleAi();', 'scheduleHumanTurn();']) {
      expect(settle, line).toContain(line);
    }
  });

  it('★ 開局宣言只在真的开局时说（中途进房不再说一遍）', () => {
    expect(onStart).toContain(
      'if (roomJoinedUnstarted && speechQueue.push(openingSpeech(state), performance.now()) > 0) requestRender();',
    );
  });

  it('★ 追赶期间不拿旧局面做决定：不发意图、不报 awaiting', () => {
    expect(dispatchFn).toContain('if (net.catchingUp) return;');
    expect(main).toContain('if (net.catchingUp) return; // 同 `dispatch`：本地状态还没追上');
    expect(awaitingFn).toContain('if (client.catchingUp) return;');
  });
});

describe('第十二份試玩回報：旁观别人的魔法屋，施法者收场本台跟着收场', () => {
  // 魔法屋的点选如今是一条 action（`{type:'magicHouse', option}`，见 core `magic-choice.test.ts`），
  // 旁观端收到它就按同一条结算收场；前提是女巫窗口停在状态 7 等人点时**不挡收件箱**。
  it('★ 状态 7（等真人点一格）不算演出 ⇒ 别家点定的那条 action 进得来', () => {
    expect(main).toContain(
      "if (overlay !== null && overlay.id === 'magic' && magicAwaitingPick()) return false;",
    );
  });
});
