/*
 * 关押：监狱与医院
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 两者在原版里是**镜像结构**——数据、代码、流程一一对应，
 * 故合成一个模块，只用一个 `kind` 区分。
 *
 * |  | 监狱 | 医院 |
 * |---|---|---|
 * | 计数字段 | `+0x34` | `+0x35` |
 * | 占用表 | `0x00496b30` | `0x00496b60` |
 * | 送入函数 | `0x0043d593` | `0x0043ec3f` |
 * | 释放函数 | `0x0043d7bf` | `0x0043ee6e` |
 * | 落点处理 | `0x0043d304` | `0x0043e9a4` |
 *
 * 医院代码整体比监狱晚约 0xF30，两张占用表相距 0x30。
 */

import type { BlockingDays, Player } from '../state/types.ts';
import { RELEASE_PENDING } from './blocking.ts';

export type ConfinementKind = 'prison' | 'hospital';

/** 计数字段名 */
const COUNTER: Record<ConfinementKind, keyof BlockingDays> = {
  prison: 'inPrison',
  hospital: 'inHospital',
};

/**
 * 占用表的槽位数。
 * @source 监狱落点处理开头 `for (i=0; i<8; i++) …`（VA 0x0043d313 的 `cmp ebx, 8`）
 *
 * ★ 槽位与送入函数的索引一致：**0..3 是玩家，4..7 是地图物件**。
 *   送入函数以 `cmp idx, 4 / jge 物件分支` 分流；
 *   调用点 VA 0x0040ceb6 传的正是 `lea eax, [ebx + 4]`。
 */
export const CONFINEMENT_SLOTS = 8;
/** 物件槽位的起始下标 @source `cmp ebx, 4 / jge 物件分支` */
export const OBJECT_SLOT_BASE = 4;

/**
 * 已知的关押天数取值（由**调用方**传入，不是常量）。
 *
 * 监狱 @source `send_to_prison` 的调用点：
 * - 陷害卡：目标是自己 4 天，别人 5 天（VA 0x0044460b）
 * - 另一处固定 3 天（VA 0x00431e65）
 * - 物件分支固定 5 天（VA 0x0044467a）
 *
 * 医院 @source `send_to_hospital` 的 10 个调用点中已辨认的：
 * 3 天（VA 0x004470dc、0x00447bf2）、0 天（VA 0x0040aed3、0x0041c824）
 *
 * ⚠️ 其余调用点的天数尚未逐一核对，故此处**不给默认值**——
 * 天数一律由调用方显式给出，避免臆测。
 */
export const KNOWN_PRISON_DAYS = { self: 4, other: 5, object: 5 } as const;

export interface ConfineResult {
  players: Player[];
  /** 更新后的占用表 */
  occupancy: number[];
  /** 是否为**加刑**（原本就在里面） */
  extended: boolean;
  /** 最终的计数值 */
  days: number;
}

/**
 * 把玩家关进监狱／医院。
 *
 * @source `send_to_prison`（VA 0x0043d593）：
 * ```asm
 * dh = player.days_in_prison
 * test dh, dh
 * jne  加刑路径                      ; ★ 已在里面 → 累加
 * …移动到监狱格、播动画…
 * counter = days                     ; 新判（VA 0x0043d65d）
 * byte [idx + 0x496b30] = 1          ; 占用表置位（VA 0x0043d674）
 *
 * 加刑路径（VA 0x0043d6bd）：
 * cl = existing + days
 * counter = cl
 * ch = cl & 0x7f                     ; ★ 清掉进位可能误置的「待释放」位
 * counter = ch
 * ```
 *
 * ★ 末尾那句 `and ch, 0x7f` 正是 0x80 为状态位而非计数位的反证——
 *   它存在就是为了防止 `existing + days` 进位到 0x80。
 */
export function confine(
  players: readonly Player[],
  occupancy: readonly number[],
  kind: ConfinementKind,
  index: number,
  days: number,
): ConfineResult {
  const field = COUNTER[kind];
  const nextOcc = [...occupancy];
  const p = players[index];

  if (p === undefined) {
    return { players: [...players], occupancy: nextOcc, extended: false, days: 0 };
  }

  const existing = p.blocking[field];
  // @source test dh, dh / jne 加刑路径
  const extended = existing !== 0;
  // @source 加刑：(existing + days) & 0x7f；新判：直接赋值
  const value = extended ? (existing + days) & 0x7f : days;

  nextOcc[index] = 1; // @source mov byte [idx + 表基址], 1
  const next = players.map((q, i) =>
    i === index ? { ...q, blocking: { ...q.blocking, [field]: value } } : q,
  );

  return { players: next, occupancy: nextOcc, extended, days: value };
}

/**
 * 释放。
 *
 * @source `0x0043d7bf`：玩家（索引 < 4）走 `call 0x0040d6be` 回到地图，
 * 然后 `byte [idx + 0x496b30] = 0`。
 *
 * 计数字段本身在递减流程里已被清零（见 `rules/blocking.ts`：
 * 看到 `0x80` 时返回 `release: true` 并置 0），此处只负责清占用表。
 */
export function release(
  occupancy: readonly number[],
  index: number,
): number[] {
  const next = [...occupancy];
  next[index] = 0;
  return next;
}

/** 是否有人被关着——新闻事件 0/1（监狱）与 2/3（医院）的前置条件 */
export function anyoneConfined(occupancy: readonly number[]): boolean {
  return occupancy.some((v) => v !== 0);
}

/**
 * 关押是否**刑满待释放**。
 * 计数值等于 `RELEASE_PENDING` 时，下一次推进就会放人。
 */
export function isReleasePending(p: Player, kind: ConfinementKind): boolean {
  return p.blocking[COUNTER[kind]] === RELEASE_PENDING;
}
