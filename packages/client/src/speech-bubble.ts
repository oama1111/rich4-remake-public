/*
 * 角色台词的**屏幕呈现** —— 「谁在说、说什么、说到什么时候」
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 本文件与 `speech.ts`（触发点探测器：什么局面下谁说哪个槽位）分工不同：
 *   `speech.ts` → `SayEvent[]`（玩家下标 + 槽位号）
 *   本文件      → 把 `SayEvent` 补上**台词文本 / 表情图 / 语音号**，并管一段时长。
 *
 * ── 原版怎么显示（`_rich4_player_say`，VA 0x0044ef41，全文 235 条）──────
 *
 * 原版这一段是**阻塞**的，按①…⑦的次序做完，`fcn_004544f6(1000)` 等 1 秒
 * —— 期间按任意键/鼠标还能提前收场（那 1000 ms 是「等消息」不是 `Sleep`）。
 *
 * | 步 | 原版做什么 | @source |
 * |---|---|---|
 * | ① | 三道闸：`+0x33` 消失 / `+0x37` 夢遊 / `+0x36` 睡眠 任一非 0 ⇒ **整句不说** | 0x0044ef79 / 0x0044ef86 / 0x0044ef93 |
 * | ② | `view_to`：镜头先对到**说话的人** | 0x0044efbd `call 0x41d476` |
 * | ③ | **备份**棋盘区 `RECT(0,40)-(440,260)`（宽 `0x1b8`、高 `0xdc`）—— 只是为了说完还原，**不是底板** | 0x0044effa..0x0044f00f `call 0x451a97` |
 * | ④ | **气泡底图**：`Data.mkf #0x205` 的**图 6**（`[0x48bad8] + 0x54`，`(0x54−0xc)/0xc = 6`），带透明贴到 **(220, 130)** | 0x0044f019 `push 0x82` / `0x0044f01e push 0xdc` … 0x0044f033 `call 0x456418` |
 * | ⑤ | **说话人的表情头像**：`map.mkf #(0x1b + 角色号)` 的**图 `arg2 + 1`**，带透明贴到 **(170, 130)** | 0x0044f03b `push 0x82` / `0x0044f040 push 0xaa`、0x0044f045 `imul eax,[esp+0x2c],0x34 / mov ecx,[eax+0x498eb0]`、0x0044f050 `mov edx,[esp+0x30] / inc edx`（×12 + 0xc）、0x0044f06c `call 0x456418`；资源装载 0x00407faf..0x00407fc7（`add eax,0x1b` → `[0x498eb0 + 槽*0x34]`）|
 * | ⑥ | 串以 `#NNNN` 开头 ⇒ 语音号；其后若是 `@DD` ⇒ 贴表情图 `[0x48bad4]` 的第 `DD−1` 张到 **(240, 130)**（**不画字**）；否则 `draw_text(串, 200, 130, 5)` | 0x0044f07c / 0x0044f08d / 0x0044f0b5..0x0044f0e0 / 0x0044f142..0x0044f14f `call 0x44fabc` |
 * | ⑦ | Blt 到屏幕 → `fcn_004544f6(1000)`（等 1000 ms，可被按键/鼠标提前收）→ 用 ③ 的备份还原 | 0x0044f16c..0x0044f19e、0x0044f1a1 `push 0x3e8`、0x0044f1c4..0x0044f1e4 |
 *
 * ★ 所以原版的观感是：一块**气泡图**（④）右边罩着**说话人的头像**（⑤），
 *   白字/表情图（⑥）落在气泡里 —— 这就是试玩回报里说的「人物说台词时的背景对话框」。
 *
 * ⚠️ **两条订正**（2026-09-19，W-50；两条都是本文件先前的错读）：
 *
 * 1. ★ 先前把第 ③ 步的**备份**当成了底板，还据此断言「原版把棋盘抠下来当底板、
 *    再贴一张 400×89 的角色名牌」—— **错的**。第 ③ 步只是为了说完还原棋盘；
 *    原版的底板是第 ④ 步那张**气泡图**（`Data.mkf #0x205` 图 6，落 (220,130)）。
 *    ⚠️ 神明老虎机（`god-slot.ts`）与转盘（`wheel-screen.ts`）用的**不是**这张，
 *    是 `+0x48` 的图 5（棕色訊息框）—— 全 exe 只有 `player_say` 这一处 `+0x54`。
 *    `fd31598` 据此错读加的「半透明深色底板 + 浅边」**已删**，换成 ④+⑤。
 * 2. ★ `rich4-spec/docs/systems/dialogue-voice.md` §二 与本文档 Q-SPEECH-11
 *    都写过「第二个实参 `flag` 函数体里一次都没读」—— **也是错的**：
 *    它 grep 的是 `esp + 0x28`，而读取点在两次 `push` 之后，偏移变成 `[esp+0x30]`
 *    （`0x0044f050`）。**`arg2` = 表情号**（头像图号 = `arg2 + 1`）。
 *    各调用点传的值见 `docs/tasks/speech-callsites.md` 的「实参」列第 2 项
 *    （0/1/2/3 都有）。⚠️ `arg2` 的 `0x80` 位**另有用处**：`0x0044ef63`
 *    `test byte [esp+0x25],0x80` ⇒ 「不重设视窗卷动」，与表情号并存（如 1 号
 *    调用点传 3 ⇒ 表情 3 且带 0x80 位）。
 *
 * ── 本引擎怎么做（有意偏离，登记在 `docs/deviations/T-052.md`）──────────
 *
 * ④ ⑤ ⑥ 三步**照原样**画（顺序、坐标、取图、抠黑都照 exe）。
 * 唯一不做的是第 ③ + ⑦ 那对「抠下棋盘 → 说完贴回」——它依赖
 * `SelectObject` / Blt 那台**可读回的离屏 DirectDraw 表面**，本引擎的棋盘每帧整体
 * 重画、没有等价的可读回表面；这也是 Q-SPEECH-9 登记的那一条偏离。
 * 时长取原版那个 1000 ms（`fcn_004544f6(0x3e8)`）。
 *
 * ⚠️ 本模块是**纯表现**：不读 DOM、不碰音频、不动 PRNG、不写 `GameState`（C-DET-1/2/4）。
 *   取图那一步交给调用方传进来的 `sprite` 出口（`main.ts` 的 `spriteNow`）。
 */
import {
  cardLine,
  cardLineVoice,
  FREE_CARD_ANSWER_LINES,
  FREE_CARD_ANSWER_SLOT,
  freeCardAnswerVoice,
  SCAPEGOAT_ANSWER_LINES,
  SCAPEGOAT_ANSWER_SLOT,
  scapegoatAnswerVoice,
  parseVoiceCode,
  toolLine,
  speechEmojiImage,
  speechIndex,
  speechLine,
  type SpeechLine,
} from '@rich4/data';
import type { Sprite } from './assets.ts';
import { portraitResource } from './assets.ts';
import type { SayEvent } from './speech.ts';

/**
 * 取图出口 —— 与 `main.ts` 的 `spriteNow` 同形。
 *
 * ★ W-50 起要用**两个**档案：
 *   - `Data.mkf`：气泡图 `#0x205` 图 6、表情图 `#0x207`；
 *   - `map.mkf` ：说话人的表情头像 `#(角色+0x1b)` 图 `表情号+1`（原版 `0x0044f045`
 *     读的 `[0x498eb0 + 槽*0x34]` 就是 `load_map` 里 `read_mkf(map, 角色+0x1b)` 存下来的
 *     那批指针，见 `assets.ts` 的 `portraitResource`）。
 */
export type BubbleSpriteFn = (
  archive: 'Data.mkf' | 'map.mkf',
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

// ============================================================
//  原版量出来的几何
// ============================================================

/**
 * 白字字幕的落点 @source VA 0x0044f140：
 * ```asm
 * 0044f140  push 5          ; ★ 对齐码 5 = 左对齐 + **垂直居中**（W-64 订正：不是「最多 5 行」）
 * 0044f142  push 0x82       ; y = 130
 * 0044f147  push 0xc8       ; x = 200
 * 0044f14c  push ebx        ; 串
 * 0044f14d  push 0          ; 对齐码 0
 * 0044f14e  call _rich4_draw_text
 * ```
 * ⚠️ 是 `push 0x82` 在前、`push 0xc8` 在后 ⇒ 按 `_rich4_draw_text(align, 串, x, y, 行数)`
 *   的形参顺序解出 **(x, y) = (200, 130)**。
 *   （同一段里第 ⑤ 步的头像用 `0xaa / 0x82`、第 ④ 步的气泡用 `0xdc / 0x82`，
 *   三处的 y 都是 0x82，交叉印证形参序读得对。）
 */
export const SPEECH_TEXT_AT = { x: 0xc8, y: 0x82 } as const;

/**
 * 白字的**对齐 flag** —— `_rich4_draw_text` 的最后那个实参。
 *
 * ⚠️ **2026-09-20 订正（W-64）**：先前这里叫 `SPEECH_TEXT_MAX_LINES = 5`、
 *   当成「最多 5 行」用（`Math.min(b.lines.length, 5)`）—— 那是**读错了**：
 *   `0x0044f140 push 5` 是 `draw_text` 的**对齐码**，不是行数上限。
 *
 * @source `0x0044f140 push 5` → `0x0044f14f call 0x44fabc`；`0x44fabc` 末段
 *   `lea eax,[flag-1] / jmp [eax*4 + 0x44faa0]` 是 **7 路跳表**（语义表在 `hud.ts` 文件头，
 *   已逐条实读）：**flag 5 = 水平左对齐、垂直居中** ——
 *   `y -= 文字块高 / 2`（`0x0044ff35 mov eax,ebx / sar eax,1 / sub [esp+0xb0],eax`，
 *   `ebx` = 整块文字高 + 1）。
 *   ⇒ `(200, 130)` 是文字块的**左边缘 + 垂直中心**，不是左上角。
 *   行数**不设上限**（原版按串里已有的 `\n` 分行，整块往两边均分）。
 */
export const SPEECH_TEXT_FLAG = 5;

/** 字幕的排版：字号 / 行距（原版 `_rich4_create_font(0x10, 0x101010, …)`，16 像素高）*/
export const SPEECH_TEXT_FONT_SIZE = 0x10;
export const SPEECH_TEXT_LINE_HEIGHT = 0x12;

/**
 * 表情图的落点 @source VA 0x0044f0b5 `push 0x82` / 0x0044f0ba `push 0xf0`
 * （`fcn_00456418(图, x, y, 表面)` —— x = 0xf0 = 240、y = 0x82 = 130）。
 */
export const SPEECH_EMOJI_AT = { x: 0xf0, y: 0x82 } as const;

/**
 * ★ **气泡底图**（原版的第 ④ 步）—— `Data.mkf #0x205` 的**图 6**。
 *
 * @source VA 0x0044f019..0x0044f033：
 * ```asm
 * 0044f019  push 0x82                              ; y = 130
 * 0044f01e  push 0xdc                              ; x = 220
 * 0044f023  mov  eax, [0x48bad8]                   ; Data.mkf #0x205 的资源基址
 * 0044f028  add  eax, 0x54                         ; ★ 图 6 的记录：0xc + 6×0xc = 0x54
 * 0044f02b  push eax                               ; 图
 * 0044f02c  mov  ebp, [0x48a08c]                   ; 后台缓冲表面
 * 0044f032  push ebp
 * 0044f033  call 0x456418                          ; 带透明（抠黑）贴
 * ```
 * `(0x54 − 0xc) / 0xc = 6` —— 全 exe 引用 `[0x48bad8] + 0x54` 的**只有这一处**
 * （`dialog-templates.test.ts` 扫全段钉住）。★ 2026-09-23 订正：先前这里说神明老虎机
 * （`0x004407a6 add eax,0x48`）也是图 6 —— 错，`+0x48` 是**图 5**（棕色訊息框）。
 * 实测该图 **271×199，锚点 (127,92)** ⇒ 它占屏幕 (93,38)-(364,237)，
 * 正好把台词 (200,130) 与表情图 (240,130) 罩住。
 */
export const SPEECH_PANEL = { archive: 'Data.mkf' as const, resource: 0x205, image: 6 };
export const SPEECH_PANEL_AT = { x: 0xdc, y: 0x82 } as const;

/**
 * ★ **说话人的表情头像**（原版的第 ⑤ 步）—— 落 (170, 130)。
 *
 * @source VA 0x0044f03b..0x0044f06c：
 * ```asm
 * 0044f03b  push 0x82                              ; y = 130
 * 0044f040  push 0xaa                              ; x = 170
 * 0044f045  imul eax, [esp+0x2c], 0x34             ; ★ [esp+0x2c] = 玩家下标
 * 0044f04a  mov  ecx, [eax + 0x498eb0]             ;   = load_map 里 read_mkf(map, 角色+0x1b)
 * 0044f050  mov  edx, [esp+0x30]                   ; ★ [esp+0x30] = arg2（表情号）
 * 0044f054  inc  edx                               ;   图号 = arg2 + 1
 * 0044f055  mov  eax, edx / shl eax,2 / sub eax,edx / shl eax,2   ; ×12
 * 0044f05f  add  ecx, 0xc                          ;   资源头 +0xc = 图 0 的记录
 * 0044f062  add  eax, ecx
 * 0044f06c  call 0x456418                          ; 带透明（抠黑）贴
 * ```
 * 资源号 = `0x1b + 角色`（装载点 0x00407faf `mov al,[角色] / add eax,0x1b`），
 * 即 `assets.ts` 的 `portraitResource()`。实测该资源 7 张：图 0 是 85×71 的大头像、
 * 图 1..6 是 40×34 左右的小表情 —— 与「表情号 0..3 + 1」对得上。
 */
export const SPEECH_PORTRAIT_AT = { x: 0xaa, y: 0x82 } as const;

/**
 * 原版**为了说完还原**而备份的棋盘矩形（第 ③ 步）@source VA 0x0044effa 起。
 *
 * ```asm
 * 0044effa  push 0xdc       ; 高 = 220
 * 0044efff  push 0x1b8      ; 宽 = 440
 * 0044f004  push 0x28       ; 源 y = 40
 * 0044f006  push 0         ; 源 x = 0
 * 0044f008  push 0         ; 目标面 0
 * 0044f00a  push 0x46caec  ; 目标缓冲
 * 0044f00f  call 0x451a97  ; 从棋盘面抠 440×220 → 离屏面
 * ```
 *
 * ⚠️ **这不是底板** —— 它只是第 ⑦ 步「说完之后把棋盘贴回去」用的副本。
 * 先前把它当底板用，是 `fd31598` 那块半透明深色面板的由来（已删）。
 * 名字保留是因为它确实是「台词覆盖的那块矩形」。
 */
export const SPEECH_BOX = { x: 0, y: 0x28, w: 0x1b8, h: 0xdc } as const;

/**
 * 原版的静置时长（毫秒）@source VA 0x0044f19x：`push 0x3e8 / call fcn_004544f6`
 * （那个函数是「等消息或到点」的循环，`0x3b9` = 1000 就是超时）。
 */
export const SPEECH_HOLD_MS = 0x3e8;

// ============================================================
//  一段台词
// ============================================================

/** 一段**排好版**的台词 —— 可以直接画，也可以直接断言 */
export interface SpeechBubble {
  /** 玩家下标（0..3），仅用于诊断 */
  readonly player: number;
  /** 角色号（0..11） */
  readonly character: number;
  /** 槽位号（0..26）；卡牌台词（`cardId` 非空）时它是**卡号 − 1**，见 `cardId` */
  readonly event: number;

  /**
   * 卡牌台词时给出卡号 1..30（普通台词为 `undefined`）。
   *
   * ★ 用**可选**字段而不是新类型：`SpeechBubble` 的消费方（渲染、队列、测试）
   *   都按同一形状处理；`toEqual` 也天然忽略 `undefined` 字段。
   *   两条来源的区别：
   *   - 普通台词：`event` = 角色台词表（VA `0x48084a`，27 槽）的槽位；
   *   - 卡牌台词：`event` = 卡号 − 1，文本/语音来自**另一张表**
   *     （VA `0x48123a`，见 `@rich4/data` 的 `card-lines.ts`）。
   */
  readonly cardId?: number;
  /**
   * 道具台词时给出**道具号 1..13**（普通台词为 `undefined`）。
   *
   * 与 `cardId` 同一个理由：工具台词的文本/语音来自**另一张表**
   * （`@rich4/data` 的 `TOOL_LINES`，原版 `_tool_strings` @0x480d5a），
   * 而 `event` 这时是 `道具号 − 1`。
   */
  readonly toolId?: number;
  /** 说话人的**完整名字**（如「金貝貝」）*/
  readonly speaker: string;
  /**
   * ★ **表情号**（= 原版 `player_say` 的第 2 个实参 `arg2`）—— 头像图号 = 它 + 1。
   *
   * @source 0x0044f050 `mov edx,[esp+0x30] / inc edx`（`[esp+0x30]` 在两次 `push`
   *   之后正是 `arg2`）、贴图 0x0044f06c；各调用点实参见
   *   `docs/tasks/speech-callsites.md` 的「实参」列第 2 项。
   *
   * ⚠️ **W-50 只通了「画」这一半**：`speech.ts` 的探测器还没把各自的 `arg2`
   *   填进 `SayEvent`（那是并行的另一张卡），故这里默认 0。
   *   见 `speech.ts` 的 `SayEvent.expression?` 与 `docs/escalations.md` 的 E-18。
   */
  readonly expression: number;
  /** 字幕的行（已按 `\n` 拆好、去掉了空行）*/
  readonly lines: readonly string[];
  /** 语音号（`Speaking.mkf`）；金貝貝那种 `@DD` 串没有可播的语音时为 null */
  readonly voice: number | null;
  /** 表情图号（`Data.mkf #0x207`）；普通台词为 null */
  readonly emoji: number | null;
  /** 字幕落点 */
  readonly textAt: { readonly x: number; readonly y: number };
  /** 表情落点 */
  readonly emojiAt: { readonly x: number; readonly y: number };
  /** 显示多久（毫秒）*/
  readonly holdMs: number;
}

/** 把一段台词按 `\n` 拆成字幕行；丢掉空行（原版按行数上限逐行画）*/
export function bubbleLines(text: string): string[] {
  return text.split('\n').filter((l) => l !== '');
}

/**
 * 一条 `SayEvent` + 状态 → 一段可直接画的台词；角色号/槽位越界时返回 `null`。
 *
 * ⚠️ 越界**不抛**：`speechLine()`（`@rich4/data`）对越界抛 `RangeError`，
 *   那是给「表坏了」用的；表现层不该因为一份坏状态把整局炸掉（与
 *   `speech.ts` 的 `speechResourceFor` 同一条规矩）。
 */
export function speechBubbleOf(
  ev: SayEvent,
  character: number,
  speaker: string,
): SpeechBubble | null {
  // ★ 字面串那一种（`SayEvent.text`，如魔法屋的「？？？...」）：不查角色台词表；
  //   串首有 `#NNNN` 才放语音（`0x0044f07c cmp byte [ebx], 0x23`），否则只画字。
  if (ev.text !== undefined) {
    const { voice, rest } = parseVoiceCode(ev.text);
    return {
      player: ev.player,
      character,
      event: ev.event,
      speaker,
      expression: ev.expression ?? 0,
      lines: bubbleLines(rest),
      voice,
      emoji: null,
      textAt: SPEECH_TEXT_AT,
      emojiAt: SPEECH_EMOJI_AT,
      holdMs: SPEECH_HOLD_MS,
    };
  }
  let line: SpeechLine;
  try {
    line = speechLine(character, ev.event);
  } catch {
    return null;
  }
  const [emojiCode, text] = line;
  // 金貝貝那一列整列都是 `@DD` —— 文本字段就是那三个字符，没有可读的字幕
  const isEmoji = emojiCode !== null;
  return {
    player: ev.player,
    character,
    event: ev.event,
    speaker,
    // ★ 表情号来自 `SayEvent.expression`（B 卡正在逐探测器填）；缺席时按 0 画
    //   —— 原版 104 个调用点里传 0 的占多数。TODO(W-50)：等 B 卡填完，
    //   这里不再是默认值，`speech.test.ts` 里逐调用点对照。
    expression: ev.expression ?? 0,
    lines: isEmoji ? [] : bubbleLines(text),
    // ★★ 语音号：`1050 + 27×角色 + 槽位`（`speechIndex()`）**对 324 条全部成立**，
    //   **包括金貝貝（角色 11）那 27 条**。
    //
    //   此前写成 `isEmoji ? null : speechIndex(...)`，于是金貝貝的 27 条**永远不播**。
    //   原版语义是「**播语音 + 画表情**」两件事，不是二选一 ——
    //   `@source 0x0044f07c`–`0x0044f136` 的 `player_say`：
    //   ```asm
    //   0044f07c  cmp  byte ptr [ebx], 0x23   ; 首字符 '#'
    //   0044f081  mov  esi, 5                 ; 前缀长 5
    //   0044f08d  cmp  byte ptr [edx], 0x40   ; 跳过 5 字符后是 '@'（表情图号）
    //   0044f0e8  cmp  esi, 5
    //   0044f0ed  …                           ; 解析 4 位十进制
    //   0044f136  call 0x45441a               ; ★ play_speech(值) —— 照样播
    //   ```
    //   实测：角色 11 第 0 项 = `#1347@04`，而 `1050 + 11×27 + 0 = 1347` ✓。
    //
    //   ⚠️ 但**这只是"角色台词表"那 324 条**。文本里其余 610 个低于 1050 的
    //     `#NNNN`（如 `#0004歡迎下次再來！`）走的是**别的**文字入口，
    //     它们目前**只被剥前缀、不播语音** —— 那是本簇剩下的工作（见差距报告 D）。
    voice: speechIndex(character, ev.event),
    emoji: isEmoji ? speechEmojiImage(emojiCode) : null,
    textAt: SPEECH_TEXT_AT,
    emojiAt: SPEECH_EMOJI_AT,
    holdMs: SPEECH_HOLD_MS,
  };
}

/**
 * **逐卡的「表情号」**（= `player_say` 的第 2 个实参 `arg2`，头像图号 = 它 + 1）。
 *
 * ★ W-50 §1.2 第 1 条要求的取值 —— 已**逐卡**回 exe 核完（2026-09-19）。
 *   判据 = 每张卡的效果函数里那一处**读自己槽位**的调用
 *   （`mov r, [eax + 0x48123a + 4×(卡号−1)]` → `push r` → `push <arg2>` → `push 玩家`
 *   → `call 0x44ef41`）；`arg2` 就是紧帖在 `push 玩家` **前面**那一条 `push <立即数>`。
 *
 * | 卡号 | arg2 | `push <arg2>` 的地址 |
 * |---|---|---|
 * | 1 均富 | 3 | `0x00442115` |
 * | 2 均貧 | 3 | `0x00442222` |
 * | 3 購地 | 3 | `0x0044242c` |
 * | 4 換地 | 3 | `0x00442774`（另一支 `0x00442734 jmp 0x442774` 汇到同一条）|
 * | 5 換屋 | 3 | `0x00442c41` |
 * | 6 | 3 | `0x00442fb8` |
 * | 7 改建 | 3 | `0x00443117` |
 * | 8 | 3 | `0x004432f5` |
 * | 9 天使 | 3 | `0x00443536` |
 * | 10 惡魔 | **0** | `0x0044374e` |
 * | 11 怪獸 | **0** | `0x00443986` |
 * | 12 拆除 | **0** | `0x00443b87` |
 * | 13 搶奪 | 3 | `0x00443e99` |
 * | 14 停留 | 3 | `0x00443fff` |
 * | 15 冬眠 | 3 | `0x00444127` |
 * | 16 夢遊 | 3 | `0x0044424a` |
 * | 17 陷害 | 3 | `0x0044452b` |
 * | 18–21 | — | **被动卡**，`IMPLEMENTED_CARD_IDS` 里没有它们 ⇒ 本表不列（永不播）|
 * | 22 送神符 | **0** | 汇合点 `0x0044305e`（`0x00444d15 jmp 0x44305e`）|
 * | 23 請神符 | **0** | `0x00444e81` |
 * | 24 紅卡 | **0** | `0x00444f58` |
 * | 25 黑卡 | **0** | `0x00445070` |
 * | 26 | **0** | `0x00445262` |
 * | 27 | **0** | `0x00445499` |
 * | 28 | **0** | `0x004455fb` |
 * | 29 | 3 | `0x0044577f` |
 * | 30 烏龜 | 3 | `0x0044595e` |
 *
 * ⚠️ 取值**没有**别的规律可推（不是「前 17 张都 3」：10/11/12 是 0；也不是
 *   「被动卡都 0」：29/30 是 3）—— 所以是**逐卡抄**的，不要改写成条件式。
 *   复现：`python3 tools/disasm.py card <卡号> 1400`，在输出里找
 *   `0x48123a + 4×(卡号−1)` 那一行，往后看三条 `push`。
 */
export const CARD_LINE_EXPRESSION: Readonly<Record<number, number>> = {
  1: 3,
  2: 3,
  3: 3,
  4: 3,
  5: 3,
  6: 3,
  7: 3,
  8: 3,
  9: 3,
  10: 0,
  11: 0,
  12: 0,
  13: 3,
  14: 3,
  15: 3,
  16: 3,
  17: 3,
  22: 0,
  23: 0,
  24: 0,
  25: 0,
  26: 0,
  27: 0,
  28: 0,
  29: 3,
  30: 3,
};

/**
 * **用卡时角色说的那一句** —— 来自卡牌台词表（`@rich4/data` 的 `CARD_LINES`）。
 *
 * @source 每张可主动使用的卡都在函数体里读自己那一槽并调 `player_say`：
 * ```asm
 * ; 送神符 @0x444d0e（26 张卡各一处，槽号恒 = 卡号-1）
 * 00444d0e  mov  ebp, dword ptr [eax + 0x48128e]   ; 0x48123a + 4*21
 * 00444d14  push ebp                               ; 第 3 参 = 台词
 * 00444d15  jmp  0x44305e                          ; → 0x44305e `push 0` / `push 玩家` / `call player_say`
 * ```
 * ★ **表情号逐卡取值见 `CARD_LINE_EXPRESSION`**（2026-09-19 逐卡核完，
 *   原先「暂时填 0」的近似已撤，E-18 随之结案）。
 *
 * 与 `speechBubbleOf` 的差别只有「表不同」：文本/语音/表情的处理完全同构
 * （金貝貝那一列同样是 `@DD`：**照样播语音**，另画一张表情图）。
 */
export function cardLineBubbleOf(
  player: number,
  character: number,
  speaker: string,
  cardId: number,
): SpeechBubble | null {
  let line: SpeechLine;
  try {
    line = cardLine(character, cardId);
  } catch {
    return null;
  }
  const [emojiCode, text] = line;
  const isEmoji = emojiCode !== null;
  return {
    player,
    character,
    event: cardId - 1,
    cardId,
    speaker,
    // ★ W-50 §1.2 第 1 条：逐卡的 `arg2`，判据与逐卡地址见 `CARD_LINE_EXPRESSION`
    expression: CARD_LINE_EXPRESSION[cardId] ?? 0,
    lines: isEmoji ? [] : bubbleLines(text),
    // @source 串头 `#NNNN`：`426 + 52×角色 + (卡号-1)`，360 条无例外
    voice: cardLineVoice(character, cardId),
    emoji: isEmoji ? speechEmojiImage(emojiCode) : null,
    textAt: SPEECH_TEXT_AT,
    emojiAt: SPEECH_EMOJI_AT,
    holdMs: SPEECH_HOLD_MS,
  };
}

/**
 * 一条**道具台词**（第十一份試玩回報 #3）→ 一段可直接画的台词。
 *
 * @source 原版 13 件道具在用的那一下都 `player_say(角色, 0, _tool_strings[角色][道具号−1])`
 *   （路障 `0x00446bcc` / 地雷 `0x00446caa` / 定時炸彈 `0x00446d8b`，各函式**开头**、
 *   `cmp [who_plays],1` **之前** ⇒ **电脑也说**）。
 *   表在 `0x480d5a`（12 行 × 26 列，行距 0x68），前 13 列 = 道具 1..13。
 *
 * ⚠️ 与卡牌台词不同：**语音号是散列的**（`#0236`/`#0237`/…），不像角色台词表能用公式还原，
 *   所以 `TOOL_LINES` 的串**保留 `#NNNN` 前缀**，这里用 `parseVoiceCode` 现剥。
 */
export function toolLineBubbleOf(
  player: number,
  character: number,
  speaker: string,
  toolId: number,
): SpeechBubble | null {
  const line = toolLine(character, toolId);
  if (line === null) return null;
  const [emojiCode, raw] = line;
  const parsed = parseVoiceCode(raw);
  const isEmoji = emojiCode !== null;
  return {
    player,
    character,
    event: toolId - 1,
    toolId,
    speaker,
    expression: 0,
    lines: isEmoji ? [] : bubbleLines(parsed.rest),
    voice: parsed.voice,
    emoji: isEmoji ? speechEmojiImage(emojiCode) : null,
    textAt: SPEECH_TEXT_AT,
    emojiAt: SPEECH_EMOJI_AT,
    holdMs: SPEECH_HOLD_MS,
  };
}

// ============================================================
//  队列（表现层状态，不进 GameState）
// ============================================================

/**
 * 台词队列 —— 原版 `_rich4_player_say` 是**一句播完再返回**，
 * 本引擎的 `playSoundFor` 一口气派出去，于是这里排队逐段演，不叠着显示。
 *
 * ★ 纯数据结构 + 纯函数：`push` / `tick` / `current` 都只碰自己这几个字段，
 *   时间由调用方传 `now` 进来（**不读 `performance.now()`**，故能单测）。
 */
export class SpeechQueue {
  private readonly items: SpeechBubble[] = [];
  private shownAt = 0;
  /** 当前这一段额外撑长的毫秒数（等语音播完），换段时归零 */
  private extraHoldMs = 0;

  /** 排入若干段（保持顺序）；返回新排入的段数 */
  push(bubbles: readonly SpeechBubble[], now: number): number {
    if (bubbles.length === 0) return 0;
    const wasEmpty = this.items.length === 0;
    this.items.push(...bubbles);
    if (wasEmpty) this.shownAt = now;
    return bubbles.length;
  }

  /**
   * 到点就丢掉当前那段；返回「有没有东西变了」（调用方据此决定要不要重画）。
   *
   * ⚠️ 只丢**一段** —— 原版是 `fcn_004544f6` 一次一段地等，不是一次性清空。
   */
  tick(now: number): boolean {
    const head = this.items[0];
    if (head === undefined) return false;
    if (now - this.shownAt < this.hold()) return false;
    this.items.shift();
    this.shownAt = now;
    this.extraHoldMs = 0;
    return true;
  }

  /**
   * 当前这一段还要显示多久（毫秒）。
   *
   * ★ 原版 `_rich4_player_say` 是**先播语音、播完再等 1000 ms**
   *   （`fcn_00454559` 那段「还有没有声音在响」的循环 + 之后 `0x3e8` 的等待）。
   *   本引擎两件事并行，所以长句会出现「字先没了、声音还在」——
   *   调用方拿到语音时长后调 `extend()` 把这一段撑长即可。
   */
  hold(): number {
    const head = this.items[0];
    if (head === undefined) return 0;
    return head.holdMs + this.extraHoldMs;
  }

  /**
   * 把当前这一段的显示时间**再撑长** `ms`（用来等它那句语音播完）。
   *
   * ⚠️ 只加不减；队列空时是空操作。
   */
  extend(ms: number): void {
    if (this.items.length === 0) return;
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.extraHoldMs = Math.max(this.extraHoldMs, Math.trunc(ms));
  }

  /** 当前这一段已经显示了多久（毫秒）；队列空时为 0 */
  elapsed(now: number): number {
    return this.items.length === 0 ? 0 : Math.max(0, now - this.shownAt);
  }

  /** 此刻该显示的那一段；队列空时为 null */
  current(): SpeechBubble | null {
    return this.items[0] ?? null;
  }

  /** 队列里还剩几段（含正在显示的那一段）*/
  get length(): number {
    return this.items.length;
  }

  /** 清空（换局 / 关屏）*/
  clear(): void {
    this.items.length = 0;
    this.shownAt = 0;
  }
}

// ============================================================
//  绘制
// ============================================================

export interface SpeechDrawEnv {
  readonly ctx: CanvasRenderingContext2D;
  /** 取图出口（`main.ts` 的 `spriteNow`）*/
  readonly sprite: BubbleSpriteFn;
  /** 画字的字体串（`main.ts` 的 `font()`）*/
  readonly font: (size: number) => string;
}

/**
 * ★ **锚点落点绘制** —— `(x, y)` 是图的 `anchorX/anchorY` 所在处
 * （= 原版那句 `to_left = x − src->x`）。
 *
 * @source `fcn_00456418` VA 0x00456418 → `draw_non_zero_image_in_rect`
 *   （**带透明**：`push 0` 那个第 5 参 = 透明色 0 = 抠黑）。
 *   与 `shop-screen.ts` 的 `drawAnchored` / `god-slot.ts` 的 `anchored` 同一条语义
 *   —— 三处各写一份小 helper（屏幕模块之间不互相 import，免得绕出循环依赖），
 *   语义必须保持一致；改一处时另两处要一起看。
 */
function drawAnchored(ctx: CanvasRenderingContext2D, s: Sprite | null, x: number, y: number): void {
  if (s === null) return;
  ctx.drawImage(s.bitmap, x - s.anchorX, y - s.anchorY);
}

/**
 * 画一段台词，**次序照原版**：④ 气泡底图 → ⑤ 说话人头像 → ⑥ 字幕/表情图。
 *
 * ★ 调用方必须已经 `stageCtx.save()/translate()` 到**屏幕坐标**（棋盘原点），
 *   因为这三步在原版里用的就是屏幕坐标（0xdc/0x82、0xaa/0x82、0xc8/0x82）。
 *
 * ⚠️ ④ ⑤ ⑥ 三张图原来都是**黑底**（原版走的都是带透明的 `fcn_00456418`），
 *   所以取图时一律 `colorKeyBlack = true`。
 *
 * ⚠️ 金貝貝（角色 11）「只出表情图、不出字」的那条判据在 **⑥**（`b.emoji !== null`）；
 *   ④ ⑤ 排在它**之前** —— 故金貝貝那一句**照样有气泡与头像**（原版就是这么画的）。
 */
export function drawSpeechBubble(b: SpeechBubble, env: SpeechDrawEnv): void {
  const { ctx, sprite, font } = env;

  // ── ④ 气泡底图（原版第 ④ 步，@source 0x0044f019..0x0044f033）──
  //
  // ★★ 2026-09-19 W-50：**这一张就是试玩说的「背景对话框」**。
  //   此前这里是 `fd31598` 加的「半透明深色底板 + 浅边」，它建立在一个错读上
  //   （把第 ③ 步的**备份**当成了底板，见本文件头的订正 1）—— 已删。
  drawAnchored(
    ctx,
    sprite(SPEECH_PANEL.archive, SPEECH_PANEL.resource, SPEECH_PANEL.image, true),
    SPEECH_PANEL_AT.x,
    SPEECH_PANEL_AT.y,
  );

  // ── ⑤ 说话人的表情头像（原版第 ⑤ 步，@source 0x0044f03b..0x0044f06c）──
  //
  //   资源 = `map.mkf #(0x1b + 角色号)` = `portraitResource(character)`；
  //   图号 = **表情号 + 1**。
  drawAnchored(
    ctx,
    sprite('map.mkf', portraitResource(b.character), b.expression + 1, true),
    SPEECH_PORTRAIT_AT.x,
    SPEECH_PORTRAIT_AT.y,
  );

  // ── ⑥ 字幕 / 表情图（原版第 ⑥ 步）──
  if (b.emoji !== null) {
    // `@DD` 那一支：只贴 `Data.mkf #0x207` 的表情图，**不画字** @source 0x0044f0b5..0x0044f0e0
    drawAnchored(ctx, sprite('Data.mkf', 0x207, b.emoji, true), b.emojiAt.x, b.emojiAt.y);
  } else if (b.lines.length > 0) {
    // 白字 + 黑描边（原版 `_rich4_create_font(0x10, 0x101010, …)` + `draw_text(串,200,130,5)`）
    ctx.save();
    ctx.font = font(SPEECH_TEXT_FONT_SIZE);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#101010';
    ctx.fillStyle = '#ffffff';
    // ★★ W-64：`SPEECH_TEXT_FLAG = 5` = **垂直居中** —— `(200,130)` 是整块文字的
    //   垂直中心（原版 `0x0044ff35 mov eax,ebx / sar eax,1 / sub [esp+0xb0],eax`，
    //   `ebx` = 整块文字高 + 1；`sar` 是**算术**右移 ⇒ 用 `>> 1` 而不是 `/ 2`）。
    //   行数**不设上限**：原版按串里已有的换行分行，整块往两边均分。
    const blockH = b.lines.length * SPEECH_TEXT_LINE_HEIGHT;
    const top = b.textAt.y - (blockH >> 1);
    for (let i = 0; i < b.lines.length; i++) {
      const y = top + i * SPEECH_TEXT_LINE_HEIGHT;
      const text = b.lines[i]!;
      ctx.strokeText(text, b.textAt.x, y);
      ctx.fillText(text, b.textAt.x, y);
    }
    ctx.restore();
  }
}

/**
 * ★ 第十四份：被动卡用完之后**回的那一句** —— 卡牌台词表的另两槽：
 *   - 免費卡（20）→ 地主说槽 79，表情 1（`0x00444b8e mov edi,[eax + 0x481376]` / `0x00444b95 push 1`）；
 *   - 嫁禍卡（19）→ 替死鬼说槽 78，表情 2（`0x00444a41 mov edi,[eax + 0x481372]` / `0x00444a48 push 2`）。
 *   其余卡没有这一句 ⇒ null。
 */
export function cardAnswerBubbleOf(
  player: number,
  character: number,
  speaker: string,
  cardId: number,
): SpeechBubble | null {
  const free = cardId === 20;
  if (!free && cardId !== 19) return null;
  const line = (free ? FREE_CARD_ANSWER_LINES : SCAPEGOAT_ANSWER_LINES)[character];
  if (line === undefined) return null;
  const [emojiCode, text] = line;
  const isEmoji = emojiCode !== null;
  return {
    player,
    character,
    event: free ? FREE_CARD_ANSWER_SLOT : SCAPEGOAT_ANSWER_SLOT,
    speaker,
    expression: free ? 1 : 2,
    lines: isEmoji ? [] : bubbleLines(text),
    voice: free ? freeCardAnswerVoice(character) : scapegoatAnswerVoice(character),
    emoji: isEmoji ? speechEmojiImage(emojiCode) : null,
    textAt: SPEECH_TEXT_AT,
    emojiAt: SPEECH_EMOJI_AT,
    holdMs: SPEECH_HOLD_MS,
  };
}
