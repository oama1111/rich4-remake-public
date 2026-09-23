/*
 * 框/对话框**模板**的总账 —— 原版每一处贴 `Data.mkf #0x205`（`[0x48bad8]`）的地方，
 * 贴的是哪一张图，本引擎对应的那一屏用的又是哪一张。
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 由来（2026-09-23 需求方）：「神明那个对话框不是这个模板 你去原版里看一下 我记得用的是棕色那个
 *   最好能反查一下还有哪些错的」。
 *
 * `[0x48bad8] = read_mkf(Data.mkf, 0x205)`（@source 0x0040808f）。精灵集的图记录从 `+0x0c` 起、
 * 每张 12 字节 ⇒ `基址 + 0x0c + 12×N` = 图 N。反查全段 `a1 d8 ba 48 00`（`mov eax,[0x48bad8]`）
 * 紧跟 `83 c0 XX`（`add eax, imm8`）的**固定图号**贴图点，共 16 处：
 *
 * | 贴图点 | `+XX` | 图 | 是什么（宿主）| 本引擎 |
 * |---|---|---|---|---|
 * | 0x00440c14 | 0x48 | 5 | 通用**询问框** `0x440ba8`（买地/升级/认股/嫁禍/免費卡）| `dialog.ts` `DIALOG_SKIN_IMAGE` |
 * | 0x00440d62 | 0x48 | 5 | 通用**訊息框** `0x440cac`（104 个调用点）| `notice-box-screen.ts` → `drawDialog` |
 * | 0x004407a1 | 0x48 | 5 | **神明老虎机** `0x440706`（小財神/大財神/小窮神/大窮神附身）| `god-slot.ts` `GOD_SLOT_BUBBLE` |
 * | 0x0043f618 | 0x48 | 5 | 同上，状态 8 重画（把台詞盖成「%d元」）| 同上 |
 * | 0x004409b6 | 0x48 | 5 | **转盘** `0x44090e`（航空/旅館/購物中心/保險）| `wheel-screen.ts` `WHEEL_BUBBLE` |
 * | 0x00440f63 | 0x48 | 5 | 嫁禍选人窗 `0x440e1a` | `scapegoat-picker.ts` `SCAPEGOAT_SKIN` |
 * | 0x00442014 | 0x48 | 5 | **亮牌** `0x441f73`（抽卡 / 用卡）| `event-box-screen.ts`（`DIALOG_SKIN_IMAGE`）|
 * | 0x0043fce0 / 0x0043fe25 / 0x00440b37 | 0x48 | 5 | 設施类别选择 `0x440aac`（立绘板）| `facility-picker.ts` `PICKER_BOARD` |
 * | 0x0043fc48 / 0x0043fe03 / 0x00440b15 | 0x3c | 4 | 同上（五格面板）| `facility-picker.ts` `PICKER_PANEL` |
 * | 0x0044042c / 0x00440564 / 0x00441152 | 0x48 | 5 | 研究所 `0x44101d`（立绘板）| `research-screen.ts` `RESEARCH_TITLE_CHUNK` |
 * | 0x0044f023 | **0x54** | **6** | **`player_say`** 台词气泡（红边云朵）—— 全 exe **唯一**一处 | `speech-bubble.ts` `SPEECH_PANEL` |
 *
 * ⇒ 图 5（249×170 的**棕色金边框**）是原版一切「框」的模板；图 6（271×199 的红边白底云朵）
 *   **只有**角色台词用。先前神明老虎机与转盘都把 `+0x48` 读成了图 6（漏减 `0x0c` 表头）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MkfArchive, decodeImage, parseSpriteSheet } from '@rich4/assets-pipeline';
import { DIALOG_SKIN_IMAGE, DIALOG_SKIN_RESOURCE } from './gameui.ts';
import { GOD_SLOT_BUBBLE } from './god-slot.ts';
import { WHEEL_BUBBLE } from './wheel-screen.ts';
import { SCAPEGOAT_SKIN } from './scapegoat-picker.ts';
import { PICKER_BOARD, PICKER_PANEL, PICKER_RESOURCE } from './facility-picker.ts';
import { RESEARCH_RESOURCE, RESEARCH_TITLE_CHUNK } from './research-screen.ts';
import { SPEECH_PANEL } from './speech-bubble.ts';

const ROOT = process.env.RICH4_WORKSPACE ?? '';
const EXE = `${ROOT}/Rich4/rich4.exe`;
const DATA_MKF = `${ROOT}/Rich4/Data.mkf`;
const runExe = existsSync(EXE) ? it : it.skip;
const runData = existsSync(DATA_MKF) ? it : it.skip;

/** 代码段 AUTO：VA 0x401000 ↔ 文件偏移 1024，长 394240（见 `tools/disasm.py`）*/
const CODE_VA = 0x401000;
const CODE_OFF = 1024;
const CODE_SIZE = 394240;

/** 图号 = (偏移 − 0x0c) / 12 */
const imageOf = (disp: number): number => (disp - 0x0c) / 12;

/**
 * 全段扫 `a1 d8 ba 48 00 83 c0 XX` ⇒ { 贴图点 VA → 图号 }。
 * （`+0x0c` 那几处后面还要 `add eax, 下标`，是**按表取图**的名牌 / 大号数字，不在「框」之列，剔掉。）
 */
function fixedSkinSites(): Map<number, number> {
  const d = readFileSync(EXE);
  const code = d.subarray(CODE_OFF, CODE_OFF + CODE_SIZE);
  const out = new Map<number, number>();
  for (let i = 0; i + 8 <= code.length; i++) {
    if (
      code[i] === 0xa1 &&
      code[i + 1] === 0xd8 &&
      code[i + 2] === 0xba &&
      code[i + 3] === 0x48 &&
      code[i + 4] === 0x00 &&
      code[i + 5] === 0x83 &&
      code[i + 6] === 0xc0
    ) {
      const disp = code[i + 7]!;
      if (disp === 0x0c) continue;
      out.set(CODE_VA + i, imageOf(disp));
    }
  }
  return out;
}

function exeBytes(va: number, n: number): number[] {
  const d = readFileSync(EXE);
  const off = CODE_OFF + (va - CODE_VA);
  return [...d.subarray(off, off + n)];
}

/** 原版每一处固定图号的贴图点 → 图号（上表）*/
const EXPECTED: ReadonlyMap<number, number> = new Map([
  [0x0043f618, 5], // 神明老虎机 状态 8
  [0x0043fc48, 4], // 設施选择 面板
  [0x0043fce0, 5], // 設施选择 立绘板
  [0x0043fe03, 4],
  [0x0043fe25, 5],
  [0x0044042c, 5], // 研究所
  [0x00440564, 5],
  [0x004407a1, 5], // 神明老虎机 开窗
  [0x004409b6, 5], // 转盘
  [0x00440b15, 4], // 設施选择 开窗
  [0x00440b37, 5],
  [0x00440c14, 5], // 询问框
  [0x00440f63, 5], // 嫁禍选人
  [0x00441152, 5], // 研究所 开窗
  [0x00442014, 5], // 亮牌
  [0x0044f023, 6], // player_say
]);

describe('★ 框模板总账 @source 全段 `mov eax,[0x48bad8] / add eax,imm8`', () => {
  runExe('全 exe 固定图号的贴图点恰好是这 16 处（多一处少一处都要回来补表）', () => {
    expect(fixedSkinSites()).toEqual(EXPECTED);
  });

  runExe('★ 图 6（红边云朵）全 exe 只有 player_say（0x0044f023）一处用', () => {
    const six = [...fixedSkinSites()].filter(([, img]) => img === 6).map(([va]) => va);
    expect(six).toEqual([0x0044f023]);
  });

  runExe('訊息框 `0x440cac` 贴的也是图 5：锚点取 `[+0x4c]/[+0x4e]`、贴图 `add eax,0x48`', () => {
    // 00440d67 movsx edx, word [eax+0x4e]（图 5 的锚点 y = 0x0c + 5×12 + 6）
    expect(exeBytes(0x00440d67, 4)).toEqual([0x0f, 0xbf, 0x50, 0x4e]);
    // 00440d70 movsx edx, word [eax+0x4c]（锚点 x）
    expect(exeBytes(0x00440d70, 4)).toEqual([0x0f, 0xbf, 0x50, 0x4c]);
    // 00440d79 add eax, 0x48
    expect(exeBytes(0x00440d79, 3)).toEqual([0x83, 0xc0, 0x48]);
    expect(imageOf(0x48)).toBe(DIALOG_SKIN_IMAGE);
  });

  runExe('★★ 神明老虎机（`0x440706`）两处都是 `add eax,0x48` ⇒ 图 5，本引擎 `GOD_SLOT_BUBBLE` 同图', () => {
    expect(exeBytes(0x004407a6, 3)).toEqual([0x83, 0xc0, 0x48]);
    expect(exeBytes(0x0043f61d, 3)).toEqual([0x83, 0xc0, 0x48]);
    expect(GOD_SLOT_BUBBLE.resource).toBe(DIALOG_SKIN_RESOURCE);
    expect(GOD_SLOT_BUBBLE.image).toBe(EXPECTED.get(0x004407a1));
    expect(GOD_SLOT_BUBBLE.image).toBe(EXPECTED.get(0x0043f618));
  });

  it('情形 → 模板：本引擎每一屏取的图号与原版那一处贴图点一致', () => {
    const ours: [string, number, number][] = [
      ['询问框 0x440ba8', DIALOG_SKIN_IMAGE, EXPECTED.get(0x00440c14)!],
      ['訊息框 0x440cac', DIALOG_SKIN_IMAGE, imageOf(0x48)],
      ['神明老虎机 0x440706', GOD_SLOT_BUBBLE.image, EXPECTED.get(0x004407a1)!],
      ['转盘 0x44090e', WHEEL_BUBBLE.image, EXPECTED.get(0x004409b6)!],
      ['嫁禍选人 0x440e1a', SCAPEGOAT_SKIN.chunk, EXPECTED.get(0x00440f63)!],
      ['亮牌 0x441f73', DIALOG_SKIN_IMAGE, EXPECTED.get(0x00442014)!],
      ['設施选择 立绘板', PICKER_BOARD.chunk, EXPECTED.get(0x00440b37)!],
      ['設施选择 面板', PICKER_PANEL.chunk, EXPECTED.get(0x00440b15)!],
      ['研究所 立绘板', RESEARCH_TITLE_CHUNK, EXPECTED.get(0x00441152)!],
      ['player_say 气泡', SPEECH_PANEL.image, EXPECTED.get(0x0044f023)!],
    ];
    for (const [what, mine, orig] of ours) expect({ what, image: mine }).toEqual({ what, image: orig });
    // 全部同一份资源 Data.mkf #0x205
    for (const r of [
      DIALOG_SKIN_RESOURCE,
      GOD_SLOT_BUBBLE.resource,
      WHEEL_BUBBLE.resource,
      SCAPEGOAT_SKIN.resource,
      PICKER_RESOURCE,
      RESEARCH_RESOURCE,
      SPEECH_PANEL.resource,
    ])
      expect(r).toBe(0x205);
    expect(GOD_SLOT_BUBBLE.archive).toBe('Data.mkf');
    expect(WHEEL_BUBBLE.archive).toBe('Data.mkf');
  });
});

describe('★ 素材：图 5 = 棕色金边框、图 6 = 红边白底云朵 @source Data.mkf #0x205', () => {
  runData('图 5：249×170、锚点 (123,101)，内场是一整片棕 (115,49,8)；图 6：271×199、锚点 (127,92)，内场白/米', () => {
    const raw = new MkfArchive(new Uint8Array(readFileSync(DATA_MKF))).read(0x205, 'none');
    const sheet = parseSpriteSheet(raw)!;
    const five = decodeImage(sheet, raw, 5, { colorKeyBlack: true });
    const six = decodeImage(sheet, raw, 6, { colorKeyBlack: true });
    expect([five.width, five.height, five.anchorX, five.anchorY]).toEqual([249, 170, 123, 101]);
    expect([six.width, six.height, six.anchorX, six.anchorY]).toEqual([271, 199, 127, 92]);
    const px = (im: typeof five, x: number, y: number): number[] => [
      ...im.rgba.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 4),
    ];
    // 图 5 内场 (30..199, 50..149) 每一个像素都是同一个棕
    for (let y = 50; y < 150; y += 7)
      for (let x = 30; x < 200; x += 11) expect(px(five, x, y)).toEqual([115, 49, 8, 255]);
    // 图 6 锚点那一点是米白（R=255）—— 与棕框一眼可分
    expect(px(six, six.anchorX, six.anchorY)[0]).toBe(255);
    expect(px(six, six.anchorX, six.anchorY)[1]).toBeGreaterThan(200);
  });
});

describe('★ 框模板的字效（`create_font` 第 4 / 5 参）照每一处调用点', () => {
  it('询问框 / 訊息框 / 老虎机 / 转盘 / 嫁禍 / 設施 / 研究所 / 亮牌 = 3,1（粗体 + 阴影）；台词气泡 = 2,1（粗体、深色、无阴影）', async () => {
    const { BOX_TEXT_STYLE } = await import('./font.ts');
    const { GOD_SLOT_TEXT_STYLE } = await import('./god-slot.ts');
    const { SPEECH_TEXT_STYLE } = await import('./speech-bubble.ts');
    const { eventBoxPlan, EVENT_TEXT_FLAGS, EVENT_TEXT_SPACING, CARD_TEXT_SPACING } = await import('./event-box-screen.ts');
    expect(BOX_TEXT_STYLE).toMatchObject({ flags: 3, spacing: 1, color: '#f0f0f0', color2: '#101010' });
    expect(GOD_SLOT_TEXT_STYLE).toEqual(BOX_TEXT_STYLE);
    // @source 0x0044efc7 push 2 / 0x0044efc9 push 0 / 0x0044efcb push 0x101010：正文色是 #101010
    expect(SPEECH_TEXT_STYLE).toMatchObject({ size: 0x10, color: '#101010', flags: 2, spacing: 1 });
    expect([EVENT_TEXT_FLAGS, EVENT_TEXT_SPACING, CARD_TEXT_SPACING]).toEqual([3, 0, 1]);
    const card = eventBoxPlan({ kind: 'card', id: 1, cardName: '均富卡' } as Parameters<typeof eventBoxPlan>[0]);
    const text = card.items.find((i) => i.kind === 'text');
    expect(text).toMatchObject({ flags: 3, spacing: 1 });
  });

  runExe('台词气泡 `0x0044efd2` 前五个 push = `6a 01 6a 02 6a 00 68 10 10 10 00 6a 10`；新聞/命運第 5 参是 0', () => {
    expect(exeBytes(0x0044efd2 - 13, 13)).toEqual([0x6a, 0x01, 0x6a, 0x02, 0x6a, 0x00, 0x68, 0x10, 0x10, 0x10, 0x00, 0x6a, 0x10]);
    for (const call of [0x0044b747, 0x0044dbed]) {
      // push 0 / push 3 / push 0x101010 / push 0xf0f0f0 / push 0x1c
      expect(exeBytes(call - 16, 16)).toEqual([0x6a, 0x00, 0x6a, 0x03, 0x68, 0x10, 0x10, 0x10, 0x00, 0x68, 0xf0, 0xf0, 0xf0, 0x00, 0x6a, 0x1c]);
    }
  });
});
