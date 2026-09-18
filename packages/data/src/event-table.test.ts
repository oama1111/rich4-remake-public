/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 事件表 —— 直接对 rich4.exe 校验
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  FORTUNE_EVENTS,
  NEWS_EVENTS,
  eventAmount,
  fortuneEvent,
  newsEvent,
  stripEventCode,
} from './event-table.ts';

const EXE = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/Rich4/rich4.exe';
const run = existsSync(EXE) ? it : it.skip;

/** DGROUP：VA 0x463000 → 文件偏移 398848 */
const dataOff = (va: number) => 398848 + (va - 0x463000);
/** AUTO：VA 0x401000 → 文件偏移 1024 */
const codeOff = (va: number) => 1024 + (va - 0x401000);

describe('表的规模', () => {
  it('新聞 36 项、命運 37 项', () => {
    expect(NEWS_EVENTS).toHaveLength(36);
    expect(FORTUNE_EVENTS).toHaveLength(37);
  });

  it('id 连续且与下标一致', () => {
    NEWS_EVENTS.forEach((e, i) => expect(e.id).toBe(i));
    FORTUNE_EVENTS.forEach((e, i) => expect(e.id).toBe(i));
  });
});

describe('★ 直接对 exe 的函数指针表校验', () => {
  run('新聞事件的 va 与 0x00475e24 表逐项一致', () => {
    const d = readFileSync(EXE);
    NEWS_EVENTS.forEach((e, i) => {
      expect(d.readUInt32LE(dataOff(0x475e24) + i * 4), `news[${i}]`).toBe(e.va);
    });
  });

  run('命運事件的 va 与 0x00475ef0 表逐项一致', () => {
    const d = readFileSync(EXE);
    FORTUNE_EVENTS.forEach((e, i) => {
      expect(d.readUInt32LE(dataOff(0x475ef0) + i * 4), `fortune[${i}]`).toBe(e.va);
    });
  });

  run('每个 va 都落在代码段内', () => {
    for (const e of [...NEWS_EVENTS, ...FORTUNE_EVENTS]) {
      expect(e.va).toBeGreaterThanOrEqual(0x401000);
      expect(e.va).toBeLessThan(0x401000 + 394240);
    }
  });

  run('★ 绝大多数以 push 开头，两处例外已核实', () => {
    const d = readFileSync(EXE);
    const odd: number[] = [];
    for (const e of [...NEWS_EVENTS, ...FORTUNE_EVENTS]) {
      if (![0x53, 0x56, 0x57, 0x55].includes(d[codeOff(e.va)]!)) odd.push(e.va);
    }
    // news[26] 与 fortune[3] 以 `mov`(0x8b) 开头——不压寄存器直接取参，
    // 是合法的序跋变体，不是表读错了。
    expect(odd).toEqual([0x0044b0a0, 0x0044c229]);
  });

  run('地址两两不同', () => {
    const all = [...NEWS_EVENTS, ...FORTUNE_EVENTS].map((e) => e.va);
    expect(new Set(all).size).toBe(all.length);
  });

  run('★ textVa 都指向数据段里可解码的 BIG5 字符串', () => {
    const d = readFileSync(EXE);
    let checked = 0;
    for (const e of [...NEWS_EVENTS, ...FORTUNE_EVENTS]) {
      if (e.textVa === 0) continue;
      const o = dataOff(e.textVa);
      expect(e.textVa).toBeGreaterThanOrEqual(0x463000);
      const end = d.indexOf(0, o);
      expect(end).toBeGreaterThan(o); // 非空
      // 文案自带 `#NNNN` 四位编号前缀
      expect(d[o]).toBe(0x23); // '#'
      checked++;
    }
    expect(checked).toBeGreaterThan(60);
  });
});

describe('金额系数', () => {
  it('金额 = 物价指数 × factor', () => {
    const e = fortuneEvent(22)!;
    expect(e.factor).toBe(3000);
    expect(eventAmount(e, 1)).toBe(3000);
    expect(eventAmount(e, 7)).toBe(21_000);
  });

  it('factor 为 null 时金额为 0', () => {
    const e = fortuneEvent(0)!;
    expect(e.factor).toBeNull();
    expect(eventAmount(e, 9)).toBe(0);
  });

  it('★ 所有 factor 都是正整数（移位链还原正确的必要条件）', () => {
    for (const e of [...NEWS_EVENTS, ...FORTUNE_EVENTS]) {
      if (e.factor === null) continue;
      expect(Number.isInteger(e.factor), `event ${e.id}`).toBe(true);
      expect(e.factor, `event ${e.id}`).toBeGreaterThan(0);
    }
  });

  it('★ factor 都是整百的数——原版的金额都取整齐值', () => {
    for (const e of [...NEWS_EVENTS, ...FORTUNE_EVENTS]) {
      if (e.factor === null) continue;
      expect(e.factor % 100, `event ${e.id} factor=${e.factor}`).toBe(0);
    }
  });
});

describe('查找', () => {
  it('按 id 取得', () => {
    expect(newsEvent(29)?.id).toBe(29);
    expect(fortuneEvent(33)?.id).toBe(33);
  });

  it('越界返回 undefined', () => {
    expect(newsEvent(99)).toBeUndefined();
    expect(fortuneEvent(-1)).toBeUndefined();
  });
});

// ============================================================
//  ★ 文案入库后，把「代码推导」与「文案语义」对照起来
// ============================================================

describe('★ 文案与 exe 中的字节一致', () => {
  run('每条 text 都等于 textVa 处的 BIG5 串', () => {
    const d = readFileSync(EXE);
    let checked = 0;
    for (const e of [...NEWS_EVENTS, ...FORTUNE_EVENTS]) {
      if (e.textVa === 0) continue;
      const o = dataOff(e.textVa);
      const end = d.indexOf(0, o);
      const raw = new TextDecoder('big5').decode(d.subarray(o, end));
      expect(raw, `event va=0x${e.va.toString(16)}`).toBe(e.text);
      checked++;
    }
    expect(checked).toBeGreaterThan(60);
  });

  it('每条文案都以 #NNNN 编号开头', () => {
    for (const e of [...NEWS_EVENTS, ...FORTUNE_EVENTS]) {
      if (e.text === '') continue;
      expect(e.text, `event ${e.id}`).toMatch(/^#\d{4}/);
    }
  });

  it('stripEventCode 去掉编号前缀', () => {
    expect(stripEventCode('#0178abc')).toBe('abc');
    expect(stripEventCode('没有前缀')).toBe('没有前缀');
  });
});

describe('★ 可达性分析出的方向与文案语义吻合', () => {
  /** 文案里出现这些词就意味着玩家**收钱** */
  const GAIN = ['撿到', '獲得', '中獎', '領取', '獎勵', '補助', '紅利'];
  /** 出现这些词意味着玩家**付钱** */
  const LOSS = ['罰款', '損失', '繳交', '花費', '付保險'];

  it('文案含「撿到/中獎/領取…」的事件，方向都是 give', () => {
    let n = 0;
    for (const e of [...NEWS_EVENTS, ...FORTUNE_EVENTS]) {
      if (e.factor === null) continue;
      if (!GAIN.some((w) => e.text.includes(w))) continue;
      expect(e.effects, `${e.text}`).toContain('give');
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(8);
  });

  it('文案含「罰款/損失/繳交…」的事件，方向都是 pay', () => {
    let n = 0;
    for (const e of [...NEWS_EVENTS, ...FORTUNE_EVENTS]) {
      if (e.factor === null) continue;
      if (!LOSS.some((w) => e.text.includes(w))) continue;
      expect(e.effects, `${e.text}`).toContain('pay');
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(6);
  });

  it('★ 文案含「坐牢」的事件都走 prison', () => {
    const jail = [...NEWS_EVENTS, ...FORTUNE_EVENTS].filter((e) => e.text.includes('坐牢'));
    expect(jail.length).toBe(5);
    for (const e of jail) expect(e.effects, e.text).toContain('prison');
  });

  it('★ 文案含「住院/就醫」的事件都走 hospital', () => {
    const hosp = [...FORTUNE_EVENTS].filter(
      (e) => e.text.includes('住院') || e.text.includes('就醫'),
    );
    expect(hosp.length).toBe(2);
    for (const e of hosp) expect(e.effects, e.text).toContain('hospital');
  });
});

describe('★ 文案里的字面数字与代码推导互证', () => {
  it('news[29] 文案写「坐牢５天」，与 send_to_prison 调用点的 5 一致', () => {
    expect(newsEvent(29)!.text).toContain('坐牢５天');
  });

  it('★ 带 %d 的金额事件都有 factor', () => {
    for (const e of FORTUNE_EVENTS) {
      // 只看明确以「元」计价的
      if (!/%d元/.test(e.text)) continue;
      expect(e.factor, `${e.text}`).not.toBeNull();
    }
  });

  it('★ 有 factor 的事件，文案里必有 %d 占位符', () => {
    for (const e of [...NEWS_EVENTS, ...FORTUNE_EVENTS]) {
      if (e.factor === null || e.text === '') continue;
      expect(e.text, `event factor=${e.factor}`).toContain('%d');
    }
  });
});

describe('★ literal 与文案占位符一致', () => {
  it('有 literal 的事件，文案里必有 %d', () => {
    for (const e of [...NEWS_EVENTS, ...FORTUNE_EVENTS]) {
      if (e.literal === null) continue;
      expect(e.text, `event literal=${e.literal}`).toContain('%d');
    }
  });

  it('★ literal 与 factor 互斥——%d 要么来自字面常量，要么来自物价指数', () => {
    for (const e of [...NEWS_EVENTS, ...FORTUNE_EVENTS]) {
      expect(e.literal !== null && e.factor !== null, `event ${e.id}`).toBe(false);
    }
  });

  it('★ 坐牢事件的刑期：3 / 5 / 7 / 9 天', () => {
    expect([33, 34, 35, 36].map((id) => fortuneEvent(id)!.literal)).toEqual([3, 5, 7, 9]);
  });

  it('★ literal 的单位由文案决定——fortune[8] 是百分比不是天数', () => {
    const e = fortuneEvent(8)!;
    expect(e.literal).toBe(10);
    expect(e.text).toContain('％'); // 「損失股票10％」
    expect(e.text).not.toContain('天');
  });

  it('走 prison/hospital 的事件都带 literal（天数）', () => {
    for (const e of [...NEWS_EVENTS, ...FORTUNE_EVENTS]) {
      if (!e.effects.includes('prison') && !e.effects.includes('hospital')) continue;
      // news[29] 的天数是写死在文案里的全角「５」，没有 %d，故 literal 为 null
      if (!e.text.includes('%d')) continue;
      expect(e.literal, `${e.text}`).not.toBeNull();
    }
  });
});

/**
 * ★★ 命运事件「神明加持」用法表 —— **直接对 exe 校验**（第 37 条）。
 *
 * 每个带加持的事件最终都走到某一次 `call 0x44b896`，其前两条指令的字节是
 * `6a <arg1> 6a <arg0> e8 <rel32>`（cdecl：先压最后一个参数）。三个组合 = 三种用法：
 *
 * | (arg0, arg1) | 字节 | 用法 | 读哪个字段 | 提示语 |
 * |---|---|---|---|---|
 * | (0,0) | `6a 00 6a 00` | `reward` | `+0x46` 財運 | 獎金加倍／獎金作廢 |
 * | (0,1) | `6a 01 6a 00` | `penalty` | `+0x46` 財運 | 免付罰金／罰金加倍 |
 * | (1,1) | `6a 01 6a 01` | `misfortune` | `+0x48` 福運 | 逃過此劫／倒霉加倍 |
 *
 * ⚠️ **共享尾**：`+0x44d172` 是 penalty 尾、`+0x44d2a9` 是 reward 尾。
 * 事件表里的 `va` 只是**入口**，19..31 这些事件的函数体很短、一条 `jne` 就跳进共享尾，
 * 所以「表里该不该有 blessing」**不能只看函数体里有没有 `call`** ——
 * 先前正是这样漏了 12 个、又给 19/22 记错了用法。
 * 右列（事件 → 它实际走到的调用点）来自「谁跳进那两条尾」的穷举扫描，脚本见
 * `rich4-spec/tools/scratch/blessing_callers.py`。
 */
const BLESSING_CALLSITE = new Map<number, number>([
  [2, 0x44c184], [3, 0x44c280],
  [6, 0x44c65c], [7, 0x44c771],
  [8, 0x44c874], [9, 0x44c97c],
  [10, 0x44caa3], [11, 0x44cbb0], [12, 0x44ccd8],
  [14, 0x44ce39], [15, 0x44cfe3],
  // 17..31 里除 20 外都跳进两条共享尾；17 与 20 是**自己**条件跳进自己的尾
  [17, 0x44d176], [18, 0x44d176], [19, 0x44d176],
  [20, 0x44d2ad], [21, 0x44d2ad], [22, 0x44d2ad],
  [23, 0x44d176], [24, 0x44d176], [25, 0x44d2ad], [26, 0x44d176],
  [27, 0x44d2ad], [28, 0x44d2ad], [29, 0x44d2ad], [30, 0x44d176], [31, 0x44d2ad],
  [32, 0x44d6d4], [33, 0x44d80f],
]);

run('★ 28 个命运事件的 blessing 用法与 exe 调用点参数逐项一致', () => {
  const exe = readFileSync(EXE);
  /** AUTO 节：VA 0x401000 → 文件偏移 1024 */
  const codeOff = (va: number) => 1024 + (va - 0x401000);

  const kindOf = (callVa: number): string => {
    const o = codeOff(callVa);
    expect(exe[o], `0x${callVa.toString(16)} 应为 call`).toBe(0xe8);
    expect(
      callVa + 5 + exe.readInt32LE(o + 1),
      `0x${callVa.toString(16)} 的调用目标应是 0x44b896`,
    ).toBe(0x44b896);
    // 字节布局：`6a <arg1> 6a <arg0> e8 <rel32>`（离 call 最近的那条 push = arg0）
    expect(exe[o - 4], `0x${callVa.toString(16)} 的 arg1 push 操作码`).toBe(0x6a);
    expect(exe[o - 2], `0x${callVa.toString(16)} 的 arg0 push 操作码`).toBe(0x6a);
    const arg1 = exe[o - 3]!;
    const arg0 = exe[o - 1]!;
    if (arg0 === 0 && arg1 === 0) return 'reward';
    if (arg0 === 0 && arg1 === 1) return 'penalty';
    if (arg0 === 1 && arg1 === 1) return 'misfortune';
    throw new Error(`0x${callVa.toString(16)} 出现未知参数组合 (${arg0}, ${arg1})`);
  };

  const fromExe = [...BLESSING_CALLSITE.entries()]
    .map(([id, va]) => [id, kindOf(va)] as const)
    .sort((a, b) => a[0] - b[0]);
  const fromTable = FORTUNE_EVENTS.filter((e) => e.blessing !== undefined)
    .map((e) => [e.id, e.blessing!] as const)
    .sort((a, b) => a[0] - b[0]);

  expect(fromTable).toEqual(fromExe);
  expect(fromTable).toHaveLength(28);
  // 原版**没接**加持的那一个：16（汽車超速罰款3000元）
  expect(FORTUNE_EVENTS.find((e) => e.id === 16)?.blessing).toBeUndefined();
});
