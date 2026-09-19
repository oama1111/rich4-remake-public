/*
 * 「送進監獄／醫院」那一段影片 —— 全部照 exe
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块只算「那一段此刻该画第几帧、画在哪」，不碰任何规则。
 *   ★ C-DET-4：动效**绝不进 state/history** —— 丢了只是少一段动画。
 *
 * 需求方要的「1:1」里，这一段是**原版有、本引擎没有**的演出：
 * 被送进医院／监狱时，原版会当场在棋盘上播一段 FLIC（阻塞，播完才继续结算）。
 * 判据全部来自 `_rich4_add_player_days_in_hospital`（VA 0x0043ec3f 起）
 * 与 `_rich4_add_player_days_in_prison`（VA 0x0043d593 起）里的那两段：
 *
 * ```asm
 * ; 住院（VA 0x0043ed27 起）
 * 0043ed27  cmp byte [0x497159], 0        ; ★ RICH4.CFG+1 = 「動畫過程」
 * 0043ed2e  je  short 0x43ed85            ;    关掉 → **整段不播**
 * 0043ed34  push 0x20c                    ; Data.mkf 资源 0x20c
 * 0043ed40  call 0x450441                 ; read_mkf
 * 0043ed4a  push 0x5c                     ; arg5 = 音效号（Effect.mkf）92
 * 0043ed4c  push 0x1e0001                 ; arg4 = flags
 * 0043ed51  push 0xd2                     ; arg3 = y = 210
 * 0043ed56  push 0                        ; arg2 = x = 0
 * 0043ed59  call 0x45144f                 ; fcn_0045144f（阻塞播放）
 * ; 入獄（VA 0x0043d684 起，同形）
 * 0043d688  push 0x21a / … / push 0x5e / push 0x120001 / push 0x28 / push 0 / call 0x45144f
 * ```
 *
 * ## 参数含义（`fcn_0045144f` → `fcn_00450ced`，VA 0x0045144f / 0x00450ced）
 *
 * `fcn_00450ced(flic, x, y, flags)` 把四个参数存进全局，再逐位拆 `flags`：
 *
 * | 参数 | 存到 | 含义 |
 * |---|---|---|
 * | `x` / `y` | `[0x48c830]` / `[0x48c834]` | **屏幕**落点（棋盘左上角是 (0,40)）|
 * | 宽 / 高 | `[0x48c878]` / `[0x48c87c]` | 取自资源头 `+8` / `+0xa` |
 * | flags bit0 | `[0x48c882]` | 存背景 / 画进后台面 |
 * | flags bit1 | `[0x48c880]` | ★ **点击/按键跳过闸** —— 两段都是 0 ⇒ **点不掉** |
 * | flags bit2 | `[0x48c883]` | 循环（两段都是 0）|
 * | `(flags>>3)&1` | `[0x48c881]` | 另一处标记（两段都是 0）|
 * | 5 号参数 | — | 随影片一起响的音效号（`0x454304` 起、`0x45434f` 收）|
 *
 * ## 影片规格（`Data.mkf` 资源头，与 `packages/assets-pipeline` 的 `parseFlicInfo` 同算法）
 *
 * | 屏 | 资源 | 帧数 | 宽×高 | 落点 (x,y) | 每帧 | 总长 | 音效 |
 * |---|---|---|---|---|---|---|---|
 * | 住院 | `0x20c` | 62 | 440×**74** | (0, **210**) | **100 ms** | 6200 ms | 92 |
 * | 入獄 | `0x21a` | 35 | 440×440 | (0, **40**) | **71 ms** | 2485 ms | 94 |
 *
 * 住院那支贴在棋盘正中 (0,210)-(440,284)（h = 74），入獄那支贴满棋盘区
 * (0,40)-(440,480) —— 两支都是**整幅**帧、锚点就是左上角。
 *
 * ## 什么时候播
 *
 * 两支都在**送入**那一步立刻播（`read_mkf` → `fcn_0045144f` → 播完 `libc_free`），
 * 且**阻塞**：`fcn_0045144f` 自己那个 `PeekMessage` 循环不结束就不回到结算流程。
 * ⇒ 本引擎也要把回合驱动挡在这段影片后面（见 `main.ts` 的 `holdForWalk` 那道闸），
 *   播完才放行 —— 与建屋影片（`build-fx.ts`）同一套。
 */

import {
  boardFilmBitmap,
  boardFilmDone,
  boardFilmFrame,
  boardFilmSkippable,
  boardFilmTotalMs,
  type BoardFilmSpec,
} from './board-film.ts';
import type { LoadedFlic } from './assets.ts';

/** 两段影片都在 Data.mkf @source VA 0x0043ed39 / 0x0043d68d 的 `[0x48a0e4]` */
export const CONFINE_FX_ARCHIVE = 'Data.mkf';

/** 关押种类 —— 与 core 的 `ConfinementKind` 同形 */
export type ConfineKind = 'prison' | 'hospital';

/**
 * 一段关押影片的规格 —— 就是通用的 `BoardFilmSpec` 外加一个 `kind` 字段
 * （播放规则全在 `board-film.ts`，本模块只管**什么时候播哪一段**）。
 */
export interface ConfineClip extends BoardFilmSpec {
  kind: ConfineKind;
}

/** 住院 @source `Data.mkf` 0x20c 头：62 帧 / 440×74 / 100 ms / 音效 92 */
export const CONFINE_HOSPITAL: ConfineClip = {
  kind: 'hospital',
  id: 'hospital',
  archive: CONFINE_FX_ARCHIVE,
  resource: 0x20c,
  frames: 62,
  width: 440,
  height: 74,
  frameMs: 100,
  x: 0,
  y: 0xd2,
  sound: 0x5c,
  flags: 0x1e0001,
};

/** 入獄 @source `Data.mkf` 0x21a 头：35 帧 / 440×440 / 71 ms / 音效 94 */
export const CONFINE_PRISON: ConfineClip = {
  kind: 'prison',
  id: 'prison',
  archive: CONFINE_FX_ARCHIVE,
  resource: 0x21a,
  frames: 35,
  width: 440,
  height: 440,
  frameMs: 71,
  x: 0,
  y: 0x28,
  sound: 0x5e,
  flags: 0x120001,
};

/** 名字 → 规格 */
export function confineClip(kind: ConfineKind): ConfineClip {
  return kind === 'prison' ? CONFINE_PRISON : CONFINE_HOSPITAL;
}

/** 一段影片总共播多久（毫秒）= 帧数 × 每帧毫秒（不循环、不重复）*/
export function confineTotalMs(kind: ConfineKind): number {
  return boardFilmTotalMs(confineClip(kind));
}

/**
 * 这一段能不能被点击/按键打断 —— `flags` 的 bit1（`[0x48c880]`）。
 *
 * @source `fcn_0045144f` VA 0x004514d6：`cmp byte [0x48c880], 0 / je 0x4514fd`
 *   置位时才认 `0x202` / `0x205` / `0x101` 三种消息并提前收场。
 *   两段的 `flags` 都是 `0x?e0001` / `0x120001`，**bit1 = 0** ⇒ 原版也点不掉。
 */
export function confineSkippable(kind: ConfineKind): boolean {
  return boardFilmSkippable(confineClip(kind));
}

/**
 * 这一次状态变化要不要播、播哪一段。
 *
 * 判据（纯查两张占用表 + 两个计数，都是 `GameState` 里的公开字段）：
 *   ① 占用表**由 0 变 1**（`confine()` 把槽位置 1 的那一下）—— 这是「刚被送进去」；
 *   ② 计数**变大**（`blocking.inPrison` / `inHospital` 的**低 7 位**）——
 *      覆盖「本来就在里面、又被加刑」那一路（原版 `send_to_*` 每次调用都重播影片）。
 *
 * ★★ 2026-09-18 修「NPC 走动后自动呼出救护车」（需求方第 5 条）：
 *   计数比较**必须先 `& 0x7f`**。计数字节的高位 `0x80` 不是「更多天数」，而是
 *   **「刑期已满、待释放」这个状态本身**：
 * ```asm
 * 0041c8e3  test dh, 0x3f / jne 跳过     ; 归零判据
 * 0041c8ea  or   ch, 0x80                ; ★ 减到 0 → 挂 0x80（等下一次才真放人）
 * ```
 *   于是「1 → 0x80」这一步**不是一次送入**，却满足 `0x80 > 1` ⇒ 旧代码误判成
 *   「刚被送医」并重播 6.2 秒的救护车影片。实测复现（5180、`?screen=game&humans=0&ai=4`）：
 *   `inHospital` 由 `0,0,0,1` 变 `0,0,0,128` 的那一拍，`#log` 里第二次出现
 *   `影片：開始 hospital（62 帧 × 100 ms）`，而此时两张占用表都没变、没人被送进去。
 *   掩掉高位之后：1 → 0x80 判为**不触发**；真加刑（3 → 5）与首次送入（0 → 3）照旧触发。
 *
 * ⚠️ 两边同时成立（一次 action 里既进医院又进监狱）时取**医院**：
 *   原版是两次 `fcn_0045144f` 串行播，本引擎的表现层一次只播一段，
 *   先播医院那一段（`inHospital` 的调用点更多）；这种组合在现有规则里到不了，
 *   登记在 `Q-ANIM-1.md`。
 *
 * @param before / after 同一拍的前后状态（只读占用表与 `players`）
 */
export function confineFxTrigger(
  before: {
    prisonOccupancy: readonly number[];
    hospitalOccupancy: readonly number[];
    players: readonly { blocking: { inPrison: number; inHospital: number } }[];
  },
  after: {
    prisonOccupancy: readonly number[];
    hospitalOccupancy: readonly number[];
    players: readonly { blocking: { inPrison: number; inHospital: number } }[];
  },
): ConfineKind | null {
  // @source 0x41c8ea `or ch, 0x80` —— 高位是「待释放」状态，不是天数的一部分
  const days = (raw: number): number => raw & 0x7f;
  for (let i = 0; i < after.players.length; i++) {
    const b = before.players[i];
    const a = after.players[i];
    if (b === undefined || a === undefined) continue;
    const hospital =
      (after.hospitalOccupancy[i] === 1 && before.hospitalOccupancy[i] !== 1)
      || days(a.blocking.inHospital) > days(b.blocking.inHospital);
    if (hospital) return 'hospital';
    const prison =
      (after.prisonOccupancy[i] === 1 && before.prisonOccupancy[i] !== 1)
      || days(a.blocking.inPrison) > days(b.blocking.inPrison);
    if (prison) return 'prison';
  }
  return null;
}

/**
 * 正在播的这一段。
 *
 * ★ 纯数据：`main.ts` 拿它当**表现层的状态位**，不进 `GameState`（C-DET-4）。
 */
export interface ConfineFx {
  kind: ConfineKind;
  /** 这一段是什么时候开始的（`performance.now()` 时基）*/
  startedAt: number;
}

export function beginConfineFx(kind: ConfineKind, now: number): ConfineFx {
  return { kind, startedAt: now };
}

/**
 * 现在该画第几帧（**0 基**，播完钉在最后一帧上）。
 *
 * @source VA 0x0045117d：帧号从 0 起、每帧等 `[0x48c870]`（= 资源头 `+0x10`）才 +1，
 *   到 `帧数 − 1` 为止；一帧都不循环。
 */
export function confineFxFrame(fx: ConfineFx, now: number): number {
  return boardFilmFrame({ spec: confineClip(fx.kind), startedAt: fx.startedAt }, now);
}

/** 这一段播完了吗（时间到）*/
export function confineFxDone(fx: ConfineFx, now: number): boolean {
  return boardFilmDone({ spec: confineClip(fx.kind), startedAt: fx.startedAt }, now);
}

/**
 * 这条动效现在该画哪张图；影片还没解好 → `null`。
 *
 * @param flic `assets.getFlic('Data.mkf', 资源号)`；没到货先给 `null`，
 *   画面这一帧空着（棋盘照画），下一帧会补上。
 */
export function confineFxBitmap(
  fx: ConfineFx,
  now: number,
  flic: LoadedFlic | null | undefined,
): ImageBitmap | null {
  return boardFilmBitmap({ spec: confineClip(fx.kind), startedAt: fx.startedAt }, now, flic);
}
