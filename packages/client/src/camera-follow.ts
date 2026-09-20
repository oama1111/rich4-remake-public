/*
 * 镜头该盯着谁 —— 纯函数
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么单独一个模块：第四份回报第 2/5 条（视角跟踪 / 坐牢的人看不见）
 *   的判据全是「状态 → 世界坐标」，与画布无关；放这里能单测，
 *   而 `main.ts` 那边只剩一句 `camera = { ...camera, tileX: x >> 5, tileY: y >> 5 }`。
 *
 * 原版只有**一支**居中函数 `fcn_00415e70`（VA 0x00415e70）：
 *   有标记（`[0x48be18] != 0`）就用标记的 `[0x48be1c]/[0x48be20]`，
 *   否则用 `[0x49910c]` 那个**当前行动者**的世界坐标
 *   （玩家读 `player+0x08/+0x0a`；替身读 `0x498e28 + slot*0x10` 的 `+0x00/+0x02`）。
 *
 * 三条由此推出的口径：
 *   ① 棋子**一步步走**时，`+0x08/+0x0a` 每 tick 被走路例程累加
 *      （`0x40c38a`/`0x40c3a4`）⇒ 镜头跟着**插值点**走；
 *   ② 機器娃娃 / 四大惡人在盘上时 `[0x49910c]` 被切成 4..7
 *      （见 `rules/npc-walk.ts` 的文件头）⇒ 那一趟跟着**替身**；
 *   ③ 被关押时 `+0x08/+0x0a` 被写成**景观**坐标（綠島／醫院大樓，`0x43d627` 那一族），
 *      而 `nodeId` 仍是關押格 ⇒ 镜头要跟 `xpos/ypos`，否则坐牢的人在画面外。
 */

/** 只有这个模块关心的那几个玩家字段 */
export interface FollowPlayer {
  readonly nodeId: number;
  readonly xpos: number;
  readonly ypos: number;
  readonly blocking: {
    readonly inHotel: number;
    readonly disappearing: number;
    readonly inPrison: number;
    readonly inHospital: number;
  };
}

/** 镜头目标（世界坐标）；`null` = 没有可跟的，调用方照旧按格心画 */
export interface CameraTarget {
  readonly x: number;
  readonly y: number;
  /** 跟着谁 —— 只给日志与测试用 */
  readonly reason: 'walker' | 'confined' | 'node';
}

/**
 * 这一帧镜头该盯的世界坐标。
 *
 * @param walker 补间中的那个人/替身的**插值世界坐标**（`renderer.actorCenterWorld()`）；
 *               `null` = 没有补间
 * @param me     当前行动者（`state.players[state.currentPlayer]`）
 * @param nodeAt 取节点坐标（`map.nodes[id - 1]`）
 */
export function cameraFollowTarget(
  walker: { x: number; y: number } | null,
  me: FollowPlayer | undefined,
  nodeAt: (nodeId: number) => { x: number; y: number } | undefined,
): CameraTarget | null {
  // ① 补间优先（走子 / 替身）—— 原版那两族的坐标每 tick 都在动
  if (walker !== null) return { x: walker.x, y: walker.y, reason: 'walker' };
  if (me === undefined) return null;
  // ③ 被关押/住店/消失：贴图位置是**景观**，`nodeId` 指的还是關押格
  const b = me.blocking;
  if (b.inPrison !== 0 || b.inHospital !== 0 || b.inHotel !== 0 || b.disappearing !== 0) {
    return { x: me.xpos, y: me.ypos, reason: 'confined' };
  }
  // ② 平常就是那一格
  const node = nodeAt(me.nodeId);
  if (node === undefined) return null;
  return { x: node.x, y: node.y, reason: 'node' };
}
