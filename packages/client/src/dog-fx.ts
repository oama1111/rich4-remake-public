/*
 * 「踩到惡犬」那一段影片 —— 全部照 exe
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块只算「这一拍要不要播、此刻画第几帧」，不碰任何规则。
 *   ★ C-DET-4：动效**绝不进 state/history**。
 *
 * 起因（需求方回报）：「踩到狗之后没有触发狗咬人的动画和配音就直接进医院了」。
 * 复核 `rich4.exe`：物件落点跳表 `ref_0041b3e5`（VA 0x0041b3e5，18 项 = 種類 1..18）
 * 的第 11 项 = **惡犬那一支 VA 0x0041b837**，里面确实有两段 FLIC，本引擎一段都没接。
 *
 * ## 惡犬那一支逐条（VA 0x0041b837，全在 `_rich4_player_move_one_step_done` 内）
 *
 * ```asm
 * 0041b837  mov  edi, [0x48baf8]           ; 剩余步数
 * 0041b83d  test edi, edi / jne 0x41c164   ; 没停下来就不咬
 * 0041b845  push 0xb / call 0x40e14d       ; remove_object(11) —— 狗自己消失
 * 0041b84f  mov  ebp, [0x49910c]           ; 当前玩家
 * 0041b855  cmp  ebp, 4 / jge 0x41b8a7     ; ★ NPC（4..7）跳过下面「说台词/咬人」那一段
 * 0041b85a  imul eax, ebp, 0x68
 * 0041b85d  cmp  byte [eax + 0x496b79], 0  ; ★ player + 0x11 = traffic_method
 * 0041b864  je   0x41b89e                  ;   徒步（0）→ 走救护车那一支
 * 0041b866  push edi / push edi            ; arg2 = x = 0、arg3 = y = 0（edi = 0）
 * 0041b868  push 0x228                     ; read_mkf 资源 0x228
 * 0041b873  call 0x450441
 * 0041b87d  push 0x55                      ; arg5 = 音效号 85
 * 0041b87f  push 0x10001                   ; arg4 = flags
 * 0041b888  call 0x45144f                  ; fcn_0045144f（阻塞播放）
 * 0041b891  call 0x456e11                  ; libc_free
 * 0041b899  jmp  0x41c164                  ; ★ 有车这一支**不住院**
 * 0041b89e  push ebp / call 0x40cd07       ; wreck_vehicle(玩家) —— 见下面「0x40cd07 是带闸的」
 * 0041b8a7  push 0  / push 0 / push 0x214  ; read_mkf 资源 0x214
 * 0041b8b7  call 0x450441
 * 0041b8c1  push 0x5d                      ; arg5 = 音效号 93
 * 0041b8c3  push 0x30001                   ; arg4 = flags
 * 0041b8c8  push 0x28 / push 0             ; arg3 = y = 40、arg2 = x = 0
 * 0041b8cd  call 0x45144f                  ; fcn_0045144f（阻塞播放）
 * 0041b8d6  call 0x456e11                  ; libc_free
 * 0041b8de  mov  [0x48baf8], 0             ; 剩余步数清零
 * 0041b8e6  push 3 / push ebp / call 0x43ec3f   ; send_to_hospital(玩家, 3)
 * ```
 *
 * ### `0x40cd07` 是**带闸的**，不是「无条件毁车」（2026-09-19 W-52 订正）
 *
 * ★ 曾经怀疑「徒步那一支（`traffic_method == 0`）却调 `wreck_vehicle`，语义不通」。
 *   回 exe 读了函数体，**自带两道闸 + 一道分支**，对徒步玩家是安全的
 *   （@source `python3 tools/disasm.py va 0x40cd07 24`）：
 * ```asm
 * 0040cd0f  cmp byte [eax + 0x496b7d], 0 / je 0x40cd70   ; player+0x15（who_plays）== 0 → 直接返回
 * 0040cd18  cmp dword [eax + 0x496b9a], 0 / jne 0x40cd70 ; +0x32（住宿/消失/坐牢/住院）非 0 → 直接返回
 * 0040cd21  mov cl, byte [eax + 0x496b79]                ; +0x11 = traffic_method
 * 0040cd27  test cl, cl / je 0x40cd5b                    ; ★ 徒步 → **跳过**扣车那两行
 * 0040cd3b  inc byte [0x497324] / 0040cd43 inc byte [0x497325] ; 机车/汽车各归还一件
 * 0040cd4e  mov byte [eax + 0x496b79], 0                 ; 车没了
 * ```
 *   ⇒ 徒步玩家走的只是 `je 0x40cd5b` 之后那半（清 `ndices` 等收尾），**不碰车**。
 *   所以那一行注释里的 `wreck_vehicle` 名字读窄了，调用本身没问题 —— 不再作为疑点上报。
 *
 * ## 本模块为什么是 **0x214**（不是 0x228）
 *
 * `0x214` 就是「狗咬人」那一段，两条独立证据：
 *   ① 那一段的**嵌入源文件路径**写着 `D:\RICH4\FLCS\DOG.FLC`
 *      （`Data.mkf` 头后 0x80..0x1200 的 ASCII，读法与
 *      `packages/assets-pipeline/src/flic-lottery.test.ts` 的「白送的语义表」同一条）；
 *   ② 徒步那一支在它**之前**先 `wreck_vehicle`、在它**之后**才
 *      `send_to_hospital` —— 正是「狗把座驾咬掉、人抬进医院」这一串。
 *
 * ⚠️ **有车那一支的 `0x228`（嵌入路径 `D:\god-ok.FLC`）不是本模块的事**：
 *   那一段在本引擎的现有口径里**够不到**（core 把 `trafficMethod != 0` 判成
 *   「有车就咬不到 / 不住院」，而原版那一支照样播 0x228 且**不住院** ——
 *   这是一处**既有规则口径**的分歧，按 WORKPLAN §2 规则 4 不自行裁定，
 *   登记在 `docs/deviations/Q-ANIM-2.md` 与 `docs/escalations.md` 的 E-15）。
 *
 * ## 为什么它和救护车是**两段**、各自一段影片
 *
 * 原版是两次 `fcn_0045144f` **串行**（第二段由 `send_to_hospital` 内部再播一次），
 * 中间隔着 `wreck_vehicle` 与 `read_mkf`。本引擎的表现层一次只播一段，
 * 所以 `main.ts` 把救护车那一段**排队**在狗咬那一段之后（`startBoardFilm` 的
 * `after` 参数），次序与原版一致：**狗咬 →（4.332 s）→ 救护车 →（6.2 s）→ 结算**。
 *
 * ## 一处**故意不改**的次序差：狗先离场（W-52 §3.3）
 *
 * 原版 `0x0041b847 call 0x40e14d`（把惡犬从盘上撤掉）在影片**之前**；
 * 本引擎的影片窗口里棋盘按 `before` 画（`boardDrawState()`），所以那 4.3 秒里
 * **狗还画在原地**。影片是整幅 440×440 盖住棋盘的 ⇒ 观感无差，
 * 按任务书 §3.3 **不改**。
 */

import {
  boardFilmSkippable,
  boardFilmTotalMs,
  type BoardFilmSpec,
} from './board-film.ts';

/** 这一段在 Data.mkf @source VA 0x0041b868 / 0x0041b8ab 的 `[0x48a0e4]` */
export const DOG_FX_ARCHIVE = 'Data.mkf';

/** 影片资源号 @source VA 0x0041b868 `push 0x214` */
export const DOG_FX_RESOURCE = 0x214;

/**
 * 影片的**屏幕**落点 @source VA 0x0041b866 `push edi / push edi`。
 *
 * ★ 这一条的压栈次序与其它影片**不一样**：原版在 `0x41b84f` 之后 `edi` 恒为 0
 *   （`0x41b837 mov edi,[0x48baf8]` 且 `0x41b83d test/jne` 已保证它是 0），
 *   于是两个 `push` 压的都是 0 —— 该函数进 `fcn_0045144f` 的 arg2 = x = 0、
 *   arg3 = y = 0。而其它几段（住院/入獄/神明）都写作 `push <y> / push 0`。
 *   **照抄 0**，不替原版「修正」成 0x28。
 */
export const DOG_FX_X = 0;
export const DOG_FX_Y = 0;
/** 与其它棋盘影片同尺寸 —— 逐字节核过资源头 `+8`/`+0xa` = 440×440 */
export const DOG_FX_W = 440;
export const DOG_FX_H = 440;

/**
 * 「狗咬人」那一段的规格。
 *
 * 几何全部逐字节核过 `Data.mkf` 0x214 的 FLIC 头（算法同
 * `packages/assets-pipeline/src/flic.ts` 的 `parseFlicInfo`）：
 * `+0x06` = **38** 帧、`+8`/`+0xa` = 440×440、`+0x10` = **114** ms/帧。
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
  /** @source VA 0x0041b87d `push 0x55`（= 85，`Effect.mkf` 0x55 是 RIFF/WAVE）*/
  sound: 0x55,
  /** @source VA 0x0041b87f `push 0x10001` */
  flags: 0x10001,
};

/** 这一段影片总共播多久（毫秒）= 38 × 114 = 4332 */
export function dogBiteTotalMs(): number {
  return boardFilmTotalMs(DOG_BITE_FILM);
}

/**
 * 这一段能不能被点击/按键打断 —— `flags` 的 bit1（`[0x48c880]`）。
 *
 * @source `fcn_0045144f` VA 0x004514d6：置位时才认 `0x202`/`0x205`/`0x101`。
 *   `0x10001` 的 bit1 = 0 ⇒ 原版这 4.332 秒**点不掉**。
 */
export function dogBiteSkippable(): boolean {
  return boardFilmSkippable(DOG_BITE_FILM);
}

/**
 * 踩到惡犬、且**徒步**（`traffic_method == 0`）那一位 —— 只读两拍状态。
 *
 * 判据（与原版那两支一一对应，见文件头）：
 *   - 原版「徒步」支就在 `cmp byte [player + 0x496b79], 0` 处分成两支，
 *     只有 `traffic_method == 0` 那一支会 `wreck_vehicle` + 播 0x214 + `send_to_hospital(3)`；
 *   - 本引擎的对应物是 `rules/object-landing.ts` 的 `resolveArrival`：
 *     同一支会给出 `dogBite{blockedByVehicle:false}` 且返回 `hospitalDays = 3`
 *     （`HOSPITAL_DAYS_HURT`），于是**徒步玩家的 `inHospital` 计数必然变大**
 *     （`sendToConfinement`，见 `state/reduce.ts` 的「住院」那一段）。
 *     有车那一位返回 `hospitalDays = 0` ⇒ 计数不变 ⇒ **不播**。
 *
 * ⚠️ 为什么不是「计数从 0 变大」：入住过院的人（`inHospital` 非 0）再踩一次狗，
 *   原版照样重播这一段，本判据也照样成立 —— 与 `confineFxTrigger` 的
 *   「占用表 0→1 **或**计数变大」是同一条口径。这里只看**变大**，因为
 *   `resolveArrival` 的住院是**加刑**（`sendToConfinement` 累加天数），
 *   而「天数 1 → 0x80（待释放）」那一步不经过本函数（它发生在 `endTurn`）。
 *
 * @param before / after 同一拍的前后状态（只读 `players[].trafficMethod`
 *   与 `players[].blocking.inHospital`）
 * @returns 该播就返回那一段的规格，否则 `null`
 */
export function dogBiteFxTrigger(
  before: { players: readonly { trafficMethod: number; blocking: { inHospital: number } }[] },
  after: { players: readonly { trafficMethod: number; blocking: { inHospital: number } }[] },
): BoardFilmSpec | null {
  for (let i = 0; i < after.players.length; i++) {
    const b = before.players[i];
    const a = after.players[i];
    if (b === undefined || a === undefined) continue;
    // @source VA 0x0041b85d `cmp byte [player + 0x496b79], 0` /
    //   0x0041b864 `je 0x41b89e` —— 只有徒步那一支才播 0x214
    if (b.trafficMethod !== 0) continue;
    // 住院计数**变大**：原版 0x0041b8e6 `push 3 / call send_to_hospital`
    if ((a.blocking.inHospital & 0x7f) > (b.blocking.inHospital & 0x7f)) return DOG_BITE_FILM;
  }
  return null;
}
