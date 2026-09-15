#!/usr/bin/env python3
"""从全量反汇编文本里抽 UI 调用的**常量参数**，按调用顺序排好。

为什么要有这个工具：复刻一屏要抄几十个 `(x, y, 串/图号)`，而 `push` 顺序是**反的**
（最后一个 push 才是第一个参数），逐个手数又慢又容易错。
这里按「往回收集 push，直到遇到 call/跳转/标签」的固定套路还原，
并把指针操作数解成 BIG5 串 —— 剩下几十屏的取证都靠它。

⚠️ `rich4-re/asm/*.asm` 是**不带地址列**的反汇编文本（地址只出现在行尾注释里，
   形如 `push ref_00463920  ; push 0x463920`），所以本工具按**标签**取函数区间，
   显示用的地址从注释里读。

用法：
    python3 tools/ui-dump.py fcn_00423070          # 一个函数
    python3 tools/ui-dump.py fcn_00423070 fcn_004231ba   # 到另一个标签为止
    python3 tools/ui-dump.py --calls fcn_00423070  # 只看调了哪些绘制函数
    python3 tools/ui-dump.py --grep 0x47540c       # 谁引用了这个地址
"""

from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASM_DIR = os.path.normpath(os.path.join(ROOT, '..', 'rich4-re', 'asm'))
EXE = os.path.normpath(os.path.join(ROOT, '..', 'Rich4', 'rich4.exe'))
VA_TO_FILE = 0x401A00          # 由 disasm.py「文件偏移 401200 → VA 0x00463930」反推

# 绘制/载入函数 → (名字, 参数个数)
KNOWN = {
    0x44FABC: ('draw_text(surface, 串, x, y, flag)', 5),
    0x44F9D8: ('create_font(a, b, c, d, 字号)', 5),
    0x4563F5: ('draw_img(surface, 图, x, y)', 4),
    0x456418: ('draw_img_anchor(surface, 图, x, y)', 4),
    0x45643D: ('draw_img_rect(surface, 图, x, y, sx, sy, w, h)', 8),
    0x4561BE: ('fill_rect(surface, x, y, w, h, 颜色)', 6),
    0x45620F: ('draw_rect(surface, x, y, w, h, 颜色)', 6),
    0x4562A5: ('blit_rect(surface, 图, x, y)', 4),
    0x456469: ('draw_img_clip(图, x, y, ...)', 7),
    0x450441: ('read_mkf(mkf, 资源号, buf, size)', 4),
    0x45144F: ('draw_x(图, x, y, 参数, -1)', 5),
    0x44EF41: ('player_say(...)', 3),
    0x4542CE: ('play_sound_effect(项, k)', 2),
}


def load_asm() -> dict[str, list[tuple[str, str]]]:
    """{文件名: [(原文行, 该行的地址或 '')]}"""
    files: dict[str, list[tuple[str, str]]] = {}
    for name in sorted(os.listdir(ASM_DIR)):
        if not name.endswith('.asm'):
            continue
        out: list[tuple[str, str]] = []
        with open(os.path.join(ASM_DIR, name), 'rb') as fh:
            for raw in fh:
                line = raw.decode('utf-8', 'replace').rstrip('\n')
                m = re.search(r';\s*(?:push|call|mov|jmp)[^;]*?(0x[0-9a-f]{5,8})\s*$', line)
                out.append((line, m.group(1) if m else ''))
        files[name] = out
    return files


def label_index(files: dict[str, list[tuple[str, str]]]) -> dict[str, tuple[str, int]]:
    idx: dict[str, tuple[str, int]] = {}
    for name, lines in files.items():
        for i, (line, _a) in enumerate(lines):
            m = re.match(r'^\s*([A-Za-z_][\w]*):', line)
            if m:
                idx.setdefault(m.group(1), (name, i))
    return idx


_EXE: bytes | None = None


def big5_at(va: int) -> str | None:
    global _EXE
    if _EXE is None:
        try:
            _EXE = open(EXE, 'rb').read()
        except OSError:
            _EXE = b''
    off = va - VA_TO_FILE
    if not (0 < off < len(_EXE) - 2):
        return None
    s = _EXE[off:off + 40].split(b'\0')[0]
    if not s:
        return None
    try:
        text = s.decode('big5')
    except UnicodeDecodeError:
        return None
    return text if text.isprintable() else None


def resolve(op: str) -> str:
    """把一条 push 的操作数解成人能读的。"""
    op = op.strip()
    m = re.fullmatch(r'0x([0-9a-f]+)', op)
    if not m:
        m2 = re.fullmatch(r'([0-9a-f]+)h', op)
        if m2:
            v = int(m2.group(1), 16)
            return f'0x{v:x}({v})' if v < 0x10000 else f'0x{v:x}'
        return op
    v = int(m.group(1), 16)
    s = big5_at(v) if 0x400000 < v < 0x500000 else None
    if s is not None:
        return f'0x{v:x}("{s}")'
    return f'0x{v:x}({v})' if v < 0x10000 else f'0x{v:x}'


def target_va(line: str) -> int | None:
    m = re.search(r'call\s+(?:dword ptr )?(?:cs:\[)?0x([0-9a-f]+)', line)
    if m:
        return int(m.group(1), 16)
    m = re.search(r';\s*call\s+0x([0-9a-f]+)', line)
    return int(m.group(1), 16) if m else None


def dump(files, idx, start: str, stop: str | None, show_args: bool) -> None:
    name, i0 = idx[start]
    lines = files[name]
    end = len(lines)
    if stop is not None and stop in idx and idx[stop][0] == name:
        end = idx[stop][1]
    else:
        for j in range(i0 + 1, len(lines)):
            if re.match(r'^\s*(fcn_[0-9a-f]+|_rich4\w*):', lines[j][0]):
                end = j
                break
    print(f'# {start}  （{name}，{end - i0} 行）')
    for j in range(i0, end):
        line, addr = lines[j]
        if not re.match(r'^\s*call\b', line):
            continue
        tva = target_va(line)
        if tva is None:
            continue
        known = KNOWN.get(tva)
        tag = known[0] if known else None
        argc = known[1] if known else 0
        if not show_args or tag is None or argc == 0:
            print(f'  {addr or "        "}  {tag or f"call 0x{tva:x}"}')
            continue
        args: list[str] = []
        ctx: list[str] = []
        k = j - 1
        while k >= i0 and len(args) < argc:
            prev = lines[k][0]
            if re.match(r'^\s*(call|j[a-z]+|ret)\b', prev) or re.match(r'^\s*\w+:', prev):
                break
            pm = re.match(r'^\s*push\s+(.*)$', prev)
            if pm:
                args.append(resolve(pm.group(1)))
            else:
                ctx.append(prev.strip())
            k -= 1
        print(f'  {addr or "        "}  {tag}')
        # args 是「从最后一个 push 往回收集」，故**正好是调用顺序**（arg1 先）
        print(f'          → {"  ".join(args)}')
        if ctx:
            print(f'          其间: {" | ".join(reversed(ctx[-3:]))}')


def main() -> int:
    args = sys.argv[1:]
    show_args = True
    if args and args[0] == '--calls':
        show_args = False
        args = args[1:]
    if args and args[0] == '--grep':
        pat = args[1]
        hits = 0
        for name in sorted(os.listdir(ASM_DIR)):
            if not name.endswith('.asm'):
                continue
            with open(os.path.join(ASM_DIR, name), 'rb') as fh:
                for n, raw in enumerate(fh, 1):
                    line = raw.decode('utf-8', 'replace').rstrip('\n')
                    if pat in line:
                        print(f'{name}:{n}: {line.strip()}')
                        hits += 1
        print(f'# 命中 {hits} 处')
        return 0
    if not args:
        print(__doc__)
        return 2
    files = load_asm()
    idx = label_index(files)
    start = args[0]
    if start not in idx:
        print(f'找不到标签 {start}')
        return 1
    dump(files, idx, start, args[1] if len(args) > 1 else None, show_args)
    return 0


if __name__ == '__main__':
    sys.exit(main())
