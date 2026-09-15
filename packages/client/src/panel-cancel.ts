/*
 * 「取消」这一拍该收哪一层 —— **ESC 与右键共用同一把梯子**
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 需求方 2026-09-16 报的第三条：
 *   「打开顶部的任意工具栏要取消打开的话，应该可以使用右键（和取消使用道具卡片的
 *     交互一样），而不是只能通过 ESC 关闭」。
 *
 * ★ 为什么「ESC 与右键必须是同一件事」—— 这是**原版自己的做法**，不是我们的简化：
 *
 *   1. RICH4.CFG 里那把「取消」键被按下时，全局键盘钩子**不把按键发下去**，
 *      而是给主窗口补一条 `WM_RBUTTONUP (0x205)`：
 *   ```asm
 *   ; rich4_keyboard_hook.asm VA 0x004011c3（`cmp esi, [cfg+26]` 那一段之后）
 *   004011c3  push 0
 *   004011c5  push 0
 *   004011c7  push 0x205
 *   004011cb  push [gWindowHandle]
 *   004011d2  call PostMessageA
 *   ```
 *   2. 这份 exe 的「模态窗口」不是真窗口，而是 `windowCallbacks[]` 这个**栈**
 *      （`Wait_0402_Message` 压栈、`Post_0402_Message(0x402)` 弹栈，
 *      见 `rich4-re/asm/rich4_window_util.c`）。主窗口过程把收到的**所有**消息
 *      交给**栈顶**那一个回调：
 *   ```asm
 *   ; rich4_main.asm VA 0x00401b33
 *   00401b33  ebx = callbackSize
 *   00401b3a  cmp [windowCallbacks + ebx*4], 0
 *   00401b4f  call [windowCallbacks + ebx*4](hwnd, msg, wParam, lParam)
 *   ```
 *   ⇒ **同一屏的 ESC 与右键在原版是字面同一条消息**，副作用（放取消音、
 *     清掉选中行、退回上一页、返回 0/−1…）当然也一模一样。
 *
 *   所以本模块把「从最上面那一层开始收」写成**一份数据 + 一个纯选择器**，
 *   `main.ts` 的熱鍵 ESC 那一路与 `contextmenu` 那一路**只调它**；
 *   各整屏（`board-screen` / `help-screen` …）的两个钩子同样指回自己的同一支。
 *
 * ⚠️ **唯一的例外是棋盘本体**：没有模态窗口时（`callbackSize == 1`）钩子不走
 *   0x205 那一路，而是置 `[0x46caff] = 1`（@source VA 0x004011af），
 *   所以「右键清掉小地图标记」这一条 **ESC 不做** —— 它在 `main.ts` 里留在
 *   梯子**之外**、只挂右键。
 */

/** 现在最上面那一层是谁 */
export type CancelLayer =
  /** 目标拾取模式（棋盘上的模态指针，`_rich4_select_instance_callback`）*/
  | 'pick'
  /** 遙控骰子的点数盘（`fcn_00446774`）*/
  | 'dicePick'
  /** 銀行 ATM 面板（`fcn_00436ef8`）*/
  | 'atm'
  /** 通用填数页（`fcn_00453544`）*/
  | 'amountPage'
  /** 通用訊息框（YES/NO，`fcn_0045367e`）*/
  | 'dialog'
  /** 設定屏的副屏（日期頁 `fcn_00410ac3` / 熱鍵頁 `fcn_00411122` / YES-NO）*/
  | 'optionsSub'
  /** 設定屏本体（`fcn_004103a3`）*/
  | 'options'
  /** 託管AI（`fcn_0041dda9`）*/
  | 'aiSettings'
  /** 存讀檔（`fcn_0040363a` / `fcn_004039c2`）*/
  | 'saveload'
  /** 個人資產表（`fcn_00423cf3`）*/
  | 'assets'
  /** 道具欄 / 卡片欄（`fcn_00445c14` / `fcn_004413ec` / `fcn_004416f0`）*/
  | 'inventory'
  /** 股市：選股模式（紅卡/黑卡借屏点股）*/
  | 'stockPick'
  /** 股市：上市公司資訊详情卡（`fcn_00429d65`）*/
  | 'stockDetail'
  /** 股市：填数页（`fcn_00453544`，借股市屏开的）*/
  | 'stockAmount'
  /** 股市：持股页 → 行情页（并清掉选中行）*/
  | 'stockPage'
  /** 股市屏本体（`fcn_0042aaff`）*/
  | 'stock'
  /** 百貨公司（`fcn_0042d37f`）*/
  | 'shop'
  /** 監獄／醫院保釋屏（`_rich4_ui_prison_callback` / `_rich4_ui_hospital_callback`）*/
  | 'bail'
  /** 銀行貸款屏（`fcn_00435062`）*/
  | 'loan';

export interface CancelRule {
  layer: CancelLayer;
  /**
   * 原版这一屏收 `WM_RBUTTONUP (0x205)` 的那一支 —— **一个 VA 都不许少**。
   * 这份字符串同时是单测的取证栏。
   */
  readonly source: string;
  /** 收到之后做什么（副作用；特别标出**不放音**与「还有别的状态写入」的那些）*/
  readonly effect: string;
}

/**
 * 梯子 —— **顺序即优先级**，最上面那一层先收。
 * 与 `cancelLayerOf()` 是同一条次序的两个面（数据给人看，函数给机器走）。
 */
export const CANCEL_LADDER: readonly CancelRule[] = [
  {
    layer: 'pick',
    source: 'loc_004466b8',
    effect: '放取消音（音效 4）+ 退回；`[0x48c594]` bit3 置位（目标必选）的不认',
  },
  { layer: 'dicePick', source: 'loc_00446a66', effect: '放取消音（音效 4）+ 关掉点数盘' },
  { layer: 'atm', source: 'loc_0043791e', effect: '关面板（★ 不放音）' },
  { layer: 'amountPage', source: 'loc_004534a3', effect: '放取消音（音效 4）+ 关填数窗，返回 0（= 没填）' },
  { layer: 'dialog', source: 'loc_004539a2', effect: '放取消音（音效 4）+ 关訊息框，返回 0（= NO／取消）' },
  {
    layer: 'optionsSub',
    source: 'loc_0041104c（日期頁）/ loc_00411915（熱鍵頁）',
    effect: '关副屏，返回 −1；熱鍵頁那一路只是松开捕获',
  },
  { layer: 'options', source: 'fcn_0041095b', effect: '关設定屏，返回 0（★ 不放音）' },
  { layer: 'aiSettings', source: 'loc_0041e2ba', effect: '关屏 = 取消（草稿不拷回；★ 不放音）' },
  { layer: 'saveload', source: 'loc_00403934（SAVE）/ loc_00403cf4（LOAD）', effect: '放取消音（音效 4）+ 关屏，返回 −1' },
  { layer: 'assets', source: 'loc_00424409', effect: '关屏，返回 0（★ 不放音）' },
  {
    layer: 'inventory',
    source: 'loc_00441671 / loc_004418b9（卡片欄）/ loc_00445dad（道具欄）',
    effect: '关浮窗，返回 0（★ 不放音）',
  },
  { layer: 'stockPick', source: 'loc_0042b22f（`[0x48c2ed] != 0`）', effect: '放取消音（音效 4）+ 抛回 0 = 取消选股，卡不消耗' },
  { layer: 'stockDetail', source: 'loc_0042aa08（`fcn_00429d65` 收 0x205）', effect: '关详情卡，回股市屏（★ 不放音）' },
  { layer: 'stockAmount', source: 'loc_004534a3（借股市屏开的填数窗）', effect: '放取消音（音效 4）+ 关填数页' },
  {
    layer: 'stockPage',
    source: 'loc_0042b22f（`[0x48c2ec] != 0` 那一支）',
    effect: '退回行情页 + **清掉选中行**（`[0x48c2eb] = 0`）',
  },
  { layer: 'stock', source: 'loc_0042b25a（`[0x48c2ec] == 0`）', effect: '放取消音（音效 4）+ 关股市屏' },
  { layer: 'shop', source: 'fcn_0042d37f', effect: '直接 `Post_0402_Message` 走人（★ 不说道别语、不放音）' },
  {
    layer: 'bail',
    source: 'loc_0043d266（監獄）/ loc_0043e7c7（醫院）',
    effect: '收起定时器 + 关屏，返回 0 = **不保釋**',
  },
  { layer: 'loan', source: 'loc_00435f6d', effect: '说再见 + 关贷款屏' },
];

/**
 * 此刻各层开着没有。**全是纯查询** —— 不许在这里改任何状态
 * （`active()` 那条契约同理，见 `ui-screen.ts`）。
 */
export interface CancelSnapshot {
  readonly screen: string;
  /** 登记的整屏（百貨/拍賣/樂透/保釋…）正在接管画面 —— 棋盘上那层对话框不在画 */
  readonly overlay: boolean;
  readonly pick: boolean;
  readonly dicePick: boolean;
  readonly atm: boolean;
  /** `currentDialog() !== null` */
  readonly dialog: boolean;
  readonly amountPage: boolean;
  readonly optionsSub: boolean;
  readonly stockPick: boolean;
  readonly stockDetail: boolean;
  readonly stockAmount: boolean;
  /** 股市当前页（0 = 行情页 / 1 = 持股页）*/
  readonly stockPage: number;
  readonly shop: boolean;
  readonly bail: boolean;
  readonly loan: boolean;
}

/**
 * 梯子走一遍：返回最上面那一层；`null` = 这一拍没人接。
 *
 * ★ 两条不能颠倒的次序：
 *   ① 「棋盘上的对话框」必须在**它底下那一屏**之前 —— 原版的填数窗／訊息框是
 *      另开的一个模态回调（`Wait_0402_Message`），压在銀行/股市/公佈欄之上。
 *   ② 股市内部：选股 → 详情卡 → 填数页 → 持股页 → 关屏（`fcn_0042aaff` 的跳表次序）。
 *
 * ★ 百貨公司 / 保釋屏 / 貸款屏这三屏**自己就是整屏**（`main.ts` 的 `drawShopStage`
 *   / `drawBailStage` 与 `drawBankLoan` 都是提前 return、把棋盘连对话框一起盖掉），
 *   所以它们要排在棋盘对话框**之前** —— 否则这一拍会被那份「看不见的对话框」
 *   先接走。它们在 `interactionUi` 里也各有一份壳子，那壳子是兜底，不是入口。
 *
 * ⚠️ `overlay` 为真时**不看** `dialog`：拍賣/樂透/小游戏各有自己的整屏，
 *   `interactionUi` 给它们的那一份只是「万一那一屏没画出来」的壳子
 *   （见 `interactions.ts` 的 `shop` / `bail` 两条注），原版那些屏也**没有**
 *   0x205 分支（`rich4_ui_auction.asm` 全文没有 0x205；`rich4_small_games.asm` 同）。
 *   不挡这一下，ESC/右键就会把它们的壳子当成通用訊息框去「取消」。
 */
export function cancelLayerOf(s: CancelSnapshot): CancelLayer | null {
  if (s.pick) return 'pick';
  if (s.dicePick) return 'dicePick';
  if (s.atm) return 'atm';
  if (s.screen === 'game' && !s.overlay && s.dialog && s.amountPage) return 'amountPage';
  // 整屏三兄弟：自己把棋盘与对话框都盖掉了（次序见上面第 ★ 段）
  if (s.screen === 'game' && s.shop) return 'shop';
  if (s.screen === 'game' && s.bail) return 'bail';
  if (s.screen === 'game' && s.loan) return 'loan';
  if (s.screen === 'game' && !s.overlay && s.dialog) return 'dialog';
  if (s.screen === 'options') return s.optionsSub ? 'optionsSub' : 'options';
  if (s.screen === 'aiSettings') return 'aiSettings';
  if (s.screen === 'saveload') return 'saveload';
  if (s.screen === 'assets') return 'assets';
  if (s.screen === 'inventory') return 'inventory';
  if (s.screen === 'stock') {
    if (s.stockPick) return 'stockPick';
    if (s.stockDetail) return 'stockDetail';
    if (s.stockAmount) return 'stockAmount';
    if (s.stockPage !== 0) return 'stockPage';
    return 'stock';
  }
  return null;
}

/** 取消音 —— `[0x482332] = 4`（`play_sound_effect(0, 0x482332)` 取 `[ptr]` 当号）*/
export const CANCEL_SOUND = 4;
