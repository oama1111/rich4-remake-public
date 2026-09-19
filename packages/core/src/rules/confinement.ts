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
import type { MapNode, LandscapeInfo } from '../loaders/map.ts';
import type { MapObject } from '../cards/summon.ts';
import { TYPE_BASE } from '../loaders/map.ts';
import { RELEASE_PENDING } from './blocking.ts';
import { addMisfortuneDays } from './monthly.ts';
import { syncEscortNodes } from './object-landing.ts';
import { placeOnNodeId } from './position.ts';

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
  /**
   * **另一张**占用表（首次关押时会被清掉的那个）。
   * 只有传入 `otherOccupancy` 且走**首次**路径时才会变化；否则原样返回。
   */
  otherOccupancy?: number[];
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
  otherOccupancy?: readonly number[],
): ConfineResult {
  const field = COUNTER[kind];
  const nextOcc = [...occupancy];
  const nextOther = otherOccupancy === undefined ? undefined : [...otherOccupancy];
  const p = players[index];

  if (p === undefined) {
    return { players: [...players], occupancy: nextOcc, extended: false, days: 0 };
  }

  const existing = p.blocking[field];
  // @source test dh, dh / jne 加刑路径（0x0043d5da）
  const extended = existing !== 0;
  // @source 加刑：(existing + days) & 0x7f；新判：直接赋值
  const value = extended ? (existing + days) & 0x7f : days;

  nextOcc[index] = 1; // @source mov byte [idx + 表基址], 1（0x0043d674）

  // ★★ P4 修复（2026-09-17）：**首次**关押必须先清掉"别的"阻碍状态。
  //   原版在首次分支里先 `call 0x40d761`（@source 0x0043d5e7），该函数做两件事：
  //   ```asm
  //   ; @source 0x0040d761
  //   0040d769  cmp  byte ptr [eax + 0x496b9c], 0   ; p+0x34 inPrison 非 0 ?
  //   0040d774  mov  byte ptr [ebx + 0x496b30], dh  ; → 清**监狱**占用表 + 释放
  //   0040d788  cmp  byte ptr [eax + 0x496b9d], 0   ; p+0x35 inHospital 非 0 ?
  //   0040d793  mov  byte ptr [ebx + 0x496b60], ch  ; → 清**医院**占用表 + 释放
  //   0040d7a9  mov  dword ptr [ebx + 0x496b9a], edx ; ★ 把 +0x32..+0x35 **四项整体清零**
  //   ```
  //   即：`+0x32..+0x35` = 住宿 / 消失 / 监狱 / 医院，**首次关押时四项一起清**，
  //   而占用表只清"当前非 0 的那一张"。
  //   此前 remake 只写目标字段，于是「住院中被判刑」会**同时**留在医院
  //   （`inHospital` 不清、医院占用表不清），住宿中同理。
  const cleared: Partial<Record<keyof BlockingDays, number>> = extended
    ? {}
    : { inHotel: 0, disappearing: 0, inPrison: 0, inHospital: 0 };
  if (!extended && nextOther !== undefined) {
    // 清"另一张"占用表（目标那张由 `nextOcc[index] = 1` 置位）
    nextOther[index] = 0;
  }

  // ★ 本次修复（2026-09-18）：送入监狱／医院**同时累加「本月倒楣天數」** `p+0x42`。
  //   两处函数的公共尾部各有一句 8 位加法，**新判与加刑都走得到**：
  // ```asm
  //   0043d747  push ebx / push ebp / call 0x44ba63   ; 播送入动画
  //   0043d751  mov  al, byte ptr [esp + 0x18]        ; al = 天数参数
  //   0043d755  add  byte ptr [esi + 0x496baa], al    ; ★ 监狱 += 天数
  //   ...
  //   0043edf8  call 0x44ba63
  //   0043ee00  mov  al, byte ptr [esp + 0x18]
  //   0043ee04  add  byte ptr [esi + 0x496baa], al    ; ★ 医院 += 天数
  // ```
  //   ★ 注意：`0x0040d761`（首次关押清四项）**不清** `+0x42` —— 它是月度累加器，
  //   与 `+0x32..+0x35` 那四个当日状态不同类。先前 remake 一处都没加 ⇒
  //   月结屏「本月倒楣天數」偏低、月度奖项评分少算 `天数 × 物價指數 × 2500`。
  const next = players.map((q, i) =>
    i === index
      ? addMisfortuneDays(
          { ...q, blocking: { ...q.blocking, ...cleared, [field]: value } },
          days,
        )
      : q,
  );

  return {
    players: next,
    occupancy: nextOcc,
    ...(nextOther === undefined ? {} : { otherOccupancy: nextOther }),
    extended,
    days: value,
  };
}

/**
 * 把玩家**传送到监狱／医院格** —— 原版「首次关押」里的那一段。
 *
 * @source `send_to_prison 0x0043d593` 的 `0x43d601`..`0x43d652`（医院 `0x43ec3f` 同构）：
 * ```asm
 * 0043d601  and  byte [player + 0x15], 0xf      ; ★ 清 who_plays 的高 4 位
 * 0043d61d  and  dword [node[旧格] + 0x24], edi  ;   清旧格的占用位（本引擎不镜像节点占用）
 * 0043d621  ax = word [0x48bae0]                 ; ★ 监狱格号（医院是 [0x48bae2]）
 * 0043d627  word [player + 0x0c] = ax            ;   nodeId ← 监狱格
 * 0043d630  word [player + 0x0e] = 0             ; ★ lastNodeId ← 0
 * 0043d637  byte [player + 0x1b] = 0xf           ;   （移动前朝向备份，本引擎未建模）
 * 0043d647  word [player + 0x08] = [0x498e78]+0x38   ; ★ x ← 特殊景观记录 2 的 x
 * 0043d652  word [player + 0x0a] = [0x498e78]+0x3a   ;   y（医院取记录 1 的 +0x1c/+0x1e）
 * ```
 *
 * ★ **只在首次关押时做**（加刑分支 `0x43d6bd` 不做）——调用方按 `ConfineResult.extended` 判。
 *
 * ⚠️ **一处有意的取值口径（D-CONFINE-1）**：原版把 `x/y` 取自**特殊景观记录**
 * （入監 = 记录 2「綠島」(1817,1960)、入院 = 记录 1「醫院」(319,990)；景观表 1 基，
 * 加载循环 `@source 0x407f17`/`0x407f35`），而关押格（`[0x48bae0]`/`[0x48bae2]`）
 * 在**别处**（0001.bin：監獄 1 @(1752,1871)、醫院 23 @(384,1056)）—— 原版的 `x/y`
 * 是**贴图位置**，不是"所在格的坐标"。本引擎把 `nodeId/x/y` 定义成必须一致的
 * **位置三元组**（两份真实存档 8/8 + `xpos == 0` 是冬眠卡哨兵，见 `rules/position.ts`），
 * 故在「走回棋盘」那一回合的收尾把 `x/y` 同步回节点坐标（见 `reduce.ts` 的 `startTurn`）。
 * 逐条证据与"为什么留到画面精修那一轮"见
 * `rich4-remake/docs/known-deviations.md` 的 D-CONFINE-1；
 * 回归护栏是 `state/object-integration.test.ts` 里那条「景观记录编号与身份」。
 *
 * @param nodes `MapTopology.nodes`（从 0 开始，下标 = 节点号 − 1）
 * @param kind  关的是哪一种 —— 决定 x/y 取哪一条景观记录（**不要**从节点反推：
 *              关押格的判据是 `type`，而保釋落点格的判据是 `specialKind`，两者不同节点）
 */
export function teleportToGate(
  players: readonly Player[],
  nodes: readonly MapNode[],
  index: number,
  gateNodeId: number,
  kind: ConfinementKind,
  landscapes?: readonly LandscapeInfo[],
): Player[] {
  return players.map((p, i) => {
    if (i !== index) return p;
    // @source 0x43d601 `and byte [player+0x15], 0xf`
    const cleared = { ...p, whoPlays: p.whoPlays & 0x0f };
    // @source 0x43d627 / 0x43d630 —— nodeId ← 監獄/醫院格、lastNodeId ← 0
    const placed = { ...placeOnNodeId(cleared, nodes, gateNodeId), lastNodeId: 0 };
    // @source 0x43d643..0x43d652 —— ★ x/y 另取**特殊景观记录**（不是节点坐标！）
    const rec = gateLandscape(landscapes, kind);
    return rec === undefined ? placed : { ...placed, xpos: rec.x, ypos: rec.y };
  });
}

/**
 * 入監／入院在**特殊景观表**里的记录号（1 基；表 0 号槽是哨兵）→ 数组下标 = 记录号 − 1。
 *
 * @source 加载循环 `0x407f17`（`ebx = 1` 起、`[0x498e78] + ebx*0x1c`、上界 `[0x499074]`）
 *   ⇒ 运行时的景观表**按 1 基索引**，本引擎的 `map.landscapes[]` 是 0 基无哨兵，
 *   故「记录 1」= `landscapes[0]`。
 * @source 关押侧：監獄 `0x43d643 mov si, word [eax + 0x38]`（= 记录 2）、
 *   醫院 `0x43ecef mov si, word [eax + 0x1c]`（= 记录 1）。
 */
const GATE_LANDSCAPE: Record<ConfinementKind, number> = {
  hospital: 0, // 记录 1 → 医院大樓（0001.bin 实测 (319,990)）
  prison: 1, //   记录 2 → 綠島（0001.bin 实测 (1817,1960)）
};

/**
 * 关押格的**节点 `type` 值** —— 監獄/醫院在节点 `+0x20` 里存的不是「特殊格种类」。
 *
 * ★★ 原版有**两个容易混为一谈的概念**（复刻先前混了，见 `known-deviations.md` D-CONFINE-1）：
 *
 * | 概念 | 判据 | 0001.bin 上的节点 | 干什么 |
 * |---|---|---|---|
 * | **落点特殊格** | `node+0x24` 低字节 = 4/5（`specialKind`）| 監獄 12 / 醫院 16 | 走到上面 → 开保釋菜单（`0x43d304`/`0x43e9a4`）|
 * | **关押格** | `node+0x20` == `0x1f41`/`0x1f42`（景观基数 8000 + 记录 1/2）| 監獄 **1** / 醫院 **23** | `send_to_prison`/`send_to_hospital` 把犯人搬到这里 |
 *
 * 关押格是**地图载入时**扫出来的，存进两个全局：
 * ```asm
 * ; @source 0x0040803f（載入迴圈 ebx = 1..节点数：[0x498e80] + ebx*0x28 + 0x20）
 * 0040803f  cmp word [edx + eax*8 + 0x20], 0x1f41   ; 8001 = 景观记录 1
 * 00408048  mov word [0x48bae2], bx                 ; → 醫院格号
 * 0040805f  cmp word [edx + eax*8 + 0x20], 0x1f42   ; 8002 = 景观记录 2
 * 00408068  mov word [0x48bae0], bx                 ; → 監獄格号
 * ```
 * 而入監／入院用的就是这两个全局（`@source 0x0043d621 mov ax, word [0x48bae0]` /
 * `0x0043d627 mov word [ebx + 0x496b74], ax`，醫院 `0x0043ecce` 同构）——
 * **所以释放回棋盘时人站在这一格上**（走路例程 `0x40c0ba` 的终点 = 当前格坐标）。
 *
 * 独立印证：`rich4-spec/docs/systems/map-format.md` §4.5「"类型基数 8000 + 2 == 0x1f42"
 * 的独立印证」、`game-loop.md`「释放那一回合玩家站在監獄/醫院格（格值 0x1f42/0x1f41）」。
 */
export const CONFINEMENT_GATE_TYPE: Record<ConfinementKind, number> = {
  hospital: TYPE_BASE.LANDSCAPE + 1, // 0x1f41 = 景观记录 1（醫院大樓）
  prison: TYPE_BASE.LANDSCAPE + 2, //   0x1f42 = 景观记录 2（綠島）
};

/**
 * 关押格的节点号 —— 原版 `[0x48bae0]`/`[0x48bae2]`（找不到 = 0，调用点按「没这一格」处理）。
 *
 * ⚠️ 每张出厂地图恰好一格（8 张图逐张实测：`type ∈ {0x1f41, 0x1f42}` 各一个）。
 *   原版扫表时**后匹配者覆盖**（`mov word [0x48bae0], bx` 在循环里），
 *   这里同样取最后一个匹配项，避免地图真有重复时与原版分叉。
 */
export function confinementGateNodeId(nodes: readonly MapNode[], kind: ConfinementKind): number {
  const want = CONFINEMENT_GATE_TYPE[kind];
  let found = 0;
  for (const n of nodes) if (n.type === want) found = n.id;
  return found;
}

/** 取这次关押该用的景观记录（表里没有就返回 undefined ⇒ 退回节点坐标） */
function gateLandscape(
  landscapes: readonly LandscapeInfo[] | undefined,
  kind: ConfinementKind,
): LandscapeInfo | undefined {
  return landscapes?.[GATE_LANDSCAPE[kind]];
}

/** `sendToConfinement` 的结果：`confine` 的全部字段 + 跟班物件的新数组 */
export interface ConfineOutcome extends ConfineResult {
  /**
   * 更新后的物件表。**仅当**首次关押且地图上有对应的监狱／医院格时才会变
   * （跟班 `godInfo`/`f64` 的所在格跟着搬）；否则原样返回。
   */
  objects: MapObject[];
  /** 是否真的传送了（= 首次 ＋ 找得到格子）。调用点只需在测试里断言它 */
  teleported: boolean;
}

/**
 * `send_to_prison` / `send_to_hospital` 的**完整**复刻：写计数 + 清旧占用位 +
 * 传送到监狱／医院格 + 跟班搬家。
 *
 * ★★ **为什么必须有这个包装**（2026-09-18 补）：原版把「传送 + 跟班搬家」
 *   写在 `send_to_prison`/`send_to_hospital` **函数体内**，所以**每一个**调用点
 *   都自动获得这套行为。先前 remake 把这几步留给调用点自己做，结果 6 个调用点
 *   里只有 2 个接了 —— 另外 4 条（命運、新聞、炸彈落地、陷害/復仇卡）的受害者
 *   只是**计数**进了监狱，`nodeId/xpos/ypos` 还停在原地，棋盘上根本看不到人。
 *   ⇒ 凡是"把某人关起来"的地方一律走本函数，不要再直接调 `confine`。
 *
 * @source `send_to_prison 0x0043d593`（医院 `0x0043ec3f` 同构）首次分支：
 * ```asm
 * 0043d5da  test dh, dh / jne 0x43d6bd     ; 已在狱中 → 加刑，**不传送**
 * 0043d5e7  call 0x40d761                  ; 清四项 + 清"另一张"占用表（confine 已做）
 * 0043d601  and  byte [player + 0x15], 0xf
 * 0043d61d  and  dword [node[旧格] + 0x24], ~(0x100 << idx)
 * 0043d621  player.nodeId = word [0x48bae0] ; 监狱格号（医院 [0x48bae2]）
 * 0043d630  player.lastNodeId = 0
 * 0043d637  byte [player + 0x1b] = 0xf      ; 朝向后备哨兵（见下）
 * 0043d647  player.x/y = 景观记录[2].x/y    ; 医院取景观记录[1]
 * 0043d668  call 0x40fc00(player)           ; ★ 跟班搬到同一格
 * 0043d674  byte [idx + 0x496b30] = 1       ; 占用表置位
 * ```
 *
 * ⚠️ **三处有意不复刻的细节**（都不影响规则态）：
 *   ① `node[+0x24]` 的占用掩码本引擎**不镜像**（占用由 `runtimeOccupiedNodes`
 *      按 `nodeId` 现算），故"清旧格占用位"不需要对应代码；
 *   ② `player+0x1b` 是**一次移动内的朝向后备**，本引擎的移动是原子的，没有
 *      "动画中途"这一状态（见 `docs/systems/save-scalars.md` §2.17(b)）；它唯一
 *      的读者 `0x418f2e` 只用它在**释放回棋盘**时恢复朝向，而关押写的是哨兵
 *      `0xf`（= 不恢复）；
 *   ③ `0x41d476`（重绘）、`0x44f2c2`（换立绘）、`0x44ef41`（换动作）
 *      三条**纯表现**调用按 C-ARC-2 留给客户端。
 *
 * ⚠️ 保险理赔**不在**本函数里：原版紧随其后 `push days; push idx; call 0x44ba63`
 *   （`0x43d749`，金额 = `天数 × 2000 × 物价指数`，见 `fortune.md` §2.5），
 *   remake 对应的是 `reduce.ts` 的 `insureConfinement(state, topo, index, days)` ——
 *   它需要 `GameState`，故留在调用点。**凡是首次关押的调用点都必须调它**。
 *
 * @param nodes `MapTopology.nodes`（下标 = 节点号 − 1）；找不到格子则不传送
 */
export function sendToConfinement(
  players: readonly Player[],
  objects: readonly MapObject[],
  nodes: readonly MapNode[],
  occupancy: readonly number[],
  kind: ConfinementKind,
  index: number,
  days: number,
  otherOccupancy?: readonly number[],
  landscapes?: readonly LandscapeInfo[],
): ConfineOutcome {
  const c = confine(players, occupancy, kind, index, days, otherOccupancy);
  const target = c.players[index];
  // 加刑分支（`0x43d6bd`）不传送，跟班也不动；下标越界同样什么都不做
  if (c.extended || target === undefined) {
    return { ...c, objects: [...objects], teleported: false };
  }
  // ★★ 关押格 = `type` 为 0x1f41/0x1f42 的那一格（`[0x48bae0]`/`[0x48bae2]`），
  //    **不是**带保釋菜单的監獄/醫院落点特殊格 —— 见 `CONFINEMENT_GATE_TYPE` 的长注释。
  const gate = confinementGateNodeId(nodes, kind);
  if (gate <= 0) return { ...c, objects: [...objects], teleported: false };
  const moved = teleportToGate(c.players, nodes, index, gate, kind, landscapes);
  const p = moved[index];
  return {
    ...c,
    players: moved,
    objects: p === undefined ? [...objects] : syncEscortNodes(objects, p),
    teleported: true,
  };
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

/**
 * 占用表里**是否任何一个槽**有人/物 —— 用于**落点判定**。
 *
 * @source `0x0043d30e`–`0x0043d324`（监狱落点处理开头）：
 * ```asm
 * 0043d30e  xor  ebx, ebx
 * 0043d310  jmp  0x43d318
 * 0043d312  inc  ebx
 * 0043d313  cmp  ebx, 8
 * 0043d316  jge  0x43d321
 * 0043d318  cmp  byte ptr [ebx + 0x496b30], 0   ; 逐槽
 * 0043d31f  je   0x43d312
 * 0043d321  cmp  ebx, 8
 * 0043d324  je   0x43d588                        ; 扫完 8 槽全 0 → 直接返回
 * ```
 * ★ **落点扫的是全部 8 槽**（0..3 玩家 + 4..7 地图物件），故用本函数。
 */
export function anyoneConfined(occupancy: readonly number[]): boolean {
  return occupancy.some((v) => v !== 0);
}

/**
 * 占用表的**前 4 个槽**（= 玩家）里是否有人 —— 用于**新闻事件的前置条件**。
 *
 * @source `0x00448c99` / `0x00448cab`：
 * ```asm
 * 00448c99  cmp  dword ptr [0x496b30], 0   ; ★ 一次比 **4 个字节**
 * 00448ca0  jne  0x448ec3
 * ...
 * 00448cab  cmp  dword ptr [0x496b60], 0   ; 医院同构
 * ```
 * `cmp dword` 一次比 4 字节 ⇒ 新闻只看**槽 0..3**，与落点的 8 槽扫描**不同**。
 * 差别只在「**仅**物件槽（4..7）被占用」时显现：那时落点认为"有人"（该给保释），
 * 而新闻认为"没人"（不该出"越狱/逃院"消息）。两者混用会在这类局面下分叉。
 */
export function anyPlayerConfined(occupancy: readonly number[], playerSlots = OBJECT_SLOT_BASE): boolean {
  return occupancy.slice(0, playerSlots).some((v) => v !== 0);
}

/**
 * 关押是否**刑满待释放**。
 * 计数值等于 `RELEASE_PENDING` 时，下一次推进就会放人。
 */
export function isReleasePending(p: Player, kind: ConfinementKind): boolean {
  return p.blocking[COUNTER[kind]] === RELEASE_PENDING;
}
