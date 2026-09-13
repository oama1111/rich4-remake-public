#!/usr/bin/env python3
"""
rich4.exe 反汇编工具 —— 项目的最终真值裁决手段

用法:
    python3 tools/disasm.py va 0x004420d8 [行数]     反汇编指定虚拟地址
    python3 tools/disasm.py card 1 [行数]            反汇编第 N 张卡的效果函数
    python3 tools/disasm.py table 0x475d5c 30        打印函数指针表
    python3 tools/disasm.py find <hex字节序列>        在文件中搜索字节模式

为什么需要它：
    逆向项目 rich4-re 已发现 7 处错误，且存在**两代互相矛盾**的卡片实现
    （2018 的 csrc/cards.c 与 2026 的 asm/rich4_card_*.c）。
    唯一能裁决的就是原版可执行文件本身。

依赖: capstone
"""
import struct
import sys

try:
    from capstone import Cs, CS_ARCH_X86, CS_MODE_32
except ImportError:
    sys.exit("需要 capstone: pip3 install capstone")

EXE = "/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/Rich4/rich4.exe"

# ⚠️ 该 PE 的节表 VirtualSize 全为 0（老 Watcom 链接器），
#    必须用 SizeOfRawData 做 VA→文件偏移换算。
SECTIONS = [
    # (名称,      VA,         文件偏移,  大小)
    ("AUTO",   0x401000,   1024,    394240),  # 代码段
    ("DGROUP", 0x463000, 398848,    158720),  # 数据段
]

# 已知的函数指针表
TABLES = {
    "card":    (0x475d5c, 31, "卡片效果函数 card_functions[]"),
    "news":    (0x475e24, 36, "新闻事件 events_calls_table[]"),
    "fortune": (0x475ef0, 37, "命运事件 fortune_call_table[]"),
    "magic":   (0x475724, 12, "魔法屋 magic_house_functions[]（每项 16 字节）"),
}


def load() -> bytes:
    with open(EXE, "rb") as f:
        return f.read()


def va_to_off(va: int):
    for _, sva, off, size in SECTIONS:
        if sva <= va < sva + size:
            return off + (va - sva)
    return None


def section_of(va: int):
    for name, sva, _, size in SECTIONS:
        if sva <= va < sva + size:
            return name
    return None


def cstr(data: bytes, va: int) -> str:
    off = va_to_off(va)
    if off is None:
        return f"<VA 0x{va:x} 越界>"
    end = data.index(b"\0", off)
    raw = data[off:end]
    for enc in ("big5", "cp950"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.hex()


def disasm(va: int, count: int = 80) -> None:
    data = load()
    off = va_to_off(va)
    if off is None:
        sys.exit(f"VA 0x{va:x} 不在任何已知节内")
    print(f"# VA 0x{va:08x}  节 {section_of(va)}  文件偏移 {off}")
    md = Cs(CS_ARCH_X86, CS_MODE_32)
    code = data[off: off + count * 8 + 64]
    for i, ins in enumerate(md.disasm(code, va)):
        print(f"  {ins.address:08x}  {ins.mnemonic:<8} {ins.op_str}")
        if i + 1 >= count:
            break


def show_table(va: int, n: int, label: str = "") -> None:
    data = load()
    off = va_to_off(va)
    if off is None:
        sys.exit(f"VA 0x{va:x} 不在任何已知节内")
    print(f"# {label or '函数指针表'} @ VA 0x{va:08x}，{n} 项")
    for i in range(n):
        (p,) = struct.unpack_from("<I", data, off + i * 4)
        mark = "" if p else "  （NULL 占位）"
        print(f"  [{i:>2}] 0x{p:08x}{mark}")


def find(pattern_hex: str) -> None:
    data = load()
    pat = bytes.fromhex(pattern_hex.replace(" ", ""))
    hits = []
    start = 0
    while True:
        at = data.find(pat, start)
        if at < 0:
            break
        hits.append(at)
        start = at + 1
    print(f"# 模式 {pattern_hex} 命中 {len(hits)} 处")
    for off in hits[:40]:
        va = None
        for _, sva, soff, size in SECTIONS:
            if soff <= off < soff + size:
                va = sva + (off - soff)
        print(f"  文件偏移 {off}" + (f"  → VA 0x{va:08x}" if va else "  （不在已知节内）"))


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd = sys.argv[1]

    if cmd == "va":
        disasm(int(sys.argv[2], 0), int(sys.argv[3]) if len(sys.argv) > 3 else 80)
    elif cmd == "card":
        idx = int(sys.argv[2], 0)
        data = load()
        base = va_to_off(TABLES["card"][0])
        (fn,) = struct.unpack_from("<I", data, base + idx * 4)
        if fn == 0:
            sys.exit(f"card_functions[{idx}] 为 NULL")
        print(f"# 卡片 {idx} 的效果函数 → VA 0x{fn:08x}")
        disasm(fn, int(sys.argv[3]) if len(sys.argv) > 3 else 80)
    elif cmd == "table":
        if sys.argv[2] in TABLES:
            va, n, label = TABLES[sys.argv[2]]
            show_table(va, n, label)
        else:
            show_table(int(sys.argv[2], 0), int(sys.argv[3]))
    elif cmd == "find":
        find(sys.argv[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
