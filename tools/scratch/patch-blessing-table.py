#!/usr/bin/env python3
"""第 37 条：命运事件表的 `blessing` 字段按 exe 补齐/订正。

exe 侧的真相（两条独立提取）：
  · 直接调用 `0x44b896` 的 15 个事件函数（`tools/scratch/blessing_callers.py`）；
  · **跳进两条共享尾**的事件（`0x44d172` = penalty 尾 `push 1/push 0`、
    `0x44d2a9` = reward 尾 `push 0/push 0`）。
两者合起来 = **28 个**事件带加持；表里原只有 16 个，且 19/22 两个记错、20 等 12 个漏记。
"""
import re
from pathlib import Path

P = Path(__file__).resolve().parents[2] / "packages/data/src/event-table.ts"

# 命运表（va 在 0x44cxxx/0x44dxxx）的最终 blessing 值；None = 不加字段
WANT = {
    2: 'penalty', 3: 'penalty',
    6: 'misfortune', 7: 'misfortune',
    8: 'penalty', 9: 'penalty',
    10: 'misfortune', 11: 'misfortune', 12: 'misfortune',
    14: 'penalty', 15: 'penalty',
    16: None,           # ★ 原版**没接**（既无直接调用也不跳共享尾）
    17: 'penalty',
    18: 'penalty',      # 新增：跳 0x44d172
    19: 'penalty',      # 订正：原写 reward，实跳 penalty 尾
    20: 'reward',       # 新增：自身就落在 reward 尾
    21: 'reward',       # 新增：跳 0x44d2a9
    22: 'reward',       # 订正：原写 misfortune，实跳 reward 尾
    23: 'penalty', 24: 'penalty',
    25: 'reward',
    26: 'penalty',
    27: 'reward', 28: 'reward', 29: 'reward',
    30: 'penalty',
    31: 'reward',
    32: 'misfortune', 33: 'misfortune',
}

src = P.read_text(encoding="utf-8")
lines = src.split("\n")
out = []
changed = []
for ln in lines:
    m = re.match(r"^(\s*\{ id: (\d+), va: (0x0044[cd][0-9a-f]+),.*?)(\s*\},)\s*$", ln)
    if not m:
        out.append(ln)
        continue
    eid = int(m.group(2))
    body = m.group(1)
    # 去掉已有的 blessing 字段
    body2 = re.sub(r",\s*blessing: '\w+'", "", body)
    want = WANT.get(eid)
    before = "blessing" in body
    if want is not None:
        body2 = body2 + f", blessing: '{want}'"
    if before or want is not None:
        changed.append((eid, want))
    out.append(body2 + m.group(4))
src2 = "\n".join(out)
P.write_text(src2, encoding="utf-8")
print(f"命运表已更新的条目数：{len(changed)}")
for eid, want in changed:
    print(f"  id={eid:>2} → {want}")
