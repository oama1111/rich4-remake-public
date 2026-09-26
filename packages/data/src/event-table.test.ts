/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 事件表 —— 直接对 rich4.exe 校验
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  FORTUNE_ART_TABLE,
  FORTUNE_EVENTS,
  FORTUNE_MAP_JAIL_EVENTS,
  NEWS_EVENTS,
  eventAmount,
  fortuneArtResource,
  fortuneDisplayEntry,
  fortuneEvent,
  fortuneSlot,
  newsEvent,
  stripEventCode,
} from './event-table.ts';

const EXE = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/rich4.exe';
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

// ============================================================
//  ★★★ 新聞 4「外星人攻打地球」@source `fcn_0044913d`（355 B）
//  表里的 `effects` 是**可达性分析**的结论，所以它必须能由 exe 字节复现。
//  这一组直接读 exe，把「爆心的四个实参 + 送医天数 + 候选集门控」逐字节钉住。
//  ★ 最要紧的一条：`0x64` 是**半径**、`1` 才是**重击** —— 两列，不是一列。
// ============================================================
describe('★★★ 新聞 4 的爆心实参 —— 直接对 exe 字节校验', () => {
  /** 读 `call rel32` 的落点 */
  const callTarget = (d: Buffer, at: number): number =>
    at + 5 + d.readInt32LE(codeOff(at) + 1);

  run('VA 0x00449225：`damage_area(0x64, 0x26, 1, -1)` 的压栈序列逐字节一致', () => {
    const d = readFileSync(EXE);
    const o = codeOff(0x00449225);
    expect([...d.subarray(o, o + 13)]).toEqual([
      0x6a, 0xff, // push -1    ← 攻击者 = 无（⇒ 不记敌意）
      0x6a, 0x01, // push 1     ← ★ 重击位（不是半径！）
      0x6a, 0x26, // push 0x26  ← flags：住宅 | 設施 | 范围里的人
      0x6a, 0x64, // push 0x64  ← ★ 半径 = 100（**不是**核彈的 -1 全图）
      0xe8, 0x49, 0x1a, 0xfc, 0xff, // call rel32
    ]);
    expect(callTarget(d, 0x0044922d)).toBe(0x0040ac7b); // damage_area
  });

  run('VA 0x00449282：被炸到的人 `push 3 / call 0x43ec3f`（send_to_hospital）', () => {
    const d = readFileSync(EXE);
    const o = codeOff(0x00449282);
    expect([...d.subarray(o, o + 8)]).toEqual([
      0x6a, 0x03, // push 3   ← 住院天数（不是 %d，故 literal 为 null）
      0x53, // push ebx      ← 玩家下标
      0xe8, 0xb5, 0x59, 0xff, 0xff,
    ]);
    expect(callTarget(d, 0x00449285)).toBe(0x0043ec3f); // send_to_hospital
    // 进这一支的门槛是 `test byte [player+0x15], 0x40`（VA 0x00449279）
    expect([...d.subarray(codeOff(0x00449276), codeOff(0x00449279))]).toEqual([
      0x6b, 0xc3, 0x68, // imul eax, ebx, 0x68  ← player 一步 0x68
    ]);
    expect([...d.subarray(codeOff(0x00449279), codeOff(0x00449280))]).toEqual([
      0xf6, 0x80, 0x7d, 0x6b, 0x49, 0x00, 0x40, // test byte [eax+0x496b7d], 0x40
    ]);
  });

  run('候选表只收 `level != 0`：地块与設施各一道 `cmp byte [.. +0x1a], 0`', () => {
    const d = readFileSync(EXE);
    for (const va of [0x0044918d, 0x004491c6]) {
      expect([...d.subarray(codeOff(va), codeOff(va) + 6)], `VA ${va.toString(16)}`).toEqual([
        0x80, 0x7c, 0x02, 0x1a, 0x00, // cmp byte [edx+eax+0x1a], 0  ← land/facility +0x1a = level
        0x74, // je 跳过
      ]);
    }
  });

  run('★ 表里第 4 项记的是 `alienBlast`，不是 `hospital`（后者会恒报 unimplemented）', () => {
    const e = newsEvent(4)!;
    expect(e.va).toBe(0x0044913d);
    expect(e.effects).toContain('alienBlast');
    expect(e.effects).not.toContain('hospital');
    expect(e.literal).toBeNull(); // 文案「外星人攻打地球」里没有 %d
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

  it('★ 文案含「坐牢」的事件都走关押那一类（4 条命运走 prison，news 29 走 companyChairmanPrison）', () => {
    const jail = [...NEWS_EVENTS, ...FORTUNE_EVENTS].filter((e) => e.text.includes('坐牢'));
    expect(jail.length).toBe(5);
    // ★★ 2026-09 本轮订正：先前 5 条一律断言 `prison`。news 29 不是泛用 `prison`
    //   （那是「关 affected / 抽牌者」），而是「随机抽一家有主企業的經營者」
    //   —— 见 event-table.ts 的 `companyChairmanPrison` 长注释。
    //   把它留在 `prison` 上，判据 `commercials.some(owner !== 0 …)` 之外还会
    //   让日志里的「坐牢 5 天」变成一句空话（`literal` 是 null ⇒ unimplemented）。
    for (const e of jail) {
      if (e.id === 29 && NEWS_EVENTS.includes(e)) {
        expect(e.effects, e.text).toEqual(['companyChairmanPrison']);
        continue;
      }
      expect(e.effects, e.text).toContain('prison');
    }
  });

  it('★ news[29] 的 `companyChairmanPrison` 只在新闻表出现一次（命运 33..36 仍是 prison）', () => {
    expect(NEWS_EVENTS.filter((e) => e.effects.includes('companyChairmanPrison')).map((e) => e.id))
      .toEqual([29]);
    expect(FORTUNE_EVENTS.filter((e) => e.effects.includes('companyChairmanPrison'))).toEqual([]);
    // 命运那四条（酒醉/防礙風化/走私毒品/販賣大補帖）走的是泛用 `prison`：目标 = 抽牌者
    expect(FORTUNE_EVENTS.filter((e) => e.effects.includes('prison')).map((e) => e.id))
      .toEqual([33, 34, 35, 36]);
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
    // ★ 天数 5 在 phase 1 的立即数里（`0044b35f push 5`），不在 `literal`
    //   ——文案的「５」是全角字、没有 `%d`。常量住在 news-effects.ts。
    expect(newsEvent(29)!.literal).toBeNull();
    expect(newsEvent(29)!.effects).toEqual(['companyChairmanPrison']);
  });

  it('★ news[29] 的两个 %s 是「企業名 + 經營者名」，顺序不能反', () => {
    // @source `0x44b2d9 lea eax,[esp+0xb0]`（= 0x452946 去空格后的**玩家名**）先压栈
    //   ⇒ 它是**最后一个**实参（cdecl 右到左）⇒ 对应**第二个** %s；
    //   `0x44b2e1 lea eax,[ebx+4]`（企業记录 +4 = 名字串）是第一个 %s。
    const text = newsEvent(29)!.text;
    expect(text.indexOf('%s')).toBeLessThan(text.lastIndexOf('%s'));
    expect(text.indexOf('違法超貸')).toBeLessThan(text.indexOf('經營者'));
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
  // ★ 第十四份（需求方拍板照原版）：13 是跳板 `0x0044cd7e jne 0x44ccd4` → 12 的施加段
  [13, 0x44ccd8],
  [14, 0x44ce39], [15, 0x44cfe3],
  // ★ 第十四份：16 与 15 **逐字节同构**（`0x0044d0a4 jne 0x44cfdf` → `0x0044cfe3 call 0x44b896(0,1)`）——
  //   先前「16 原版没接加持」是扫描只认了两条共享尾、漏了 `0x44cfdf` 这一条
  [16, 0x44cfe3],
  // 17..31 里除 20 外都跳进两条共享尾；17 与 20 是**自己**条件跳进自己的尾
  [17, 0x44d176], [18, 0x44d176], [19, 0x44d176],
  [20, 0x44d2ad], [21, 0x44d2ad], [22, 0x44d2ad],
  [23, 0x44d176], [24, 0x44d176], [25, 0x44d2ad], [26, 0x44d176],
  [27, 0x44d2ad], [28, 0x44d2ad], [29, 0x44d2ad], [30, 0x44d176], [31, 0x44d2ad],
  [32, 0x44d6d4], [33, 0x44d80f],
  // ★ 第十四份：34/35/36 是跳板（`0x0044d8e1` / `0x0044d90f` / `0x0044d93d jne 0x44d80b`）→ 33 的施加段
  [34, 0x44d80f], [35, 0x44d80f], [36, 0x44d80f],
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
  expect(fromTable).toHaveLength(33);
  // ★ 第十四份：16（汽車超速罰款）**接了**加持 —— 施加入口逐字节核一遍
  const o16 = codeOff(0x44d0a4);
  expect([...exe.subarray(o16, o16 + 2)]).toEqual([0x0f, 0x85]); // jne rel32
  expect(0x44d0a4 + 6 + exe.readInt32LE(o16 + 2)).toBe(0x44cfdf);
  // 跳板那几条：jne 的目标就是 12 / 33 的施加段（那里第一件事就是问加持）
  for (const [va, to] of [[0x44cd7e, 0x44ccd4], [0x44d8e1, 0x44d80b], [0x44d90f, 0x44d80b], [0x44d93d, 0x44d80b]] as const) {
    const o = codeOff(va);
    expect(va + 6 + exe.readInt32LE(o + 2), `0x${va.toString(16)}`).toBe(to);
  }
});

// ============================================================
//  ★ 第十三份試玩回報：「遺失錢包損失2000元的配圖怎麼是高興的圖」
//  命運插画查的是 word 表 `0x475fb4`，不是 `0x1dd + 事件号`
// ============================================================
describe('★ 命運插画表 `0x475fb4` 与地图换文案的 37..48 —— 直接对 exe 校验', () => {
  const big5 = new TextDecoder('big5');

  run('插画表 49 个 word 与 exe 逐项一致', () => {
    const d = readFileSync(EXE);
    expect(FORTUNE_ART_TABLE).toHaveLength(49);
    FORTUNE_ART_TABLE.forEach((v, i) => {
      expect(d.readInt16LE(dataOff(0x475fb4) + i * 2), `art[${i}]`).toBe(v);
    });
  });

  run('函数指针表 `0x475ef0` 实有 49 项：37..48 与 FORTUNE_MAP_JAIL_EVENTS 逐项一致', () => {
    const d = readFileSync(EXE);
    // 49 × 4 = 0xc4 —— 正好顶到插画表 0x475fb4
    expect(0x475ef0 + 49 * 4).toBe(0x475fb4);
    expect(FORTUNE_MAP_JAIL_EVENTS.map((e) => e.id)).toEqual([37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48]);
    for (const e of FORTUNE_MAP_JAIL_EVENTS) {
      expect(d.readUInt32LE(dataOff(0x475ef0) + e.id * 4), `fortune[${e.id}]`).toBe(e.va);
    }
  });

  run('37..48 每支都是 `mov esi, 天数 / … / push 文案 / jmp 0x44d7a8` 的跳板，天数与文案逐字节一致', () => {
    const d = readFileSync(EXE);
    for (const e of FORTUNE_MAP_JAIL_EVENTS) {
      const o = codeOff(e.va);
      // 0x18: be imm32（mov esi, 天数）
      expect(d[o + 0x18], `va ${e.va.toString(16)}`).toBe(0xbe);
      expect(d.readUInt32LE(o + 0x19)).toBe(e.literal);
      // 0x24: 68 imm32（push 文案）
      expect(d[o + 0x24]).toBe(0x68);
      expect(d.readUInt32LE(o + 0x25)).toBe(e.textVa);
      // 0x29: e9 rel32 → 0x44d7a8（fortune[33] 的生效段）
      expect(d[o + 0x29]).toBe(0xe9);
      expect(e.va + 0x29 + 5 + d.readInt32LE(o + 0x2a)).toBe(0x44d7a8);
      const t = dataOff(e.textVa);
      expect(big5.decode(d.subarray(t, d.indexOf(0, t)))).toBe(e.text);
    }
  });

  it('★ 事件 24（遺失錢包損失 2000）→ 498，与 23 同图；不是 0x1dd+24 = 501（發票中獎）', () => {
    expect(fortuneArtResource(24, 7)).toBe(498);
    expect(fortuneArtResource(23, 0)).toBe(498);
    expect(fortuneArtResource(27, 0)).toBe(501);
    expect(0x1dd + 24).toBe(501);
  });

  it('33..36 按地图低位换槽：v + 4 × (globalMapId & 3)', () => {
    expect(fortuneSlot(33, 0)).toBe(33);
    expect(fortuneSlot(33, 1)).toBe(37);
    expect(fortuneSlot(36, 3)).toBe(48);
    expect(fortuneSlot(33, 5)).toBe(37); // 原版只读低位 `[0x4991b8]`
    expect(fortuneSlot(32, 3)).toBe(32); // v < 33 不看地图
    expect(fortuneArtResource(34, 2)).toBe(506);
    expect(fortuneDisplayEntry(33, 1)?.text).toBe('#0222酒醉大鬧警局坐牢%d天');
    expect(fortuneDisplayEntry(34, 1)?.text).toBe('#0223違法聚眾示威坐牢%d天');
    expect(fortuneDisplayEntry(34, 0)).toBe(fortuneEvent(34));
    expect(fortuneDisplayEntry(24, 3)).toBe(fortuneEvent(24));
  });

  it('换文案不换天数：37..48 的天数与 33..36 按位置一一相同', () => {
    for (const e of FORTUNE_MAP_JAIL_EVENTS) {
      expect(e.literal).toBe(fortuneEvent(33 + ((e.id - 37) % 4))?.literal);
    }
  });
});
