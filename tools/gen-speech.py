#!/usr/bin/env python3
"""从 `rich4.exe` 抽出**全部 12 角色 × 27 事件 = 324 条台词**（含金貝貝的 emoji 码）。

为什么要有这个脚本：`packages/data/src/speech.ts` 的 `SPEECH_EVENTS` 里每条
`line` 只存了**角色 0（約翰喬）那一列**，另外 11 个角色自己的台词没进仓库。
金貝貝（角色 11）更特殊：它**不说话**，串是 `#NNNN@DD` 形状，`@DD` 是
`Data.mkf` #0x207 的表情图号（见 exe 里那段解析）。

出处（都在 rich4.exe 里可核）：
  指针表 VA 0x48084a，步长 108 字节（27 项 × 4 字节），行 = 角色
  串形状 `#NNNN` + BIG5 文本；或 `#NNNN@DD`（DD 两位十进制）
用法：
  python3 tools/gen-speech.py             # 打印到 stdout（给人看/核对）
  python3 tools/gen-speech.py --json      # 机读格式
"""
from __future__ import annotations

import json
import os
import struct
import sys
from pathlib import Path

EXE = Path(os.environ.get("RICH4_WORKSPACE") or Path(__file__).resolve().parents[2]) / "Rich4" / "rich4.exe"
DATA_VA, DATA_OFF = 0x463000, 398848
SPEECH_TABLE_VA = 0x48084A
STRIDE = 108
EVENTS = 27
CHARACTERS = 12

def data_off(va: int) -> int:
    return DATA_OFF + (va - DATA_VA)


# Big5 里有两个码位在**两个标准**下不同解，必须钉死成 WHATWG 那一套 ——
# 引擎侧（浏览器 `TextDecoder('big5')`、也就是本仓库 `packages/data` 的读法）
# 用的是 WHATWG Encoding Standard，Python 的 `big5` codec 与它不一致的地方就这两处：
#   A1E3: Python U+223C (∼ TILDE OPERATOR)      / WHATWG U+FF5E (～ FULLWIDTH TILDE)
#   A1C3: Python U+2010 (‐ HYPHEN)              / WHATWG U+2013 (– EN DASH)  ← 本表用不到
# 不修正的话，`tools/gen-speech.py --json` 生成的表会与
# `speech.test.ts`（用 TextDecoder 读 exe）**逐字节不等**，全量表校验会红。
BIG5_WHATWG_FIX = {"\u223c": "\uff5e", "\u2010": "\u2013"}


def big5_whatwg(raw: bytes) -> str:
    s = raw.decode("big5")
    for a, b in BIG5_WHATWG_FIX.items():
        s = s.replace(a, b)
    return s

def main() -> None:
    d = EXE.read_bytes()
    out: list[dict] = []
    for ch in range(CHARACTERS):
        for ev in range(EVENTS):
            p = struct.unpack_from("<I", d, data_off(SPEECH_TABLE_VA) + STRIDE * ch + 4 * ev)[0]
            o = data_off(p)
            e = d.index(b"\x00", o)
            raw = d[o:e]
            text = big5_whatwg(raw[5:])
            voice = int(raw[1:5])
            rec: dict = {"character": ch, "event": ev, "voice": voice, "raw": text}
            if text.startswith("@"):
                rec["emoji"] = int(text[1:3])
            out.append(rec)
    if "--json" in sys.argv:
        json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
        print()
        return
    for r in out:
        mark = f"  @{r['emoji']:02d}" if "emoji" in r else ""
        print(f"{r['character']:2}/{r['event']:2}  #{r['voice']:4}  {r['raw']!r}{mark}")

if __name__ == "__main__":
    main()
