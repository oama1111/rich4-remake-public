#!/usr/bin/env python3
"""
rich4.exe 反汇编工具 —— 项目的最终真值裁决手段

用法:
    python3 tools/disasm.py va 0x004420d8 [行数]     反汇编指定虚拟地址
    python3 tools/disasm.py card 1 [行数]            反汇编第 N 张卡的效果函数
    python3 tools/disasm.py table 0x475d5c 30        打印函数指针表
    python3 tools/disasm.py find <hex字节序列>        在文件中搜索字节模式
    python3 tools/disasm.py callers 0x40df69         ★ 谁调用了这个函数
    python3 tools/disasm.py xref cash                ★ 交叉引用：谁碰了 player.cash
    python3 tools/disasm.py xref 0x496b84            同上，也可直接给绝对地址
    python3 tools/disasm.py scan card <N|all>        ★ 扫描某卡**全部**状态写入
    python3 tools/disasm.py scan news <N|all>        同上，用于新闻事件
    python3 tools/disasm.py scan fortune <N|all>     同上，用于命运事件

`scan` 会按函数表推出该卡的**真实地址范围**（到下一张卡为止），
列出其中所有对玩家/地块/全局状态的写入。用它可以发现
「只看了函数开头几十条指令而漏掉后面分支」这类错误。

为什么需要它：
    逆向项目 rich4-re 已发现 7 处错误，且存在**两代互相矛盾**的卡片实现
    （2018 的 csrc/cards.c 与 2026 的 asm/rich4_card_*.c）。
    唯一能裁决的就是原版可执行文件本身。

依赖: capstone
"""
import re
import struct
import sys

try:
    from capstone import Cs, CS_ARCH_X86, CS_MODE_32
except ImportError:
    sys.exit("需要 capstone: pip3 install capstone")

EXE = "/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/Rich4/rich4.exe"

# ⚠️ 该 PE 的节表 VirtualSize 全为 0（老 Watcom 链接器），
#    必须用 SizeOfRawData 做 VA→文件偏移换算。
CODE_VA, CODE_OFF, CODE_SIZE = 0x401000, 1024, 394240

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


# 玩家结构体基址与字段名（用于把绝对地址翻译成可读偏移）
PLAYER_BASE = 0x496b68
PLAYER_FIELDS = {
    0x08: "xpos", 0x0a: "ypos", 0x0c: "node_id", 0x0e: "last_node_id",
    0x10: "direction", 0x11: "traffic_method", 0x12: "ndices", 0x13: "character",
    0x14: "sex", 0x15: "who_plays", 0x1c: "cash", 0x20: "money_in_bank",
    0x24: "loan", 0x28: "special_finance", 0x2c: "f44", 0x30: "points",
    0x32: "days_in_hotel", 0x33: "days_disappearing", 0x34: "days_in_prison",
    0x35: "days_in_hospital", 0x36: "days_sleeping", 0x37: "days_sleep_walking",
    0x38: "days_stopping", 0x39: "days_tortoise_walking",
    0x3b: "days_rejected_by_bank", 0x3f: "god_info", 0x40: "f64",
    0x41: "allied_player", 0x42: "total_winter_sleep_days",
}


def describe_target(op: str) -> str:
    """把 `[reg + 0x496ba0]` 翻译成 `player.days_stopping`"""
    m = re.search(r"0x([0-9a-f]+)\]", op)
    if not m:
        return ""
    addr = int(m.group(1), 16)
    off = addr - PLAYER_BASE
    if 0 <= off < 0x68:
        name = PLAYER_FIELDS.get(off, f"+0x{off:02x}")
        return f"  ← player.{name}"
    return ""


def scan_card(idx, limit=600, table="card") -> None:
    """扫描表中某项的全部状态写入（按函数表推出真实范围）"""
    data = load()
    tva, tn, _ = TABLES[table]
    base = va_to_off(tva)
    (fn,) = struct.unpack_from("<I", data, base + idx * 4)
    if fn == 0:
        print(f"  {table}[{idx}]: 空项")
        return
    # 下一张卡的地址作为上界（取大于 fn 的最小者）
    others = []
    for i in range(tn):
        (p,) = struct.unpack_from("<I", data, base + i * 4)
        if p > fn:
            others.append(p)
    end = min(others) if others else fn + limit * 8
    # ⚠️ 地址序最后一张卡没有「下一张」作上界，范围会偏大，
    #    扫出的尾部写入可能属于相邻函数，需人工甄别。
    over_wide = not others or (end - fn) > 2000

    md = Cs(CS_ARCH_X86, CS_MODE_32)
    off = va_to_off(fn)
    code = data[off: off + (end - fn)]
    writes = []
    for ins in md.disasm(code, fn):
        if ins.address >= end:
            break
        if ins.mnemonic in ("mov", "add", "sub", "or", "and", "xor", "inc", "dec"):
            if ins.op_str.startswith(("byte ptr [", "word ptr [", "dword ptr [")):
                writes.append((ins.address, ins.mnemonic, ins.op_str))
    print(f"\n# {table}[{idx}]  VA 0x{fn:08x}..0x{end:08x}  ({end - fn} 字节)")
    if over_wide:
        print("  ⚠️ 该卡范围偏大（无可靠上界），尾部写入可能属于相邻函数")
    if not writes:
        print("  （无直接状态写入，效果可能全在被调函数中）")
    for a, m, o in writes:
        print(f"  {a:08x}  {m:<5} {o}{describe_target(o)}")


def xref(const: int, limit: int = 300) -> None:
    """★ 找出所有**引用某个绝对地址**的指令（字段交叉引用）

    为什么不用线性反汇编：该 PE 的代码段夹杂着数据，从段首一路
    `md.disasm` 会在数据处**失步**，之后的指令全是错的——实测会漏掉
    `pay_money` 自己对 cash 的写入。

    这里改为**先按字节搜常量**（小端 4 字节），再对每个命中点向前
    试 2..8 字节找出恰好覆盖该常量的指令。这样每条结果都是独立
    对齐的，不受失步影响。
    """
    data = load()
    pat = struct.pack("<I", const)
    hits = []
    start = CODE_OFF
    while True:
        at = data.find(pat, start)
        if at < 0 or at >= CODE_OFF + CODE_SIZE:
            break
        hits.append(at)
        start = at + 1

    print(f"# 引用 0x{const:08x} 的指令，共 {len(hits)} 处")
    md = Cs(CS_ARCH_X86, CS_MODE_32)
    shown = 0
    for off in hits:
        # ⚠️ 必须从 1 开始：`A3 <disp32>`（mov [addr], eax）与
        #    `A1 <disp32>`（mov eax, [addr]）的位移就在**第 1 字节**之后。
        #    起点写成 2 会整类漏掉——曾因此漏检物价指数的唯一运行时写入点
        #    0x00423b1b，误以为该值只在读档时被赋值。
        for back in range(1, 9):
            va = CODE_VA + (off - back - CODE_OFF)
            got = list(md.disasm(data[off - back: off - back + 16], va))
            # ★ 必须是**方括号内**的内存引用才算命中。
            #    否则 `05 <imm32>` 会被解成 `add eax, 0x4990e8`（立即数），
            #    在 back=1 处抢先匹配，把真正的 `C7 05` 写入指令挡掉。
            bracketed = re.search(rf"\[[^\]]*0x{const:x}[^\]]*\]", got[0].op_str) if got else None
            if got and got[0].size > back and bracketed:
                # 目的操作数是内存，且助记符确实会写回才算写入。
                # ⚠️ `fild` 是**读**（整数装入 x87），`fistp` 才是写。
                WRITERS = ("mov", "add", "sub", "or", "and", "xor",
                           "inc", "dec", "fistp", "imul", "neg", "not")
                dest_mem = got[0].op_str.startswith(("byte ptr [", "word ptr [", "dword ptr ["))
                mark = "  ← 写入" if dest_mem and got[0].mnemonic in WRITERS else ""
                print(f"  {got[0].address:08x}  {got[0].mnemonic:<5} {got[0].op_str}{mark}")
                break
        else:
            print(f"  VA 0x{CODE_VA + (off - CODE_OFF):08x}  <未能对齐，可能是数据>")
        shown += 1
        if shown >= limit:
            print(f"  …（其余 {len(hits) - shown} 处已省略）")
            break


# 玩家数组基址 + 字段偏移 → 绝对地址（xref 用名字即可）
PLAYER_ARRAY_BASE = 0x496b68
FIELD_ALIASES = {name: PLAYER_ARRAY_BASE + off for off, name in PLAYER_FIELDS.items()}
FIELD_ALIASES["hostility"] = PLAYER_ARRAY_BASE + 0x4c
FIELD_ALIASES["monthly_paid"] = PLAYER_ARRAY_BASE + 0x5c
FIELD_ALIASES["monthly_received"] = PLAYER_ARRAY_BASE + 0x60


def callers(target: int) -> None:
    """★ 找出所有 `call <target>` 的位置

    ⚠️ `xref` 找不到调用点：x86 的 `call rel32` 存的是**相对位移**，
    目标地址根本不在字节流里。这里反过来做——扫描每个 0xE8 字节，
    按 `目标 = 地址 + 5 + rel32` 反推，命中才报告。

    同样不走线性反汇编，故不受代码段夹杂数据导致的失步影响；
    代价是数据里凑巧的 0xE8 会造成少量误报，需结合上下文甄别。
    """
    data = load()
    hits = []
    for off in range(CODE_OFF, CODE_OFF + CODE_SIZE - 5):
        if data[off] != 0xE8:
            continue
        (rel,) = struct.unpack_from("<i", data, off + 1)
        site = CODE_VA + (off - CODE_OFF)
        if site + 5 + rel == target:
            hits.append(site)

    print(f"# call 0x{target:08x} 的调用点，共 {len(hits)} 处")
    md = Cs(CS_ARCH_X86, CS_MODE_32)
    for site in hits:
        # 打印调用点前 3 条指令作为上下文（参数压栈）
        ctx = []
        for back in range(4, 32):
            got = list(md.disasm(data[va_to_off(site - back): va_to_off(site) + 5], site - back))
            if got and any(i.address == site for i in got):
                ctx = [i for i in got if i.address <= site][-4:]
                break
        print(f"  ── 0x{site:08x}")
        for i in ctx:
            print(f"     {i.address:08x}  {i.mnemonic:<6} {i.op_str}")


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
    elif cmd == "callers":
        callers(int(sys.argv[2], 0))
    elif cmd == "xref":
        arg = sys.argv[2]
        const = FIELD_ALIASES[arg] if arg in FIELD_ALIASES else int(arg, 0)
        if arg in FIELD_ALIASES:
            print(f"# 字段 {arg} → VA 0x{const:08x}")
        xref(const, int(sys.argv[3]) if len(sys.argv) > 3 else 300)
    elif cmd == "scan":
        which = sys.argv[2]
        if which not in TABLES:
            sys.exit(f"未知表 {which}；可用：{', '.join(TABLES)}")
        n = TABLES[which][1]
        if sys.argv[3] == "all":
            for i in range(n):
                scan_card(i, table=which)
        else:
            scan_card(int(sys.argv[3], 0), table=which)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
