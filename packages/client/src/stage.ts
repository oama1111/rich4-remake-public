/*
 * 定屏舞台 —— 原版是 640×480，不是「铺满窗口」
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这是「画面复刻」的地基。原版整个游戏画在一块 **640×480** 的屏上，
 *   各区块的位置是**固定像素**：
 *
 * ```
 *   ┌──────────────────────────────┬────────────┐
 *   │ 工具栏  439×40               │            │  x=440 起
 *   ├──────────────────────────────┤  側欄      │  Panel.mkf 资源 0
 *   │                              │  200×280   │
 *   │ 棋盘 439×440                 ├────────────┤
 *   │ （人物视角等距投影）          │  小地图等  │
 *   │                              │  200×200   │
 *   └──────────────────────────────┴────────────┘
 *                    640 × 480
 * ```
 *
 *   `439 + 200 = 639`、`40 + 440 = 480` —— 两个方向都正好合上，
 *   这不是凑出来的：工具栏底条本来就是 439×40（见 render.ts 的 TOOLBAR），
 *   側欄本来就是 200×280（见 hud.ts 的 PANEL_*）。
 *
 * ⚠️ 先前客户端把棋盘拉满整个窗口、側欄做成 HTML 侧边栏 —— 那样
 *   **视角与取景都不对**：等距投影是按「屏幕中心 ± 若干像素」取景的，
 *   画布一大，一屏里就塞进了远超原版的格子数，看起来完全是另一个游戏。
 *
 * 本模块只管一件事：给一块 640×480 的画布，并把它按**整数倍**放大居中，
 * 让像素保持锐利（原版是 8bpp 点阵图，插值放大会糊）。
 */

/** 原版屏幕尺寸 */
export const SCREEN_W = 640;
export const SCREEN_H = 480;

/** 各区块在 640×480 里的位置 */
export const LAYOUT = {
  /** 顶部工具栏 @source 底条精灵 439×40 */
  toolbar: { x: 0, y: 0, w: 439, h: 40 },
  /** 棋盘 */
  board: { x: 0, y: 40, w: 439, h: 440 },
  /** 右側欄（Panel.mkf 资源 0 的整图） */
  panel: { x: 440, y: 0, w: 200, h: 280 },
  /** 側欄下方：按钮排 + 小地图 */
  sidebar: { x: 440, y: 280, w: 200, h: 200 },
} as const;

export interface StageMetrics {
  /** 放大倍数（整数） */
  scale: number;
  /** 舞台在画布里的左上角（居中留边） */
  offsetX: number;
  offsetY: number;
}

/**
 * 算出这块画布该用几倍放大、居中放在哪。
 *
 * ★ **整数倍**：原版素材是点阵图，非整数倍缩放会让像素边缘糊掉。
 *   窗口比 640×480 还小时退回 1 倍并裁切 —— 宁可看不全，也不糊。
 */
export function stageMetrics(viewW: number, viewH: number): StageMetrics {
  const raw = Math.min(viewW / SCREEN_W, viewH / SCREEN_H);
  const scale = Math.max(1, Math.floor(raw));
  return {
    scale,
    offsetX: Math.floor((viewW - SCREEN_W * scale) / 2),
    offsetY: Math.floor((viewH - SCREEN_H * scale) / 2),
  };
}

/** 把鼠标的画布坐标换算成舞台（640×480）坐标；在舞台外返回 null */
export function toStage(
  sx: number,
  sy: number,
  m: StageMetrics,
): { x: number; y: number } | null {
  const x = (sx - m.offsetX) / m.scale;
  const y = (sy - m.offsetY) / m.scale;
  if (x < 0 || y < 0 || x >= SCREEN_W || y >= SCREEN_H) return null;
  return { x, y };
}

/** 一个矩形命中测试 */
export function inRect(
  x: number,
  y: number,
  r: { x: number; y: number; w: number; h: number },
): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}
