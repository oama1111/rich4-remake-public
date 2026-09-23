/*
 * 语音播放的**唯一出口**
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么需要它：本项目长期的问题是「文字没有唯一入口」——
 *   有 4 处各自剥 `#NNNN` 前缀、却**都不播语音**，而全 client 只有
 *   `main.ts:5093` 一处播 `Speaking.mkf`（且只能取到角色台词表那 324 条）。
 *   于是文本里另外 **610 个低于 1050 的 `#NNNN`**（如 `#0004歡迎下次再來！`）
 *   **一声不响**。
 *
 * 这里用一个模块级的 sink 把"谁来播"与"在哪解析"解耦：
 *   · 解析与触发：各文字路径调 `playVoiceCode(text)`（它返回正文，顺手播语音）；
 *   · 播放实现：`main.ts` 启动时 `setVoiceSink(...)` 注册一次。
 * 这样不必把 `SoundPlayer` 穿透到每个渲染函数，改动面很小。
 *
 * ⚠️ 与 `speech-bubble.ts` 的 `SpeechQueue` 不冲突：那条路径播的是
 *   **角色台词表**（`speechIndex(角色,事件)`，`main.ts:5093`），
 *   本模块管的是**文本里带 `#NNNN` 的其它文字**。两者互不重复。
 */

import { parseVoiceCode } from '@rich4/data';

/** 播放实现（由 `main.ts` 注册）。未注册时静默 —— 单测里就是这种状态。 */
let sink: ((voice: number) => void) | null = null;

/** 注册播放实现（只应由 `main.ts` 调一次） */
export function setVoiceSink(fn: ((voice: number) => void) | null): void {
  sink = fn;
}

/** 测试用：读回当前 sink 是否存在 */
export function hasVoiceSink(): boolean {
  return sink !== null;
}

/**
 * 解析串首的 `#NNNN`：**播语音**（若有）并返回去掉前缀的正文。
 *
 * 原版 `@source 0x0044fabc`：解析出值后 `call 0x45441a`（`play_speech`），
 * 再 `add ebx, 5` 跳过前缀继续画。本函数就是这两步的合并。
 */
export function playVoiceCode(text: string): string {
  const { voice, rest } = parseVoiceCode(text);
  if (voice !== null) sink?.(voice);
  return rest;
}

// ============================================================
//  「语音还在响吗」/「停掉语音」—— 字框计时要用（魔法屋女巫窗口）
// ============================================================

/**
 * 语音是否还在响（由 `main.ts` 注册）。未注册 = 恒 `false`（单测里就是这种状态）。
 *
 * ★ 为什么要有它：原版字框的到期判据 `fcn_0044ee18`（VA 0x0044ee18）**不只是 2000 ms**：
 * ```asm
 * 0044ee3f  call timeGetTime / sub eax, [0x4762c4]
 * 0044ee4e  cmp  eax, 0x7d0 / jb 0x44ee5f           ; 不满 2000 ms → 还挂着
 * 0044ee55  mov  [0x4762c4], 0                       ; 满了 ……
 * 0044ee63  cmp  byte [0x49715b], 0 / je 0x44ee76    ; 音效档（RICH4.CFG+3）关着 → 到期
 * 0044ee6c  call 0x4544b9 / mov [0x4762c4], eax      ; ★ 语音还在响（`GetStatus & DSBSTATUS_PLAYING`）→ 1 ⇒ 继续挂着
 * ```
 * ⇒ 一句话挂 **max(2000 ms, 语音时长)**（音效开着时）。`0x4544b9` 问的是**唯一那一路语音缓冲**
 *   `[0x47e750]`（= 最近起播的那一句）。
 */
let busyProbe: (() => boolean) | null = null;

/** 注册「语音还在响吗」（只应由 `main.ts` 调一次）*/
export function setVoiceBusyProbe(fn: (() => boolean) | null): void {
  busyProbe = fn;
}

/** 最近起播的那一句语音还在响吗（音效档关掉时恒 `false`，同 `0x0044ee63` 那道闸）*/
export function voiceBusy(): boolean {
  return busyProbe?.() === true;
}

/** 停掉正在响的语音（由 `main.ts` 注册）*/
let stopper: (() => void) | null = null;

/** 注册「停掉语音」（只应由 `main.ts` 调一次）*/
export function setVoiceStopper(fn: (() => void) | null): void {
  stopper = fn;
}

/**
 * 停掉正在响的那一句语音 —— 原版 `fcn_00454493`（`IDirectSoundBuffer::Stop` + `Release`，
 * 清 `[0x47e750]`）。调用点：`fcn_0044ee18(1)`（「立刻收起字框」那一支，VA 0x0044ee30）。
 */
export function stopVoice(): void {
  stopper?.();
}
