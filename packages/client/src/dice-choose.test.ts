/*
 * 遙控骰子的点数盘（Q-PICK-2）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标/命中/范围全部照 exe（`rich4_tool_yaokongtouzi.asm` + `fcn_00446774`）：
 * 六颗骰面在**一条横向带**上（y ∈ [314,343)、x = 104+40i、30×29），
 * 盘子在 (92,300)、资源 `Panel.mkf` #72；返回值 1..6，取消（0）什么都不发。
 */
import { describe, expect, it } from 'vitest';
import {
  DICE_BAND_Y0,
  DICE_BAND_Y1,
  DICE_BUTTON_H,
  DICE_BUTTON_STEP,
  DICE_BUTTON_W,
  DICE_BUTTON_X0,
  DICE_FACE_MAX,
  DICE_FACE_MIN,
  DICE_PANEL_ORIGIN,
  DICE_PANEL_RESOURCE,
  DICE_SOUND_CANCEL,
  DICE_SOUND_PICK,
  REMOTE_DICE_TOOL_ID,
  diceButtonRect,
  diceLitFrame,
  hitDiceFace,
  remoteDiceAction,
} from './dice-choose.ts';
import { REMOTE_DICE_TOOL } from './inventory.ts';

describe('点数盘的版式 @source VA 0x004471a5 / fcn_00446774', () => {
  it('★ 盘子 = Panel.mkf #72，落在 (92,300)（= 0x5c, 0x12c）', () => {
    expect(DICE_PANEL_RESOURCE).toBe(0x48);
    expect(DICE_PANEL_ORIGIN).toEqual({ x: 0x5c, y: 0x12c });
    expect(DICE_PANEL_ORIGIN).toEqual({ x: 92, y: 300 });
  });

  it('★ 一条横向带、六颗 30×29、步长 40 @source `mov ebx,0x68 / add ebx,0x28 / cmp esi,6`', () => {
    expect(DICE_BAND_Y0).toBe(0x13a);
    expect(DICE_BAND_Y1).toBe(0x157);
    expect(DICE_BUTTON_X0).toBe(0x68);
    expect(DICE_BUTTON_STEP).toBe(0x28);
    expect(DICE_BUTTON_W).toBe(0x1e);
    expect(DICE_BUTTON_H).toBe(0x1d);
    // 六颗严丝合缝地排在带子里：104..334，盘子在 92 → 局部 12..242
    expect(diceButtonRect(1)).toEqual({ x: 104, y: 314, w: 30, h: 29 });
    expect(diceButtonRect(6)).toEqual({ x: 304, y: 314, w: 30, h: 29 });
    // 最后一颗的右边界 = 334（盘子在 92 → 局部 242，盘子宽 256）
    expect(diceButtonRect(6).x + diceButtonRect(6).w).toBe(334);
  });

  it('★ 悬停盖的是**第 i 张图**（图 1..6 = 六颗骰面的点亮版）@source `12*sel`', () => {
    for (let i = 1; i <= 6; i++) expect(diceLitFrame(i)).toBe(i);
  });

  it('★ 音效：点中 = 1（0x482322）、取消 = 4（0x482332）—— 表是 8 字节一项', () => {
    expect(DICE_SOUND_PICK).toBe(1);
    expect(DICE_SOUND_CANCEL).toBe(4);
  });
});

describe('命中 @source `fcn_00446774` 的 0x200 分支', () => {
  it('★ 每颗的矩形里都命中（左闭右开）', () => {
    for (let i = 1; i <= 6; i++) {
      const r = diceButtonRect(i);
      expect(hitDiceFace(r.x, r.y)).toBe(i);
      expect(hitDiceFace(r.x + r.w - 1, r.y + r.h - 1)).toBe(i);
    }
  });

  it('★ 右边界那一点不算（`jge` 跳过）', () => {
    for (let i = 1; i <= 6; i++) {
      const r = diceButtonRect(i);
      expect(hitDiceFace(r.x + r.w, r.y)).not.toBe(i);
    }
  });

  it('★ 带子的上下边界：y=314 命中、y=343 不命中', () => {
    expect(hitDiceFace(104, DICE_BAND_Y0)).toBe(1);
    expect(hitDiceFace(104, DICE_BAND_Y1)).toBe(0);
    expect(hitDiceFace(104, DICE_BAND_Y0 - 1)).toBe(0);
  });

  it('★ 六颗之间的缝、带子外的空白 → 0（**不是取消**，只是没悬停）', () => {
    // 缝：第一颗右边界 134 与第二颗左边界 144 之间
    expect(hitDiceFace(134, 314)).toBe(0);
    expect(hitDiceFace(140, 330)).toBe(0);
    // 盘子上方 / 左方
    expect(hitDiceFace(92, 300)).toBe(0);
    expect(hitDiceFace(50, 330)).toBe(0);
    // 最后一颗右边
    expect(hitDiceFace(400, 330)).toBe(0);
  });
});

describe('选中 → action（形状与 core 的 useTool 一致）', () => {
  it('★ 六颗骰面各发一个 useTool{8, value=面}，上下限就是 1 / 6', () => {
    expect(remoteDiceAction(DICE_FACE_MIN)).toEqual({ type: 'useTool', toolId: 8, value: 1 });
    expect(remoteDiceAction(DICE_FACE_MAX)).toEqual({ type: 'useTool', toolId: 8, value: 6 });
    expect(REMOTE_DICE_TOOL_ID).toBe(8);
    // 与卡片欄那边「这件道具要再问一次」的常量是同一个（免得两处写岔）
    expect(REMOTE_DICE_TOOL_ID).toBe(REMOTE_DICE_TOOL);
    for (let i = 1; i <= 6; i++) {
      expect(remoteDiceAction(i)).toEqual({ type: 'useTool', toolId: 8, value: i });
    }
  });

  it('★ 取消（0）→ null：**不发 action**，道具不消耗', () => {
    expect(remoteDiceAction(0)).toBeNull();
  });

  it('★ 越界 / 非整数 → null（盘子给不出这些值）', () => {
    expect(remoteDiceAction(7)).toBeNull();
    expect(remoteDiceAction(18)).toBeNull();
    expect(remoteDiceAction(-1)).toBeNull();
    expect(remoteDiceAction(1.5)).toBeNull();
  });

  it('★ 没点中任何一颗（命中 0）也走同一条路：不发 action', () => {
    expect(remoteDiceAction(hitDiceFace(140, 330))).toBeNull();
  });
});
