/*
 * 嫁禍卡的选人窗（真人、候选两位以上）—— 第十四份（D-008 收口）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source `fcn_0044476a` 真人支：候选不止一位 ⇒ `0x00444893 push 0x46535d`（「請選擇嫁禍對象...」）
 *   → `0x004448a1 call 0x440e1a(候选数, 候选表, 那一句)`。
 *
 * `fcn_00440e1a`（全 exe 仅此一个调用点）：
 * ```asm
 * 00440e29  read_mkf(Data, 0x206)                        ; 头像框：第 (候选数 − 2) 张
 * 00440e42  read_mkf(Data, 2)                            ; 角色头像（按角色号取第 N 张）
 * 00440e5c  [0x48c4fc] = 0xdc − 框.x锚 + 0xc             ; 第一格的左上 x
 * 00440e85  [0x48c4f8] = 0x140 − 框.y锚 + 0xc            ; 第一格的左上 y
 * 00440ea5  for i: 0x456280(框, 头像[角色], 0xc + 0x50×i, 0xc)   ; 头像贴进框里，格距 80
 * 00440f38  0x451e7e(&{0,0x28,0x1b8,0x1e0})              ; 只存棋盘那一栏（浮窗）
 * 00440f73  0x456418(对话框皮 Data 0x205 图 5, 0xdc, 0x8c)
 * 00440f8d  0x44fabc(那一句, 0xdc, 0x8c, 4)              ; 居中
 * 00440fb1  0x4563f5(框, 0xdc, 0x140)
 * 00440fcb  模态消息循环 0x43ff56；返回值 = 格号（−1 = 取消）→ 候选表[格号]
 * ```
 * 消息处理 `fcn_0043ff56`：
 *   - `0x200` 移动：命中 x∈[ox, ox+80×n)、y∈[oy, oy+0x48) ⇒ 格号 = (x−ox)/80；换格时
 *     放音效（`0x0044008f push 0x48231a` = 0 号）、重贴框、画三圈黄框（`0x0045620f`：
 *     (ox+80i−3, oy−3) 边长 0x4e / +1 边长 0x4c / +2 边长 0x4a，色 0xffff00）；
 *     出了命中区就把框重贴一遍（去掉黄框）；
 *   - `0x202` 左键抬起：有格才收（音效 `0x482322`）→ 返回格号；
 *   - `0x205` 右键抬起：音效 `0x482332` → 返回 −1。
 */

import type { Sprite } from './assets.ts';
import { BOX_TEXT_STYLE, drawGdiText } from './font.ts';
import { PASSIVE_CARD_TEXT } from '@rich4/data';
import { ARROW_CURSOR, showCursor, type CursorWant } from './soft-cursor.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';

export const SCAPEGOAT_PICKER_ARCHIVE = 'Data.mkf' as const;
/** 头像框 @source 0x00440e29 push 0x206 */
export const SCAPEGOAT_FRAME_RESOURCE = 0x206;
/** 角色头像 @source 0x00440e46 push 2 */
export const SCAPEGOAT_PORTRAIT_RESOURCE = 2;
/** 对话框皮（与通用询问框同一份）@source 0x00440f63 mov eax,[0x48bad8] / add eax,0x48（图 5） */
export const SCAPEGOAT_SKIN = { resource: 0x205, chunk: 5, x: 0xdc, y: 0x8c } as const;
/** 头像框的贴点 @source 0x00440f95 push 0x140 / push 0xdc */
export const SCAPEGOAT_FRAME_AT = { x: 0xdc, y: 0x140 } as const;
/** 第一格相对框左上的偏移 @source 0x00440e7c `lea edx,[ebx+0xc]` / 0x00440e90 `lea eax,[edx+0xc]` */
export const SCAPEGOAT_CELL_INSET = 0xc;
/** 格距 @source 0x00440efa add esi, 0x50 */
export const SCAPEGOAT_CELL_STRIDE = 0x50;
/** 命中区高 @source 0x0044005f lea eax,[edx+0x48] */
export const SCAPEGOAT_CELL_HEIGHT = 0x48;
/** 三圈黄框 @source 0x00440114..0x00440160 */
export const SCAPEGOAT_HOVER_FRAMES: readonly { d: number; size: number }[] = [
  { d: -3, size: 0x4e },
  { d: -2, size: 0x4c },
  { d: -1, size: 0x4a },
];
export const SCAPEGOAT_HOVER_COLOR = '#ffff00';
/** 音效号（`0x48231a` 表）：换格 0 / 选定 1 / 取消 4 —— 与設施类别窗、遙控骰子同一张表 */
export const SCAPEGOAT_SOUND_HOVER = 0;
export const SCAPEGOAT_SOUND_PICK = 1;
export const SCAPEGOAT_SOUND_CANCEL = 4;

/** 头像框用第几张（候选 2 位 → 0，3 位 → 1）@source 0x00440e5c `lea edx,[ebp−2]` */
export function scapegoatFrameChunk(count: number): number {
  return count - 2;
}

/** 第一格左上（屏幕坐标）—— 由框的锚点定 */
export function scapegoatOrigin(frame: Pick<Sprite, 'anchorX' | 'anchorY'>): { x: number; y: number } {
  return {
    x: SCAPEGOAT_FRAME_AT.x - frame.anchorX + SCAPEGOAT_CELL_INSET,
    y: SCAPEGOAT_FRAME_AT.y - frame.anchorY + SCAPEGOAT_CELL_INSET,
  };
}

/** 命中哪一格（`null` = 没有）@source 0x0043fff8..0x0044007a */
export function scapegoatCellAt(
  x: number,
  y: number,
  origin: { x: number; y: number },
  count: number,
): number | null {
  if (x < origin.x || x >= origin.x + SCAPEGOAT_CELL_STRIDE * count) return null;
  if (y < origin.y || y >= origin.y + SCAPEGOAT_CELL_HEIGHT) return null;
  return Math.trunc((x - origin.x) / SCAPEGOAT_CELL_STRIDE);
}

type PickerSprite = (archive: 'Data.mkf', resource: number, index: number, keyed?: boolean) => Sprite | null;

/** 这一刻要不要开窗、谁能答 —— 由宿主给（联机只让当前座位答；电脑 / 託管不开） */
let gate: (() => boolean) | null = null;
export function setScapegoatPickerGate(f: (() => boolean) | null): void {
  gate = f;
}

let hover: number | null = null;

export function resetScapegoatPicker(): void {
  hover = null;
}

function pendingOf(env: UiScreenEnv): { candidates: readonly number[] } | null {
  const p = env.state.pending;
  if (p === null || p.kind !== 'scapegoat' || p.candidates.length < 2) return null;
  return p;
}

function frameOf(env: UiScreenEnv, count: number): Sprite | null {
  return (env.sprite as unknown as PickerSprite)(
    SCAPEGOAT_PICKER_ARCHIVE,
    SCAPEGOAT_FRAME_RESOURCE,
    scapegoatFrameChunk(count),
  );
}

function answer(env: UiScreenEnv, target: number): void {
  hover = null;
  env.dispatch({ type: 'answerScapegoat', target });
  env.requestRender();
}

export const scapegoatPickerScreen: UiScreen = {
  id: 'scapegoat-picker',
  /**
   * 软件指针：窗口过程 `fcn_0043ff56` 的 `WM_CREATE` 挪指针（0x0043ffc2）后放出箭头
   * @source 0x0043ffcb `fcn_00402460(1)`；点中 / 右键（0x00440239 / 0x00440266）收起。只有本机真人开这扇窗。
   */
  cursor: (): CursorWant => showCursor(ARROW_CURSOR),
  /** 浮窗：原版只存 (0,0x28)-(0x1b8,0x1e0) 那一块（0x00440f38）*/
  windowed: true,

  active: (env: UiScreenEnv) => pendingOf(env) !== null && gate?.() !== false,

  draw(env: UiScreenEnv): void {
    const p = pendingOf(env);
    if (p === null) return;
    const ctx = env.stage;
    const sprite = env.sprite as unknown as PickerSprite;
    const skin = sprite(SCAPEGOAT_PICKER_ARCHIVE, SCAPEGOAT_SKIN.resource, SCAPEGOAT_SKIN.chunk, true);
    if (skin !== null) ctx.drawImage(skin.bitmap, SCAPEGOAT_SKIN.x - skin.anchorX, SCAPEGOAT_SKIN.y - skin.anchorY);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // `create_font(0x10, 0xf0f0f0, 0x101010, 3, 1)` @source 0x00440f10 —— 粗体 + 右下 1 px 阴影（`font.ts`）
    drawGdiText(ctx, PASSIVE_CARD_TEXT.scapegoatPick.text, SCAPEGOAT_SKIN.x, SCAPEGOAT_SKIN.y, BOX_TEXT_STYLE);

    const n = p.candidates.length;
    const frame = frameOf(env, n);
    if (frame === null) return;
    ctx.drawImage(frame.bitmap, SCAPEGOAT_FRAME_AT.x - frame.anchorX, SCAPEGOAT_FRAME_AT.y - frame.anchorY);
    const o = scapegoatOrigin(frame);
    p.candidates.forEach((who, i) => {
      const character = env.state.players[who]?.character ?? 0;
      const face = sprite(SCAPEGOAT_PICKER_ARCHIVE, SCAPEGOAT_PORTRAIT_RESOURCE, character);
      // 头像是**贴进框里**的（0x456280 按像素坐标合成），不看头像自己的锚点
      if (face !== null) ctx.drawImage(face.bitmap, o.x + SCAPEGOAT_CELL_STRIDE * i, o.y);
    });
    if (hover !== null) {
      ctx.strokeStyle = SCAPEGOAT_HOVER_COLOR;
      ctx.lineWidth = 1;
      const x0 = o.x + SCAPEGOAT_CELL_STRIDE * hover;
      for (const f of SCAPEGOAT_HOVER_FRAMES) {
        ctx.strokeRect(x0 + f.d + 0.5, o.y + f.d + 0.5, f.size - 1, f.size - 1);
      }
    }
  },

  move(x: number, y: number, env: UiScreenEnv): void {
    const p = pendingOf(env);
    const frame = p === null ? null : frameOf(env, p.candidates.length);
    if (p === null || frame === null) return;
    const next = scapegoatCellAt(x, y, scapegoatOrigin(frame), p.candidates.length);
    if (next === hover) return;
    hover = next;
    if (next !== null) env.playEffect(SCAPEGOAT_SOUND_HOVER);
    env.requestRender();
  },

  up(_x: number, _y: number, env: UiScreenEnv): void {
    const p = pendingOf(env);
    if (p === null || hover === null) return;
    const target = p.candidates[hover];
    if (target === undefined) return;
    env.playEffect(SCAPEGOAT_SOUND_PICK);
    answer(env, target);
  },

  /** 右键抬起 = −1（不嫁禍、卡留着）@source 0x00440255 */
  contextmenu(_x: number, _y: number, env: UiScreenEnv): void {
    if (pendingOf(env) === null) return;
    env.playEffect(SCAPEGOAT_SOUND_CANCEL);
    answer(env, -1);
  },
};
