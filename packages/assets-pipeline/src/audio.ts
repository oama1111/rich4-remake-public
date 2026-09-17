/*
 * 音频资源
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 好消息：原版的音频**不需要解码**。
 *   `Effect.mkf`（115 项音效）与 `Speaking.mkf`（1374 项角色语音）
 *   里每一项都是**完整的 RIFF/WAVE 文件**，从 mkf 里取出来就能直接喂给
 *   浏览器的 `decodeAudioData`。
 *
 *   背景音乐更简单：25 首是散落在游戏目录里的标准 `.mid` 文件，
 *   播放顺序写在 `Midi.txt` 里（见 `MIDI_PLAYLIST`）。
 *
 * ⚠️ MIDI **浏览器不能原生播放**。现已自带解析（见 `midi.ts`）与
 *   一个 WebAudio 合成器（`@rich4/client` 的 music.ts）：
 *   旋律、节奏、时值是数据，做得到精确；**音色做不到**——
 *   那取决于当年那块声卡的 GM 波表，同一份 .mid 在不同机器上本就不同。
 *   要真还原得另接 SoundFont 播放器并让用户自备音色库。
 */

/** RIFF/WAVE 文件头长度：'RIFF' + 大小 + 'WAVE' */
const RIFF_HEADER = 12;

/** 这段数据是不是一个 RIFF/WAVE 文件 */
export function isWave(data: Uint8Array): boolean {
  if (data.length < RIFF_HEADER) return false;
  return (
    data[0] === 0x52 && // R
    data[1] === 0x49 && // I
    data[2] === 0x46 && // F
    data[3] === 0x46 && // F
    data[8] === 0x57 && // W
    data[9] === 0x41 && // A
    data[10] === 0x56 && // V
    data[11] === 0x45 // E
  );
}

export interface WaveInfo {
  /** 声道数 */
  channels: number;
  /** 采样率 */
  sampleRate: number;
  /** 位深 */
  bitsPerSample: number;
  /** RIFF 头里声明的长度（= 文件长 − 8） */
  declaredSize: number;
}

export class WaveFormatError extends Error {}

/**
 * 读出 WAVE 的格式块。
 *
 * 只解 `fmt ` 这一块——播放交给浏览器，这里读格式是为了能在管线里
 * 做体检（例如确认所有音效采样率一致、没有被截断的文件）。
 */
export function readWaveInfo(data: Uint8Array): WaveInfo {
  if (!isWave(data)) throw new WaveFormatError('不是 RIFF/WAVE');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const declaredSize = view.getUint32(4, true);

  // 逐块找 'fmt '
  let off = RIFF_HEADER;
  while (off + 8 <= data.length) {
    const id = String.fromCharCode(data[off]!, data[off + 1]!, data[off + 2]!, data[off + 3]!);
    const size = view.getUint32(off + 4, true);
    if (id === 'fmt ') {
      return {
        channels: view.getUint16(off + 10, true),
        sampleRate: view.getUint32(off + 12, true),
        bitsPerSample: view.getUint16(off + 22, true),
        declaredSize,
      };
    }
    // 块长为奇数时有 1 字节补齐
    off += 8 + size + (size & 1);
  }
  throw new WaveFormatError('WAVE 里找不到 fmt 块');
}

/**
 * 音效编号 → 它在原版里什么时候响。
 *
 * ★ 这些是**从调用点反查出来的**：原版播放音效走
 *   `play_sound(id)` @ VA 0x004549cf，共 22 处调用。把每处的
 *   立即数参数与所在函数对上，就得到下表。
 *
 * ⚠️ 只列**能确定所在函数**的那几个。其余调用点的参数是寄存器
 *   （运行时决定）或所在函数尚未定名，故不猜。
 *
 * ★ **编号 = `Effect.mkf` 的资源号**已取证（2026-09-16）：
 *   `rich4_init_sound_effect_info`（VA 0x00454176）把一个 8 字节一项的表
 *   从头部逐项读下去 —— `mov ecx, [ebx]` / `read_mkf(Effect.mkf, ecx)` /
 *   `mov [ebx + 4], eax`，读到 `-1` 停：
 * ```asm
 * 00454186  mov ecx, [ebx]              ; ★ 表项 +0 = Effect.mkf 的资源号，不是别的编号
 * 00454188  cmp ecx, -1 / je 结束
 * 00454192  mov edi, [0x48a058]         ; Effect.mkf 的档案句柄
 * 00454199  call _read_mkf
 * 004541ac  mov [ebx + 4], eax          ; +4 = 解出来的声音对象
 * ```
 *   所以 `sound.play('Effect.mkf', [表项])` 就是原版那一下。
 */
export const SOUND_IDS = {
  /** 破产 @source VA 0x0040d1cb `push 5`，在 player_bankrupt 内 */
  BANKRUPT: 5,
  /** 落在银行 @source VA 0x0043674d `push 4`，在银行落点 0x00436668 内 */
  BANK: 4,
  /** 樂透开奖 @source VA 0x004317a7 `push 8`，在开奖流程 0x00431712 内 */
  LOTTERY_DRAW: 8,
  /** 拍卖 @source VA 0x0043c6ca `push 5`，在 run_auction 0x0043bde5 内 */
  AUCTION: 5,
  /**
   * 標題／選單的**悬停**音 —— 音效 **0**。
   * @source `rich4_ui_main.asm` 的 WM_MOUSEMOVE 分支：
   *   `push 0 / push ref_0048231a / call rich4_play_sound_effect`
   *   而 `play_sound_effect(ptr, k)` 取 `[ptr]` 当音效号，`[0x48231a] = 0`。
   */
  TITLE_HOVER: 0,
  /**
   * 標題／選單的**确认（点击）**音 —— 音效 **1**。
   * @source `rich4_ui_main.asm` 的 WM_LBUTTONDOWN 分支：
   *   `push 0 / push ref_00482322 / call rich4_play_sound_effect`，`[0x482322] = 1`。
   */
  TITLE_CLICK: 1,
  /**
   * **使用道具 1（機器娃娃）**那一下的音 —— 音效 **38**。
   *
   * ★ 它**不在** `Effect.mkf` 单独的一张表里，而是移动音效表 `0x48234a` 的
   *   **第 9 项**（`0x48234a + 9×8 = 0x482392`，表里的值就是 38）。
   *   原版给娃娃单开了一路：`fcn_0040dd1f` 里 `cmp edx, 8 / jge 0x40deb9`
   *   （actor 8 = 機器娃娃），那一支**写死**用第 9 项而不是交通方式那几项：
   *
   * ```asm
   * 0040deb9  mov  esi, 9
   * 0040debe  mov  dword [0x48baf8], esi        ; 固定走 9 步
   * 0040dec4  mov  byte [actor×0x34 + 0x498ea2], 1
   * 0040decb  mov  dword [0x4749d4], esi        ; ★ 记下索引 9 —— 走完那一下要用它 Stop
   * 0040ded1  push 1
   * 0040ded3  mov  eax, 0x48234a
   * 0040ded8  add  eax, 0x48                   ; ★ +9×8 = 表项 9
   * 0040dedb  push eax
   * 0040dedc  call rich4_play_sound_effect      ; @ VA 0x004542ce
   * ```
   *
   * 「走完把它 Stop」在 `fcn_0040d7c4` 的 state 1（`[0x48baf8] == 0`）：
   * `eax = [0x4749d4]×8 + 0x48234a; call fcn_004542e9`（VA 0x0040d8dc..0x40d8ea，
   * `fcn_004542e9` = IDirectSoundBuffer::Stop）—— 正是 0x40decb 存下的那个 9，
   * 也就是**同一个 38 号**。这条闭环是「索引 9 = 38」最硬的旁证。
   *
   * ⚠️ **娃娃走子途中没有逐格音效**：那条逐格的路（`fcn_0040d7c4` state 2 的
   *   交通方式取表）只由**玩家**的掷骰那一步进入（写 state 2 的唯一一处在
   *   `fcn_0040dd1f` 的 actor < 4 分支，VA 0x0040dd7e），娃娃那一支起步就是
   *   state 1，且逐格推进的 `fcn_0040c05c` 里没有任何放音调用。所以娃娃
   *   **一趟只有这一声**（登记在 `docs/deviations/Q-DOLL-1.md`）。
   */
  DOLL: 38,
  /**
   * **放置類道具落地**那一声 —— 三件各一个号，连号排在 33/34，
   * 定時炸彈借用 10（与掷骰同一号）。
   *
   * @source 三个 `use_tool_*` 函数在 `place_object` + `animate_object` **之后**
   *   （动画播完才响）各 `push ref_004823xx / call rich4_play_sound_effect`：
   * ```asm
   * rich4_tool_luzhang.asm         push 0x48236a / call 0x4542ce   ; VA 0x00446c58
   * rich4_tool_dilei.asm           push 0x482372 / call 0x4542ce   ; VA 0x00446d39
   * rich4_tool_dingshizhadan.asm   push 0x48235a / call 0x4542ce   ; VA 0x00446e1a
   * ```
   *   `play_sound_effect(ptr, k)` 取 `[ptr]`（VA 0x004542d8），而音效表基址
   *   `0x48231a` 是**8 字节一项**（+0 资源号、+4 运行时填入的声音对象，
   *   @source `rich4_init_sound_effect_info` VA 0x00454176）：
   *
   * | 表项 | 表项地址 | `[表项]` | 用处 |
   * |---|---|---|---|
   * | 8 | 0x48235a | **10** | 定時炸彈落地（也是掷骰那一下，VA 0x0041962a）|
   * | 10 | 0x48236a | **33** | 路障落地 |
   * | 11 | 0x482372 | **34** | 地雷落地 |
   *
   * ⚠️ 先前引擎在这条路上**一声都没放**（只放了拾取目标那一下的音效 2），
   *   故需求方听到的「提示音错误」= 少了这三个号。见 `docs/deviations/Q-TOOL-1.md`。
   */
  PLACE_BARRIER: 33,
  PLACE_MINE: 34,
  PLACE_TIMEBOMB: 10,
} as const;

/**
 * 放置類道具（路障 2 / 地雷 3 / 定時炸彈 4）→ 它落地时的音效号。
 *
 * @source 见 `SOUND_IDS.PLACE_*`：三个 `use_tool_*` 的 `push ref_004823xx`
 *   （VA 0x00446c58 / 0x00446d39 / 0x00446e1a）。
 *   道具号与物件种类的对应见 `@rich4/core` 的 `PLACEMENT_TOOLS`（2→16、3→17、4→18）。
 */
export const PLACE_TOOL_SOUND: ReadonlyMap<number, number> = new Map([
  [2, SOUND_IDS.PLACE_BARRIER],
  [3, SOUND_IDS.PLACE_MINE],
  [4, SOUND_IDS.PLACE_TIMEBOMB],
]);

/**
 * 走一格时的**移动音效**，下标 = 玩家的 `traffic_method`（`player+0x11`）。
 *
 * @source VA 0x0040d9da 起（走完一格、重置走路帧之前）：
 * ```asm
 * cmp byte [0x498ea1 + 玩家号], 0
 * je short loc_0040d9da           ; == 0 → 按交通方式取
 * mov dword [0x4749d4], 0xf       ; 否则用索引 15（另一支，见下）
 * …
 * loc_0040d9da:
 * mov al, byte [player + 0x11]    ; traffic_method
 * and al, 3
 * add eax, 0xb                    ; → 11..14
 * mov [0x4749d4], eax
 * loc_0040d9f2:
 * eax = [0x4749d4] * 8 + 0x48234a ; ★ 8 字节一项的音效表
 * call rich4_play_sound_effect(表项, 1)
 * ```
 * 表 `0x48234a` 的 11..14 项 = **44 / 45 / 46 / 53**，实测时长恰好印证：
 * 走路 0.22 s（短脚步）、機車 1.50 s、汽車 2.72 s（引擎循环）、船 0.56 s。
 * （表里 0..3 项是 7/9/10/32，时长 0.09/0.02/0.14/1.46 s —— 那是别的音效，
 *   别把它们当成移动声。）
 *
 * ⚠️ 同一处在 `[0x498ea1 + 玩家号] != 0` 时改播索引 15（音效 47，0.58 s）——
 *   `[0x498ea1]` 的语义（精灵刚重载？）未查实，本引擎只用按交通方式那一支。
 */
export const MOVE_SOUND: readonly number[] = [44, 45, 46, 53];

/**
 * 掷骰子的音效 —— 原版在滚骰子那支函数里**连播两次**
 * （VA 0x004195ed 与 0x00419628 各 `push 0x48235a / call play_sound_effect`，
 *   中间夹着一次绘制）。`0x48235a` 是音效表 `0x48234a` 的**索引 2** → 音效 **10**，
 * 时长 0.14 s。
 */
export const DICE_SOUND = 10;

/**
 * 骰子的落点 —— 以棋盘局部 (0x88+0x55, 0x30+0x91) = (221, 193) 为基准，
 * 再按**屏幕朝向**（`(dir + 8 − view) & 7`）加一个偏移。
 *
 * @source VA 0x004195d6 起：
 * ```asm
 * edi = [eax*8 + 0x475224] + 0x88    ; eax = 屏幕朝向
 * ebp = [eax*8 + 0x475228] + 0x30
 * … 绘制时 (edi + 0x55, ebp + 0x91)
 * ```
 * 即骰子落在棋盘中央附近、朝玩家**面朝的那一侧**偏一点 —— 就是「人物把骰子扔出去」。
 * 八向偏移实测 = (4,12) (12,12) (8,6) (−4,−6) (−12,−12) (−24,−12) (−20,−6) (−12,6)。
 */
export const DICE_AT_BASE = { x: 0x88 + 0x55, y: 0x30 + 0x91 } as const;
export const DICE_AT: readonly (readonly [number, number])[] = [
  [4, 12], [12, 12], [8, 6], [-4, -6], [-12, -12], [-24, -12], [-20, -6], [-12, 6],
];

/**
 * 背景音乐清单，顺序取自游戏目录里的 `Midi.txt`。
 *
 * ⚠️ 文件名在磁盘上是小写（`midi01.mid`），`Midi.txt` 里是大写。
 *   在大小写敏感的文件系统上要按实际文件名取。
 */
/**
 * **按屏取曲**用的那张表 —— 原版 `fcn_004549cf(id)` 查的就是它。
 *
 * @source `rich4_media_music.asm:354`（VA 0x004549cf）：
 * ```asm
 * cmp  byte [0x49715a], 0 / je 直接返回     ; ★ 配置里关了配乐就整条不做
 * ebx = id * 4
 * ecx = dword [ebx + 0x47e793]              ; ★ 13 项**文件名表**
 * sprintf(buf, "open sequencer!%s alias mid", ecx)   ; MCI 打开那个 MIDI
 * ```
 * 表 `0x47e793` 的 13 项依次指向 `MIDI01.MID` … `MIDI13.MID`（每项 11 字节，实测）。
 * ⇒ **`id` 是 0 基，文件名是 `id + 1`**（例：月結屏的 `fcn_004549cf(9)` → `MIDI10.MID`）。
 *
 * ⚠️ 与 `MIDI_PLAYLIST` **不是一回事**：那个是游戏目录 `Midi.txt` 的播放清单顺序，
 *   用于「整张清单顺序播」；这一张是**每屏一支**的曲目号。
 *   全 exe 有 22 处 `call fcn_004549cf`（新游戏/魔法屋/商店/小游戏/拍賣/銀行/破产…），
 *   本引擎**尚未**按屏取曲，见 `docs/deviations/T-041.md` 的 D-MONTHLY-5。
 */
export const BGM_FILES: readonly string[] = [
  'MIDI01.MID', 'MIDI02.MID', 'MIDI03.MID', 'MIDI04.MID', 'MIDI05.MID',
  'MIDI06.MID', 'MIDI07.MID', 'MIDI08.MID', 'MIDI09.MID', 'MIDI10.MID',
  'MIDI11.MID', 'MIDI12.MID', 'MIDI13.MID',
];

/** `fcn_004549cf(id)` 要打开的那个文件名（越界返回 `null`） */
export function bgmFileFor(id: number): string | null {
  if (!Number.isInteger(id) || id < 0 || id >= BGM_FILES.length) return null;
  return BGM_FILES[id] ?? null;
}

/**
 * 同一个曲目的**磁盘文件名** —— 游戏目录里实际是小写（`midi01.mid`），
 * 而 exe 那张表里是大写（`MIDI01.MID`，见 `Midi.txt` 也是大写）。
 *
 * ★ 在大小写敏感的文件系统上必须按实际文件名取（实测 `Rich4/midi01.mid` 存在、
 *   `Rich4/MIDI01.MID` 不存在），故取资源时一律走这个函数。
 */
export function bgmAssetFileFor(id: number): string | null {
  const name = bgmFileFor(id);
  return name === null ? null : name.toLowerCase();
}

/** 配置里「配乐」那一栏关掉了吗（`[0x49715a]` 为 0 时 `fcn_004549cf` 整条不做）*/
export function bgmEnabled(configByte: number): boolean {
  return (configByte & 0xff) !== 0;
}

export const MIDI_PLAYLIST: readonly string[] = [
  'Rich08.mid',
  'Rich16.mid',
  'Rich17.mid',
  'Rich18.mid',
  'Rich19.mid',
  'Rich20.mid',
  'Rich21.mid',
  'Rich22.mid',
  'midi01.mid',
  'midi02.mid',
  'midi03.mid',
  'midi04.mid',
  'midi05.mid',
  'midi06.mid',
  'midi07.mid',
  'midi08.mid',
  'midi09.mid',
  'midi10.mid',
  'midi11.mid',
  'midi12.mid',
  'midi13.mid',
  'midi14-1.mid',
  'midi14-2.mid',
  'midi15.mid',
  'midi16.mid',
];
