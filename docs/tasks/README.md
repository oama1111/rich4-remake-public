# 任务卡片

- `cards.yaml`：**唯一的卡片来源**，机器可读（每张卡一个条目，字段见下）。
- `cards.md`：由 `python3 tools/task-cards.py render` 生成的可读版，**不要手改**。
- `python3 tools/task-cards.py check`：校验 id 唯一、依赖存在、无环、字段齐全。

## 字段

| 字段 | 含义 |
|---|---|
| `id` | `T-nnn`，唯一 |
| `title` | 一句话，动词开头 |
| `module` | PRD 的 `MOD-nn` |
| `req` | PRD 的 `REQ-nn.m` 或 §11 的 `P*-n` |
| `status` | `todo` / `doing` / `done` / `blocked` |
| `estimate` | 工作单元（1 单元 ≈ 一个专注工作日）的小数 |
| `depends_on` | 必须先完成的卡片 id；**没有依赖的卡可以并行** |
| `uses` | 会调用/修改的现有类、函数、文件（依赖的其他类） |
| `source` | 证据：VA、asm 文件、截图编号 |
| `input` / `output` | 期望的输入与输出（数据形状） |
| `algorithm` | 核心逻辑指导（步骤/伪代码） |
| `tests` | 验收：写哪些测试、怎么算通过 |
| `files` | 要新建/修改的文件 |
| `notes` | 偏差、坑、登记到 known-deviations 的编号 |

## 解耦原则

1. 一张卡只改**一个模块**里的**一个功能**；跨模块的接口先单独立一张「契约卡」（如 T-001），别的卡依赖它。
2. 卡片之间只通过 PRD 里的 API 签名耦合，不通过实现细节。
3. 完成 = 卡片 `tests` 全绿 + `pnpm check` 三绿 + PRD/§11 同步。
