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
 * 判据：某位玩家**首次**被送进去 —— 计数字节（`blocking.inPrison` / `inHospital`，**整字节**）
 * 原为 0，且这一拍占用表由 0 变 1 或计数变成非 0。
 *
 * ★★ 2026-09-23 订正（第十四份試玩回報，协调方拍板照 exe）：**加刑不播**。
 *   先前这里写「本来就在里面、又被加刑 → 照样播（原版 `send_to_*` 每次调用都重播影片）」—— 与 exe 不符：
 * ```asm
 * ; send_to_prison 0x0043d593
 * 0043d5cc  call 0x41d476                 ; ① view_to(受害者)      ← 加刑也走
 * 0043d5d4  mov  dh, [ebx + 0x496b9c]     ; 计数字节（整字节，含 0x80 待释放位）
 * 0043d5da  test dh, dh
 * 0043d5dc  jne  0x43d6bd                 ; ★ 非 0 ⇒ 直接去「加天数」，跳过搬位置 + 0x21a 警车
 * 0043d6bd  … add cl, al / and ch, 0x7f   ;   (existing + days) & 0x7f
 * 0043d6d6  … call 0x41d476               ; ② view_to(新位置)      ← 加刑也走
 * ; send_to_hospital 0x0043ec3f 同形：0x0043ec86 test dh,dh / 0x0043ec88 jne 0x43ed6c 跳过 0x20c 救护车
 * ```
 *   ⇒ 「待释放」（0x80）期间又被送进去也是非 0 ⇒ 同样只加天数、不播。
 *   两次 `view_to` 照走（镜头看監獄 / 醫院），见 core 的 `confineViewTargets`（`extended`）。
 *
 * ★★ 2026-09-18（需求方第 5 条）：计数高位 0x80 是「待释放」状态位（@source 0x41c8ea `or ch, 0x80`），
 *   1 → 0x80 那一步不是送入 —— 按整字节「原为 0」判，这一条自然成立。
 *
 * 返回**第一段**（按玩家号、医院在前）。宿主按 `confineFxTriggers` 把每一段都排上
 *   （第十五份起：原版每次 `send_to_*` 各播一次、串行）。
 *
 * @param before / after 同一拍的前后状态（只读占用表与 `players`）
 */
export function confineFxTrigger(
  before: ConfineFxState,
  after: ConfineFxState,
): ConfineKind | null {
  return confineFxTriggers(before, after)[0]?.kind ?? null;
}

/** `confineFxTrigger` 读的那几样 */
interface ConfineFxState {
  prisonOccupancy: readonly number[];
  hospitalOccupancy: readonly number[];
  players: readonly { blocking: { inPrison: number; inHospital: number } }[];
}

/**
 * ★ 第十五份：这一拍**每一位**首次被送进去的人（按玩家号）—— 各播一段。
 *
 * 原版每次 `send_to_*` 调用各播一次（阻塞、串行）：新聞 4 `fcn_0044913d` 先播飛碟 0x213
 * （`0x0044925b`），再逐人 `send_to_hospital`（`0x00449285`），各自一辆救护车 0x20c。
 * 判据与 `confineFxTrigger` 相同（逐人：医院在前、监狱在后）。
 */
export function confineFxTriggers(
  before: ConfineFxState,
  after: ConfineFxState,
): { player: number; kind: ConfineKind }[] {
  const out: { player: number; kind: ConfineKind }[] = [];
  for (let i = 0; i < after.players.length; i++) {
    const b = before.players[i];
    const a = after.players[i];
    if (b === undefined || a === undefined) continue;
    // @source 0x0043ec86 `test dh, dh / jne` —— 原计数非 0 ⇒ 加刑支，不播
    const hospital =
      b.blocking.inHospital === 0
      && ((after.hospitalOccupancy[i] === 1 && before.hospitalOccupancy[i] !== 1) || a.blocking.inHospital !== 0);
    if (hospital) out.push({ player: i, kind: 'hospital' });
    // @source 0x0043d5da `test dh, dh / jne`
    const prison =
      b.blocking.inPrison === 0
      && ((after.prisonOccupancy[i] === 1 && before.prisonOccupancy[i] !== 1) || a.blocking.inPrison !== 0);
    if (prison) out.push({ player: i, kind: 'prison' });
  }
  return out;
}

/**
 * 这一次送进去是不是**新聞 / 命運事件**引出的 —— 是就要等事件提示框收掉再播。
 *
 * 判据与事件框起播同一条（`event-box-screen.ts` 的 `event()`）：`lastEvent` **换了引用**
 * 且是 `news` / `fortune`（core 只在真的抽了一张时新建它）。
 *
 * @source 新聞 `0x0044b862 push 0x960 / call 0x4544f6`（框停 2400 ms）→ `0x0044b875` pass 1
 *   → 新聞 29 `0x0044b362 call 0x43d593`；命運 `0x0044dd49`（1600 ms）→ pass 1 → 命運 33
 *   `0x0044d8c2 call 0x43d593`。警车 `0x21a` / 救护车 `0x20c` 在 `send_to_*` 体内（`0x0043d688` /
 *   `0x0043ed34`），故都在框之后。详见 `board-film.ts` 的 `afterEventBox`。
 */
export function confineAfterEventBox(
  before: { lastEvent: { kind: string } | null },
  after: { lastEvent: { kind: string } | null },
): boolean {
  const ev = after.lastEvent;
  return ev !== null && ev !== before.lastEvent && (ev.kind === 'news' || ev.kind === 'fortune');
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
