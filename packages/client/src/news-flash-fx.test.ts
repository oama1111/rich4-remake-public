/*
 * 新聞 18「強烈地震」/ 19「山洪」：受灾地块白闪 → 重画 → 静置（gap-audit #6，第二十二份）
 * ★ A-2：命運 0「強制拆除房屋」/ 1「強制徵收土地」走**同一条**尾巴（`0x0044c0e3 jmp 0x44bf46`
 *   → `0x0044bf46 call 0x451985`）⇒ 同一个触发器家族、同一条时间轴。
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉三件事（VA 全在 `news-flash-fx.ts` 文件头）：
 *   ① 什么时候演：`lastEvent` 刚换成带 `flashLots` 的 18 / 19（或命運 0 / 1 里那两块地表的差）；
 *      实体编码拆成地块 / 設施两张；
 *   ② 时间轴：闪 16 × 30 + 400 ms（`fcn_00451985`）→ 静置 500 ms（18 `0x0044a906`）/
 *      300 ms（19 `0x0044aaca`、命運 `0x0044bf59`）；
 *   ③ `main.ts` 的接线（单机与联机都走 `applyAction` → `startActionFx`，同一条出口）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  FORTUNE_FLASH_HOLD_MS,
  NEWS_FLASH_HOLD_MS,
  fortuneFlashTrigger,
  newsFlashLevel,
  newsFlashPhase,
  newsFlashTrigger,
} from './news-flash-fx.ts';
import { TOLL_FLASH_TOTAL_MS } from './toll-flash-fx.ts';

type Ev = { kind: string; id: number; flashLots?: readonly number[] } | null;
const st = (lastEvent: Ev) => ({ lastEvent });

describe('★ `newsFlashTrigger`', () => {
  it('★★ 18：同名的几块地 + 挑中設施时的那一处，按实体编码拆开（`0x7d0 + id` / `0xfa0 + id`）', () => {
    const ev = { kind: 'news', id: 18, flashLots: [0x7d0 + 1, 0x7d0 + 3, 0x7d0 + 4] };
    expect(newsFlashTrigger(st(null), st(ev))).toEqual({ eventId: 18, kind: 'news', lands: [1, 3, 4], facilities: [], holdMs: 0x1f4 });
    const evf = { kind: 'news', id: 18, flashLots: [0xfa0 + 2] };
    expect(newsFlashTrigger(st(null), st(evf))).toEqual({ eventId: 18, kind: 'news', lands: [], facilities: [2], holdMs: 500 });
  });

  it('★ 19：挑中那一处，静置 300 ms', () => {
    const ev = { kind: 'news', id: 19, flashLots: [0x7d0 + 7] };
    expect(newsFlashTrigger(st(null), st(ev))).toEqual({ eventId: 19, kind: 'news', lands: [7], facilities: [], holdMs: 0x12c });
  });

  it('★ 同一个 `lastEvent`（引用不变）不再演；别的新聞 / 命運 / 没带 `flashLots` 都不演', () => {
    const ev = { kind: 'news', id: 18, flashLots: [0x7d0 + 1] };
    expect(newsFlashTrigger(st(ev), st(ev))).toBeNull();
    expect(newsFlashTrigger(st(null), st({ kind: 'news', id: 21, flashLots: [0x7d0 + 1] }))).toBeNull();
    expect(newsFlashTrigger(st(null), st({ kind: 'fortune', id: 18, flashLots: [0x7d0 + 1] }))).toBeNull();
    expect(newsFlashTrigger(st(null), st({ kind: 'news', id: 18 }))).toBeNull();
    expect(newsFlashTrigger(st(null), st({ kind: 'news', id: 18, flashLots: [] }))).toBeNull();
    expect(newsFlashTrigger(st(null), st(null))).toBeNull();
  });

  it('★ 表只收 18 / 19（@source 18 `push 0x1f4`、19 `push 0x12c`）', () => {
    expect([...NEWS_FLASH_HOLD_MS.entries()]).toEqual([
      [18, 500],
      [19, 300],
    ]);
  });
});

// ============================================================
//  ★ A-2：命運 0 / 1 —— 同一支 `fcn_00451985`（共用尾巴 `0x0044bf46`）
// ============================================================

type FSt = {
  lastEvent: { kind: string; id: number } | null;
  landOwner?: readonly number[];
  landLevel?: readonly number[];
};
const fs = (lastEvent: FSt['lastEvent'], landOwner: readonly number[], landLevel: readonly number[] = []): FSt => ({
  lastEvent,
  landOwner,
  landLevel,
});

describe('★★ `fortuneFlashTrigger`（命運 0 拆屋 / 1 徵收）', () => {
  it('★★ 1 徵收：`landOwner[i]` 由非 0 变 0 的那一块（`0x0044c0ce mov byte [ebx+0x19],0`），静置 300', () => {
    const before = fs(null, [0, 1, 0, 2], [0, 0, 0, 0]);
    const after = fs({ kind: 'fortune', id: 1 }, [0, 0, 0, 2], [0, 0, 0, 0]);
    expect(fortuneFlashTrigger(before, after)).toEqual({
      eventId: 1,
      kind: 'fortune',
      lands: [1],
      facilities: [],
      holdMs: 0x12c,
    });
    expect(FORTUNE_FLASH_HOLD_MS).toBe(300);
  });

  it('★★ 0 拆屋：`landLevel[i]` 由非 0 变 0 的那一块（`0x0044bf3e mov byte [ebx+0x1a],0`），owner 不动 ⇒ 不看 owner', () => {
    const before = fs(null, [0, 1, 0], [0, 3, 2]);
    const after = fs({ kind: 'fortune', id: 0 }, [0, 1, 0], [0, 0, 2]);
    expect(fortuneFlashTrigger(before, after)).toEqual({
      eventId: 0,
      kind: 'fortune',
      lands: [1],
      facilities: [],
      holdMs: 300,
    });
  });

  it('★ 判据都是「这一条 action 写的」：引用没换 / 号码不在 0·1 / 什么都没有变 ⇒ 不演', () => {
    const ev = { kind: 'fortune', id: 1 };
    const same = fs(ev, [0, 1]);
    expect(fortuneFlashTrigger(same, fs(ev, [0, 0]))).toBeNull();
    // 2 冒貸等其余命運没有 `0x451985`（只有 0/1 汇进 `0x44bf46`）
    for (const id of [2, 4, 5, 8, 12, 33]) {
      expect(fortuneFlashTrigger(fs(null, [0, 1]), fs({ kind: 'fortune', id }, [0, 0])), `命運 ${id}`).toBeNull();
    }
    // 这一条没动任何一块地（例：事件 1 的受害者一块未开发地都没有 ⇒ 原版根本不会抽到它）
    expect(fortuneFlashTrigger(fs(null, [0, 1]), fs({ kind: 'fortune', id: 1 }, [0, 1]))).toBeNull();
    // 别的事件（新聞 / 小遊戲）
    expect(fortuneFlashTrigger(fs(null, [0, 1]), fs({ kind: 'news', id: 1 }, [0, 0]))).toBeNull();
    expect(fortuneFlashTrigger(fs(null, [0, 1]), fs(null, [0, 0]))).toBeNull();
  });

  it('★ 两条事件各看**自己**改的那个字段：0 只看等级、1 只看归属（交叉喂不认）', () => {
    // 事件 0 不动 owner ⇒ 只改 owner 的那一条不该被事件 0 认领
    expect(fortuneFlashTrigger(fs(null, [0, 1], [0, 3]), fs({ kind: 'fortune', id: 0 }, [0, 0], [0, 3]))).toBeNull();
    // 事件 1 不动 level ⇒ 只改 level 的那一条不该被事件 1 认领
    expect(fortuneFlashTrigger(fs(null, [0, 1], [0, 3]), fs({ kind: 'fortune', id: 1 }, [0, 1], [0, 0]))).toBeNull();
  });
});

describe('★ 时间轴：闪 880 ms（与過路費同一支 `fcn_00451985`）→ 静置 → 收场', () => {
  it('★★ 18：0..879 闪、880..1379 静置、1380 收', () => {
    expect(TOLL_FLASH_TOTAL_MS).toBe(880);
    expect(newsFlashPhase(0, 500)).toBe('flash');
    expect(newsFlashPhase(879, 500)).toBe('flash');
    expect(newsFlashPhase(880, 500)).toBe('hold');
    expect(newsFlashPhase(1379, 500)).toBe('hold');
    expect(newsFlashPhase(1380, 500)).toBe('done');
  });

  it('★ 19：880..1179 静置', () => {
    expect(newsFlashPhase(1179, 300)).toBe('hold');
    expect(newsFlashPhase(1180, 300)).toBe('done');
  });

  it('★ 亮度逐帧沿用表 `0x476380`（第 3 帧 = 16 = 半程），那 400 ms 静止与闪完都不叠', () => {
    expect(newsFlashLevel(0)).toBe(4);
    expect(newsFlashLevel(3 * 30)).toBe(16);
    expect(newsFlashLevel(7 * 30)).toBeNull();
    expect(newsFlashLevel(11 * 30)).toBe(-16);
    expect(newsFlashLevel(600)).toBeNull();
    expect(newsFlashLevel(900)).toBeNull();
  });
});

describe('★ `main.ts` 接线（源码钉子）', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const body = (name: string): string => {
    const at = src.indexOf(`function ${name}(`);
    expect(at).toBeGreaterThan(0);
    return src.slice(at, src.indexOf('\n}\n', at));
  };

  it('★★ 起：`startActionFx`（单机 / 电脑 / 联机广播三条来源都经过它）里紧跟 `startNewsPlaceFx`', () => {
    const fx = body('startActionFx');
    expect(fx).toContain('startNewsFlash(before, state);');
    expect(fx.indexOf('startNewsPlaceFx(before, state);')).toBeLessThan(fx.indexOf('startNewsFlash(before, state);'));
    // 事件框那 2400 ms 与闪的那 880 ms 棋盘仍按 before 画
    expect(body('startNewsFlash')).toContain('deferredBoardBefore = before;');
    // ★ A-2：同一个槽也认命運 0 / 1（两支共用 `0x451985`）
    expect(body('startNewsFlash')).toContain('newsFlashTrigger(before, after) ?? fortuneFlashTrigger(before, after)');
  });

  it('★★ 推：只等事件框那一屏（不等「任何一屏」—— 会与排在后面的訊息框互等）；闪完放开 before、静置完才放回合驱动', () => {
    const t = body('tickNewsFlash');
    expect(t).toContain('eventBoxScreen.active(uiEnv())');
    expect(t).not.toContain('activeUiScreen()');
    expect(t.indexOf('deferredBoardBefore = null')).toBeLessThan(t.indexOf("phase === 'hold'"));
    expect(t).toContain('resumeTurnDriver();');
    expect(src).toContain("if (screen === 'game') tickNewsFlash(performance.now());");
  });

  it('★★ 台上忙：排着 / 闪 / 静置整段都算（回合驱动、联机收件箱、19 的房主台词都等它）', () => {
    expect(body('stageBusyFlags')).toContain('tollFlash: tollFlash !== null || newsFlash !== null,');
    expect(body('boardFilmWindowFlags')).toContain('newsFlash: newsFlash !== null && deferredBoardBefore === newsFlash.before,');
  });

  it('★ 滑鼠鍵：闪那一截走 `skipTollFlash`，静置那一截走 `skipPresentationHold`（一下只跳一截）', () => {
    expect(body('skipPresentationHold')).toContain('f.holdSkipped = true;');
    expect(src).toContain('if (skipPresentationHold(performance.now())) return;');
  });

  it('★ 换局 / 读档 / 失步自愈：三处一起清', () => {
    expect(src.split('newsFlash = null; // 新聞 18 / 19 的白闪同属「这一刻在播」').length - 1).toBe(3);
  });
});
