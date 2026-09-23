/*
 * 镜头该盯着谁 —— 第四份回报第 2 / 5 条
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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

  it('★★ W-52：影片窗口里要传 **before** 的那个人 —— 镜头还在原地，不是医院景观', () => {
    // 狗咬那一拍：`after` 里人已经被搬进医院（贴图在醫院大樓 319,990），
    // 而影片窗口里棋盘按 `before` 画（`main.ts` 的 `boardDrawState()`）
    // ⇒ 镜头必须按**同一份**状态取人，否则补间走完到影片起播之间那几百毫秒
    //   镜头已经切到医院，画面上人却还在原地。
    //   @source 原版次序 0x0041b8cd 狗咬片 → 0x0043ec78 view_to（对人）→ 搬到医院
    //     → 0x0043ed59 救护车 → 0x0043eda0 view_to（对医院）
    const before = me({ nodeId: 47, xpos: 640, ypos: 640 });
    const after = me({
      nodeId: 23,
      xpos: 319,
      ypos: 990,      blocking: { inHotel: 0, disappearing: 0, inPrison: 0, inHospital: 3 },
    });
    expect(cameraFollowTarget(null, before, nodeAt)).toEqual({ x: 640, y: 640, reason: 'node' });
    // ★ 反证：拿 `after` 去问，镜头就跑到醫院大樓了 —— 那正是 W-52 要修掉的现象
    expect(cameraFollowTarget(null, after, nodeAt)).toEqual({
      x: 319,
      y: 990,
      reason: 'confined',
    });
  });
});

/*
 * ★★ W-52 的宿主那一半（镜头**冻住**的那一句）—— 源码钉子。
 *
 * 为什么单独钉：这一条的**位置**就是全部内容。`cameraFollowTarget` 的 `confined` 支
 * 读的是 after 的 `xpos/ypos`（人已经被搬到醫院大樓），所以「冻住」那一句必须排在
 * 它**之前**；排在后面时单测与类型检查**都是绿的**，只有实机看得出来
 * （浏览器实测：地图 0、`humans=1`、徒步踩惡犬 —— 排后面时镜头在补间收完那一刻
 * 跳到 `(319,990)`；排前面时冻在补间终点约 4.4 s（= 狗咬片 4.332 s），片完才走）。
 */
describe('★ main.ts 的 W-52 接线（源码钉子：冻镜头那一句的**位置**）', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('★★ 「影片窗口里冻住」必须排在 `cameraFollowTarget` **之前**', () => {
    const freeze = src.indexOf('if (walkWorld === null && boardFilmWindowOpen(boardFilmWindowFlags())) return;');
    const follow = src.indexOf('const target = cameraFollowTarget(walkWorld, me, (id) => map.nodes[id - 1]);');
    expect(freeze).toBeGreaterThan(-1);
    expect(follow).toBeGreaterThan(-1);
    expect(freeze).toBeLessThan(follow);
  });

  it('★ 判据与 `boardDrawState()` 同源（同一个 `boardFilmWindowFlags()`）', () => {
    // 第九份試玩回報起，`boardDrawState()` 多带一个「等級有沒有放出來」的入參
    // （機器工人大锤片第 48 帧中途放开）—— 判據來源仍是同一個 `boardFilmWindowFlags()`
    // 第十四份試玩回報起再多一档「片中重画后只按住人」（`playersOnly`）—— 判據來源照旧
    expect(src).toContain('boardStateForFilm(state, deferredBoardBefore, boardFilmWindowFlags(), !released && !playersOnly, !playersOnly)');
    expect((src.match(/boardFilmWindowFlags\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('★ 走子/替身补间在影片窗口里**照跟**（只有「没有补间」时才冻）', () => {
    // 条件里那一条 `walkWorld === null` 就是它；去掉它狗咬那一趟的走子就没镜头了
    expect(src).toContain('if (walkWorld === null && boardFilmWindowOpen(boardFilmWindowFlags())) return;');
  });
});
