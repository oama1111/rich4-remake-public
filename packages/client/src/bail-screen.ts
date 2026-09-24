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
import { drawGdiText, type GdiTextStyle } from './font.ts';
import { BAIL, formatOriginal } from '@rich4/data';
import { bailCost } from '@rich4/core';
import { drawSprite } from './hd-stage.ts';

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

/**
 * 悬停气泡里的三行：16 号、#101010、**粗体**、无阴影，字距 −1
 * @source 監獄 `0x0043cd77..0x0043cd84` / 醫院 `0x0043e4d7..0x0043e4e4`：`create_font(0x10, 0x101010, 0, 2, 0)`
 *   （2026-09-23 订正：第 4 参 2 = 粗体，先前画成细体）
 */
export const BAIL_HOVER_STYLE: GdiTextStyle = { size: 0x10, color: '#101010', color2: '#000000', flags: 2, spacing: 0 };

/**
 * 底板上的点券数字：20 号、白字、**粗体 + 右下 1 px 阴影**，字距 −1
 * @source `set_font(0x14, 0xffffff, 0x101010, 3, 0)`（2026-09-23 订正：3 = 阴影 + 粗体，不是描边）
 */
export const BAIL_POINTS_STYLE: GdiTextStyle = { size: 0x14, color: '#ffffff', color2: '#101010', flags: 3, spacing: 0 };

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

/**
 * 醫院那一版的悬停气泡 = `Panel#65` 图 **3**（98×95，尖角朝右指着病床），落在槽位左边 0x50：
 * @source `loc_0043e456`：`[esp+0x68] = 槽.x − 0x50`、`[esp+0x6c] = 槽.y` → `0x0043e4c5 add eax, 0x30`（图 3）
 *   → `0x0043e4cf call 0x456418`；三行字在 `(x0 + 0x29, y0 + 0x1a / 0x30 / 0x46)` flag 2
 *   （`0x0043e4f0` / `0x0043e533` / `0x0043e56e add eax, 0x29`）。
 *   ★ 先前以为是「底图上一块子矩形」—— 那一句 `fcn_0045643d` 是把上一次的气泡擦掉（贴回存下的底图）。
 */
export const HOSPITAL_HOVER = {
  image: 3,
  dx: -0x50,
  dy: 0,
  textDx: 0x29,
  nameDy: 0x1a,
  costLabelDy: 0x30,
  costValueDy: 0x46,
} as const;

/** 气泡里的第二行 @source 0x465140（監獄）/ 0x4651f9（醫院），两串同字 */
export const BAIL_COST_LABEL = '保釋點數';

/**
 * 画一帧。
 *
 * @param occupancy 占用表（core 的 `prisonOccupancy` / `hospitalOccupancy`）
 * @param views     每个**有人**的槽：slot 与 character（顺序不限）
 * @param points    当前玩家的點券（`loc_0043d8f2` 读的是 `[0x49910c]` 那位）
 * @param hot       光标底下的槽位（`[0x48c4c4]`），用于悬停气泡
 */
export function drawBailScreen(
  ctx: CanvasRenderingContext2D,
  place: 'prison' | 'hospital',
  views: readonly BailSlotView[],
  points: number,
  hot: number | null,
  sprite: BailSpriteFn,
  opts: { hideDecor?: boolean } = {},
): void {
  const spec = BAIL_PLACES[place];
  const bySlot = new Map(views.map((v) => [v.slot, v]));

  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // 底图**不抠黑**（这是一整屏的画，它的黑是真黑）@source `fcn_004563f5`
  const bg = sprite(BAIL_ARCHIVE, spec.resource, 0, false);
  if (bg !== null) drawSprite(ctx, bg, 0, 0);

  if (spec.decor !== undefined && opts.hideDecor !== true) {
    const d = sprite(BAIL_ARCHIVE, spec.resource, spec.decor.image, true);
    if (d !== null) {
      drawSprite(ctx, d, spec.decor.x - d.anchorX, spec.decor.y - d.anchorY);
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
        drawSprite(ctx, img, at.x - img.anchorX, at.y - img.anchorY);
      }
    }
    if (occupied && spec.overlayImage !== null) {
      const bar = sprite(BAIL_ARCHIVE, spec.resource, spec.overlayImage, true);
      if (bar !== null) drawSprite(ctx, bar, at.x - bar.anchorX, at.y - bar.anchorY);
    }
  }

  // ★ 2026-09-23：鼠标底下那格**不描框** —— 原版 0x200 那一支只贴气泡（監獄 `0x0043cbf5` 一带 /
  //   醫院 `0x0043e35b` 一带），先前这里自加的白框已删。

  // 點數底板 + 数字
  const plate = sprite(BAIL_ARCHIVE, spec.resource, spec.plateImage, true);
  if (plate !== null) {
    drawSprite(ctx, plate, spec.plateAt.x - plate.anchorX, spec.plateAt.y - plate.anchorY);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  drawGdiText(ctx, String(points), spec.pointsAt.x, spec.pointsAt.y, BAIL_POINTS_STYLE);

  // 光标底下那一位：气泡（名字 / 保釋點數 / N點）@source 監獄 loc_0043cca1、醫院 loc_0043e456
  const hovered = hot === null ? undefined : bySlot.get(hot);
  if (hot !== null && hovered !== undefined) {
    const at = spec.slots[hot]!;
    const g = place === 'prison' ? BAIL_BUBBLE : HOSPITAL_HOVER;
    const bx = at.x + g.dx;
    const by = at.y + g.dy;
    const balloon = sprite(BAIL_ARCHIVE, spec.resource, g.image, true);
    if (balloon !== null) {
      drawSprite(ctx, balloon, bx - balloon.anchorX, by - balloon.anchorY);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tx = bx + g.textDx;
    drawGdiText(ctx, hovered.name, tx, by + g.nameDy, BAIL_HOVER_STYLE);
    drawGdiText(ctx, BAIL_COST_LABEL, tx, by + g.costLabelDy, BAIL_HOVER_STYLE);
    // ★ 2026-09-23 订正：第三行是 `%d點`（0x465149 / 0x465202），先前多写了一个「數」
    drawGdiText(ctx, formatOriginal(BAIL.pointsN.text, bailCost(hot)), tx, by + g.costValueDy, BAIL_HOVER_STYLE);
  }

  ctx.restore();
}


// ============================================================
//  ★ 2026-09-23：柜台人员的字框（`fcn_0044ec30` 开框 + `fcn_0044ecb6` 写字）与整屏流程
// ============================================================

/**
 * 每一句挂在哪只框里（框图 / 开框点 / 字心偏移），以及说的是哪一句。
 *
 * | 哪句 | 框图 | 开框点 | 字心偏移 | @source |
 * |---|---|---|---|---|
 * | 監獄：付不起 | `Panel#63` 图 1 | (0xe6, 0x12c) | (0, −6) | `0x0043cf97..0x0043cfc2`（串 0x46514e）|
 * | 監獄：犯人道谢 | `Panel#63` 图 1 | (0xd2, 0x96) | (0, −6) | `0x0043d21c..0x0043d249`（`[槽*4 + 0x475be4]`）|
 * | 醫院：开屏招呼 | `Panel#65` 图 2 | (8, 8) | (0, 0) | `0x0043daf8`（`0x401` 开框）→ `0x0043db41..0x0043db4f`（`0x405` 写字）|
 * | 醫院：ＯＫ（YES 之后）| 同上那只框 | | | `0x0043e797..0x0043e7ab`（`[0x475ccc]`）|
 * | 醫院：付不起 | 同上那只框 | | | `0x0043e7b8..0x0043e7c5`（`[0x475cd4]`）|
 * | 醫院：要保重（右键离开）| 同上那只框 | | | `0x0043e916..0x0043e92a`（`[0x475cd0]`）|
 * | 醫院：犯人道谢 | `Panel#65` 图 1 | (0xc8, 0xc8) | (0, −6) | `0x0043de07..0x0043de3c`（`[槽*4 + 0x475be4]`）|
 *
 * 醫院那三句「同上那只框」：`fcn_0044ecb6` 画进**上一次开的框**（`[0x4762bc]`），那只就是开屏 `0x401` 开的
 * 图 2 @ (8,8)；犯人道谢开了图 1 之后，状态 6 收尾 `0x0043df46..0x0043df5e` 又把图 2 @ (8,8) 开回来。
 *
 * 字：`fcn_0044ecb6` 里第二色 0 ⇒ **20 号 #101010 粗体、无阴影**（`font.ts` 的 `clerkTextStyle`）。
 * 挂多久：`fcn_0044ee18` —— 满 0x7d0 = 2000 ms **且**语音不响了才收；挂着时点一下（左 / 右）立刻收
 * （監獄 `0x0043cef6` / 醫院 `0x0043e661 push 1 / call 0x44ee18`）。
 */
export const BAIL_CLERK_FRAMES = {
  lowPoints: { place: 'prison', image: 1, x: 0xe6, y: 0x12c, dx: 0, dy: -6 },
  prisonThanks: { place: 'prison', image: 1, x: 0xd2, y: 0x96, dx: 0, dy: -6 },
  hospitalHello: { place: 'hospital', image: 2, x: 8, y: 8, dx: 0, dy: 0 },
  hospitalOk: { place: 'hospital', image: 2, x: 8, y: 8, dx: 0, dy: 0 },
  hospitalLowPoints: { place: 'hospital', image: 2, x: 8, y: 8, dx: 0, dy: 0 },
  hospitalBye: { place: 'hospital', image: 2, x: 8, y: 8, dx: 0, dy: 0 },
  hospitalThanks: { place: 'hospital', image: 1, x: 0xc8, y: 0xc8, dx: 0, dy: -6 },
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
  drawSprite(ctx, img, x0, y0);
  const cx = x0 + (img.width >> 1) + f.dx;
  const cy = y0 + (img.height >> 1) + f.dy;
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

// ------------------------------------------------------------
//  犯人获释那一张立绘 / 醫院護士道别那一张
// ------------------------------------------------------------

/** 四个惡人的立绘在 `Panel.mkf` **64**（图 0..3 = 槽 4..7）@source 監獄 `0x0043d36d [0x48c4bc]` / 醫院 `[0x48c4d0]` = `read_mkf(Panel, 0x40)` */
export const BAIL_INMATE_RESOURCE = 0x40;
/**
 * 获释犯人立绘的落点（`fcn_00456418` 抠黑贴、按锚点）：
 * 監獄 `0x0043d1cf push 0x1c2 / push 0x16d`；醫院 `0x0043dda7 push 0x1c2 / push 0x1a4`。
 */
export const BAIL_INMATE_AT = { prison: { x: 0x16d, y: 0x1c2 }, hospital: { x: 0x1a4, y: 0x1c2 } } as const;
/** 醫院右键离开时護士换成的那一张 = `Panel#65` 图 9 @ (0x5b, 0x70) @source `0x0043e8bb push 0x70 / push 0x5b` / `add eax, 0x78` */
export const HOSPITAL_BYE_NURSE = { image: 9, x: 0x5b, y: 0x70 } as const;

// ------------------------------------------------------------
//  YES / NO（`_rich4_ui_yesno` 0x00453a32，居中 (320,240)）
// ------------------------------------------------------------

/** 保釋那一问的 YES/NO 居中点 @source 監獄 `0x0043d0e0 push 0xf0 / push 0x140`、醫院 `0x0043e77c` 同 */
export const BAIL_YESNO_CENTER = { x: 0x140, y: 0xf0 } as const;
/** 那块图 96×48（`Data.mkf` 0x1b8，见 `gameui.ts` 的 `YESNO_*`）*/
export const BAIL_YESNO_SIZE = { w: 96, h: 48 } as const;

/** 点在哪一半（图外返回 null）—— 与 `board-screen.ts` 的 `hitYesNo` 同一判据，只是居中点不同 */
export function hitBailYesNo(x: number, y: number): 'yes' | 'no' | null {
  const x0 = BAIL_YESNO_CENTER.x - BAIL_YESNO_SIZE.w / 2;
  const y0 = BAIL_YESNO_CENTER.y - BAIL_YESNO_SIZE.h / 2;
  if (y < y0 || y >= y0 + BAIL_YESNO_SIZE.h || x < x0 || x >= x0 + BAIL_YESNO_SIZE.w) return null;
  return x < x0 + BAIL_YESNO_SIZE.w / 2 ? 'yes' : 'no';
}

// ------------------------------------------------------------
//  整屏流程（纯函数）—— 監獄 `fcn_0043caab` / 醫院 `fcn_0043da27` 的窗口过程
// ------------------------------------------------------------

/**
 * 这一屏走到哪儿了。
 *
 * | 阶段 | 原版 | 说明 |
 * |---|---|---|
 * | `greet` | 醫院状态 1 | 开屏招呼挂着；点一下只收框 |
 * | `idle` | 監獄无框 / 醫院状态 2 | 等点一格（悬停气泡只在这时画）|
 * | `lowPoints` | 監獄 `[0x48c4c8]` / 醫院状态 5 | 付不起那句挂着 |
 * | `confirm` | `0x453a32` | YES/NO 开着 |
 * | `waiting` | —— | 答复已交出（联机要等它落地），画面停在 YES 之前 |
 * | `ok` | 醫院状态 4 | 「ＯＫ！」挂着，那一格还躺着人 |
 * | `thanks` | 監獄犯人 / 醫院状态 6 | 犯人立绘 + 道谢 |
 * | `farewell` | 醫院状态 7 | 護士换图 + 「要保重身體喔！」|
 * | `done` | 監獄 `0x205` / 醫院状态 7 收尾 | 关屏 |
 */
export type BailStage = 'greet' | 'idle' | 'lowPoints' | 'confirm' | 'waiting' | 'ok' | 'thanks' | 'farewell' | 'done';

export interface BailFlow {
  place: 'prison' | 'hospital';
  stage: BailStage;
  /** confirm / ok / thanks 的那一格（槽 0..7）*/
  slot: number | null;
  /** YES/NO 上光标在哪一半 */
  yesNo: 'yes' | 'no' | null;
}

/** 这一步要宿主做的事 */
export type BailEffect =
  | { kind: 'say'; key: BailClerkKey; slot?: number }
  /** 把答复交给 core（联机 = 一条 action）：`slot` = 保谁；`null` = 不保（关屏）*/
  | { kind: 'answer'; slot: number | null }
  | { kind: 'close' }
  | null;

export type BailEvent =
  /** 字框收了（到点 / 点掉）*/
  | { kind: 'bubbleEnd' }
  /** 左键抬手：点在哪一格（没点中 = null）；`affordable` = 这一屏自己的判据（`canPayOnScreen`）*/
  | { kind: 'click'; slot: number | null; affordable: boolean }
  /** YES/NO 上左键抬手 */
  | { kind: 'yesNo'; hit: 'yes' | 'no' | null }
  /** 右键抬手（原版 `0x205`）*/
  | { kind: 'cancel' }
  /** core 那一条落地了：`bailed` = 保出来的那一格（`null` = 没保、关屏）*/
  | { kind: 'resolved'; bailed: number | null };

/** 进屏：醫院先说招呼（状态 1），監獄直接等点 */
export function bailFlowOpen(place: 'prison' | 'hospital'): { flow: BailFlow; effect: BailEffect } {
  const flow: BailFlow = { place, stage: place === 'hospital' ? 'greet' : 'idle', slot: null, yesNo: null };
  return { flow, effect: place === 'hospital' ? { kind: 'say', key: 'hospitalHello' } : null };
}

/** 有字框挂着的阶段 */
export function bailFlowHasBubble(stage: BailStage): boolean {
  return stage === 'greet' || stage === 'lowPoints' || stage === 'ok' || stage === 'thanks' || stage === 'farewell';
}

/** 走一步（纯函数）—— 每一支的出处见各分支 */
export function bailFlowStep(flow: BailFlow, ev: BailEvent): { flow: BailFlow; effect: BailEffect } {
  const to = (patch: Partial<BailFlow>, effect: BailEffect = null) => ({ flow: { ...flow, ...patch }, effect });
  const hospital = flow.place === 'hospital';
  switch (ev.kind) {
    case 'bubbleEnd':
      switch (flow.stage) {
        // 醫院状态 1 → 2（`0x0043dba7`）；付不起那句收了也回到 2（状态 5 → `0x0043dba7`）
        case 'greet':
        case 'lowPoints':
          return to({ stage: 'idle' });
        // 醫院状态 4 收尾（`0x0043dbd6`）：玩家槽当场关屏（`[0x48c4f6] = 1` → 状态 2 那一支 `PostMessage(0x205)`）；
        //   犯人槽换立绘 + 道谢（状态 6）
        case 'ok':
          return flow.slot !== null && flow.slot >= BAIL_PLAYER_SLOTS
            ? to({ stage: 'thanks' }, { kind: 'say', key: 'hospitalThanks', slot: flow.slot })
            : to({ stage: 'done' }, { kind: 'close' });
        // 犯人道谢收了（監獄 `[0x48c4c9]` → `0x0043cbd8 PostMessage(0x205)`；醫院状态 6 → 2 → 关）/ 醫院道别收了（状态 7）
        case 'thanks':
        case 'farewell':
          return to({ stage: 'done' }, { kind: 'close' });
        default:
          return to({});
      }
    case 'click':
      // 字框挂着时点一下 = 收框（監獄 `0x0043cef6` / 醫院 `0x0043e658 cmp [0x48c4f2], 2 / je` 之外那一支）
      if (bailFlowHasBubble(flow.stage)) return bailFlowStep(flow, { kind: 'bubbleEnd' });
      if (flow.stage !== 'idle' || ev.slot === null) return to({});
      // 付得起 → YES/NO（`0x0043d0e0` / `0x0043e77c call 0x453a32`）；付不起 → 那一句（監獄 `0x0043cf97` / 醫院状态 5）
      if (ev.affordable) return to({ stage: 'confirm', slot: ev.slot, yesNo: null });
      return to({ stage: 'lowPoints', slot: null }, { kind: 'say', key: hospital ? 'hospitalLowPoints' : 'lowPoints' });
    case 'yesNo':
      if (flow.stage !== 'confirm' || ev.hit === null) return to({});
      // `cmp eax, 1 / jne` —— NO 回到等点
      if (ev.hit === 'no') return to({ stage: 'idle', slot: null, yesNo: null });
      return to({ stage: 'waiting', yesNo: null }, { kind: 'answer', slot: flow.slot });
    case 'cancel':
      if (bailFlowHasBubble(flow.stage)) return bailFlowStep(flow, { kind: 'bubbleEnd' });
      // YES/NO 上右键 = NO
      if (flow.stage === 'confirm') return to({ stage: 'idle', slot: null, yesNo: null });
      if (flow.stage !== 'idle') return to({});
      // 監獄 `0x0043d266`：直接关屏；醫院 `0x0043e7c7`：先道别（状态 7），答复同样是「不保」
      return to({ stage: 'waiting' }, { kind: 'answer', slot: null });
    case 'resolved': {
      if (ev.bailed === null) {
        return hospital
          ? to({ stage: 'farewell', slot: null }, { kind: 'say', key: 'hospitalBye' })
          : to({ stage: 'done', slot: null }, { kind: 'close' });
      }
      // 醫院：先「ＯＫ！」（状态 4），收了才放人 / 道谢
      if (hospital) return to({ stage: 'ok', slot: ev.bailed }, { kind: 'say', key: 'hospitalOk' });
      // 監獄：玩家槽当场关屏（`0x0043cf55 PostMessage(0x205)`）；犯人槽立绘 + 道谢（`0x0043d1b9..0x0043d249`）
      return ev.bailed >= BAIL_PLAYER_SLOTS
        ? to({ stage: 'thanks', slot: ev.bailed }, { kind: 'say', key: 'prisonThanks', slot: ev.bailed })
        : to({ stage: 'done', slot: ev.bailed }, { kind: 'close' });
    }
  }
}
