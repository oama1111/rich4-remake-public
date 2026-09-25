/*
 * Q-TOOL-1：棋盘视口的「方窗」—— 爆炸范围 / 电脑视野的判据
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这个用例文件**故意不复用** `inBoardWindow`：它按 `0x4090fc` 那一支的步骤
 * （`projectCell` + `subtileOffset` + 镜头自己的亚格余量）另写一遍当预言机，
 * 把「窗」的形状、半开区间、以及「在世界空间里是斜的」这三件事钉住。
 * 具体数字全部来自 exe 提取出来的那张 8×29×29 表（`binary-truth.test.ts` 逐项比过）。
 */
import { describe, expect, it } from 'vitest';
import { VIEW_CENTER, projectCell, subtileOffset } from '@rich4/data';
import {
  BOARD_VIEW_HALF,
  BOARD_VIEW_SIZE,
  RULE_VIEW_ROTATION,
  boardInstancePresent,
  inBoardWindow,
  projectOnBoard,
} from './board-window.ts';

/**
 * 预言机 @source `0x4090fc`（地块实例）逐行：
 * ```asm
 * 00409102/00409115  col/row = (坐标 >> 5) − 镜头块 + 14
 * 0040914a  call 0x407a2c(点x, 点y, &o1, &o2)     ; 点自己的亚格余量
 * 00409166  X = 表[col,row].x − o1 + [esp+0x34]   ; [esp+0x34] = 镜头的 o1 + 220
 * 0040917b  Y = 表[col,row].y − o2 + [esp+0x20]   ; [esp+0x20] = 镜头的 o2 + 260
 * ```
 * 减掉 220/260 的基准 ⇒ 相对棋盘区中心的偏移。
 */
function oracleRel(center: { x: number; y: number }, p: { x: number; y: number }, view: number) {
  const col = (p.x >> 5) - (center.x >> 5) + VIEW_CENTER;
  const row = (p.y >> 5) - (center.y >> 5) + VIEW_CENTER;
  const base = projectCell(view, row, col);
  if (base === null) return null;
  const o = subtileOffset(view, p.x & 0x1f, p.y & 0x1f);
  const c = subtileOffset(view, center.x & 0x1f, center.y & 0x1f);
  return { x: base.x - o.x + c.x, y: base.y - o.y + c.y };
}

const oracleIn = (center: { x: number; y: number }, p: { x: number; y: number }, half: number) => {
  const r = oracleRel(center, p, 0);
  return r !== null && r.x >= -half && r.x < half && r.y >= -half && r.y < half;
};

describe('★ 窗口常量（Q-TOOL-1，@source 0x40a45c）', () => {
  it('棋盘区 440×440、半宽 220 @source 0x40a46b `mov edi,0x1b8` / 0x40a472 `mov ebp,0xdc`', () => {
    expect(BOARD_VIEW_SIZE).toBe(440);
    expect(BOARD_VIEW_HALF).toBe(220);
    expect(BOARD_VIEW_HALF * 2).toBe(BOARD_VIEW_SIZE);
    // `0x409dea push 0x5e880` = 440×440×2 字节（每个像素一个字）
    expect(BOARD_VIEW_SIZE * BOARD_VIEW_SIZE * 2).toBe(0x5e880);
  });

  it('★ 规则层恒用视角 0（需求方 2026-09-25 的联机口径）', () => {
    expect(RULE_VIEW_ROTATION).toBe(0);
    // 视角 0 与其它视角**确实**给出不同的偏移 —— 否则「用视角 0」这句话没有内容
    const c = { x: 1000, y: 1000 };
    const p = { x: 1160, y: 1160 };
    expect(projectOnBoard(c, p.x, p.y)).toEqual(projectOnBoard(c, p.x, p.y, 0));
    expect(projectOnBoard(c, p.x, p.y, 1)).not.toEqual(projectOnBoard(c, p.x, p.y, 0));
  });
});

describe('★ projectOnBoard 与 `0x4090fc` 那一段逐步同值', () => {
  const centers = [
    { x: 1000, y: 1000 },
    { x: 1463, y: 239 },
    { x: 1752, y: 1871 },
    { x: 360, y: 239 },
    { x: 1103, y: 384 },
  ];
  it('镜头自己恒投到 (0,0)（表 [14,14] = (0,0)，两项余量相消）', () => {
    for (const c of centers) expect(projectOnBoard(c, c.x, c.y), `${c.x},${c.y}`).toEqual({ x: 0, y: 0 });
  });

  it('任意点在 8 个视角下都与预言机一致（含 29×29 表外 → null）', () => {
    for (const c of centers) {
      for (let dx = -600; dx <= 600; dx += 37) {
        for (let dy = -600; dy <= 600; dy += 53) {
          const p = { x: c.x + dx, y: c.y + dy };
          for (let v = 0; v < 8; v++) {
            expect(projectOnBoard(c, p.x, p.y, v), `${c.x},${c.y} +${dx},+${dy} view${v}`).toEqual(
              oracleRel(c, p, v),
            );
          }
        }
      }
    }
  });

  it('表外（29×29 之外）返回 null —— 原版此时根本不画它', () => {
    const c = { x: 1000, y: 1000 };
    expect(projectOnBoard(c, c.x + 2000, c.y)).toBeNull();
    expect(inBoardWindow(c, { x: c.x + 2000, y: c.y }, 220)).toBe(false);
  });
});

describe('★★ 窗是**屏幕空间**的方窗，不是节点坐标的方框（Q-TOOL-1 的核心）', () => {
  const center = { x: 1000, y: 1000 };

  it('世界距离 100 的 +x 点**出窗**（投影后 px = 110），而 +y 方向 100 还在窗里（py = 79）', () => {
    // 预言机给出的实数（视角 0、中心 (1000,1000)）：+x100 → (110,−33)、+y100 → (45,79)
    expect(oracleRel(center, { x: 1100, y: 1000 }, 0)).toEqual({ x: 110, y: -33 });
    expect(oracleRel(center, { x: 1000, y: 1100 }, 0)).toEqual({ x: 45, y: 79 });
    expect(inBoardWindow(center, { x: 1100, y: 1000 }, 100)).toBe(false);
    expect(inBoardWindow(center, { x: 1000, y: 1100 }, 100)).toBe(true);
  });

  it('世界距离 126 的 +y 点**在窗里**（py = 99）—— 旧的「节点坐标 ±100 方框」会把它漏掉', () => {
    expect(oracleRel(center, { x: 1000, y: 1126 }, 0)).toEqual({ x: 57, y: 99 });
    expect(Math.abs(1126 - center.y)).toBeGreaterThan(100);
    expect(inBoardWindow(center, { x: 1000, y: 1126 }, 100)).toBe(true);
  });

  it('半开区间：px = 100 出窗、px = 99 在窗里；px = −100 在窗里、px = −101 出窗', () => {
    // x 方向：+89 → 99（在）、+90 → 100（出）；−88 → −100（在）、−89 → −101（出）
    expect(oracleRel(center, { x: 1089, y: 1000 }, 0)!.x).toBe(99);
    expect(inBoardWindow(center, { x: 1089, y: 1000 }, 100)).toBe(true);
    expect(oracleRel(center, { x: 1090, y: 1000 }, 0)!.x).toBe(100);
    expect(inBoardWindow(center, { x: 1090, y: 1000 }, 100)).toBe(false);
    expect(oracleRel(center, { x: 912, y: 1000 }, 0)!.x).toBe(-100);
    expect(inBoardWindow(center, { x: 912, y: 1000 }, 100)).toBe(true);
    expect(oracleRel(center, { x: 911, y: 1000 }, 0)!.x).toBe(-101);
    expect(inBoardWindow(center, { x: 911, y: 1000 }, 100)).toBe(false);
    // y 方向同上：+126 → 99（在）、+127 → 100（出）
    expect(oracleRel(center, { x: 1000, y: 1127 }, 0)!.y).toBe(100);
    expect(inBoardWindow(center, { x: 1000, y: 1127 }, 100)).toBe(false);
  });

  it('整幅画面（半宽 220）= 投影偏移 ±220 以内，且比半径 100 的窗大得多', () => {
    // +200 x → px = 223 > 220 ⇒ 连整幅都出了（表内、但出棋盘区）
    expect(oracleRel(center, { x: 1200, y: 1000 }, 0)).toEqual({ x: 223, y: -66 });
    expect(inBoardWindow(center, { x: 1200, y: 1000 }, BOARD_VIEW_HALF)).toBe(false);
    expect(inBoardWindow(center, { x: 1100, y: 1000 }, BOARD_VIEW_HALF)).toBe(true);
    expect(inBoardWindow(center, { x: 1100, y: 1000 }, 100)).toBe(false);
    expect(inBoardWindow(center, { x: 1000, y: 1126 }, BOARD_VIEW_HALF)).toBe(true);
  });

  it('窗内集合与预言机逐点一致（半径 100 / 220 两档，散点扫一遍）', () => {
    for (const half of [100, BOARD_VIEW_HALF]) {
      for (const c of [
        { x: 1000, y: 1000 },
        { x: 1463, y: 239 },
        { x: 720, y: 1367 },
      ]) {
        for (let dx = -320; dx <= 320; dx += 17) {
          for (let dy = -320; dy <= 320; dy += 23) {
            const p = { x: c.x + dx, y: c.y + dy };
            expect(inBoardWindow(c, p, half), `half=${half} ${c.x},${c.y} +${dx},+${dy}`).toBe(
              oracleIn(c, p, half),
            );
          }
        }
      }
    }
  });
});

describe('★ id 图里有没有这个实例 @source 0x4091df..0x409240 / 0x4093f3..0x409488', () => {
  it('「没房子又没主」的地块/設施不在图上 ⇒ 爆炸扫不到它', () => {
    expect(boardInstancePresent(0, 0)).toBe(false);
    expect(boardInstancePresent(1, 0)).toBe(true); // 有房子、无主
    expect(boardInstancePresent(0, 2)).toBe(true); // 没房子、有主
    expect(boardInstancePresent(3, 1)).toBe(true);
  });
});
