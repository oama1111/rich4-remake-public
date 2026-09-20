#!/usr/bin/env python3
"""
列出 `player_say`（VA 0x0044ef41）全部调用点，以及每个调用点**前后**紧邻的「阻塞演出」调用。

用途：台词触发时机审查（第五份回报第 5 条）。原版的台词是**同步**说的，
它与影片 / 訊息框 / 镜头的先后次序 = 这些 call 在函数里的先后次序。
本脚本只做机械抽取（不解读跳转）：数据来自 `../rich4-spec/gen/db.txt` 的线性反汇编。

用法：python3 tools/speech-callsites.py > docs/tasks/speech-callsites.md
"""
import os
import re
import sys

ROOT = os.environ.get("RICH4_WORKSPACE") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB = os.path.join(ROOT, "rich4-spec", "gen", "db.txt")

SAY = 0x44EF41
# 阻塞 / 可见的演出调用（名字是本项目文档里已经定名的）
STAGE = {
    0x45144F: "播影片 play_flic",
    0x40B0CD: "播 0x20b 烟花",
    0x440CAC: "訊息框 notice(ms)",
    0x44B6DF: "事件框 event_box",
    0x40E2A2: "神明台词窗 god_say",
    0x440706: "神明轉盤窗",
    0x440BA8: "Yes/No 框",
    0x41D476: "镜头 view_to",
    0x41D546: "刷屏 refresh(清镜头标记)",
    0x4542CE: "音效 play_sfx",
    0x43EC3F: "送醫院 send_to_hospital",
    0x43D593: "送監獄 send_to_prison",
    0x41D2C6: "付款 pay_money",
    0x41D3F4: "进帐 receive_money",
    0x44F230: "好消息台词阶梯 say_good",
    0x44F2C2: "坏消息台词阶梯 say_bad",
    SAY: "★ player_say",
}
WINDOW = 45  # 前后各看多少条指令

ins_re = re.compile(r"^\s+([0-9a-f]{8})\s+(\S+)\s*(.*)$")
func_re = re.compile(r"^# (0x[0-9a-f]{8})\s+(\S+)")


def main() -> None:
    insns = []  # (va, mnem, ops, func)
    func = "?"
    with open(DB, encoding="utf-8") as f:
        for line in f:
            m = func_re.match(line)
            if m:
                func = m.group(1)
                continue
            m = ins_re.match(line)
            if m:
                insns.append((int(m.group(1), 16), m.group(2), m.group(3), func))

    def target(i):
        va, mn, ops, _ = insns[i]
        if mn != "call":
            return None
        m = re.match(r"0x([0-9a-f]+)", ops)
        return int(m.group(1), 16) if m else None

    sites = [i for i in range(len(insns)) if target(i) == SAY]
    print("# `player_say`（VA 0x0044ef41）调用点 × 相邻演出调用（机械抽取）\n")
    print("> 由 `tools/speech-callsites.py` 生成，**不要手改**。窗口 = 调用点前后各 %d 条指令（不跨函数）。" % WINDOW)
    print("> 「前」列按**执行方向**从远到近排；线性窗口不解读跳转 —— 分支关系要回 `disasm.py va` 核对。\n")
    print("| # | 调用点 | 所在函数 | 表情实参(arg2) | 之前的演出调用（远→近） | 之后的演出调用（近→远） |")
    print("|---|---|---|---|---|---|")
    for n, i in enumerate(sites, 1):
        va, _, _, fn = insns[i]
        before, after = [], []
        for j in range(max(0, i - WINDOW), i):
            if insns[j][3] != fn:
                continue
            t = target(j)
            if t in STAGE:
                before.append("`%08x` %s" % (insns[j][0], STAGE[t]))
        for j in range(i + 1, min(len(insns), i + 1 + WINDOW)):
            if insns[j][3] != fn:
                break
            t = target(j)
            if t in STAGE:
                after.append("`%08x` %s" % (insns[j][0], STAGE[t]))
        # arg2 = 调用前倒数第二个 push（cdecl：最后压的是 arg1）
        pushes = []
        for j in range(i - 1, max(0, i - 8), -1):
            if insns[j][1] == "push":
                pushes.append(insns[j][2].split("  ")[0].strip())
            if len(pushes) == 3:
                break
        arg2 = pushes[1] if len(pushes) >= 2 else "?"
        print("| %d | `0x%08x` | `%s` | `%s` | %s | %s |" % (
            n, va, fn, arg2, "<br>".join(before[-6:]) or "—", "<br>".join(after[:4]) or "—"))
    print("\n共 %d 处。" % len(sites), file=sys.stdout)


if __name__ == "__main__":
    main()
