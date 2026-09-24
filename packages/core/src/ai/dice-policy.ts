/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * AI 掷几颗骰子（骑车 / 开车时）
 *
 * ★ 第二十一份試玩回報「这个AI怎么这么蠢 明明背着定时炸弹还要开车并且扔3颗骰子，
 *   这样车也炸没了」。
 *
 * ## 原版：`fcn_004221c0`（唯一调用点 VA 0x00418e70）
 *
 * 电脑回合在「用卡 / 用道具」之后、起步（`0x00418e75 call 0x40dd1f`）之前调它一次，
 * 按局面**改写** `player+0x12`（骰子数）：
 *
 * ```asm
 * 004221c9  mov dl, byte [p + 0x11]      ; 交通方式（整字节比，不是 &3）
 * 004221cf  cmp dl, 2 / jne 0x422319     ; ── 汽車 ──
 * 004221d8  mov byte [p + 0x12], 3       ;   默认 3 颗
 * 004221df  mov dh, byte [p + 0x40]      ;   身上的定時炸彈（物件下标 + 1）
 * 004221e5  test dh, dh / je 0x42221e    ;   没背炸彈 → 看前面 5 格
 * 004221f5  mov dl, [idx*24 + 0x496d0c]  ;   炸彈引信（剩余格数）
 * 00422202  cmp edx, 0xf / jl 0x422439   ;   ★ 引信 < 15 ⇒ [p+0x12] = 1（只掷 1 颗）
 * 0042220b  cmp edx, 0x14 / jle 0x422440 ;   15..20 ⇒ 保持 3 颗
 * 00422214  mov byte [p + 0x12], 3       ;   > 20 ⇒ 3 颗
 * 0042221e  push 5 / call 0x40b221       ;   前瞻 5 格（b8b4）
 *           ; 逐格：地块/設施「无主或我的」→ ebx++；「别人的」→ esi++（其它格不计）
 * 004222d8  if (ebx == 0 && esi > 2)  [p+0x12] = 2 + (rand() & 1)   ; 0x004222e1
 * 004222fb  if (ebx >= 2 && esi <= 1) [p+0x12] = 1                  ; 0x00422439
 * 00422319  cmp dl, 1 / jne 0x422440     ; ── 機車 ──（其余交通方式：不动）
 * 00422322  mov byte [p + 0x12], 2       ;   默认 2 颗
 * 00422329  mov bh, byte [p + 0x40]      ;   背着炸彈：引信 < 15 ⇒ 1 颗（0x00422351），否则 2 颗
 * 0042235d  push 5 / call 0x40b221       ;   同一套计数
 * 00422411  if (ebx == 0 && esi > 2)  [p+0x12] = 2                   ; 0x00422421
 * 00422428  if (ebx >= 2 && esi <= 1) [p+0x12] = 1                   ; 0x00422439
 * ```
 *
 * 调用点前的闸门（VA 0x00418e2d..0x00418e6e）：`+0x32` 四字节（住店/消失/坐牢/住院）、
 * `+0x37`（夢遊）、`+0x36`（睡眠）任一非 0 ⇒ 这一回合不走、也不调它。
 *
 * ★ 所以原版电脑**会**背着炸彈上车（汽車判定 `0x00421675` 只看交通方式 + `rand()%4`，
 *   不看 `+0x40`），但掷骰前会按引信把骰子数压到 1 颗 —— 回报现场引信 7、掷了 3 颗，
 *   是本引擎先前**根本没有这一步**（AI 骑上车就永远是 `VEHICLE_DICE` 的满数）。
 *
 * ⚠️ `rand() & 1` 在纯策略层用 `aiRoll` 的确定性替身（D-004，与卡片/道具同一约定）；
 *   它只依赖 `rngState`，`setDiceCount` 不改 `rngState` ⇒ 同一局面答案固定，不会来回改。
 */

import type { MapTopology } from '../state/reduce.ts';
import type { GameState } from '../state/types.ts';
import type { FacilityInfo, LandInfo } from '../loaders/map.ts';
import { aiRoll, lookahead } from './card-policy.ts';

/** 引信低于这个格数就只掷 1 颗 @source VA 0x00422202 / 0x0042234e `cmp edx, 0xf / jl` */
export const AI_BOMB_FUSE_ONE_DIE = 0xf;

/** 前瞻格数 @source VA 0x0042221e / 0x0042235d `push 5 / call 0x40b221` */
export const AI_DICE_LOOKAHEAD = 5;

/** 汽車 / 機車（`player+0x11` 整字节）@source VA 0x004221cf `cmp dl, 2` / 0x00422319 `cmp dl, 1` */
const TRAFFIC_BYTE_CAR = 2;
const TRAFFIC_BYTE_MOTORCYCLE = 1;

/** `aiRoll` 的盐 —— 取各自那次 `call` 的 VA（D-004） */
const SALT_CAR_LOOKAHEAD = 0x422227;
const SALT_MOTO_LOOKAHEAD = 0x422366;
const SALT_CAR_RAND = 0x4222e1;

/**
 * 电脑这一回合该掷几颗骰子（`fcn_004221c0` 写进 `player+0x12` 的值）。
 *
 * @returns 该改成的骰子数；**不改**（步行 / 工程車 / 被闸门挡下）时 `null`
 */
export function aiDiceCount(
  state: GameState,
  topo: MapTopology,
  lands: readonly LandInfo[],
  facilities: readonly FacilityInfo[],
): number | null {
  const meIndex = state.currentPlayer;
  const me = state.players[meIndex];
  if (me === undefined) return null;
  // @source 0x00418e36 `cmp dword [p+0x32], 0` / 0x00418e3f `cmp byte [p+0x37], 0` /
  //   0x00418e48 `cmp byte [p+0x36], 0` —— 任一非 0 ⇒ 跳过（不调 0x4221c0）
  const b = me.blocking;
  if (
    b.inHotel !== 0 ||
    b.disappearing !== 0 ||
    b.inPrison !== 0 ||
    b.inHospital !== 0 ||
    b.sleepWalking !== 0 ||
    b.sleeping !== 0
  ) {
    return null;
  }

  const traffic = me.trafficMethod;
  const car = traffic === TRAFFIC_BYTE_CAR;
  if (!car && traffic !== TRAFFIC_BYTE_MOTORCYCLE) return null; // @source 0x0042231c jne 0x422440
  let dice = car ? 3 : 2; // @source 0x004221d8 / 0x00422322

  // ── 背着定時炸彈：只看引信 ──
  if (me.f64 !== 0) {
    const fuse = state.objects[me.f64 - 1]?.state ?? 0;
    // @source 0x00422202 / 0x0042234e：引信 < 15 ⇒ 1 颗；否则维持默认（汽車 3 / 機車 2）
    return fuse < AI_BOMB_FUSE_ONE_DIE ? 1 : dice;
  }

  // ── 没背炸彈：前瞻 5 格数地产 ──
  const ahead = lookahead(
    topo,
    state,
    me.nodeId,
    me.lastNodeId,
    AI_DICE_LOOKAHEAD,
    car ? SALT_CAR_LOOKAHEAD : SALT_MOTO_LOOKAHEAD,
  );
  const me1 = meIndex + 1;
  let safe = 0; // ebx：无主或我的
  let hostile = 0; // esi：别人的
  for (const nid of ahead.nodes) {
    const node = topo.nodes[nid - 1];
    if (node === undefined) continue;
    let owner: number | null = null;
    // @source node+0x20：0x7d0 < 实体 < 0xfa0 ⇒ 地块（+0x19 = 主人）；0xfa0 < 实体 < 0x1770 ⇒ 設施
    if (node.ref.kind === 'land') {
      const id = node.ref.index;
      owner = lands.find((l) => l.id === id)?.owner ?? null;
    } else if (node.ref.kind === 'facility') {
      const id = node.ref.index;
      owner = facilities.find((f) => f.id === id)?.owner ?? null;
    }
    if (owner === null) continue;
    if (owner === 0 || owner === me1) safe++;
    else hostile++;
  }
  // @source 0x004222d8 / 0x00422411：前面全是别人的（≥3 块）⇒ 冲过去
  if (safe === 0 && hostile > 2) dice = car ? 2 + aiRoll(state, SALT_CAR_RAND, 2) : 2;
  // @source 0x004222fb / 0x00422428：前面有 ≥2 块能买/能盖、别人的 ≤1 块 ⇒ 只掷 1 颗慢慢走
  if (safe >= 2 && hostile <= 1) dice = 1;
  return dice;
}
