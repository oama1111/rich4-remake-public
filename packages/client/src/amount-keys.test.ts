/*
 * 通用填数窗（`fcn_00453544`）的**键盘** —— 逐项去 exe 取证 + 一次按键的纯函数
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方 2026-09-16 第 1 条的残留项（`docs/deviations/Q-UI-8.md` 的「四、5」）：
 * > 原版的通用填数窗 `fcn_00453544` **有自己的键盘表**（`loc_00452e4b`：
 * > `0-9 / 退格 / C / M / H / Enter`），而本项目的 `AmountPage` 只收鼠标。
 *
 * 这里钉三件事：
 * ① **VK → 钮序号** 直接从 exe 那段分派（`loc_00452e4b`）解释出来，
 *    再与 `amount-keys.ts` 的 `AMOUNT_KEY_ID_VK` 逐项对账；
 * ② **钮序号 → 语义** 由表 `0x47e714`（数字盘的字）与跳表 `0x452bca`（五支动作）定；
 * ③ 一次按键 → 新值的四条规则（9 位封顶 / 前导 0 / 夹上限 / 退格），
 *    以及「键盘与鼠标共用抬手那一拍」这件事本身。
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AMOUNT_BAR_PRESS,
  AMOUNT_BAR_PRESS_STEP,
  AMOUNT_BAR_STEPS,
  AMOUNT_BAR_THRESHOLDS,
  AMOUNT_BAR_THRESHOLD_COUNT,
  amountBarStepAt,
  amountFromBarX,
  AMOUNT_DIGIT_MAX,
  AMOUNT_KEY_BY_ID,
  AMOUNT_KEY_ID_VK,
  AMOUNT_KEY_RECTS,
  AMOUNT_SLOT_BY_ID,
  AMOUNT_WINDOW,
  amountSlotOfId,
  amountWindowHit,
  amountKeyOfVk,
  AMOUNT_KEY_SOUND,
  amountKeySound,
  amountKeyStep,
  appendDigitKey,
  backspaceKey,
  type AmountKey,
} from './amount-keys.ts';
import { ATM_DIGIT_MAX, atmApplyCode } from './bank-dynamic.ts';

// ── 去 exe 取证那一段（素材不在就整块跳过，与 `amount-unity.test.ts` 同一手法）──
const EXE = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/rich4.exe';
/** 代码段与数据段：这个 PE 的节表 VirtualSize 全是 0，故用 SizeOfRawData（同 disasm.py）*/
const CODE_VA = 0x401000;
const CODE_OFF = 1024;
const DATA_VA = 0x463000;
const DATA_OFF = 398848;
const buf = existsSync(EXE) ? readFileSync(EXE) : Buffer.alloc(0);
const EXE_OK = existsSync(EXE);

/** 代码段 VA → 文件偏移 */
const coff = (va: number): number => va - CODE_VA + CODE_OFF;
/** 数据段 VA → 文件偏移 */
const doff = (va: number): number => va - DATA_VA + DATA_OFF;
/** 一个字节（素材不在时给 0，整块测试会被 skip）*/
const byteAt = (o: number): number => buf[o] ?? 0;

/**
 * 把 `loc_00452e4b` 那棵分派**直接解释一遍**（不靠手抄）：
 * 给一个 VK，返回原版要写进 `[0x48cac2]` 的钮序号；`null` = 这扇窗不认这个键。
 *
 * 这段代码只用到四条指令：
 * - `83 f8 imm8` = `cmp eax, imm8`
 * - `7x rel8` / `0f 8x rel32` = 条件跳转（只出现 `jb`=2 / `jbe`=6 / `je`=4）
 * - `e9 rel32` = `jmp`
 * - `c6 05 c2 ca 48 00 imm8` = `mov byte [0x48cac2], imm8` ← **叶子**
 * 落到 `loc_00452fa2` 就是「不认这个键」（那里发现序号还是 0，直接返回）。
 */
function exeKeyId(vk: number): number | null {
  let pc = 0x452e53; // 跳过开头的「先清序号」（`xor dl,dl` + `mov [0x48cac2],dl`）
  let cf = false;
  let zf = false;
  const take = (op: number): boolean => {
    if (op === 0x2) return cf; // jb
    if (op === 0x6) return cf || zf; // jbe
    if (op === 0x4) return zf; // je
    throw new Error(`原版分派里出现了没解出的条件跳转 op=0x${op.toString(16)}`);
  };
  for (let step = 0; step < 64; step++) {
    const o = coff(pc);
    if (buf[o] === 0xc6 && buf[o + 1] === 0x05 && buf.readUInt32LE(o + 2) === 0x48cac2) {
      const id = byteAt(o + 6);
      return id === 0 ? null : id;
    }
    if (buf[o] === 0x83 && buf[o + 1] === 0xf8) {
      const imm = byteAt(o + 2);
      cf = vk < imm;
      zf = vk === imm;
      pc += 3;
      continue;
    }
    if (byteAt(o) >= 0x70 && byteAt(o) <= 0x7f) {
      const op = byteAt(o) & 0x0f;
      const rel = buf.readInt8(o + 1);
      pc = take(op) ? pc + 2 + rel : pc + 2;
      continue;
    }
    if (buf[o] === 0x0f && byteAt(o + 1) >= 0x80 && byteAt(o + 1) <= 0x8f) {
      const op = byteAt(o + 1) & 0x0f;
      const rel = buf.readInt32LE(o + 2);
      pc = take(op) ? pc + 6 + rel : pc + 6;
      continue;
    }
    if (buf[o] === 0xe9) {
      pc = pc + 5 + buf.readInt32LE(o + 1);
      continue;
    }
    if (buf[o] === 0xeb) {
      pc = pc + 2 + buf.readInt8(o + 1);
      continue;
    }
    if (pc >= 0x452fa2 && pc < 0x452fce) return null; // 「不认这个键」那一支
    throw new Error(`没解出的指令 @0x${pc.toString(16)}: ${buf.subarray(o, o + 8).toString('hex')}`);
  }
  throw new Error('原版那棵分派里绕圈了');
}

/** 跳表 `0x452bca` 的第 i 项（序号 = i + 2）*/
const jumpTarget = (i: number): number => buf.readUInt32LE(coff(0x452bca) + i * 4);
/** 代码段某处的 `0f 8x rel32` 跳转目标 */
const nearBranch = (va: number): number => va + 6 + buf.readInt32LE(coff(va) + 2);

// ============================================================
//  一、去 exe 逐项取证
// ============================================================

describe.skipIf(!EXE_OK)('★ exe 取证：`loc_00452e4b` 那张键表', () => {
  it('VK → 钮序号：exe 那段分派解释出来的结果与 `AMOUNT_KEY_ID_VK` 逐项相同', () => {
    const VKS = [
      0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x08, 0x0d, 0x43, 0x48, 0x4d,
    ];
    // 一个不多、一个不少
    expect([...AMOUNT_KEY_ID_VK.keys()].sort((a, b) => a - b)).toEqual([...VKS].sort((a, b) => a - b));
    for (const vk of VKS) {
      expect([`0x${vk.toString(16)}`, exeKeyId(vk)]).toEqual([
        `0x${vk.toString(16)}`,
        AMOUNT_KEY_ID_VK.get(vk),
      ]);
    }
    // 原版那棵树里**没有**的键：ESC / 小键盘 / 字母 / 空格 / 换行 / 小数点
    for (const vk of [0x1b, 0x60, 0x61, 0x41, 0x20, 0x0a, 0x2e, 0x10]) {
      expect([`0x${vk.toString(16)}`, exeKeyId(vk)]).toEqual([`0x${vk.toString(16)}`, null]);
    }
  });

  it('钮序号 → 语义：数字看表 `0x47e714`，其余看跳表 `0x452bca`', () => {
    // 跳表只有 14 项（序号 2..0xf）：M / Enter / C / 接数字 / 退格 / 接数字 ×9
    expect(Array.from({ length: 14 }, (_, i) => jumpTarget(i))).toEqual([
      0x4530e9, 0x453116, 0x453145, 0x453189, 0x453156,
      0x453189, 0x453189, 0x453189, 0x453189, 0x453189,
      0x453189, 0x453189, 0x453189, 0x453189,
    ]);
    // JS 那张「序号 → 语义」表：跳表里的序号 + 0x10（H = 金额栏）
    expect([...AMOUNT_KEY_BY_ID.keys()].sort((a, b) => a - b)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf, 0x10,
    ]);
    const ACTION_VA: Readonly<Record<string, number>> = {
      max: 0x4530e9, // itoa(10, buf, 上限)
      ok: 0x453116, // Post_0402_Message(atoi(buf))
      clear: 0x453145, // buf = "0"
      backspace: 0x453156,
    };
    for (const [id, key] of AMOUNT_KEY_BY_ID) {
      if (key.kind === 'digit') {
        // 数字盘的字在表 `0x47e714` 上（'0' = 0x30）
        expect([id, byteAt(doff(0x47e714) + id) - 0x30]).toEqual([id, key.digit]);
      } else if (id < 0x10) {
        expect([key.kind, jumpTarget(id - 2)]).toEqual([key.kind, ACTION_VA[key.kind]]);
      }
    }
    // 序号 0x10（H）**不进跳表**：`loc_00452fce` 用 `cmp bl,0x10 / jae loc_0045310a` 挡住它
    //（它的值在那条合成的 `0x200` 里就算好了，见下面那条）。
    expect(buf.subarray(coff(0x452fe5), coff(0x452fe5) + 3)).toEqual(Buffer.from([0x80, 0xfb, 0x10]));
    expect(byteAt(coff(0x452fe8))).toBe(0x0f);
    expect(byteAt(coff(0x452fe9)) & 0x0f).toBe(0x3); // jae
    expect(nearBranch(0x452fe8)).toBe(0x45310a);
    expect(AMOUNT_KEY_BY_ID.get(0x10)).toEqual({ kind: 'bar' });
  });

  it('★ 窗口开的时候那串数字是 `"0"`，不是上限 @source `loc_00452c91`', () => {
    // `mov byte [0x48caac], 0x30` + `mov byte [0x48caad], ah`
    expect(buf.subarray(coff(0x452c99), coff(0x452c99) + 7)).toEqual(
      Buffer.from([0xc6, 0x05, 0xac, 0xca, 0x48, 0x00, 0x30]),
    );
  });

  it('★ 位数上限 9 @source `loc_00453189` 的 `cmp eax, 9`', () => {
    expect(AMOUNT_DIGIT_MAX).toBe(9);
    expect(buf.subarray(coff(0x45319a), coff(0x45319a) + 3)).toEqual(Buffer.from([0x83, 0xf8, 0x09]));
    // 满 9 位就跳走（`jge loc_0045310a`：什么也不做）
    expect(nearBranch(0x45319d)).toBe(0x45310a);
  });

  it('★ H：按下点在 `(0x40, 0x2f)`，金额栏 33 格，`0x40` 落在第 17 格', () => {
    expect(buf.subarray(coff(0x452f81), coff(0x452f81) + 3)).toEqual(
      Buffer.from([0x83, 0xc3, AMOUNT_BAR_PRESS.x]),
    );
    expect(buf.subarray(coff(0x452f8b), coff(0x452f8b) + 3)).toEqual(
      Buffer.from([0x83, 0xc2, AMOUNT_BAR_PRESS.y]),
    );
    // `[0x46621c]` = 0x42040000 = 33.0f
    expect(buf.readFloatLE(doff(0x46621c))).toBe(AMOUNT_BAR_STEPS);
    expect(AMOUNT_BAR_STEPS).toBe(33);
    // 表 `0x47e725` 里第一个 ≥ (0x40 − 0xa) 的项
    const table = Array.from({ length: 34 }, (_, i) => byteAt(doff(0x47e725) + i));
    expect(table.findIndex((v) => AMOUNT_BAR_PRESS.x - 0xa <= v)).toBe(AMOUNT_BAR_PRESS_STEP);
    expect(AMOUNT_BAR_PRESS_STEP).toBe(17);
  });

  it('★★ 拖动金额栏：表 `0x47e725` 34 项逐字节 = 源码里那份常量', () => {
    const table = Array.from({ length: AMOUNT_BAR_THRESHOLD_COUNT }, (_, i) =>
      byteAt(doff(0x47e725) + i),
    );
    expect(AMOUNT_BAR_THRESHOLD_COUNT).toBe(34);
    expect([...AMOUNT_BAR_THRESHOLDS]).toEqual(table);
    // 单调不减（每一格的 x 阈值都比上一格大）—— 错了就会算出反的值
    for (let i = 1; i < table.length; i++) expect(table[i]!).toBeGreaterThan(table[i - 1]!);
  });

  it('★★ 窗内 x → 格号 → 值（`loc_00453394`..`loc_0045349d` 那条式子）', () => {
    // x ≤ 0xa → 值 0（`sub ebx,0xa` 之后 `jg` 不成立那一支）
    expect(amountBarStepAt(0)).toBe(0);
    expect(amountBarStepAt(0xa)).toBe(0);
    expect(amountFromBarX(0xa, 99_999)).toBe(0);
    // x = 0x40（`H` 的按下点）→ 第 17 格 ⇒ trunc(上限 × 17/33)
    expect(amountBarStepAt(AMOUNT_BAR_PRESS.x)).toBe(AMOUNT_BAR_PRESS_STEP);
    expect(amountFromBarX(0x40, 100)).toBe(51); // 1700 ÷ 33 = 51.5…
    expect(amountFromBarX(0x40, 33)).toBe(17);
    // 表的最大项 107 + 0xa = 117 ⇒ x = 117 是最后一格（33）
    expect(amountBarStepAt(0x75)).toBe(33);
    expect(amountFromBarX(0x75, 99)).toBe(99); // 99×33/33 = 99
    // x = 118 起表里找不到 ≥ 的项 ⇒ 原版**什么都不做**（值保持不变，不是 0）
    expect(amountBarStepAt(0x76)).toBeNull();
    expect(amountFromBarX(0x80, 99_999)).toBeNull();
    // 窗外（`cmp ebx,0x80 / jg` 与 `jl 0`）
    expect(amountFromBarX(-1, 100)).toBeNull();
    expect(amountFromBarX(0x81, 100)).toBeNull();
    // 上限为 0 / 负数 → 0（`max(0, trunc)`）
    expect(amountFromBarX(0x40, -5)).toBe(0);
  });

  it('★ `H` 与拖动**同一条式子**（exe 里 `loc_00452f73` 伪造的按下最终也落 `loc_00453470`）', () => {
    for (const max of [0, 1, 33, 100, 12_345, 999_999_999]) {
      expect(amountKeyStep(0, max, { kind: 'bar' }).value).toBe(
        amountFromBarX(AMOUNT_BAR_PRESS.x, max),
      );
    }
  });

  it('★ 键盘与鼠标同一拍：键 → 序号 → 合成 `WM_LBUTTONUP (0x202)`，而 0x202 与鼠标同一支', () => {
    // `loc_00452f1d`：`push 0` / `push 0` / `push 0x202`
    expect(buf.subarray(coff(0x452f1d), coff(0x452f1d) + 10)).toEqual(
      Buffer.from([0x6a, 0x00, 0x6a, 0x00, 0x68, 0x02, 0x02, 0x00, 0x00, 0xe9]),
    );
    // 窗口过程收到 0x202 时：`cmp ebx,0x203 / jb loc_00452fce`（= 鼠标抬手那一支）
    expect(buf.subarray(coff(0x452c33), coff(0x452c33) + 6)).toEqual(
      Buffer.from([0x81, 0xfb, 0x03, 0x02, 0x00, 0x00]),
    );
    expect(byteAt(coff(0x452c39))).toBe(0x0f);
    expect(byteAt(coff(0x452c3a))).toBe(0x82); // jb
    expect(nearBranch(0x452c39)).toBe(0x452fce);
    // 0x201（鼠标按下）走的是另一支 `loc_00452d0e`（去查那张像素命中图）
    expect(byteAt(coff(0x452c2d))).toBe(0x0f);
    expect(byteAt(coff(0x452c2e))).toBe(0x86); // jbe
    expect(nearBranch(0x452c2d)).toBe(0x452d0e);
  });
});

// ============================================================
//  二、一次按键 → 新值 / 新状态
// ============================================================

/** 一串数字字符 → 那几次按键 */
const keys = (s: string): AmountKey[] =>
  [...s].map((ch) => ({ kind: 'digit' as const, digit: Number(ch) }));

/** 依次按下一串键，返回最后那个值 */
const press = (ks: readonly AmountKey[], value: number, max: number): number =>
  ks.reduce((v, k) => amountKeyStep(v, max, k).value, value);

describe('VK → 键（0-9 / 退格 / C / M / H / Enter）', () => {
  it('十个数字、退格、C、M、H、Enter 各认一个 VK', () => {
    const digitOf = (vk: number): number => {
      const k = amountKeyOfVk(vk);
      if (k === null || k.kind !== 'digit') throw new Error(`VK 0x${vk.toString(16)} 不是数字`);
      return k.digit;
    };
    for (let d = 0; d <= 9; d++) expect([d, digitOf(0x30 + d)]).toEqual([d, d]);
    expect(amountKeyOfVk(0x08)).toEqual({ kind: 'backspace' });
    expect(amountKeyOfVk(0x43)).toEqual({ kind: 'clear' });
    expect(amountKeyOfVk(0x4d)).toEqual({ kind: 'max' });
    expect(amountKeyOfVk(0x48)).toEqual({ kind: 'bar' });
    expect(amountKeyOfVk(0x0d)).toEqual({ kind: 'ok' });
    // 这扇窗**不认**的键：ESC 靠全局钩子补成 0x205 才关窗；小键盘不在原版表里
    for (const vk of [0x1b, 0x60, 0x69, 0x41, 0x20]) expect(amountKeyOfVk(vk)).toBeNull();
  });
});

describe('数字：入位 / 前导 0 / 位数上限 / 夹上限', () => {
  it('一位一位接上去（0-9 各按一次都在值上）', () => {
    for (let d = 0; d <= 9; d++) expect(press(keys(String(d)), 0, 99_999)).toBe(d);
    expect(press(keys('1234'), 0, 99_999)).toBe(1234);
    expect(press(keys('900'), 0, 99_999)).toBe(900);
  });

  it('★ 前导 0 不入位：开头是 0 又按 0 不动，按别的数字把那个 0 顶掉', () => {
    expect(press(keys('0'), 0, 999)).toBe(0);
    expect(press(keys('00'), 0, 999)).toBe(0);
    expect(press(keys('000'), 0, 999)).toBe(0);
    expect(press(keys('007'), 0, 999)).toBe(7);
    // 中间与末尾的 0 是照收的
    expect(press(keys('1002'), 0, 99_999)).toBe(1002);
    expect(press(keys('10'), 0, 99_999)).toBe(10);
  });

  it('★ 满 9 位不再接 @source `loc_00453189` 的 `cmp eax, 9 / jge`', () => {
    const big = 9_999_999_999;
    expect(press(keys('123456789'), 0, big)).toBe(123_456_789);
    expect(press([...keys('123456789'), { kind: 'digit', digit: 9 }], 0, big)).toBe(123_456_789);
    // M 填出来的 10 位数同样接不动（原版 `strlen ≥ 9` 就返回）
    expect(press([{ kind: 'max' }, { kind: 'digit', digit: 9 }], 0, 1_500_000_000)).toBe(1_500_000_000);
  });

  it('★ 超过上限就夹到上限 @source `loc_004531f6` 的 `cmp eax, edx / jle`', () => {
    expect(press(keys('12'), 0, 100_000)).toBe(12);
    expect(press(keys('123456'), 0, 100_000)).toBe(100_000);
    // 夹过一次之后再加位，还是上限
    expect(press([...keys('123456'), { kind: 'digit', digit: 7 }], 0, 100_000)).toBe(100_000);
    // 上限是 0：怎么按都是 0
    expect(press(keys('5'), 0, 0)).toBe(0);
  });
});

describe('退格 / C / M / H / Enter', () => {
  it('退格：删一位；只剩一位时非 0 退回 0、是 0 不动 @source `loc_00453156`', () => {
    expect(press([...keys('1234'), { kind: 'backspace' }], 0, 99_999)).toBe(123);
    expect(amountKeyStep(1, 99_999, { kind: 'backspace' })).toEqual({ value: 0, submit: false });
    expect(amountKeyStep(0, 99_999, { kind: 'backspace' })).toEqual({ value: 0, submit: false });
    // 连按到底就是 0
    expect(
      press(
        [...keys('12'), { kind: 'backspace' }, { kind: 'backspace' }, { kind: 'backspace' }],
        0,
        99_999,
      ),
    ).toBe(0);
  });

  it('C = 清零（**不是取消**）@source `loc_00453145`', () => {
    expect(amountKeyStep(12345, 99_999, { kind: 'clear' })).toEqual({ value: 0, submit: false });
    // 清零之后还能接着打，窗子没有关
    expect(press([{ kind: 'clear' }, ...keys('42')], 12345, 99_999)).toBe(42);
  });

  it('M = 最大 @source `loc_004530e9` 的 `itoa(10, buf, 上限)`', () => {
    expect(amountKeyStep(7, 12345, { kind: 'max' })).toEqual({ value: 12345, submit: false });
  });

  it('★ H = 按金额栏（窗内 `(0x40, 0x2f)`）：值 = trunc(上限 × 17 ÷ 33)', () => {
    expect(amountKeyStep(0, 33, { kind: 'bar' }).value).toBe(17);
    expect(amountKeyStep(0, 66, { kind: 'bar' }).value).toBe(34);
    expect(amountKeyStep(0, 100, { kind: 'bar' }).value).toBe(51); // 1700 ÷ 33 = 51.5…
    expect(amountKeyStep(0, 3, { kind: 'bar' }).value).toBe(1); // 51 ÷ 33 = 1.54…
    expect(amountKeyStep(0, 0, { kind: 'bar' }).value).toBe(0);
  });

  it('Enter = 確定：值原样交出去 @source `loc_00453116` 的 `Post_0402_Message(atoi(buf))`', () => {
    expect(amountKeyStep(4200, 99_999, { kind: 'ok' })).toEqual({ value: 4200, submit: true });
  });
});

describe('★ 接在 `main.ts` 的 keydown 上（只在填数页开着时生效）', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('那一段排在熱鍵之前、只在 `amountPage` 开着时接，取消仍走梯子', () => {
    const at = src.indexOf("amountPage !== null && (screen === 'game' || screen === 'stock')");
    expect(at).toBeGreaterThan(0);
    const hotkeys = src.indexOf('const fn = hotkeyOf(e, bindingsOf(optionsKeys));');
    expect(hotkeys).toBeGreaterThan(at);
    const body = src.slice(at, hotkeys);
    expect(body).toContain('amountVkOf(e)');
    expect(body).toContain('amountKeyOfVk(vk)');
    expect(body).toContain('onAmountKey(ui, key)');
    // 取消（0x205 / ESC）不在这张表里：仍然由 `cancelTopPanel()` 的 `amountPage` 层收
    expect(src).toContain("case 'amountPage':");
  });

  it('★ 开页初值是 `"0"`（不是上限）@source 0x452c91 —— 四个开页点都不许预填上限', () => {
    // 预填上限会让「按数字」被「超上限夹到上限」吃掉，键盘等于不存在
    expect(src).toContain('const AMOUNT_INITIAL = 0;');
    expect(src).not.toContain('value: c.amount.max');
    expect(src).not.toContain('value: stockAmount.max');
    expect((src.match(/value: AMOUNT_INITIAL \}/g) ?? []).length).toBe(4);
  });
});

describe('★ 与銀行 ATM 共用同一份纯函数（两扇窗的键盘）', () => {
  it('数字那一条逐字相同 —— 只有位数上限不同（通用窗 9 / ATM 10）', () => {
    expect(AMOUNT_DIGIT_MAX).toBe(9);
    expect(ATM_DIGIT_MAX).toBe(10);
    // ATM 数字盘：序号 4..12 = 7 8 9 / 4 5 6 / 1 2 3、14 = '0'；`code` = 序号 + 1
    const ATM_CODE: ReadonlyMap<string, number> = new Map([
      ['7', 5], ['8', 6], ['9', 7], ['4', 8], ['5', 9],
      ['6', 10], ['1', 11], ['2', 12], ['3', 13], ['0', 15],
    ]);
    let mine = 0;
    let atm = '';
    for (const ch of '007153') {
      mine = amountKeyStep(mine, 99_999, { kind: 'digit', digit: Number(ch) }).value;
      atm = atmApplyCode(atm, ATM_CODE.get(ch) ?? -1, 99_999);
      expect(Number.parseInt(atm === '' ? '0' : atm, 10)).toBe(mine);
    }
    expect(mine).toBe(7153);
    expect(atm).toBe('7153');
    // 退格也是同一份
    expect(backspaceKey('1234')).toBe('123');
    expect(atmApplyCode('1234', 16, 4200)).toBe('123');
    // 前导 0 / 夹上限也是同一份
    expect(appendDigitKey('0', '0', 999, AMOUNT_DIGIT_MAX)).toBe('0');
    expect(appendDigitKey('0', '7', 999, AMOUNT_DIGIT_MAX)).toBe('7');
    expect(appendDigitKey('7', '8', 3, AMOUNT_DIGIT_MAX)).toBe('3');
    expect(atmApplyCode('7', 6, 3)).toBe('3');
    // C 与 M 两边语义也一致 —— 它们各自只是一个表达式，没有再抽一层
    expect(atmApplyCode('123', 14, 999)).toBe('0');
    expect(amountKeyStep(123, 999, { kind: 'clear' })).toEqual({ value: 0, submit: false });
    expect(atmApplyCode('12', 17, 999)).toBe('999');
    expect(amountKeyStep(12, 999, { kind: 'max' })).toEqual({ value: 999, submit: false });
  });
});

describe('★ 填数窗面板的几何 @source 表 0x47e6d8 / 0x475810 段（B-5/B-6 取证）', () => {
  const RECTS_VA = 0x47e6d8;

  it('★★ 15 颗钮的矩形**逐字节**与 exe 对账', () => {
    if (!EXE_OK) return;
    for (let i = 0; i < AMOUNT_KEY_RECTS.length; i++) {
      const r = AMOUNT_KEY_RECTS[i]!;
      const o = doff(RECTS_VA) + i * 4;
      expect(
        { x: byteAt(o), y: byteAt(o + 1), w: byteAt(o + 2), h: byteAt(o + 3) },
        `第 ${i} 颗钮`,
      ).toEqual({ x: r.x, y: r.y, w: r.w, h: r.h });
    }
  });

  it('★ 面板落点与尺寸 @source `[0x48cab8]=0x100` / `[0x48cab6]=0x90`', () => {
    // `rich4.asm:27510-27513` 那四条 `mov dword` 就是 (0x100,0x90)-(0x180,0x150)
    expect(AMOUNT_WINDOW.x).toBe(0x100);
    expect(AMOUNT_WINDOW.y).toBe(0x90);
    expect(AMOUNT_WINDOW.w).toBe(0x180 - AMOUNT_WINDOW.x);
    expect(AMOUNT_WINDOW.h).toBe(0x150 - AMOUNT_WINDOW.y);
    // 资源号：面板 #0x15、逐像素 id 图 #0x16
    expect(AMOUNT_WINDOW.panelResource).toBe(0x15);
    expect(AMOUNT_WINDOW.hitResource).toBe(0x16);
  });

  it('★ 金额栏：9 位、字距 0xc、起点 (0x6b,0x0b) @source fcn_0045297e', () => {
    expect(AMOUNT_WINDOW.valueMaxChars).toBe(9);
    expect(AMOUNT_WINDOW.valueDigitPitch).toBe(0xc);
    expect(AMOUNT_WINDOW.valueAt).toEqual({ dx: 0x6b, dy: 0x0b });
    expect(AMOUNT_WINDOW.percentAt).toEqual({ dx: 0xa, dy: 0x2a });
  });

  it('★★ 命中按**矩形表**判（没有逐像素 id 图时它就是等价物）', () => {
    const { x, y } = AMOUNT_WINDOW;
    // ★ 前两颗（金额栏的 ‹ / › 光标）**矩形互相重叠**：中心点必然被排在前面的
    //   那一颗先认走 —— 原版靠逐像素 id 图分左右，本引擎靠表序。故只对
    //   **键盘那 14 颗**（下标 2 起）钉「中心命中自己」。
    expect(AMOUNT_KEY_RECTS[0]!.y).toBe(AMOUNT_KEY_RECTS[1]!.y);
    for (let i = 2; i < AMOUNT_KEY_RECTS.length; i++) {
      const r = AMOUNT_KEY_RECTS[i]!;
      expect(amountWindowHit(x + r.x + (r.w >> 1), y + r.y + (r.h >> 1)), `第 ${i} 颗`).toBe(i);
    }
    // 重叠那两颗：表序在前的先认（0 先于 1）
    expect(amountWindowHit(x + 16, y + 13)).toBe(0);
    // 窗外的点返回 null
    expect(amountWindowHit(x - 1, y + 100)).toBeNull();
    expect(amountWindowHit(x + 100, y - 1)).toBeNull();
    // 边界：左上角闭 → 命中；右下角开 → 落到**下一颗**（两颗是贴着的）
    expect(amountWindowHit(x + 8, y + 63)).toBe(2);
    expect(amountWindowHit(x + 8 + 58, y + 63)).toBe(3); // 2 的右边界正好是 3 的左边界
    // 第 3 颗的右边界之外（且不在任何矩形里）才算落空
    expect(amountWindowHit(x + 125, y + 63)).toBeNull();
  });
});

describe('★★ 钮序号的语义：跳表 0x452bca + 字符表 0x47e714（B-5/B-6 取证闭环）', () => {
  const JUMP_VA = 0x452bca;
  const CHARS_VA = 0x47e714;

  it('★★ 跳表**逐项**与 exe 对账：2=M / 3=Enter / 4=C / 5=接数字 / 6=退格 / 7..15=接数字', () => {
    if (!EXE_OK) return;
    const fn = (i: number): number => {
      const o = coff(JUMP_VA) + i * 4;
      return (
        (byteAt(o) | (byteAt(o + 1) << 8) | (byteAt(o + 2) << 16) | (byteAt(o + 3) << 24)) >>> 0
      );
    };
    // 14 项，正好盖住序号 2..0xf（原版 `cmp al,0xd / ja` 的闸门）
    expect(fn(0)).toBe(0x004530e9); // M（最大）
    expect(fn(1)).toBe(0x00453116); // Enter（確定）
    expect(fn(2)).toBe(0x00453145); // C（清零）
    expect(fn(4)).toBe(0x00453156); // 退格
    // 其余（含第 3 项与 6..13）全是「接数字」那一支
    for (const i of [3, 5, 6, 7, 8, 9, 10, 11, 12, 13]) expect(fn(i), `第 ${i} 项`).toBe(0x00453189);
  });

  it('★★ 字符表 0x47e714 逐项对账：序号 5 / 7..15 就是 0 与 7..3 的排布', () => {
    if (!EXE_OK) return;
    const ch = (id: number): string => String.fromCharCode(byteAt(doff(CHARS_VA) + id));
    expect(ch(5)).toBe('0');
    expect(ch(7)).toBe('7');
    expect(ch(8)).toBe('8');
    expect(ch(9)).toBe('9');
    expect(ch(0xa)).toBe('4');
    expect(ch(0xb)).toBe('5');
    expect(ch(0xc)).toBe('6');
    expect(ch(0xd)).toBe('1');
    expect(ch(0xe)).toBe('2');
    expect(ch(0xf)).toBe('3'); // 旧注释说 3 没核出来 —— 就在这里
  });

  it('★★ AMOUNT_SLOT_BY_ID 与两张表逐项吻合（手抄表的独立验证）', () => {
    const digits = [5, 7, 8, 9, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf];
    for (const id of digits) {
      const slot = AMOUNT_SLOT_BY_ID.get(id);
      expect(slot?.kind, `序号 ${id} 应当是数字`).toBe('digit');
      if (slot?.kind === 'digit' && EXE_OK) {
        expect(String(slot.digit), `序号 ${id} 的数字`).toBe(
          String.fromCharCode(byteAt(doff(CHARS_VA) + id)),
        );
      }
    }
    expect(AMOUNT_SLOT_BY_ID.get(2)).toEqual({ kind: 'max' });
    expect(AMOUNT_SLOT_BY_ID.get(3)).toEqual({ kind: 'ok' });
    expect(AMOUNT_SLOT_BY_ID.get(4)).toEqual({ kind: 'clear' });
    expect(AMOUNT_SLOT_BY_ID.get(6)).toEqual({ kind: 'backspace' });
    expect(AMOUNT_SLOT_BY_ID.get(0)?.kind).toBe('cursorLeft');
    expect(AMOUNT_SLOT_BY_ID.get(1)?.kind).toBe('cursorRight');
    // 越界闸：0/1 是鼠标那两颗光标（原版走 0x200 拖动支），2..0xf 才查跳表
    expect(amountSlotOfId(1)?.kind).toBe('cursorRight');
    expect(amountSlotOfId(2)?.kind).toBe('max');
    expect(amountSlotOfId(0xf)?.kind).toBe('digit');
    expect(amountSlotOfId(0x10)).toBeNull(); // H（金额栏）不是面板上的钮
    expect(amountSlotOfId(-1)).toBeNull();
  });
});

describe('★ gap-audit #13：填数窗按键音 7 @source 0x00452f0e（键盘）/ 0x00452d95（鼠标按钮），表 0x48234a', () => {
  it('数字 / 退格 / C / M / Enter 都放 7', () => {
    expect(AMOUNT_KEY_SOUND).toBe(7);
    const keys: AmountKey[] = [
      { kind: 'digit', digit: 0 },
      { kind: 'digit', digit: 9 },
      { kind: 'backspace' },
      { kind: 'clear' },
      { kind: 'max' },
      { kind: 'ok' },
    ];
    for (const k of keys) expect(amountKeySound(k), k.kind).toBe(7);
  });
  it('★ H（金额栏，序号 0x10）不放 —— `loc_00452f73` 直接跳 0x00452fb9，不经过 0x00452f0e', () => {
    expect(amountKeySound({ kind: 'bar' })).toBeNull();
  });
  it('键盘上每一个认得的键都走得到这张表（VK → 键 → 音）', () => {
    for (const vk of [0x30, 0x39, 0x08, 0x43, 0x4d, 0x0d]) {
      const k = amountKeyOfVk(vk);
      expect(k, `vk ${vk}`).not.toBeNull();
      expect(amountKeySound(k!)).toBe(7);
    }
    expect(amountKeySound(amountKeyOfVk(0x48)!)).toBeNull();
  });
});
