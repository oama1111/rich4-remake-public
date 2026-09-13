# 大富翁4 高清重制版

原版《大富翁4 超时空之旅》(v3.11, 2001) 的跨平台重制：确定性引擎 + 原生桌面 + 联机对战。

开发计划与全部硬性约束见 [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md)。

## 素材来源

本项目**不包含任何原版素材**。游戏运行需要你自备正版《大富翁4》安装目录，
首次启动时指定路径，由程序现场解包（参见 DEVELOPMENT_PLAN.md §5.6 C-LEG-3）。

原作版权归 **大宇资讯 / 软星科技** 所有。

## 开发

```bash
pnpm install
pnpm test        # 跑测试
pnpm typecheck   # 类型检查
pnpm lint        # 约束检查（含确定性规则强制）
pnpm check       # 以上全部
```

## 致谢

本项目的可行性完全建立在 **Iru Cai (mytbk)** 及协作者自 2018 年起的大富翁4 逆向工程之上：
- https://github.com/mytbk/rich4 (GPL-3.0-or-later)
- https://codeberg.org/vimacs/rich4_asm

本项目同样采用 **GPL-3.0-or-later**。
