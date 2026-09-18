/*
 * 地图视角档位
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版是全局 `[0x499088]`，**8 个视角、每步 45°**：
 *   · 改变：`<` / `>` 两个热键（`rich4_keyboard_hook` 一族）；侧栏小地图那支
 *     也会调（`rotateView(pressedMinimapArrow === 1 ? -1 : 1)`）；
 *   · 使用：所有建筑/地物的精灵图号都按它旋转 ——
 *     `图号 = (8 − (朝向 + 视角)) & 7`（`client/assets.ts` 的 `buildingImageIndex`）；
 *   · 持久化：进存档 `+0x2743`（写侧 `@source 0x0040330d`、读侧 `@source 0x00402e6d`）。
 *
 * ★ 本模块只负责**档位算术**（含取模），让 reducer、客户端与存档三处共用同一份规则 ——
 *   先前客户端把档位存在自己的 `camera.view` 里、**从不写回状态**，
 *   于是旋转过的视角既不会被存档带上、读档时也不会还原（D-06 的另一半）。
 */

/** 视角总数（8 个，每步 45°）@source `[0x499088]` 只取低 3 位 */
export const VIEW_ROTATION_COUNT = 8;

/**
 * 把视角档位转动 `delta` 步（可正可负、可超过 8），结果落在 `[0, 8)`。
 *
 * 原版对 `[0x499088]` 的写入是 `add`/`sub` 后由取值方 `& 7` 夹住
 * （读档时也是 `& 7`，见 `loaders/save.ts` 的 `viewRotation`），
 * 这里把它显式化成取模，避免负值漏出去。
 */
export function rotateViewBy(current: number, delta: number): number {
  const base = Number.isFinite(current) ? Math.trunc(current) : 0;
  const step = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  return (((base + step) % VIEW_ROTATION_COUNT) + VIEW_ROTATION_COUNT) % VIEW_ROTATION_COUNT;
}
