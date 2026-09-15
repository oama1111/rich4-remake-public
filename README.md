# 大富翁4 高清重制版

原版《大富翁4 超时空之旅》(v3.11, 2001) 的跨平台重制：确定性引擎 + 原生桌面 + 联机对战。

开发计划与全部硬性约束见 [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md)。

> **接手的人先读 [`docs/handoff.md`](docs/handoff.md)** —— 未干完的活、方法论铁律、
> 反汇编速查、环境坑，都在那一份里。

## 素材来源

原版素材（`assets/game/`）已随仓库入库，桌面版也**随包附带**——
打出来的 `.app` 双击即可运行，不会问你任何路径。

这是个人练习项目的定位（见 DEVELOPMENT_PLAN.md §5.6 的 C-LEG-2 / C-LEG-3）。
⚠️ 若日后要公开发布，把 `bundle.resources` 去掉即可回到「玩家自备目录」模式——
那条读取外部目录的路径始终保留着，只是平时用不到。

原作版权归 **大宇资讯 / 软星科技** 所有。

## 跑起来

```bash
pnpm install

# 浏览器里玩（开发最快）
pnpm dev                       # → http://localhost:5180
#   可选参数：?humans=1&ai=3&map=0&seed=7&chars=0,3,5,7

# 打一个可双击的桌面版
pnpm --filter @rich4/desktop build
#   产物：packages/desktop/src-tauri/target/release/bundle/macos/大富翁4 重制版.app
```

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
