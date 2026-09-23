/*
 * 監獄 / 醫院保釋屏（T-038）—— 落在監獄或醫院格上时那一屏
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 两个入口逐条同构，只差资源号、槽位表、占用表与两张「谁在里面」的图号基址：
 *
 * | | 監獄 | 醫院 |
 * |---|---|---|
 * | 入口 | `_rich4_ui_prison_entry` VA 0x0043d304 | `_rich4_ui_hospital_entry` VA 0x0043e9a4 |
 * | 资源 | `Panel.mkf` **63** | `Panel.mkf` **65** |
 * | 槽位表 | `0x475c04`（8 组 x,y）| `0x475c64`（8 组 x,y）|
 * | 占用表 | `0x496b30` | `0x496b60` |
 * | 玩家画 | `character + 5` | `character + 0x0e` |
 * | 犯人画 | `0xd + slot` | `0x16 + slot` |
 * | 點數底板 | 图 21 @ (542,432) | 图 30 @ (8,432) |
 * | 點數数字 | (622,452) | (88,452) |
 *
 * 两头共用 `Panel.mkf` **64** —— 那是四个**惡人立绘**（小偷/強盜/流氓/間諜），
 * 医院还多画一张 `65` 的图 4（医生）在 (104,110)。
 *
 * ## 稳态版面（`fcn_0043c8fb` / `fcn_0043d88f`）
 *
 * ```asm
 * draw_img(surface, 资源[0], 0, 0)                      ; 640×480 底图（窗格/病床都烤在里面）
 * for (slot = 0..7) {
 *   if (占用[slot] == 0) { 監獄: draw(资源[4], x, y)    ; 監獄画**空的铁栅**；医院什么都不画
 *                          continue }
 *   draw(资源[slot < 4 ? character+基址 : 犯人基址+slot], x, y)
 *   監獄: draw(资源[3], x, y)                            ; 铁栅盖在脸上
 * }
 * draw(资源[點數底板图], 底板x, 432)
 * itoa(currentPlayer.點券) → text((数字x), 452, flag 6)   ; 20 号、白字黑边
 * ```
 *
 * ★ **8 个窗格是烤在底图里的** —— 所以槽位坐标对不对，一眼就能看出来
 *   （脸不落在窗格里就是错的），这也是本屏最好的自检。
 *
 * ## 命中
 *
 * @source `loc_0043cc1c`（悬停）与 `loc_0043cfdb`（点）用的是**同一个判据**：
 * ```asm
 * if (占用[slot] == 0) continue
 * if (x < x0 || x > x0 + 0x79) continue        ; 122 宽
 * if (y < y0 || y > y0 + 0x89) continue        ; 138 高
 * ```
 * 即 `[x0, x0+0x79] × [y0, y0+0x89]`（**两端都含**），比图本身（132×137）大一圈。
 */

import type { Sprite } from './assets.ts';
import { FONT_FAMILY, drawGdiText, type GdiTextStyle } from './font.ts';
import { bailCost } from '@rich4/core';

export const BAIL_ARCHIVE = 'Panel.mkf';

/** 每个槽位的左上角 —— 直接抄 exe 的表 @source `0x475c04` / `0x475c64` */
export const PRISON_SLOTS: readonly { x: number; y: number }[] = [
  { x: 33, y: 24 },
  { x: 185, y: 24 },
  { x: 336, y: 24 },
  { x: 487, y: 24 },
  { x: 33, y: 183 },
  { x: 185, y: 183 },
  { x: 336, y: 183 },
  { x: 487, y: 183 },
];
export const HOSPITAL_SLOTS: readonly { x: number; y: number }[] = [
  { x: 297, y: 1 },
  { x: 297, y: 121 },
  { x: 297, y: 241 },
  { x: 297, y: 361 },
  { x: 481, y: 1 },
  { x: 481, y: 121 },
  { x: 481, y: 241 },
  { x: 481, y: 361 },
];

/** 命中框：比图大一圈 @source `lea edx,[esi+0x79]` / `lea eax,[esi+0x89]` */
export const BAIL_SLOT_HIT = { w: 0x79 + 1, h: 0x89 + 1 } as const;

/** 玩家槽（< 4）与犯人槽的分界 —— 与 `OBJECT_SLOT_BASE` 同源 */
export const BAIL_PLAYER_SLOTS = 4;

export interface BailPlaceSpec {
  resource: number;
  slots: readonly { x: number; y: number }[];
  /** 空槽画哪张；医院没有（床位烤在底图里）→ null */
  emptyImage: number | null;
  /** 有人的槽再盖一张；医院没有铁栅 → null @source 監獄 `+0x30` = 图 3 */
  overlayImage: number | null;
  /** 玩家槽：`character + playerImageBase` */
  playerImageBase: number;
  /** 犯人槽：`inmateImageBase + slot`（slot 4..7 → 基址+4..基址+7）*/
  inmateImageBase: number;
  /** 點數底板图号与落点 */
  plateImage: number;
  plateAt: { x: number; y: number };
  /** 點數数字的右对齐点（flag 6 = 右 + 垂直居中）*/
  pointsAt: { x: number; y: number };
  /** 医院多画的那位（医生）；監獄没有 */
  decor?: { image: number; x: number; y: number };
}

export const BAIL_PLACES: Record<'prison' | 'hospital', BailPlaceSpec> = {
  prison: {
    resource: 63,
    slots: PRISON_SLOTS,
    emptyImage: 4,
    overlayImage: 3,
    playerImageBase: 5,
    inmateImageBase: 0xd,
    plateImage: 21,
    plateAt: { x: 542, y: 432 },
    pointsAt: { x: 622, y: 452 },
  },
  hospital: {
    resource: 65,
    slots: HOSPITAL_SLOTS,
    emptyImage: null,
    overlayImage: null,
    playerImageBase: 0xe,
    inmateImageBase: 0x16,
    plateImage: 30,
    plateAt: { x: 8, y: 432 },
    pointsAt: { x: 88, y: 452 },
    decor: { image: 4, x: 104, y: 110 },
  },
};

/** 某个槽位的命中框（屏幕坐标） */
export function bailSlotRect(
  place: 'prison' | 'hospital',
  slot: number,
): { x: number; y: number; w: number; h: number } | null {
  const at = BAIL_PLACES[place].slots[slot];
  if (at === undefined) return null;
  return { x: at.x, y: at.y, w: BAIL_SLOT_HIT.w, h: BAIL_SLOT_HIT.h };
}

/**
 * 点在哪个**有人**的槽位上；没有返回 null。
 *
 * ★ **空槽点不动** —— 判据第一条就是 `if (占用[slot] == 0) continue`。
 *   所以这一屏点了没反应的地方，恰恰是原版也点了没反应的地方。
 */
export function hitBailSlot(
  place: 'prison' | 'hospital',
  x: number,
  y: number,
  occupancy: readonly number[],
): number | null {
  const slots = BAIL_PLACES[place].slots;
  for (let slot = 0; slot < slots.length; slot++) {
    if ((occupancy[slot] ?? 0) === 0) continue;
    const r = bailSlotRect(place, slot);
    if (r === null) continue;
    if (x >= r.x && x <= r.x + r.w - 1 && y >= r.y && y <= r.y + r.h - 1) return slot;
  }
  return null;
}

/** 槽位里那幅画用的是哪一张（空的返回 `emptyImage`，医院为 null）*/
export function bailCellImage(
  place: 'prison' | 'hospital',
  slot: number,
  occupied: boolean,
  character: number,
): number | null {
  const spec = BAIL_PLACES[place];
  if (!occupied) return spec.emptyImage;
  return slot < BAIL_PLAYER_SLOTS
    ? spec.playerImageBase + character
    : spec.inmateImageBase + slot;
}

/**
 * 这一点券够不够**在这一屏上**保釋这个槽位。
 *
 * @source `loc_0043d0bc`：`cmp 點券, 赎金表[slot] / jl 提示不足` —— 即 **`>=` 就行**。
 *
 * ⚠️ 与 `core/rules/visit.ts` 的 `canAffordBail` **不是同一条判据**，别合并：
 *   那条是**电脑**那一支（`cmp eax, esi / jg`，玩家槽要**严格大于**；
 *   犯人槽另加绝对门槛 700）。原版两条路本来就长得不一样：
 *   玩家自己点这一屏是「够付就行」，电脑替自己决定时才多一层挑剔。
 */
export function canPayOnScreen(points: number, slot: number): boolean {
  return points >= bailCost(slot);
}

// ============================================================
//  绘制
// ============================================================

/**
 * 取图。
 *
 * ★ 第四个参数**必须**传：这一屏除底图之外的每一张都是 SMP 的**抠黑**图
 *   （黑是抠图底色，不是黑）。不抠的话「盖铁栅」会把里面那位**整个盖掉** ——
 *   原版用的是透明贴（`fcn_00456418`，跳过 0 像素），照抄成 `drawImage` 就错了。
 */
export type BailSpriteFn = (
  archive: 'Panel.mkf',
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 气泡里的三行：16 号、纯黑、**无描边** @source `set_font(0x10, 0x101010, 0, 2, 0)` */
const BUBBLE_FONT = `16px ${FONT_FAMILY}`;
const BUBBLE_COLOR = '#101010';

/** 底板上的点券数字：20 号、白字 + 黑描边 @source `set_font(0x14, 0xffffff, 0x101010, 3, 0)` */
const POINTS_FONT = `20px ${FONT_FAMILY}`;
const POINTS_FILL = '#ffffff';
const POINTS_OUTLINE = '#101010';

export interface BailSlotView {
  slot: number;
  /** 该槽角色的图号（玩家槽 = 玩家的 character；犯人槽忽略）*/
  character: number;
  /** 里头的名字（悬停气泡要写）—— 玩家用角色名、犯人用 `INMATE_NAMES` */
  name: string;
}

/**
 * 悬停气泡（監獄那一版的几何）。
 *
 * @source `loc_0043cca1` 起：先 `draw_img(res63[2], x0+0x14, y0+0x78)`（蓝底气泡，
 *   100×95），再三行 `draw_text(…, flag 2, 16 号, 0x101010)`：
 *   ```asm
 *   名字      → (x0 + 0x39, y0 + 0x1a)
 *   "保釋點數" → (x0 + 0x39, y0 + 0x30)      ; 串在 0x465140
 *   "%d點數"   → (x0 + 0x39, y0 + 0x46)      ; 串在 0x465149
 *   ```
 *   flag 2 = 正中，所以那几个坐标是**文字块的中心**。
 *
 * ⚠️ 医院那一版的气泡不是整张图，而是**底图上一块 147×102 的子矩形**
 *   （`fcn_0045643d` 贴到 `(x0+0x93, y0+0x66)`），本轮只做監獄这一版。
 */
export const BAIL_BUBBLE = {
  image: 2,
  dx: 0x14,
  dy: 0x78,
  /** ★ 下面三个 y 与 x 都是**相对气泡左上角**，不是相对槽位 ——
   *  asm 里是 `[esp+0x68] + 0x39`，而 `[esp+0x68]` 正是 `x0 + 0x14`。 */
  textDx: 0x39,
  nameDy: 0x1a,
  costLabelDy: 0x30,
  costValueDy: 0x46,
} as const;

/** 气泡里的第二行 @source 0x465140 */
export const BAIL_COST_LABEL = '保釋點數';

/**
 * 画一帧。
 *
 * @param occupancy 占用表（core 的 `prisonOccupancy` / `hospitalOccupancy`）
 * @param views     每个**有人**的槽：slot 与 character（顺序不限）
 * @param points    当前玩家的點券（`loc_0043d8f2` 读的是 `[0x49910c]` 那位）
 * @param hot       光标底下的槽位（`[0x48c4c4]`），用于高亮
 */
export function drawBailScreen(
  ctx: CanvasRenderingContext2D,
  place: 'prison' | 'hospital',
  views: readonly BailSlotView[],
  points: number,
  hot: number | null,
  sprite: BailSpriteFn,
): void {
  const spec = BAIL_PLACES[place];
  const bySlot = new Map(views.map((v) => [v.slot, v]));

  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // 底图**不抠黑**（这是一整屏的画，它的黑是真黑）@source `fcn_004563f5`
  const bg = sprite(BAIL_ARCHIVE, spec.resource, 0, false);
  if (bg !== null) ctx.drawImage(bg.bitmap, 0, 0);

  if (spec.decor !== undefined) {
    const d = sprite(BAIL_ARCHIVE, spec.resource, spec.decor.image, true);
    if (d !== null) {
      ctx.drawImage(d.bitmap, spec.decor.x - d.anchorX, spec.decor.y - d.anchorY);
    }
  }

  // 八个槽位。**空槽先画**（監獄的铁栅），有人的再画脸 + 盖铁栅 ——
  // 原版是按 slot 顺序一路画下来的，顺序不影响结果（槽位不重叠）。
  for (let slot = 0; slot < spec.slots.length; slot++) {
    const at = spec.slots[slot]!;
    const occupied = bySlot.has(slot);

    const content = bailCellImage(place, slot, occupied, bySlot.get(slot)?.character ?? 0);
    if (content !== null) {
      const img = sprite(BAIL_ARCHIVE, spec.resource, content, true);
      if (img !== null) {
        ctx.drawImage(img.bitmap, at.x - img.anchorX, at.y - img.anchorY);
      }
    }
    if (occupied && spec.overlayImage !== null) {
      const bar = sprite(BAIL_ARCHIVE, spec.resource, spec.overlayImage, true);
      if (bar !== null) ctx.drawImage(bar.bitmap, at.x - bar.anchorX, at.y - bar.anchorY);
    }
  }

  // 鼠标底下那格描一道（本项目自己加的：原版靠气泡，没有框）
  if (hot !== null) {
    const r = bailSlotRect(place, hot);
    if (r !== null) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
  }

  // 點數底板 + 数字
  const plate = sprite(BAIL_ARCHIVE, spec.resource, spec.plateImage, true);
  if (plate !== null) {
    ctx.drawImage(plate.bitmap, spec.plateAt.x - plate.anchorX, spec.plateAt.y - plate.anchorY);
  }
  ctx.font = POINTS_FONT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = POINTS_OUTLINE;
  ctx.strokeText(String(points), spec.pointsAt.x, spec.pointsAt.y);
  ctx.fillStyle = POINTS_FILL;
  ctx.fillText(String(points), spec.pointsAt.x, spec.pointsAt.y);

  // 光标底下那一位：气泡（名字 / 保釋點數 / N點數）@source loc_0043cca1
  // ⚠️ 医院那一版的气泡是底图的一块子矩形，几何不同 —— 见 `BAIL_BUBBLE` 的注。
  const hovered = hot === null ? undefined : bySlot.get(hot);
  if (hot !== null && hovered !== undefined && place === 'prison') {
    const at = spec.slots[hot]!;
    const bx = at.x + BAIL_BUBBLE.dx;
    const by = at.y + BAIL_BUBBLE.dy;
    const balloon = sprite(BAIL_ARCHIVE, spec.resource, BAIL_BUBBLE.image, true);
    if (balloon !== null) {
      ctx.drawImage(balloon.bitmap, bx - balloon.anchorX, by - balloon.anchorY);
    }
    ctx.font = BUBBLE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = BUBBLE_COLOR;
    const tx = bx + BAIL_BUBBLE.textDx;
    ctx.fillText(hovered.name, tx, by + BAIL_BUBBLE.nameDy);
    ctx.fillText(BAIL_COST_LABEL, tx, by + BAIL_BUBBLE.costLabelDy);
    ctx.fillText(`${bailCost(hot)}點數`, tx, by + BAIL_BUBBLE.costValueDy);
  }

  ctx.restore();
}


// ============================================================
//  ★ 2026-09-23：柜台人员的字框（`fcn_0044ec30` 开框 + `fcn_0044ecb6` 写字）
// ============================================================

/**
 * 这一屏里两处**稳当读得出来**的字框（其余几处 —— 犯人获释的道谢、醫院護士的三段 —— 挂在
 * 各自的状态机上，本轮没接，见最终报告）：
 *
 * | 哪句 | 框图 | 锚点 | 字心偏移 | @source |
 * |---|---|---|---|---|
 * | 監獄：付不起 | `Panel#63` 图 1 | (0xe6, 0x12c) | (0, −6) | `0x0043cf97..0x0043cfc2`：`0x44ec30(+0x18, 0xe6, 0x12c, 0, −6, 0x101010, 0)` → `0x44ecb6(0x46514e)` |
 * | 醫院：开屏招呼 | `Panel#65` 图 2 | (8, 8) | (0, 0) | `0x0043daf8..0x0043db10`（`0x401` 开框）→ `0x0043db41..0x0043db4f`（`0x405` 写字）|
 *
 * 字：`fcn_0044ecb6` 里 `0x0044ed65 push 1 / push 2 / push ebx(=0) / push esi(0x101010) / push 0x14`
 * ⇒ **20 号、#101010、粗体、无阴影**（第二色 0 ⇒ 字效 2），`draw_text(…, x0 + w/2 + dx, y0 + h/2 + dy, flag 4)`。
 * 挂多久：`fcn_0044ee18` —— 满 0x7d0 = 2000 ms **且**语音不响了才收（与商店 / 貸款屏同一支）。
 */
export const BAIL_CLERK_FRAMES = {
  lowPoints: { place: 'prison', image: 1, x: 0xe6, y: 0x12c, dx: 0, dy: -6 },
  hospitalHello: { place: 'hospital', image: 2, x: 8, y: 8, dx: 0, dy: 0 },
} as const;
export type BailClerkKey = keyof typeof BAIL_CLERK_FRAMES;

/** 字框至少挂多久 @source `0x0044ee4e cmp eax, 0x7d0` */
export const BAIL_CLERK_MS = 0x7d0;

/** 字效 @source `0x0044ed65..0x0044ed73`（第二色 0 ⇒ `push 2`）*/
export const BAIL_CLERK_STYLE: GdiTextStyle = { size: 0x14, color: '#101010', color2: '#000000', flags: 2, spacing: 1 };

/** 这一刻挂着的那一句（`text` 已剥掉 `#NNNN`）*/
export interface BailClerkBubble {
  key: BailClerkKey;
  text: string;
  /** 最早什么时候能收（起播 + 2000 ms，语音更长就撑到语音完）*/
  until: number;
}

/** 画那一句字框（锚点贴框图，字在框的正中再偏 dx/dy）*/
export function drawBailClerk(ctx: CanvasRenderingContext2D, sprite: BailSpriteFn, b: BailClerkBubble): void {
  const f = BAIL_CLERK_FRAMES[b.key];
  const spec = BAIL_PLACES[f.place];
  const img = sprite(BAIL_ARCHIVE, spec.resource, f.image, true);
  if (img === null) return;
  const x0 = f.x - img.anchorX;
  const y0 = f.y - img.anchorY;
  ctx.drawImage(img.bitmap, x0, y0);
  const cx = x0 + img.width / 2 + f.dx;
  const cy = y0 + img.height / 2 + f.dy;
  const lines = b.text.split('\n');
  const lh = BAIL_CLERK_STYLE.size + 6;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    if (line === '') return;
    drawGdiText(ctx, line, cx, cy + (i - (lines.length - 1) / 2) * lh, BAIL_CLERK_STYLE);
  });
  ctx.restore();
}
