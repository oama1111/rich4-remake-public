#!/usr/bin/env python3
"""F 类审计（通用版）：某个接口的每个字段，谁在读、谁在写。

判据：把「只出现在 声明 / 新建 / 装载 / 写档 / 测试工厂 / 协议」里的字段列为
**疑似「写了没人读」** —— 库房清单 §四 的 F 类是最隐蔽的一类缺陷，
读实现或跑测试都发现不了，只有机械对照原版的**判据**指令才能发现。

用法：`python3 tools/scratch/audit-state-fields.py [接口名 ...]`
不带参数则审计 `GameState` / `MapObject` / `FacilityInfo` / `LandInfo` / `BlockingDays`。
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "packages"

# 只算「写/装载」侧出现的文件（不算真正的消费者）
WRITERS = (
    "packages/core/src/state/types.ts",
    "packages/core/src/state/actions.ts",
    "packages/core/src/net/protocol.ts",
    "packages/core/src/rules/new-game.ts",
    "packages/core/src/loaders/",
    "packages/core/src/testing/factories.ts",
)

# 每个接口的**字段清单来源**（文件 + 起始行标记）；字段用「行首两空格 + 名字 + :」识别
SOURCES = {
    "GameState": ("packages/core/src/state/types.ts", "export interface GameState {"),
    "MapObject": ("packages/core/src/cards/summon.ts", "export interface MapObject {"),
    "FacilityInfo": ("packages/core/src/loaders/map.ts", "export interface FacilityInfo {"),
    "LandInfo": ("packages/core/src/loaders/map.ts", "export interface LandInfo {"),
    "BlockingDays": ("packages/core/src/state/types.ts", "export interface BlockingDays {"),
}

FIELD = re.compile(r"^  ([a-zA-Z_][a-zA-Z0-9_]*)\??:")


def fields_of(rel: str, marker: str) -> list[str]:
    lines = (ROOT / rel).read_text(encoding="utf-8").split("\n")
    try:
        start = next(i for i, ln in enumerate(lines) if ln.strip() == marker.strip())
    except StopIteration:
        return []
    out: list[str] = []
    depth = 0
    for ln in lines[start:]:
        depth += ln.count("{") - ln.count("}")
        if depth <= 0 and out:
            break
        m = FIELD.match(ln)
        if m:
            out.append(m.group(1))
    return out


def main() -> None:
    wanted = sys.argv[1:] or list(SOURCES)
    for iface in wanted:
        if iface not in SOURCES:
            print(f"未知接口 {iface}")
            continue
        rel, marker = SOURCES[iface]
        names = fields_of(rel, marker)
        print(f"\n===== {iface}（{len(names)} 个字段，来自 {rel}）")
        for f in names:
            out = subprocess.run(
                ["grep", "-rn", "--include=*.ts", rf"\.{f}\b", str(SRC)],
                capture_output=True, text=True,
            ).stdout.splitlines()
            files: dict[str, int] = {}
            for line in out:
                p = line.split(":", 1)[0]
                r = str(Path(p).relative_to(ROOT))
                if ".test." in r or "/dist/" in r:
                    continue
                files[r] = files.get(r, 0) + 1
            consumers = {
                k: v for k, v in files.items()
                if not any(k == w or k.startswith(w) for w in WRITERS)
            }
            if not consumers:
                print(f"  ⚠️ {f:24s} 非写侧引用：（无）")
            elif len(consumers) == 1:
                print(f"     {f:24s} 只有 {list(consumers)[0]}")


if __name__ == "__main__":
    main()
