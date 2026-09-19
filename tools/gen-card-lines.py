#!/usr/bin/env python3
"""从 `rich4.exe` 抽出**卡牌使用者台词表**：12 角色 × 30 张卡 = 360 条。

为什么要有这个脚本：`packages/data/src/speech.ts` 的 `SPEECH_LINES` 只有
`_rich4_event_strings`（VA `0x48084a`，步长 108，27 槽）那张**受击/情境**台词表；
`rich4-remake` 里**另有一张**卡牌台词表（VA `0x48123a`，步长 360，90 槽，
本脚本只取其中的槽 0..29），它此前**一条都没进仓库** ⇒ 用卡时不会出现角色那句台词，
语音也不响。见 `rich4-remake/docs/gaps/README.md` §7.89(2)。

出处（都在 rich4.exe 里可核）：
  指针表 VA 0x48123a，步长 360 字节（90 项 × 4 字节），行 = 角色
  第 `card` 张卡读**槽 `card-1`**（`@source 0x44210e` 等 14 处 `mov ebx,[eax+0x4812Xe]`）
  串形状 `#NNNN` + BIG5 文本；或 `#NNNN@DD`（DD 两位十进制，金貝貝那一列）
  语音号恒 = `426 + 52*角色 + (卡号-1)`（360 条无例外）

★ 解码用 **Node 的 `TextDecoder('big5')`**（与浏览器、与 `card-lines.test.ts`
  同一套 WHATWG 表）—— 原版有两条串以 Big5 **用户造字区**双字节结尾，
  Python 的 `big5` codec 不认（会给出 U+FFFD 而不是 ICU 的 PUA U+ECBF）。

用法：
  python3 tools/gen-card-lines.py             # 打印到 stdout（给人看/核对）
  python3 tools/gen-card-lines.py --json      # 机读格式
  python3 tools/gen-card-lines.py --ts        # 直接吐 `card-lines.ts` 里的表字面量
"""
from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
import sys
from pathlib import Path

EXE = Path(os.environ.get("RICH4_WORKSPACE") or Path(__file__).resolve().parents[2]) / "Rich4" / "rich4.exe"
DATA_VA, DATA_OFF = 0x463000, 398848
CARD_TABLE_VA = 0x48123A
STRIDE = 360
CARDS = 30
CHARACTERS = 12

# Big5 里有两个码位在**两个标准**下不同解，必须钉死成 WHATWG 那一套 ——
# 与 `tools/gen-speech.py` 同一处理（浏览器 `TextDecoder('big5')` 用 WHATWG）。
BIG5_WHATWG_FIX = {"\u223c": "\uff5e", "\u2010": "\u2013"}


def data_off(va: int) -> int:
    return DATA_OFF + (va - DATA_VA)


def big5_python(raw: bytes) -> str:
    """Python 自带 `big5` 解码（**退化路径**，见 `decode_all`）。"""
    s = raw.decode("big5", errors="replace")
    for a, b in BIG5_WHATWG_FIX.items():
        s = s.replace(a, b)
    return s


def big5_whatwg(raw_list: list[bytes]) -> list[str]:
    """用 **Node 的 `TextDecoder('big5')`** 解码 —— 与浏览器/测试**同一个**解码器。

    ⚠️ 为什么不自己写：原版有两条串以 Big5 **用户造字区**双字节结尾
    （角色 6 的卡 15/16：`#0752晚安∼\x9d\xdd`），
    Python 的 `big5` codec **直接拒收**（0x81..0xA0 前导全不认），
    而 WHATWG/ICU 把它映射到 **PUA U+ECBF** —— 两者解出来的串不等，
    会让 `card-lines.test.ts` 的全量比对红。
    本仓库数据侧的既定解码器就是 `TextDecoder('big5')`（见 `speech.test.ts`），
    故这里直接请它来解：把 360 条原始字节交给 node，一次拿回全部字符串。
    没有 node 时退化成 `big5_python`（会在这两条上给出 U+FFFD，测试会红——
    这是**有意的**：宁可红也不要静默写错表）。
    """
    if shutil.which("node") is None:
        return [big5_python(r) for r in raw_list]
    script = (
        "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{"
        "const hex=JSON.parse(s);const dec=new TextDecoder('big5');"
        "console.log(JSON.stringify(hex.map(h=>dec.decode(Buffer.from(h,'hex')))));});"
    )
    out = subprocess.run(["node", "-e", script],
                         input=json.dumps([r.hex() for r in raw_list]),
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def rows() -> list[dict]:
    d = EXE.read_bytes()
    raws: list[bytes] = []
    keys: list[tuple[int, int, int]] = []
    for ch in range(CHARACTERS):
        for card in range(1, CARDS + 1):
            p = struct.unpack_from("<I", d, data_off(CARD_TABLE_VA) + STRIDE * ch + 4 * (card - 1))[0]
            o = data_off(p)
            e = d.index(b"\x00", o)
            raw = d[o:e]
            raws.append(raw[5:])                     # 去掉 `#NNNN` 前缀
            keys.append((ch, card, int(raw[1:5])))
    texts = big5_whatwg(raws)
    out: list[dict] = []
    for (ch, card, voice), text in zip(keys, texts):
        rec: dict = {"character": ch, "card": card, "voice": voice, "raw": text}
        if text.startswith("@"):
            rec["emoji"] = int(text[1:3])
        out.append(rec)
    return out


def main() -> None:
    data = rows()
    if "--json" in sys.argv:
        json.dump(data, sys.stdout, ensure_ascii=False, indent=1)
        print()
        return
    if "--ts" in sys.argv:
        by_ch: dict[int, list[dict]] = {}
        for r in data:
            by_ch.setdefault(r["character"], []).append(r)
        for ch in range(CHARACTERS):
            print(f"  // ── 角色 {ch} ──")
            print("  [")
            for r in by_ch[ch]:
                if "emoji" in r:
                    emoji, text = r["emoji"], f"@{r['emoji']:02d}"
                else:
                    emoji, text = "null", r["raw"]
                esc = text.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")
                print(f"    [{emoji}, '{esc}'],")
            print("  ],")
        return
    for r in data:
        mark = f"  @{r['emoji']:02d}" if "emoji" in r else ""
        print(f"{r['character']:2}/{r['card']:2}  #{r['voice']:4}  {r['raw']!r}{mark}")


if __name__ == "__main__":
    main()
