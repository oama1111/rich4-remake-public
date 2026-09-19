#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
W-21：偏离登记表索引 —— 扫 `docs/known-deviations.md` + `docs/deviations/*.md`，
抽出所有 `Q-*` / `D-*` 条目的**标题行**，生成 `docs/deviations/INDEX.md`。

★ 状态**只按标题行里的标记**判，绝不读正文猜：

    | 状态 | 判据（都在标题行里） |
    |---|---|
    | 未决 | 含「未决」 |
    | 有意偏离 | 含「有意」 |
    | 结案 | 有删除线 `~~…~~`、或 `✅`、或「已结案」 |
    | ? | 以上都没有 —— **不猜**，列出来交给首席裁定 |

一个 ID 只出一行：取**首次出现**的位置（扫描顺序 = known-deviations.md 在前，
其后 deviations/*.md 按文件名字典序），同 ID 的其余位置在「位置」列里记成「另有 N 处」。
状态只看这**首次出现**的那一行标题。

用法：
  python3 tools/index-deviations.py            # 生成 INDEX.md
  python3 tools/index-deviations.py --check    # 不写文件，只校验 INDEX.md 是否是最新的
  python3 tools/index-deviations.py --list-open  # 只打印「未决 + ?」清单（贴 PR 用）
"""

from __future__ import annotations

import argparse
import difflib
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
KNOWN = REPO / "docs" / "known-deviations.md"
DEVDIR = REPO / "docs" / "deviations"
INDEX = DEVDIR / "INDEX.md"

ID = re.compile(r"\b([QD]-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b")

STATUS_CLOSED = "结案"
STATUS_INTENTIONAL = "有意偏离"
STATUS_OPEN = "未决"
STATUS_UNKNOWN = "?"


class Entry:
    def __init__(self, ident: str, title: str, heading: str, line_no: int, path: Path, location: str) -> None:
        self.id = ident
        self.title = title
        # ★ 原始标题行：状态只看它（`clean_title` 会把 `~~` 这些标记抹掉）
        self.heading = heading
        self.line_no = line_no
        self.path = path
        self.location = location
        self.extra: list[str] = []


def status_of(heading: str) -> str:
    if "未决" in heading:
        return STATUS_OPEN
    if "有意" in heading:
        return STATUS_INTENTIONAL
    if "~~" in heading or "✅" in heading or "已结案" in heading:
        return STATUS_CLOSED
    return STATUS_UNKNOWN


def clean_title(heading: str) -> str:
    """标题行去掉 `#`、去掉 ID 本身（ID 单独一列）、去掉删除线记号；保留其余原文。"""
    t = heading.lstrip("#").strip()
    t = t.replace("~~", "")
    t = ID.sub("", t)
    t = re.sub(r"^[\s★☆·、:：/]+", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def scan() -> tuple[dict[str, Entry], list[tuple[str, str, int]]]:
    files = [KNOWN] + sorted(p for p in DEVDIR.glob("*.md") if p.name != "INDEX.md")
    entries: dict[str, Entry] = {}
    body_only: dict[str, tuple[str, int]] = {}
    heading_ids: set[str] = set()
    all_ids: set[str] = set()

    for path in files:
        if not path.exists():
            continue
        rel = path.relative_to(REPO).as_posix()
        for line_no, line in enumerate(path.read_text(encoding="utf-8").split("\n"), 1):
            found = ID.findall(line)
            if not found:
                continue
            all_ids.update(found)
            if line.startswith("#"):
                heading_ids.update(found)
                for ident in found:
                    if ident in entries:
                        entries[ident].extra.append(f"{rel}:{line_no}")
                        continue
                    entries[ident] = Entry(
                        ident=ident,
                        title=clean_title(line),
                        heading=line,
                        line_no=line_no,
                        path=path,
                        location=f"{rel}:{line_no}",
                    )
            else:
                for ident in found:
                    body_only.setdefault(ident, (rel, line_no))
    # 只在正文出现、且不是别的编号前缀、也不是分片文件名 → 附在索引末尾（不判状态）
    stems = {p.stem for p in DEVDIR.glob("*.md")}
    strays = [
        (ident, loc) for ident, loc in sorted(body_only.items())
        if ident not in heading_ids and ident not in stems
        and not any(other != ident and other.startswith(ident + "-") for other in all_ids)
    ]
    return entries, strays


def sort_key(ident: str) -> tuple:
    m = re.match(r"^([QD])-(\d+)$", ident)
    if m:
        return (0, m.group(1), int(m.group(2)), ident)
    return (1, ident)


def render(entries: dict[str, Entry], strays: list[tuple[str, str, int]]) -> str:
    rows = sorted(entries.values(), key=lambda e: sort_key(e.id))
    counts = {STATUS_CLOSED: 0, STATUS_INTENTIONAL: 0, STATUS_OPEN: 0, STATUS_UNKNOWN: 0}
    for e in rows:
        counts[status_of(e.heading)] += 1

    out: list[str] = []
    out.append("# 偏离登记表索引（`Q-*` / `D-*`）")
    out.append("")
    out.append("> 生成：`python3 tools/index-deviations.py`（WORKPLAN W-21）。")
    out.append("> 来源：`docs/known-deviations.md` + `docs/deviations/*.md` 的**标题行**。")
    out.append("> **状态只按标题行里的标记判**：含「未决」→ 未决；含「有意」→ 有意偏离；")
    out.append("> 有 `~~…~~` / `✅` / 「已结案」→ 结案；其余一律 `?` —— **不读正文猜**。")
    out.append(f"> 一个编号一行（首次出现处），同编号的其余出现记在「位置」列的「另有 N 处」。")
    out.append("")
    out.append(f"合计 **{len(rows)}** 个编号：结案 {counts[STATUS_CLOSED]} · 有意偏离 "
               f"{counts[STATUS_INTENTIONAL]} · 未决 {counts[STATUS_OPEN]} · ? {counts[STATUS_UNKNOWN]}；"
               f"另有 {len(strays)} 个只在正文出现的编号（见文末）。")
    out.append("")
    out.append("## 总表（按编号排序）")
    out.append("")
    out.append("| 编号 | 标题 | 状态 | 位置 |")
    out.append("|---|---|---|---|")
    for e in rows:
        title = e.title.replace("|", "\\|") or "（标题行里只有编号）"
        loc = e.location + (f"（另有 {len(e.extra)} 处）" if e.extra else "")
        out.append(f"| `{e.id}` | {title} | {status_of(e.heading)} | {loc} |")
    out.append("")
    out.append("## 未决 + `?`（首席下一轮要审的清单）")
    out.append("")
    review = [e for e in rows if status_of(e.heading) in (STATUS_OPEN, STATUS_UNKNOWN)]
    clues = [e for e in review if e.id != "" and any(
        w in e.heading for w in ("已修", "已做", "已解决", "已接线", "已进", "已对齐",
                                 "已收口", "已补", "已接", "完成", "撤销", "订正"))]
    if review:
        out.append(f"> 其中 {len(clues)} 条的标题行里还带「已修 / 已做 / 已解决 / 已接线 / 完成 / 订正」这类字样 ——")
        out.append("> **状态仍按上表四条标记判为 `?`**（不读正文猜），这些字样只是给首席的线索：")
        out.append("> 下一轮可以把它们正式并进标记表，这里就会自动收敛。")
        out.append("")
    if not review:
        out.append("无。")
    else:
        for e in review:
            out.append(f"- `{e.id}`（{status_of(e.heading)}）{e.title or '（无标题）'} —— {e.location}")
    out.append("")
    out.append("## 只在正文出现、没有独立标题的编号（不判状态）")
    out.append("")
    if not strays:
        out.append("无。")
    else:
        for ident, (rel, line_no) in strays:
            out.append(f"- `{ident}` —— {rel}:{line_no}")
    out.append("")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description="偏离登记表索引（W-21）")
    ap.add_argument("--check", action="store_true", help="只校验 INDEX.md 是最新的")
    ap.add_argument("--list-open", action="store_true", help="只打印「未决 + ?」清单")
    args = ap.parse_args()

    entries, strays = scan()
    text = render(entries, strays)

    if args.list_open:
        rows = sorted(entries.values(), key=lambda e: sort_key(e.id))
        review = [e for e in rows if status_of(e.heading) in (STATUS_OPEN, STATUS_UNKNOWN)]
        print(f"未决 + ? 共 {len(review)} 条：")
        for e in review:
            print(f"  {e.id} [{status_of(e.heading)}] {e.title}  —— {e.location}")
        return 0

    if args.check:
        if not INDEX.exists():
            print(f"★ 缺 {INDEX}，先跑一次 python3 tools/index-deviations.py", file=sys.stderr)
            return 1
        current = INDEX.read_text(encoding="utf-8")
        if current != text:
            print("★ INDEX.md 与扫描结果不一致（登记表改了？），请重新生成：", file=sys.stderr)
            for line in list(difflib.unified_diff(current.split("\n"), text.split("\n"), "INDEX.md", "期望", lineterm=""))[:40]:
                print(line, file=sys.stderr)
            return 1
        print("★ INDEX.md 是最新的（与 known-deviations.md + deviations/*.md 一致）。")
        return 0

    INDEX.write_text(text, encoding="utf-8")
    rows = sorted(entries.values(), key=lambda e: sort_key(e.id))
    counts = {s: sum(1 for e in rows if status_of(e.heading) == s) for s in
              (STATUS_CLOSED, STATUS_INTENTIONAL, STATUS_OPEN, STATUS_UNKNOWN)}
    print(f"写入 {INDEX.relative_to(REPO)}：{len(rows)} 个编号 "
          f"（结案 {counts[STATUS_CLOSED]} / 有意偏离 {counts[STATUS_INTENTIONAL]} / "
          f"未决 {counts[STATUS_OPEN]} / ? {counts[STATUS_UNKNOWN]}）；"
          f"只在正文出现 {len(strays)} 个。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
