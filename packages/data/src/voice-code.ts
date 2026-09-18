/*
 * `#NNNN` 语音码的解析 —— **唯一入口**
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么要有这个模块：**文字没有唯一入口**是本项目一个长期的坑 ——
 *   全 client 曾有 6 个地方各自剥前缀（`stripVoice` / `stripEventCode` /
 *   三处内联 `slice(5)`），而**全 client 只有 1 处真正播语音**。
 *   结果是：文本里 610 个低于 1050 的 `#NNNN`（如 `#0004歡迎下次再來！`）
 *   **只被剥掉、从不发声**。把解析收敛到这里，是让它们能播的前提。
 *
 * ## 原版规则（两处解析点，**规则相同**）
 *
 * @source `0x0044fabc`（通用文本绘制，串**中间**的 `#` 也处理）：
 * ```asm
 * 0044fb00  cmp   ah, 0x23                 ; '#'
 * 0044fb05  xor   eax, eax
 * 0044fb07  mov   al, byte ptr [ebx + 1]   ; 千位
 * 0044fb0a  lea   esi, [eax - 0x30]
 * 0044fb0d  mov   eax, esi
 * 0044fb0f  shl   eax, 2
 * 0044fb12  sub   eax, esi                 ; ×3
 * 0044fb14  shl   eax, 3
 * 0044fb17  add   eax, esi
 * 0044fb19  shl   eax, 3                   ; 合成 ×1000
 * 0044fb1c  mov   edx, eax
 * 0044fb1e  shl   edx, 2
 * 0044fb21  add   edx, eax
 * 0044fb23  xor   eax, eax
 * 0044fb25  mov   al, byte ptr [ebx + 2]   ; 百位
 * 0044fb28  sub   eax, 0x30
 * 0044fb2b  imul  eax, eax, 0x64
 * 0044fb2e  add   edx, eax
 * 0044fb30  xor   eax, eax
 * 0044fb32  mov   al, byte ptr [ebx + 3]   ; 十位
 * 0044fb35  lea   esi, [eax - 0x30]
 * 0044fb38  mov   eax, esi
 * 0044fb3a  shl   eax, 2
 * 0044fb3d  add   eax, esi
 * 0044fb3f  add   eax, eax                 ; ×10
 * 0044fb41  add   edx, eax
 * 0044fb43  xor   eax, eax
 * 0044fb45  mov   al, byte ptr [ebx + 4]   ; 个位
 * 0044fb48  sub   eax, 0x30
 * 0044fb4b  add   eax, edx
 * 0044fb4d  push  eax
 * 0044fb4e  call  0x45441a                 ; ★ play_speech(值) —— **无任何加法偏移**
 * 0044fb53  add   esp, 4
 * 0044fb56  add   ebx, 5                   ; ★ 永远跳过 '#' + 4 个字符
 * ```
 *
 * @source `0x0044ef41`（`player_say`，串**首**的 `#`）：同构，见其 `0x0044f0ed`–`0x0044f136`。
 *
 * ⇒ **结论**：`#NNNN` 就是 `speaking.mkf` 的资源号，**原样取值、不加偏移**；
 *   前缀恒为 **5 个字符**（`#` + 4 位），无论那 4 位是不是数字。
 *
 * ⚠️ **`1050 + 角色×27 + 事件` 不是 `#NNNN` 的解析规则**，它只描述
 *   **角色台词表**（指针表 `0x0048084a`，12×27 = 324 项）用的是哪些号。
 *   这两件事极易混淆，本项目已经在这上面错过一次（见 `docs/systems/dialogue-voice.md`）。
 */

/** 语音码前缀的长度：`#` + 4 位，原版 `add ebx, 5` 定死 */
export const VOICE_CODE_PREFIX_LEN = 5;

export interface VoiceCode {
  /**
   * `#NNNN` 里的 `NNNN`（**原样取值，没有任何偏移**）。
   * 没有前缀、或那 4 个字符不全是数字时为 `null`。
   */
  voice: number | null;
  /** 去掉 `#NNNN` 之后的正文（可能还带 `@DD` 表情图号） */
  rest: string;
}

/**
 * 解析串首的 `#NNNN`。
 *
 * @param text 原始文本（Big5 已解码成 JS 字符串）
 *
 * ⚠️ 那 4 个字符**不全是数字**时原版会照样算出垃圾值再 `play_speech`（它不做校验），
 *   本实现**不照抄这个行为**：返回 `voice: null` 且**不剥前缀**（保留原样便于排查）。
 *   理由：那是一份坏数据才会走到的路径，静默播放一个错号比不播更难查。
 *   这一点是**有意偏离**，不是遗漏。
 */
export function parseVoiceCode(text: string): VoiceCode {
  if (!text.startsWith('#')) return { voice: null, rest: text };
  const digits = text.slice(1, VOICE_CODE_PREFIX_LEN);
  if (digits.length < 4) return { voice: null, rest: text };
  for (let i = 0; i < 4; i++) {
    const c = digits.charCodeAt(i);
    if (c < 0x30 || c > 0x39) return { voice: null, rest: text };
  }
  return { voice: Number(digits), rest: text.slice(VOICE_CODE_PREFIX_LEN) };
}

/** 只取正文（不要语音号）—— 与 `parseVoiceCode(text).rest` 等价 */
export function stripVoiceCode(text: string): string {
  return parseVoiceCode(text).rest;
}
