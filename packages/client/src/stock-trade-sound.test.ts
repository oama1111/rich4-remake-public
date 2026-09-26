/*
 * 第二十一份（`20260924-122205095`「获得经营权好像有个提示音」）顺查出的缺口：股市柜台成交音 40 / 41
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source 買進 `0x0042afa6 push 0x475590 / 0x0042afab call 0x4542ce`（`[0x475590]` = 40）；
 *   賣出 `0x0042b08e push 0x475598 / 0x0042b093 call 0x4542ce`（`[0x475598]` = 41）。
 *   都在填数窗返回非 0 之后、买卖之前（`test eax,eax / je` 跳过 0 股）。
 * 这是本机真人在股市柜台上的操作（单机 / 联机同一段 `amountOk`；联机时 action 另由服务器广播，
 * 声音只在点「確定」的那台响 —— 原版这一屏本来就只在操作者面前）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STOCK_COUNTER_SOUND, stockCounterTradeSound } from './amount-form.ts';

describe('股市柜台成交音', () => {
  it('買進 40、賣出 41；0 股不响；不是股市柜台那扇窗不响', () => {
    expect(STOCK_COUNTER_SOUND).toEqual({ buy: 40, sell: 41 });
    expect(stockCounterTradeSound({ kind: 'buy', stock: 0, max: 10 }, 5)).toBe(40);
    expect(stockCounterTradeSound({ kind: 'sell', stock: 3, max: 10 }, 1)).toBe(41);
    expect(stockCounterTradeSound({ kind: 'buy', stock: 0, max: 10 }, 0)).toBeNull();
    expect(stockCounterTradeSound(null, 5)).toBeNull();
  });

  it('`main.ts` 的 `amountOk` 在派 action **之前**放这一声（源码钉）', () => {
    const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    const at = main.indexOf("case 'amountOk': {");
    const body = main.slice(at, main.indexOf('\n    }\n', at));
    const sfx = body.indexOf('stockCounterTradeSound(stockAmount, n)');
    const play = body.indexOf("sound.play('Effect.mkf', tradeSfx)");
    const disp = body.indexOf('dispatch(amount.fill(n))');
    expect(sfx).toBeGreaterThan(0);
    expect(play).toBeGreaterThan(sfx);
    expect(disp).toBeGreaterThan(play);
  });
});
