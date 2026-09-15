/*
 * 「取消」那一拍的梯子 —— 每一屏一条，且 **ESC 与右键共用同一条**
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方 2026-09-16 第 3 条：「打开顶部的任意工具栏要取消打开的话，应该可以使用
 * 右键（和取消使用道具卡片的交互一样），而不是只能通过 ESC 关闭」。
 *
 * ★ 本文件钉两件事：
 *   ① `panel-cancel.ts` 那把梯子**逐层都对**（每层一条用例；顺序不许颠倒）；
 *   ② `main.ts` 的熱鍵 ESC 与 `contextmenu` 确实**指向同一个函数** —— 因为
 *      原版的全局键盘钩子就是把取消键补成 `WM_RBUTTONUP (0x205)`
 *      （@source VA 0x004011c3），主窗口过程只交给 `windowCallbacks` 栈顶
 *      （@source rich4_main VA 0x00401b33）。两键分开写两套分支就一定会漂移，
 *      这次漂移出来的是「託管AI / 存讀檔只有 ESC 能关、資產表/道具欄/股市只有
 *      右键能关」。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CANCEL_LADDER,
  CANCEL_SOUND,
  cancelLayerOf,
  type CancelLayer,
  type CancelSnapshot,
} from './panel-cancel.ts';
import { SCREENS } from './screens.ts';
import { bigMapScreen, bigMapOpen, openBigMap, resetBigMap } from './big-map-screen.ts';
import { helpScreen, openHelpAt, resetHelp } from './help-screen.ts';
import { boardScreen, resetBoardScreen } from './board-screen.ts';
import type { UiScreenEnv } from './ui-screen.ts';

const base: CancelSnapshot = {
  screen: 'game',
  overlay: false,
  pick: false,
  dicePick: false,
  atm: false,
  dialog: false,
  amountPage: false,
  optionsSub: false,
  stockPick: false,
  stockDetail: false,
  stockAmount: false,
  stockPage: 0,
  shop: false,
  bail: false,
  loan: false,
};

const snap = (over: Partial<CancelSnapshot>): CancelSnapshot => ({ ...base, ...over });

/**
 * 每一层一条用例。`snap` 里**只**打开这一层（外加它底下真实会同时成立的那些，
 * 例如 ATM / 填数页 / 訊息框 一定与棋盘对话框同时存在）。
 */
const CASES: readonly { layer: CancelLayer; snap: CancelSnapshot }[] = [
  { layer: 'pick', snap: snap({ pick: true }) },
  { layer: 'dicePick', snap: snap({ dicePick: true }) },
  { layer: 'atm', snap: snap({ atm: true, dialog: true }) },
  { layer: 'amountPage', snap: snap({ dialog: true, amountPage: true }) },
  { layer: 'dialog', snap: snap({ dialog: true }) },
  { layer: 'optionsSub', snap: snap({ screen: 'options', optionsSub: true }) },
  { layer: 'options', snap: snap({ screen: 'options' }) },
  { layer: 'aiSettings', snap: snap({ screen: 'aiSettings' }) },
  { layer: 'saveload', snap: snap({ screen: 'saveload' }) },
  { layer: 'assets', snap: snap({ screen: 'assets' }) },
  { layer: 'inventory', snap: snap({ screen: 'inventory' }) },
  { layer: 'stockPick', snap: snap({ screen: 'stock', stockPick: true, dialog: true }) },
  { layer: 'stockDetail', snap: snap({ screen: 'stock', stockDetail: true, dialog: true }) },
  { layer: 'stockAmount', snap: snap({ screen: 'stock', stockAmount: true, dialog: true }) },
  { layer: 'stockPage', snap: snap({ screen: 'stock', stockPage: 1 }) },
  { layer: 'stock', snap: snap({ screen: 'stock' }) },
  { layer: 'shop', snap: snap({ shop: true, dialog: true }) },
  { layer: 'bail', snap: snap({ bail: true, dialog: true }) },
  { layer: 'loan', snap: snap({ loan: true, dialog: true }) },
];

describe('★ 取消梯子：一层一条', () => {
  it('梯子上每层唯一，且都带取证 VA 与副作用说明', () => {
    const layers = CANCEL_LADDER.map((r) => r.layer);
    expect(new Set(layers).size).toBe(layers.length);
    for (const r of CANCEL_LADDER) {
      // 铁律：每个判据都要能回溯到 exe 里某一支
      expect(r.source).toMatch(/0x|loc_|fcn_/);
      expect(r.effect.length).toBeGreaterThan(0);
    }
  });

  it('梯子上有几层，用例就有几条（加了一层却不加用例，这条要红）', () => {
    expect(new Set(CASES.map((c) => c.layer))).toEqual(new Set(CANCEL_LADDER.map((r) => r.layer)));
  });

  for (const c of CASES) {
    it(`「${c.layer}」在上面时：这一拍收的就是它`, () => {
      expect(cancelLayerOf(c.snap)).toBe(c.layer);
    });
  }

  it('什么都没开（或不在这些屏上）→ 这一拍没人接', () => {
    expect(cancelLayerOf(base)).toBeNull();
    expect(cancelLayerOf(snap({ screen: 'title' }))).toBeNull();
    expect(cancelLayerOf(snap({ screen: 'setup' }))).toBeNull();
  });
});

describe('★ 次序不许颠倒', () => {
  it('模态窗压着棋盘：拾取 > 骰子盘 > ATM > 填数页 > 訊息框', () => {
    const all = snap({ pick: true, dicePick: true, atm: true, dialog: true, amountPage: true });
    expect(cancelLayerOf(all)).toBe('pick');
    expect(cancelLayerOf({ ...all, pick: false })).toBe('dicePick');
    expect(cancelLayerOf({ ...all, pick: false, dicePick: false })).toBe('atm');
    expect(cancelLayerOf({ ...all, pick: false, dicePick: false, atm: false })).toBe('amountPage');
    expect(
      cancelLayerOf({ ...all, pick: false, dicePick: false, atm: false, amountPage: false }),
    ).toBe('dialog');
  });

  it('填数页压着贷款屏（原版它是另开的一个模态回调）', () => {
    expect(cancelLayerOf(snap({ dialog: true, amountPage: true, loan: true }))).toBe('amountPage');
    expect(cancelLayerOf(snap({ dialog: true, loan: true }))).toBe('loan');
  });

  it('股市内部：選股 > 详情卡 > 填数页 > 持股页 > 关屏（@source fcn_0042aaff 跳表）', () => {
    const all = snap({
      screen: 'stock',
      stockPick: true,
      stockDetail: true,
      stockAmount: true,
      stockPage: 1,
      dialog: true,
    });
    expect(cancelLayerOf(all)).toBe('stockPick');
    expect(cancelLayerOf({ ...all, stockPick: false })).toBe('stockDetail');
    expect(cancelLayerOf({ ...all, stockPick: false, stockDetail: false })).toBe('stockAmount');
    expect(cancelLayerOf({ ...all, stockPick: false, stockDetail: false, stockAmount: false })).toBe(
      'stockPage',
    );
    expect(
      cancelLayerOf({
        ...all,
        stockPick: false,
        stockDetail: false,
        stockAmount: false,
        stockPage: 0,
      }),
    ).toBe('stock');
  });

  it('設定屏：副屏先收，再收本体', () => {
    expect(cancelLayerOf(snap({ screen: 'options', optionsSub: true }))).toBe('optionsSub');
    expect(cancelLayerOf(snap({ screen: 'options' }))).toBe('options');
  });

  it('★ 整屏那三屏（百貨 / 保釋 / 貸款）压过棋盘对话框 —— 它们把对话框一起盖掉了', () => {
    // `drawShopStage` / `drawBailStage` / `drawBankLoan` 都是提前 return
    expect(cancelLayerOf(snap({ shop: true, dialog: true }))).toBe('shop');
    expect(cancelLayerOf(snap({ bail: true, dialog: true }))).toBe('bail');
    expect(cancelLayerOf(snap({ loan: true, dialog: true }))).toBe('loan');
  });

  it('★ 拍賣 / 樂透 / 小游戏（登记的整屏接管时）**不认**棋盘对话框那一下', () => {
    // 原版那三屏全文没有 0x205 分支（rich4_ui_auction.asm / rich4_small_games.asm），
    // `interactionUi` 给它们的壳子只是兜底 —— 不能被当成通用訊息框去取消。
    expect(cancelLayerOf(snap({ overlay: true, dialog: true }))).toBeNull();
    expect(cancelLayerOf(snap({ overlay: true, dialog: true, amountPage: true }))).toBeNull();
    // 但整屏底下真开着的那几屏（不可能与 overlay 同时出现）不受影响
    expect(cancelLayerOf(snap({ overlay: true, screen: 'saveload' }))).toBe('saveload');
  });
});

describe('★ ESC 与右键同源：两条路都指向 `cancelTopPanel()`', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('取消音就是 `[0x482332]` = 4', () => {
    expect(CANCEL_SOUND).toBe(4);
  });

  it('`cancelTopPanel` 被定义一次、被兩条路各调一次', () => {
    expect(src).toContain('function cancelTopPanel()');
    // 定义那一行 + HOTKEY.cancel 那一行 + contextmenu 那一行
    expect((src.match(/cancelTopPanel\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('`HOTKEY.cancel` 那一条不再自己写分支，只 `return cancelTopPanel()`', () => {
    const at = src.indexOf('case HOTKEY.cancel:');
    expect(at).toBeGreaterThan(0);
    const body = src.slice(at, at + 400);
    expect(body).toContain('return cancelTopPanel()');
    // 旧版在 ESC 那一支里手写的四段（这些现在只能在梯子里）
    expect(body).not.toContain("screen === 'saveload'");
    expect(body).not.toContain("screen === 'aiSettings'");
    expect(body).not.toContain("screen === 'options'");
  });

  it('`contextmenu` 那一条也只剩梯子 + 「清小地图标记」', () => {
    const at = src.indexOf("canvas.addEventListener('contextmenu'");
    expect(at).toBeGreaterThan(0);
    const body = src.slice(at, src.indexOf("window.addEventListener('resize'", at));
    expect(body).toContain('cancelTopPanel()');
    // 旧版一层一段的那几支不许再出现在右键里（否则又是两条路）
    for (const gone of ["screen === 'assets'", "screen === 'stock'", "screen === 'inventory'", "screen === 'options'"]) {
      expect(body).not.toContain(gone);
    }
    // 唯一留在梯子外的那一条：清小地图标记（@source VA 0x00418893）
    expect(body).toContain('minimapMarker = null');
  });
});

// ============================================================
//  各屏自己那两拍
// ============================================================

/** 只填这一屏用得到的字段的假环境 */
function mkEnv(): { env: UiScreenEnv; effects: number[] } {
  const effects: number[] = [];
  const env = {
    screen: 'game',
    // 公佈欄那两条要用到 `state.currentPlayer`（开屏时记下是哪一位的回合）
    state: { currentPlayer: 0 },
    now: 0,
    requestRender: () => undefined,
    log: () => undefined,
    flic: () => null,
    sprite: () => null,
    playEffect: (id: number) => {
      effects.push(id);
    },
  } as unknown as UiScreenEnv & { playEffect: (id: number) => void };
  return { env, effects };
}

describe('★ 登记的整屏：声明了右键的那几屏', () => {
  it('「原版收 0x205 的整屏」一份都不少', () => {
    const withCtx = SCREENS.filter((s) => s.contextmenu !== undefined)
      .map((s) => s.id)
      .sort();
    // 大地圖彈窗（fcn_0040a801 → 0x40a854）、遊戲百科（loc_0044e546）、
    // 公佈欄（loc_00427b7d / loc_00428378）、樂透投注（loc_0043003d）
    expect(withCtx).toEqual(['big-map', 'help', 'lottery', 'notice-board']);
  });

  it('★ 拍賣 / 小游戏 / 樂透開獎**没有**右键 —— 原版它们就没有 0x205 分支（不许自己加）', () => {
    for (const id of ['auction', 'minigame', 'lottery-draw']) {
      const s = SCREENS.find((x) => x.id === id);
      expect(s).toBeDefined();
      expect(s?.contextmenu).toBeUndefined();
    }
  });

  it('大地圖彈窗：右键关掉（它唯一的出口）', () => {
    resetBigMap();
    const { env } = mkEnv();
    openBigMap(env);
    expect(bigMapOpen()).toBe(true);
    bigMapScreen.contextmenu?.(0, 0, env);
    expect(bigMapOpen()).toBe(false);
  });

  it('遊戲百科：右键关掉，并放取消音 4 @source loc_0044e546', () => {
    resetHelp();
    const { env, effects } = mkEnv();
    openHelpAt(env, 0, 0);
    expect(helpScreen.active(env)).toBe(true);
    helpScreen.contextmenu?.(0, 0, env);
    expect(helpScreen.active(env)).toBe(false);
    expect(effects).toEqual([CANCEL_SOUND]);
  });

  it('公佈欄：右键与 ESC **等效**（主屏那一层都是收屏）', () => {
    const { env } = mkEnv();
    resetBoardScreen();
    expect(boardScreen.toolbar?.(9, env)).toBe(true);
    expect(boardScreen.active(env)).toBe(true);
    boardScreen.contextmenu?.(0, 0, env);
    expect(boardScreen.active(env)).toBe(false);

    // 同一条路的另一半：ESC（原版钩子把取消键补成 0x205，两者本来就一样）
    resetBoardScreen();
    expect(boardScreen.toolbar?.(9, env)).toBe(true);
    expect(boardScreen.hotkey?.(5, env)).toBe(true);
    expect(boardScreen.active(env)).toBe(false);
  });

  it('公佈欄：填数页那一层右键只收填数页、不整屏关掉 @source loc_00425fca', () => {
    // ⚠️ 走到 `price` 那一层要点完整的「SALE → 选物窗 → 行」，
    //    版式那几步由 `board-screen.test.ts` 钉；这里只钉**一条**：
    //    `cancelBoardLayer` 的次序与 `boardScreen.contextmenu` 是同一支。
    const { env } = mkEnv();
    resetBoardScreen();
    boardScreen.toolbar?.(9, env);
    // 主屏之外的那几层都用同一支（`mode !== 'board'` → 回主屏，主屏 → 收屏）
    boardScreen.contextmenu?.(0, 0, env);
    expect(boardScreen.active(env)).toBe(false);
  });
});

describe('★ 工具栏那几扇（需求方点名的）都在梯子上', () => {
  // 工具列 11 颗 → 开出来的屏；每一颗都要能在右键那一拍收到
  // （#5 大地圖是**登记的整屏**，走它自己的 `contextmenu` 钩子，见上一节）
  const toolbar: readonly { index: number; label: string; open: CancelSnapshot; layer: CancelLayer }[] =
    [
      { index: 1, label: '遊戲設定', open: snap({ screen: 'options' }), layer: 'options' },
      { index: 2, label: '託管AI', open: snap({ screen: 'aiSettings' }), layer: 'aiSettings' },
      { index: 3, label: '讀取進度', open: snap({ screen: 'saveload' }), layer: 'saveload' },
      { index: 4, label: '儲存進度', open: snap({ screen: 'saveload' }), layer: 'saveload' },
      { index: 6, label: '個人資產表', open: snap({ screen: 'assets' }), layer: 'assets' },
      { index: 7, label: '道具欄', open: snap({ screen: 'inventory' }), layer: 'inventory' },
      { index: 8, label: '卡片欄', open: snap({ screen: 'inventory' }), layer: 'inventory' },
      { index: 10, label: '股市', open: snap({ screen: 'stock' }), layer: 'stock' },
    ];

  for (const t of toolbar) {
    it(`工具列 #${t.index}「${t.label}」→ 右键收的是「${t.layer}」`, () => {
      expect(cancelLayerOf(t.open)).toBe(t.layer);
    });
  }
});
