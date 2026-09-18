#!/usr/bin/env python3
"""F 类审计：`GameState.Player` 的每个字段，谁在读、谁在写。

判据：把「只出现在 装载/新建/写档/工厂」里的字段列为**疑似写了没人读**。
原版那边「状态写了但没人读」是最隐蔽的一类缺陷（库房清单 §四 的 F 类）。
"""
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "packages"

FIELDS = """index character whoPlays xpos ypos nodeId lastNodeId direction trafficMethod
ndices isMale aiFlags cashRatio loanRatio stockRatio personality cash moneyInBank loan
specialFinance loanDueDate points blocking daysRejectedByBank bankFreezeDays godInfo
cards tools totalWinterSleepDays alliedPlayer alliedDays insuranceDays savedTrafficMethod
savedNdices misfortune fortune luck hostility monthlyPaid monthlyReceived""".split()

# 只算「写/装载」侧出现的文件（不算真正的消费者）
WRITERS = {
    "packages/core/src/state/types.ts",          # 声明
    "packages/core/src/rules/new-game.ts",       # 新局
    "packages/core/src/loaders/save.ts",         # 解析
    "packages/core/src/loaders/savegame.ts",     # 导入
    "packages/core/src/loaders/save-writer.ts",  # 写出
    "packages/core/src/testing/factories.ts",    # 测试工厂
    "packages/core/src/state/reduce.ts",         # 需要人工看：reduce 可能只是搬运
}

for f in FIELDS:
    out = subprocess.run(
        ["grep", "-rn", "--include=*.ts", rf"\.{f}\b", str(SRC)],
        capture_output=True, text=True,
    ).stdout.splitlines()
    files = {}
    for line in out:
        p = line.split(":", 1)[0]
        rel = str(Path(p).relative_to(ROOT))
        if ".test." in rel or "/dist/" in rel:
            continue
        files.setdefault(rel, 0)
        files[rel] += 1
    consumers = {k: v for k, v in files.items() if k not in WRITERS}
    tag = "⚠️ 疑似「写了没人读」" if not consumers else ""
    print(f"{f:20s} 非写侧引用文件: {sorted(consumers) or '（无）'}  {tag}")
