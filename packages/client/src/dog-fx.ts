/*
 * 「踩到惡犬」那两段影片 + 地雷／炸彈的爆炸片 —— 全部照 exe
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块只算「这一拍要不要播、播哪一段」，不碰任何规则。
 *   ★ C-DET-4：动效**绝不进 state/history**。
 *
 * 起因（需求方回报）：「踩到狗之后没有触发狗咬人的动画和配音就直接进医院了」；
 * 第八份试玩回报 #8 又给了整个次序：「走到有狗的格子 → 狗咬动画（同时有配音）→
 * 人物变成乞丐造型同时救护车接人 → 镜头切到医院 → 台词」。
 *
 * ## 惡犬那一支逐条（VA 0x0041b837，在逐步处理例程 `fcn_0041b42d` 内）
 * ```asm
 * 0041b837  mov  edi, [0x48baf8]           ; 剩余步数
 * 0041b83d  test edi, edi / jne 0x41c164   ; 没停下来就不咬
 * 0041b845  push 0xb / call 0x40e14d       ; remove_object(11) —— 狗自己消失
 * 0041b84f  mov  ebp, [0x49910c]           ; 当前玩家
 * 0041b855  cmp  ebp, 4 / jge 0x41b8a7     ; ★ NPC（4..7）直接播狗咬
 * 0041b85d  cmp  byte [player + 0x11], 0   ; traffic_method
 * 0041b864  je   0x41b89e                  ;   徒步 → 咬人那一支
 * 0041b866  push edi / push edi / push 0x228 / push [0x48a0e4]
 * 0041b873  call 0x450441                  ; read_mkf(Data.mkf, 0x228, 0, 0)   ← 两个 edi 是 read_mkf 的参数
 * 0041b87d  push 0x55 / push 0x10001 / push 0x28 / push edi(=0) / push 影片
 * 0041b888  call 0x45144f                  ; ★ 有车：0x228「狗被车吓退」(0,40)，音效 0x55，flags 0x10001
 * 0041b899  jmp  0x41c164                  ;   有车这一支**不住院**
 * 0041b89e  push ebp / call 0x40cd07       ; ★ 毁车（徒步者不扣车，但照样 `or who_plays, 0x40` + 重载棋子图）
 * 0041b8a7  push 0 / push 0 / push 0x214 / push [0x48a0e4]
 * 0041b8b7  call 0x450441                  ; read_mkf(Data.mkf, 0x214, 0, 0)
 * 0041b8c1  push 0x5d / push 0x30001 / push 0x28 / push 0 / push 影片
 * 0041b8cd  call 0x45144f                  ; ★ 狗咬：0x214 (0,40)，音效 0x5d，flags 0x30001（阻塞播完）
 * 0041b8de  mov  [0x48baf8], 0             ; 剩余步数清零
 * 0041b8e6  push 3 / push ebp / call 0x43ec3f   ; send_to_hospital(玩家, 3) —— 救护车在它里面
 * ```
 * ⚠️ 2026-09-22 订正：先前把 `0x41b8c1` 起那四个 push 读成「救护车那一支」、把 `0x55 / 0x10001 / (0,0)`
 *   套到了 0x214 上 —— 那是**有车那一支** 0x228 的参数（`push edi / push edi` 也是 read_mkf 的两个 0，
 *   不是影片落点）。救护车的参数在 `0x43ec3f` 里（`confine-fx.ts`：0x20c、音效 0x5c、flags 0x1e0001）。
 *   佐证：`Effect.mkf` 93 长 **4.4 s** ≈ 0x214 的 38×114 = 4.33 s；85 长 1.67 s ≈ 0x228 的 18×71 = 1.28 s。
 *
 * ## 乞丐造型（`0x40cd07` → `who_plays |= 0x40`）
 *
 * `0x40cd07` 末尾 `0x0040cd5e or byte [player+0x15], 0x40` 然后 `call 0x40b93b`（重载棋子图）；
 * `0x40b93b` 见到 `who_plays == 0`（出局的乞丐）**或** `& 0x40` 就装**资源 +0x12 = 18**（`0x0040b9b7 add edi, 0x12`）
 * —— 那一张就是补丁衣服的乞丐。`send_to_hospital` 走到 `0x0043ecad and byte [+0x15], 0xf` 才把位清掉，
 * 而那之前 `0x0043ec78 view_to(玩家)` 已经把「乞丐站在狗格上」这一帧画出来了，救护车片（440×74 的一条）
 * 就盖在这一帧上播 ⇒ 需求方看到的「人物变成乞丐造型同时救护车接人」。
 * 本引擎里 `who_plays` 的 0x40 位在同一条 action 内被设又被清、after 里看不到，故按**表现**处理：
 * `deferred-board.ts` 在影片窗口里把入院者按回 before 的位置并挂上 `WHO_PLAYS_WRECKED`，
 * `render.ts` 见位画 +18。判据 `wreckedThisAction` 在本文件。
 *
 * ## 地雷／炸彈：同一套，影片换成爆炸片 0x20d
 * ```asm
 * 0041bea0  call 0x40cd07                  ; 地雷：毁车
 * 0041beac  push 0x20d … 0041bec2 push 0x52 / push 0x30001 / push 0x28 / push 0
 * 0041bece  call 0x45144f                  ; 爆炸 (0,40)，音效 0x52，flags 0x30001
 * 0041b72e  call 0x40cd07                  ; 定時炸彈：同一段 0x20d（0x0041b73a）
 * ```
 * 先前 `dogBiteFxTrigger` 只看「徒步 + 住院计数变大」⇒ 踩地雷也会播狗咬片。现在三段各认各的物件。
 *
 * ## 为什么它和救护车是**两段**、各自一段影片
 *
 * 原版是两次 `fcn_0045144f` **串行**（第二段由 `send_to_hospital` 内部再播一次）。本引擎的表现层
 * 一次只播一段，`main.ts` 把救护车那一段**排队**在本段之后（`pendingBoardFilmAfter`），
 * 两段之间窗口不关（`BoardFilmWindow.filmQueued`）。
 *
 * ## 一处**故意不改**的次序差：狗先离场（W-52 §3.3）
 *
 * 原版 `0x0041b847 call 0x40e14d`（把惡犬从盘上撤掉）在影片**之前**；本引擎的影片窗口里棋盘按
 * `before` 画，所以那 4.3 秒里**狗还画在原地**。影片是整幅 440×440 盖住棋盘的 ⇒ 观感无差。
 */

import { OBJECT_TYPE_DOG, OBJECT_TYPE_MINE } from '@rich4/core';
import { boardFilmSkippable, boardFilmTotalMs, type BoardFilmSpec } from './board-film.ts';

/** 这几段都在 Data.mkf @source `[0x48a0e4]` */
export const DOG_FX_ARCHIVE = 'Data.mkf';

/** 狗咬片资源号 @source VA 0x0041b8ab `push 0x214` */
export const DOG_FX_RESOURCE = 0x214;

/**
 * 影片的**屏幕**落点 @source VA 0x0041b8c8 `push 0x28` / 0x0041b8ca `push 0` —— (0, 40)，与其它棋盘影片一样贴着棋盘。
 * （`0x0041b866 push edi / push edi` 是 `read_mkf` 的两个 0 参数，不是落点。）
 */
export const DOG_FX_X = 0;
export const DOG_FX_Y = 0x28;
/** 逐字节核过资源头 `+8`/`+0xa` = 440×440 */
export const DOG_FX_W = 440;
export const DOG_FX_H = 440;

/**
 * 「狗咬人」那一段（徒步踩到）。
 *
 * 几何逐字节核过 `Data.mkf` 0x214 的 FLIC 头：`+0x06` = **38** 帧、440×440、`+0x10` = **114** ms/帧。
 * 嵌入源路径 = `D:\RICH4\FLCS\DOG.FLC`。
 */
export const DOG_BITE_FILM: BoardFilmSpec = {
  id: 'dog-bite',
  archive: DOG_FX_ARCHIVE,
  resource: DOG_FX_RESOURCE,
  frames: 38,
  width: DOG_FX_W,
  height: DOG_FX_H,
  frameMs: 114,
  x: DOG_FX_X,
  y: DOG_FX_Y,
  /** @source VA 0x0041b8c1 `push 0x5d`（= 93，`Effect.mkf` 93 = 4.4 s 的狗吠 + 惨叫）*/
  sound: 0x5d,
  /** @source VA 0x0041b8c3 `push 0x30001`（bit1 = 值 2 未置 ⇒ 点不掉，与 0x10001 一样）*/
  flags: 0x30001,
};

/**
 * 「狗被车吓退」那一段（有车踩到，不住院）。
 * @source VA 0x0041b868 `push 0x228`、0x0041b87d `push 0x55`、0x0041b87f `push 0x10001`、0x0041b884 `push 0x28`
 * 头：18 帧 / 440×440 / 71 ms；嵌入源路径 `D:\god-ok.FLC`。
 */
export const DOG_SCARED_FILM: BoardFilmSpec = {
  id: 'dog-scared',
  archive: DOG_FX_ARCHIVE,
  resource: 0x228,
  frames: 18,
  width: 440,
  height: 440,
  frameMs: 71,
  x: 0,
  y: 0x28,
  sound: 0x55,
  flags: 0x10001,
};

/**
 * 地雷／定時炸彈的爆炸片。
 * @source 地雷 VA 0x0041beac `push 0x20d` / 0x0041bec2 `push 0x52` / 0x0041bec4 `push 0x30001` / 0x0041bec9 `push 0x28`；
 *   炸彈 VA 0x0041b73a `push 0x20d` / 0x0041b752 `push 0x30001`。
 * 头：8 帧 / 440×440 / 114 ms（912 ms ≈ `Effect.mkf` 82 的 0.9 s）。
 */
export const EXPLOSION_FILM: BoardFilmSpec = {
  id: 'explosion',
  archive: DOG_FX_ARCHIVE,
  resource: 0x20d,
  frames: 8,
  width: 440,
  height: 440,
  frameMs: 114,
  x: 0,
  y: 0x28,
  sound: 0x52,
  flags: 0x30001,
};

/** 这一段影片总共播多久（毫秒）= 38 × 114 = 4332 */
export function dogBiteTotalMs(): number {
  return boardFilmTotalMs(DOG_BITE_FILM);
}

/**
 * 这一段能不能被点击/按键打断 —— `flags` 的 bit1（`[0x48c880]`）。
 * @source `fcn_0045144f` VA 0x004514d6：置位时才认 `0x202`/`0x205`/`0x101`。`0x30001` 的 bit1（值 2）= 0 ⇒ **不能**。
 */
export function dogBiteSkippable(): boolean {
  return boardFilmSkippable(DOG_BITE_FILM);
}

/** 两拍状态里本模块要看的那几个字段 */
export interface WreckSnapshot {
  players: readonly { trafficMethod: number; f64: number; blocking: { inHospital: number } }[];
  objects: readonly { type: number; nodeId: number; attached: number }[];
}

/** 这一拍有没有某种**放置类物件**被踩掉（before 在盘上、after 已收走）*/
function objectConsumed(before: WreckSnapshot, after: WreckSnapshot, type: number): boolean {
  for (let j = 0; j < before.objects.length; j++) {
    const b = before.objects[j];
    const a = after.objects[j];
    if (b === undefined || a === undefined) continue;
    if (b.type === type && b.nodeId !== 0 && b.attached === 0 && a.nodeId === 0) return true;
  }
  return false;
}

/** 住院计数**变大**（掩掉 0x80「待释放」位）*/
function hospitalGrew(before: WreckSnapshot, after: WreckSnapshot, i: number): boolean {
  const b = before.players[i]?.blocking.inHospital ?? 0;
  const a = after.players[i]?.blocking.inHospital ?? 0;
  return (a & 0x7f) > (b & 0x7f);
}

/**
 * 玩家 `i` 这一拍是不是走了 `0x40cd07` 那一道（惡犬 / 地雷 / 定時炸彈）—— 是就该画乞丐造型。
 *
 * 判据：住院计数变大，且同一拍里 **惡犬或地雷被踩掉**（该物件 before 在盘上、after 收走），
 * 或**自己背的炸彈炸了**（`f64` 非 0 → 0）。神明 / 卡片 / 新聞那些住院不经过 `0x40cd07`，不算。
 */
export function wreckedThisAction(before: WreckSnapshot, after: WreckSnapshot, i: number): boolean {
  if (!hospitalGrew(before, after, i)) return false;
  const bombBlew = (before.players[i]?.f64 ?? 0) !== 0 && (after.players[i]?.f64 ?? 0) === 0;
  return bombBlew || objectConsumed(before, after, OBJECT_TYPE_DOG) || objectConsumed(before, after, OBJECT_TYPE_MINE);
}

/**
 * 这一拍该播哪一段（狗咬 / 狗被车吓退 / 爆炸），不该播返回 `null`。
 *
 * - 惡犬被踩掉 + 某位徒步者住院计数变大 ⇒ 0x214 狗咬；
 * - 惡犬被踩掉 + 没人住院 ⇒ 0x228 狗被车吓退（core 的 `dogBite{blockedByVehicle:true}`）；
 * - 地雷被踩掉 / 炸彈炸了 + 住院计数变大 ⇒ 0x20d 爆炸。
 */
export function dogBiteFxTrigger(before: WreckSnapshot, after: WreckSnapshot): BoardFilmSpec | null {
  let anyHospital = false;
  let pedestrianHospital = false;
  let bombBlew = false;
  for (let i = 0; i < after.players.length; i++) {
    if (!hospitalGrew(before, after, i)) continue;
    anyHospital = true;
    if ((before.players[i]?.trafficMethod ?? 0) === 0) pedestrianHospital = true;
    if ((before.players[i]?.f64 ?? 0) !== 0 && (after.players[i]?.f64 ?? 0) === 0) bombBlew = true;
  }
  if (objectConsumed(before, after, OBJECT_TYPE_DOG)) {
    // @source 0x0041b85d `cmp byte [player+0x11], 0 / je 咬人` —— 徒步才咬；有车播 0x228 且不住院
    if (pedestrianHospital) return DOG_BITE_FILM;
    if (!anyHospital) return DOG_SCARED_FILM;
    return null;
  }
  if (anyHospital && (bombBlew || objectConsumed(before, after, OBJECT_TYPE_MINE))) return EXPLOSION_FILM;
  return null;
}
