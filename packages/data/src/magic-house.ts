/*
 * 魔法屋的 12 个功能
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ **由脚本直接从 `Rich4/rich4.exe` 提取**，但**表基址与字段序在 2026-09-19
 *   （第 101 条）被整表订正**：
 *   `_rich4_magic_house_function_info` @ **VA 0x00475718**，每项 16 字节：
 *   ```c
 *   struct { int img; int x; int y; const char *name; };
 *   ```
 *   两条独立读取点都指向这一条记录（详见下方 `MAGIC_HOUSE_OPTIONS` 的注释）：
 *   `0x00431d05`（0 基）读 `+12` 名称、`0x00432dc4`（1 基）读 `+0` 图号，
 *   `0x00432dbf`/`0x00432db8` 读 `+4`/`+8` 坐标。
 *
 * ★ **效果已实现**，见 `@rich4/core` 的 `places/magic-house.ts`。
 *   十二个效果的派发表在 VA 0x00431c7a（`jmp [option*4 + ...]`），
 *   另有一张同样 12 项的**目标**表在 0x00431812——魔法屋是**两个转盘**，
 *   一个转「做什么」，一个转「对谁做」。本文件只管前者的名字与摆位。
 *
 * ⚠️ 第 11 项「拍賣當格土地」**在零售版里永远转不到**：效果转盘的取模
 *   底数是 11 而不是 12（`mov ecx, 0xb`，VA 0x0043396d），而效果派发函数
 *   `0x431caa` 全局只有那一个调用点。⇒ **它那 16 字节从来没被读过**
 *   （在正确字段序下它本身是合规的，见下）。
 */

export interface MagicHouseOption {
  /** 转盘上的序号 0..11 */
  id: number;
  /** 原版名称（BIG5 解码后的繁体） */
  name: string;
  /**
   * 指针高亮框的**图号**（Panel.mkf #18 的记录下标）@source 记录 `+0`
   *
   * ★★ 2026-09-19（第 101 条）订正：这个字段**不是「帧数」**。
   *   原版在「指到第 k 个功能」时（VA 0x00432dc4）执行的是
   *   ```asm
   *   00432db3  shl  eax, 4                       ; eax = k*16（k = 高亮格号 − 1 的 1 基）
   *   00432db6  edi  = [eax + 0x475710]           ; y
   *   00432dbd  ebp  = [eax + 0x47570c]           ; x
   *   00432dc4  edx  = [eax + 0x475708]           ; ★ 图号
   *   00432dca  eax  = edx*12
   *   00432dd4  edx  = [0x48c398]; add edx,0xc    ; 记录表基址 +0xc
   *   00432ddd  eax += edx                        ; ★ 直接当 MKF 记录地址用
   *   ```
   *   ⇒ 它是一个 **MKF 记录下标**（9/10/7/6），交给 142×120 的锦缎框 blit。
   */
  img: number;
  /** 转盘上的位置 @source 记录 `+4` / `+8`（640×480 屏幕坐标） */
  x: number;
  y: number;
}

/**
 * 十二个功能。
 *
 * ★★ 2026-09-19（第 101 条）**整表订正**：先前的 `x/y/img` 全部**错位一格**。
 *
 * 原版表在 `0x475718`，12 项 × 16 字节，字段序 `{+0 img, +4 x, +8 y, +12 name}`：
 *
 * ```asm
 * ; 读「名称」的那一支（0 基下标 esi）
 * 00431d00  mov  eax, esi / shl eax, 4
 * 00431d05  mov  ebx, dword ptr [eax + 0x475724]   ; ★ = 记录 i 的 +12（名字）
 * ; 读「高亮框」的那一支（1 基下标 k = 功能号 + 1）
 * 00432dc4  mov  edx, dword ptr [eax + 0x475708]   ; = 记录 (k-1) 的 +0（图号）
 * ```
 * 两支读的是**同一条 16 字节记录**（`0x475708 + 16k == 0x475718 + 16(k-1)`），
 * 所以「图号/坐标/名字」三者同属一个功能 —— 先前按 `0x475724` 当基址、字段序写成
 * `{name, frames, x, y}`，名字恰好对、其余三项全变成**下一个功能**的值。
 * 后果是十二个图标/框/名字整体被旋转了一位（玩家可见）。修正后的值见下表，
 * 通道 1 校验：`binary-truth.test.ts` 的「魔法屋功能表」一例。
 */
export const MAGIC_HOUSE_OPTIONS: readonly MagicHouseOption[] = [
  { id: 0, name: '變賣所有卡片', img: 9, x: 208, y: 167 },
  { id: 1, name: '抽取命運三張', img: 10, x: 510, y: 150 },
  { id: 2, name: '立刻坐牢三天', img: 7, x: 545, y: 88 },
  { id: 3, name: '原地停留一回合', img: 7, x: 568, y: 147 },
  { id: 4, name: '存入所有現金', img: 7, x: 550, y: 234 },
  { id: 5, name: '就地加蓋房屋', img: 7, x: 510, y: 320 },
  { id: 6, name: '得一張卡片', img: 7, x: 422, y: 320 },
  { id: 7, name: '向後轉', img: 6, x: 134, y: 318 },
  { id: 8, name: '變賣所有道具', img: 6, x: 92, y: 250 },
  { id: 9, name: '就地拆除房屋', img: 6, x: 72, y: 130 },
  { id: 10, name: '住院檢查三天', img: 6, x: 77, y: 85 },
  // ★ 第 11 项在正确的字段序下**完全合规**（先前那句「16 字节不符合字段模式」
  //   是错位阅读的产物）：img=9、x=122、y=154。
  { id: 11, name: '拍賣當格土地', img: 9, x: 122, y: 154 },
];

/** 魔法屋功能数 */
export const MAGIC_HOUSE_OPTION_COUNT = MAGIC_HOUSE_OPTIONS.length;
