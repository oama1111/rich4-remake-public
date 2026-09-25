/*
 * 原版 C 库的 `qsort` —— Watcom clib 那一份（VA 0x00457e6c）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么要逐条移植：Watcom 的 `qsort` **不稳定**，同键元素谁先谁后由算法本身决定。
 *   电脑的两处决策直接吃这个次序：
 *   - 炒股的十二支排名（`0x0042c64e call 0x457e6c`，比较器 `0x42bed0`，4 字节元素）——
 *     同分的股票谁排前面，决定 `rand()%24 <= 12 − i` 的门槛落在谁头上；
 *   - 电脑逛百貨公司的买卡候选（`0x0042f0e4 call 0x457e6c`，比较器 `0x42d0ef`，1 字节元素）——
 *     同价的卡谁先买，决定预算花在哪张卡上。
 *   先前两处都用「同键按下标升序」当替身（D-006），与原版次序不同。
 *
 * ## 算法（逐条 @source）
 *
 * ```
 * 00457e87  swaptype = ((base | size) & 3) ? 2 : (size > 4)      ; 0 ⇒ 4 字节整块交换、枢轴**拷贝**到临时格
 * 00457eb8  loop:  if (n <= 1) goto pop
 * 00457ec2         if (n < 16) {                                  ; ── 小段：两趟「隔 gap 插入」──
 * 00457ecc           for (gap = 3; gap > 0; gap -= 2)            ; 0x457ea2 `imul size,3` / 0x457f41 `sub gap, 2·size`
 * 00457ee3             for (p = gap; p < n; p += gap)            ; ★ 外层步长也是 gap（第一趟只排 0,3,6,9… 那一条链）
 * 00457f1a               for (q = p; q > 0 && cmp(a[q−gap], a[q]) > 0; q −= gap) swap(q, q−gap)
 * 00457f4b           goto pop }
 * 00457f76         m = n>>1
 * 00457f84         if (n > 29) { lo = 0; hi = n−1
 * 00457f9e           if (n > 42) { d = n>>3; lo = med3(0,d,2d); m = med3(m−d,m,m+d); hi = med3(hi−2d,hi−d,hi) }
 * 00458006           m = med3(lo, m, hi) }
 * 00458010         swaptype != 0 ? swap(0, m)、枢轴 = a[0] : 枢轴 = a[m] 的拷贝
 * 00458042         pa = pb = 0; pc = pd = n−1; r = n
 * 00458064         for (;;) {                                     ; Bentley–McIlroy 三路划分
 *                    while (r && (c = cmp(a[pb], 枢轴)) <= 0) { if (c == 0) swap(pa++, pb); pb++; r-- }
 * 004580b7           while (r && (c = cmp(a[pc], 枢轴)) >= 0) { if (c == 0) swap(pc, pd--); pc--; r-- }
 * 0045810a           if (!r) break; swap(pb++, pc); if (!--r) break; r--; pc-- }
 * 00458150         s = min(pa, pb−pa); vecswap(0, pb−s, s)
 * 004581a2         s = min(pd−pc, n−1−pd); vecswap(pb, n−s, s)
 * 004581e8         L = pb−pa; R = pd−pc
 * 004581ff         if (R >= L) { push(n−R, R); n = L }            ; 大段压栈、先做小段（左段 base 不变）
 * 00458221         else { if (L <= 1) goto pop; push(0, L); base += n−R; n = R }
 * 00457f4d  pop:   栈空就返回；否则弹出 (base, n) 回 loop
 * ```
 *
 * `med3`（VA 0x00457ddc）：`cmp(a,b) > 0 ? (cmp(a,c) > 0 ? (cmp(b,c) > 0 ? b : c) : a)
 *                                        : (cmp(a,c) >= 0 ? a : (cmp(b,c) > 0 ? c : b))`。
 *
 * 纯函数：只重排拷贝，不改入参。比较器必须返回有符号数（原版只看符号）。
 */

/**
 * 按原版 Watcom `qsort` 的次序排序。
 *
 * @param pivotInPlace 原版 `swaptype != 0`（元素不是 4 字节对齐的整 dword）时枢轴**换到段首**参与划分；
 *   `swaptype == 0`（4 字节元素、基址对齐）时枢轴只**拷贝**到临时格、原位不动。
 *   ——炒股那张表是 4 字节元素（`false`），买卡候选是 1 字节元素（`true`）。
 *   只在 n ≥ 16 的划分段里有差别。
 */
export function watcomQsort<T>(
  input: readonly T[],
  cmp: (a: T, b: T) => number,
  pivotInPlace: boolean,
): T[] {
  const a = [...input];
  const swap = (i: number, j: number): void => {
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  };
  const vecswap = (i: number, j: number, n: number): void => {
    for (let k = 0; k < n; k++) swap(i + k, j + k);
  };
  const med3 = (x: number, y: number, z: number): number => {
    if (cmp(a[x]!, a[y]!) > 0) {
      if (cmp(a[x]!, a[z]!) > 0) return cmp(a[y]!, a[z]!) > 0 ? y : z;
      return x;
    }
    if (cmp(a[x]!, a[z]!) >= 0) return x;
    return cmp(a[y]!, a[z]!) > 0 ? z : y;
  };

  const stack: { base: number; n: number }[] = [];
  let base = 0;
  let n = a.length;
  for (;;) {
    if (n > 1 && n < 16) {
      for (let gap = 3; gap > 0; gap -= 2) {
        for (let p = base + gap; p < base + n; p += gap) {
          for (let q = p; q > base; q -= gap) {
            if (cmp(a[q - gap]!, a[q]!) > 0) swap(q, q - gap);
            else break;
          }
        }
      }
    } else if (n >= 16) {
      let m = base + (n >> 1);
      if (n > 29) {
        let lo = base;
        let hi = base + n - 1;
        if (n > 42) {
          const d = n >> 3;
          lo = med3(base, base + d, base + 2 * d);
          m = med3(m - d, m, m + d);
          hi = med3(hi - 2 * d, hi - d, hi);
        }
        m = med3(lo, m, hi);
      }
      let pivot: T;
      if (pivotInPlace) {
        swap(base, m);
        pivot = a[base]!;
      } else {
        pivot = a[m]!;
      }
      let pa = base;
      let pb = base;
      let pc = base + n - 1;
      let pd = pc;
      let r = n;
      for (;;) {
        while (r !== 0) {
          const c = cmp(a[pb]!, pivot);
          if (c > 0) break;
          if (c === 0) swap(pa++, pb);
          pb++;
          r--;
        }
        while (r !== 0) {
          const c = cmp(a[pc]!, pivot);
          if (c < 0) break;
          if (c === 0) swap(pc, pd--);
          pc--;
          r--;
        }
        if (r === 0) break;
        swap(pb++, pc);
        if (--r === 0) break;
        r--;
        pc--;
      }
      const end = base + n;
      let s = Math.min(pa - base, pb - pa);
      vecswap(base, pb - s, s);
      s = Math.min(pd - pc, end - pd - 1);
      vecswap(pb, end - s, s);
      const left = pb - pa;
      const right = pd - pc;
      if (right >= left) {
        stack.push({ base: end - right, n: right });
        n = left;
        continue;
      }
      if (left > 1) {
        stack.push({ base, n: left });
        base = end - right;
        n = right;
        continue;
      }
    }
    const top = stack.pop();
    if (top === undefined) return a;
    base = top.base;
    n = top.n;
  }
}
