# 从一台空 Ubuntu 24.04 到能玩 —— 逐条命令

> 面向需求方（服务器在你手上）。照抄即可；**每一步都给了一条能验证它的命令**。
> 对应的代码：W-70..W-76（`docs/tasks/W-70-web-multiplayer.md`）。

---

## ⛔ 红线（先读这一段）

1. **素材与预压缩产物只存在于服务器磁盘上**：
   - **不许**提交进仓库（`.gitignore` 已经挡了 `*.br` / `*.gz` / `assets-manifest.json`）；
   - **不许**打进任何**公开**的 Docker 镜像；
   - **不许**传到任何公开的对象存储 / CDN（S3 公开桶、Cloudflare R2 公开域……）。
2. **仓库保持 private**（它含原版素材，走 LFS）。不发公开 release、不 fork 到公开仓库。
3. 整站只有**一道共享密码** —— 那是唯一的门，选一个只有朋友知道的，别用你的常用密码。
4. 这台机器上**只有 80/443 对公网开**；Node 进程只听 `127.0.0.1:8787`。

---

## 0. 需要什么

| 项 | 说明 |
|---|---|
| 机器 | 1 vCPU / 1 GB 内存 / **≥ 5 GB 磁盘**就够（素材 247 MB + 预压缩 116 MB + 仓库） |
| 系统 | Ubuntu 24.04 LTS |
| 域名 | 一个 A 记录指向这台机器的域名（Caddy 用它申请证书） |
| 账号 | 能 `sudo` 的普通用户 |

> ⚠️ **内存**：浏览器那边 7 个档案常驻约 247 MB（`ArrayBuffer`，不占 JS 堆上限）。
> 服务器本身很轻，1 GB 足够。

---

## 1. 装 Node 22 与 pnpm

```bash
sudo apt update && sudo apt install -y curl git rsync lsof
# Node 22（仓库要求 >= 22）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v            # 期望 v22.x
# pnpm（走 corepack，版本跟着仓库的 packageManager 走）
sudo corepack enable
pnpm -v            # 期望 12.x
```

## 2. 建一个非 root 的用户与目录

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin rich4
sudo mkdir -p /srv/rich4 && sudo chown rich4:rich4 /srv/rich4
sudo -u rich4 -H git -C /srv/rich4 clone https://github.com/oama1111/rich4-remake.git
# ⚠️ 私有仓库：先把这台机器的部署密钥加到 GitHub（repo 只读即可）
```

## 3. 装依赖、构建前端

```bash
cd /srv/rich4/rich4-remake
sudo -u rich4 -H pnpm install --frozen-lockfile
sudo -u rich4 -H pnpm --filter @rich4/client build
ls packages/client/dist-web/index.html   # 期望：文件在
```

## 4. 摆素材（原件 + 预压缩 + 清单）

**服务端不读仓库里的 `assets/game/`**，它读的是**部署目录**里的那一份：

```bash
cd /srv/rich4/rich4-remake
sudo -u rich4 mkdir -p /srv/rich4/deploy/assets/game
# ① 原件（7 个 .mkf + 25 个 .mid；其余 exe/存档/avi 一个都不要搬）
sudo -u rich4 rsync -a \
  assets/game/Data.mkf assets/game/Panel.mkf assets/game/map.mkf \
  assets/game/jump.mkf assets/game/help.mkf assets/game/Speaking.mkf \
  assets/game/Effect.mkf /srv/rich4/deploy/assets/game/
sudo -u rich4 rsync -a --include='*.mid' --exclude='*' assets/game/ /srv/rich4/deploy/assets/game/

# ② 预压缩（brotli q9 + gzip 9）并**顺手产出清单**（约 1 分钟）
sudo -u rich4 -H pnpm precompress --from assets/game --out /srv/rich4/deploy
ls /srv/rich4/deploy/assets/game | head        # 期望：7 个 .mkf + 各 .br/.gz + assets-manifest.json
```

> ★ 脚本**只压不复制**，也**只压白名单里的 7 个 `.mkf`**（`rich4.exe` / 存档 / `.avi`
> 一个都不会进部署目录）。它还会拒绝 `--out` 落在素材目录里。

## 5. 两个密钥

```bash
sudo install -m 600 /dev/null /etc/rich4.env
# 自己挑一个密码 + 让 openssl 生成密钥
sudo tee /etc/rich4.env >/dev/null <<EOF
RICH4_PASSWORD=$(openssl rand -base64 18)
RICH4_COOKIE_SECRET=$(openssl rand -hex 32)
EOF
sudo chown rich4:rich4 /etc/rich4.env
sudo chmod 600 /etc/rich4.env
sudo cat /etc/rich4.env      # 抄下密码，告诉朋友；看完关掉
```

> ⚠️ 缺任何一个变量，进程会**拒绝启动**并打印原因（`RICH4_PASSWORD` / `RICH4_COOKIE_SECRET`
> 的名字都会写清楚）—— 报错文本里**不会**出现密码本身。

## 6. 起服务

```bash
cd /srv/rich4/rich4-remake
sudo cp deploy/rich4.service.example /etc/systemd/system/rich4.service
# 按需改里面的路径（默认 /srv/rich4/rich4-remake 与 /srv/rich4/deploy/assets/game）
sudo systemctl daemon-reload
sudo systemctl enable --now rich4
systemctl status rich4 --no-pager
sudo journalctl -u rich4 -n 30 --no-pager
```

启动日志里应当有这几行：

```
rich4 聯機伺服器：http://127.0.0.1:8787/  ws ws://127.0.0.1:8787/ws  …  回合 60s
回合計時：60s 不動就由電腦代打（連續兩回合 ⇒ 託管）
素材目錄：/srv/rich4/deploy/assets/game
訪問密碼：開著（RICH4_PASSWORD / RICH4_COOKIE_SECRET 從環境變數來）
```

本机先验一遍（**应该在 127.0.0.1 上**）：

```bash
curl -sI http://127.0.0.1:8787/ | head -3          # 期望 303 → /login（没带票）
curl -s  http://127.0.0.1:8787/robots.txt         # 期望 User-agent: * / Disallow: /
curl -sI http://127.0.0.1:8787/assets/game/rich4.exe | head -1   # 期望 404
```

## 7. Caddy（TLS + 反代）

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

sudo cp /srv/rich4/rich4-remake/deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo sed -i 's/rich4\.example\.com/你的真域名/g' /etc/caddy/Caddyfile   # ← 换成真域名
sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy
# ★ 示例里有一行 `header_up X-Forwarded-For {remote_host}` —— **别删**。
#   Caddy 缺省是把这个头**追加**（客户端自己带的在前、真实来源在后），
#   而服务器按它给登录限流分桶：不覆盖的话，最左那段是攻击者随便填的，
#   5 次/分钟的上限就被绕过了（见 docs/escalations.md E-37）。
sudo systemctl reload caddy || sudo systemctl restart caddy
sudo journalctl -u caddy -n 20 --no-pager     # 期望看到证书申请成功 + 反代 200
```

防火墙（**只开这两个**）：

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

## 8. 邀请朋友进来

1. 让朋友打开 `https://rich4.example.com/`；
2. 看到登录页 → 输 `RICH4_PASSWORD`；
3. 进**门厅** → 输名字 → **建立房間** → 把大厅底部那颗「複製邀請連結」的链接发给他们；
4. 朋友点开链接 → 房间里自动填好房间码 → **加入房間** → 房主按 **開始**。

首次打开要下 ≈130 MB（服务器发的是预压缩后的 `.br`），**之后会缓存在他们本机**，
第二次打开 0 流量。

---

## 怎么更新

```bash
cd /srv/rich4/rich4-remake
sudo -u rich4 -H git pull
sudo -u rich4 -H pnpm install --frozen-lockfile
sudo -u rich4 -H pnpm --filter @rich4/client build
sudo systemctl restart rich4
```

**素材变了**（换了原版目录 / 重新解包）时才需要重跑第 4 步的 `rsync` 与 `precompress`；
只改代码的话上面四条就够。

## 怎么换密码

```bash
sudo nano /etc/rich4.env          # 改 RICH4_PASSWORD（或两个都改）
sudo systemctl restart rich4
```

- 只改 `RICH4_PASSWORD`：**已经登录的人不会掉线**（他们的票还没过期），新登录用新密码。
- 改 `RICH4_COOKIE_SECRET`：**所有人立刻失效**，下次打开要重新输密码。
  怀疑票被别人拷走了就换它。
- 想让所有人**现在**就掉线：两个都换 + 重启。

## 怎么排查

| 现象 | 先看哪里 |
|---|---|
| 打不开 / 证书没过 | `sudo journalctl -u caddy -n 50`；域名解析对不对 |
| 502 | `systemctl status rich4`；进程是不是拒绝启动了（多半是 `/etc/rich4.env` 少了变量或权限不对） |
| 一直转圈在 303 | 票没过期但 cookie 被浏览器挡了（第三方 cookie / 隐私模式） |
| 登录报 429 | 两种限流：**同一来源**每分钟 5 次，**整台服务器**每分钟 60 次（后者不看来源，是防爆破的底）。等一分钟再试 |
| 素材 404 | `ls /srv/rich4/deploy/assets/game`；`--assets` 指的目录对不对 |
| 房间满了 | 服务器最多**同时 50 个房间**；没人在线的房间 10 分钟后自动回收 |
| 有人一回合不动 | 60 秒后由电脑代打；**连续两次**就交给电脑託管（他点一下画面能收回） |

## 这台机器上**不该**出现的东西

- 仓库之外的第二份素材副本（除了 `/srv/rich4/deploy/`）；
- 任何 `.mkf` / `.br` / `.gz` 被推到公开的地方；
- `--no-gate` 出现在 systemd 单元里（那等于把门拆了）。
