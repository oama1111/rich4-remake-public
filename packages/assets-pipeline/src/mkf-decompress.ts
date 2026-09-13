/*
 * mkf 私有压缩算法的解压实现（自适应霍夫曼 + LZ77 回溯复制）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source rich4-re/csrc/mkf/mkf_decompress.c
 *   —— 该 C 代码本身是 x86 汇编的直译，用「字节偏移 ÷ 2」充当数组下标，
 *      并且会跨 tab1..tab4 做指针运算。本移植**刻意保留**这套索引算术，
 *      以免在"整理得更漂亮"的过程中引入偏差（C-FID-4）。
 *
 * 原版对应地址：
 *   cfcn_45511b   @ 0x0045511b   霍夫曼树频次更新与重排
 *   cfcn_004550cc @ 0x004550cc   频次减半（防溢出）
 *   cfcn_00455109 @ 0x00455109   更新入口
 *   cfcn_004551bb @ 0x004551bb   逐位走树，解出一个符号
 */

import {
  TABLE_483430,
  TABLE_483530,
  CTAB_ORIG,
  CTAB_LEN,
  TAB1_BASE,
  TAB2_BASE,
  TAB3_BASE,
  TAB4_BASE,
} from './mkf-tables.ts';

/**
 * 解压状态。
 *
 * 原版的 tab1/tab2/tab3/tab4 在内存中连续排布，算法依赖这一点做跨表指针运算，
 * 因此这里用**单个扁平 Uint16Array** 表示，各表通过 BASE 常量定位。
 */
class Tables {
  readonly m: Uint16Array;

  constructor() {
    this.m = new Uint16Array(CTAB_LEN);
    this.m.set(CTAB_ORIG);
  }

  // 以下访问器刻意保持与 C 代码一致的「下标即 offset/2」写法
  t1(i: number): number {
    return this.m[TAB1_BASE + i]!;
  }
  setT1(i: number, v: number): void {
    this.m[TAB1_BASE + i] = v;
  }
  t2(i: number): number {
    return this.m[TAB2_BASE + i]!;
  }
  setT2(i: number, v: number): void {
    this.m[TAB2_BASE + i] = v;
  }
  t3(i: number): number {
    return this.m[TAB3_BASE + i]!;
  }
  setT3(i: number, v: number): void {
    this.m[TAB3_BASE + i] = v;
  }
  t4(i: number): number {
    return this.m[TAB4_BASE + i]!;
  }
}

/**
 * 霍夫曼树频次更新 + 必要时重排节点。
 * @source cfcn_45511b @ 0x0045511b
 */
function updateTree(g: Tables, index: number): void {
  let ebx = g.t4(index);

  for (;;) {
    g.setT1(ebx >> 1, g.t1(ebx >> 1) + 1);
    let ax = g.t1(ebx >> 1);

    if (ax <= g.t1((ebx >> 1) + 1)) {
      ebx = g.t3(ebx >> 1);
      if (ebx !== 0) continue;
      return;
    }

    // 原版：uint16_t *edi = &tab1[ebx/2 + 1]; 向前扫描直到值 != ax-1
    // 随后 _edi = (edi - &tab1[1]) 的**字节**差
    let ediElem = (ebx >> 1) + 1;
    const target = ax - 1;
    for (let k = 0; k < 642; k++) {
      if (g.t1(ediElem) !== target) break;
      ediElem++;
    }
    // _edi 是相对 tab1[1] 的字节偏移，故 _edi/2 === ediElem - 1
    const edi = (ediElem - 1) << 1;

    const tmp = ax;
    ax = g.t1(edi >> 1);
    g.setT1(edi >> 1, tmp);
    g.setT1(ebx >> 1, ax);

    ax = g.t2(ebx >> 1);
    const cx = g.t2(edi >> 1);

    g.setT3(cx >> 1, ebx);
    if (cx < 0x502) g.setT3((cx >> 1) + 1, ebx);

    g.setT3(ax >> 1, edi);
    if (ax < 0x502) g.setT3((ax >> 1) + 1, edi);

    g.setT2(ebx >> 1, cx);
    g.setT2(edi >> 1, ax);

    ebx = g.t3(edi >> 1);
    if (ebx === 0) return;
  }
}

/**
 * 频次整体减半，防止溢出。
 * @source cfcn_004550cc @ 0x004550cc
 */
function halveFrequencies(g: Tables): void {
  for (let i = 0; i < 321; i++) {
    const cx = g.t4(i);
    if ((g.t1(cx >> 1) & 1) !== 0) updateTree(g, i);
  }
  for (let i = 0; i < 641; i++) {
    g.setT1(i, g.t1(i) >>> 1);
  }
}

/** @source cfcn_00455109 @ 0x00455109 */
function afterSymbol(g: Tables, index: number): void {
  if (g.t1(640) === 0x8000) halveFrequencies(g);
  updateTree(g, index);
}

/** 位读取器状态：以**比特**为单位的游标 */
interface BitCursor {
  pos: number;
}

/**
 * 逐位走霍夫曼树，解出一个符号。
 * @source cfcn_004551bb @ 0x004551bb
 */
function decodeSymbol(g: Tables, src: Uint8Array, cur: BitCursor): number {
  let bx = 640;
  let c = cur.pos;

  for (;;) {
    bx = g.t2(bx) >> 1;
    if (bx >= 641) break;
    // 取第 c 位（低位在前）
    if (((src[c >> 3] ?? 0) & (1 << (c & 7))) !== 0) bx++;
    c++;
  }
  cur.pos = c;

  bx -= 641;
  afterSymbol(g, bx);
  return bx;
}

/**
 * 从 bitpos 起读出 32 位（小端，未对齐），再右移 bitpos%8。
 * 原版直接做 `*(uint32_t*)(src + bitpos/8) >> (bitpos%8)`，
 * 会读到缓冲区末尾之外——这在 C 里是"碰巧能跑"，此处显式补零。
 */
function readBits32(src: Uint8Array, bitpos: number): number {
  const byte = bitpos >> 3;
  const v =
    (src[byte] ?? 0) |
    ((src[byte + 1] ?? 0) << 8) |
    ((src[byte + 2] ?? 0) << 16) |
    ((src[byte + 3] ?? 0) << 24);
  return (v >>> (bitpos & 7)) >>> 0;
}

/**
 * 解压一个 mkf 资源块。
 *
 * @param src       压缩数据
 * @param outSize   解压后的大小（来自资源头的 uncompressed_size）
 * @returns         解压后的数据
 *
 * @source mkf_decompress() @ rich4-re/csrc/mkf/mkf_decompress.c:460
 */
export function mkfDecompress(src: Uint8Array, outSize: number): Uint8Array {
  const g = new Tables();
  const out = new Uint8Array(outSize);
  const cur: BitCursor = { pos: 0 };

  let remain = outSize;
  let o = 0;

  while (remain !== 0) {
    const bx = decodeSymbol(g, src, cur);

    // 低 8 位即字面量字节
    if ((bx & 0xff00) === 0) {
      out[o++] = bx & 0xff;
      remain--;
      continue;
    }

    // 回溯复制：先解出距离 dx
    const srcBits = readBits32(src, cur.pos);
    const srcByte = srcBits & 0xff;
    const cl = TABLE_483530[srcByte]!; // 位长，3..8
    const dh = TABLE_483430[srcByte]!; // 高 6 位
    const dl = ((srcBits >>> cl) << 2) & 0xff;
    const dx = (((dh << 8) | dl) >>> 2) & 0xffff;
    cur.pos += cl + 6;

    // 结束标记 @source mkf_decompress.c:499
    if (dx === 0xfff) return out;

    const wanted = bx - 0xfd;
    const emit = wanted <= remain ? wanted : remain;

    // ⚠️ 不能用 copyWithin / memcpy —— 复制源可能落在本次刚写出的字节上
    //    （LZ77 的自重叠复制），必须逐字节顺序拷贝。
    let s = o - 1 - dx;
    for (let i = 0; i < emit; i++) {
      out[o++] = out[s++]!;
    }
    remain -= emit;
  }

  return out;
}
