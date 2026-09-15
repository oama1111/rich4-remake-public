/*
 * 銀行 —— **貸款屏**（申請 / 償還 / 董事長的特別融資）—— T-029b
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 银行落点的第 ② 屏（第 ① 屏是 ATM，见 `bank-screen.ts`）：
 * `rich4_player_core_actions.asm:2549` 起，ATM 关掉之后
 * `call _rich4_ui_bank_entry`（**VA 0x436668**）→ 窗口过程 **`fcn_00435062`**。
 *
 * ## 底图有两张（按「是不是董事長」二选一）
 *
 * @source `fcn_00434186`（VA 0x434186）：
 * ```asm
 * if (player+0x3c != 0) blit(图0, 图23, 345,345)   ; 冻结时给「申請貸款」盖禁止章
 * if (arg == 0) { 把 图1（344×240，窗里的老板）贴到 图0 (320,240) ; return }
 * ; ── 董事長那一支整张换成 图2 ──
 * ```
 * | 图 | 尺寸 | 是什么 |
 * |---|---|---|
 * | 0 | 640×480 | **店員室**（常态底图，已经画着 EXIT 与三张白单子）|
 * | 1 | 344×240 锚点 (62,198) | **百叶窗拉下来的样子**（常态才贴到 (320,240) —— 不是董事長就看不见人）|
 * | 2 | 640×480 | **董事長室**（董事長时整张换掉）|
 *
 * ## 四颗钮（表 `0x4757f8`，每项 8 字节 x0,y0,x1,y1）
 *
 * | # | 矩形 | 常态 | 董事長 | 门槛 @source |
 * |---|---|---|---|---|
 * | 0 | (548,431)-(628,471) | EXIT | 同 | — |
 * | 1 | (282,324)-(408,366) | 申請貸款 | 週轉現金 | `loc_00435d48`：`player+0x3c == 0`（没被凍結）|
 * | 2 | (470,326)-(590,366) | 償還貸款 | 歸還款項 | `loc_00435da4`：`loan != 0` 才有反应 |
 * | 3 | (268,51)-(591,273) | 窗（点它没反应）| **特別融資** | `loc_00435ddb`：`[0x48c3e0] != 0`（董事長）|
 *
 * ## 文字（两张底图各画各的）
 *
 * @source `fcn_00434186`；三行数额在 `fcn_00433c20`（VA 0x433c20）
 *
 * | 字 | 落点 | 字号/对齐 |
 * |---|---|---|
 * | `申請貸款` / `償還貸款` | (345,345) / (530,345) | 26 号 `0x101010` 居中 |
 * | `特別融資` | (443,427) | 26 号 居中 |
 * | `週轉現金` / `歸還款項` | (67,324) / (67,382) | 20 号 `0xf0f0f0` 居中 |
 * | `客戶存款總額` / `目前融資金額` / `尚可融資金額` | (78,147) / (78,195) / (78,243) | 16 号 `0x202020` 居中 |
 * | 三条**数额** | (128,163) / (128,211) / (128,259) | 16 号 `0xf0f0f0` 右对齐（flag 1）|
 *
 * 三条数额依次是 **額度 / 已用（`player+0x28` 特別融資余额）/ (額度 − 已用)**。
 *
 * ⚠️ **没做**：
 * - 进屏时那两块滑入面板（`fcn_00433d6e` 画 280×200 的头像+名字+两行、
 *   `fcn_00433f24` 画 200×200 的日期），贴法是 280×200 @(0,y)、200×200 @(280,y)，
 *   y 由状态 `[0x48c3d5]` 驱动（滑入动画）。
 * - `0x402`..`0x40a` 那串状态机与 `0x113` 定时器（店員的反应、表单滑入）。
 * - `fcn_00433c20` 里那次 `fcn_0045643d` 的 8 个参数只解出「一块 113×117 被贴到
 *   (135,278)」，语义未明。
 * - 董事長那三张左边的小钮图（图 16/18 落 (11,305)/(11,362)/(11,419)）**没有命中框**
 *   （命中表只有那 4 项），它们各自点下去是什么、第三张旁边那颗的字是什么，都还没跟。
 */

import type { ArchiveName, Sprite } from './assets.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名）*/
export type LoanSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 底图图集 @source 入口 VA 0x4367ab 的 `read_mkf(panel_mkf, 0x17, 0, 0)` */
export const LOAN_RESOURCE = 23;
/** 两张底图：常态 = 店員室、董事長 = 他自己的办公室 @source `fcn_00434186` */
export const LOAN_ROOM = { normal: 0, chairman: 2 } as const;
/**
 * 常态盖上窗口的那张 **百叶窗**（图 1，344×240，锚点 (62,198)）。
 *
 * ★ 它是「看不见董事長」的意思 —— 常态（非董事長）才贴；董事長时整张底图
 *   换成图 2（他自己的办公室，人在里面）。落点 (320,240) 是**锚点**。
 * @source `fcn_00434186` 的 `push 0xf0 / push 0x140` + `fcn_004562a5`
 */
export const LOAN_BLIND_WINDOW = { image: 1, x: 0x140, y: 0xf0 } as const;
/** 冻结时给「申請貸款」盖的禁止章 @source `fcn_00434186` 的 `lea edx,[eax+0x120]`（= 图 23）*/
export const LOAN_FROZEN_MARK = { image: 23, x: 0x159, y: 0x159 } as const;

/** 一颗钮的屏幕矩形 */
export interface LoanButton {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 四颗钮 —— 逐项 dump 自 `0x4757f8` @source 命中 `loc_00435c12` */
export const LOAN_BUTTONS: readonly LoanButton[] = [
  { x0: 548, y0: 431, x1: 628, y1: 471 }, // EXIT
  { x0: 282, y0: 324, x1: 408, y1: 366 }, // 申請貸款 / 週轉現金
  { x0: 470, y0: 326, x1: 590, y1: 366 }, // 償還貸款 / 歸還款項
  { x0: 268, y0: 51, x1: 591, y1: 273 }, // 窗（董事長时 = 特別融資）
] as const;

/** 钮的编号 */
export const LOAN_EXIT = 0;
export const LOAN_PRIMARY = 1;
export const LOAN_SECONDARY = 2;
export const LOAN_FINANCE = 3;

/** 这张牌／这一屏要做的事（`fcn_00435062` 的状态机之外的**动作**部分）*/
export type LoanOp = 'borrow' | 'repay' | 'financeBorrow' | 'financeRepay' | 'exit';

/**
 * 点在第几颗钮上；没点中返回 `null`（坐标是**屏幕/舞台**坐标）。
 *
 * ★ 顺序是表里的顺序（EXIT 在前），所以窗口那颗**最后**判 —— 它最大。
 */
export function hitLoanButton(x: number, y: number): number | null {
  for (let i = 0; i < LOAN_BUTTONS.length; i++) {
    const b = LOAN_BUTTONS[i]!;
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return i;
  }
  return null;
}

/**
 * 点这颗钮在**这一刻**是什么意思（`null` = 按下去没反应）。
 *
 * @param chairman 是不是董事長（`pending.specialFinance !== null`）
 * @param frozen `bank_freeze_days != 0` —— 申請貸款被擋（原版盖禁止章且不理这一下）
 * @param hasLoan `loan != 0` —— 償還貸款才有反应
 */
export function loanActionOf(
  btn: number,
  chairman: boolean,
  frozen: boolean,
  hasLoan: boolean,
): LoanOp | null {
  switch (btn) {
    case LOAN_EXIT:
      return 'exit';
    case LOAN_PRIMARY:
      if (frozen) return null; // @source loc_00435d48 的 `player+0x3c != 0 → 不理`
      return chairman ? 'financeBorrow' : 'borrow';
    case LOAN_SECONDARY:
      if (!hasLoan) return null; // @source loc_00435da4 的 `loan == 0 → 不理`
      return chairman ? 'financeRepay' : 'repay';
    case LOAN_FINANCE:
      return chairman ? 'financeBorrow' : null; // 窗那颗只有董事長认
    default:
      return null;
  }
}

/** 画这一屏 */
export interface LoanView {
  /** 是不是董事長 */
  chairman: boolean;
  /** 冻结中（盖禁止章）*/
  frozen: boolean;
  /** 董事長那三条数额：額度 / 已用 / 还可融（只有董事長看得到）*/
  finance: readonly [number, number, number];
}

const FONT = '"PingFang TC", "Microsoft JhengHei", sans-serif';

/** 一行字（黑/白由调用方定 —— 原版各处的 create_font 颜色不同）*/
function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  align: CanvasTextAlign,
): void {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fill;
  ctx.fillText(s, x, y);
}

/** 带 $ 千分位 —— 与 `client/panel.ts` 的 `currency` 同口径 */
function money(n: number): string {
  return `$${Math.trunc(n).toLocaleString('en-US')}`;
}

/** 三条数额的标签与落点 @source `fcn_00434186` / `fcn_00433c20` */
export const LOAN_FINANCE_ROWS = [
  { label: '客戶存款總額', labelY: 147, valueY: 163 },
  { label: '目前融資金額', labelY: 195, valueY: 211 },
  { label: '尚可融資金額', labelY: 243, valueY: 259 },
] as const;
export const LOAN_FINANCE_X = { label: 78, value: 128 } as const;

/**
 * 画整屏（640×480）。
 *
 * 原版把字**画进底图本身**（`fcn_00434186` 的目标 surface 就是资源 23 的图），
 * 这里每帧照同样坐标画一遍 —— 与個人資產表那屏同一个做法。
 */
export function drawBankLoan(
  ctx: CanvasRenderingContext2D,
  sprite: LoanSprite,
  view: LoanView,
): void {
  const room = sprite('Panel.mkf', LOAN_RESOURCE, view.chairman ? LOAN_ROOM.chairman : LOAN_ROOM.normal, false);
  if (room !== null) ctx.drawImage(room.bitmap, 0, 0);

  if (view.chairman) {
    // 董事長室那一支：三行 16 号 + 特别融資 + 两颗小钮的字
    for (let i = 0; i < LOAN_FINANCE_ROWS.length; i++) {
      const row = LOAN_FINANCE_ROWS[i]!;
      text(ctx, row.label, LOAN_FINANCE_X.label, row.labelY, 16, '#202020', 'center');
      text(ctx, money(view.finance[i] ?? 0), LOAN_FINANCE_X.value, row.valueY, 16, '#f0f0f0', 'right');
    }
    text(ctx, '特別融資', 443, 427, 26, '#101010', 'center');
    text(ctx, '週轉現金', 67, 324, 20, '#f0f0f0', 'center');
    text(ctx, '歸還款項', 67, 382, 20, '#f0f0f0', 'center');
    // 左边那三张钮图：图 16 落 (11,305)/(11,362)、图 18 落 (11,419)
    // @source `fcn_00434186` 的三次 `fcn_004562a5`
    for (const [img, x, y] of [[16, 11, 305], [16, 11, 362], [18, 11, 419]] as const) {
      const s = sprite('Panel.mkf', LOAN_RESOURCE, img, true);
      if (s !== null) ctx.drawImage(s.bitmap, x, y);
    }
  } else {
    // 常态：两张白单子上的字 + 窗里那位
    text(ctx, '申請貸款', 345, 345, 26, '#101010', 'center');
    text(ctx, '償還貸款', 530, 345, 26, '#101010', 'center');
    const blind = sprite('Panel.mkf', LOAN_RESOURCE, LOAN_BLIND_WINDOW.image, true);
    if (blind !== null) {
      ctx.drawImage(
        blind.bitmap,
        LOAN_BLIND_WINDOW.x - blind.anchorX,
        LOAN_BLIND_WINDOW.y - blind.anchorY,
      );
    }
  }

  // 冻结中：给「申請貸款」盖禁止章（图 23）
  if (view.frozen) {
    const mark = sprite('Panel.mkf', LOAN_RESOURCE, LOAN_FROZEN_MARK.image, true);
    if (mark !== null) {
      ctx.drawImage(
        mark.bitmap,
        LOAN_FROZEN_MARK.x - mark.anchorX,
        LOAN_FROZEN_MARK.y - mark.anchorY,
      );
    }
  }
}
