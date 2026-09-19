#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
W-04 的桌面包冷启动测量（macOS）—— 「open → 窗口出现」的秒数与中位数。

★ 为什么需要它：`open` 之后没有别的客观时间点可抓。`osascript` 问 `System Events`
  会卡在「自动化」权限提示上（实测 60 s 超时），所以改用 pyobjc 直查 WindowServer 的
  `CGWindowListCopyWindowInfo`（不需要权限，只返回窗口归属与矩形）。

★ **它量不到「标题屏首帧」**：`CGWindowListCreateImage` 拿到的位图在没有
  「屏幕录制」权限时全黑，无法判断画面是否已经画出来。所以本脚本给的是**下界**
  （窗口出现），报告里必须写明这一点 —— 见 docs/acceptance/perf-20260919.md §5。

跑法（需要带 pyobjc 的 python）：
  /Volumes/Kingston/大富翁4重制版/.venv-shot/bin/python tools/coldstart-probe.py \
      "dist-macos 解压出来的/大富翁4 重制版.app" [--runs 5] [--shots DIR]
"""

from __future__ import annotations

import argparse
import statistics
import subprocess
import sys
import time

try:
    import Quartz  # type: ignore
except ImportError:
    print("需要 pyobjc（Quartz）：用工作区根目录的 .venv-shot/bin/python 跑本脚本", file=sys.stderr)
    sys.exit(2)

BIN = "rich4-desktop"


def windows_for(pid: int) -> list:
    wl = Quartz.CGWindowListCopyWindowInfo(
        Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements,
        Quartz.kCGNullWindowID,
    )
    return [w for w in wl if w.get("kCGWindowOwnerPID") == pid]


def measure(app: str) -> float | None:
    subprocess.run(["pkill", "-x", BIN], capture_output=True)
    time.sleep(2.0)
    t0 = time.monotonic()
    subprocess.run(["open", app], check=True)
    pid: int | None = None
    while time.monotonic() - t0 < 25:
        if pid is None:
            p = subprocess.run(["pgrep", "-x", BIN], capture_output=True, text=True)
            if p.stdout.strip():
                pid = int(p.stdout.split()[0])
        elif windows_for(pid):
            return time.monotonic() - t0
        time.sleep(0.05)
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description="桌面包冷启动：open → 窗口出现")
    ap.add_argument("app", help=".app 路径")
    ap.add_argument("--runs", type=int, default=5)
    args = ap.parse_args()

    times: list[float] = []
    for i in range(1, args.runs + 1):
        t = measure(args.app)
        times.append(t if t is not None else float("nan"))
        print(f"run {i}: {'超时（25s 内没看到窗口）' if t is None else f'{t:.3f} s'}", flush=True)
        subprocess.run(["pkill", "-x", BIN], capture_output=True)
        time.sleep(1.0)

    ok = [t for t in times if t == t]
    if ok:
        print(f"中位数：{statistics.median(ok):.3f} s（n={len(ok)}）")
    print("⚠️ 这是「窗口出现」的下界，不是「标题屏首帧」——见脚本头注释与报告 §5。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
