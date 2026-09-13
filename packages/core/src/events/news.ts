/*
 * 新聞事件：可行性判定
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source rich4-re/csrc/news.c `check_news()`
 * @source rich4.asm:22422 fcn_00448be2 @ VA 0x00448be2
 *
 * ✅ **已与汇编交叉核对**（2026-09-13）：汇编的二分派发结构与 C 版的
 * 每一组 case 完全吻合 ——
 *   case 4/5/15  → 同一目标 loc_00448cb4
 *   case 8/9/12  → 同一目标 loc_00448d54
 *   case 10/13   → 同一目标 loc_00448da5
 *   case 6       → 落入 default（C 版确实无此 case）
 * 鉴于 rich4-re 已被发现多处转录错误，取自 C 代码的逻辑一律须如此核对，
 * 见 docs/reverse-engineering-audit.md。
 *
 * 「可行」= 该事件在当前局面下有合法作用对象。例如「全员房屋翻新」
 * 需要场上至少有一栋房子，否则跳过、改抽下一张。
 */

import type { LandInfo, FacilityInfo } from '../loaders/map.ts';
import type { Player } from '../state/types.ts';
import { isAlive } from '../state/types.ts';

/** 判定所需的局面快照 */
export interface NewsContext {
  players: readonly Player[];
  lands: readonly LandInfo[];
  facilities: readonly FacilityInfo[];
  /** 各玩家持股：`stockAmount[playerIndex][stockIndex]` */
  stockAmount: readonly (readonly number[])[];
  /**
   * 地图上的上市企业。
   * `owner` 取自结构偏移 **0x18**（注意与住宅/设施的 0x19 不同）。
   */
  commercials: readonly { owner: number; field0x28: number }[];
  /** 12 支股票的 `stock_info.f6`（偏移 6）@source byte[i*36 + 0x496986] */
  stockF6: readonly number[];
  /**
   * **监狱占用表**（8 项字节，VA 0x00496b30），非 0 表示该槽位有人在押。
   *
   * ★ 原先记作「语义未明的全局标志」，现已查清：
   * - 入狱：`mov byte [idx + 0x496b30], 1`（VA 0x0043d674）
   * - 出狱：`mov byte [idx + 0x496b30], 0`（VA 0x0043d7d5）
   * - 破产：按玩家下标清零
   * - 监狱格落点处理开头 `for (i=0;i<8;i++) if (table[i]) break;`
   *   全为 0（无人在押）时直接返回 —— 即**探监**机制
   *
   * 槽位与 `send_to_prison` 的索引一致：**0..3 是玩家，4..7 是地图物件**
   * （调用点 VA 0x0040ceb6 用的正是 `lea eax, [ebx + 4]`）。
   *
   * 此处传入「是否有任何槽位非 0」的聚合值即可。
   */
  prisonOccupied: number;
  /**
   * **医院占用表**（VA 0x00496b60），与监狱表完全对称。
   *
   * ★ 同样已查清：写入点全部落在医院代码段（0x0043de..0x0043ee）——
   * 入院 `mov byte [idx + 0x496b60], 1`（VA 0x0043ed20），
   * 出院与破产清零；医院格落点处理开头同样先查该表。
   *
   * 监狱表在 0x00496b30，两者相距 0x30；医院代码整体比监狱晚约 0xF30，
   * 这一对结构从数据到代码都是镜像的。
   *
   * 此处传入「是否有任何槽位非 0」的聚合值即可。
   */
  hospitalOccupied: number;
  /**
   * @source case 29 的 `fcn_0040d73f(owner - 1)` —— 语义未明的判定
   * 由调用方提供；返回 true 视为满足。
   */
  checkCommercialOwner: (ownerIndexZeroBased: number) => boolean;
}

/** 有任何住宅或设施已建有房屋（level != 0） */
function anyBuilt(ctx: NewsContext): boolean {
  return (
    ctx.lands.some((l) => l.level !== 0) || ctx.facilities.some((f) => f.level !== 0)
  );
}

/** 有任何无主地块 */
function anyUnowned(ctx: NewsContext): boolean {
  return (
    ctx.lands.some((l) => l.owner === 0) || ctx.facilities.some((f) => f.owner === 0)
  );
}

/** 有任何有主地块 */
function anyOwned(ctx: NewsContext): boolean {
  return (
    ctx.lands.some((l) => l.owner !== 0) || ctx.facilities.some((f) => f.owner !== 0)
  );
}

/** 有在场玩家持有任何股票 */
function anyoneHoldsStock(ctx: NewsContext): boolean {
  for (let i = 0; i < ctx.players.length; i++) {
    const p = ctx.players[i];
    if (p === undefined || !isAlive(p)) continue;
    const holdings = ctx.stockAmount[i];
    if (holdings === undefined) continue;
    for (const amount of holdings) if (amount !== 0) return true;
  }
  return false;
}

/** 有在场玩家的 traffic_method 满足条件 */
function anyoneWithTraffic(ctx: NewsContext, wantZero: boolean): boolean {
  return ctx.players.some((p) => {
    if (!isAlive(p)) return false;
    return wantZero ? p.trafficMethod === 0 : p.trafficMethod !== 0;
  });
}

/**
 * 新聞事件是否可在当前局面下触发。
 *
 * @source news.c `check_news(v)` 的 switch。**未列出的编号一律可行**
 *   （原版 `default: return 1`）。
 */
export function isNewsFeasible(eventId: number, ctx: NewsContext): boolean {
  switch (eventId) {
    case 0:
    case 1:
      // 事件 0/1 需要**有人在监狱里**
      return ctx.prisonOccupied !== 0;

    case 2:
    case 3:
      // 事件 2/3 需要**有人在医院里**
      return ctx.hospitalOccupied !== 0;

    case 4:
    case 5:
    case 15:
      return anyBuilt(ctx);

    case 7:
      return anyUnowned(ctx);

    case 8:
    case 9:
    case 12:
      return anyOwned(ctx);

    case 10:
    case 13:
      return anyoneHoldsStock(ctx);

    case 16:
      return anyoneWithTraffic(ctx, true);

    case 17:
      return anyoneWithTraffic(ctx, false);

    case 28:
      // 12 支股票中任一 f6 != 0
      return ctx.stockF6.some((v) => v !== 0);

    case 29:
      return ctx.commercials.some(
        (c) => c.owner !== 0 && ctx.checkCommercialOwner(c.owner - 1),
      );

    case 35:
      // @source `dword[com + 0x28] > 10000`
      return ctx.commercials.some((c) => c.field0x28 > 10_000);

    default:
      // @source default: return 1
      return true;
  }
}

/**
 * 有可行性约束的事件编号集合。
 * 不在此集合中的事件恒可触发。
 */
export const CONSTRAINED_NEWS_IDS: readonly number[] = [
  0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 15, 16, 17, 28, 29, 35,
];
