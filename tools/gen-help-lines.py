#!/usr/bin/env python3
"""
从 exe 条目表 + `extracted/help/` 生成/校对 `packages/client/src/help-screen.ts`
里的两段「不许手抄」的数据：

  1. `HELP_CHAPTERS`（章名 / 起始资源 / 资源数 / maxScroll）—— 前三个字段直接
     dump 自 exe，`maxScroll = max(0, 该章正文行数 − 8)`（本模块口径，见下）。
  2. `HELP_LINES_0..7`（八章正文，逐字）—— 从 `extracted/help/NNNN.bin` 解出。

用法（在仓库根 `rich4-remake/` 下跑）:

    python3 tools/gen-help-lines.py            # 只校对（默认）：有差异就打印并退出 1
    python3 tools/gen-help-lines.py --write     # 就地改写 help-screen.ts 里两段标记区
    python3 tools/gen-help-lines.py --dump      # 只打印解出的表，不碰文件

数据来源（真值）：

  · 章节表 **VA 0x4761b4**，**20 字节/项 × 8 项**，每项 5 个 dword：
      +0x00 章名串指针 / +0x04 另一个指针（未解）/ +0x08 **起始资源号**
      / +0x0C **该章占几个资源** / +0x10 **当前滚动位置**（运行时会写它）
    换算用 `tools/disasm.py` 的 `va_to_off`。★ 这组数与 `help.mkf` 的资源区间
    严丝合缝：`start[i+1] == start[i] + count[i]`（8/8），且 `start + count - 1 <= 99`。
    滚动夹取在 **VA 0x44e944**：`max = [entry+0x0C] − 8`，`if ([entry+0x0C] <= 8) 不滚`。
  · 正文文本 `../extracted/help/NNNN.bin`（NUL 分隔的行，CP950 解码）。
    `0000.bin` 是底图那一支（SMP），正文从 `0001.bin` 起。

行的口径（照抄原版显示循环 @0x44e1be）：

  · 资源里是 NUL 分隔的行，**空串也是行**（占行号不画）：每个文件以 NUL 收尾，
    所以「行」= 按 0x00 切分后去掉末尾那个空元素。
  · 只有**整行等于 `@`** 的行是章内分页标记（原版 `cmp byte [ptr], 0x40`），
    本模块保留它但绘制时跳过。

⚠️ `maxScroll` 这里取「**行**数 − 8」（本模块的口径，可自洽可测）。exe 里
   `[entry+0x0C] − 8` 是「**资源**数 − 8」，两者只有在「滚动单位 = 资源」
   时才等价 —— 这一条尚未定案，登记在 `docs/deviations/T-045.md` D-045-2。
   本脚本**不**改这个口径，只按它算。
"""

import argparse
import importlib.util
import os
import struct
import sys

# ── 路径 ────────────────────────────────────────────────────────────────
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # rich4-remake/
# 正文资源（与 exe 同级的工作区布局：<workspace>/rich4-remake 与 <workspace>/extracted）
HELP_DIR = os.path.normpath(os.path.join(ROOT, '..', 'extracted', 'help'))
TARGET = os.path.join(ROOT, 'packages', 'client', 'src', 'help-screen.ts')
DISASM = os.path.join(ROOT, 'tools', 'disasm.py')
EXE_FALLBACK = os.path.normpath(os.path.join(ROOT, '..', 'Rich4', 'rich4.exe'))

# ── 真值常量 ────────────────────────────────────────────────────────────
CHAPTER_TABLE_VA = 0x4761B4  # @source exe 条目表
ENTRY_SIZE = 20              # 20 字节/项
NCHAPTER = 8
FIRST_RES = 1                # 正文资源从 1 起（0 是底图）
LAST_RES = 99                # help.mkf 资源上界（含）
ROWS = 8                     # HELP_TEXT.rows（一屏 8 行），maxScroll 的口径

# 生成区标记（脚本只改这两对标记之间的内容）
MARK_CH_BEGIN = '  // >>> GENERATED HELP_CHAPTERS (tools/gen-help-lines.py) >>>'
MARK_CH_END = '  // <<< GENERATED HELP_CHAPTERS <<<'
MARK_LN_BEGIN = '// >>> GENERATED HELP_LINES 0..7 (tools/gen-help-lines.py) >>>'
MARK_LN_END = '// <<< GENERATED HELP_LINES 0..7 <<<'


def load_disasm():
    """借用 tools/disasm.py 的 VA→文件偏移换算（它自带 PE 节表）。"""
    spec = importlib.util.spec_from_file_location('rich4_disasm', DISASM)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except SystemExit:  # capstone 缺失时 disasm.py 会 sys.exit
        pass
    return mod


def exe_path(mod):
    return getattr(mod, 'EXE', EXE_FALLBACK) if os.path.exists(getattr(mod, 'EXE', '')) else EXE_FALLBACK


def read_lines(res: int) -> list:
    path = os.path.join(HELP_DIR, f'{res:04d}.bin')
    with open(path, 'rb') as f:
        raw = f.read()
    if not raw.endswith(b'\x00'):
        raise SystemExit(f'{path} 不以 NUL 收尾 —— 与「行 = NUL 分隔」的口径不符')
    # 去掉末尾那个空元素：每个 NUL 收一行，空串也是行
    return [p.decode('cp950') for p in raw.split(b'\x00')[:-1]]


def read_table(mod):
    """dump exe 条目表 → [(name, start, count), ...]（前 3 个字段里我们要的两个）。"""
    exe = open(exe_path(mod), 'rb').read()
    off = mod.va_to_off(CHAPTER_TABLE_VA)
    out = []
    for i in range(NCHAPTER):
        name_ptr, _other, start, count, _scroll = struct.unpack_from('<5I', exe, off + i * ENTRY_SIZE)
        o = mod.va_to_off(name_ptr)
        e = exe.index(b'\x00', o)
        out.append((exe[o:e].decode('cp950'), start, count))
    # 自检：8 个区间必须首尾相接且落在 [FIRST_RES, LAST_RES]
    for i, (_n, start, count) in enumerate(out):
        if count <= 0:
            raise SystemExit(f'第 {i} 章 count={count} —— 表读错了')
        if start < FIRST_RES or start + count - 1 > LAST_RES:
            raise SystemExit(f'第 {i} 章资源区间 {start}..{start + count - 1} 越出 {FIRST_RES}..{LAST_RES}')
        if i > 0:
            prev = out[i - 1]
            if prev[1] + prev[2] != start:
                raise SystemExit(
                    f'第 {i - 1} 章的区间 {prev[1]}..{prev[1] + prev[2] - 1} 与第 {i} 章的起点 {start} 不接续'
                )
    return out


def build():
    mod = load_disasm()
    table = read_table(mod)
    chapters = []
    for name, start, count in table:
        lines = []
        for res in range(start, start + count):
            lines.extend(read_lines(res))
        chapters.append({'name': name, 'start': start, 'count': count, 'lines': lines})
    return chapters


def max_scroll(n_lines: int) -> int:
    return max(0, n_lines - ROWS)


def ts_str(s: str) -> str:
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"


def render_chapters(chapters) -> str:
    """只渲染**数组体**（声明与收尾的 `];` 留在 help-screen.ts 里手写）。"""
    out = [MARK_CH_BEGIN]
    for c in chapters:
        out.append(
            '  {{ name: {name}, res: {res}, resCount: {cnt}, maxScroll: {ms} }},'.format(
                name=ts_str(c['name']),
                res=c['start'],
                cnt=c['count'],
                ms=max_scroll(len(c['lines'])),
            )
        )
    out.append(MARK_CH_END)
    return '\n'.join(out)


def render_lines(chapters) -> str:
    out = [MARK_LN_BEGIN]
    out.append('// 由 tools/gen-help-lines.py 生成，勿手改（手抄必错）。')
    out.append('// 每章 = exe 条目表 0x4761b4 给出的资源区间 start .. start+resCount-1，')
    out.append('// 逐资源按 NUL 切行后顺次接起来；文本 = ../extracted/help/NNNN.bin（CP950）。')
    for i, c in enumerate(chapters):
        out.append('//')
        out.append(
            '// 第 {i} 章 {name}：资源 {s}..{e}（{cnt} 个），共 {n} 行，maxScroll {ms}。'.format(
                i=i,
                name=c['name'],
                s=c['start'],
                e=c['start'] + c['count'] - 1,
                cnt=c['count'],
                n=len(c['lines']),
                ms=max_scroll(len(c['lines'])),
            )
        )
        out.append(f'const HELP_LINES_{i}: readonly string[] = [')
        for line in c['lines']:
            out.append(f'  {ts_str(line)},')
        out.append('];')
    out.append(MARK_LN_END)
    return '\n'.join(out)


def splice(src: str, begin: str, end: str, body: str) -> str:
    b = src.find(begin)
    if b < 0:
        raise SystemExit(f'找不到起始标记：{begin.strip()}')
    e = src.find(end, b)
    if e < 0:
        raise SystemExit(f'找不到结束标记：{end.strip()}')
    return src[:b] + body + src[e + len(end):]


def main() -> int:
    ap = argparse.ArgumentParser(description='生成/校对 help-screen.ts 的章节表与正文')
    ap.add_argument('--write', action='store_true', help='就地改写 help-screen.ts（默认只校对）')
    ap.add_argument('--dump', action='store_true', help='只打印解出的表')
    args = ap.parse_args()

    chapters = build()

    if args.dump:
        for i, c in enumerate(chapters):
            print(
                '{i} {name} res {s}..{e} lines {n} maxScroll {ms} first {f!r} last {l!r}'.format(
                    i=i, name=c['name'], s=c['start'], e=c['start'] + c['count'] - 1,
                    n=len(c['lines']), ms=max_scroll(len(c['lines'])),
                    f=c['lines'][0], l=c['lines'][-1],
                )
            )
        return 0

    with open(TARGET, encoding='utf-8') as f:
        src = f.read()

    new = splice(src, MARK_CH_BEGIN, MARK_CH_END, render_chapters(chapters))
    new = splice(new, MARK_LN_BEGIN, MARK_LN_END, render_lines(chapters))

    if args.write:
        with open(TARGET, 'w', encoding='utf-8') as f:
            f.write(new)
        print(f'已写入 {os.path.relpath(TARGET, ROOT)}')
        return 0

    if new != src:
        # 只报第一处差异，够定位就行
        for i, (a, b) in enumerate(zip(src.splitlines(), new.splitlines())):
            if a != b:
                print(f'第 {i + 1} 行不一致：')
                print(f'  现在的： {a}')
                print(f'  应生成： {b}')
                break
        else:
            print('行数不同（标记区被删/被加）')
        print('❌ help-screen.ts 的生成区与数据源不一致，跑 --write 同步')
        return 1

    print('✅ 生成区与 exe 条目表 / extracted/help 一致')
    return 0


if __name__ == '__main__':
    sys.exit(main())
