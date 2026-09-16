# Q-GND-4 + Q-PERF-1 —— 底图进管线、接缝换口径、淘汰真释放、桌面 HD 路由

> 本文件是这两条缺口的**处置记录**（`known-deviations.md` 里对应两节已指向这里）。
> 只记「选了什么、为什么、实测到什么、还剩什么没做」。
> 复现命令都写在文末。
>
> 涉及文件：
> `assets-pipeline/src/{cli-extract,cli-upscale,ground,classify,upscale,slice,merge,seams}.ts`、
> `client/src/{assets,render,host}.ts`、`desktop/src-tauri/src/lib.rs`、对应 `*.test.ts`。

---

## 一、Q-GND-4：底图进管线

### 1.1 先前是什么样（现状复核）

`cli-extract` 对 `map.mkf` 的偶数号资源（`地图号 × 2`，`.gnd` 底图）走的是
「`parseSpriteSheet` 认不出 → `decodeFlic` 认不出 → **原样落盘**」那条尾巴：

- 落成 `assets-clean/map/0000.gnd`（5319312 字节，魔数 `GND\0`）；
- 因此**不在** `manifest.json` 的 `images` 里 —— 实测那份清单：
  `images 13034` 条里 `map` 占 2247 条、**最大宽度 400**、`width ≥ 1000` 的 **0 条**；
  `raw` 里恰好有 **8 个 `gnd`**（资源 0/2/4/6/8/10/12/14）。

于是 `planUpscale` 不为底图建任务，T-063 的 hd 回填与 T-064 的接缝检查**没有真实输入**
（旧卡的 notes 自己写着「只能用合成夹具验」）。

### 1.2 决策 A：先解成 PNG 再谈超分

底图不是 SPR/SMP/FLIC，是 `ground.ts` 那套格式（`GND\0` 头 + 512 字节调色板 +
5184 项 u16 块排布表 + 5242880 字节像素）。所以第一步只能是**用已有的解码器解成 PNG**。

做的改动（`cli-extract.ts`）：

```ts
if (isGround(data)) {
  const g = groundAsset(data, name, i);   // decodeGround + encodePng
  writeFileSync(join(dir, g.file), g.png);
  images.push(g.entry);
  groundCount++;
  continue;                                // ★ 排在 FLIC 与「原样落盘」之前
}
```

清单条目：

| 字段 | 值 | 为什么 |
|---|---|---|
| `file` / `input` | `map/0000_000.png` | 沿用 extract 的 `<资源>_<图>` 命名；图号固定 0（一整张就是一「帧」）|
| `format` | `'GND'` | 新加的格式值（`AssetEntry` / `AssetEntryLike` / `UpscaleTask` 三处的联合类型同步扩了）|
| `anchorX/Y` | `0 / 0` | 底图整幅贴，原版拿节点世界坐标直接取像素（`GROUND_ORIGIN = (0,0)`），没有「以某点为原点」这回事 |
| `width/height` | 解出来的实际值（八张图都是 2304×2304）|

分类（`classify.ts`）新增一条规则 `byGroundSource`：**`paletteKind === 'gnd'` → `tile`**，
排在「档案名 → ui」之后、「尺寸 → tile/background」之前。
理由：底图按尺寸（2304 ≥ 640×480）本会落进 `background`，但它**是地形**，
放大后**必须**过 T-064 的接缝检查（C-AST-7）。`tile` 与 `background` 的建议模型相同
（`realesrgan-x4plus`），所以这条只影响语义与理由，不影响工具选择。

### 1.3 决策 B：**整张放大**（不拆 32px 格）

两条路各自的代价（Q-GND-4 正文）都复核过，**选整张**。理由按分量从重到轻：

1. **32×32 对超分模型是分布外的小图。** 模型在 32×32 上看不到任何上下文，
   纹理与边缘只能靠幻觉补 —— 块内质量下降是确定的，而块间伪影恰恰是**最难修**的一类
   （它规则、成网、且与内容无关，肉眼一眼就能看出「拼出来的」）。
2. **C-AST-5 的「按帧」不是为底图设的。** 那一条针对的是**动画精灵**（整张精灵图直放会
   **跨帧串色**）；底图是**一整幅画面**，C-AST-5 明文允许「一图即一帧」——
   Q-GND-4 正文自己也是这么引的。
3. **底图没有透明区**，`slice` 的 alpha 分离在它身上是空转，整张放大也不会引入
   C-AST-4 的彩边问题（实测：交出去的 alpha 是一张全 255 的等灰图）。
4. **任务量与清单规模差三个数量级**：整张 = 8 条任务（8 张地图）；逐块 = 8 × 5184 =
   **41,472** 条，`manifest.json` 从 ~13k 条涨到 ~55k 条，`hd/` 下 4 万多个文件，
   `review` 页 4 万行。切/并/落盘的固定开销（每张一个 PNG、一条清单、一层目录）等比放大。
5. **客户端侧**：整张 = 换地图时加载**一张** 9216² 位图；逐块 = 要么 5184 次
   `fetch`，要么在客户端先拼回 9216²（等于又回到整张，还多一遍拷贝）。

**代价（必须认）**：模型内部若按 256/400px 分块（Real-ESRGAN 的 `--tile` 就是干这个的），
伪影会落在**模型自己的**分块线上，**与 32px 格毫无关系**。所以接缝判据必须换口径 —— §1.4。

**实测依据**（真实底图 `map/0000.gnd`，见文末复现命令）：

| 情形 | `compareTileSeams`（32px 格线）| `compareAllSeams`（新口径）|
|---|---|---|
| 忠实最近邻 ×4（无伪影）| 报 **0 / 10224** | 报 **0 / 4602** |
| 注入一条 **非格线**伪影（x=4000 → 原图 1000，`1000 % 32 = 8`）| 报 1 条，**落在伪影附近的 0 条** | 报 3 条，**全部 `onGrid=false`**，最差 `+11.1 ΔE @ x=4000` |

即：**逐块放大那套口径对模型内部分块线一条都查不到**；这不是推测，是在真实地图上量出来的。

### 1.4 接缝检查改成什么口径：`compareAllSeams`

`seams.ts` 新增（与 `compareTileSeams` 并存，不是替换）：

- **不比格线，比每一条线**：竖线取**原图每一个像素边界** `xo = band .. W−band`
  （放大图上是 `xo × scale`），横线同理。72 格线只是其中的 71 条。
- **仍用相对判据**：`after − before > 一个 JND(2.3)`。绝对阈值已被实测证伪
  （原版底图同时有高频纹理与真地形交界，绝对阈值 100% 误报），这条不动。
- **只取 `scale` 的整数倍位置**。非整数倍的位置在原图里**没有对应物**，比出来的只是
  「附近」的基线 —— 实测连**忠实最近邻**放大都会在噪声纹理上假报（带内均值差达一个 JND 量级）。
  放宽到非整数倍换不来检测能力（超分工具的分块尺寸都是 128/192/256/400 这类整数），只换来噪声。
- **取带范围是整幅的高/宽**（`compareTileSeams` 取的是一格高）。模型固定分块时，
  同一个 `x = k·T` 的竖缝会在每个块行上**共线重复**，整幅平均不会把它稀释掉；
  反过来只看一格高更容易被局部高频纹理带偏。代价：对「只在局部一小段出现的伪影」不敏感（已登记）。
- **报告带 `onGrid`**，把「原版 32px 块界」与「模型自己的分块线」分开 ——
  后者才是换口径的意义所在。
- **实现**：每列/每行的 RGB 前缀和（一次 `O(W·H)`），之后**每条线 O(1)**，
  不必对每条线重扫全图。实测 9216² 全扫 **1.6–2.9s**。

CLI 接线：新增 `upscale seams <hd> <assets-clean> [地图号…]`，对每张有产物的底图
**两张口径各跑一遍**并打印摘要（非格线那一条用 `★` 顶出来）。

### 1.5 决策 C：内存 / 显存与 C-PERF-2

C-PERF-2（内存 < 1.5GB）管的是**运行时客户端**。两个层面分开说。

**客户端（C-PERF-2 的适用面）**

- 4× 后是 9216×9216。RGBA8 一张 = `9216² × 4 = 324 MiB`，
  占 1.5GB 预算的 **21%**。
- **它不该走 `SpriteCache` 的 LRU。** LRU 的前提是「一堆图里只有少数在用」；
  底图是「只要在棋盘上就一直在用」的那一张 —— 放进 LRU 等于**永久驻留**，
  还会把 4096 张的额度挤掉一块。所以底图继续走 `loadGround()` 那条**专用**路径
  （一张/每张地图；换地图时 `main.ts` 把引用丢掉再重新解，**没有**显式 `close()`，靠 GC 回收 ——
  真要抠这 324MB 就补一次 `old?.close()`），**不进** `DEFAULT_MAX_SPRITES` 的预算。
- ⚠️ 浏览器对 `ImageBitmap` 面积有引擎各自的上限。9216² = **8490 万像素**，
  主流桌面引擎能拿得住，但低端/移动端需要实测 —— 这是选整张路线**唯一**的环境性风险，
  也是将来可能重新考虑逐块路线的地方（先记着，不预先改）。

**离线管线（不受 C-PERF-2 约束，但同一台机器上跑，一并记下）**

实测（9216²，真实底图放大到 ×4 的忠实产物）：

| 步骤 | 耗时 | `arrayBuffers` |
|---|---|---|
| `decodeGround`（2304²）| 76ms | 25MB |
| `groundAsset`（解 + encodePng store）| 386ms | 127MB（PNG 20.3MB）|
| `sliceFrame`(2304²) + 两张 PNG | 809ms | 167MB |
| 造 9216² 忠实 ×4 | 1.6s | 410MB（324MB/张）|
| `mergeUpscaled`(9216²) | 9.4–14s | **1058MB** |
| `encodePng`(9216²) | 5.1s | **2030MB** |
| `assemble` 的尺寸守卫 `decodePng` | 3.6s | 2030MB |
| **峰值** | | **2030MB ArrayBuffers / RSS 1561MB** |

**已经做的收窄**（都写在代码注释里）：

- `binarizeAlpha`：输入已是「全不透明」的规范形 → **原样返回**，不复制 324MB；
- `deFringe`：没有边界像素 → `out` **按需分配**，一次都不拷；
- `rebleedTransparent`：没有透明像素 → 原样返回，连 `bleedColors` 那本 BFS 账都不开；
- `bleedColors`：**全不透明时直接返回**（每个像素自己就是源，BFS 一步都不扩散，
  结论逐字节相同），省掉一个 **8.5M 元素**的 JS 队列（9216² 上几十 MB）；
- `cmdMerge`：合并完成即放开交出去的那两张解开的图（少 648MB）。

若不做这几条，`merge` 会再多吃 ≈ 324（binarize）+ 324（deFringe 副本）
+ 324（rebleed out）+ 254 + 85（bleed 的 rgb/visited）+ BFS 队列 ≈ **1.35GB**，
即峰值到 **~2.4GB**。

**仍未做的收窄**（登记，不在本轮范围内）：`encodePng` 把同一份 340MB（`9216² × 4 + 行过滤字节`）
**拷了三遍**（`raw` → IDAT chunk → 最终数组）。把它改成单缓冲、或按块流式写文件，
峰值能再降 ≈ 680MB（2030MB → ~1.35GB）。这一步动的是全项目共用的 PNG 编码器
（`cli-extract` 每次解包也走它），属单独一张卡的事，本轮**有意不做**。

---

## 二、Q-PERF-1：LRU 淘汰要真的释放内存

### 2.1 症状与安全边界

`SpriteCache` 的 LRU 只把条目移出**它自己**那张表。真正握着 `ImageBitmap` 的是
`render.ts` 的 `#ready`（`Map<string, Sprite|null>`），所以淘汰之后内存一点不降。
而**不能**在淘汰回调里就地 `close()`：`drawImage` 拿到已关闭的位图会画成空白。

**帧边界在哪**（本轮重新推了一遍，结论写进了 `render.ts` 的类注释）：

- 淘汰回调发生在**解码完成后的微任务**里（`#sprites.get(...).then(...)`），
  也就是**两帧之间** —— 同步的 `draw()` 里不可能跑微任务，所以淘汰**不会**发生在绘制中途；
- 于是安全的分界点很清楚：**淘汰时只摘引用 + 排队；下一帧 `draw()` 的
  **第一件事**才真正 `close()`**。此刻上一帧的 rAF 回调早已整个跑完
  （画布上的 `drawImage` 是同步落地的），队列里每一张都确定「不会再被任何一帧用到」。

### 2.2 实现

- `assets.ts`：`onEvict` 由「单个回调」改成**监听列表**（`addEvictListener`）。
  为什么不是「设一个属性」：缓存有**两个持有者**（`render.ts` 与 `hud.ts` 各一张 `#ready`），
  属性式赋值会让后挂的悄悄把先挂的挤掉，症状是「有一边的内存再也放不掉」。
  构造参数 `onEvict` 仍然可用（push 进列表）。
- `assets.ts`：`DeferredSpriteClose`（`retire` / `drain` / `pending`），
  `BoardRenderer` 在构造时 `sprites.addEvictListener((s) => this.#evicted.retire(this.#ready, s))`，
  并在 `draw()` 的**第一行** `this.#evicted.drain()`。
  ★ 挂监听的时机选在**渲染器构造**里，是因为 `SpriteCache` 是在 `main.ts` 里造的，
  而 `main.ts` 不在本卡范围 —— 渲染器本来就拿得到同一份缓存，不必外面接线。
- **安全规则**：`retire` 返回 0（并**不排队**）时说明这个精灵**不是本渲染器持有过的**
  （是 HUD 的）。那种一律不动 —— 谁也别去关别人还在用的位图。

### 2.3 桌面端 HD 路由

先前：`rich4://localhost/<名>` 一律解析到**原版安装目录**，而 HD 产物在仓库/包内的
`assets/hd/`、清单在它同级 —— 两者不同源，桌面端要用 HD 得给协议加路由。

`desktop/src-tauri/src/lib.rs` 新增：

- `hd_dir(app)`：HD 素材根（即 `assets/`，`hd/` 与 `hd-manifest.json` 都在它下面）。
  先找包内（`Resources/assets`、`Resources/_up_/_up_/_up_/assets`），
  再从可执行文件往上找仓库的 `assets/`（`cargo run`/dev 那条）。
- `is_hd_path(path)`：**只放行** `/hd-manifest.json` 与 `/hd/…` 两条 ——
  它们**正是前端拼出来的 URL**（`host.ts` 的 `hdBase()` = `rich4://localhost/hd`，
  `loadHdSource` 拉 `${hdBase()}-manifest.json`）。前缀蒙对（`/hdx`、`/hd` 不带斜杠）不算。
- 协议处理里先分流：HD 路由 → HD 素材目录（要 JSON 就给 `application/json`），
  其余 → 原版安装目录。找不到 HD 目录时**回 404**，前端 `loadHdSource` 拿到 null，
  **整包走原图**，与 `assets/hd/` 为空时的行为一模一样。

**回退路径照旧**（Q-PERF-1 的第 3 条要求）：

- 浏览器：`hdBase()` = `/assets/hd`，vite 中间件挂了就取、没挂就 404 → null → 原图；
- 桌面：HD 根不存在 → 404 → null → 原图；
- 已有 6 条回退测试（无来源 / 拉不到 / 坏 PNG / 按图混用 / 空槽 / 缓存命中）全绿，
  本轮再加了「HD 根判据」与「URL 形状」两条。

---

## 三、**没解出 / 有意没做**（接手清单）

| # | 是什么 | 为什么没做 | 怎么收尾 |
|---|---|---|---|
| 1 | ~~**客户端还没真正加载 HD 底图**~~ ✅ **2026-09-16 已接** | — | `loadGround(archives, 地图号, hd, decode)` 第三/四参数：按 `hd.entry('map.mkf', 地图×2, 0)` 判断，命中就 `fetchBytes` → Blob → 原生解码；**缺记录/拉不到/坏图**都按图回退 `.gnd`（不是整包降级）。释放策略：`main.ts` 新增 `setGround()`，换图时先 `close()` 旧位图（HD 9216² 是 324MB，不能等 GC）。单测 `assets.test.ts`「loadGround：有 HD 就用 HD」五条 |
| 2 | `encodePng` 三次拷贝（≈680MB）| 动的是全项目共用的编码器（extract 也走它），属单独一张卡 | 改成单缓冲 in-place 写（zlib 的 stored 块可原地填），或按块流式写文件 |
| 3 | ~~HUD 那份 `#ready` 没接淘汰监听~~ ✅ **2026-09-16 已接** | — | `hud.ts` 构造里 `addEvictListener` + 新增 `drainEvicted()`（`Hud.draw()` 开头调）—— 与 `render.ts` 同一条帧边界推理；单测 `hud.test.ts`「侧栏的淘汰监听」三条 |
| 4 | 桌面端**打包**没接 HD | `tauri.conf.json` 的 `resources` 里没有 `assets/hd` —— 该目录被 `.gitignore` 排除、干净 clone 里根本不存在，写进去会让没跑过超分的人连构建都过不去 | 先解决「产物不入库但构建需要它」（构建脚本先跑管线、或允许缺失），再把 `assets/hd` 加进 resources |
| 5 | 接缝判据对**局部**伪影不敏感 | 整幅取带的必然代价（见 §1.4）| 需要时把取带改成滑窗（前缀和已经支持 O(1) 任意窗口，代价是常数变大） |
| 6 | 接缝**自动修补**没接线 | `featherSeams` 是**有损**的（会把真地形硬边抹柔），旧设计就写了「默认不自动跑，由人看过报告再决定」 | 保持人工 |
| 7 | `assets/hd-manifest.json`（仓库里那份）还是旧清单 | 它是 `plan` 的产物，要跟着重新解包后的 `manifest.json` 重跑 | `pnpm unpack` → `pnpm upscale plan` 即可（产物不入库，清单入库）|

---

## 四、复现命令

```bash
# 1) 单测（本轮新增/改动的都在里面）
npx vitest run packages/assets-pipeline packages/client/src/assets.test.ts packages/client/src/render.test.ts

# 2) 类型检查与 lint
npx tsc -b --pretty
npx eslint packages/assets-pipeline/src packages/client/src/assets.ts packages/client/src/render.ts packages/client/src/host.ts --max-warnings=0

# 3) 真实数据：底图进清单（解包会重写 assets-clean/）
pnpm unpack -- ../Rich4 <out>            # cli-extract：现在会多出 map/0000_000.png 等 8 张
pnpm upscale plan <out> assets/hd        # 8 条 GND 任务（tile / 4× / large）

# 4) 真实数据的接缝检查（需要 hd 里已有底图产物）
pnpm upscale seams assets/hd <out>       # 两套口径各跑一遍，非格线那一条带 ★
```

§1.3 与 §1.5 的数字来自一次性测量脚本（`decodeGround` / `groundAsset` /
`sliceFrame` / `mergeUpscaled` / `compareTileSeams` / `compareAllSeams` / `encodePng`
跑同一张 `map/0000.gnd`），跑完即删，**不入库**。
