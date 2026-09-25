#!/usr/bin/env python3
"""
AI 可见节点表的次序 —— 用 Unicorn 测试台**实跑原版 `0x409ef9`** 取证
（`docs/audit/provenance-ai-move.md` 的 V-1a / F-2；复刻侧 `packages/core/src/ai/tool-policy.ts`
的 `screenScanOrder`）

`0x409ef9` 把画面内节点按视角档位 `[0x499088]` 投影到一张 440×440 的 word 格表
（`0x5e880` 字节，`[0x474938]` 指向它），`0x40a050` 再**行优先**扫出（先屏幕 Y 后屏幕 X）。
四个 AI 判定函数（路障阶段二 `0x4212b5` / 地雷 `0x4213e8` / 定時炸彈 `0x421597` /
傳送機 `0x421cc1`）就按这个次序枚举，并列取先到者。

## 跑法

```sh
cd rich4-spec && .venv/bin/python <这个文件> [--cases 20]
```

需要 `rich4-spec/.venv`（unicorn）。真值即本脚本打印的 `order=[…]`。

## 两个坑（都踩过，别重踩）

1. `emulate.MAX_INSN` 默认 40 万条 **不够**：`0x409ef9` 单次约 211 万条。而 `Emu._hook` 比的是
   **模块常量** `MAX_INSN`，不是 `call()` 的 `timeout_insns` —— 只传后者会半途停、返回垃圾计数。
   故这里直接改模块常量。
2. `0x409ef9` 收尾会 `push 1 / call 0x409b18` 重建精灵拾取图（远超仿真预算）。测试对象是
   **节点表**，故把 `0x409b18` 打桩成 `ret`。

## 注入（`setup` 里做，写在 `call()` 外会被 `reset()` 抹掉）

| 全局 | 含义 |
|---|---|
| `[0x48b2ac]` / `[0x48b2b0]` | 镜头像素坐标（原版是相机；本引擎按 D-005 取「我脚下那格」） |
| `[0x498e80]` / `[0x498e9c]` | 节点表指针 / 节点数（`node[i]` 在 base + i×0x28，1 基） |
| `node + 0x00` / `+0x02` | 节点 x / y（int16） |
| `node + 0x24` | 运行时占用位（`0x100 << actor`）；`0x409f7c` 查 `& 0xffff00` 非 0 即跳过 |
| `[0x499088]` | 视角档位 0..7 |
| `[0x474938]` | 440×440 格表指针（本脚本另 map 一块给它） |
| `0x48b8c4` | 输出：收集到的节点 id（word），`eax` = 项数 |
"""
import argparse
import os
import random
import struct
import sys

SPEC = os.environ.get("RICH4_SPEC") or os.path.join(
    os.environ.get("RICH4_WORKSPACE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..")),
    "rich4-spec",
)
if not os.path.isdir(os.path.join(SPEC, "tools")):
    sys.exit(f"找不到 rich4-spec（{SPEC}）；请设 RICH4_SPEC 或 RICH4_WORKSPACE")
sys.path.insert(0, os.path.join(SPEC, "tools"))
import emulate  # noqa: E402
from emulate import Emu, SCRATCH_BASE  # noqa: E402

TARGET = 0x409EF9
SPRITE_PICK = 0x409B18  # 精灵拾取图重建 → ret 桩
GRID_PTR = 0x474938
GRID_BYTES = 0x5E880
GRID_BASE = 0x700000  # 另 map 一块：SCRATCH 只有 64KB
NODE_TABLE_PTR = 0x498E80
NODE_COUNT = 0x498E9C
NODE_STRIDE = 0x28
CAM_X, CAM_Y = 0x48B2AC, 0x48B2B0
VIEW = 0x499088
VIS_TABLE = 0x48B8C4

INSNS = 20_000_000
emulate.MAX_INSN = INSNS

# 构造盘面（与 `packages/core/src/ai/tool-policy.test.ts` 的 `screenScanOrder` 那组同一条）
CASES = [
    ("x 递增行（视角 0 反序）", [(0, 0), (10, 0), (20, 0), (30, 0)], (0, 0), 0, {}),
    ("x 递增行（视角 4 正序）", [(0, 0), (10, 0), (20, 0), (30, 0)], (0, 0), 4, {}),
    ("同一像素两个节点（后写覆盖）", [(320, 320), (300, 300), (300, 300)], (320, 320), 0, {}),
    ("29×29 块窗口外不收", [(0, 0), (15 * 32, 0)], (0, 0), 0, {}),
    ("地雷那条线（我被占）", [(10, 0), (20, 0), (30, 0)], (30, 0), 0, {3: 0x100}),
    ("傳送機并列（node1 被占）", [(320, 320), (256, 320), (384, 320)], (320, 320), 0, {1: 0x100}),
    ("并列随视角翻转 v0", [(320, 320), (256, 320), (384, 320)], (320, 320), 0, {}),
    ("并列随视角翻转 v1", [(320, 320), (256, 320), (384, 320)], (320, 320), 1, {}),
    ("并列随视角翻转 v2", [(320, 320), (256, 320), (384, 320)], (320, 320), 2, {}),
    ("并列随视角翻转 v3", [(320, 320), (256, 320), (384, 320)], (320, 320), 3, {}),
    ("并列随视角翻转 v4", [(320, 320), (256, 320), (384, 320)], (320, 320), 4, {}),
    ("并列随视角翻转 v5", [(320, 320), (256, 320), (384, 320)], (320, 320), 5, {}),
    ("并列随视角翻转 v6", [(320, 320), (256, 320), (384, 320)], (320, 320), 6, {}),
    ("并列随视角翻转 v7", [(320, 320), (256, 320), (384, 320)], (320, 320), 7, {}),
]


def run_case(e: Emu, nodes, cam, view, occ=None):
    """nodes: [(x, y)]（节点 id = 下标+1）；occ: {id: node+0x24 运行位}"""
    occ = {int(k): v for k, v in (occ or {}).items()}
    n = len(nodes)

    def setup(emu):
        emu.write32(GRID_PTR, GRID_BASE)
        buf = bytearray(NODE_STRIDE * (n + 1))
        for i, (x, y) in enumerate(nodes, start=1):
            off = i * NODE_STRIDE
            struct.pack_into("<hh", buf, off, x, y)
            struct.pack_into("<I", buf, off + 0x24, occ.get(i, 0))
        emu.scratch_write(SCRATCH_BASE, bytes(buf))
        emu.write32(NODE_TABLE_PTR, SCRATCH_BASE)
        emu.write32(NODE_COUNT, n)
        emu.write32(CAM_X, cam[0])
        emu.write32(CAM_Y, cam[1])
        emu.write32(VIEW, view)

    r = e.call(TARGET, [], setup=setup, timeout_insns=INSNS)
    cnt = r["eax"]
    raw = e.read(VIS_TABLE, cnt * 2)
    return list(struct.unpack("<%dH" % cnt, raw)), r["insns"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", type=int, default=0, help="额外跑 N 组随机盘面 × 8 视角")
    ap.add_argument("--seed", type=int, default=20260925)
    args = ap.parse_args()

    e = Emu()
    e.mu.mem_map(GRID_BASE, 0x80000)
    e.patch(SPRITE_PICK, b"\xC3")
    for name, nodes, cam, view, occ in CASES:
        order, insns = run_case(e, nodes, cam, view, occ)
        print(f"{name:<28} view={view} cam={cam} occ={occ or '-'} -> {order}  ({insns} insns)")

    if args.cases > 0:
        rnd = random.Random(args.seed)
        for t in range(args.cases):
            k = rnd.randint(1, 14)
            cam = (rnd.randrange(0, 40) * 32 + rnd.randrange(0, 32), rnd.randrange(0, 40) * 32 + rnd.randrange(0, 32))
            nodes = []
            for _ in range(k):
                span = 260 if rnd.random() < 0.7 else 500
                x = max(0, min(1280, cam[0] + rnd.randint(-span, span)))
                y = max(0, min(1280, cam[1] + rnd.randint(-span, span)))
                nodes.append((x, y))
            if rnd.random() < 0.25 and len(nodes) > 1:
                nodes.append(nodes[0])
            for v in range(8):
                order, _ = run_case(e, nodes, cam, v)
                print(f"r{t} v{v} cam={cam} nodes={nodes} -> {order}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
