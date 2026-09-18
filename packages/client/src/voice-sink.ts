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
