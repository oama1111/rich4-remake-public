# 上报清单（C 级问题）

> 执行方遇到 [`WORKPLAN.md`](WORKPLAN.md) 里定义的 **C 级**问题、或触发「三次止损」时，在**文末**追加一条。
> 首席批量处理；处理完在条目标题前加 `✅` 并写结论，不删条目。

## 模板

```
### E-<序号>（<日期>）<一句话标题>
- 关联任务：W-xx
- 现象：（命令 + 输出原文 / 种子 + 回合 + 局面）
- 已试过：（做法与结果；没试过就写"无"）
- 我的怀疑：（可以没有；**不许把怀疑当结论写进代码**）
- 阻塞程度：阻塞 W-xx / 不阻塞
```

---

<!-- 在此线以下追加 -->

### E-1（2026-09-19）桌面包「冷启动 < 3 s」的**标题屏首帧**在本机量不到（缺权限）

- 关联任务：W-04（性能三条的第三条）
- 现象：
  - 能拿到的：`open "大富翁4 重制版.app"` → **窗口出现**，5 次 = 1.889 / 0.377 / 0.411 / 0.380 / 0.436 s，
    中位数 **0.411 s**（脚本 `tools/coldstart-probe.py`，pyobjc 直查 `CGWindowListCopyWindowInfo`）。
  - **拿不到的**：`窗口出现 → 标题屏画出来` 这一段。
    - `CGWindowListCreateImage` 抓到的窗口位图**全黑**（无「屏幕录制」权限），
      算「非黑像素占比」恒为 0，无法判断画面是否已出；
    - `osascript -e 'tell application "System Events" to count processes'` **卡在权限提示上**，
      实测 60 s 超时被杀（`[timed out after 60000ms]`）。
  - 已有的替代证据：网页版 `navigationStart → first-contentful-paint = 88 ms`，
    `DOMContentLoaded / load = 293 ms`（同一台机器，见 `docs/acceptance/perf-20260919.md` §3/§5）。
- 已试过：
  1. pyobjc `CGWindowListCopyWindowInfo` 轮询窗口出现 —— 成功（上表）；
  2. pyobjc `CGWindowListCreateImage` + 非黑像素占比判「画面出来了」—— 全黑，判不出来；
  3. `osascript` / `System Events` 查窗口 —— 卡权限提示，60 s 超时；
  4. `screencapture` —— 与 2 同因（无屏幕录制权限）。
- 我的怀疑：给终端/本 harness 进程**「屏幕录制」+「自动化」**权限即可自动量出
  `open → 标题屏`（法 2 就能用：判「窗口位图出现 ≥5% 非黑像素」）；否则只能真机秒表。
- 阻塞程度：**阻塞 W-04 的「冷启动 < 3 s」取证**（其余两条 —— 60 FPS / 内存 —— 已达标），
  不阻塞阶段 1 的其他任务。已按「未取证」记进 `docs/acceptance/perf-20260919.md`，**没有按达标算**。

