/*
 * ★ 二进制真值校验 —— 直接以 rich4.exe 为基准验证全部数值表
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 为什么需要这个：
 * 逆向项目 rich4-re 已被发现**至少 5 处错误**（见 docs/reverse-engineering-audit.md）。
 * 它是极有价值的线索来源，但**不是真值**。唯一的真值是原版可执行文件本身。
 *
 * 本测试从 `Rich4/rich4.exe` 的 DGROUP 段直接读出三张数值表，
 * 与 packages/data 的 TS 表逐字段比对。任何一处不符即失败。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { CARDS } from './cards.ts';
import { TOOLS } from './tools.ts';
import { CHARACTERS } from './characters.ts';
import { STOCKS, STOCKS_PER_MAP, stocksOfMap } from './stocks.ts';
import { CARD_IMPLS, PASSIVE_STUB_VA, PASSIVE_CARD_IDS, NO_SELECTION_CARD_IDS } from './card-registry.ts';
import { MAGIC_HOUSE_OPTIONS } from './magic-house.ts';
import {
  SUBTILE_MATRIX,
  VIEW_COUNT,
  VIEW_SPAN,
  projectCell,
  projectionTable,
} from './projection.ts';

const EXE = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/rich4.exe';
const d = existsSync(EXE) ? describe : describe.skip;

/**
 * rich4.exe 的 DGROUP 段映射。
 *
 * ⚠️ 该 PE 的节表 VirtualSize 全为 0（老 Watcom 链接器的特点），
 * 因此必须用 SizeOfRawData 来判断 VA 归属，不能用 VirtualSize。
 */
const DGROUP_VA = 0x463000;
const DGROUP_OFF = 398848;
const DGROUP_SIZE = 158720;

/** 代码段（卡片效果函数等可执行代码位于此） */
const AUTO_VA = 0x401000;
const AUTO_OFF = 1024;
const AUTO_SIZE = 394240;

/** 表在可执行文件中的虚拟地址（由特征字节序列唯一定位得出） */
const VA = {
  /** 30 项 × 8 字节 */
  cardsTable: 0x47fdf2,
  /** 13 项 × 8 字节，紧接卡片表之后（0x47fdf2 + 30*8 = 0x47fee2） */
  toolTable: 0x47fee2,
  /** 12 项 × 0x68 字节 @source rich4_player_info.h 的注释 */
  characterProfiles: 0x47e80c,
  /** 96 项 × 36 字节 @source rich4_stocks.h `game_stocks[96]` */
  gameStocks: 0x47f072,
  /** 31 项函数指针（第 0 项为 NULL 占位）@source csrc/cards.c 的注释 */
  cardFunctions: 0x475d5c,
  /** 魔法屋功能表 `_rich4_magic_house_function_info`，每项 16 字节 */
  /** ★ 第 101 条订正：表基址是 0x475718（先前误用 0x475724 = 记录内的 +12 名称字段）*/
  magicHouse: 0x475718,
  /** 等距投影表，8 视角 × 0xd24 字节 */
  projection: 0x46ccf0,
  /** 块内亚像素偏移矩阵，8 视角 × 4 个 int8 */
  subtile: 0x474910,
} as const;

function loadExe(): Buffer {
  return readFileSync(EXE);
}

function vaToOffset(va: number): number {
  if (va >= DGROUP_VA && va < DGROUP_VA + DGROUP_SIZE) {
    return DGROUP_OFF + (va - DGROUP_VA);
  }
  if (va >= AUTO_VA && va < AUTO_VA + AUTO_SIZE) {
    return AUTO_OFF + (va - AUTO_VA);
  }
  throw new RangeError(`VA 0x${va.toString(16)} 不在 DGROUP 或 AUTO 内`);
}

const big5 = new TextDecoder('big5');

/** 按指针读取 BIG5 字符串，并去掉原版用于对齐的空格 */
function readStringAt(exe: Buffer, va: number): string {
  const off = vaToOffset(va);
  let end = off;
  while (end < exe.length && exe[end] !== 0) end++;
  return big5.decode(exe.subarray(off, end)).replace(/[ 　]/g, '');
}

d('★ 数值表以 rich4.exe 为基准校验', () => {
  it('PE 校验：确认是预期的可执行文件', () => {
    const exe = loadExe();
    expect(exe.length).toBe(602_112);
    const peOff = exe.readUInt32LE(0x3c);
    expect(exe.subarray(peOff, peOff + 4).toString('latin1')).toBe('PE\0\0');
    expect(exe.readUInt32LE(peOff + 24 + 28)).toBe(0x400000); // ImageBase
  });

  it('卡片表 30 项与二进制逐字段一致', () => {
    const exe = loadExe();
    const base = vaToOffset(VA.cardsTable);
    expect(CARDS.length).toBe(30);

    for (let i = 0; i < 30; i++) {
      const o = base + i * 8;
      const card = CARDS[i]!;
      const namePtr = exe.readUInt32LE(o);
      expect(
        [exe[o + 4], exe[o + 5], exe[o + 6], exe[o + 7]],
        `第 ${i + 1} 张卡 ${card.name}`,
      ).toEqual([card.initAmount, card.price, card.f6, card.f7]);
      // 名称也要对上（繁体）
      expect(readStringAt(exe, namePtr), `第 ${i + 1} 张卡名称`).toBe(card.name);
    }
  });

  it('道具表 13 项与二进制逐字段一致', () => {
    const exe = loadExe();
    const base = vaToOffset(VA.toolTable);
    expect(TOOLS.length).toBe(13);

    for (let i = 0; i < 13; i++) {
      const o = base + i * 8;
      const tool = TOOLS[i]!;
      expect(
        [exe[o + 4], exe[o + 5], exe[o + 6], exe[o + 7]],
        `第 ${i + 1} 个道具 ${tool.name}`,
      ).toEqual([tool.initAmount, tool.price, tool.f6, tool.f7]);
      expect(readStringAt(exe, exe.readUInt32LE(o)), `第 ${i + 1} 个道具名称`).toBe(tool.name);
    }
  });

  it('道具表紧接卡片表之后（布局自洽）', () => {
    expect(VA.cardsTable + 30 * 8).toBe(VA.toolTable);
  });

  /**
   * ★ Q4：`f6` 这一列**在可执行文件里没有任何读取点**。
   *
   * 每项 8 字节（name_ptr + init/price/f6/f7），字段直读一律用 disp32
   * （见 0x0041e69e 的 `[eax*8 + 0x47fdf1]`、0x004071a5 的 `[ebx*8 + 0x47fdf6]`），
   * 所以「f6 被读」必然表现为 `.text` 里出现它的绝对地址。
   * 这里把整段 `.text` 当字节流扫一遍，两种索引基准（0 基 / 1 基）的
   * 地址都查；同时用 f7 的地址做**阳性对照**，证明扫描本身有效。
   */
  it('★ Q4：卡片/道具表的 f6 在 .text 里零引用（f7 作阳性对照）', () => {
    const exe = loadExe();
    const text = exe.subarray(AUTO_OFF, AUTO_OFF + AUTO_SIZE);

    const f6 = new Set<number>();
    const f7 = new Set<number>();
    for (let i = 0; i < 30; i++) {
      f6.add(VA.cardsTable + i * 8 + 6);
      f6.add(VA.cardsTable + (i + 1) * 8 - 2); // 1 基写法：0x47fdf0 + n*8
      f7.add(VA.cardsTable + i * 8 + 7);
      f7.add(VA.cardsTable + (i + 1) * 8 - 1); // 1 基写法：0x47fdf1 + n*8
    }
    for (let i = 0; i < 13; i++) {
      f6.add(VA.toolTable + i * 8 + 6);
      f6.add(VA.toolTable + (i + 1) * 8 - 2);
      f7.add(VA.toolTable + i * 8 + 7);
      f7.add(VA.toolTable + (i + 1) * 8 - 1);
    }

    let f6Hits = 0;
    let f7Hits = 0;
    for (let i = 0; i + 4 <= text.length; i++) {
      const v = text.readUInt32LE(i);
      if (f6.has(v)) f6Hits++;
      else if (f7.has(v)) f7Hits++;
    }

    expect(f6Hits, 'f6 的地址不应出现在 .text 的任何一条指令里').toBe(0);
    expect(f7Hits, 'f7 的地址必须扫得到（阳性对照）').toBeGreaterThan(0);
  });

  it('★ Q4：f6 == 2 的分组（卡片 5 张 / 道具 9..13）', () => {
    // 纯数据事实；与「研究所研發 / 商店不上架」的硬编码机制相关但非因果
    expect(CARDS.filter((c) => c.f6 === 2).map((c) => c.id)).toEqual([1, 2, 9, 10, 15]);
    expect(CARDS.filter((c) => c.f6 !== 0).every((c) => c.f6 === 2)).toBe(true);
    expect(TOOLS.filter((t) => t.f6 === 2).map((t) => t.id)).toEqual([9, 10, 11, 12, 13]);
    expect(TOOLS.filter((t) => t.f6 === 1).map((t) => t.id)).toEqual([6, 7, 8]);
    // f6 == 2 的卡片恰好是价格 ≥ 100 的那 5 张
    expect(CARDS.filter((c) => c.f6 === 2).every((c) => c.price >= 100)).toBe(true);
  });

  it('角色表 12 项与二进制逐字段一致', () => {
    const exe = loadExe();
    const base = vaToOffset(VA.characterProfiles);
    expect(CHARACTERS.length).toBe(12);

    for (let i = 0; i < 12; i++) {
      const o = base + i * 0x68;
      const ch = CHARACTERS[i]!;
      expect(exe.readUInt32LE(o + 0x04), `${ch.name} color`).toBe(ch.color);
      expect(exe[o + 0x11], `${ch.name} trafficMethod`).toBe(ch.trafficMethod);
      expect(exe[o + 0x12], `${ch.name} ndices`).toBe(ch.ndices);
      expect(exe[o + 0x13], `${ch.name} 角色编号`).toBe(ch.id);
      // 原版 sex: 1 = 男, 0 = 女
      expect(exe[o + 0x14] === 0, `${ch.name} 性别`).toBe(ch.isFemale);
      expect(exe[o + 0x16], `${ch.name} f22`).toBe(ch.f22);
      expect(exe[o + 0x17], `${ch.name} f23`).toBe(ch.f23);
      expect(exe[o + 0x18], `${ch.name} f24`).toBe(ch.f24);
      expect(exe[o + 0x19], `${ch.name} initCashRatio`).toBe(ch.initCashRatio);
      expect(exe[o + 0x1a], `${ch.name} f26`).toBe(ch.f26);
      // ★ +0x00 是指向名字串的指针 —— 既校验指针值本身（存档写出要用），
      //   也用它解出名字串（一举两得的独立校验）
      expect(exe.readUInt32LE(o), `${ch.name} namePointer`).toBe(ch.namePointer);
      expect(readStringAt(exe, exe.readUInt32LE(o)), `${ch.name} 名称`).toBe(ch.name);
      expect(readStringAt(exe, ch.namePointer), `${ch.name} namePointer 指向的名字`).toBe(ch.name);
    }
  });

  it('股票表 96 项与二进制逐字段一致', () => {
    const exe = loadExe();
    const base = vaToOffset(VA.gameStocks);
    expect(STOCKS.length).toBe(96);
    expect(STOCKS_PER_MAP).toBe(12);

    for (let i = 0; i < 96; i++) {
      const o = base + i * 36;
      const st = STOCKS[i]!;
      expect(readStringAt(exe, exe.readUInt32LE(o)), `股票 ${i} 名称`).toBe(st.name);
      expect(exe.readUInt16LE(o + 4), `${st.name} f4`).toBe(st.hasCommercial);
      expect(exe[o + 6], `${st.name} f6`).toBe(st.f6);
      expect(exe[o + 7], `${st.name} f7`).toBe(st.f7);
      expect(exe.readUInt16LE(o + 8), `${st.name} shares`).toBe(st.shares);
      expect(exe.readUInt16LE(o + 10), `${st.name} f10`).toBe(st.f10);
      // f20 是估值与买卖取用的价格字段
      expect(exe.readFloatLE(o + 20), `${st.name} price`).toBeCloseTo(st.price, 5);
      expect(exe.readFloatLE(o + 24), `${st.name} volatility`).toBeCloseTo(st.volatility, 5);
      expect(exe.readFloatLE(o + 28), `${st.name} f28`).toBeCloseTo(st.f28, 5);
      expect(exe.readUInt32LE(o + 32), `${st.name} f32`).toBe(st.f32);
    }
  });

  it('初始表中 f12 == f16 == f20（三者皆为股价）', () => {
    const exe = loadExe();
    const base = vaToOffset(VA.gameStocks);
    for (let i = 0; i < 96; i++) {
      const o = base + i * 36;
      const p = exe.readFloatLE(o + 20);
      expect(exe.readFloatLE(o + 12), `股票 ${i} f12`).toBeCloseTo(p, 5);
      expect(exe.readFloatLE(o + 16), `股票 ${i} f16`).toBeCloseTo(p, 5);
    }
  });

  it('stocksOfMap 按 地图*12 正确切片', () => {
    expect(stocksOfMap(0).length).toBe(12);
    expect(stocksOfMap(0)[0]!.name).toBe(STOCKS[0]!.name);
    expect(stocksOfMap(7)[11]!.name).toBe(STOCKS[95]!.name);
  });

  it('★ 卡片实现清单的函数地址与 card_functions[] 逐项一致', () => {
    const exe = loadExe();
    const base = vaToOffset(VA.cardFunctions);
    expect(CARD_IMPLS.length).toBe(30);
    // 第 0 项是 NULL 占位
    expect(exe.readUInt32LE(base)).toBe(0);
    for (const impl of CARD_IMPLS) {
      expect(exe.readUInt32LE(base + impl.id * 4), `${impl.name} 函数地址`).toBe(impl.va);
    }
  });

  it('★ 被动卡的函数体确为 `xor eax,eax; ret`（2 字节空桩）', () => {
    const exe = loadExe();
    const off = vaToOffset(PASSIVE_STUB_VA);
    // 31 C0 = xor eax,eax ; C3 = ret
    expect([exe[off], exe[off + 1], exe[off + 2]]).toEqual([0x31, 0xc0, 0xc3]);
    // 复仇/嫁祸/免费/免罪 四张
    expect(PASSIVE_CARD_IDS).toEqual([18, 19, 20, 21]);
  });

  it('被动卡与均富卡入口仅差 3 字节（空桩紧邻其前）', () => {
    expect(PASSIVE_STUB_VA + 3).toBe(CARD_IMPLS[0]!.va);
  });

  it('无需目标选择的卡片有 7 张', () => {
    // 均富/购地/改建/拍卖/冬眠/送神 + 被动卡除外
    expect(NO_SELECTION_CARD_IDS).toEqual([1, 3, 7, 8, 15, 22]);
  });

  it('★ 魔法屋 12 个功能（图号 / 摆位 / 名字）与二进制**逐字段**一致', () => {
    const exe = loadExe();
    const base = vaToOffset(VA.magicHouse);
    expect(MAGIC_HOUSE_OPTIONS).toHaveLength(12);

    // @source 0x00431d05（0 基读 +12 名称）与 0x00432dc4（1 基读 +0 图号）
    //   ⇒ 同一条 16 字节记录 {+0 img, +4 x, +8 y, +12 name}。
    //   ★ 第 101 条订正：先前用 base=0x475724 + {name,frames,x,y}，
    //     名字恰好对、其余三项整体错位一格（十二个图标旋转了一位）。
    for (let i = 0; i < 12; i++) {
      const o = base + i * 16;
      const opt = MAGIC_HOUSE_OPTIONS[i]!;
      expect(exe.readUInt32LE(o), `option ${i} img`).toBe(opt.img);
      expect(exe.readUInt32LE(o + 4), `option ${i} x`).toBe(opt.x);
      expect(exe.readUInt32LE(o + 8), `option ${i} y`).toBe(opt.y);
      expect(readStringAt(exe, exe.readUInt32LE(o + 12)), `option ${i} name`).toBe(opt.name);
    }

    // 「指针高亮」那一支用的是 **1 基**下标：0x475708 + 16k（k = 功能号 + 1）
    // ⇒ 与上面 0 基读取落在同一条记录上，互相印证字段序。
    for (let opt = 0; opt < 12; opt++) {
      const k = opt + 1;
      expect(exe.readUInt32LE(vaToOffset(VA.magicHouse) - 0x10 + k * 16)).toBe(
        MAGIC_HOUSE_OPTIONS[opt]!.img,
      );
    }
  });

  it('★ 投影表 8×29×29 与二进制逐项一致', () => {
    const exe = loadExe();
    const base = vaToOffset(VA.projection);
    const t = projectionTable();
    expect(t.length).toBe(VIEW_COUNT * VIEW_SPAN * VIEW_SPAN * 2);

    for (let v = 0; v < VIEW_COUNT; v++) {
      for (let r = 0; r < VIEW_SPAN; r++) {
        for (let c = 0; c < VIEW_SPAN; c++) {
          const o = base + v * 0xd24 + r * 0x74 + c * 4;
          const cell = projectCell(v, r, c)!;
          // ★ 表项在内存里的顺序是 (Y, X)：偏移 +0 是 Y、+2 是 X。
          //   轴向由 fcn_004557a1 / fcn_004564c1 / fcn_00456770 三段绘制代码钉死，
          //   单比字节是分不出来的（两种标注读同一份数据都自洽）——
          //   这四条断言的作用是**锁住当前标注**，防止再被无意识地翻回去。
          expect(cell.y, `视角${v} 行${r} 列${c} 的 y = 表项第 1 个 int16`).toBe(exe.readInt16LE(o));
          expect(cell.x, `视角${v} 行${r} 列${c} 的 x = 表项第 2 个 int16`).toBe(exe.readInt16LE(o + 2));
        }
      }
    }
  });

  it('★ 摄像机所在格 (14,14) 的表项恒为 (0,0)', () => {
    for (let v = 0; v < VIEW_COUNT; v++) {
      expect(projectCell(v, 14, 14), `视角${v}`).toEqual({ x: 0, y: 0 });
    }
  });

  it('★ 亚像素矩阵与二进制一致，且与表的行列步长自洽', () => {
    const exe = loadExe();
    const base = vaToOffset(VA.subtile);
    for (let v = 0; v < VIEW_COUNT; v++) {
      const m = SUBTILE_MATRIX[v]!;
      for (let i = 0; i < 4; i++) {
        expect(m[i], `视角${v} 矩阵第 ${i} 项`).toBe(exe.readInt8(base + v * 4 + i));
      }
      // 自洽性：矩阵给出的整块位移应当等于表的行列步长。
      // ★ 配对是单向的 —— o1（m[0]/m[2]）喂 X、o2（m[1]/m[3]）喂 Y。
      //   写成「m[1] 对 x」也能通过，那正是 2026-09-15 订正掉的那个错：
      //   表和矩阵两头同时翻，等式两边一起变号，测试就哑了。
      //   真正的裁判是 `fcn_00407a2c` 把 o1/o2 写进哪个出参（见 projection.ts 文件头）。
      const center = projectCell(v, 14, 14)!;
      const rowStep = projectCell(v, 15, 14)!; // +1 行 = +1 世界 Y → dy = 32
      const colStep = projectCell(v, 14, 15)!; // +1 列 = +1 世界 X → dx = 32
      expect(-((m[0] * 32) >> 5)).toBe(colStep.x - center.x);
      expect(-((m[1] * 32) >> 5)).toBe(colStep.y - center.y);
      expect(-((m[2] * 32) >> 5)).toBe(rowStep.x - center.x);
      expect(-((m[3] * 32) >> 5)).toBe(rowStep.y - center.y);
    }
  });

  it('★ 一格是「横长」的，整块棋盘是「横长」的 —— 这一条能区分两种轴向标注', () => {
    // 上面那条逐字节比对**区分不了** (Y,X) 与 (X,Y)：两种标注读同一份数据都自洽。
    // 这一条才行 —— 把轴翻回去，一格的包围盒会从 49×36 变成 36×49，本断言即失败。
    //
    // 证据链（详见 projection.ts 文件头）：
    //   a) fcn_004557a1/fcn_0045596a：地块四角的第 1 个 int16 参与 `draw_area.top/bottom` 比较 → 是 Y
    //   b) fcn_004564c1 → draw_non_zero_image_in_rect(640,480,…,x,y,1)，x 取 0x46ccf2 那一路 → 第 2 个是 X
    //   c) fcn_00456770 的形参 4 参与 `imul …,0x280` 的行寻址 → 是列（X）
    //   d) 版面：原版把摄像机格钉在屏幕 (0xdc, 0x104) = (220, 260)，
    //      而棋盘区是 `{x:0,y:40,w:439,h:440}`，其正中恰为 (219.5, 260) —— 两个常数
    //      一横一纵各对一半；调换就偏出 40 像素。
    for (let v = 0; v < VIEW_COUNT; v++) {
      const corners = [
        projectCell(v, 14, 14)!,
        projectCell(v, 15, 14)!,
        projectCell(v, 14, 15)!,
        projectCell(v, 15, 15)!,
      ];
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      expect(Math.max(...xs) - Math.min(...xs), `视角${v} 一格的宽`).toBeGreaterThan(
        Math.max(...ys) - Math.min(...ys),
      );
    }

    // 视角 0 钉死具体数值（49 = 14+34+… 的包围盒，见上）
    const c0 = projectCell(0, 14, 14)!;
    expect(projectCell(0, 15, 14)!.x - c0.x).toBe(14); // 行步 (ΔX, ΔY)
    expect(projectCell(0, 15, 14)!.y - c0.y).toBe(25);
    expect(projectCell(0, 14, 15)!.x - c0.x).toBe(34); // 列步 (ΔX, ΔY)
    expect(projectCell(0, 14, 15)!.y - c0.y).toBe(-11);

    // 整块 29×29 窗口的包围盒 ≈ 1425×1010（横长），不是竖长
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let r = 0; r < VIEW_SPAN; r++) {
      for (let c = 0; c < VIEW_SPAN; c++) {
        const p = projectCell(0, r, c)!;
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
    expect(maxX - minX).toBe(1425);
    expect(maxY - minY).toBe(1009);
  });

  it('★ 五张表全部来自同一可执行文件，无一字段依赖逆向项目的转录', () => {
    // 这条是声明性的：上面四项若全通过，即证明 packages/data 的数值
    // 完全独立于 rich4-re 的 .c 文件而成立。
    const exe = loadExe();
    expect(vaToOffset(VA.cardsTable)).toBeLessThan(exe.length);
    expect(vaToOffset(VA.toolTable)).toBeLessThan(exe.length);
    expect(vaToOffset(VA.characterProfiles)).toBeLessThan(exe.length);
    expect(vaToOffset(VA.gameStocks)).toBeLessThan(exe.length);
    expect(vaToOffset(VA.cardFunctions)).toBeLessThan(exe.length);
  });
});
