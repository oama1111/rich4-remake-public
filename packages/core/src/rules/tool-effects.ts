/*
 * 道具效果
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 对照 `rich4-re/asm/rich4_tool_*.asm` 逐个翻译，并以 exe 复核。
 *
 * 多数道具的「选谁／选哪一格」走 `_rich4_select_instance_with_mouse`
 * （0x446ae8，与卡片目标选择同一个模态 UI），按 C-ARC-2 不进 core——
 * 目标作为参数传入。
 */

import type { Player } from '../state/types.ts';
import type { MapObject } from '../cards/summon.ts';
import { TOOL_SLOTS_PER_PLAYER } from './tools.ts';
import { placeObjectOfType } from './object-landing.ts';

// ============================================================
//  交通工具
// ============================================================

/**
 * 交通方式与骰子数。
 *
 * @source `rich4_tool_jiche.asm` / `rich4_tool_qiche.asm`：
 * ```asm
 * ; 機車
 * mov byte [player + 0x11], 1      ; traffic_method = 1
 * mov byte [player + 0x12], 2      ; ★ ndices = 2
 * ; 汽車
 * mov byte [player + 0x11], 2
 * mov byte [player + 0x12], 3      ; ★ ndices = 3
 * ```
 *
 * ★ 这条解释了两件既有的事：
 *   - 玩家默认 `ndices = 1`（步行）
 *   - 设施过路费的交通倍率 `1 << ((traffic & 3) - 1)`（见 rules/god-toll.ts）
 */
export const VEHICLE_DICE: ReadonlyMap<number, number> = new Map([
  [0, 1], // 步行
  [1, 2], // 機車
  [2, 3], // 汽車
]);

/** 交通方式编号 */
export const TRAFFIC_WALK = 0;
export const TRAFFIC_MOTORCYCLE = 1;
export const TRAFFIC_CAR = 2;
/**
 * 工程車的交通方式。
 * @source `mov byte [player + 0x11], 0x1f`（rich4_tool_gongchengche.asm）
 *
 * ⚠️ 注意 `0x1f & 3 === 3`，故设施过路费倍率会取到 `1 << 2 = 4`——
 * 是三种交通工具里最贵的。这是该值的直接后果，不是巧合。
 */
export const TRAFFIC_ENGINEERING = 0x1f;

/** 道具编号 → 它给予的交通方式 */
export const VEHICLE_TOOLS: ReadonlyMap<number, number> = new Map([
  [5, TRAFFIC_MOTORCYCLE],
  [6, TRAFFIC_CAR],
  [12, TRAFFIC_ENGINEERING],
]);

/** 交通方式 → 被换下时退还的道具编号 */
export const TRAFFIC_REFUND: ReadonlyMap<number, number> = new Map([
  [TRAFFIC_MOTORCYCLE, 5],
  [TRAFFIC_CAR, 6],
]);

export interface VehicleResult {
  ok: boolean;
  player: Player;
  tools: number[];
}

/**
 * 换乘交通工具。
 *
 * @source `rich4_tool_jiche.asm` 全文：
 * ```asm
 * dl = byte [player + 0x11]
 * cmp dl, 1 / jne 查2
 * xor edx, edx / jmp 结束            ; ★ 已经是機車 → 什么都不做
 * 查2:
 * cmp dl, 2 / jne 设置
 * inc byte [player*15 + 0x499161]    ; ★ 原本开汽車 → 把汽車退还成道具
 * 设置:
 * byte [player + 0x11] = 1
 * byte [player + 0x12] = 2
 * ```
 * 汽車版本对称（已是汽車则不做；原本骑機車则退还機車）。
 *
 * ★ 「已经是同一种就白用」是原版行为——道具会被消耗吗？
 *   `jmp 结束` 直接跳到函数尾，**没有走 take_tool**，故**不消耗**。
 */
export function useVehicleTool(
  player: Player,
  tools: readonly number[],
  toolId: number,
): VehicleResult {
  const traffic = VEHICLE_TOOLS.get(toolId);
  if (traffic === undefined) return { ok: false, player, tools: [...tools] };

  // @source cmp dl, 1 / jne … / xor edx,edx / jmp 结束
  if (player.trafficMethod === traffic) {
    return { ok: false, player, tools: [...tools] };
  }

  const nextTools = [...tools];
  // @source 原本的交通工具退还成道具
  const refund = TRAFFIC_REFUND.get(player.trafficMethod);
  if (refund !== undefined) {
    const at = player.index * TOOL_SLOTS_PER_PLAYER + refund;
    nextTools[at] = (nextTools[at] ?? 0) + 1;
  }

  return {
    ok: true,
    player: {
      ...player,
      trafficMethod: traffic,
      // @source byte [player + 0x12] = 2 / 3 / 1
      ndices: VEHICLE_DICE.get(traffic) ?? 1,
    },
    tools: nextTools,
  };
}

// ============================================================
//  放置类道具
// ============================================================

/**
 * 放置类道具与其物件种类。
 *
 * @source 三个 asm 都走 `_rich4_place_object`（0x0040e033），
 *   压入的种类分别是：
 * ```
 * rich4_tool_luzhang.asm        push 0x10   → 16 路障
 * rich4_tool_dilei.asm          push 0x11   → 17 地雷
 * rich4_tool_dingshizhadan.asm  push 0x12   → 18 定時炸彈
 * ```
 * 与物件名表（rules/purchase.ts 的 OBJECT_NAMES）下标 16/17/18 一一对上。
 */
export const PLACEMENT_TOOLS: ReadonlyMap<number, number> = new Map([
  [2, 16], // 路障
  [3, 17], // 地雷
  [4, 18], // 定時炸彈
]);

export interface PlaceResult {
  ok: boolean;
  objects: MapObject[];
  /** 被占用的物件槽下标（0 基）；失败为 -1 */
  slot: number;
}

/**
 * 在地图上放一个物件。
 *
 * 目标格由 `_rich4_select_instance_with_mouse`（0x446ae8）选定，
 * 按 C-ARC-2 作为参数传入。
 *
 * ★ 槽位**按种类分区**，不是随手找空位——见 `rules/objects.ts` 的
 *   `slotRangeForType`（@source `place_object` VA 0x0040e033）。
 *
 * ⚠️ 先前这里取的是「第一个空槽」，那是**错的**：放一个路障可能占掉
 *   0 号槽并把它的种类改写成 16，而 0 号槽在原版里永远是小財神。
 *   物件表的「下标决定种类」是全局不变量，`OBJECT_TYPE_TABLE`、
 *   `god_info = 下标 + 1`、送神符的类型判定全都依赖它。
 */
export function placeObject(
  objects: readonly MapObject[],
  nodeId: number,
  objectType: number,
): PlaceResult {
  const r = placeObjectOfType(objects, objectType, nodeId);
  return { ok: r.slot >= 0, objects: r.objects, slot: r.slot };
}

// ============================================================
//  遙控骰子
// ============================================================

/**
 * 遙控骰子把指定的点数存在一个**全局的一次性槽**里。
 *
 * @source `mov byte [0x475dd8], bl`（VA 0x00447275）写入，
 *   `0x00447285` 读出并**当场清零**（`mov al, [0x475dd8]` / `mov [0x475dd8], 0`），
 *   全局只有那一个读取点（VA 0x0040d9a4，掷骰路径上）。
 *
 * ★ 所以它是「下一次掷骰用这个数」，用完即消，不是永久生效。
 *   本引擎存进 `GameState.forcedDice`——之所以进状态而不是当场掷，
 *   是因为原版用完道具之后还要走一遍正常的掷骰流程（`0x40dd1f`
 *   只是把回合状态推到「该掷了」）。
 */
export const REMOTE_DICE_MIN = 1;
/**
 * 遙控骰子能指定的最大点数 —— **6**（2026-09-24 审计订正，原为 18）。
 * @source 真人点数窗 `0x00446847 cmp esi, 6`（六个钮）/ `0x0044685b lea eax, [esi+1]` ⇒ 1..6；
 *   电脑的参数也是 1..6（`ai/tool-policy.ts`，`0x00421827`）。掷骰那一支按**一颗骰子**用它（`0x40d9a4`）。
 */
export const REMOTE_DICE_MAX = 6;

export function isValidRemoteDice(value: number): boolean {
  return Number.isInteger(value) && value >= REMOTE_DICE_MIN && value <= REMOTE_DICE_MAX;
}

// ============================================================
//  機器工人
// ============================================================

/**
 * 機器工人：在选中的地块上**免费加蓋一级**。
 *
 * @source `rich4_tool_jiqigongren.asm` 的主干就是
 *   `select_instance_with_mouse` → `take_tool` → `0x40b110(type)`，
 *   而 `0x40b110` 正是魔法屋「就地加蓋房屋」用的同一个函数
 *   （见 places/magic-house.ts）：
 * ```asm
 * 住宅(2000..4000): land.type == 0 && level < 5        → level++
 *                   land.type == 1 && level == 0       → level++
 * ```
 *
 * ★ **不花钱、不看归属**——连别人的地都能替他盖。
 *   听着奇怪，但 `0x40b110` 从头到尾没碰过 `+0x19`（owner）与任何金额。
 *
 * ★ 返回值的两位都要带出去：**bit0 = 成了**（`BuildResult.ok`）、
 *   **bit7 = 剛好升到 5 級**（`BuildResult.reachedMaxLevel`）。
 *   ⚠️ 「設施支不置 bit7」是**错的**：`0x0040b1f4` 那条是「設施等级 0 →
 *   定种类首建」的路径，**只有它**不置位；等级 ≥ 1 的設施走 `0x0040b1f9`
 *   那一支，到 5 级时 `mov eax, 0x81` —— **照样置 bit7**。
 *   本复刻早先只在客户端按「地块等级 4→5」自己算，且注释写反了，已订正。
 */
export interface BuildResult {
  ok: boolean;
  /** 加蓋后的等级 */
  level: number;
  /**
   * ★★ `0x40b110` 返回值的 **bit7** —— 这一次加蓋是不是**剛好升到 5 級**。
   *
   * 原版三条消费点都拿它决定「要不要再接播 Data.mkf 0x20b 那一段影片 +
   * 音效 0x5a + 一句台词」：
   *   · `0x00432085`（魔法屋「就地加蓋」）`test byte [esp+0xa8], 0x80`
   *   · `0x004436b5`（天使卡 9）`test al, 0x80`
   *   · `0x0044736d`（機器工人 9）`test byte [esp], 0x80`
   * 本引擎把这条契约一路带到 `GameState.lastBuildUpgrades`（纯表现瞬态），
   * 客户端**不再自己比较等级**（C-ARC-2）。
   */
  reachedMaxLevel: boolean;
}

/**
 * `0x40b110` 里那个**写死**的「剛好升到 5 級」的立即数。
 *
 * @source VA 0x0040b169（地块支）`cmp cl, 5` / `jne 0x40b170` / `or al, 0x80`；
 *   VA 0x0040b215（設施支）`cmp dl, 5` / `jne 0x40b21f` / `mov eax, 0x81`。
 * ★ 注意它与调用方给的 `maxLevel` 无关：`0x40b138` 对住宅的封顶也是**硬写的 5**
 *   （`cmp byte [land+0x1a], 5 / jae`），本引擎的 `maxLevel` 形参只是建模方便，
 *   所有调用点都传 `MAX_LAND_LEVEL`（= 5）。
 */
export const BUILD_MAX_LEVEL = 5;

/**
 * 这一个**新等级**会不会置 `0x40b110` 返回值的 bit7。
 *
 * @source VA 0x0040b169 `cmp cl, 5` / `jne 0x40b170` / `or al, 0x80`
 *   —— 判据是**相等**，不是「≥ 5」。两条支（住宅 `0x40b169` / 設施 `0x40b215`）
 *   都写 `cmp …, 5 / jne`；因为 `0x40b13e` 已经把等级夹在 5 以下，
 *   「== 5」与「≥ 5」在 exe 里恰好等价 —— 但契约本身是**相等**。
 */
export function reachedMaxBuildLevel(newLevel: number): boolean {
  return newLevel === BUILD_MAX_LEVEL;
}

/**
 * 一次的等级变化会不会置 bit7 = `0x40b110` 返回值的 bit7。
 *
 * ★ 两道闸**缺一不可**：
 *   · 等级真的变了（`0x40b110` 只在 `inc` 之后走到 `cmp cl, 5`；
 *     没加蓋的路径直接从 `0x40b15f je 0x40b170` 出去，`eax` 停在 0）；
 *   · 新等级正好是 5。
 */
export function buildUpgradeBit7(beforeLevel: number, afterLevel: number): boolean {
  return afterLevel !== beforeLevel && reachedMaxBuildLevel(afterLevel);
}

export function buildOneLevel(landType: number, level: number, maxLevel: number): BuildResult {
  // @source cmp byte [land+0x18], 0 / jne …；cmp byte [land+0x1a], 5 / jae 不可建
  const buildable = landType === 0 ? level < maxLevel : landType === 1 && level === 0;
  return buildable
    ? { ok: true, level: level + 1, reachedMaxLevel: reachedMaxBuildLevel(level + 1) }
    : { ok: false, level, reachedMaxLevel: false };
}

// ============================================================
//  飛彈与核子飛彈
// ============================================================

/**
 * 两枚飛彈的参数。
 *
 * @source 两处 `call 0x40ac7b`（damage_area）的压栈：
 * ```asm
 * 飛彈  (7):  push 攻击者 / push 0 / push 0x26 / push 0x64   ; 半径 100
 * 核彈 (13):  push 攻击者 / push 1 / push 0x26 / push -1     ; ★ 半径 -1 = 整幅画面（不是全图，见 NUKE_VIEW_HALF）
 * ```
 * `0x26 = 0x20|0x4|0x2`：2 打住宅、4 打设施、0x20 打站在范围里的人。
 */
export const MISSILE_RADIUS = 0x64;
export const NUKE_RADIUS = -1;
/**
 * 半径 −1 的**实际**范围：`0x40a45c` 收的是 440×440 的**棋盘画面**，不是整张地图 ——
 * ```asm
 * 0040a464  cmp edi, -1 / jne 0x40a472
 * 0040a469  xor esi, esi / mov edi, 0x1b8     ; 起点 0、边长 440（整幅画面）
 * 0040a494  call 0x409de7                     ; 按**当前镜头**重建那张 440×440 的 id 图
 * ```
 * 而核彈（`0x447b77`）与飛彈（`0x447065`）一样，先 `call 0x41d476` 把镜头移到目标上。
 * ⇒ 核彈炸的是「以目标为中心、画面里看得见的那一片」—— 与 AI 的「画面」同一个近似
 *   （节点坐标 ±220，`ai/card-policy.ts` 的 `VIEW_HALF`，Q-TOOL-1）。
 */
export const NUKE_VIEW_HALF = 0xdc; // = 0x1b8 ÷ 2（`0x40a472 mov ebp, 0xdc` 就是画面中心）
export const MISSILE_FLAGS = 0x26;

/** 被炸的人要住院几天 @source `push 3 / call send_to_hospital`（VA 0x004470dc） */
export const MISSILE_HOSPITAL_DAYS = 3;
/** 被炸的人对攻击者的敌意 @source 移位串 `3pi → 6pi → 96pi → 90pi` */
export const MISSILE_HOSTILITY_FACTOR = 90;
/** 拆房记在地主头上的敌意：飛彈固定 30×物价指数 */
export const MISSILE_DEMOLISH_HOSTILITY = 30;

/**
 * 一次爆炸对**一块地**做什么。
 *
 * @source `damage_area` VA 0x0040ac7b 的两个分支（住宅 0x0040acdd、
 *   设施 0x0040adaf，形状完全一样）：
 * ```asm
 * if (heavy == 0) {                       ; 飛彈
 *     敌意(地主, 攻击者, 30 × 物价指数)
 *     if (level != 0) level--
 *     if (type != 0) { level = 0; type = 0 }      ; 連鎖店被夷平
 * } else {                                ; 核彈
 *     敌意(地主, 攻击者, level × 30 × 物价指数)   ; ★ 按等级计
 *     owner = 0 ; level = 0 ; type = 0 ; [+0x30] = 0   ; ★ 连地一起没收
 * }
 * ```
 *
 * ★ 两者的差别不只是范围：飛彈**拆一级**，核彈**连地契一起烧掉**。
 */
export interface BlastOutcome {
  owner: number;
  level: number;
  type: number;
  /** 记在原地主头上的敌意；无主为 0 */
  hostility: number;
}

export function blastLand(
  owner: number,
  level: number,
  type: number,
  priceIndex: number,
  heavy: boolean,
): BlastOutcome {
  const owned = owner !== 0;
  if (!heavy) {
    // @source 飛彈：固定 30 × 物价指数
    const hostility = owned ? MISSILE_DEMOLISH_HOSTILITY * priceIndex : 0;
    let next = level > 0 ? level - 1 : 0;
    let nextType = type;
    if (type !== 0) {
      next = 0;
      nextType = 0;
    }
    return { owner, level: next, type: nextType, hostility };
  }
  // @source 核彈：edx = level*2; eax = (edx<<4) - edx = 30*level; imul 物价指数
  const hostility = owned ? level * MISSILE_DEMOLISH_HOSTILITY * priceIndex : 0;
  return { owner: 0, level: 0, type: 0, hostility };
}

// ============================================================
//  尚未实现
// ============================================================

/**
 * 效果**尚未实现**的道具。
 *
 * ★ **空的 —— 13 件全部接上了。**
 *
 * 最后一件是 1 機器娃娃，它卡在「替身走子」上：原版把它当作**行动者 8**
 * （`[0x49910c] = 8`），位置写进 `_rich4_all_special_players_state`(0x498e28)
 * 的第 4 项。这套系统现已实现，见 rules/special-actors.ts。
 *
 * ✅ 1  機器娃娃 —— 放一个替身走九格，沿路把物件全扫掉，见 rules/special-actors.ts
 * ✅ 10 時光機   —— 靠还原「回合开始快照」做撤销，见 rules/time-machine.ts
 * ✅ 11 傳送機   —— 搬地產 / 搬人两路已做，設施那一路见 Q-TOOL-2，
 *                  见 rules/teleport.ts
 *
 * ⚠️ 这个常量**保留不删**：往后要是某条效果需要临时退场，
 *   得有地方明确说「这件还没做」，而不是让它悄悄变成空操作。
 */
export const UNIMPLEMENTED_TOOLS: readonly number[] = [];

export function isToolImplemented(toolId: number): boolean {
  return !UNIMPLEMENTED_TOOLS.includes(toolId);
}
