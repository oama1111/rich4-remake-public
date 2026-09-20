# W-70..W-76 —— 上线成网页版 + 朋友联机（需求方 2026-09-20 拍板）

> 首席撰写，执行方（DeepSeek）照做。**这一份全是本项目自己新增的功能，没有原版对照** ——
> 所以这里没有汇编可读，也**不许**去读汇编；不确定的地方**写进 `escalations.md` 问**，不许猜。
> 一条任务一个分支一个 PR，按编号顺序做。每个 PR 末尾照抄文末的自查清单。

## 0. 需求方已经拍板的三件事（不再讨论）

1. 素材**可以**放在需求方自己的域名上，但整站加**访问密码**，且**不让搜索引擎收录**。
2. 两三百兆素材怎么加载由首席评估（见 §1），硬要求：**对局过程中不能卡顿**。
3. 「指针自动跳到按钮上」在浏览器里做不到 —— 接受，不处理。

另外需求方提了多人玩法的四个要求（W-73 / W-74 / W-75 落实）：
玩家要有**自己的名字**；要能**建立 / 加入房间、开始游戏**；**每回合最长 60 秒**，超时自动掷骰往下走；
**一直不动就交给电脑代打，并告诉其他玩家**。

## 1. 首席的素材加载评估（结论 + 数字，W-72 按这个做）

| 档案 | 原始 | gzip -6 | 什么时候要用 |
|---|---|---|---|
| map.mkf | 76.6 MB | 30.9 MB | 开机就要（`loadArchives`）|
| Data.mkf | 54.2 MB | 33.8 MB | 同上 |
| jump.mkf | 28.9 MB | 15.2 MB | 同上 |
| Panel.mkf | 25.9 MB | 14.6 MB | 同上 |
| help.mkf | 0.4 MB | — | 同上 |
| Speaking.mkf | 57.0 MB | 33.0 MB | 进棋盘时后台拉（`ensureSpeakingArchive`）|
| Effect.mkf | 3.9 MB | 2.4 MB | 开机后台拉 |
| `*.mid` | 共 < 1 MB | — | 换曲时按名字拉 |
| **合计** | **≈ 247 MB** | **≈ 130 MB** | |

- **对局中途不会因为素材卡**：档案整份在内存里，精灵是按需同步解的。首席用无头 WebKit 实测
  （2026-09-20，自动对局 236 秒 / 41 回合 / 10269 帧，中途触发两段神明影片）：
  超过 50 ms 的帧 21 个、超过 100 ms 的 2 个（最长 111 ms）、**超过 250 ms 的 0 个**。
  105 段 FLIC 影片的解码单段最长 44 ms。⇒ 只要**不在对局中途走网络**，就不卡。
- 所以风险只有一处：**首次打开要下 130 MB**（20 Mbps ≈ 52 秒；100 Mbps ≈ 11 秒）。
  对策就三条，W-72 逐条做：① 带真实进度的载入屏；② **全部 7 个档案在進標題畫面之前下完**
  （现在 Speaking / Effect 是后台拉的 —— 联机时第一句语音会丢，改成一起等）；
  ③ 下完存进浏览器的 **Cache Storage**，第二次打开 0 流量秒进。
- 内存：7 个档案常驻 ≈ 247 MB（`ArrayBuffer`，不占 JS 堆上限）+ JS 堆实测 300–365 MB。
  桌面浏览器没问题；**手机不支持**（本来也要右键），载入屏上写一句即可，不做适配。
- `assets/hd/` 是空的：线上**不要**去拉 `hd-manifest.json`（3.8 MB 白下）。

## 2. 总体形态（先看懂再动手）

```
浏览器 ──HTTPS──> Caddy（自动证书，只做反向代理）──> 一个 Node 进程 :8787
                                                    ├─ GET /login, POST /login      （不需要 cookie）
                                                    ├─ GET /robots.txt              （不需要 cookie）
                                                    ├─ GET /*            静态站 = packages/client/dist-web
                                                    ├─ GET /assets/game/<白名单>    原版素材（预压缩 .br/.gz）
                                                    └─ WS  /ws           现有的联机集线器（hub.ts）
```

**一个进程、一个端口**：静态站、素材、WebSocket 全在 `packages/server` 里。不要引入 express / koa /
任何 web 框架 —— 用 Node 自带的 `node:http` + 现有的 `ws`，依赖不增加。

---

## W-70（A）生产服务器骨架：静态站 + 素材白名单 + `/ws`

**改哪里**：新文件 `packages/server/src/http-server.ts`、`packages/server/src/static.ts`；
改 `ws-server.ts`（让它能挂在一个已有的 `http.Server` 上，`path: '/ws'`）、`cli.ts`（加参数）。

1. `cli.ts` 新参数（都有缺省，老用法 `pnpm start` 不变）：
   `--web <dir>`（静态站目录，给了才开 HTTP 静态服务）、`--assets <dir>`（缺省 `assets/game`）、
   `--host`（缺省 `127.0.0.1` —— **只听本机**，公网流量由 Caddy 转进来）。
2. 素材**白名单**（写成常量并单测）：文件名必须整条匹配
   `^(Data|Panel|map|jump|help|Speaking|Effect)\.mkf$` 或 `^[A-Za-z0-9_-]+\.mid$`（大小写不敏感地找磁盘文件，
   因为 `main.ts:3339` 先试原名再试小写）。**其余一律 404** —— `assets/game` 里有 `rich4.exe`、`Uninst.exe`、
   存档、`.avi`，一个都不许端出去。
3. 路径安全：先 `decodeURIComponent`，含 `..`、`\`、`\0`、以 `/` 开头的二段路径一律 400；
   解析后的绝对路径必须 `startsWith(根目录 + sep)`，否则 403。静态站同理。
4. 响应头：
   - 素材：`Cache-Control: private, max-age=31536000, immutable`（URL 带版本号，见 W-72）、
     `Accept-Ranges: none`；若同目录有 `<name>.br` / `<name>.gz` 且请求头 `Accept-Encoding` 接受，就回那一份并带
     `Content-Encoding` 与 `Vary: Accept-Encoding`。
   - 静态站：`index.html` 用 `no-cache`；带哈希的 `assets/*.js|css` 用 `immutable`。
   - **所有响应**：`X-Robots-Tag: noindex, nofollow, noarchive`、`X-Content-Type-Options: nosniff`、
     `Referrer-Policy: no-referrer`。
5. `GET /robots.txt` 固定回 `User-agent: *\nDisallow: /\n`。
6. 客户端：联机地址不再只靠 `?ws=`。`net-client.ts` 的 `netParamsFrom` 保留；另加
   `defaultWsUrl(location)`：`https:` → `wss://<host>/ws`，`http:` → `ws://<host>/ws`（W-73 用）。
7. 预压缩脚本 `tools/precompress-assets.ts`：对白名单里的 `.mkf` 生成 `.br`（`zlib.brotliCompressSync`，quality 9，
   `BROTLI_PARAM_SIZE_HINT`）与 `.gz`（level 9），**输出到 `--out` 指定的部署目录**，
   **不许写进 `assets/game/`**（那是只读目录），也不许提交进仓库。

**测试**（`static.test.ts` / `http-server.test.ts`，用真 `http.Server` 听随机端口）：
白名单 7 个 mkf + 一个 mid 能取；`rich4.exe`、`Save0.dat`、`Start.avi`、`../package.json`、`%2e%2e%2fpackage.json`、
`/assets/game//etc/passwd` 全部非 200；三个安全头在 200/404/403 上都在；`/robots.txt` 正文逐字相等；
有 `.br` 时带 `Accept-Encoding: br` 拿到 `Content-Encoding: br`，不带就拿原文件。

**验收**：`pnpm --filter @rich4/client build` 后
`node --experimental-transform-types packages/server/src/cli.ts --web packages/client/dist-web`，
浏览器开 `http://localhost:8787/` 能进標題畫面并单机开一局。

---

## W-71（A）访问密码（整站一道门）

**这是给朋友用的共享密码，不是账号系统** —— 不做注册、不做找回、不存用户表。

1. 配置只从**环境变量**来：`RICH4_PASSWORD`（必填，缺了进程**拒绝启动**并打印原因）、
   `RICH4_COOKIE_SECRET`（必填，≥ 32 字节随机串）。**不许**有缺省密码，**不许**写进仓库 / 日志 / 报错信息。
2. `GET /login`：一张最朴素的 HTML 表单（一个密码框 + 提交），内联样式，无外部资源。
   `POST /login`（`application/x-www-form-urlencoded`，正文上限 1 KB）：
   - 用 `crypto.timingSafeEqual` 比对（两边先各自 SHA-256 再比，避免长度泄露）；
   - 对：发 cookie `rich4_gate=<过期时刻>.<HMAC-SHA256(secret, 过期时刻)>`，
     `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`，HTTPS 下加 `Secure`（看 `X-Forwarded-Proto`）；303 → `/`；
   - 错：**固定延迟 500 ms** 后回 401 同一张表单 + 「密碼錯誤」。
   - 限流：同一 IP（`X-Forwarded-For` 最左一段，没有就 socket 地址）每分钟最多 5 次 POST，超了回 429。
     用内存 Map，每分钟清一次过期项，上限 10000 条（超了整表清空）。
3. 门：除 `/login`、`/robots.txt` 外的**每一个** HTTP 请求都先验 cookie（HMAC 对、未过期）；
   不过：`Accept` 含 `text/html` 的 → 303 `/login`，其余（素材 / js）→ 401。
4. **WebSocket 升级同样要验**：在 `server.on('upgrade')` 里验同一个 cookie，不过就
   `socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')` 后 `destroy()`；另外校验 `Origin` 头的 host 等于 `Host` 头
   （挡跨站 WebSocket 劫持）。
5. 开发便利：`--no-gate` 参数（只在 `--host` 为 `127.0.0.1` / `localhost` 时允许，否则拒绝启动）。

**测试**：无 cookie 取 `/`→303、取 `/assets/game/Data.mkf`→401、WS 升级→401；错密码 401 且耗时 ≥ 450 ms；
第 6 次 POST → 429；篡改 cookie 一位 → 拒；过期 cookie → 拒；对密码 → 之后三样都通；跨 Origin 的 WS → 拒；
缺任一环境变量 → `startServer` 抛错且**报错文本里不含密码**。

---

## W-72（A）载入屏 + 持久缓存（对局中途零网络）

**改哪里**：新文件 `packages/client/src/asset-loader.ts`（纯逻辑，可单测）；改 `assets.ts` 的 `loadArchives`、
`main.ts` 的 `boot()` / `ensureSpeakingArchive()` / `Effect.mkf` 那处 fetch（`main.ts:3939`、`:9488` 附近）。
**桌面壳（`isDesktop()`）走老路，一行都不要变。**

1. 构建期生成 `assets-manifest.json`（`tools/precompress-assets.ts` 顺手产出，放部署目录的 `/assets/game/` 下）：
   `{ "version": "<全部 sha256 拼起来再 sha256 的前 12 位>", "files": [{ "name", "size", "sha256" }] }`。
2. `asset-loader.ts` 导出 `loadAllArchives(base, onProgress)`：
   - 先取 manifest（`cache: 'no-store'`）；取不到（开发服务器没有它）⇒ 退回现有逻辑，不报错。
   - 对 7 个 `.mkf`：URL = `${base}/${name}?v=${sha256 前 8 位}`。先 `caches.open('rich4-assets-v1')` → `match(url)`；
     命中直接 `arrayBuffer()`；没命中就 `fetch` + `res.body.getReader()` 逐块读，读完
     `cache.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }))`。
   - **进度的分母用 manifest 的 `size`（原始字节）**，分子用读到的解码后字节数 ——
     带 `Content-Encoding` 时 `Content-Length` 是压缩后的，不能用。
   - 并发 **3**（7 个一起拉会互相抢带宽，进度条乱跳）。单个失败重试 2 次（间隔 1 s / 3 s），再失败整体失败。
   - 下完校验长度 `=== size`，不等就当失败（不校验 sha256：247 MB 在主线程算哈希本身就是一次卡顿）。
   - 收尾：`cache.keys()` 里 `?v=` 不属于当前 manifest 的项全部 `delete`；调一次 `navigator.storage?.persist?.()`（结果只记日志）。
   - `caches` 不存在（非安全上下文 / 隐私模式）⇒ 静默降级成纯 `fetch`。
3. 载入屏：沿用现在 `metaEl` 那一行文字的位置，改成
   `正在载入原版素材… 63%` + 一条 320 px 宽的进度条（DOM，不进 canvas）。**只显示百分比，不显示 MB 数** ——
   分母是原始字节（247 MB）而实际流量是压缩后的（≈130 MB），两个数放一起会让人以为下多了。
   首次访问多写一句「首次载入约 130 MB，之后会缓存在本机」。失败时给「重試」按钮。
4. `boot()` 改为等 **7 个档案全部到齐**再进標題畫面；`Speaking.mkf` / `Effect.mkf` 到齐后直接
   `sound.addArchive(...)`。`ensureSpeakingArchive()` 在网页版变成空操作（保留函数，桌面壳仍用它）。
5. 网页版**跳过** `loadHdSource()`（`assets/hd` 是空的，manifest 3.8 MB 白下）：`hdBase()` 在 manifest 的
   `files` 里没有 `hd-manifest.json` 时不发请求。

**不许做**：不许引入 Service Worker（调试成本高，Cache Storage 在页面里就能用）；不许把素材打进 `dist-web`；
不许改 `MkfArchive` / 解码器。

**测试**（`asset-loader.test.ts`，注入假的 `fetch` 与假的 `caches`）：首次 7 个都走网络且都 `put`；第二次 0 次网络；
manifest 版本变了 ⇒ 旧键被删、只重下变了的那个；进度回调单调不减且终值 = 总 `size`；长度不符 ⇒ 重试后失败；
`caches` 为 `undefined` ⇒ 照样成功；并发峰值 ≤ 3。

**验收**（前台标签页，DevTools 限速 Fast 3G 以上任一档）：首次有进度条并走到 100%；刷新后 Network 面板里 7 个
`.mkf` **0 请求**；开一局自动打 3 分钟，Network 面板除 `.mid` 与 `/ws` 外**没有新请求**。

---

## W-73（B）门厅：名字、建立 / 加入房间、邀请链接

**为什么用 DOM 不用 canvas**：名字要打中文，canvas 里接不了输入法。门厅是本项目自己的界面，
**不碰任何复刻屏**（標題畫面那 5 颗钮一颗都不加不改）。

1. 新文件 `packages/client/src/foyer.ts`（DOM 覆盖层，盖在 canvas 上，样式内联）。只在**网页版**
   （`!isDesktop()`）且 URL 里**没有** `screen=` 调试参数时，在素材载入完成后、標題畫面之前出现。三个入口：
   - **單機遊戲** → 关掉覆盖层，走现有標題畫面。
   - **建立房間** → 生成房间码（6 位，字符集 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`，用 `crypto.getRandomValues`）→ 进大厅。
   - **加入房間** → 输入 6 位房间码（自动转大写、去空格）→ 进大厅。
   名字框：必填，去首尾空白后 1–12 个字符（按 `[...name].length` 数），记在 `localStorage['rich4.name']`。
   URL 带 `?room=XXXXXX` 时直接停在「加入」并填好房间码（= 邀请链接）。
2. 进大厅 = 用 `defaultWsUrl(location)`（W-70）+ 房间码 + 名字，走**现有**的 `NetClient` 与 `lobby.ts`。
   大厅里加一颗 DOM 按钮「複製邀請連結」（`https://<host>/?room=<码>`，`navigator.clipboard.writeText`）。
3. **身份改用令牌，不再靠名字认座位**（现在 `hub.ts` 的 `#assignSeat` 是「同名且断线中就认回」——
   两个朋友起同名会串座）：
   - 客户端首次生成 `clientId`（16 字节随机 → 32 位十六进制），存 `localStorage['rich4.clientId']`；
   - `ClientMessage` 的 `join` 加必填字段 `clientId: string`，`PROTOCOL_VERSION` **+1**；
   - 服务器 `SeatSlot` 记 `clientId`，认回座位的判据改成 **`clientId` 相同**且该座位断线中；
     名字重复**允许**（显示时不去重）。`clientId` **不进** `SeatInfo`（不广播给别人）。
   - 服务器校验：`clientId` 匹配 `^[0-9a-f]{32}$`，名字 1–12 字符、去掉控制字符（`\p{Cc}`），
     房间码匹配 `^[A-HJ-NP-Z2-9]{6}$`；不合就回 `error` 并断开。
4. 房间生命周期（`hub.ts`）：全桌无人在线超过 **10 分钟**的房间删除（挂在现有 `sweepDisconnected` 的定时器里）；
   同时存在的房间上限 **50**，满了新建回 `error`「伺服器房間已滿」。
5. 老的 `?ws=…&room=…&name=…` 调试入口**保留**（`tools/net-e2e.js` 在用）：它没有 `clientId` 时客户端照样从
   `localStorage` 取 / 生成。

**测试**：`foyer.test.ts`（房间码字符集与长度、名字校验、邀请链接解析）；`hub.test.ts` 加：同名两人各占一座；
同 `clientId` 断线重连认回原座（名字改了也认回）；不同 `clientId` 同名**不**认回；非法 `clientId` / 房间码被拒；
10 分钟无人 ⇒ 房间被删；第 51 个房间被拒。`tools/net-e2e.js` 必须仍然全绿。

---

## W-74（B）回合计时：60 秒不动 → 电脑代这一回合；连续两次 → 託管

**原则**：计时器**只活在服务器**，结果一律以**广播的 action** 落地 —— 各客户端不自己判超时，锁步不破。
单机模式完全不受影响。

### 74-a 服务器怎么知道「在等谁」
每广播一条 action 之后，从房间镜像（`Room` 里的 `state`）算 `awaited`：
**直接用 `room.actingSeat`**（`room.ts:112`，内部就是 core 的 `actingSeat(镜像)` —— 竞价时是举牌者，
平时是 `currentPlayer`；issue #9 / E-2 已经把这个判据收成唯一一处，**不要另写一套**）。该座位是**真人、在线、未託管** ⇒ 要计时；否则不计时。

### 74-b 什么时候开始数
各客户端要先把动画演完，玩家才点得了 —— 不能从广播那一刻数。
- 新增 `ClientMessage`：`{ t: 'awaiting'; seq: number }`。**轮到本机座位**、且 `stageBusy()` 为假、
  且画面停在等输入（`awaitingRoll` 或有 `pending`）时，客户端对当前 `seq` **发一次**（同一 `seq` 不重发）。
- 服务器收到且 `seq` 是最新、发件人就是 `awaited` ⇒ 开始数 **60 秒**（`turnMs`，`cli.ts` 参数 `--turn-ms`，缺省 60000；0 = 关闭计时）。
- 兜底：广播后 **45 秒**还没收到 `awaiting` ⇒ 也开始数（客户端卡死 / 标签页被挂起）。
- 该座位发来任何合法 `intent` ⇒ 当前计时作废，按新局面重新走 74-a。

### 74-c 玩家在忙（逛股市、百貨公司里挑东西）怎么办
- 新增 `ClientMessage`：`{ t: 'alive' }`。本机座位被等待期间，只要有鼠标 / 键盘输入，客户端**每 10 秒最多发一次**。
- 服务器收到 ⇒ 截止时刻延到 `max(现值, now + 30 秒)`，但**硬上限** = 开始数的时刻 + **180 秒**，到了一定超时。

### 74-d 超时之后
1. 服务器 `submitSystem({ type: 'setAi', player, whoPlays: HUMAN|AUTOPILOT })` 并广播（与掉线代打同一条路），
   然后 `#driveComputers` —— 电脑替他把**这一回合**走完（掷骰、买不买地、竞价等一律由 core 的 AI 决定）。
2. 该座位 `strikes += 1`。**他的回合一结束**（镜像里 `currentPlayer` 离开他）：
   - `strikes < 2` ⇒ 服务器自动 `setAi` 改回 `HUMAN`；
   - `strikes ≥ 2`（**连续**两回合超时）⇒ 保持託管，`SeatInfo.autopilot = 'idle'`。
3. 该座位任何时候发 `{ t: 'resume' }`（新增；客户端在本机座位被託管时，玩家**点一下画面**就发）⇒
   `strikes = 0`、`setAi` 改回 `HUMAN`、广播。回合中途收回也允许（与重连归还同一段代码）。
4. 玩家在自己回合里**正常发过 intent 并走完**一回合 ⇒ `strikes = 0`。

### 74-e 让所有人看见
- 新增 `ServerMessage`：`{ t: 'clock'; seat: number; remainingMs: number; hardRemainingMs: number }` ——
  开始数、被 `alive` 延长、作废（`remainingMs: -1`）时各发一次。**发剩余毫秒，不发时间戳**（各机时钟不准）。
- `SeatInfo` 加可选字段 `autopilot?: 'offline' | 'idle'`（掉线代打 / 超时託管），随 `room` 消息广播。
- 客户端：剩余 ≤ 20 秒时在棋盘右上角显示倒计时（DOM 覆盖层，`12` 这样的大数字 + 座位名）；轮到自己时最后 10 秒变红。

**`PROTOCOL_VERSION` 再 +1**（与 W-73 分两次加，各自的 PR 各自加）。

**测试**（`hub.test.ts`，时钟全部注入，不许用真 `setTimeout` 睡）：
`awaiting` 后 60 s 超时 ⇒ 广播 `setAi`、回合被走完、回合结束后自动改回 `HUMAN`；连续两次 ⇒ 保持託管且
`autopilot === 'idle'`；`resume` ⇒ 归还且 `strikes` 清零；`alive` 能延到但不超过 180 s；没发 `awaiting` ⇒ 45 s 后照样开数；
非 `awaited` 座位发 `awaiting` / `alive` 被忽略；电脑座位、掉线座位不计时；竞价中计的是**举牌者**不是回合主人；
`--turn-ms 0` ⇒ 永不超时。`tools/net-e2e.js` 加一段：一端故意不动 ⇒ 另一端在 61–70 秒内看到回合推进。

---

## W-75（A）联机提示：谁进来了、谁掉线、谁被託管

新文件 `packages/client/src/net-toast.ts`：DOM 覆盖层，右下角堆叠，每条 4 秒自收，最多同时 3 条。
**只在联机时出现**，不进 canvas、不走原版訊息框（那是复刻屏，不往里加本项目的文案）。
触发（比较前后两份 `RoomInfo`，纯函数 `roomToasts(before, after): string[]`，单测）：
`{名字} 加入了房間` / `{名字} 離線了，30 秒後由電腦代打` / `{名字} 回來了` /
`{名字} 超時，這一回合由電腦代打` / `{名字} 連續超時，已交給電腦託管（點一下畫面即可收回）` —— 最后一条只发给其他人，
被託管的本人看到的是常驻横幅「你已被託管，點一下畫面收回」。

---

## W-76（A）部署文档与脚本

1. `deploy/Caddyfile.example`：`<域名> { encode zstd gzip; reverse_proxy 127.0.0.1:8787 }`
   （WebSocket Caddy 自动转；**素材已经预压缩，Caddy 的 `encode` 不会二次压**，因为响应已带 `Content-Encoding`）。
2. `deploy/rich4.service.example`（systemd）：`EnvironmentFile=/etc/rich4.env`（权限 600，里面是两个环境变量），
   `ExecStart=node --experimental-transform-types packages/server/src/cli.ts --web … --assets …`，`Restart=on-failure`，
   非 root 用户。
3. `docs/deploy.md`：从一台空的 Ubuntu 24.04 到能玩的逐条命令；怎么生成两个密钥（`openssl rand -hex 32`）；
   怎么更新（`git pull && pnpm install && pnpm --filter @rich4/client build && systemctl restart rich4`）；
   怎么换密码（改 env 文件 + 重启；换 `RICH4_COOKIE_SECRET` 会让所有人重新登录）。
4. **红线**（写进文档开头）：素材与预压缩产物**只存在于服务器磁盘**；不许提交进仓库、不许打进公开的 Docker 镜像、
   不许传到任何公开的对象存储 / CDN。仓库保持 private。

---

## 每个 PR 的自查清单（照抄进 PR 描述末尾并逐条打勾）

- [ ] 我没有读汇编，也没有改任何复刻屏（標題 / 開局設定 / 棋盘 / 各整屏）的版式与行为。
- [ ] 单机模式与桌面壳（`isDesktop()`）的行为一行没变（贴了单机开一局的截图）。
- [ ] 密码、密钥没有出现在仓库、日志、报错文本、测试快照里。
- [ ] 素材白名单之外的文件一个都取不到（贴了 `curl -i` 取 `rich4.exe` 的 404）。
- [ ] 新测试在旧实现上是**红**的（贴了那次红的输出）；计时类测试没有用真睡眠。
- [ ] `pnpm check` 汇总行：`… passed`，`0 skipped`，测试总数没有变少；`tools/net-e2e.js` 仍然全绿。
- [ ] 「没做 / 不确定的」已写进 `escalations.md`（没有就写「无」）。
