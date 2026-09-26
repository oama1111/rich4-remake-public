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
  // ★ 先前这里有 `BANKRUPT: 5`（「破产 @source 0x0040d1cb push 5」）—— 紧跟的是 `call 0x4549cf`（播 MIDI06，
  //   拍賣配乐，只在破产释放 > 3 处地产、随机连拍 3 处时放），不是音效号。已删（第十三份试玩回报复核）。
  // ★ 先前这里有 `BANK: 4`（「落在银行 @source 0x0043674d push 4」）—— 那是 `call 0x4549cf`（播 MIDI05，
  //   貸款屏配乐）的参数，不是音效号；落在銀行原版**不放**任何 Effect.mkf 音效。已删（第十三份试玩回报复核）。
  /** 樂透开奖 @source VA 0x004317a7 `push 8` ⚠️ 实为 `call 0x4549cf`（MIDI09），不是音效；client 未用 */
  LOTTERY_DRAW: 8,
  /** 拍卖 @source VA 0x0043c6ca `push 5` ⚠️ 实为 `call 0x4549cf`（MIDI06），不是音效；client 未用 */
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
  /**
   * **神明顯靈／自己加蓋**那一声 —— 音效 **50**（W-55 行 3）。
   *
   * @source 四个调用点都是同一条 `push ref_004823da / call rich4_play_sound_effect`：
   *
   * | 调用点 VA | 何时响 |
   * |---|---|
   * | `0x0040f4f3` | 天使顯靈：`0x40b110` 成功（`test bh,1`）之后、0x20b 影片**之前** |
   * | `0x0040f9dc` | 福神顯靈：同上（`test bl,1` 之后） |
   * | `0x004199de` | 自己的地落点「升級房子」：`inc byte [地块+0x1a]` 之后、`cmp …,5` 之前 |
   * | `0x0041a289` | 落点首建等级 0 的設施：`inc byte +0x1a` 之后（**本次未接**，见下） |
   *
   * ```asm
   * 0040f4f1  push 0
   * 0040f4f3  push 0x4823da          ; ★ 表项地址
   * 0040f4f8  call 0x4542ce          ; rich4_play_sound_effect
   * ```
   *
   * ★ **表项 `0x4823da` → 资源号 50 的换算**：与上面 `PLACE_*` / `DOLL` **同一张表** ——
   *   基址 `0x48231a`、每项 **8 字节**（+0 = `Effect.mkf` 资源号、+4 = 运行时声音对象）：
   *   `0x4823da − 0x48231a = 0xc0 = 24 × 8` ⇒ **表项 24**，`disasm.py dump 0x4823da 4 4`
   *   读出 `[0x4823da] = 50`（下一项 `0x4823e2` = 54，间隔正好 8）。而
   *   `rich4_play_sound_effect`（VA 0x004542ce）就是 `mov ecx,[eax] / push ecx`（VA 0x004542d8）
   *   —— 取 `[表项]` 当资源号交给 `0x4540d8`。故 **50 = `Effect.mkf` 资源 50**。
   *   实测 `Effect.mkf` 资源 50 是 RIFF/WAVE（`audio.test.ts` 有钉子）。
   *
   * ⚠️ **第 4 个调用点 `0x0041a289` 本次未接**：落点「首个建一级設施」那一条在
   *   `reduce.ts` 的 `buildFacility` 分支里**不写 `lastBuildUpgrades`**
   *   （它不走 `0x40b110`），所以挂在 `lastBuildUpgrades` 上的音效够不到它。
   *   接它要另加一条 core 瞬态提示 —— 属 W-55 行 9 的邻域，留给首席裁。
   */
  GOD_MANIFEST: 50,
  /**
   * 特殊格**落地音**（新聞/命運/監獄/醫院/三個小遊戲/樂透/銀行/百貨/魔法屋）。
   *
   * @source `0x00419892 mov al, byte [ebx + 0x475299]`（種類 → 移動音效表下標）
   *   → `0x0041989b add eax, 0x48234a` → `0x004198a1 call 0x4542ce`。
   *   下標表 `0x475299 = [9,0,10,10,10,10,10,10,10,10,16,16,16,16,10,10,10]`，
   *   移動音效表 `0x48234a` 的 idx10 = **43**、idx16 = **48**。
   *   分派器前有 `cmp ebx,2 / jb` 与 `cmp ebx,0x10 / ja` ⇒ 種類 2..16 才放（公園被排除）。
   */
  SPECIAL_SQUARE: 43,
  /** 得點類與**卡片格**的落地音（種類 10..13）@source 同上表 idx16 ⇒ Effect **48** */
  CARD_SQUARE: 48,
  /**
   * **買地 / 買現成設施成功**那一声音 —— 音效 **49**。
   *
   * ★ 两条路**共用**同一个号（全 exe 里 `push 0x4823d2` 只有这两处）：
   *
   * | 调用点 VA | 何时响 |
   * |---|---|
   * | `0x0041a0f1`（`call 0x4542ce` 在 `0x0041a0f6`）| 落点「買地」成功：`_rich4_handle_player_land_on_node` 的地块分支 |
   * | `0x0041a939`（同形）| 落点「買現成設施」成功 |
   *
   * ```asm
   * 0041a0f1  push 0x4823d2          ; ★ 表项地址
   * 0041a0f6  call 0x4542ce          ; rich4_play_sound_effect
   * ```
   *
   * ★ **表项 `0x4823d2` → 资源号 49 的换算**：与 `PLACE_*` / `DOLL` / `GOD_MANIFEST`
   *   **同一张表** —— 基址 `0x48231a`、每项 **8 字节**（+0 = `Effect.mkf` 资源号、
   *   +4 = 运行时声音对象）：
   *   `0x4823d2 − 0x48231a = 0xb8 = 23 × 8` ⇒ **表项 23**，`[表项] = 49`。
   *   下一项 `0x4823da` 就是 `GOD_MANIFEST` 的 50（`(0x4823da − 0x48231a) / 8 = 24`）
   *   —— 两条换算互相印证。
   *
   * ⚠️ **衰神／死神拦下时不响**：那两处的 `purchase` 被 `godBlockedPurchase` 挡回，
   *   归属根本不写 ⇒ 表现层按「归属是否真变了」判定，自然不响（与原版一致）。
   */
  BUY_PROPERTY: 49,
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
  // ★ 2026-09-19 补：表 `0x47e793` 实 dump 是 **17 项**（到 0x47e7d7 才是 0），先前只抄了 13 项，
  //   于是把監獄 `0xf` / 醫院 `0x10` 记成了「越界、读到什么未定论」—— 其实就是下面这两首。
  'MIDI14-1.MID', 'MIDI14-2.MID', 'MIDI15.MID', 'MIDI16.MID',
];

/**
 * **棋盘背景曲单** —— 8 首，轮着放。
 *
 * @source 表 `0x47e773`（8 个指针，紧挨着上面那张 `0x47e793`；实 dump：
 *   RICH08 / RICH16 / RICH17 / RICH18 / RICH19 / RICH20 / RICH21 / RICH22）。
 *
 * 三支例程（2026-09-19 整支读过）：
 * - `sub_00454d91(arg)`：`arg ≠ 0` ⇒ 曲号 = `arg − 1`；`arg = 0` ⇒ **下一首** `(曲号 + 1) & 7`。
 *   放 `表[曲号]`（有游戏光盘时改放 CD 音轨 `曲号 + 2`），并把当前曲记成 `曲号 | 0x80`（0x80 = 背景曲）。
 *   调用点：片头过场里 `0x415963 push 1`（⇒ **开局第一首 = RICH08**）、读档进棋盘 `0x4019c6 push 0`、
 *   節日曲那一天过完 `0x41cf93`、設定屏点选曲目 `0x410686`（`(x − 0xe2) / 15 + 1`）。
 * - `sub_00454d2c`（一首放完的通知）：当前是背景曲 ⇒ `sub_00454d91(0)` 换下一首；
 *   否则（场所曲）⇒ `play mid from 0` 原地重放。
 * - `sub_00454bcc`（每个场所的模态循环一返回就调）：停掉场所曲，**从被打断的位置**接着放背景曲
 *   （`play mid from %d`，位置是 `fcn_004549cf` 打断时由 `sub_00454b1a` 记下的）。
 *
 * ★ 先前棋盘上一直放的是 `MIDI02` —— 那只是**開局設定屏**的配乐（`0x40711a push 0x8001`，
 *   紧接着就是設定屏的模态循环），設定屏一收 `sub_00401543 → sub_00454edc` 就把它停了。
 *   磁盘上的文件名是 `Rich08.mid` 这种大小写（见 `assets/game/`）。
 */
export const BOARD_BGM_FILES: readonly string[] = [
  'Rich08.mid', 'Rich16.mid', 'Rich17.mid', 'Rich18.mid',
  'Rich19.mid', 'Rich20.mid', 'Rich21.mid', 'Rich22.mid',
];

/** 背景曲的「下一首」@source `0x00454dac`：`inc ah / and dl, 7` */
export function nextBoardBgm(index: number): number {
  return (index + 1) & 7;
}

/**
 * 全 exe 22 处 `call fcn_004549cf` 各自传的 **id**（逐处读出的**实参**）。
 *
 * @source 每一处调用点前那一句 `push <imm>`（`rich4-re/asm/*.asm`，行号见注）：
 * ```asm
 * push 9 / call fcn_004549cf        ; rich4.asm:19212  —— 月結／頒獎屏
 * push 0x8001 / call fcn_004549cf   ; new_game.asm:4009
 * ```
 * ★ `0x8000` 那一位是**旗标**，不是曲号：`fcn_004549cf` 开头
 *   `test byte [esp+0x3d], 0x80 / je … / and dword [esp+0x3c], 0x7fff`
 *   ⇒ 真正的曲号要**去掉 0x8000**（`0x8001` → 1、`0x8006` → 6）。
 *
 * 監獄 `0xf`（prison.asm:917）= `MIDI15.MID`、醫院 `0x10`（hospital.asm:1529）= `MIDI16.MID`
 *   （表 `0x47e793` 共 17 项，见 `BGM_FILES`；先前误记成「越界」）。
 */
export const SCREEN_BGM: Readonly<Record<string, number>> = {
  /** rich4.asm:19212 —— 月結／頒獎屏 */
  monthly: 9,
  /** magic_house.asm:2269 / 2512 */
  magicHouse: 7,
  /** new_game.asm:4009 / 4531（★ 带 0x8000 旗标 ⇒ 曲号 1 / 6）*/
  newGame: 0x8001,
  newGameAlt: 0x8006,
  /** player_bankrupt.asm:216 / 442 */
  bankrupt: 2,
  bankruptAlt: 5,
  /** shop.asm:2196 */
  shop: 6,
  /** small_games.asm:4335 / 4481 / 4638 */
  minigamePenguin: 0xc,
  minigameBalloon: 0xb,
  minigameGift: 0xa,
  /** ui_auction.asm:3139 */
  auction: 5,
  /** ui_bank.asm:3557 / 3743 */
  bank: 4,
  /** ui_letou.asm:2938 / 3063 */
  lottery: 6,
  lotteryDraw: 8,
  /** ui_main.asm:187 / 483 */
  mainMenu: 0,
  /** 監獄 = MIDI15、醫院 = MIDI16 */
  prison: 0xf,
  hospital: 0x10,
};

/**
 * `fcn_004549cf` 的实参里 `0x8000` 是旗标，真曲号要掩掉它。
 * ★ 旗标的含义（`0x4549e7..0x454a1a`）：**不要**去记背景曲被打断的位置（`sub_00454b1a`）——
 *   用在「此刻本来就没有背景曲在放」的场合（開局設定屏、终局屏、節日曲）。不是「先停当前曲」。
 */
export function bgmTrackIdOf(rawArg: number): number {
  return rawArg & 0x7fff;
}

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
