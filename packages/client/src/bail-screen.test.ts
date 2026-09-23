/*
 * T-038：監獄 / 醫院保釋屏
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉死的是**槽位坐标与图号**——它们全部来自 exe 的表，任何一处抄错都会让脸
 * 落到窗格外面去，而底图上那八个窗格是**唯一的参照物**（看图就能发现）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  BAIL_INMATE_AT,
  BAIL_YESNO_CENTER,
  HOSPITAL_BYE_NURSE,
  bailFlowOpen,
  bailFlowStep,
  hitBailYesNo,
  BAIL_CLERK_FRAMES,
  BAIL_CLERK_MS,
  BAIL_CLERK_STYLE,
  drawBailClerk,
  BAIL_PLACES,
  BAIL_PLAYER_SLOTS,
  BAIL_SLOT_HIT,
  HOSPITAL_SLOTS,
  PRISON_SLOTS,
  bailCellImage,
  bailSlotRect,
  canPayOnScreen,
  drawBailScreen,
  hitBailSlot,
} from './bail-screen.ts';
import type { Sprite } from './assets.ts';

const runExeFlow = existsSync(`${process.env.RICH4_WORKSPACE ?? ''}/Rich4/rich4.exe`) ? it : it.skip;

describe('槽位坐标 —— 逐字节取自 exe 的表', () => {
  it('★ 監獄八个窗格：两行四列 @source 0x00475c04', () => {
    expect(PRISON_SLOTS).toEqual([
      { x: 33, y: 24 },
      { x: 185, y: 24 },
      { x: 336, y: 24 },
      { x: 487, y: 24 },
      { x: 33, y: 183 },
      { x: 185, y: 183 },
      { x: 336, y: 183 },
      { x: 487, y: 183 },
    ]);
    // 同一行 y 相同、列距**大致**相等（152/151/151 —— exe 的表本来就不是严格等距，
    // 照抄即可，别「顺手修圆」）
    expect(PRISON_SLOTS[1]!.x - PRISON_SLOTS[0]!.x).toBe(152);
    expect(PRISON_SLOTS[2]!.x - PRISON_SLOTS[1]!.x).toBe(151);
    expect(PRISON_SLOTS[3]!.x - PRISON_SLOTS[2]!.x).toBe(151);
    expect(PRISON_SLOTS[4]!.y - PRISON_SLOTS[0]!.y).toBe(183 - 24);
  });

  it('★ 醫院八张床：两列四行 @source 0x00475c64', () => {
    expect(HOSPITAL_SLOTS).toEqual([
      { x: 297, y: 1 },
      { x: 297, y: 121 },
      { x: 297, y: 241 },
      { x: 297, y: 361 },
      { x: 481, y: 1 },
      { x: 481, y: 121 },
      { x: 481, y: 241 },
      { x: 481, y: 361 },
    ]);
    // 与監獄**行/列是反的**：医院是靠右的两列、每列四张床
    for (let i = 0; i < 4; i++) expect(HOSPITAL_SLOTS[i]!.x).toBe(297);
    for (let i = 4; i < 8; i++) expect(HOSPITAL_SLOTS[i]!.x).toBe(481);
  });

  it('★ 两屏都是 8 个槽，横向都在 640 里', () => {
    for (const place of ['prison', 'hospital'] as const) {
      expect(BAIL_PLACES[place].slots).toHaveLength(8);
      for (const s of BAIL_PLACES[place].slots) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.x + BAIL_SLOT_HIT.w).toBeLessThanOrEqual(640);
      }
    }
  });

  it('医院最下面那两格**故意越出下缘** —— 原版的命中框就是这样的，不「修」', () => {
    // 槽 4..7 在 y=361，加上 138 高的框到 499 > 480
    expect(BAIL_PLACES.hospital.slots[7]!.y + BAIL_SLOT_HIT.h).toBeGreaterThan(480);
    // 監獄八个都在屏内
    for (const s of BAIL_PLACES.prison.slots) {
      expect(s.y + BAIL_SLOT_HIT.h).toBeLessThanOrEqual(480);
    }
  });

  it('★ 命中框比图大一圈：122×138（`lea +0x79` / `lea +0x89`，两端都含）', () => {
    expect(BAIL_SLOT_HIT).toEqual({ w: 0x79 + 1, h: 0x89 + 1 });
    expect(BAIL_SLOT_HIT.w).toBe(122);
    expect(BAIL_SLOT_HIT.h).toBe(138);
  });
});

describe('★ 图号 —— 玩家看角色、犯人有专图、監獄空槽画铁栅', () => {
  it('監獄：空槽画图 4；玩家 = character + 5；犯人 = 0xd + slot', () => {
    expect(bailCellImage('prison', 0, false, 0)).toBe(4);
    expect(bailCellImage('prison', 0, true, 0)).toBe(5);
    expect(bailCellImage('prison', 3, true, 11)).toBe(16);
    expect(bailCellImage('prison', 4, true, 0)).toBe(0xd + 4);
    expect(bailCellImage('prison', 7, true, 0)).toBe(0xd + 7);
  });

  it('醫院：空床**什么都不画**（床位烤在底图里）', () => {
    expect(bailCellImage('hospital', 0, false, 0)).toBeNull();
  });

  it('醫院：玩家 = character + 14；犯人 = 0x16 + slot', () => {
    expect(bailCellImage('hospital', 0, true, 0)).toBe(14);
    expect(bailCellImage('hospital', 3, true, 11)).toBe(25);
    expect(bailCellImage('hospital', 4, true, 0)).toBe(0x16 + 4);
    expect(bailCellImage('hospital', 7, true, 0)).toBe(0x16 + 7);
  });

  it('★ 玩家/犯人的分界就是 4（= OBJECT_SLOT_BASE）', () => {
    expect(BAIL_PLAYER_SLOTS).toBe(4);
    for (const place of ['prison', 'hospital'] as const) {
      const p1 = bailCellImage(place, 3, true, 0)!;
      const p2 = bailCellImage(place, 4, true, 0)!;
      // 玩家槽跟着 character 走、犯人槽跟着 slot 走 —— 用一个假 character 区分开
      expect(bailCellImage(place, 3, true, 5)).toBe(p1 + 5);
      expect(bailCellImage(place, 4, true, 5)).toBe(p2);
    }
  });

  it('監獄有铁栅盖层（图 3），医院没有', () => {
    expect(BAIL_PLACES.prison.overlayImage).toBe(3);
    expect(BAIL_PLACES.prison.emptyImage).toBe(4);
    expect(BAIL_PLACES.hospital.overlayImage).toBeNull();
    expect(BAIL_PLACES.hospital.emptyImage).toBeNull();
  });

  it('醫院多画一位医生（图 4 @ (104,110)），監獄没有', () => {
    expect(BAIL_PLACES.hospital.decor).toEqual({ image: 4, x: 104, y: 110 });
    expect(BAIL_PLACES.prison.decor).toBeUndefined();
  });
});

describe('命中 —— 空槽点不动，这是原版第一条判据', () => {
  const occ = [0, 1, 0, 0, 0, 0, 0, 1]; // 槽 1 是玩家 1、槽 7 是犯人

  it('★ 有人的槽：四个角与中心都命中自己', () => {
    for (const slot of [1, 7]) {
      const r = bailSlotRect('prison', slot)!;
      for (const [dx, dy] of [
        [0, 0],
        [r.w - 1, 0],
        [0, r.h - 1],
        [r.w - 1, r.h - 1],
        [r.w >> 1, r.h >> 1],
      ] as const) {
        expect(hitBailSlot('prison', r.x + dx, r.y + dy, occ)).toBe(slot);
      }
    }
  });

  it('★ 空的槽位点不出东西（`if (占用[slot] == 0) continue`）', () => {
    const r = bailSlotRect('prison', 0)!;
    expect(hitBailSlot('prison', r.x + 5, r.y + 5, occ)).toBeNull();
  });

  it('★ 框外一像素就不认', () => {
    const r = bailSlotRect('prison', 1)!;
    expect(hitBailSlot('prison', r.x - 1, r.y + 5, occ)).toBeNull();
    expect(hitBailSlot('prison', r.x + r.w, r.y + 5, occ)).toBeNull();
    expect(hitBailSlot('prison', r.x + 5, r.y - 1, occ)).toBeNull();
    expect(hitBailSlot('prison', r.x + 5, r.y + r.h, occ)).toBeNull();
  });

  it('医院用自己那套坐标，与監獄互不串门', () => {
    const hp = [1, 0, 0, 0, 0, 0, 0, 0];
    const r = bailSlotRect('hospital', 0)!;
    expect(hitBailSlot('hospital', r.x + 5, r.y + 5, hp)).toBe(0);
    // 同一个点落在監獄的表上不该命中医院那格
    expect(hitBailSlot('prison', r.x + 5, r.y + 5, hp)).toBeNull();
  });

  it('槽位越界返回 null（不抛）', () => {
    expect(bailSlotRect('prison', 8)).toBeNull();
    expect(bailSlotRect('prison', -1)).toBeNull();
  });
});

describe('★ 付得起 —— 这一屏的判据是「够付就行」，与电脑那条不是一回事', () => {
  it('玩家槽 30：刚好 30 就够（`jl` 才拒绝）', () => {
    expect(canPayOnScreen(29, 0)).toBe(false);
    expect(canPayOnScreen(30, 0)).toBe(true);
    expect(canPayOnScreen(0, 1)).toBe(false);
  });

  it('犯人槽 300：刚好 300 就够 —— **没有**电脑那条 700 的门槛', () => {
    expect(canPayOnScreen(299, 4)).toBe(false);
    expect(canPayOnScreen(300, 4)).toBe(true);
    // 700 是 `canAffordBail`（AI）那条路的门槛，本屏不该出现
    expect(canPayOnScreen(350, 4)).toBe(true);
  });
});

describe('drawBailScreen（假 ctx，只查落点与文字）', () => {
  function fakeCtx() {
    const images: { dx: number; dy: number }[] = [];
    const texts: string[] = [];
    const textAt: { t: string; x: number; y: number }[] = [];
    const ctx = {
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      textAlign: 'left',
      textBaseline: 'top',
      save: () => undefined,
      restore: () => undefined,
      drawImage: (_b: unknown, dx: number, dy: number) => {
        images.push({ dx, dy });
      },
      // 阴影那一遍（第二色 #101010，點券数字的字效 3）不记，只记正文
      fillText(this: { fillStyle: string }, t: string, x: number, y: number) {
        if (String(this.fillStyle) === '#101010' && t === String(Number(t))) return;
        texts.push(t);
        textAt.push({ t, x, y });
      },
      strokeText: () => undefined,
      strokeRect: () => undefined,
    };
    void texts;
    return { ctx: ctx as unknown as CanvasRenderingContext2D, images, texts, textAt };
  }

  /** 每张图都报 (10, 20) 的锚点，好把「有没有减锚点」也测出来 */
  const sprite = (): Sprite =>
    ({ bitmap: {} as ImageBitmap, width: 100, height: 100, anchorX: 10, anchorY: 20 }) as Sprite;

  it('★ 空槽也画（監獄的铁栅），且落点是 槽位 − 锚点', () => {
    const f = fakeCtx();
    drawBailScreen(f.ctx, 'prison', [], 500, null, sprite);
    // 底图 + 8 个空槽 + 點券底板
    expect(f.images).toHaveLength(10);
    expect(f.images[0]).toEqual({ dx: 0, dy: 0 });
    expect(f.images[1]).toEqual({ dx: 33 - 10, dy: 24 - 20 });
    expect(f.images[8]).toEqual({ dx: 487 - 10, dy: 183 - 20 });
  });

  it('★ 有人的槽多盖一张铁栅（監獄 = 底图 + 7 空 + 脸 + 栅 + 底板）', () => {
    const f = fakeCtx();
    drawBailScreen(f.ctx, 'prison', [{ slot: 2, character: 3, name: '甲' }], 500, null, sprite);
    expect(f.images).toHaveLength(11);
    // 槽 2 的两次落点一致（脸与栅同点，栅后画压在上面）
    const at = { dx: 336 - 10, dy: 24 - 20 };
    expect(f.images.filter((i) => i.dx === at.dx && i.dy === at.dy)).toHaveLength(2);
  });

  it('★ 医院不画空床：8 张床只画有人的', () => {
    const f = fakeCtx();
    drawBailScreen(f.ctx, 'hospital', [{ slot: 5, character: 0, name: '乙' }], 500, null, sprite);
    // 底图 + 医生 + 1 张人脸 + 點券底板
    expect(f.images).toHaveLength(4);
    expect(f.images[1]).toEqual({ dx: 104 - 10, dy: 110 - 20 }); // 医生
    expect(f.images[2]).toEqual({ dx: 481 - 10, dy: 121 - 20 }); // 槽 5
  });

  it('★ 點券画在底板上，監獄在右下、医院在左下', () => {
    const a = fakeCtx();
    drawBailScreen(a.ctx, 'prison', [], 1234, null, sprite);
    expect(a.texts).toEqual(['1234']);

    const b = fakeCtx();
    drawBailScreen(b.ctx, 'hospital', [], 99, null, sprite);
    expect(b.texts).toEqual(['99']);
    // 底板落点各自减锚点
    expect(b.images.at(-1)).toEqual({ dx: 8 - 10, dy: 432 - 20 });
    expect(a.images.at(-1)).toEqual({ dx: 542 - 10, dy: 432 - 20 });
  });

  it('点券是 0 也要写出来（不是「没有就不画」）', () => {
    const f = fakeCtx();
    drawBailScreen(f.ctx, 'prison', [], 0, null, sprite);
    expect(f.texts).toEqual(['0']);
  });

  it('★ 悬停監獄某格 → 气泡写名字与赎金 @source loc_0043cca1', () => {
    const f = fakeCtx();
    drawBailScreen(f.ctx, 'prison', [{ slot: 4, character: 0, name: '小偷' }], 500, 4, sprite);
    // 點券 + 气泡三行
    // ★ 2026-09-23 订正：第三行是 `%d點`（0x465149），不是「點數」
    expect(f.texts).toEqual(['500', '小偷', '保釋點數', '300點']);
    // 气泡图 = 图 2，落点 = 槽位 + (0x14, 0x78)，再减锚点 (10,20)
    const at = { dx: 33 + 0x14 - 10, dy: 183 + 0x78 - 20 };
    expect(f.images.some((i) => i.dx === at.dx && i.dy === at.dy)).toBe(true);
  });

  it('★ 悬停**玩家**槽写 30 點數（赎金按槽位分档）', () => {
    const f = fakeCtx();
    drawBailScreen(f.ctx, 'prison', [{ slot: 1, character: 0, name: '約翰喬' }], 500, 1, sprite);
    expect(f.texts).toEqual(['500', '約翰喬', '保釋點數', '30點']);
  });

  it('★ 2026-09-23：医院悬停气泡 = Panel#65 图 3 落 (槽.x − 0x50, 槽.y)，三行在 (+0x29, +0x1a/0x30/0x46) @source loc_0043e456', () => {
    const f = fakeCtx();
    drawBailScreen(f.ctx, 'hospital', [{ slot: 6, character: 0, name: '流氓' }], 500, 6, sprite);
    expect(f.texts).toEqual(['500', '流氓', '保釋點數', '300點']);
    const at = { x: 481 - 0x50, y: 241 };
    expect(f.images.some((i) => i.dx === at.x - 10 && i.dy === at.y - 20)).toBe(true);
    expect(f.textAt.slice(1).map((t) => [t.x, t.y])).toEqual([
      [at.x + 0x29, at.y + 0x1a],
      [at.x + 0x29, at.y + 0x30],
      [at.x + 0x29, at.y + 0x46],
    ]);
  });

  it('精灵全缺也不抛', () => {
    const f = fakeCtx();
    drawBailScreen(f.ctx, 'prison', [{ slot: 0, character: 1, name: '丙' }], 30, null, () => null);
    expect(f.texts).toEqual(['30']);
  });
});

// ============================================================
//  ★ 2026-09-23：柜台人员的字框
// ============================================================

describe('★ 柜台人员字框 @source 0x0043cfb5 / 0x0043db10（`fcn_0044ec30`）', () => {
  const EXE = `${process.env.RICH4_WORKSPACE ?? ''}/Rich4/rich4.exe`;
  const runExe = existsSync(EXE) ? it : it.skip;
  const at = (va: number, n: number): number[] => {
    const d = readFileSync(EXE);
    const off = 1024 + (va - 0x401000);
    return [...d.subarray(off, off + n)];
  };

  runExe('監獄付不起：`push 0 / 0x101010 / −6 / 0 / 0x12c / 0xe6` + `[0x48c4b4]+0x18`（Panel#63 图 1）+ 串 0x46514e', () => {
    // 0043cf97 6a 00 / 68 10 10 10 00 / 6a fa / 6a 00 / 68 2c 01 00 00 / 68 e6 00 00 00
    expect(at(0x0043cf97, 22)).toEqual([
      0x6a, 0x00, 0x68, 0x10, 0x10, 0x10, 0x00, 0x6a, 0xfa, 0x6a, 0x00, 0x68, 0x2c, 0x01, 0x00, 0x00, 0x68, 0xe6, 0x00, 0x00, 0x00, 0xa1,
    ]);
    expect(at(0x0043cfb1, 3)).toEqual([0x83, 0xc0, 0x18]); // +0x18 = 图 1
    expect(at(0x0043cfbd, 5)).toEqual([0x68, 0x4e, 0x51, 0x46, 0x00]); // push 0x46514e
    expect(BAIL_CLERK_FRAMES.lowPoints).toEqual({ place: 'prison', image: 1, x: 0xe6, y: 0x12c, dx: 0, dy: -6 });
  });

  runExe('醫院开屏：`0x44ec30([0x48c4d4]+0x24 = Panel#65 图 2, 8, 8, 0, 0, 0x101010, 0)`', () => {
    expect(at(0x0043daf8, 13)).toEqual([0x6a, 0x00, 0x68, 0x10, 0x10, 0x10, 0x00, 0x6a, 0x00, 0x6a, 0x00, 0x6a, 0x08]);
    expect(at(0x0043db05, 2)).toEqual([0x6a, 0x08]);
    expect(at(0x0043db0c, 3)).toEqual([0x83, 0xc0, 0x24]); // +0x24 = 图 2
    expect(BAIL_CLERK_FRAMES.hospitalHello).toEqual({ place: 'hospital', image: 2, x: 8, y: 8, dx: 0, dy: 0 });
  });

  it('画：框按锚点贴、字在框正中再偏 dy；20 号 #101010 粗体、无阴影', () => {
    const draws: { x: number; y: number }[] = [];
    const texts: { t: string; x: number; y: number; font: string; fill: string }[] = [];
    const ctx = {
      save: () => undefined,
      restore: () => undefined,
      drawImage: (_b: unknown, x: number, y: number) => draws.push({ x, y }),
      fillText(this: { font: string; fillStyle: string }, t: string, x: number, y: number) {
        texts.push({ t, x, y, font: this.font, fill: String(this.fillStyle) });
      },
      font: '',
      fillStyle: '',
      textAlign: 'left',
      textBaseline: 'top',
    } as unknown as CanvasRenderingContext2D;
    const sprite = (() => ({ bitmap: {} as never, width: 200, height: 100, anchorX: 10, anchorY: 20 })) as unknown as Parameters<typeof drawBailClerk>[1];
    drawBailClerk(ctx, sprite, { key: 'lowPoints', text: '抱歉！\n你的點數不足！', until: 0 });
    expect(draws).toEqual([{ x: 0xe6 - 10, y: 0x12c - 20 }]);
    const cx = 0xe6 - 10 + 100;
    const cy = 0x12c - 20 + 50 - 6;
    expect(texts.map((t) => [t.t, t.x, t.y])).toEqual([
      ['抱歉！', cx, cy - 13],
      ['你的點數不足！', cx, cy + 13],
    ]);
    for (const t of texts) {
      expect(t.font.startsWith('bold 20px')).toBe(true);
      expect(t.fill).toBe('#101010');
    }
    expect(BAIL_CLERK_STYLE.flags).toBe(2);
    expect(BAIL_CLERK_MS).toBe(2000);
  });
});

describe('★ 保釋屏整屏流程（`bailFlowStep`）@source 監獄 fcn_0043caab / 醫院 fcn_0043da27', () => {
  const run = (place: 'prison' | 'hospital', evs: Parameters<typeof bailFlowStep>[1][]) => {
    const o = bailFlowOpen(place);
    let flow = o.flow;
    const effects = [o.effect];
    for (const ev of evs) {
      const r = bailFlowStep(flow, ev);
      flow = r.flow;
      effects.push(r.effect);
    }
    return { flow, effects: effects.filter((e) => e !== null) };
  };

  it('醫院开屏先说招呼（状态 1）；招呼挂着时点一格只收框、不选人', () => {
    const r = run('hospital', [{ kind: 'click', slot: 5, affordable: true }]);
    expect(r.effects).toEqual([{ kind: 'say', key: 'hospitalHello' }]);
    expect(r.flow.stage).toBe('idle');
  });

  it('付得起 ⇒ YES/NO；NO 回去；YES 才交答复（一条 action）', () => {
    const no = run('prison', [{ kind: 'click', slot: 5, affordable: true }, { kind: 'yesNo', hit: 'no' }]);
    expect(no.flow.stage).toBe('idle');
    expect(no.effects).toEqual([]);
    const yes = run('prison', [{ kind: 'click', slot: 5, affordable: true }, { kind: 'yesNo', hit: 'yes' }]);
    expect(yes.effects).toEqual([{ kind: 'answer', slot: 5 }]);
    expect(yes.flow.stage).toBe('waiting');
    // 点在 YES/NO 图外什么都不发生
    expect(run('prison', [{ kind: 'click', slot: 5, affordable: true }, { kind: 'yesNo', hit: null }]).flow.stage).toBe('confirm');
  });

  it('付不起 ⇒ 那一句（監獄 lowPoints / 醫院 hospitalLowPoints），收了回到等点', () => {
    expect(run('prison', [{ kind: 'click', slot: 1, affordable: false }]).effects).toEqual([{ kind: 'say', key: 'lowPoints' }]);
    const h = run('hospital', [{ kind: 'bubbleEnd' }, { kind: 'click', slot: 1, affordable: false }, { kind: 'bubbleEnd' }]);
    expect(h.effects.slice(1)).toEqual([{ kind: 'say', key: 'hospitalLowPoints' }]);
    expect(h.flow.stage).toBe('idle');
  });

  it('監獄：保犯人 ⇒ 立绘 + 道谢，收了关屏；保玩家 ⇒ 当场关屏', () => {
    const inmate = run('prison', [{ kind: 'resolved', bailed: 6 }, { kind: 'bubbleEnd' }]);
    expect(inmate.effects).toEqual([{ kind: 'say', key: 'prisonThanks', slot: 6 }, { kind: 'close' }]);
    expect(run('prison', [{ kind: 'resolved', bailed: 2 }]).effects).toEqual([{ kind: 'close' }]);
  });

  it('醫院：YES ⇒「ＯＫ！」（状态 4）→ 犯人道谢（状态 6）→ 关；玩家 ⇒「ＯＫ！」→ 关', () => {
    const inmate = run('hospital', [{ kind: 'bubbleEnd' }, { kind: 'resolved', bailed: 4 }, { kind: 'bubbleEnd' }, { kind: 'bubbleEnd' }]);
    expect(inmate.effects.slice(1)).toEqual([
      { kind: 'say', key: 'hospitalOk' },
      { kind: 'say', key: 'hospitalThanks', slot: 4 },
      { kind: 'close' },
    ]);
    const player = run('hospital', [{ kind: 'bubbleEnd' }, { kind: 'resolved', bailed: 0 }, { kind: 'bubbleEnd' }]);
    expect(player.effects.slice(1)).toEqual([{ kind: 'say', key: 'hospitalOk' }, { kind: 'close' }]);
  });

  it('右键：監獄等点时 = 不保（交答复）→ 落地关屏；醫院 = 不保 → 護士道别 → 关；YES/NO 上右键 = NO', () => {
    expect(run('prison', [{ kind: 'cancel' }]).effects).toEqual([{ kind: 'answer', slot: null }]);
    expect(run('prison', [{ kind: 'cancel' }, { kind: 'resolved', bailed: null }]).effects).toEqual([
      { kind: 'answer', slot: null },
      { kind: 'close' },
    ]);
    const h = run('hospital', [{ kind: 'bubbleEnd' }, { kind: 'cancel' }, { kind: 'resolved', bailed: null }, { kind: 'bubbleEnd' }]);
    expect(h.effects.slice(1)).toEqual([{ kind: 'answer', slot: null }, { kind: 'say', key: 'hospitalBye' }, { kind: 'close' }]);
    expect(run('prison', [{ kind: 'click', slot: 5, affordable: true }, { kind: 'cancel' }]).flow.stage).toBe('idle');
  });

  it('YES/NO 居中 (320,240)、96×48，左半 YES 右半 NO', () => {
    expect(BAIL_YESNO_CENTER).toEqual({ x: 320, y: 240 });
    expect(hitBailYesNo(300, 240)).toBe('yes');
    expect(hitBailYesNo(340, 240)).toBe('no');
    expect(hitBailYesNo(320 - 49, 240)).toBeNull();
  });

  runExeFlow('exe：YES/NO 居中点 / 犯人立绘落点 / 醫院護士道别图', () => {
    const at = (va: number, n: number): number[] => {
      const d = readFileSync(`${process.env.RICH4_WORKSPACE ?? ''}/Rich4/rich4.exe`);
      const off = 1024 + (va - 0x401000);
      return [...d.subarray(off, off + n)];
    };
    expect(at(0x0043d0e0, 10)).toEqual([0x68, 0xf0, 0x00, 0x00, 0x00, 0x68, 0x40, 0x01, 0x00, 0x00]); // push 0xf0 / push 0x140
    expect(at(0x0043e77c, 10)).toEqual([0x68, 0xf0, 0x00, 0x00, 0x00, 0x68, 0x40, 0x01, 0x00, 0x00]);
    expect(at(0x0043d1cf, 10)).toEqual([0x68, 0xc2, 0x01, 0x00, 0x00, 0x68, 0x6d, 0x01, 0x00, 0x00]); // 監獄立绘 (0x16d,0x1c2)
    expect(at(0x0043dda7, 10)).toEqual([0x68, 0xc2, 0x01, 0x00, 0x00, 0x68, 0xa4, 0x01, 0x00, 0x00]); // 醫院立绘 (0x1a4,0x1c2)
    expect(at(0x0043e8bb, 4)).toEqual([0x6a, 0x70, 0x6a, 0x5b]); // 護士道别 (0x5b,0x70)
    expect(at(0x0043e8c4, 3)).toEqual([0x83, 0xc0, 0x78]); // 图 9
    expect(BAIL_INMATE_AT).toEqual({ prison: { x: 0x16d, y: 0x1c2 }, hospital: { x: 0x1a4, y: 0x1c2 } });
    expect(HOSPITAL_BYE_NURSE).toEqual({ image: 9, x: 0x5b, y: 0x70 });
  });
});
