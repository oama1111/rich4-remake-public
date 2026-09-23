/*
 * 送進監獄／醫院、被綁架／出國那一刻的**镜头**（`view_to`）—— 纯表现提示
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：「镜头看哪里」是 exe 里写死的调用序列，由 core 给出，表现层只照做 ——
 *   所有客户端拿同一对 (before, after) 算出同一组目标（与 `lastViewTarget` 同一类提示，
 *   只是它挂在「影片什么时候起播」上，而那一刻由表现层的影片队列决定，所以做成纯函数
 *   而不是 `GameState` 字段：不进指纹、不进存档，也不会被 `reduce` 出口清掉）。
 * ★ C-DET-4：不读写任何 state，不消耗随机数。
 *
 * ## 三个函数的镜头序列（`view_to` = `fcn_0041d476`，第三参 0 = 真的移镜头）
 *
 * ```asm
 * ; 送監獄 send_to_prison  0x0043d593
 * 0043d5cc  call 0x41d476(p.+0x08, p.+0x0a, 0)   ; ① 对准**受害者现在的位置**（改位置之前）
 * 0043d647  写 +0x08/+0x0a ← 監獄坐标             ;    （首次；加刑那一支 0x0043d6bd 不改位置）
 * 0043d6aa  call 0x45144f                         ;    警车 0x21a（動畫過程开着才播）
 * 0043d6f1  call 0x41d476(p.+0x08, p.+0x0a, 0)   ; ② 对准**新位置**（監獄）
 * 0043d71c  call 0x44ef41                         ;    受害者那一句
 * ; 送醫院 send_to_hospital 0x0043ec3f —— 同形
 * 0043ec78  ① / 0043ecf3 写位置 / 0043ed59 救护车 0x20c / 0043eda0 ② / 0043edcb 台词
 * ; 消失（綁架／出國）0x0040d375 —— 只有 ①，且只在**本来没在消失**时（0x0040d3a6 jne 跳过整段）
 * 0040d3e6  call 0x41d476(p.+0x08, p.+0x0a, 0)   ; ①
 * 0040d498  call 0x45144f                         ;    飛機 0x22e / 飛碟 0x215
 * 0040d4ae  写 +0x08/+0x0a ← 所在格坐标（**没有**第二次 view_to）
 * ```
 *
 * `view_to` 本身（`0x0041d496..0x0041d4fd`）：目标 == **当前行动者**（`[0x49910c]`）的坐标 ⇒
 * 清标记（镜头回行动者）；否则落标记、居中到目标。⇒ 受害者就是行动者时两次都等于「看行动者」，
 * 表现层原有的跟随（冻镜头 / `confined` 支）已经是这个样子，这里给 `null`。
 */

import type { GameState } from '../state/types.ts';

/** 一次关押 / 消失对应的镜头目标 */
export interface ConfineView {
  /** 受害者下标 */
  player: number;
  kind: 'prison' | 'hospital' | 'disappear';
  /** ① 影片**之前**对准的位置（受害者改位置之前的 `+0x08/+0x0a`）；受害者就是行动者 ⇒ `null` */
  from: { x: number; y: number } | null;
  /** ② 影片**之后**对准的位置（監獄／醫院的新位置）；消失那一支没有 ②、受害者就是行动者 ⇒ `null` */
  to: { x: number; y: number } | null;
}

/** 计数字节的高位 0x80 是「待释放」状态，不是天数 @source 0x0041c8ea `or ch, 0x80` */
const days = (raw: number): number => raw & 0x7f;

/**
 * 这一拍（一条 action 的前后）有哪几位被送进監獄／醫院、开始消失 —— 按玩家下标排，
 * 每人一条（同一人两样都有时医院在前，与表现层 `confineFxTrigger` 的取法一致）。
 *
 * 判据与表现层起播影片的判据同一套（`confine-fx.ts` 的 `confineFxTrigger` /
 * `disappear-fx.ts`）：占用表 0→1 或天数（低 7 位）变大 = 调了一次 `send_to_*`；
 * `disappearing` 0→非 0 = 调了一次 `0x40d375` 且走了首次那一支。
 *
 * 行动者 = `before.currentPlayer`（原版 `[0x49910c]`，调用那一刻还没换人）。
 */
export function confineViewTargets(before: GameState, after: GameState): ConfineView[] {
  const out: ConfineView[] = [];
  const actor = before.currentPlayer;
  for (let i = 0; i < after.players.length; i++) {
    const b = before.players[i];
    const a = after.players[i];
    if (b === undefined || a === undefined) continue;
    const self = i === actor;
    const from = self ? null : { x: b.xpos, y: b.ypos };
    const to = self ? null : { x: a.xpos, y: a.ypos };
    const hospital =
      (after.hospitalOccupancy[i] === 1 && before.hospitalOccupancy[i] !== 1)
      || days(a.blocking.inHospital) > days(b.blocking.inHospital);
    if (hospital) out.push({ player: i, kind: 'hospital', from, to });
    const prison =
      (after.prisonOccupancy[i] === 1 && before.prisonOccupancy[i] !== 1)
      || days(a.blocking.inPrison) > days(b.blocking.inPrison);
    if (prison) out.push({ player: i, kind: 'prison', from, to });
    // @source 0x0040d3a6 `test ah, ah / jne 0x40d4c5` —— 本来就在消失：只加天数，不移镜头、不播片
    if (b.blocking.disappearing === 0 && a.blocking.disappearing !== 0) {
      out.push({ player: i, kind: 'disappear', from, to: null });
    }
  }
  return out;
}
