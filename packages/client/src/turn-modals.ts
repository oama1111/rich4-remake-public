/*
 * 本机那几扇「只属于这一回合」的窗：回合不在本机手里了就收掉（第 pt22 联机：ATM 窗关不掉）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ## 现场
 *
 * 联机两端跑的时候（`tools/net-e2e.js` 自动驱动 + `--seats 2`），A 端路过銀行开了 ATM 窗
 * （`pending{atm}`），那一格随后**在别处**被答掉了 —— 之后几分钟、一路到别人的回合，A 端的
 * ATM 面板一直盖在棋盘上、吞着输入。真实对局里同一条路是**回合计时到点 / 掉线託管**：服务器
 * `setAi(…AUTOPILOT)`（`hub.ts` 的扫描）再由 core 的 AI 替他答掉 `pending{atm}`。
 *
 * ## 根因
 *
 * 其它挂在待决交互上的窗都是**跟着状态同步**的 —— `pending` 一变就收（商店 `syncShopUi`、
 * 貸款屏 `syncLoanUi`、还款提醒 `syncLoanReminder`、樂透 / 研究所 / 監獄醫院 / 小游戏 / 嫁禍窗
 * 的 `active()` 直接读 `pending`）。唯独 ATM：`syncAtmPending` 只管「该开就开」，`pending` 没了
 * 只复位「这次开过了」那一位、**从不关面板**（只有本机点 EXIT / 確認 / 右键三条路会关）。
 *
 * 同一类的还有几扇**本机发起**、活在本机回合里的模态窗：选目标（`pick`）、遥控骰子的点数盘、
 * 紅卡/黑卡的选股、「請選擇設施類別」（改建卡那一路的回调）、搶奪卡的挑件窗 —— 回合被计时 /
 * 託管拿走时它们同样会留在屏上（之后点下去服务器回 `notYourTurn`）。
 *
 * ## 规则（纯函数，`main.ts` 每条 action 落地后照做）
 *
 * - ATM：只随**本机回合里的** `pending{atm}` 活着（原版 `fcn_004379c9` 是模态窗，办完 / 关窗才返回，
 *   不会跨出这一格）；
 * - 其余本机模态窗：回合不在本机真人手里（联机轮到别的座位 / 电脑 / 託管）就收 —— 不回调、不放音、
 *   不重开卡片欄（那些是「本人取消」的反馈，这里是被收走）。
 */

/** 此刻开着的本机模态窗 */
export interface LocalModalsOpen {
  readonly atm: boolean;
  readonly pick: boolean;
  readonly dicePick: boolean;
  readonly stockPick: boolean;
  readonly facilityPicker: boolean;
  readonly stealPicker: boolean;
}

export type LocalModal = keyof LocalModalsOpen;

/** 判据要看的两件事 */
export interface TurnView {
  /** `state.pending?.kind`（没有 = `null`）*/
  readonly pendingKind: string | null;
  /** 回合在本机真人手里（`soft-cursor.ts` 的 `localTurn`：座位对得上、不是电脑 / 託管）*/
  readonly localTurn: boolean;
}

/** 该收掉的那几扇（按固定次序）—— 纯函数 */
export function staleLocalModals(v: TurnView, open: LocalModalsOpen): LocalModal[] {
  const out: LocalModal[] = [];
  if (open.atm && (!v.localTurn || v.pendingKind !== 'atm')) out.push('atm');
  if (v.localTurn) return out;
  for (const k of ['pick', 'dicePick', 'stockPick', 'facilityPicker', 'stealPicker'] as const) {
    if (open[k]) out.push(k);
  }
  return out;
}
