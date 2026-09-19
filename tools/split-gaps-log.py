#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
W-20：把 docs/gaps/README.md 拆成「索引 + 分条文件」。

背景：README 一度近 9,000 行、章节号乱序，读它要滚很久。拆法固定：

  · 每个 `### 7.N …` 小节（N >= 6）**原样**搬到 `docs/gaps/log/7.N.md`；
  · README 只留「一～六节 + §四之二 + §7.1–7.5 续做指南 + 一张索引表」；
  · **小节编号一个字都不许改**（代码注释里有上百处 `§7.78(1)` 这样的引用，
    靠编号定位文件，改了编号引用就断了）。

无损校验（写进本脚本，不通过就退出码 1）：
  拆分前后「所有非空行的多重集合」必须相等 —— 唯一允许新增的是索引表本身
  （用 `<!-- gaps-index:start/end -->` 圈出来的那一段）。

用法：
  python3 tools/split-gaps-log.py                 # 执行拆分 + 当场无损校验
  python3 tools/split-gaps-log.py --verify FILE   # 拿拆分前的备份再校验一次（事后可复现）
  python3 tools/split-gaps-log.py --check         # 只做结构自检（索引/文件/编号一一对应）

例（事后复现无损校验）：
  git show <拆分前的提交>:docs/gaps/README.md > /tmp/gaps-before.md
  python3 tools/split-gaps-log.py --verify /tmp/gaps-before.md
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_README = REPO / "docs" / "gaps" / "README.md"
DEFAULT_LOGDIR = REPO / "docs" / "gaps" / "log"

HEADING = re.compile(r"^### 7\.(\d+)(?:\s|$)")
INDEX_START = "<!-- gaps-index:start -->"
INDEX_END = "<!-- gaps-index:end -->"
# §7.1–7.5 是「续做指南」，留在 README 里，不拆
KEEP_MAX = 5


class Section:
    def __init__(self, num: int, start: int, end: int, title: str) -> None:
        self.num = num
        self.start = start  # 含
        self.end = end      # 不含
        self.title = title


def read_lines(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").split("\n")


def find_sections(lines: list[str]) -> list[Section]:
    heads: list[tuple[int, int, str]] = []
    for i, line in enumerate(lines):
        m = HEADING.match(line)
        if m:
            title = line[len("### ") :]
            heads.append((int(m.group(1)), i, title))
    out: list[Section] = []
    for idx, (num, start, title) in enumerate(heads):
        end = heads[idx + 1][1] if idx + 1 < len(heads) else len(lines)
        out.append(Section(num, start, end, title))
    return out


def index_block(sections: list[Section]) -> str:
    rows = [
        "| 编号 | 标题 | 文件 |",
        "|---|---|---|",
    ]
    for s in sorted(sections, key=lambda s: s.num):
        # 标题去掉开头的 `7.N `（编号单独一列，标题里再写一遍是冗余）
        title = re.sub(rf"^7\.{s.num}\s*", "", s.title).replace("|", "\\|")
        rows.append(f"| 7.{s.num} | {title} | [log/7.{s.num}.md](log/7.{s.num}.md) |")
    body = [
        INDEX_START,
        "### 阶段 3 修复日志索引（按编号升序）",
        "",
        *rows,
        "",
        "> §7.1–7.5（续做指南）仍在本文末尾的「七、★ 续做指南」里，**没有**拆出去。",
        "> 逐条日志正文在 `docs/gaps/log/7.<编号>.md`；小节编号与拆分前完全一致，",
        "> 代码注释里的 `§7.78(1)` 这类引用照编号到同名文件即可。",
        "> **W-20 之后的新日志不要再往本文件追加**，写 `docs/gaps/log/7.<编号>-<slug>.md`",
        "> （WORKPLAN 规则 9）。",
        INDEX_END,
    ]
    return "\n".join(body)


def strip_index(lines: list[str]) -> list[str]:
    """去掉索引块（含两个标记行）；按第一个 INDEX_START..INDEX_END 截。"""
    try:
        start = lines.index(INDEX_START)
        end = lines.index(INDEX_END)
    except ValueError:
        return list(lines)
    return lines[:start] + lines[end + 1 :]


def nonempty_counter(lines: list[str]) -> Counter:
    return Counter(line for line in lines if line.strip() != "")


def section_lines(lines: list[str], s: Section) -> list[str]:
    return lines[s.start : s.end]


def build_document(lines: list[str], sections: list[Section], index: str) -> list[str]:
    """跳过所有待拆小节，在第一处的位置插入索引块。"""
    ranges = [(s.start, s.end) for s in sections]
    out: list[str] = []
    i = 0
    inserted = False
    while i < len(lines):
        hit = next((r for r in ranges if r[0] == i), None)
        if hit is not None:
            if not inserted:
                out.extend(index.split("\n"))
                inserted = True
            i = hit[1]
            continue
        out.append(lines[i])
        i += 1
    if not inserted:
        out.extend(index.split("\n"))
    return out


def log_counter(logdir: Path, nums: list[int]) -> tuple[Counter, list[str]]:
    counter: Counter = Counter()
    problems: list[str] = []
    for n in nums:
        path = logdir / f"7.{n}.md"
        if not path.exists():
            problems.append(f"缺文件：{path}")
            continue
        counter.update(nonempty_counter(read_lines(path)))
    return counter, problems


def do_split(readme: Path, logdir: Path) -> int:
    lines = read_lines(readme)
    sections = find_sections(lines)
    todo = [s for s in sections if s.num > KEEP_MAX]
    if not todo:
        print("README 里已经没有可拆的 `### 7.N`（N>=6）小节了。")
        print("用 --check 做结构自检，或 --verify <拆分前备份> 复现无损校验。")
        return 1

    kept = [s for s in sections if s.num <= KEEP_MAX]
    # 待拆小节必须连成一片（不然 partB 的构造就复杂了；这里直接拒绝）
    spans = sorted((s.start, s.end) for s in todo)
    for (a_start, a_end), (b_start, _) in zip(spans, spans[1:]):
        if b_start < a_end:
            print(f"待拆小节重叠：{a_start}..{a_end} 与 {b_start}", file=sys.stderr)
            return 1
    if kept:
        first_todo = min(s.start for s in todo)
        for s in kept:
            if s.start < first_todo:
                print(f"§7.{s.num} 夹在待拆小节之前，脚本不支持这种排布", file=sys.stderr)
                return 1

    index = index_block(todo)
    new_lines = build_document(lines, todo, index)

    logdir.mkdir(parents=True, exist_ok=True)
    for s in todo:
        (logdir / f"7.{s.num}.md").write_text(section_text(lines, s), encoding="utf-8")

    readme.write_text("\n".join(new_lines), encoding="utf-8")

    # ── 无损校验：拆分前的非空行多重集合 == 新 README（去掉索引）+ 所有分条文件 ──
    before = nonempty_counter(lines)
    after = nonempty_counter(strip_index(new_lines))
    after_logs, problems = log_counter(logdir, [s.num for s in todo])
    after_total = after + after_logs
    if problems:
        for p in problems:
            print(p, file=sys.stderr)
        return 1
    if after_total != before:
        missing = before - after_total
        extra = after_total - before
        print("★ 无损校验**不通过**：", file=sys.stderr)
        for line, count in list(missing.items())[:10]:
            print(f"  少了 {count} 处：{line[:100]}", file=sys.stderr)
        for line, count in list(extra.items())[:10]:
            print(f"  多了 {count} 处：{line[:100]}", file=sys.stderr)
        return 1

    print(f"拆出 {len(todo)} 个小节 → {logdir}")
    print(
        f"README {len(lines)} 行 → {len(new_lines)} 行；"
        f"非空行 {sum(before.values())} 行，拆分后 README+日志合计 {sum(after_total.values())} 行"
    )
    print("★ 无损校验通过：拆分前后非空行多重集合完全相等（新增的只有索引块）。")
    return 0


def section_text(lines: list[str], s: Section) -> str:
    return "\n".join(section_lines(lines, s)).rstrip("\n") + "\n"


def do_verify(readme: Path, logdir: Path, original: Path) -> int:
    before = nonempty_counter(read_lines(original))
    if not readme.exists():
        print(f"缺 README：{readme}", file=sys.stderr)
        return 1
    current = read_lines(readme)
    after = nonempty_counter(strip_index(current))
    sections = [s for s in find_sections(read_lines(original)) if s.num > KEEP_MAX]
    nums = [s.num for s in sections]
    after_logs, problems = log_counter(logdir, nums)
    if problems:
        for p in problems:
            print(p, file=sys.stderr)
        return 1
    after_total = after + after_logs
    if after_total != before:
        print("★ 无损校验**不通过**（README + 日志 ≠ 拆分前的原文）", file=sys.stderr)
        for line, count in list((before - after_total).items())[:10]:
            print(f"  少了 {count} 处：{line[:100]}", file=sys.stderr)
        for line, count in list((after_total - before).items())[:10]:
            print(f"  多了 {count} 处：{line[:100]}", file=sys.stderr)
        return 1
    print(f"★ 无损校验通过：{original} 的 {sum(before.values())} 行非空内容")
    print(f"  == 当前 README（去索引）{sum(after.values())} 行 + {len(nums)} 个分条文件 {sum(after_logs.values())} 行")
    return 0


def do_check(readme: Path, logdir: Path) -> int:
    problems: list[str] = []
    current = read_lines(readme)
    sections = find_sections(current)
    leftover = [s.num for s in sections if s.num > KEEP_MAX]
    if leftover:
        problems.append(f"README 里还剩没拆的小节：{leftover}")
    if INDEX_START not in current or INDEX_END not in current:
        problems.append("README 里没有索引块标记（<!-- gaps-index:start/end -->）")

    files = sorted(logdir.glob("7.*.md"))
    nums: list[int] = []
    for f in files:
        m = re.fullmatch(r"7\.(\d+)(?:-[^/]*)?\.md", f.name)
        if not m:
            problems.append(f"文件名不合规：{f.name}")
            continue
        n = int(m.group(1))
        nums.append(n)
        first = next((l for l in read_lines(f) if l.strip() != ""), "")
        if not HEADING.match(first) or not first.startswith(f"### 7.{n}"):
            problems.append(f"{f.name} 的首个非空行不是它自己的 `### 7.{n}` 标题：{first[:60]}")

    # 索引块里每行链接都要有对应文件、且不多不少
    block: list[str] = []
    inside = False
    for line in current:
        if line == INDEX_START:
            inside = True
            continue
        if line == INDEX_END:
            inside = False
            continue
        if inside:
            block.append(line)
    linked = sorted(int(m.group(1)) for m in (re.search(r"\(log/7\.(\d+)[^)]*\.md\)", l) for l in block) if m)
    if linked != sorted(nums):
        problems.append(f"索引链接与日志文件不一致：索引 {len(linked)} 条 / 文件 {len(nums)} 个")
    if linked != sorted(linked):
        problems.append("索引表不是按编号升序")

    if problems:
        for p in problems:
            print(f"★ {p}", file=sys.stderr)
        return 1
    print(f"★ 结构自检通过：README 无残留小节；索引 {len(linked)} 条 ↔ 日志 {len(nums)} 个，编号一一对应且升序。")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="拆分 docs/gaps/README.md（W-20）")
    ap.add_argument("--readme", type=Path, default=DEFAULT_README)
    ap.add_argument("--logdir", type=Path, default=DEFAULT_LOGDIR)
    ap.add_argument("--verify", type=Path, metavar="ORIGINAL", help="拿拆分前的备份复现无损校验")
    ap.add_argument("--check", action="store_true", help="只做结构自检")
    args = ap.parse_args()

    if args.verify is not None:
        return do_verify(args.readme, args.logdir, args.verify)
    if args.check:
        return do_check(args.readme, args.logdir)
    return do_split(args.readme, args.logdir)


if __name__ == "__main__":
    sys.exit(main())
