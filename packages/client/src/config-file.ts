/*
 * `RICH4.CFG` 的**逐字节**编解码
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么要做它：原版的**全部设定与 28 条键位**都存在游戏目录这一个 72 字节的
 *   文件里；設定屏「確定」与熱鍵頁「確定」都是 `rich4_write_config()`
 *   （VA 0x00411f80）把它整份写回，開機時 `rich4_read_config()`（VA 0x00411e8f）
 *   读回来。本引擎先前没有这个读写 —— `optionsKeys` 只活在内存里，
 *   所以熱鍵改完重开就没了（登记为 `Q-OPT-1`）。
 *
 * ── 结构（重建源码 `rich4-re/asm/rich4_config_file.h`，逐字段核过）──
 *
 * ```c
 * typedef struct { uint8_t key; uint8_t mod; } rich4_key_t;   // 2 字节
 *
 * typedef struct {
 *   uint8_t  game_speed;      // +0   00/01/02
 *   uint8_t  animation;       // +1   01 = enabled
 *   uint8_t  music;           // +2   00..04
 *   uint8_t  sound_effect;    // +3   00..04
 *   uint8_t  auto_save;       // +4   01 = enabled
 *   uint8_t  view;            // +5   00 日曆 / 01 小地圖 / 02 兩者輪流
 *   uint8_t  dummy1[2];       // +6..7
 *   uint8_t  day;             // +8   ← 当前游戏日期（`fcn_00452117(&CFG+8)` 逐日推进）
 *   uint8_t  month;           // +9
 *   uint16_t year;            // +10..11
 *   uint8_t  calendar;        // +12  ★ 日曆 0 / 月曆 1（`[0x497164]`，原头文件记作 dummy2[0]）
 *   uint8_t  dummy2[3];       // +13..15
 *   rich4_key_t hotkeys[28];  // +16..71   28 × {key, mod}
 * } rich4_cfg;                // sizeof = 72 = 0x48
 * ```
 *
 * ★ **实测锚点**：仓库里那份原版 `Rich4/RICH4.CFG` 正好 72 字节，
 *   `[8..11] = 0e 04 d2 07` ⇒ 2002-04-14；`[16..71]` 的 28 条键位与
 *   `hotkeys.ts` 的 `DEFAULT_BINDINGS` **逐字节相同**（末条是 `51 11` = Q + Ctrl）。
 *   `config-file.test.ts` 拿这个文件当二进制真值逐字节比对。
 *
 * ★ `+12` 不是 dummy（W-PT22 #12）：全 exe 引用 `0x497164` 的 6 处里，写入 3 处 ——
 *   出厂 `0x00411f04 mov [0x497164], ch(0)`（与 +0..+5 的出厂值同一段）、点太阳
 *   `0x004183c6 mov [0x497164], bl(0)`、点月亮 `0x0041840c mov [0x497164], 1`；读 3 处
 *   （`0x004169fd` 画哪个版式、`0x004183ac` / `0x004183f0` 已是这一面就不理）。
 *   它就在 `rich4_cfg` 的 72 字节里，`rich4_write_config()` 整份 `fwrite` ⇒ 跟着存盘。
 *
 * ⚠️ 这里**不做范围夹取**：原版 `fread` 进来什么就是什么（`game_speed` 越界也照用）。
 *   夹取属改良（C-FID-1）。解码时只把「读不出来」的情况退回默认值。
 */

/** 一条键位（与原版 `rich4_key_t` 同形） */
export interface ConfigKey {
  /** Windows 虚拟键码 */
  vk: number;
  /** 0x11 = Ctrl @source `rich4_cfg.txt` */
  mod: number;
}

/** 一份 `RICH4.CFG` */
export interface Rich4Config {
  /** 游戏速度 0..2（原版不夹取） */
  speed: number;
  /** 动画过程开关（1 = 开） */
  animation: boolean;
  /** 配乐音量 0..4 */
  music: number;
  /** 音效音量 0..4 */
  sound: number;
  /** 自动存档（1 = 开） */
  autoSave: boolean;
  /** 右下角显示哪一块 0/1/2 */
  view: number;
  /**
   * 日曆那一面画哪个版式：0 日曆 / 非 0 月曆（`+12` = `[0x497164]`）。
   * 可省略 = 0（出厂 `0x00411f04`）。
   */
  calendar?: number;
  /** 当前游戏日期 */
  year: number;
  month: number;
  day: number;
  /** 28 条键位 */
  hotkeys: ConfigKey[];
}

/** 文件长度 @source `sizeof(rich4_cfg)` = 16 + 28×2 = 72 */
export const CONFIG_FILE_SIZE = 72;
/** 键位表的起始偏移 @source `hotkeys` 在结构里的偏移 */
export const CONFIG_HOTKEY_OFFSET = 0x10;
/** 键位条数 @source `rich4_key_t hotkeys[28]` */
export const CONFIG_HOTKEY_COUNT = 28;
/** 日期三个字节的偏移 @source `day` / `month` / `year` */
export const CONFIG_DATE_OFFSET = 8;
/** 日曆 / 月曆那一格的偏移 @source `[0x497164]` − `[0x497158]`（cfg 基址，+5 = `[0x49715d]` 視窗）*/
export const CONFIG_CALENDAR_OFFSET = 12;

/** Ctrl 修饰位 @source `rich4_cfg.txt` 的 `0x11`；与 `hotkeys.ts` 的 `MOD_CTRL` 同值 */
export const CONFIG_MOD_CTRL = 0x11;

/**
 * 把一份设定编成 72 字节。
 *
 * ⚠️ 越界值**照原样写**（原版不夹取）—— 只是 `& 0xff` 保证是字节。
 *   `hotkeys` 不足 28 条时后面补 0；多出来的丢掉。
 */
export function encodeConfig(cfg: Rich4Config): Uint8Array {
  const out = new Uint8Array(CONFIG_FILE_SIZE);
  out[0] = cfg.speed & 0xff;
  out[1] = cfg.animation ? 1 : 0;
  out[2] = cfg.music & 0xff;
  out[3] = cfg.sound & 0xff;
  out[4] = cfg.autoSave ? 1 : 0;
  out[5] = cfg.view & 0xff;
  // +6..7 是 dummy1：原版不写（保持 0）
  out[CONFIG_DATE_OFFSET] = cfg.day & 0xff;
  out[CONFIG_DATE_OFFSET + 1] = cfg.month & 0xff;
  out[CONFIG_DATE_OFFSET + 2] = cfg.year & 0xff;
  out[CONFIG_DATE_OFFSET + 3] = (cfg.year >> 8) & 0xff;
  out[CONFIG_CALENDAR_OFFSET] = (cfg.calendar ?? 0) & 0xff;
  // +13..15 仍是 dummy：原版不写（保持 0）
  for (let i = 0; i < CONFIG_HOTKEY_COUNT; i++) {
    const k = cfg.hotkeys[i];
    const at = CONFIG_HOTKEY_OFFSET + i * 2;
    out[at] = (k?.vk ?? 0) & 0xff;
    out[at + 1] = (k?.mod ?? 0) & 0xff;
  }
  return out;
}

/**
 * 把 72 字节解回一份设定；**长度不对或读不出来时返回 `null`**（调用方退回默认）。
 *
 * ⚠️ 不做合法性校验：原版读进来什么就用什么（日期也只在
 *   `_rich4_read_config` 里被系统日期覆盖，见 `rules/setup.ts` 的 `defaultStartDate`）。
 */
export function decodeConfig(bytes: Uint8Array | null | undefined): Rich4Config | null {
  if (bytes === null || bytes === undefined) return null;
  if (bytes.length < CONFIG_FILE_SIZE) return null;
  const hotkeys: ConfigKey[] = [];
  for (let i = 0; i < CONFIG_HOTKEY_COUNT; i++) {
    const at = CONFIG_HOTKEY_OFFSET + i * 2;
    hotkeys.push({ vk: bytes[at]!, mod: bytes[at + 1]! });
  }
  return {
    speed: bytes[0]!,
    animation: bytes[1] !== 0,
    music: bytes[2]!,
    sound: bytes[3]!,
    autoSave: bytes[4] !== 0,
    view: bytes[5]!,
    calendar: bytes[CONFIG_CALENDAR_OFFSET]!,
    day: bytes[CONFIG_DATE_OFFSET]!,
    month: bytes[CONFIG_DATE_OFFSET + 1]!,
    year: bytes[CONFIG_DATE_OFFSET + 2]! | (bytes[CONFIG_DATE_OFFSET + 3]! << 8),
    hotkeys,
  };
}

/** 只取键位那一半（28 条）—— 熱鍵頁只关心它 */
export function configHotkeyKeys(cfg: Rich4Config): number[] {
  return cfg.hotkeys.map((k) => k.vk);
}
