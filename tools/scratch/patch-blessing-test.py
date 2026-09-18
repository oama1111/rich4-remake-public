#!/usr/bin/env python3
"""第 37 条：追加「命运事件 blessing 表 ↔ exe 调用点参数」的逐项校验。"""
from pathlib import Path

P = Path(__file__).resolve().parents[2] / "packages/data/src/event-table.test.ts"

BLOCK = r'''
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
    expect(exe[o - 5], `0x${callVa.toString(16)} 前第 4 字节应为 push 操作码`).toBe(0x6a);
    expect(exe[o - 3], `0x${callVa.toString(16)} 前第 2 字节应为 push 操作码`).toBe(0x6a);
    const arg1 = exe[o - 4]!;
    const arg0 = exe[o - 2]!;
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
'''

src = P.read_text(encoding="utf-8").rstrip("\n") + "\n" + BLOCK
P.write_text(src, encoding="utf-8")
print("已追加；行数 =", len(src.split(chr(10))))
