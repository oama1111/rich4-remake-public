/*
 * 開局跳傘過場 —— 規格與時序的資料契約
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 這一支的每一條數字都**不是自己編的**：
 *   - 資源號 / 落點 / 段序來自 `rich4.exe` 的 `fcn_00415872`（回退分支）；
 *   - 幀數 / 每幀毫秒 / 尺寸來自 `jump.mkf` 裡那 25 段影片**自己的 FLIC 頭**
 *     （`parseFlicInfo` 讀的 `+6` / `+8` / `+0xa` / `+0x10`）。
 *   所以「把 NPC 去掉」「把某一段刪掉」「只畫開門第一幀」這三種改壞都會紅。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MkfArchive, parseFlicInfo } from '@rich4/assets-pipeline';
import {
  INTRO_ARCHIVE,
  INTRO_CABIN_IMAGE,
  INTRO_DOOR_AT,
  INTRO_DOOR_FRAME_MS,
  INTRO_DOOR_FRAMES,
  INTRO_DOOR_RESOURCE,
  INTRO_FALL_FRAME_MS,
  INTRO_FALL_FRAMES,
  INTRO_FALL_RESOURCE_BASE,
  INTRO_HINT,
  INTRO_JUMP_FRAME_MS,
  INTRO_JUMP_FRAMES,
  INTRO_JUMP_RESOURCE_BASE,
  INTRO_SIZE,
  INTRO_SHEET_RESOURCE,
  INTRO_SKY_IMAGE,
  drawIntro,
  introCursorAt,
  introDone,
  introFallResource,
  introJumpResource,
  introMs,
  introSegmentMs,
  introSegments,
  type IntroFlic,
  type IntroFlicFn,
  type IntroSegment,
  type IntroSpriteFn,
} from './intro.ts';

/** 真的那份 `jump.mkf`（打包进 `assets/game/` 的那一份）*/
const JUMP_MKF = fileURLToPath(new URL('../../../assets/game/jump.mkf', import.meta.url));

let archive: MkfArchive | null = null;
function jump(): MkfArchive {
  archive ??= new MkfArchive(new Uint8Array(readFileSync(JUMP_MKF)));
  return archive;
}

/** 開局那一桌（与需求方复现用的 `?chars=0,3,5,7` 同一批）*/
const CAST = [0, 3, 5, 7] as const;

// ── 假 canvas / 假素材 ────────────────────────────────────────────────

interface Draw {
  res: number;
  image: number;
  frame: number;
  x: number;
  y: number;
}

/** 只收 `drawImage` / `fillText` / `fillRect` 的最小假 canvas，并把贴图打成可断言的行 */
function fakeCtx(): { ctx: CanvasRenderingContext2D; texts: string[]; draws: Draw[] } {
  const texts: string[] = [];
  const draws: Draw[] = [];
  const ctx = {
    canvas: { width: 640, height: 480 },
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    fillText: (t: string) => texts.push(t),
    strokeText: () => undefined,
    drawImage: (bmp: { res?: number; image?: number; frame?: number }, x: number, y: number) => {
      draws.push({ res: bmp.res ?? -1, image: bmp.image ?? -1, frame: bmp.frame ?? -1, x, y });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, draws };
}

/** 假圖集：每張图带上自己的资源号/图号，方便断言「画了哪张」 */
function fakeSprite(): { fn: IntroSpriteFn; asked: { res: number; image: number }[] } {
  const asked: { res: number; image: number }[] = [];
  const fn: IntroSpriteFn = (_archive, res, image) => {
    asked.push({ res, image });
    return { bitmap: { res, image } as unknown as CanvasImageSource, width: 0, height: 0, anchorX: 0, anchorY: 0 };
  };
  return { fn, asked };
}

/** 假影片：帧数与帧间隔由调用方给定（**故意与常量分开**，好让两者互相对照）*/
function fakeFlic(spec: Record<number, { frames: number; frameMs: number }>): {
  fn: IntroFlicFn;
  asked: number[];
} {
  const asked: number[] = [];
  const fn: IntroFlicFn = (_archive, res) => {
    asked.push(res);
    const s = spec[res];
    if (s === undefined) return null;
    const frames = Array.from(
      { length: s.frames },
      (_, i) => ({ res, frame: i }) as unknown as CanvasImageSource,
    );
    return { frames, frameMs: s.frameMs } satisfies IntroFlic;
  };
  return { fn, asked };
}

/** 把「真 FLIC 头」抄成 `fakeFlic` 要的表 */
function realFlicSpec(resources: readonly number[]): Record<number, { frames: number; frameMs: number }> {
  const spec: Record<number, { frames: number; frameMs: number }> = {};
  for (const res of resources) {
    const info = parseFlicInfo(jump().read(res));
    if (info !== null) spec[res] = { frames: info.frames, frameMs: info.frameMs };
  }
  return spec;
}

// ── ① 規格：資源號 / 尺寸 / 落點 ─────────────────────────────────────

describe('★ 片頭規格來自 exe（fcn_00415872）與 jump.mkf 的真值', () => {
  it('整屏是 640×480（原版 SetDisplayMode(0x280,0x1e0,0x10)）', () => {
    expect(INTRO_SIZE).toEqual({ w: 640, h: 480 });
  });

  it('#0x2d 是 15 張的 SMP：第 0 張 = 機艙門底圖 640×480、第 1 張 = 天空 640×480', () => {
    // @source `fcn_0041588e`（`push 0x2d`）→ 回退支 `add eax,0xc`（第 0 項）
    //   與 `add eax,0x18`（第 1 項）
    expect(INTRO_CABIN_IMAGE).toBe(0);
    expect(INTRO_SKY_IMAGE).toBe(1);
    const data = jump().read(0x2d);
    // SMP 頭：`+0` 簽名、`+4` 張數、`+0x0c + i*12` 起是每張圖的 {w,h,ax,ay,gsize}
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    expect(String.fromCharCode(data[0]!, data[1]!, data[2]!)).toBe('SMP');
    expect(view.getUint32(4, true)).toBe(15);
    const w = (i: number): number => view.getInt16(0x0c + i * 12, true);
    const h = (i: number): number => view.getInt16(0x0c + i * 12 + 2, true);
    expect(w(0)).toBe(640);
    expect(h(0)).toBe(480);
    expect(w(1)).toBe(640);
    expect(h(1)).toBe(480);
  });

  it('開門那一段 = #0x2e `OPENDOOR.FLC`：220×240、15 幀、71 ms/幀、落 (180,60)', () => {
    // @source `push 0x2e` VA 0x004158a2；落點 `push 0x3c` / `push 0xb4` VA 0x004159f6
    const info = parseFlicInfo(jump().read(INTRO_DOOR_RESOURCE));
    expect(info).not.toBeNull();
    expect(info).toMatchObject({ width: 220, height: 240, frames: 15, frameMs: 71 });
    expect(INTRO_DOOR_FRAMES).toBe(info!.frames);
    expect(INTRO_DOOR_FRAME_MS).toBe(info!.frameMs);
    expect(INTRO_DOOR_AT).toEqual({ x: 180, y: 60 });
  });

  it('資源號 = 0x2f + 角色號（J）與 0x3b + 角色號（F）', () => {
    // @source 預載 VA 0x004158f0 `add eax,0x2f`（+ sheet*12）；播 F 段 VA 0x00415c76
    expect(INTRO_JUMP_RESOURCE_BASE).toBe(0x2f);
    expect(INTRO_FALL_RESOURCE_BASE).toBe(0x3b);
    expect(introJumpResource(0)).toBe(0x2f);
    expect(introFallResource(0)).toBe(0x3b);
    // sheet 1 = 0x3b..0x46 = J 的基數 + 12
    expect(INTRO_FALL_RESOURCE_BASE).toBe(INTRO_JUMP_RESOURCE_BASE + 12);
  });

  it('★ 12 個角色的 J/F 幀數與每幀毫秒逐項等於 jump.mkf 裡那 24 段影片的頭', () => {
    const spec = realFlicSpec([
      ...Array.from({ length: 12 }, (_, c) => introJumpResource(c)),
      ...Array.from({ length: 12 }, (_, c) => introFallResource(c)),
    ]);
    const bad: string[] = [];
    for (let c = 0; c < 12; c++) {
      const j = spec[introJumpResource(c)];
      const f = spec[introFallResource(c)];
      if (j === undefined || f === undefined) throw new Error(`角色 ${c} 的影片頭讀不到`);
      if (j.frames !== INTRO_JUMP_FRAMES[c]) bad.push(`J${c + 1} 幀數 ${INTRO_JUMP_FRAMES[c]} ≠ ${j.frames}`);
      if (j.frameMs !== INTRO_JUMP_FRAME_MS) bad.push(`J${c + 1} 幀間隔 ${INTRO_JUMP_FRAME_MS} ≠ ${j.frameMs}`);
      if (f.frames !== INTRO_FALL_FRAMES[c]) bad.push(`F${c + 1} 幀數 ${INTRO_FALL_FRAMES[c]} ≠ ${f.frames}`);
      if (f.frameMs !== INTRO_FALL_FRAME_MS[c]) bad.push(`F${c + 1} 幀間隔 ${INTRO_FALL_FRAME_MS[c]} ≠ ${f.frameMs}`);
      if (j.frames <= 0 || f.frames <= 0) bad.push(`角色 ${c} 的影片是空片`);
    }
    expect(bad, `與 FLIC 頭不一致：\n${bad.join('\n')}`).toEqual([]);
  });

  it('J/F 兩段都是 640×480 的整屏影片', () => {
    for (const res of [
      introJumpResource(0),
      introJumpResource(11),
      introFallResource(0),
      introFallResource(11),
    ]) {
      expect(parseFlicInfo(jump().read(res))).toMatchObject({ width: 640, height: 480 });
    }
  });
});

// ── ② 段序 + 「出場角色數 = players.length」 ─────────────────────────

describe('★ 出場角色 = 這一局的 players.length（不是只有玩家自己）', () => {
  it('段序：機艙底圖 → 開門 → 全部 Jxx → 天空 → 全部 Fxx', () => {
    const kinds = introSegments([...CAST]).map((s) => s.kind);
    expect(kinds).toEqual(['cabin', 'door', 'jump', 'jump', 'jump', 'jump', 'sky', 'fall', 'fall', 'fall', 'fall']);
  });

  it('★ 每個玩家各一段 J 與一段 F，資源號由**該玩家的角色號**索引', () => {
    const segs = introSegments([...CAST]);
    const jumps = segs.filter((s) => s.kind === 'jump');
    const falls = segs.filter((s) => s.kind === 'fall');
    // ⚠️ 這一條就是「NPC 也要出場」的契約：改壞（只交 players[0]）當場變紅
    expect(jumps.map((s) => s.character)).toEqual([...CAST]);
    expect(falls.map((s) => s.character)).toEqual([...CAST]);
    expect(jumps.map((s) => s.resource)).toEqual(CAST.map((c) => 0x2f + c));
    expect(falls.map((s) => s.resource)).toEqual(CAST.map((c) => 0x3b + c));
    // 四個人 = 八段影片，一個都不能少
    expect(jumps).toHaveLength(CAST.length);
    expect(falls).toHaveLength(CAST.length);
  });

  it('★ 去掉一個 NPC：段數跟着掉（把 `players[0]` 那一版寫回來 → 這一條紅）', () => {
    const one = introSegments([CAST[0]!]);
    expect(one.filter((s) => s.kind === 'jump')).toHaveLength(1);
    expect(one.filter((s) => s.kind === 'fall')).toHaveLength(1);
    // 四張 J 影片 vs 一張 —— 資源集合直接可比
    const resOf = (cs: readonly number[]): number[] =>
      introSegments(cs)
        .filter((s) => s.kind === 'jump' || s.kind === 'fall')
        .map((s) => s.resource);
    expect(resOf([...CAST])).toHaveLength(8);
    expect(resOf([CAST[0]!])).toEqual([0x2f, 0x3b]);
    expect(new Set(resOf([...CAST])).size).toBe(8);
  });

  it('★ 空桌也照播（只剩底圖 + 開門那一段）', () => {
    expect(introSegments([]).map((s) => s.kind)).toEqual(['cabin', 'door', 'sky']);
  });

  it('每段都帶着自己的落點（J/F 都是 (0,0)，開門是 (180,60)）', () => {
    const segs = introSegments([...CAST]);
    for (const s of segs) {
      if (s.kind === 'door') expect(s.at).toEqual({ x: 180, y: 60 });
      else expect(s.at).toEqual({ x: 0, y: 0 });
    }
  });
});

// ── ③ 每段時長 = 幀數 × 幀間隔 ──────────────────────────────────────

describe('★ 段時長 = 幀數 × 幀間隔（Time = frames × frameMs）', () => {
  it('逐段都成立', () => {
    for (const s of introSegments([...CAST])) {
      expect(introSegmentMs(s)).toBe(s.frames * s.frameMs);
    }
  });

  it('開門 = 15 × 71 = 1065 ms（舊版只給它 1000 ms → 最後一幀被砍）', () => {
    const door = introSegments([...CAST]).find((s) => s.kind === 'door') as IntroSegment;
    expect(introSegmentMs(door)).toBe(1065);
    expect(introSegmentMs(door)).toBeGreaterThan(1000);
  });

  it('四人局整段 = 12979 ms（≈13 秒；不是 1 秒）', () => {
    // 15×71 + Σ(J 幀×28) + Σ(F 幀×各自 ms)
    //      = 1065 + (40+48+48+45)×28 + (37+42+43+41)×42 = 1065 + 5068 + 6846
    expect(introMs([...CAST])).toBe(12979);
    const sum = introSegments([...CAST]).reduce((a, s) => a + introSegmentMs(s), 0);
    expect(introMs([...CAST])).toBe(sum);
  });

  it('★ 段一刪，總長就變（刪掉「降落傘」那四段 → 這一條紅）', () => {
    const withFall = introMs([...CAST]);
    const withoutFall = introSegments([...CAST])
      .filter((s) => s.kind !== 'fall')
      .reduce((a, s) => a + introSegmentMs(s), 0);
    expect(withoutFall).toBe(withFall - (37 + 42 + 43 + 41) * 42);
    expect(withoutFall).toBeLessThan(withFall);
    expect(new Set([withFall, withoutFall]).size).toBe(2);
  });
});

// ── ④ 時鐘 ─────────────────────────────────────────────────────────

describe('★ 分段時鐘（每段各走各的）', () => {
  const segs = introSegments([...CAST]);

  it('t=0 停在「開門」第 0 幀', () => {
    expect(introCursorAt(segs, 0)).toEqual({ index: 1, localMs: 0, frame: 0 });
  });

  it('開門那 15 幀各佔 71 ms，一幀不漏', () => {
    const frames = Array.from({ length: INTRO_DOOR_FRAMES }, (_, k) =>
      introCursorAt(segs, k * INTRO_DOOR_FRAME_MS)!.frame,
    );
    expect(frames).toEqual([...Array(INTRO_DOOR_FRAMES).keys()]);
  });

  it('開門走完就接第一位角色的 J 段', () => {
    expect(introCursorAt(segs, 1065)).toMatchObject({ index: 2, frame: 0 });
  });

  it('★ 放完就結束／跳過立刻結束', () => {
    const total = introMs([...CAST]);
    expect(introDone(0, 0, false, [...CAST])).toBe(false);
    expect(introDone(0, total - 1, false, [...CAST])).toBe(false);
    expect(introDone(0, total, false, [...CAST])).toBe(true);
    expect(introDone(0, 0, true, [...CAST])).toBe(true);
  });

  it('角色越多整段越長（NPC 少一位 → 時間少了兩段）', () => {
    expect(introMs([...CAST])).toBeGreaterThan(introMs([CAST[0]!]));
    expect(introMs([CAST[0]!])).toBe(1065 + 40 * 28 + 37 * 42);
  });
});

// ── ⑤ 真畫出去的東西 ────────────────────────────────────────────────

describe('★ drawIntro 真的把每一段都畫到畫布上', () => {
  /** 用真 FLIC 頭的規格造一組假素材 */
  function stage(): {
    ctx: CanvasRenderingContext2D;
    texts: string[];
    draws: Draw[];
    sprite: ReturnType<typeof fakeSprite>;
    flic: ReturnType<typeof fakeFlic>;
  } {
    const { ctx, texts, draws } = fakeCtx();
    const sprite = fakeSprite();
    const res = new Set<number>([INTRO_DOOR_RESOURCE]);
    for (const c of CAST) res.add(introJumpResource(c));
    for (const c of CAST) res.add(INTRO_FALL_RESOURCE_BASE + c);
    const flic = fakeFlic(realFlicSpec([...res]));
    return { ctx, texts, draws, sprite, flic };
  }

  it('t=0：先畫**機艙門**那張底圖（圖 0，落 (0,0)），不是天空那一張', () => {
    const s = stage();
    drawIntro(s.ctx, 0, { sprite: s.sprite.fn, flic: s.flic.fn, characters: [...CAST] });
    const cabin = s.draws.filter((d) => d.res === 0x2d);
    expect(cabin.length).toBeGreaterThan(0);
    expect(cabin[0]).toMatchObject({ image: INTRO_CABIN_IMAGE, x: 0, y: 0 });
    expect(cabin.some((d) => d.image === INTRO_SKY_IMAGE)).toBe(false);
  });

  it('★ 開門那 15 幀一幀不漏地畫出去（改壞成「只畫第一幀」→ 這一條紅）', () => {
    const s = stage();
    const seen = new Set<number>();
    for (let k = 0; k < INTRO_DOOR_FRAMES; k++) {
      drawIntro(s.ctx, k * INTRO_DOOR_FRAME_MS, {
        sprite: s.sprite.fn,
        flic: s.flic.fn,
        characters: [...CAST],
      });
      for (const d of s.draws) if (d.res === INTRO_DOOR_RESOURCE) seen.add(d.frame);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([...Array(INTRO_DOOR_FRAMES).keys()]);
    // 最後一幀（門全開）必須出現，而且畫在 (180,60)
    const last = s.draws.filter((d) => d.res === INTRO_DOOR_RESOURCE && d.frame === 14);
    expect(last.length).toBeGreaterThan(0);
    expect(last[0]).toMatchObject({ x: 180, y: 60 });
  });

  it('★ 四位角色的 J 與 F 段都被播到（只給 players[0] → 這一條紅）', () => {
    const s = stage();
    const total = introMs([...CAST]);
    // 沿時間軸密集取樣（每 40 ms 一幀）
    for (let t = 0; t <= total + 200; t += 40) {
      drawIntro(s.ctx, t, { sprite: s.sprite.fn, flic: s.flic.fn, characters: [...CAST] });
    }
    const played = new Set(s.flic.asked);
    for (const c of CAST) {
      expect(played.has(introJumpResource(c)), `角色 ${c} 的 J 段沒被播`).toBe(true);
      expect(played.has(INTRO_FALL_RESOURCE_BASE + c), `角色 ${c} 的 F 段沒被播`).toBe(true);
    }
    expect(played.has(INTRO_DOOR_RESOURCE)).toBe(true);
    // 而且每一段都真的貼了圖（不是只「問了一下」）
    const drawn = new Set(s.draws.map((d) => d.res));
    for (const c of CAST) {
      expect(drawn.has(introJumpResource(c))).toBe(true);
      expect(drawn.has(INTRO_FALL_RESOURCE_BASE + c)).toBe(true);
    }
  });

  it('★ 天空那張底圖只在跳傘段之前換上去，換完才播降落傘', () => {
    const s = stage();
    const total = introMs([...CAST]);
    const jumpMs = (40 + 48 + 48 + 45) * 28;
    const skyDue = INTRO_DOOR_FRAMES * INTRO_DOOR_FRAME_MS + jumpMs; // 1065 + 5068
    let skyAt = -1;
    let firstFallAt = -1;
    for (let t = 0; t <= total; t += 20) {
      s.draws.length = 0;
      drawIntro(s.ctx, t, { sprite: s.sprite.fn, flic: s.flic.fn, characters: [...CAST] });
      if (skyAt < 0 && s.draws.some((d) => d.res === INTRO_SHEET_RESOURCE && d.image === INTRO_SKY_IMAGE)) {
        skyAt = t;
      }
      if (firstFallAt < 0 && s.draws.some((d) => d.res === introFallResource(CAST[0]!))) firstFallAt = t;
    }
    // 取樣每 20 ms 一格，故落在 [skyDue, skyDue+20) 內
    expect(skyAt).toBeGreaterThanOrEqual(skyDue);
    expect(skyAt).toBeLessThan(skyDue + 20);
    expect(firstFallAt).toBe(skyAt);
  });

  it('★ 畫出去的文字裡沒有內部編號', () => {
    const s = stage();
    drawIntro(s.ctx, 0, { sprite: s.sprite.fn, flic: s.flic.fn, characters: [...CAST] });
    expect(s.texts.length).toBeGreaterThan(0);
    for (const t of s.texts) expect(t, `畫出去的字「${t}」帶著內部編號`).not.toMatch(/[QT]-\d/);
    expect(INTRO_HINT).toContain('按任意鍵');
  });

  it('素材全都拿不到時也不炸，只留一行跳過提示', () => {
    const s = stage();
    drawIntro(s.ctx, 0, {}); // 連 sprite/flic 都沒有
    drawIntro(s.ctx, 99999, {});
    expect(s.texts.every((t) => t === INTRO_HINT)).toBe(true);
  });

  it('三個入口用的都是同一份檔案（jump.mkf）', () => {
    expect(INTRO_ARCHIVE).toBe('jump.mkf');
  });
});

// ── ⑥ 宿主接線（源碼結構斷言）─────────────────────────────────────

/**
 * ★ 為什麼用源碼斷言：真正的根因在 `main.ts` 那一行 ——
 *   先前交的是 `character: state.players[0]?.character`，
 *   `intro.ts` 再怎麼正確也只會畫出**玩家自己**那一個角色。
 *   這裡把「交全桌角色」這件事釘在源碼上（與 `bgm-wiring.test.ts` 同一手法）。
 */
describe('★ 宿主接線：交出去的是**全桌**角色，不是 `players[0]`', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('★ 交出去的是 `state.players.map(...)`（NPC 也在裡面）', () => {
    // 审计 #15 起抽成函数（收场判据挪到帧首，两处共用同一份）
    expect(main).toContain('function introCast(): number[] {\n  return state.players.map((p) => p.character);\n}');
    expect(main).toContain('characters: introCast(),');
  });

  it('★ 舊版那一行（只給 `players[0]`）已經不在了 —— 寫回去就紅', () => {
    expect(main).not.toContain('character: state.players[0]?.character');
  });

  it('★ 時長判據吃的是同一份角色表（不是 `Airplane.avi` 的 15 幀）', () => {
    expect(main).toContain('introDone(introStartedAt, performance.now(), introSkipped, introCast())');
    // 舊版的 1 秒時鐘常數已不再被宿主引用
    expect(main).not.toContain('INTRO_FRAMES');
  });
});
