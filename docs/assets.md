# 素材：什么进库、什么不进

> ⚠️ **本文件同时随公开的 code-only 镜像发布。**镜像里 `assets/` 已被整体移除、也没有 Git LFS，
> 所以下面「✅ 入库」说的是**带素材的那份私有仓库**；在镜像上跑，`assets/game/` 要**自备**
> （就是原版《大富翁4 超时空之旅》v3.11 的安装目录），桌面版按运行时读取外部目录那一档走
> —— 这正是下文「为什么源头是 `assets/game/` 而不是 `Rich4/`」里 C-LEG-3 的「玩家自备目录」模式。

## 一句话

**只有源头进库。派生物一律重算。**

```
assets/game/          ← 原版安装目录，64 个文件 237MB，走 Git LFS  ✅ 入库
    ↓ packages/assets-pipeline（我们自己的代码）
extracted/            ← mkf 解包结果，2680 文件 289MB              ❌ 不入库
assets-clean/         ← 解出的 PNG，13034 张 515MB                 ❌ 不入库
    ↓ 超分模型
assets/hd/            ← 画质升级产物                                ❌ 不入库（见下）
```

三个派生目录加起来 825MB，**全部可以由 `assets/game/` 重新生成**。
版本化它们等于把同一份数据在仓库里存两遍。

## 为什么超分产物也不入库 —— 这条和「升级画质」直接相关

13,034 张图。4 倍超分后像素是原来的 16 倍，一轮产物大概 **4–8 GB**。

关键在于 **git 会永久保留每一个版本**。真实的升级画质流程不会一次成功：
换模型、调参数、发现某类图（文字／UI／小图标）效果不好要单独重跑……
每迭代一轮就是一份完整副本进历史，**删掉文件也删不掉历史里的那份**。
试三轮就是 20GB 起，clone 和 checkout 会变得很难受。

所以这里版本化的是**配方而不是成品**：

```
assets/hd-manifest.json     ← 入库。记录每张图用了什么模型、什么参数、
                               输入哈希、输出哈希
assets/hd/                  ← 不入库。按配方重新跑就能得到
```

好处是**可复现**：拿到仓库的人（包括半年后的你）能确切知道
第 7 号图是用哪个模型、什么参数做出来的，而不是面对一堆来历不明的 PNG。

### 如果你确实想把某一版 HD 成品也存进去

`.gitattributes` 里已经给 `assets/hd/**` 配好了 LFS 规则，
只要把 `.gitignore` 里的 `assets/hd/` 那行删掉即可。

建议**只对最终定稿版本**这么做，中间迭代仍走 manifest。
LFS 的历史可以事后 `git lfs prune` 清理，但那是补救，不如一开始就不放进去。

## 恢复派生物

```bash
pnpm --filter @rich4/assets-pipeline extract --game assets/game --out assets-clean
```

## 为什么源头是 `assets/game/` 而不是 `Rich4/`

原先的 `C-LEG-3` 要求「玩家自备原版目录」，程序启动时问路径。
项目所有者已确认本项目为个人练习（见 DEVELOPMENT_PLAN.md 的 C-LEG-2 修订），
故直接把原版目录纳入仓库，开发时不必再依赖机器上某个外部路径。

`Rich4/` 仍保留在仓库外且**只读**（C-AST-1），作为对照的原始副本。

桌面版（`packages/desktop`）再进一步：把 mkf 与配乐打进 `.app` 的
`Resources/`，**双击即可运行，不问路径**。

⚠️ 若本仓库日后要公开，`assets/game/` 必须移除、`bundle.resources` 去掉，
并改回运行时读取。
这也是把它单独放在一个目录、且全部走 LFS 的原因之一——
`git lfs prune` 加上一次历史重写就能干净地摘出去。

---

## 画质升级怎么走

```bash
# 1. 解包（若还没做过）
pnpm --filter @rich4/assets-pipeline exec node --experimental-strip-types \
  src/cli-extract.ts assets/game ../assets-clean

# 2. 生成待办清单
pnpm upscale plan ../assets-clean assets/hd

# 3. 用**你自己的**工具处理，产物放到 assets/hd/<档案>/<同名文件>
#    Real-ESRGAN / waifu2x / 在线服务 / 手工重绘都行——本管线不绑定任何模型

# 4. 回填，记下用了什么模型
pnpm upscale ingest ../assets-clean assets/hd realesrgan-x4plus-anime

# 5. 随时看进度
pnpm upscale status assets/hd
```

### 分批与倍率

13,034 张图，面积中位数约 4000 px（约 63×63），故**不是一刀切 4 倍**：

| 批次 | 张数 | 倍率 | 理由 |
|---|---|---|---|
| tiny | 4 | ×4 | 边长 ≤ 8，动漫超分模型容易糊边，可单独换模型 |
| small | 11,799 | ×4 | 绝大多数图素 |
| medium | 1,144 | ×3 | |
| large | 87 | ×2 | 640×480 全屏图再放 4 倍是 2560×1920，没必要且拖慢一个数量级 |

### ★ 锚点必须同步缩放（C-AST-6）

原版精灵靠 `graph_info` 的 x/y 对齐。超分后若锚点还是原值，
**所有精灵会整体偏移**——而且偏得很均匀，看起来像「美术做歪了」
而不像 bug，极难排查。

管线用**实际输出尺寸**而不是请求倍率来算锚点，因为不少工具会把结果
对齐到偶数或 4 的倍数，实际倍率与请求值并不完全相等。
这一步由 `recordResult()` 自动完成，是代码保证而非人工纪律。

### 增量重跑

`ingest` 会跳过已完成且源图未变的任务。换模型时传新的模型名，
用旧模型做的会被重新列入待办。
