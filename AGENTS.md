# 给自动化代理（任何模型 / 任何 harness）

**动手之前按顺序读**：

1. [`docs/WORKPLAN.md`](docs/WORKPLAN.md) —— 任务清单、A/B/C 分级、**硬规则**、PR 模板、验收口径。
2. [`docs/handoff.md`](docs/handoff.md) 顶部「现状速览」—— 环境、路径约定、门禁数字。
3. 任务涉及规则/数值时：`docs/PRD.md` 与 `../rich4-spec/docs/systems/*.md`。

**三条最容易犯的错**：

- 为了变绿去改测试断言 —— 禁止（WORKPLAN §2 规则 3）。
- 凭感觉补一个数值 / 坐标 / 分支 —— 禁止（规则 4）。拿不准就写 [`docs/escalations.md`](docs/escalations.md)，换下一个任务。
- `pnpm test` 出现 `skipped` 还当成全绿 —— 那是原版目录没找到（`RICH4_WORKSPACE`，见 `vitest.config.ts`）。

门禁：`pnpm check`。仓库含原版素材，**必须保持 private**。一任务一分支 `ds/<任务号>-<slug>`，开 PR，不直接推 `main`。
