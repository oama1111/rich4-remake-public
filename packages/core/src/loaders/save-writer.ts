/*
 * 原版存档「状态块」的写出
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ **本模块目前是「部分实现」，不要当成完整的写档器。**
 *
 * 目标（`docs/gaps/07-data-contracts.md` 的阻断项 B）是让 remake 能写出
 * **原版能读的**存档。完整的写档器要求把 42 个静态块**逐个映射到 `GameState`**，
 * 这需要若干尚未编写的序列化器（`player` 0x68、`specialActors` 16、
 * `objects_info` 24、`market.stocks` 36、`holdings` 8、`history` 4 …）。
 *
 * 本模块先把**可以确证的那一层**做出来并用真实存档验证：
 *
 *   ① 42 块表（`save-block-table.ts`，机械提取自权威规格）
 *      —— `assertSaveBlockTable()` 断言它们**恰好铺满** `[0x0004, 0x274b)`，
 *         无空洞、无重叠。这一条能抓住任何 offset/size 抄写错误。
 *   ② **已建模块**的写出：由 `GameState` 直接产生字节。
 *   ③ **未建模块**由调用方以 `carry` 提供原始字节（来自源存档），并在
 *      `carriedBlocks()` 里**显式列出** —— 这样没人会误以为写档器已完整。
 *
 * 验证方式（`save-writer.test.ts`）：
 *   · 对两份真实存档做**逐字节往返**（carry 用存档自身）；
 *   · 再把 carry **清零**，断言**已建模块**仍然逐字节相等
 *     —— 这一条才是"这些块真的从 `GameState` 写出来"的证据。
 */

import type { GameState } from '../state/types.ts';
import type { Rich4Map } from './map.ts';
import { characterById } from '@rich4/data';
import { writeMapBlock } from './map-writer.ts';
import { withLiveMapState } from './map-state.ts';
import { ORIGINAL_PLAYER_SNAPSHOT_SIZE as SNAPSHOT_SIZE } from './save-block-table.ts';
import {
  ORIGINAL_SAVE_BLOCKS,
  ORIGINAL_SAVE_HEADER,
  ORIGINAL_STATE_BLOCK_SIZE,
  type SaveBlock,
} from './save-block-table.ts';

export {
  ORIGINAL_SAVE_BLOCKS,
  ORIGINAL_SAVE_HEADER,
  ORIGINAL_STATE_BLOCK_SIZE,
  ORIGINAL_PLAYER_SNAPSHOT_SIZE,
} from './save-block-table.ts';


/** 已建模的块：字节**由 `GameState` 产生**，不依赖 `carry` */
export const MODELED_BLOCK_OFFSETS: readonly number[] = [
  0x0004, // 游戏日期（day | month<<8 | year<<16）
  0x0008, // gameMap（= globalMapId % 4）
  0x000a, // gameStage（= floor(globalMapId / 4)）
  0x000c, // numPlayers
  0x01b0, // 人类玩家数 [0x499104]（第 61 条：改为状态字段，不再现数）
  0x0654, // playerCards（4 × 15）
  0x0690, // toolAmount（4 × 15，槽序 = 道具号 − 1）
  0x06cc, // cardAmount（30）
  0x06ea, // 全局道具库存（8，下标 = 道具号 − 1）
  0x06f2, // 行情历史写游标
  0x06f6, // 行情历史 12 × 144 f32（6,912 字节，单块最大）
  0x21f6, // 各玩家持仓 4 × 12 × 8
  0x2676, // 当前玩家
  0x267e, // 土地權限档位 [0x499110]
  0x2682, // 勝利條件·天 [0x49911c]
  0x2686, // 勝利條件·資產 [0x499108]
  0x268a, // 開局資金档 [0x49908c]
  0x268e, // 物价指数 [0x4990e8]
  0x2692, // 已过天数
  0x2696, // 已过月数
  0x26a2, // 当前指数
  0x26ba, // 公库
  0x26be, // 樂透号码表（36）
  0x26e2, // 监狱占用表（8）
  0x26ea, // 医院占用表（8）
  0x26f2, // 新聞游标
  0x26f6, // 命運游标
  0x26fa, // 新聞牌堆（36）
  0x271e, // 命運牌堆（37）
  0x2743, // 地图视角旋转
  0x2747, // 地图数据块长度（写的是入参 `mapDataSize`，不是状态字段）
];

/**
 * ⚠️ 已知**没有对应字段**、因此只能靠 `carry` 的块（不是"还没写"，是"状态里没有"）：
 *   · `0x269e` → `[0x49907c]` = `trunc(Σ12 初始价 × 10)`（开盘指数）。
 *     `StockMarketState` 只存 `index`（当前指数 `0x499078`），没有开盘指数字段。
 *   · `0x269a` → `[0x4990dc]`、`0x26a6` → `[0x4990ec]`（后者两个样本读出来都像 f32 位型：
 *     Save0 = 3215265199 ≈ −1.25、SAVE1 = 1057490816 ≈ 0.56 —— **语义未决**）。
 *   · `0x269e` → `[0x49907c]`（开盘指数）与之并列，`SaveGame` 侧未定名。
 *   ⚠️ 先前这里把 `0x268e` 也列进了本表，并说它是「全股市休市天数」——**两处都错**：
 *     `0x268e` 就是 `save.ts` 的 `OFFSET.priceIndex`（物价指数，实测 Save0 = 5 / SAVE1 = 1），
 *     写侧只是**漏写**，已补（见 `MODELED_BLOCK_OFFSETS`）。
 */

/**
 * **部分建模**的块：只写了其中一部分字段，其余仍取 `carry`。
 *
 * 因此它们**不能**参加"清零 carry 后仍相等"那条断言（那是给**完全建模**块用的），
 * 只能参加"carry=原文时逐字节相等"。这样断言与实现是相符的，不夸大。
 */
export const PARTIALLY_MODELED_BLOCK_OFFSETS: readonly number[] = [
  0x0010, // 玩家块 4×0x68：已写 34 个字段（f100 = landingWhoPlays，有才写），color/name/f27/f74 仍走 carry
  0x2376, // 12 支股票记录 36B/条：每条 `+0x00` 的 4 字节未建模，其余 11 字段已写
  0x01b4, // 特殊角色 5×16：`x/y` 与 `f10/f11` 未建模（状态里没有 x/y）
  0x0204, // 地图物件 46×24：只建模 `type/nodeId/state/attached` 5 字节，其余 19 字节未建模
  0x2526, // 公佈欄挂牌表 4×7×12：只剩 `+1`(天龄，原版只写不读) 走 carry，其余 11 字节都由 state 写出
];

/** 尚未建模、必须由 `carry` 提供的块 */
export function carriedBlocks(): readonly SaveBlock[] {
  return ORIGINAL_SAVE_BLOCKS.filter(
    (b) =>
      !MODELED_BLOCK_OFFSETS.includes(b.offset) &&
      !PARTIALLY_MODELED_BLOCK_OFFSETS.includes(b.offset),
  );
}

/**
 * 断言 42 块表**恰好铺满** `[0x0004, 0x274b)`。
 *
 * 这是本模块最有价值的一条：**任何 offset/size 的抄写错误都会在这里炸**，
 * 而且不需要真实存档。
 */
export function assertSaveBlockTable(): void {
  let cursor = 0x0004;
  for (const b of ORIGINAL_SAVE_BLOCKS) {
    if (b.offset !== cursor) {
      throw new Error(
        `块表不连续：期望偏移 0x${cursor.toString(16)}，实际 0x${b.offset.toString(16)}`,
      );
    }
    if (b.count * b.size !== b.bytes) {
      throw new Error(
        `块 @0x${b.offset.toString(16)} 的 count×size ≠ bytes（${b.count}×${b.size} ≠ ${b.bytes}）`,
      );
    }
    cursor += b.bytes;
  }
  if (cursor !== ORIGINAL_STATE_BLOCK_SIZE) {
    throw new Error(
      `块表未铺满状态块：结束于 0x${cursor.toString(16)}，应为 0x${ORIGINAL_STATE_BLOCK_SIZE.toString(16)}`,
    );
  }
}

/**
 * 单个玩家记录（0x68 字节）的布局 —— **照 `save.ts` 的 `parsePlayer` 逐字段列出**，
 * 那份解析器是权威（每个字段都带 @source）。写出就是它的逆。
 */
const PLAYER_SIZE = 0x68;

/**
 * 写出 4×0x68 的玩家块（`0x0010`）。
 *
 * ⚠️ **只写字段名与 `GameState.Player` 一一对应、且经往返测试验证过的那些**；
 * 其余字节保持 `carry` 的原值（在函数末尾列出未写字段）。
 * 注意：**卡片与道具不在这 0x68 里** —— 它们各有独立的块
 * （`0x0654` playerCards / `0x0690` toolAmount）。
 */
function writePlayerBlock(out: Uint8Array, state: GameState, off: number): void {
  for (const p of state.players) {
    const o = off + p.index * PLAYER_SIZE;
    // ★★ `+0x00`（名字串指针）与 `+0x04`（代表色）**不是状态，是角色表的常量**：
    //   读档时原版自己会用 `character` 重新推导 `+0x00`
    //   （`@source 0x00402b9f`–`0x00402bae`，见 `@rich4/data` 的 `CharacterDef.namePointer`），
    //   而 `+0x04` 全 exe **没有任何一处写过**（只被 `0x40829d`/`0x40a4e1`/
    //   `0x415f69`/`0x4166f8` 读），两份存档 8/8 与角色表逐位相同。
    //   ⇒ 二者都由 `character` 查表得到，**不需要给 `GameState.Player` 加字段**。
    const ch = characterById(p.character);
    if (ch !== undefined) {
      u32(out, o + 0x00, ch.namePointer);
      u32(out, o + 0x04, ch.color);
    }
    // ★ 这四个是 **u16**：用 u32 写会连带覆盖下一个字段
    //   （实测 `+0x08` 的 4 字节会盖掉 `+0x0a` ypos、`+0x0c` 会盖掉 `+0x0e` lastNodeId ——
    //    往返测试抓到的）
    u16(out, o + 0x08, p.xpos);
    u16(out, o + 0x0a, p.ypos);
    u16(out, o + 0x0c, p.nodeId);
    u16(out, o + 0x0e, p.lastNodeId);
    out[o + 0x10] = p.direction & 0xff;
    out[o + 0x11] = p.trafficMethod & 0xff;
    out[o + 0x12] = p.ndices & 0xff;
    out[o + 0x13] = p.character & 0xff;
    out[o + 0x15] = p.whoPlays & 0xff;
    // ★ `+0x64`（落地时抄进 `who_plays` 的那一份，见 `Player.landingWhoPlays`）——
    //   第一輪里存的档，还没上盘的人全靠它；没有这一格（旧状态）就保持 carry
    if (p.landingWhoPlays !== undefined) out[o + 0x64] = p.landingWhoPlays & 0xff;
    // ★ 审计 2026-09-25（loop）：开着工程車时 `+0x64/+0x65` 是開車前的交通方式 / 骰子数（`0x00447a49` / `0x00447a55`）
    if ((p.trafficMethod & 3) === 3 && p.engineSavedTraffic !== undefined) {
      out[o + 0x64] = p.engineSavedTraffic & 0xff;
      out[o + 0x65] = (p.engineSavedDice ?? 0) & 0xff;
    }
    // `+0x1b`：朝向后备（`Player.savedFacing`）；旧状态没有这一格就 carry
    if (p.savedFacing !== undefined) out[o + 0x1b] = p.savedFacing & 0xff;
    u32(out, o + 0x1c, p.cash);
    u32(out, o + 0x20, p.moneyInBank);
    u32(out, o + 0x24, p.loan);
    u32(out, o + 0x28, p.specialFinance);
    u32(out, o + 0x2c, p.loanDueDate);
    // +0x30 是 u16 的 points
    out[o + 0x30] = p.points & 0xff;
    out[o + 0x31] = (p.points >> 8) & 0xff;
    out[o + 0x32] = p.blocking.inHotel & 0xff;
    out[o + 0x33] = p.blocking.disappearing & 0xff;
    out[o + 0x34] = p.blocking.inPrison & 0xff;
    out[o + 0x35] = p.blocking.inHospital & 0xff;
    out[o + 0x36] = p.blocking.sleeping & 0xff;
    out[o + 0x37] = p.blocking.sleepWalking & 0xff;
    out[o + 0x38] = p.blocking.stopping & 0xff;
    out[o + 0x39] = p.blocking.tortoiseWalking & 0xff;
    out[o + 0x14] = p.isMale ? 1 : 0; // 非 0 是男、0 是女（parsePlayer: isFemale = (v===0)）
    out[o + 0x16] = p.aiFlags & 0xff; // f22
    out[o + 0x17] = p.personality & 0xff; // f23（候选：往返确认）
    out[o + 0x1a] = p.stockRatio & 0xff; // f26（候选：往返确认）
    out[o + 0x18] = p.loanRatio & 0xff; // f24
    out[o + 0x19] = p.cashRatio & 0xff; // initCashRatio
    out[o + 0x3b] = p.daysRejectedByBank & 0xff;
    out[o + 0x3d] = p.alliedDays & 0xff; // f60
    out[o + 0x3e] = p.insuranceDays & 0xff; // daysAssurance
    out[o + 0x3f] = p.godInfo & 0xff;
    out[o + 0x40] = p.f64 & 0xff;
    out[o + 0x41] = p.alliedPlayer & 0xff;
    // ★ 神明附身的三项修正（u16，可为负 ⇒ 写出的是补码）
    //   @source 0x40ead7（附身写）/ 0x40e14d（送走清）；三项值与 `rules/objects.ts`
    //   的 `GOD_MODIFIERS` 表逐项相同（快照实测「天使 = -100/60/60」已对上）。
    u16(out, o + 0x44, p.misfortune); // f68
    u16(out, o + 0x46, p.fortune); // f70
    u16(out, o + 0x48, p.luck); // f72
    // ★ 夢遊卡的「睡前的移动方式 / 骰子数」备份 —— 不写就会在
    //   「梦游中被存档 → 读回 → 醒来」时把这两项还原成 undefined。
    //   @source 0x4441dc：`mov dl,[+0x11] / mov [+0x66],dl`、`mov dl,[+0x12] / mov [+0x67],dl`
    out[o + 0x66] = p.savedTrafficMethod & 0xff;
    out[o + 0x67] = p.savedNdices & 0xff;
    for (let k = 0; k < 6; k++) u32(out, o + 0x4c + k * 4, p.hostility[k] ?? 0);
    out[o + 0x42] = p.totalWinterSleepDays & 0xff;
    u32(out, o + 0x5c, p.monthlyPaid);
    u32(out, o + 0x60, p.monthlyReceived);
  }
}

/**
 * ⚠️ **玩家块里仍未写的字节**（保持 `carry`）—— 这是**往返测试逐字节量出来的**，
 * 不是"看起来还剩几个"：
 *
 * | 块内偏移 | `parsePlayer` 的名字 | 实测值（Save0 玩家0 / SAVE1 玩家0）| 为什么没写 |
 * |---|---|---|---|
 * | ~~`+0x1b`~~ | `f27` | 非 0（仅 Save0）| **已写**（审计 2026-09-25）：= `Player.savedFacing`（住店前朝向 / 关押哨兵 0xf，`0x00418f2e` 读）|
 * | `+0x4a` (u16) | `f74` | 非 0（仅 Save0）| 同上（本次移动的目标节点，唯一读者是行走函数 `0x40c05c`）|
 * | `+0x43` | `f67` | 恒 0 | **全 exe 无读无写的死字节**（`0x496bab` 的读写点都为空）|
 * | ~~`+0x64`~~ | `f100` | — | **已写**（2026-09-24）：= `Player.landingWhoPlays`（开局写 1/2 `0x004072f9`、落地时抄进 `+0x15` `0x00418d07`、破产 memset 清 0 ⇒ Save0 的 `0,1,0,0` 正是三人破产后剩一名真人，不再矛盾）；旧状态没有这一格时仍 carry |
 * | `+0x65` | `f101` | 恒 0 | **已解**（审计 2026-09-25）：工程車開車前的骰子数，`0x00447a55` 写、`0x0041cd26` 读 ⇒ `Player.engineSavedDice`（开着工程車才写）|
 *
 * ★★ **`+0x00` 与 `+0x04` 已解决，且不需要新增状态字段**（2026-09-17 订正）：
 *   先前这张表把它们记成「`GameState.Player` 里没有名字/颜色字段」，那是**看错了方向**。
 *   它们**根本不是状态**，而是角色表 `0x47e80c`（stride `0x68`）的常量：
 *   · `+0x00` = `CharacterDef.namePointer`（名字串指针）。**读档时原版自己会覆盖它** ——
 *     `@source 0x00402b9f`–`0x00402bae`：`dl = player.character` → `imul edx,0x68` →
 *     `mov edx, [edx + 0x47e80c]` → `mov [eax + 0x496b68], edx`。
 *     存档里存的是**存档那一刻的进程地址**，跨进程无意义。
 *   · `+0x04` = `CharacterDef.color`。全 exe **没有任何一处写它**
 *     （`gen/xrefs` + 全函数 `writes` 扫描：`0x496b6c` 的写者为空），只被四处读；
 *     两份真实存档 8/8 与角色表逐位相同。
 *   ⇒ 二者都按 `character` 查 `@rich4/data` 的表写出（见 `writePlayerBlock`），
 *     实测「carry 清零后 `+0x00..+0x07` 仍与原文件逐字节相等」。
 *
 * ★ 已由**往返测试确认**的候选映射（两份存档都逐字节对上，故不再是猜测）：
 *   `+0x17` ← `personality`、`+0x1a` ← `stockRatio`。
 *   ⚠️ **反面教材**：`+0x44`/`+0x46`/`+0x48` 先前也被列进这一句，但两份样本**这三格全是 0**
 *   —— 「都是 0 == 都是 0」的逐字节相等是**空的**。真正把它们定下来的是
 *   **時光機快照里的历史数据**（Save0 slot0 的玩家 0 = `-100/60/60` = 天使三项修正，
 *   与 `rules/objects.ts` 的表逐项吻合）。**"两份样本都对上"只在样本非平凡时才算证据。**
 *   另有 `+0x14` ← `isMale`（非 0 为男）、`+0x16` ← `aiFlags`、`+0x18` ← `loanRatio`、
 *   `+0x19` ← `cashRatio`、`+0x3d` ← `alliedDays`、`+0x3e` ← `insuranceDays`、
 *   `+0x3f` ← `godInfo`、`+0x40` ← `f64`、`+0x41` ← `alliedPlayer`、`+0x4c..0x63` ← `hostility[6]`。
 */

/**
 * ⚠️ **仍然整块走 `carry` 的 7 块**（2026-09-17 逐偏移对账后的现状；
 *   对账脚本 `tools/scratch/audit-state-block.py`，可随时复跑）：
 *
 * | 块 | 全局 | 为什么没写 |
 * |---|---|---|
 * | ~~`0x01b0`~~ | `[0x499104]` | ✅ **已建模**（第 61 条）：人类玩家数改为**状态字段** `state.humanPlayers`（开局算一次、之后不变），不再靠 `whoPlays` 现数 |
 * | ~~`0x2526`~~ | `0x4967e0` | ✅ **已并入部分建模**（第 52 条）：挂牌表 4×7×12，`+0/+2/+4/+8` 由 `state.noticeBoard` 写出；`+1`(天龄) 与 `+a/+b`(地產快照) 走 carry。**先前整块走 carry ⇒ 挂牌在存档往返里丢失** |
 * | `0x267a` | `0x499118` | 未定名（样本值见 `save-scalars.md`）|
 * | `0x269a` | `0x4990dc` | 未定名（样本恒 0）|
 * | `0x269e` | `[0x49907c]` | **状态里根本没有**开盘指数字段（它是 12 支股票初始价的派生量）|
 * | `0x26a6` | `0x4990ec` | 未定名；两个样本读出来都像 f32 位型（Save0 ≈ −1.25、SAVE1 ≈ 0.56）|
 * | `0x26aa` | `0x4990f0` | 剧情模式**剧本通关标志**（4 字节）——状态里没有对应字段 |
 * | `0x26ae` | `0x4990f4` | **12 个角色槽的状态表**（12 字节）——状态里没有对应字段 |
 *
 * 其余 36 块**由 `GameState` 写出**；其中 31 块是**完全建模**（参加「carry 清零后
 * 仍逐字节相等」那条强断言），4 块是**部分建模**（玩家 0x68 / 特殊角色 5×16 /
 * 地图物件 46×24 / 12 支股票 36B，各有若干字节状态里没有 ⇒ 那几字节取 `carry`）。
 *
 * ★ **别再靠"列清单"维护这件事** —— 用对账脚本：
 *   `python3 tools/scratch/audit-state-block.py` 把 42 块表与写出器里的字面偏移取差集，
 *   并会打印每块落在区间内的写入点。加字段/加块之后跑一次即可。
 */

/** 写出一个块所需的全部状态 */
export interface WriteStateBlockInput {
  state: GameState;
  /** 未建模块的原始字节来源（通常是源存档的前 10,059 字节） */
  carry: Uint8Array;
  /** 地图数据块的长度（写进 `0x2747`） */
  mapDataSize: number;
}

function u8(out: Uint8Array, off: number, v: number): void {
  out[off] = v & 0xff;
}

function u16(out: Uint8Array, off: number, v: number): void {
  out[off] = v & 0xff;
  out[off + 1] = (v >> 8) & 0xff;
}

/** 用一个共享 DataView 写 f32（避免每次新建） */
const F32 = new DataView(new ArrayBuffer(4));
function f32(out: Uint8Array, off: number, v: number): void {
  F32.setFloat32(0, v, true);
  for (let k = 0; k < 4; k++) out[off + k] = F32.getUint8(k);
}

function u32(out: Uint8Array, off: number, v: number): void {
  out[off] = v & 0xff;
  out[off + 1] = (v >>> 8) & 0xff;
  out[off + 2] = (v >>> 16) & 0xff;
  out[off + 3] = (v >>> 24) & 0xff;
}

/**
 * 写出 10,059 字节的状态块。
 *
 * ⚠️ 未建模的块**逐字节抄自 `carry`** —— 所以 `carry` 必须是同一局的状态块，
 * 否则写出的是"状态 A 的头 + 状态 B 的身子"。`carriedBlocks()` 会告诉你哪些块是这样来的。
 */
export function writeStateBlock(input: WriteStateBlockInput): Uint8Array {
  assertSaveBlockTable();
  const { state, carry, mapDataSize } = input;

  const out = new Uint8Array(ORIGINAL_STATE_BLOCK_SIZE);
  // 先按 42 块表把 carry 里的对应区间抄过来（未建模块就是最终值）
  for (const b of ORIGINAL_SAVE_BLOCKS) {
    const src = carry.subarray(b.offset, b.offset + b.bytes);
    out.set(src.subarray(0, b.bytes), b.offset);
  }
  // 版本标识 @source 0x00402fd7
  u32(out, 0x0000, ORIGINAL_SAVE_HEADER);
  // ★ 游戏日期 `[0x497160]`：打包 = `day | month<<8 | year<<16`（各 1/1/2 字节）
  //   @source 拆包见 `save-scalars.md` §2.15（`0x452124 shr ebx,0x10` = 年、
  //   `shr ecx,8 / and ecx,0xff` = 月、`and edi,0xff` = 日）；
  //   实测 Save0 = 2002-10-23（`0x07d20a17`）、SAVE1 = 2002-09-17（`0x07d20911`）。
  u32(out, 0x0004, ((state.year << 16) | ((state.month & 0xff) << 8) | (state.day & 0xff)) >>> 0);
  // 地图档：`gameMap` / `gameStage` 是 `globalMapId` 的两位拆分
  //   @source `save.ts`：`globalMapId = gameStage * 4 + gameMap`
  u16(out, 0x0008, state.globalMapId % 4);
  u16(out, 0x000a, Math.floor(state.globalMapId / 4));

  // ── 已建模块：由 GameState 写出 ──────────────────────────────
  // 玩家人数 @source [0x499114]：原版是「在场人数」（含电脑）
  u32(out, 0x000c, state.players.length);
  // 4 × 0x68 的玩家块
  writePlayerBlock(out, state, 0x0010);
  // ✅ `0x01b0`（`[0x499104]`）**已列入建模**（第 61 条）：它不再靠推导 ——
  //   原版是**开局按 `player[i].+0x64 & 1` 数一次、之后不再更新**（破产 `0x40cd87`
  //   不写它），所以复刻把它当**状态字段** `state.humanPlayers` 存下来
  //   （新局 `new-game.ts` 写、读档从本块读回），终局码直接读它。
  //   > 先前走 carry 的原因是对的：按「`whoPlays==1` 的人数」现数会得 1、
  //   > 而 Save0 原文是 2。现已改为**不现数**，该矛盾随之消失。
  u32(out, 0x01b0, state.humanPlayers);

  // playerCards（4 × 15，下标 = 玩家*15 + 槽）@source [0x499120]
  out.fill(0, 0x0654, 0x0654 + 60);
  for (const p of state.players) {
    for (let k = 0; k < p.cards.length && k < 15; k++) {
      u8(out, 0x0654 + p.index * 15 + k, p.cards[k]!);
    }
  }
  // toolAmount（4 × 15）：存档槽序是 `player*15 + (道具号 − 1)`，
  //   而 `state.tools` 的下标是 `player*15 + 道具号`（**1 基**，槽 0 空置）
  //   @source `savegame.ts` 的 `tools[i*15 + id] = owned[id-1]`。
  //   实测两份存档逐项吻合（且每个玩家块的槽 13/14 恒 0）⇒ 加上 `-1` 即可。
  out.fill(0, 0x0690, 0x0690 + 60);
  for (const p of state.players) {
    for (let slot = 0; slot < 15; slot++) {
      u8(out, 0x0690 + p.index * 15 + slot, state.tools[p.index * 15 + slot + 1] ?? 0);
    }
  }

  // cardAmount（30）@source [0x499198]
  for (let k = 0; k < 30; k++) u8(out, 0x06cc + k, state.cardAmount[k] ?? 0);
  // 全局道具库存（8）：存档下标 = **道具号 − 1**，`state.toolStock` 是 1 基
  //   @source `save.ts` 的 `toolStock: 0x06ea` 注释（`_rich4_remain_tool_amount`）。
  for (let k = 0; k < 8; k++) u8(out, 0x06ea + k, state.toolStock[k + 1] ?? 0);

  // 行情历史写游标 @source [0x499100]
  u32(out, 0x06f2, state.market.day);
  // ★ 行情历史 `history[股][日]`，12 × 144 × f32 = 6,912 字节 —— 单块最大
  //   @source 平坦 0x06f6（`save-format.md` §二：`count=1728, size=4`）
  for (let i = 0; i < state.market.history.length && i < 12; i++) {
    const row = state.market.history[i]!;
    for (let d = 0; d < row.length && d < 144; d++) {
      f32(out, 0x06f6 + (i * 144 + d) * 4, row[d]!);
    }
  }
  // ★ 各玩家持仓 4 × 12 × 8（i32 amount + f32 avgCost）@source 平坦 0x21f6
  for (let pi = 0; pi < state.holdings.length && pi < 4; pi++) {
    const row = state.holdings[pi]!;
    for (let j = 0; j < row.length && j < 12; j++) {
      const o = 0x21f6 + (pi * 12 + j) * 8;
      u32(out, o, state.holdings[pi]![j]!.amount);
      f32(out, o + 4, state.holdings[pi]![j]!.avgCost);
    }
  }
  // ★ 特殊角色（四大惡人 + 機器娃娃）5 × 16 @source 平坦 0x01b4
  //   （`player` 块之外的另一组「玩家级」记录；`x/y` 与 `f10/f11` 状态里没有 ⇒ carry）
  for (let ai = 0; ai < state.specialActors.length; ai++) {
    const a = state.specialActors[ai]!;
    const o = 0x01b4 + ai * 16;
    u16(out, o + 4, a.nodeId);
    u16(out, o + 6, a.lastNodeId);
    out[o + 8] = a.owner & 0xff;
    out[o + 9] = a.direction & 0xff;
    out[o + 12] = (a.hibernating ?? 0) & 0xff;
    out[o + 13] = (a.sleepwalkDays ?? 0) & 0xff;
    out[o + 14] = a.halted & 0xff;
    out[o + 15] = a.singleStep & 0xff;
  }
  // ★ 地图物件 46 × 24 @source 平坦 0x0204
  //   只有 `+0` type / `+2` nodeId / `+4` state / `+5` attached 这 5 个字节建模，
  //   其余 19 字节（`+1`、`+6..+23`）`parseSave` 侧未读 ⇒ carry
  for (let oi = 0; oi < state.objects.length; oi++) {
    const ob = state.objects[oi]!;
    const o = 0x0204 + oi * 24;
    out[o] = ob.type & 0xff;
    u16(out, o + 2, ob.nodeId);
    out[o + 4] = ob.state & 0xff;
    out[o + 5] = ob.attached & 0xff;
  }
  // ★ 12 支股票记录（36 字节/条）@source 平坦 0x2376
  //   注意 `+0x00` 的 4 字节 `parsePlayer` 侧未读 ⇒ 保持 carry（故本块是**部分建模**）
  for (let i = 0; i < state.market.stocks.length && i < 12; i++) {
    const st = state.market.stocks[i]!;
    const o = 0x2376 + i * 36;
    u16(out, o + 4, st.commercialIndex);
    out[o + 6] = st.f6 & 0xff;
    out[o + 7] = st.newsFlag & 0xff;
    u16(out, o + 8, st.shares);
    u16(out, o + 10, st.f10);
    f32(out, o + 12, st.basePrice);
    f32(out, o + 16, st.openPrice);
    f32(out, o + 20, st.price);
    f32(out, o + 24, st.volatility);
    f32(out, o + 28, st.trend);
    f32(out, o + 32, st.shock);
  }

  // ★ 公佈欄挂牌表（块 0x2526 = 运行时 `0x4967e0`）：4 玩家 × 7 槽 × 12 字节
  //   @source 挂牌 VA 0x004246c5 的几次写入（布局见 `save.ts` 的 `SaveListingSlot`）。
  //   ⚠️ **本块是部分建模**：只写 `+0`類型 / `+2`编号 / `+4`標價 / `+8`股數，
  //   `+1`（挂牌天龄，原版**只写不读**的死数据）与 `+a`/`+b`（地產/設施挂牌时
  //   的 `+0x18`/`+0x1a` 快照，状态里的 `Listing` 没有这两格）**仍取 carry**。
  //   空槽照原版一样清零（撤件的 `memset(ebx + 0x48, 0, 0xc)` 就是这么做的）。
  for (let p = 0; p < 4; p++) {
    const col = state.noticeBoard[p] ?? [];
    for (let slot = 0; slot < 7; slot++) {
      const o = 0x2526 + p * 0x54 + slot * 12;
      const it = col[slot] ?? null;
      if (it === null) {
        // 只清「本块自己建模的那几格」，`+1`/`+a`/`+b` 留给 carry
        out[o] = 0;
        u16(out, o + 2, 0);
        u32(out, o + 4, 0);
        u16(out, o + 8, 0);
        out[o + 0x0a] = 0;
        out[o + 0x0b] = 0;
        continue;
      }
      out[o] = it.kind & 0xff;
      u16(out, o + 2, it.id);
      u32(out, o + 4, it.price);
      u16(out, o + 8, it.amount);
      // 類型 2 的挂牌快照（類型与等級）—— 其余類型这两格恒 0
      out[o + 0x0a] = (it.estateType ?? 0) & 0xff;
      out[o + 0x0b] = (it.estateLevel ?? 0) & 0xff;
    }
  }

  // 标量组
  u32(out, 0x2676, state.currentPlayer); // [0x49910c]
  // 土地權限档位 @source [0x499110]（开局 `mov [0x499110], [0x46cb48]`，VA 0x00407373）
  //   買地时 `land.+0x30 = today + 年限表[本项]` ⇒ 它是**开局设定**，中途不变。
  u32(out, 0x267e, state.landTenureIndex);
  // 两条勝利條件 @source [0x49911c] / [0x499108]（开局写一次）
  u32(out, 0x2682, state.winConditions.targetDays);
  u32(out, 0x2686, state.winConditions.targetWealth);
  // 本局选中的開局資金档 @source [0x49908c] —— 它有**规则**作用
  //   （`update_price_index` 的除数 + AI 买地保留额基数），不只是"发多少钱"
  u32(out, 0x268a, state.initialFund);
  // ★ 物价指数 `[0x4990e8]` —— 原版开局置 1、之后由 `0x423acf` 抬升
  //   （`cards.md` §13 的「未决 4」也记了它）；实测 Save0 = **5**、SAVE1 = **1**。
  //   `save.ts` 的 `OFFSET.priceIndex` 一直在解析它，**写侧先前漏了**（一直走 carry）。
  u32(out, 0x268e, state.priceIndex); // [0x4990e8]
  u32(out, 0x2692, state.totalDays); // [0x4990e4]
  u32(out, 0x2696, state.totalMonths); // [0x499084]
  u32(out, 0x26a2, state.market.index); // [0x499078]
  u32(out, 0x26ba, state.pool); // [0x499080]

  // 樂透号码表（36）@source [0x4990b8]
  for (let k = 0; k < 36; k++) u8(out, 0x26be + k, state.lottery[k] ?? 0);
  // 占用表（各 8 槽）@source [0x496b30] / [0x496b60]
  for (let k = 0; k < 8; k++) {
    u8(out, 0x26e2 + k, state.prisonOccupancy[k] ?? 0);
    u8(out, 0x26ea + k, state.hospitalOccupancy[k] ?? 0);
  }
  // 两个牌堆的游标与洗牌序
  u32(out, 0x26f2, state.newsDeck.cursor); // [0x4990e0]
  u32(out, 0x26f6, state.fortuneDeck.cursor); // [0x4990b4]
  for (let k = 0; k < 36; k++) u8(out, 0x26fa + k, state.newsDeck.order[k] ?? 0);
  for (let k = 0; k < 37; k++) u8(out, 0x271e + k, state.fortuneDeck.order[k] ?? 0);
  // 地图视角旋转 @source [0x499088]
  u32(out, 0x2743, state.viewRotation);
  // 地图数据长度 @source [0x498e94]
  u32(out, 0x2747, mapDataSize);

  return out;
}

// ============================================================
//  ★ 時光機（道具 10）的 10,008 字节快照
// ============================================================

/**
 * 快照里**有固定偏移**的那些区：`{ snapshotOffset, stateBlockOffset }`。
 *
 * ★ 关键洞察：**快照的每个区都是状态块的某一个块，来自同一个全局变量** ——
 *   原版 `_rich4_store_current_state`（`@source 0x0044808a`）与状态块的
 *   `fwrite` 序列读的是同一批地址（`0x496b68` 玩家、`0x496d08` 物件、`0x499120` 手牌…），
 *   只是**落在快照里的偏移不同**。于是写出器不必重写一套字段映射：
 *   **用 `writeStateBlock` 写出状态块，再把这 28 个区搬到快照偏移上即可**
 *   —— 保真度与状态块逐块相同（完全建模的块就是完全建模的，部分建模的照旧取 carry）。
 *
 * 表的来源（两条独立提取，互相印证）：
 *   · 目的偏移与大小：`rich4-spec/tools/scratch/snapshot_regions.py`
 *     （17 处 `memcpy`，store/restore 两侧完全对称）+ `snapshot_scalars.py`
 *     （8 个 dword 直写 + 有效标记/日期/地图指针）；
 *   · 状态块偏移：`ORIGINAL_SAVE_BLOCKS` 的「目标全局」列
 *     （`save-format.md` §二 权威块序）。
 *
 * 覆盖：28 个区共 **9,999 字节**，另有 4 字节有效标记 + 5 字节对齐填充
 *   + 4 字节地图副本指针（`+0x2714`）= **10,008**。逐区表见 `save-format.md` §五 第 6 条。
 *
 * ⚠️ **不含**每玩家地图副本（`+0x2718` 之后的 `map_data_size` 字节）——
 *   那是「回合开始时的地图」，`GameState` 里没有它的历史副本 ⇒ 仍走 carry。
 */
export const SNAPSHOT_REGIONS: readonly { snapshotOffset: number; stateBlockOffset: number }[] = [
  { snapshotOffset: 0x0004, stateBlockOffset: 0x0004 }, // 游戏日期
  { snapshotOffset: 0x0008, stateBlockOffset: 0x0010 }, // 玩家数组 4×0x68
  { snapshotOffset: 0x01a8, stateBlockOffset: 0x01b4 }, // 特殊实体 5×16
  { snapshotOffset: 0x01f8, stateBlockOffset: 0x0204 }, // objects_info 46×24
  { snapshotOffset: 0x0648, stateBlockOffset: 0x0654 }, // 手牌 4×15
  { snapshotOffset: 0x0684, stateBlockOffset: 0x0690 }, // 道具持有量 4×15
  { snapshotOffset: 0x06c0, stateBlockOffset: 0x06cc }, // 卡片库存 30
  { snapshotOffset: 0x06de, stateBlockOffset: 0x06ea }, // 道具库存 8
  { snapshotOffset: 0x06e8, stateBlockOffset: 0x06f2 }, // 行情历史写游标
  { snapshotOffset: 0x06ec, stateBlockOffset: 0x06f6 }, // 行情历史 6,912
  { snapshotOffset: 0x21ec, stateBlockOffset: 0x21f6 }, // 各玩家持仓
  { snapshotOffset: 0x236c, stateBlockOffset: 0x2376 }, // 12 支股票
  { snapshotOffset: 0x251c, stateBlockOffset: 0x2526 }, // 公佈欄挂牌表 4×7×12
  { snapshotOffset: 0x266c, stateBlockOffset: 0x268e }, // 物价指数
  { snapshotOffset: 0x2670, stateBlockOffset: 0x2692 }, // 已过天数
  { snapshotOffset: 0x2674, stateBlockOffset: 0x2696 }, // 已过月数
  { snapshotOffset: 0x2678, stateBlockOffset: 0x269a }, // [0x4990dc]（未定名）
  { snapshotOffset: 0x267c, stateBlockOffset: 0x269e }, // [0x49907c] 开盘指数（未定名）
  { snapshotOffset: 0x2680, stateBlockOffset: 0x26a2 }, // 当前指数
  { snapshotOffset: 0x2684, stateBlockOffset: 0x26a6 }, // [0x4990ec]（未定名）
  { snapshotOffset: 0x2688, stateBlockOffset: 0x26ba }, // 公库
  { snapshotOffset: 0x268c, stateBlockOffset: 0x26be }, // 樂透号码表
  { snapshotOffset: 0x26b0, stateBlockOffset: 0x26e2 }, // 监狱占用表
  { snapshotOffset: 0x26b8, stateBlockOffset: 0x26ea }, // 医院占用表
  { snapshotOffset: 0x26c0, stateBlockOffset: 0x26f2 }, // 新聞游标
  { snapshotOffset: 0x26c4, stateBlockOffset: 0x26f6 }, // 命運游标
  { snapshotOffset: 0x26c8, stateBlockOffset: 0x26fa }, // 新聞牌堆 36
  { snapshotOffset: 0x26ec, stateBlockOffset: 0x271e }, // 命運牌堆 37
];

/** 快照里**不是**从状态块搬来的那几格（有效标记 / 地图副本指针） */
export const SNAPSHOT_FLAG_OFFSET = 0x0000;
export const SNAPSHOT_MAP_POINTER_OFFSET = 0x2714;

/**
 * 断言快照区表自洽 —— 任何偏移/大小抄错都会在这里炸（与 `assertSaveBlockTable` 同一思路）：
 *   · 每个目标状态块都真实存在，且 `bytes` 就是块表里的 `bytes`；
 *   · 各区在 `[0, 0x2718)` 内**互不重叠**；
 *   · 加上有效标记、地图指针与**实测的 5 字节填充**后恰好铺满 10,008。
 */
export function assertSnapshotRegionTable(): void {
  assertSaveBlockTable();
  const seen: { offset: number; bytes: number }[] = [];
  let total = 0;
  for (const r of SNAPSHOT_REGIONS) {
    const b = ORIGINAL_SAVE_BLOCKS.find((x) => x.offset === r.stateBlockOffset);
    if (b === undefined) {
      throw new Error(`快照区映射到不存在的状态块 0x${r.stateBlockOffset.toString(16)}`);
    }
    seen.push({ offset: r.snapshotOffset, bytes: b.bytes });
    total += b.bytes;
  }
  seen.sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < seen.length; i++) {
    const prev = seen[i - 1]!;
    if (prev.offset + prev.bytes > seen[i]!.offset) {
      throw new Error(
        `快照区重叠：0x${prev.offset.toString(16)}+${prev.bytes} 越过 0x${seen[i]!.offset.toString(16)}`,
      );
    }
  }
  const last = seen[seen.length - 1]!;
  if (last.offset + last.bytes > SNAPSHOT_MAP_POINTER_OFFSET) {
    throw new Error('快照区越过了地图指针格 +0x2714');
  }
  // 有效标记(4) + 各区 + 地图指针(4) + 填充 = 10008；填充实测 = 5（+0x06e6 起 2、+0x2711 起 3）
  const PADDING = 5;
  if (total + 4 + 4 + PADDING !== SNAPSHOT_SIZE) {
    throw new Error(
      `快照区不铺满：${total} + 4 + 4 + ${PADDING} ≠ ${SNAPSHOT_SIZE}`,
    );
  }
}

/** 写出单个玩家的 10,008 字节快照槽 */
export interface WritePlayerSnapshotInput {
  /**
   * **快照时刻**的状态（原版是「本回合开始时」的整份可回滚状态）。
   * ⚠️ 传**当前**状态进来是错的：快照存的是历史状态，两者实测差 40+ 字节。
   */
  state: GameState;
  /**
   * 该槽的原始 10,008 字节（未建模的格从它取）。留空则未建模格写 0 ——
   * 只有在"从零构造"时才该这么用。
   */
  carry: Uint8Array;
  mapDataSize: number;
}

/**
 * 写出**一个**時光機快照槽（10,008 字节，不含其后的地图副本）。
 *
 * 实现：把快照里的 28 个区**按状态块偏移**拼成一份临时 `carry`，
 * 交给 `writeStateBlock`（它会用 `GameState` 覆盖所有已建模块），
 * 再把 28 个区搬回各自的快照偏移。⇒ **字段映射与状态块共用一份，不可能两边不一致。**
 *
 * @source 布局 `0x0044808a`（存）/ `0x00448544`（取）；两条独立提取见
 *   `tools/scratch/snapshot_regions.py` 与 `snapshot_scalars.py`。
 */
export function writePlayerSnapshot(input: WritePlayerSnapshotInput): Uint8Array {
  assertSnapshotRegionTable();
  const { state, carry, mapDataSize } = input;

  // ① 拼一份「按状态块偏移」的 carry：每区的未建模字节来自该槽自己
  const pseudo = new Uint8Array(ORIGINAL_STATE_BLOCK_SIZE);
  for (const r of SNAPSHOT_REGIONS) {
    const b = ORIGINAL_SAVE_BLOCKS.find((x) => x.offset === r.stateBlockOffset)!;
    pseudo.set(carry.subarray(r.snapshotOffset, r.snapshotOffset + b.bytes), r.stateBlockOffset);
  }

  // ② 交给状态块写出器：已建模块**完全由 `state` 产生**
  const block = writeStateBlock({ state, carry: pseudo, mapDataSize });

  // ③ 只把这 28 个区搬回快照的偏移上
  const out = new Uint8Array(SNAPSHOT_SIZE);
  for (const r of SNAPSHOT_REGIONS) {
    const b = ORIGINAL_SAVE_BLOCKS.find((x) => x.offset === r.stateBlockOffset)!;
    out.set(block.subarray(r.stateBlockOffset, r.stateBlockOffset + b.bytes), r.snapshotOffset);
  }

  // ④ 两格非状态块：有效标记 = 1；地图副本指针 = 0
  //    @source `0x004480ce mov dword ptr [eax + 0x48cb80], 1`（只给真人存）
  u32(out, SNAPSHOT_FLAG_OFFSET, 1);
  //    ★ 这一格存的是**进程地址**，读档时被 `malloc` 覆盖
  //      （`@source 0x00402f5d` 分配 → `0x00402f65 mov [esi + 0x48f294], eax`），
  //      实测四个槽是同进程内递推的堆地址 ⇒ 写 0 即可，不必模拟堆布局。
  u32(out, SNAPSHOT_MAP_POINTER_OFFSET, 0);

  return out;
}

// ============================================================
//  ★ 顶层拼装：把整个存档文件写出来
// ============================================================

/** 写出整份存档所需的输入 */
export interface WriteOriginalFileInput {
  state: GameState;
  map: Rich4Map;
  /**
   * **源文件的原始字节**（必须与 `state`/`map` 同源）。
   * 未建模的部分（版本标识以外的头部字节、各块里"状态没有对应字段"的字节、
   * 以及每玩家地图副本）都从这里取。
   */
  carry: Uint8Array;
  /**
   * 4 个時光機快照槽的**回合开始时状态**（`state.snapshots` 里那些 JSON 反序列化后的结果）。
   *
   * · `undefined`（默认）⇒ 4 个槽与地图副本**全部走 carry**，行为与从前完全一致
   *   （「读原版存档再写回」这条路径必须用这个，才能逐字节相等）；
   * · 数组项为 `null` ⇒ 该玩家**没有**快照，槽写全零（原版新局就是全零，
   *   `@source map-format.md` 记载 `memset(0x48cb80 + i*0x2718, 0, 0x2718)`）；
   * · 数组项为 `GameState` ⇒ 用 `writePlayerSnapshot` 写出该槽。
   *
   * ⚠️ **每玩家地图副本仍走 carry**：「回合开始时的地图」在本引擎里没有历史副本
   *   （快照 JSON 存的是 `GameState`，地图在 `Rich4Map` 里）。这是下一轮的活。
   */
  snapshots?: readonly (GameState | null)[];
}

/**
 * 写出**整份原版存档**。
 *
 * @source 布局（`save-format.md` §一，两个真实存档都精确闭合）：
 * ```
 * 文件 = [ 状态块 +0x274b（含 4 字节版本标识）]
 *      + [ 地图结构数据：M 字节 ]                       ; M = map_data_size
 *      + 对每个玩家（num_players 个）：
 *            [ 10,008 字节快照 ]                        ; 時光機 回滚块
 *            [ M 字节 地图数据副本 ]
 * ```
 * @source 版本标识 `0x26`：写侧 `0x00402fd7` 备好、`0x00403016` 最先写出；
 *   读侧 `0x00402b1a` 用 `fseek(file,4,SEEK_SET)` 跳过（**不走 `fread`**）。
 *
 * ⚠️ **快照与每玩家地图副本仍是 carry**：`GameState.snapshots` 目前是
 *   `[null,null,null,null]`（時光機回滚块未建模），故这两块**逐字节抄自 `carry`**。
 *   要做"从头构造一份新存档"，得先把 `snapshots` 建模。已记入续做指南。
 */
export function writeOriginalSaveFile(input: WriteOriginalFileInput): Uint8Array {
  const { state, map, carry } = input;
  const mapDataSize = readU32(carry, 0x2747);

  const stateBlock = writeStateBlock({ state, carry, mapDataSize });
  // ★★ 地图块的**归属/等级/种类/涨价档/地契**都存在地图块里，而实时值在 `GameState`
  //   —— 必须先合并再写，否则写出的永远是**装载时**的归属。
  //   （两份真实存档「读进来再写回去」逐字节相等，是因为那一刻两者恰好一致，
  //   实测 55 块地 / 8 处設施零处不一致 —— 所以这个坑一直没被测出来。）
  const mapBlock = writeMapBlock(
    withLiveMapState(map, state),
    carry.subarray(ORIGINAL_STATE_BLOCK_SIZE, ORIGINAL_STATE_BLOCK_SIZE + mapDataSize),
  );
  const mapStart = ORIGINAL_STATE_BLOCK_SIZE;
  const snapStart = mapStart + mapDataSize;
  const total = snapStart + 4 * (SNAPSHOT_SIZE + mapDataSize);

  const out = new Uint8Array(total);
  out.set(stateBlock, 0);
  out.set(mapBlock, mapStart);
  const snaps = input.snapshots;
  if (snaps === undefined) {
    // 4 组「快照 + 地图副本」逐字节来自 carry（读原版存档再写回就走这条）
    out.set(carry.subarray(snapStart, total), snapStart);
    return out;
  }
  for (let i = 0; i < 4; i++) {
    const slotOff = snapStart + i * (SNAPSHOT_SIZE + mapDataSize);
    const snap = snaps[i];
    // null / 缺项 = 该玩家没有快照 ⇒ 槽保持全零（原版新局亦然）
    if (snap !== null && snap !== undefined) {
      out.set(
        writePlayerSnapshot({
          state: snap,
          carry: carry.subarray(slotOff, slotOff + SNAPSHOT_SIZE),
          mapDataSize,
        }),
        slotOff,
      );
    }
    // ★ 每玩家地图副本 = **那一刻的地图**：用快照状态合并后写出
    //   （`snapshots` 给定时才走这条；不给就整块走 carry）
    if (snap !== null && snap !== undefined) {
      out.set(
        writeMapBlock(
          withLiveMapState(map, snap),
          carry.subarray(slotOff + SNAPSHOT_SIZE, slotOff + SNAPSHOT_SIZE + mapDataSize),
        ),
        slotOff + SNAPSHOT_SIZE,
      );
    } else {
      // 没有快照 ⇒ 原版那份缓冲是 malloc 出来的零页（新局亦然）
      out.set(
        carry.subarray(slotOff + SNAPSHOT_SIZE, slotOff + SNAPSHOT_SIZE + mapDataSize),
        slotOff + SNAPSHOT_SIZE,
      );
    }
  }
  return out;
}

function readU32(buf: Uint8Array, off: number): number {
  return (
    ((buf[off] ?? 0) |
      ((buf[off + 1] ?? 0) << 8) |
      ((buf[off + 2] ?? 0) << 16) |
      ((buf[off + 3] ?? 0) << 24)) >>>
    0
  );
}
