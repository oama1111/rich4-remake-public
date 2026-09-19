/*
 * 原版替玩家挪**系统鼠标指针**的两个时机与落点（试玩3 #2）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 取证（VA + 指令）见 `cursor-warp.ts` 的模块头。这里钉四件事：
 *   ① 两处落点的算术 —— 照 exe 的立即数与既有带 `@source` 的常量；
 *   ② 落点确实落在对应的那块按钮里（可证伪：挪错了这条就红）；
 *   ③ **边沿触发** —— 上一拍没有、这一拍才有才挪；一直成立不许反复挪；
 *   ④ 舞台坐标 → 页面逻辑坐标，是 `stage.toStage()` 的**逆**（来回一致）。
 */
import { describe, expect, it } from 'vitest';
import {
  createCursorWarper,
  cursorWarp,
  GO_WARP_OFFSET,
  goWarpTarget,
  measureCanvas,
  FIXED_WARP_TARGET,
  NO_MOMENTS,
  stageToClient,
  YESNO_TOP_LEFT,
  YESNO_WARP_OFFSET,
  yesNoWarpTarget,
  type CursorWarpFrame,
  type ScreenPoint,
  type WarpMoments,
} from './cursor-warp.ts';
import { YESNO_CENTER_SCREEN, YESNO_SIZE, yesNoHalves } from './gameui.ts';
import { boardToScreen, createGoButton, GO_DEFAULT } from './go-button.ts';
import { stageMetrics, toStage } from './stage.ts';
import { warpCursor } from './host.ts';

/** GO 鈕左上角的**屏幕**坐标 —— 原版 `[0x475284]/[0x475288]` 的初值 (180,120) */
const GO_SCREEN: ScreenPoint = boardToScreen(createGoButton().position());

describe('落点算术 —— 照 exe 的立即数', () => {
  it('★ GO 鈕：偏移就是 `add eax,0x2e` / `add eax,0x22`（VA 0x00418dac / 0x00418da3）', () => {
    expect(GO_WARP_OFFSET).toEqual({ x: 0x2e, y: 0x22 });
    // GO 鈕初值（屏幕）180/120 ⇒ 落点 (226,154)
    expect(GO_DEFAULT).toEqual({ x: 180, y: 120 });
    expect(GO_SCREEN).toEqual({ x: 180, y: 120 }); // 画布坐标 (180,80) + 原点 (0,40)
    expect(goWarpTarget(GO_SCREEN)).toEqual({ x: 180 + 0x2e, y: 120 + 0x22 });
    expect(goWarpTarget(GO_SCREEN)).toEqual({ x: 226, y: 154 });
  });

  it('★ GO 鈕：跟着**当前位置**走（原版读的是那两个全局，钮是可拖的）', () => {
    expect(goWarpTarget({ x: 300, y: 200 })).toEqual({ x: 300 + 0x2e, y: 200 + 0x22 });
  });

  it('★ GO 鈕：落点落在 72×67 那块钮里（不是钮外）', () => {
    const t = goWarpTarget(GO_SCREEN);
    expect(t.x).toBeGreaterThanOrEqual(GO_SCREEN.x);
    expect(t.x).toBeLessThan(GO_SCREEN.x + 72);
    expect(t.y).toBeGreaterThanOrEqual(GO_SCREEN.y);
    expect(t.y).toBeLessThan(GO_SCREEN.y + 67);
  });

  it('★ YES/NO：左上 = 中心 − 尺寸/2，偏移两条都是 `add eax,0x16`（VA 0x00453710 / 0x00453715）', () => {
    expect(YESNO_WARP_OFFSET).toEqual({ x: 0x16, y: 0x16 });
    expect(YESNO_TOP_LEFT).toEqual({
      x: YESNO_CENTER_SCREEN.x - YESNO_SIZE.w / 2,
      y: YESNO_CENTER_SCREEN.y - YESNO_SIZE.h / 2,
    });
    expect(YESNO_TOP_LEFT).toEqual({ x: 172, y: 296 });
    expect(yesNoWarpTarget()).toEqual({ x: 172 + 0x16, y: 296 + 0x16 });
    expect(yesNoWarpTarget()).toEqual({ x: 194, y: 318 });
  });

  it('★ YES/NO：落点落在 **YES 那一半**里（原版那半块是 172..220 × 296..344）', () => {
    const t = yesNoWarpTarget();
    const yes = yesNoHalves().yes;
    expect(t.x).toBeGreaterThanOrEqual(yes.x);
    expect(t.x).toBeLessThan(yes.x + yes.w);
    expect(t.y).toBeGreaterThanOrEqual(yes.y);
    expect(t.y).toBeLessThan(yes.y + yes.h);
  });
});

describe('哪一拍挪 —— 边沿触发（原版：相位 1 一次 / WM_CREATE 一次）', () => {
  const on: WarpMoments = { ...NO_MOMENTS, awaitingRoll: true };
  const box: WarpMoments = { ...NO_MOMENTS, yesNoBox: true };

  it('★ 关 → 开：挪', () => {
    expect(cursorWarp(on, NO_MOMENTS, GO_SCREEN)).toEqual({ x: 226, y: 154, reason: 'go' });
    expect(cursorWarp(box, NO_MOMENTS, GO_SCREEN)).toEqual({ x: 194, y: 318, reason: 'yesNo' });
  });

  it('★ 一直开着：**不许**反复挪（否则每帧都把玩家的手拽回去）', () => {
    expect(cursorWarp(on, on, GO_SCREEN)).toBeNull();
    expect(cursorWarp(box, box, GO_SCREEN)).toBeNull();
  });

  it('★ 开 → 关：不挪', () => {
    expect(cursorWarp(NO_MOMENTS, on, GO_SCREEN)).toBeNull();
    expect(cursorWarp(NO_MOMENTS, box, GO_SCREEN)).toBeNull();
  });

  it('★ 下一个回合再进相位 1：再挪一次', () => {
    expect(cursorWarp(on, NO_MOMENTS, GO_SCREEN)).not.toBeNull();
  });

  it('同一拍两件都成立时按**框**算（框盖在棋盘上，指针该进框）', () => {
    const both: WarpMoments = { ...NO_MOMENTS, awaitingRoll: true, yesNoBox: true };
    expect(cursorWarp(both, NO_MOMENTS, GO_SCREEN)?.reason).toBe('yesNo');
  });
});

describe('舞台 → 页面逻辑坐标', () => {
  const metrics = stageMetrics(1280, 960); // 2 倍整数放大、居中
  const box = { left: 0, top: 0, dprX: 2, dprY: 2 };

  it('★ 是 `stage.toStage()` 的逆（同一个 scale/offset 来回一致）', () => {
    const p = { x: 194, y: 318 };
    const client = stageToClient(p, metrics, box);
    // `toStage` 收的是**设备像素**
    const back = toStage(client.x * box.dprX, client.y * box.dprY, metrics);
    expect(back).not.toBeNull();
    expect(back?.x).toBeCloseTo(p.x, 6);
    expect(back?.y).toBeCloseTo(p.y, 6);
  });

  it('画布不在页面左上角时（调试抽屉）跟着平移', () => {
    const at = stageToClient({ x: 0, y: 0 }, { scale: 1, offsetX: 0, offsetY: 0 }, { ...box, left: 12, top: 34, dprX: 1, dprY: 1 });
    expect(at).toEqual({ x: 12, y: 34 });
  });

  it('measureCanvas：像素比 = 画布设备像素 / CSS px，量不到就退回 1', () => {
    const rect = { left: 7, top: 9 };
    expect(measureCanvas({ width: 1280, height: 960, clientWidth: 640, clientHeight: 480, getBoundingClientRect: () => rect }))
      .toEqual({ left: 7, top: 9, dprX: 2, dprY: 2 });
    expect(measureCanvas({ width: 0, height: 0, clientWidth: 0, clientHeight: 0, getBoundingClientRect: () => rect }))
      .toEqual({ left: 7, top: 9, dprX: 1, dprY: 1 });
  });
});

describe('createCursorWarper —— 每帧一条，真的挪才调端口', () => {
  function harness(frames: CursorWarpFrame[]) {
    const calls: { x: number; y: number }[] = [];
    let i = 0;
    const w = createCursorWarper((x, y) => calls.push({ x, y }), () => frames[Math.min(i++, frames.length - 1)]!);
    return { calls, update: () => w.update() };
  }

  const frame = (over: Partial<CursorWarpFrame>): CursorWarpFrame => ({
    awaitingRoll: false,
    yesNoBox: false,
    facilityPicker: false,
    research: false,
    dicePick: false,
    goScreen: GO_SCREEN,
    metrics: { scale: 2, offsetX: 0, offsetY: 0 },
    canvas: { left: 0, top: 0, dprX: 1, dprY: 1 },
    ...over,
  });

  it('★ 开局等掷骰那一拍挪一次，之后每帧都不再挪', () => {
    const h = harness([
      frame({ awaitingRoll: false }),
      frame({ awaitingRoll: true }),
      frame({ awaitingRoll: true }),
      frame({ awaitingRoll: true }),
    ]);
    expect(h.update()).toBeNull(); // 还没轮到我
    expect(h.update()?.reason).toBe('go');
    expect(h.update()).toBeNull();
    expect(h.update()).toBeNull();
    // 端口收到的是**页面逻辑坐标**（这里 scale = 2）⇒ (226×2, 154×2)
    expect(h.calls).toEqual([{ x: 452, y: 308 }]);
  });

  it('★ 買地那个框弹出的那一拍挪一次（落点进 YES 那半块）', () => {
    const h = harness([frame({ yesNoBox: true }), frame({ yesNoBox: true }), frame({ yesNoBox: false })]);
    expect(h.update()?.reason).toBe('yesNo');
    expect(h.update()).toBeNull();
    expect(h.update()).toBeNull();
    expect(h.calls).toEqual([{ x: 194 * 2, y: 318 * 2 }]);
  });

  it('★ 换了 GO 鈕位置（拖过）之后的那个回合，落点跟着走', () => {
    const moved = boardToScreen({ x: 60, y: 30 }); // 屏幕 (60,70)
    const h = harness([frame({ awaitingRoll: true, goScreen: moved })]);
    h.update();
    expect(h.calls).toEqual([{ x: (60 + 0x2e) * 2, y: (70 + 0x22) * 2 }]);
  });
});

describe('浏览器下是空操作', () => {
  const tauriGlobal = globalThis as unknown as { __TAURI__?: unknown };

  it('★ 没有 `__TAURI__` ⇒ 不 invoke、不抛（网页挪不动系统指针）', () => {
    delete tauriGlobal.__TAURI__;
    expect(() => warpCursor(226, 154)).not.toThrow();
  });

  it('★ 桌面壳 ⇒ invoke `warp_cursor`，参数就是逻辑坐标', () => {
    const seen: { cmd: string; args: unknown }[] = [];
    tauriGlobal.__TAURI__ = {
      core: {
        invoke: (cmd: string, args?: unknown) => {
          seen.push({ cmd, args });
          return Promise.resolve(null);
        },
      },
    };
    try {
      warpCursor(226, 154);
      expect(seen).toEqual([{ cmd: 'warp_cursor', args: { x: 226, y: 154 } }]);
    } finally {
      delete tauriGlobal.__TAURI__;
    }
  });
});

describe('★ 四处固定落点 (220,320) —— 各自 WM_CREATE 那一次（E-8 的收口）', () => {
  // @source 0x0043fb54 / 0x0043ffc2（請選擇設施類別）、0x00440355（研究所選項目）、
  //   0x004467de（遥控骰子小盘）：四处都是 `push 0x140 / push 0xdc / call SetCursorPos`。
  for (const reason of ['facilityPicker', 'research', 'dicePick'] as const) {
    it(`★ ${reason}：关 → 开挪到 (220,320)，开着不再挪`, () => {
      const open: WarpMoments = { ...NO_MOMENTS, [reason]: true };
      expect(cursorWarp(open, NO_MOMENTS, GO_SCREEN)).toEqual({
        x: FIXED_WARP_TARGET.x,
        y: FIXED_WARP_TARGET.y,
        reason,
      });
      expect(FIXED_WARP_TARGET).toEqual({ x: 220, y: 320 });
      expect(cursorWarp(open, open, GO_SCREEN)).toBeNull();
      expect(cursorWarp(NO_MOMENTS, open, GO_SCREEN)).toBeNull();
    });
  }

  it('★ 两处同时成立时按**登记表次序**取前一个（浮窗互斥，真冲突也不乱挪）', () => {
    const both: WarpMoments = { ...NO_MOMENTS, facilityPicker: true, research: true };
    expect(cursorWarp(both, NO_MOMENTS, GO_SCREEN)?.reason).toBe('facilityPicker');
  });
});
