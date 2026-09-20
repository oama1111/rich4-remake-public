/*
 * 镜头该盯着谁 —— 第四份回报第 2 / 5 条
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { cameraFollowTarget, type FollowPlayer } from './camera-follow.ts';

const NODES: Record<number, { x: number; y: number }> = {
  1: { x: 1752, y: 1871 }, // 監獄關押格（0001.bin）
  23: { x: 384, y: 1056 }, // 醫院關押格
  47: { x: 640, y: 640 }, // 普通格
};
const nodeAt = (id: number) => NODES[id];

function me(over: Partial<FollowPlayer> = {}): FollowPlayer {
  return {
    nodeId: 47,
    xpos: 640,
    ypos: 640,
    blocking: { inHotel: 0, disappearing: 0, inPrison: 0, inHospital: 0 },
    ...over,
  };
}

describe('★ cameraFollowTarget', () => {
  it('★ 没有补间、也没被关 → 跟当前玩家那一格', () => {
    expect(cameraFollowTarget(null, me(), nodeAt)).toEqual({ x: 640, y: 640, reason: 'node' });
  });

  it('★★ 走子/替身补间优先 —— 镜头跟着**插值点**（不是格心）', () => {
    const t = cameraFollowTarget({ x: 700, y: 650 }, me(), nodeAt);
    expect(t).toEqual({ x: 700, y: 650, reason: 'walker' });
  });

  it('★★ 被关押时跟 **xpos/ypos**（景观：綠島／醫院大樓），不是 nodeId 那一格', () => {
    // 監獄：nodeId = 關押格 1，但贴图在綠島 (1817,1960)
    const prison = me({
      nodeId: 1,
      xpos: 1817,
      ypos: 1960,
      blocking: { inHotel: 0, disappearing: 0, inPrison: 3, inHospital: 0 },
    });
    expect(cameraFollowTarget(null, prison, nodeAt)).toEqual({ x: 1817, y: 1960, reason: 'confined' });
    // ★ 反证：按 nodeId 会得到 (1752,1871) —— 那样人就跑到镜头外了
    expect(NODES[1]).toEqual({ x: 1752, y: 1871 });
  });

  it('★ 住院 / 消失 / 住店 同样按贴图位置', () => {
    for (const key of ['inHospital', 'disappearing', 'inHotel'] as const) {
      const p = me({
        nodeId: 23,
        xpos: 319,
        ypos: 990,
        blocking: { inHotel: 0, disappearing: 0, inPrison: 0, inHospital: 0, [key]: 2 },
      });
      expect(cameraFollowTarget(null, p, nodeAt)?.reason).toBe('confined');
    }
  });

  it('★ 被关押**且**正在走回棋盘（有补间）→ 补间优先', () => {
    const p = me({ nodeId: 1, xpos: 1817, ypos: 1960, blocking: { inHotel: 0, disappearing: 0, inPrison: 1, inHospital: 0 } });
    expect(cameraFollowTarget({ x: 1800, y: 1950 }, p, nodeAt)?.reason).toBe('walker');
  });

  it('★ 没有当前玩家 / 节点越界 → null（调用方自己兜）', () => {
    expect(cameraFollowTarget(null, undefined, nodeAt)).toBeNull();
    expect(cameraFollowTarget(null, me({ nodeId: 999 }), nodeAt)).toBeNull();
  });
});
