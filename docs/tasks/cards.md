# 任务卡片（自动生成，勿手改；改 cards.yaml 后重跑 `python3 tools/task-cards.py render`）

共 **73** 张卡，估算 **39.8** 单元，已完成 13.2。

| 组 | 名称 | 卡数 | 单元 |
|---|---|---|---|
| A | 核心契约与卡片接线（core） | 12 | 4.8 |
| B | AI 保真（core/ai） | 4 | 2.8 |
| C | 表现层 22 屏（client） | 37 | 22.1 |
| D | 画质升级管线（assets-pipeline） | 7 | 3.2 |
| E | 联网对战（server + client） | 8 | 4.7 |
| F | 规则补缺（known-deviations 剩余 Q 项） | 5 | 2.2 |

## 索引

| id | 标题 | 模块 | 需求 | 状态 | 单元 | 依赖 |
|---|---|---|---|---|---|---|
| [T-001](#t-001) | 扩展 CardTarget 联合类型与 validateTarget | MOD-06 | REQ-06.1 | `done` | 0.3 | — |
| [T-002](#t-002) | 把夢遊卡（16）接进 registry | MOD-06 | REQ-06.1 | `done` | 0.2 | — |
| [T-003](#t-003) | 搶奪卡（13）增加「抢卡片」路径并接进 registry | MOD-06 | REQ-06.1 | `done` | 0.5 | T-001 |
| [T-004](#t-004) | 請神符（23）接进 registry，目标为物件下标 | MOD-06 | REQ-06.1 | `done` | 0.3 | T-001 |
| [T-005](#t-005) | 紅卡（24）/ 黑卡（25）接进 registry，目标为股票下标 | MOD-06 | REQ-06.1 | `done` | 0.4 | T-001 |
| [T-006](#t-006) | 怪獸卡（11）接进 registry，支持地块与設施目标 | MOD-06 | REQ-06.1 | `done` | 0.4 | T-001 |
| [T-007](#t-007) | 拍賣卡（8）——把脚下地产送入拍賣 pending | MOD-06 | REQ-06.1 | `done` | 0.5 | — |
| [T-008](#t-008) | 天使/惡魔/拆除/漲價/查封 五张地块类卡支持設施目标 | MOD-06 | REQ-06.1 | `done` | 0.6 | T-001 |
| [T-009](#t-009) | AI 的 toCardTarget 覆盖全部目标类型（消除 Q-CARD-2 顺延） | MOD-09 | Q-CARD-2 | `done` | 0.2 | T-001, T-003, T-004, T-005, T-006, T-007, T-008 |
| [T-010](#t-010) | 停留/轉向/烏龜卡可指向四大惡人与機器娃娃（P0-11 卡片侧） | MOD-05 | REQ-05.1 | `done` | 0.6 | T-001 |
| [T-011](#t-011) | 魔法屋男性效果不影响四大惡人；路障/地雷对 NPC 的行为核对（P0-11 道具侧） | MOD-05 | REQ-05.1 | `done` | 0.3 | — |
| [T-012](#t-012) | 找到 NPC 记录 +14 halted / +15 single_step 的写入点并接进 runNpc（P0-12） | MOD-05 | REQ-05.2 | `done` | 0.5 | — |
| [T-013](#t-013) | 翻译股票打分函数 0x0042c075，AI 买哪一支（P1-4） | MOD-09 | REQ-09.1 | `done` | 1.0 | — |
| [T-014](#t-014) | 核对 AI 总调度顺序 fcn_00418c55（P1-5） | MOD-09 | REQ-09.2 | `done` | 0.5 | — |
| [T-015](#t-015) | AI 研發项目选择按研究所 UI 的电脑分支定案（P1-6） | MOD-09 | REQ-09.3 | `done` | 0.3 | — |
| [T-016](#t-016) | 翻译 AI 卖股 0x0042c79f（调度第 1 步） | MOD-09 | REQ-09.2 | `done` | 1.0 | — |
| [T-020](#t-020) | 新增 core 指令 setAi{player, whoPlays, aiFlags, personality}（託管AI 的规则侧） | MOD-04 | REQ-12.1 | `done` | 0.2 | — |
| [T-021](#t-021) | 託管AI 屏（工具列 #3） | MOD-12 | REQ-12.1 | `todo` | 0.6 | T-020 |
| [T-022](#t-022) | 個人資產表屏（工具列 #7） | MOD-12 | REQ-12.2 | `todo` | 0.5 | — |
| [T-023](#t-023) | 資產表下的三张清單（資產/地產/股票）翻页 | MOD-12 | REQ-12.2 | `todo` | 0.5 | T-022 |
| [T-024](#t-024) | 道具欄浮窗（工具列 #8，5×3 = 15 格） | MOD-12 | REQ-12.3 | `todo` | 0.5 | — |
| [T-025](#t-025) | 卡片欄浮窗（工具列 #9） | MOD-12 | REQ-12.3 | `todo` | 0.4 | T-024 |
| [T-026](#t-026) | 目标拾取模式（选玩家 / 地块 / 設施 / 物件 / 格子） | MOD-12 | REQ-12.3 | `todo` | 0.8 | T-001 |
| [T-027](#t-027) | 側欄四页（日历 / 月历 / 小地图 / 持股） | MOD-12 | REQ-12.4 | `todo` | 0.6 | — |
| [T-028](#t-028) | 小地圖旋转钮（地圖向左/右旋轉） | MOD-12 | REQ-12.5 | `todo` | 0.2 | — |
| [T-029](#t-029) | 銀行屏（存/取/貸/還 + 特別融資） | MOD-12 | REQ-12.6 | `todo` | 0.8 | — |
| [T-030](#t-030) | 股市屏（行情列表 + 买/卖） | MOD-12 | REQ-12.7 | `todo` | 0.8 | — |
| [T-031](#t-031) | 持股彙總屏（買股份 / 企業董事長） | MOD-12 | REQ-12.7 | `todo` | 0.5 | T-030 |
| [T-032](#t-032) | 商店屏（卡片/道具切换、买、卖自己的） | MOD-12 | REQ-12.8 | `todo` | 0.8 | — |
| [T-033](#t-033) | 公佈欄屏（挂 / 撤 / 买 / 出价输入） | MOD-12 | REQ-12.9 | `todo` | 0.8 | — |
| [T-034](#t-034) | 拍賣屏（PASS / +1000 / +5000、挥锤动画） | MOD-12 | REQ-12.10 | `todo` | 0.8 | — |
| [T-035](#t-035) | 樂透投注屏 | MOD-12 | REQ-12.11 | `todo` | 0.5 | — |
| [T-036](#t-036) | 樂透開獎动画屏 | MOD-12 | REQ-12.11 | `todo` | 0.5 | T-035 |
| [T-037](#t-037) | 魔法屋屏（外圈 12 功能悬停高亮 + 中央文字 + 音） | MOD-12 | REQ-12.12 | `todo` | 0.8 | — |
| [T-038](#t-038) | 監獄 / 醫院保釋屏（八个位子，含四大惡人） | MOD-12 | REQ-12.13 | `todo` | 0.6 | — |
| [T-039](#t-039) | 旅館 / 購物中心轉盤动画 | MOD-12 | REQ-12.14 | `todo` | 0.5 | — |
| [T-040](#t-040) | 研究所选項目屏 | MOD-12 | REQ-12.14 | `todo` | 0.4 | — |
| [T-041](#t-041) | 每月結算 + 頒獎屏 | MOD-12 | REQ-12.15 | `todo` | 0.5 | — |
| [T-042](#t-042) | 小游戏一：企鵝挖寶（specialKind 6） | MOD-12 | REQ-12.16 | `todo` | 1.0 | — |
| [T-043](#t-043) | 小游戏二：七彩氣球（specialKind 7） | MOD-12 | REQ-12.16 | `todo` | 1.0 | — |
| [T-044](#t-044) | 小游戏三（mkf 22，先认玩法与资源） | MOD-12 | REQ-12.16 | `blocked` | 1.0 | — |
| [T-045](#t-045) | 輔助說明屏（工具列 #1） | MOD-12 | REQ-12.17 | `todo` | 0.4 | — |
| [T-046](#t-046) | 走子补间动画与时序（玩家棋子） | MOD-12 | REQ-12.18 | `todo` | 1.0 | — |
| [T-047](#t-047) | 四大惡人与機器娃娃的棋子渲染与走子动画 | MOD-12 | REQ-12.18 | `todo` | 0.6 | T-046 |
| [T-048](#t-048) | 開局跳伞过场（可跳过） | MOD-12 | REQ-12.19 | `todo` | 0.5 | — |
| [T-049](#t-049) | 船（海路）棋子形态 | MOD-12 | REQ-12.19 | `todo` | 0.4 | T-046 |
| [T-050](#t-050) | 地塊归属彩边 + GO 钮三态 + 標題音效 | MOD-12 | REQ-12.19 | `todo` | 0.4 | — |
| [T-051](#t-051) | 解析 Speaking.mkf 語音索引（1375 段 → 事件/角色映射表） | MOD-11 | REQ-12.20 | `todo` | 0.8 | — |
| [T-052](#t-052) | 語音触发点接线（playSoundFor 扩展） | MOD-12 | REQ-12.20 | `todo` | 0.5 | T-051 |
| [T-053](#t-053) | 存档落到文件（Tauri fs，6 槽 + 自动） | MOD-13 | REQ-12.21 | `todo` | 0.5 | — |
| [T-054](#t-054) | 读原版 SAVE*.DAT 进游戏（导入入口 + 缺口提示） | MOD-12 | REQ-12.21 | `todo` | 0.4 | T-053 |
| [T-055](#t-055) | Windows 构建（Tauri） | MOD-13 | REQ-12.22 | `todo` | 0.5 | — |
| [T-056](#t-056) | Linux 构建（Tauri，AppImage） | MOD-13 | REQ-12.22 | `todo` | 0.5 | T-055 |
| [T-060](#t-060) | 素材分类器（UI / 地形 tile / 角色精灵 / 背景大图 / 字体） | MOD-11 | REQ-11.1 | `done` | 0.4 | — |
| [T-061](#t-061) | 按帧切片 + Alpha 分离，产出 upscale-queue/ | MOD-11 | REQ-11.1 | `todo` | 0.6 | T-060 |
| [T-062](#t-062) | 回填校验：尺寸恰 4×、Alpha 合并、去彩边 | MOD-11 | REQ-11.1 | `todo` | 0.6 | T-061 |
| [T-063](#t-063) | 重拼精灵 + 锚点 ×4 + 写 hd-manifest.json | MOD-11 | REQ-11.1 | `todo` | 0.4 | T-062 |
| [T-064](#t-064) | 地形 tile 接缝检查 | MOD-11 | REQ-11.1 | `todo` | 0.5 | T-063 |
| [T-065](#t-065) | SpriteCache 按图优先读 hd，缺则回退原图 | MOD-12 | REQ-11.1 | `todo` | 0.4 | T-063 |
| [T-066](#t-066) | 并排比对页（原图 / HD）供人工过审 | MOD-11 | REQ-11.1 | `todo` | 0.3 | T-063 |
| [T-070](#t-070) | WebSocket 服务器主循环（join / intent / 广播） | MOD-14 | REQ-14.1 | `done` | 0.8 | — |
| [T-071](#t-071) | 座位分配与断线重连（同名复用座位、since(seq) 补发） | MOD-14 | REQ-14.1 | `done` | 0.6 | T-070 |
| [T-072](#t-072) | checksum / desync 检测与处理 | MOD-14 | REQ-14.1 | `done` | 0.4 | T-070 |
| [T-073](#t-073) | AI 补位（掉线 30s 后服务器代打，重连归还） | MOD-14 | REQ-14.3 | `done` | 0.5 | T-071 |
| [T-074](#t-074) | 客户端联机模块 net-client（连接、发意图、按 seq 应用） | MOD-12 | REQ-14.2 | `todo` | 0.8 | T-070 |
| [T-075](#t-075) | 掷骰本地预测动画（结果以服务器为准） | MOD-12 | REQ-14.2 | `todo` | 0.3 | T-074 |
| [T-076](#t-076) | 联机大厅 UI（建房/加房/座位/角色/地图/开始） | MOD-12 | REQ-14.4 | `todo` | 0.8 | T-074 |
| [T-077](#t-077) | 联机端到端测试：4 客户端同进程跑完整局，与单机同种子逐字节一致 | MOD-14 | REQ-14 | `done` | 0.5 | T-071, T-072, T-073, T-074 |
| [T-080](#t-080) | 停牌中柜台不能买卖（Q-STOCK-3） | MOD-07 | Q-STOCK-3 | `done` | 0.1 | — |
| [T-081](#t-081) | 保險理賠接线：找齐 0x44ba63 的调用点（Q-INS-1） | MOD-07 | Q-INS-1 | `done` | 0.6 | — |
| [T-082](#t-082) | 設施收費前的三条免收 + 免費卡自动使用 + 死神顯靈由他人賠償（Q-FAC-2） | MOD-05 | Q-FAC-2 | `done` | 0.8 | — |
| [T-083](#t-083) | 魔法屋「就地加蓋房屋」对設施生效（Q-MAGIC-2） | MOD-07 | Q-MAGIC-2 | `done` | 0.2 | — |
| [T-084](#t-084) | 查封／漲價的涨价位进状态并按天递减（Q-LAND-2 + T-008 的設施部分） | MOD-05 | Q-LAND-2 | `done` | 0.5 | — |

## A · 核心契约与卡片接线（core）

### T-001

**扩展 CardTarget 联合类型与 validateTarget**

- 模块 `MOD-06` · 需求 `REQ-06.1` · 状态 `done` · 估算 0.3 单元
- 依赖：无（可立即开工）
- 被依赖：T-003, T-004, T-005, T-006, T-008, T-009, T-010, T-026
- 证据：card-registry.ts 的 selectionParam 分组；PRD §4.2

**依赖的其他类 / 文件**

- core/cards/target.ts (CardTarget, TargetClass, targetClassOf, validateTarget)
- core/state/actions.ts (useCard.target)
- core/ai/policy.ts (toCardTarget) —— 只读，不改

**期望输入**

    CardTarget 新增变体：
      { kind: 'facility'; facilityId }  { kind: 'stock'; index }  { kind: 'object'; objectIndex }
      { kind: 'actor'; actor: 4..8 }    { kind: 'node'; nodeId }
    TargetClass 新增：'landOrFacility' | 'stock' | 'object' | 'playerOrActor'

**期望输出**

    validateTarget(cls, target, cur, playerCount, extra?) → TargetError | null
    - 'land' 类接受 entity 与 facility；'player' 类在 allowActor 时接受 actor
    - 越界：facilityId/objectIndex/stock 范围由 extra { facilityCount, objectCount, stockCount } 给

**核心逻辑 / 算法指导**

    1. 只加类型与校验，不动任何卡的效果。
    2. targetClassOf：0xe0c0506/0626（怪獸/拆除）→ 'landOrFacility'；0xe0c0006（天使/惡魔/漲價/查封）→ 'landOrFacility'；
       0xe0c0202（換地/換屋）保持 'land'。紅/黑（selection:'ai'）→ 'stock'；請神 → 'object'。
    3. validateTarget 按类别判 kind 匹配 + 下标范围；不匹配返回 'wrongTargetKind'。
    4. 旧测试必须原样通过（向后兼容：entity 仍合法）。

**验收测试**

    target.test.ts：每个新变体各一条合法 + 一条越界；旧用例不变。

**涉及文件**

- packages/core/src/cards/target.ts
- packages/core/src/cards/target.test.ts

> 这是契约卡，T-003..T-010 依赖它。

### T-002

**把夢遊卡（16）接进 registry**

- 模块 `MOD-06` · 需求 `REQ-06.1` · 状态 `done` · 估算 0.2 单元
- 依赖：无（可立即开工）
- 证据：VA 0x004441dc（rich4_card_mengyouka.asm）

**依赖的其他类 / 文件**

- core/cards/sleepwalk.ts (applySleepwalkCard)
- core/cards/registry.ts (useCard switch)
- core/state/types.ts (Player.blocking.sleepWalking)

**期望输入**

    useCard(ctx, 16, { kind:'player', index })

**期望输出**

    players[index].blocking.sleepWalking 按原版置值；ok=true 后扣卡；目标在冬眠/已梦游/持復仇卡时按原版处理

**核心逻辑 / 算法指导**

    1. registry.ts 增加 case 16：调用 applySleepwalkCard(players, cur, target)。
    2. 失败（r.ok=false）→ fail(r.error ?? 'noEffect')，不扣卡。
    3. 敌意增量按 sleepwalk.ts 返回值合入 hostilityDeltas。

**验收测试**

    registry.test.ts：能出（目标正常）/ 不能出（目标是自己、目标出局）各一条。

**涉及文件**

- packages/core/src/cards/registry.ts
- packages/core/src/cards/registry.test.ts

### T-003

**搶奪卡（13）增加「抢卡片」路径并接进 registry**

- 模块 `MOD-06` · 需求 `REQ-06.1` · 状态 `done` · 估算 0.5 单元
- 依赖：T-001
- 被依赖：T-009
- 证据：效果函数 VA 0x0044192a：返回值 ebx 带 0x8000 → 道具路径（0x445aa2 take_tool + 0x445a4d give_tool）；
否则 → 卡片路径（0x441343 从对方手牌移除 + 0x4412e4 给自己）。AI 走卡片路径（[0x48be5c] = 卡号）。

**依赖的其他类 / 文件**

- core/cards/rob.ts (applyRobCard —— 现只有道具路径)
- core/rules/tools.ts (takeTool, giveTool)
- core/cards/registry.ts

**期望输入**

    useCard(ctx, 13, { kind:'player', index, steal: { kind:'card'|'tool', id } })
    —— 在 CardTarget.player 上加可选字段 steal（T-001 已预留扩展位，本卡定义它）

**期望输出**

    card：对方 cards 去掉一张 id，自己 cards 加一张；对方没有该卡 → fail('nothingToRob')
    tool：沿用现有 takeTool/giveTool（自己该道具已 9 件时凭空消失，照原版）

**核心逻辑 / 算法指导**

    1. rob.ts 新增 applyRobCardCard(players, cur, targetIndex, cardId)：
         if !players[target].cards.includes(cardId) → fail
         victim.cards = remove one occurrence；me.cards.push(cardId)（手牌上限 15，超出按原版 0x4412e4 的行为：查它是否拒收）
    2. registry case 13：按 steal.kind 分派；steal 缺省 → fail('targetRequired')。
    3. 敌意：对方对我 +（按 0x44192a 末尾的 update_hostility 调用值，读出来填 @source）。

**验收测试**

    rob.test.ts：抢卡成功/对方没有/手牌满；抢道具沿用旧测试。registry.test.ts 各一条。

**涉及文件**

- packages/core/src/cards/rob.ts
- packages/core/src/cards/registry.ts
- packages/core/src/cards/target.ts

> 手牌上限与拒收行为若解不出，登记 Q-CARD-3。

### T-004

**請神符（23）接进 registry，目标为物件下标**

- 模块 `MOD-06` · 需求 `REQ-06.1` · 状态 `done` · 估算 0.3 单元
- 依赖：T-001
- 被依赖：T-009
- 证据：VA 0x00444e1a（真人分支弹 UI；AI 分支 0x444d1a 取最近的神）

**依赖的其他类 / 文件**

- core/cards/summon.ts (applySummonCard, attachObject, summonableObjects, canAttach)
- core/state/reduce.ts (playCard：把 objects 传进 ctx 并把结果写回)
- core/rules/objects.ts (GOD_MODIFIERS)

**期望输入**

    useCard(ctx, 23, { kind:'object', objectIndex })；ctx 增加 objects: MapObject[]

**期望输出**

    objects[objectIndex-1].attached = cur+1；player.godInfo/f64 置位；三项修正加到玩家（fortune/misfortune/luck）

**核心逻辑 / 算法指导**

    1. UseCardContext 增加 objects（只读）；UseCardResult 增加 objects（写回）。
    2. registry case 23：if !summonableObjects(objects).includes(objectIndex) → fail('noEffect')；
       r = applySummonCard(player, objects, objectIndex)；写回 player 与 objects。
    3. reduce.ts playCard：把 r.objects 合回 state.objects，并按 rules/objects.ts 的 attach 规则加修正（已有 attachObject 内含）。

**验收测试**

    registry.test.ts：请到（attached 变化、修正变化）/ 请不到（已附身、不在地图上）。

**涉及文件**

- packages/core/src/cards/registry.ts
- packages/core/src/state/reduce.ts

> 原版 UI 选神的坐标/资源在 T-025 目标拾取里做。

### T-005

**紅卡（24）/ 黑卡（25）接进 registry，目标为股票下标**

- 模块 `MOD-06` · 需求 `REQ-06.1` · 状态 `done` · 估算 0.4 单元
- 依赖：T-001
- 被依赖：T-009
- 证据：紅卡 VA 0x00444f25、黑卡 0x0044503f；每日倒数 0x0041cff9（f6 与 newsFlag 高低半字节）

**依赖的其他类 / 文件**

- core/cards/swap-and-stock.ts (applyRedCard, applyBlackCard)
- core/places/stock.ts (StockState.f6, newsFlag)
- core/places/stock-market.ts (marketOpenOn, isLimitUp/Down)
- core/state/reduce.ts (playCard 需把 market 传进 ctx)

**期望输入**

    useCard(ctx, 24|25, { kind:'stock', index })；ctx 增加 market

**期望输出**

    market.stocks[index] 的 f6 / newsFlag 按原版置数（紅：利多天数；黑：利空天数）；休市日/停牌中 fail

**核心逻辑 / 算法指导**

    1. 先用 disasm 读 0x444f25 / 0x44503f：写入的是 f6 还是 newsFlag 的哪个半字节、写几天（当前 swap-and-stock.ts 的 stockF7 命名要按结论改）。
    2. registry：if !marketOpenOn(...) → fail('marketClosed')；if stocks[i].f6 != 0 → fail('noEffect')。
    3. 结果写回 UseCardResult.market；reduce.ts 合回 state.market。

**验收测试**

    swap-and-stock.test.ts：置数正确、休市拒绝、重复使用拒绝；registry.test.ts 各一条。

**涉及文件**

- packages/core/src/cards/swap-and-stock.ts
- packages/core/src/cards/registry.ts
- packages/core/src/state/reduce.ts

> 行情里怎样消费这两个计数（利多/利空影响 trend）已在 stock-market.ts；本卡只管写入。

### T-006

**怪獸卡（11）接进 registry，支持地块与設施目标**

- 模块 `MOD-06` · 需求 `REQ-06.1` · 状态 `done` · 估算 0.4 单元
- 依赖：T-001
- 被依赖：T-009
- 证据：VA 0x00443917（rich4_card_guaishouka.asm）

**依赖的其他类 / 文件**

- core/cards/monster.ts (applyMonsterCard)
- core/state/reduce.ts (playCard：facility 目标要合回 facilityLevel)
- core/rules/hostility.ts

**期望输入**

    useCard(ctx, 11, { kind:'entity', entityId } | { kind:'facility', facilityId })

**期望输出**

    目标等级按原版降（读汇编定：降到 0 还是 −n）；敌意 victim→cur +值；无主/等级 0 → fail

**核心逻辑 / 算法指导**

    1. 读 0x443917：确认对地块与設施各做什么（等级、是否清 owner）。
    2. monster.ts 泛化为 applyMonster(entity: {owner, level}) → {level', hostilityDelta}。
    3. registry case 11：按 target.kind 取 land 或 facility；UseCardResult 增加 facilities 写回。
    4. reduce.ts playCard：facilities 合回 facilityLevel（owner 不变）。

**验收测试**

    monster.test.ts：地块/設施各「有效/无主/0 级」三条；registry.test.ts。

**涉及文件**

- packages/core/src/cards/monster.ts
- packages/core/src/cards/registry.ts
- packages/core/src/state/reduce.ts

### T-007

**拍賣卡（8）——把脚下地产送入拍賣 pending**

- 模块 `MOD-06` · 需求 `REQ-06.1` · 状态 `done` · 估算 0.5 单元
- 依赖：无（可立即开工）
- 被依赖：T-009
- 证据：VA 0x00443225（rich4_card_paimaika.asm）；拍賣屏 Panel.mkf #26

**依赖的其他类 / 文件**

- core/rules/auction.ts (拍賣规则：底价、竞价者、成交)
- core/rules/interaction.ts (PendingInteraction.auction)
- core/cards/registry.ts, core/state/reduce.ts

**期望输入**

    useCard(ctx, 8, { kind:'none' })，玩家站在地块/設施格上（原版不挑主：自己的、无主的也照拍，见 notes）

**期望输出**

    state.pending = { kind:'auction', entityId, basePrice, bidders, facility? }；扣卡；phase='awaitingDecision'

**核心逻辑 / 算法指导**

    1. 读 0x443225：底价 = round(地价×(1+等级×0.5))×物價（run_auction 0x43bde5，設施分支同式读 +0x22）；
       竞价者 = 活着且非地主的玩家；成交款进公库（不给原主）；流拍 → 变无主。
    2. registry 不能直接产生 pending（它只返回 players/lands），故 UseCardResult 增加 `followUp?: PendingInteraction`；
       reduce.ts playCard 看到 followUp 就设 pending 与 phase。
    3. 复用 rules/auction.ts 的成交逻辑（已被魔法屋/破產拍賣用）；設施结算新增 settleFacilityAuction。

**验收测试**

    registry.test.ts：站在别人的地 → followUp.auction；自己的/无主的也照拍（敌意仅无主不记）；脚下非地块/設施 → fail。auction.test.ts：設施底价/结算 + 敌意 bug 用例。

**涉及文件**

- packages/core/src/cards/registry.ts
- packages/core/src/state/reduce.ts
- packages/core/src/rules/auction.ts

> 拍賣屏本身是 T-033。两处与初稿卡面不符、按 asm 改：① 原版不拦「自己的/无主的」（0x443282 只拦无主记敌意）； ② 敌意增量是 double 压栈给 int 形参的原版 bug（地价×物價×(等级+2)/5 的低 32 位，常规地价恒为 0）， 照原样复刻于 auctionCardHostility，与黑卡敌意段同类。

### T-008

**天使/惡魔/拆除/漲價/查封 五张地块类卡支持設施目标**

- 模块 `MOD-06` · 需求 `REQ-06.1` · 状态 `done` · 估算 0.6 单元
- 依赖：T-001
- 被依赖：T-009
- 证据：各卡 VA 见 card-registry.ts；設施分支在同一函数里按 code 4001..5999 走

**依赖的其他类 / 文件**

- core/cards/land-cards.ts (applyAngelCard, applyDevilCard, applyDemolishCard, applyRaisePriceCard, applySealCard)
- core/state/reduce.ts (facility 写回：facilityLevel / facilityOwner / priceStatus 等价物)

**期望输入**

    useCard(ctx, 9|10|12|27|28, { kind:'facility', facilityId })

**期望输出**

    設施等级/归属/涨价标记按原版变化；漲價/查封对設施是单个而非同區

**核心逻辑 / 算法指导**

    1. 每张卡先读汇编的設施分支：等级上限用 FACILITY_MAX_LEVEL[type]；拆除清 owner 时是否退钱。
    2. land-cards.ts 的函数泛化：接收 {owner, level, maxLevel} 返回新值；地块调用方传 maxLevel=5。
    3. 漲價/查封对設施：需要一个 facilityPriceStatus[] 状态（现只有地块的 priceStatus）——在 GameState 加数组，new-game 初始化，月結/结算处读它。

**验收测试**

    land-cards.test.ts 每张卡設施分支各两条；reduce 层一条端到端（用卡→facilityLevel 变）。

**涉及文件**

- packages/core/src/cards/land-cards.ts
- packages/core/src/cards/registry.ts
- packages/core/src/state/types.ts
- packages/core/src/state/reduce.ts

> facilityPriceStatus 影响 T-021 資產表与月結，改完跑 full-game soak。

### T-009

**AI 的 toCardTarget 覆盖全部目标类型（消除 Q-CARD-2 顺延）**

- 模块 `MOD-09` · 需求 `Q-CARD-2` · 状态 `done` · 估算 0.2 单元
- 依赖：T-001, T-003, T-004, T-005, T-006, T-007, T-008
- 证据：PRD §3 MOD-09 decideCard 伪代码

**依赖的其他类 / 文件**

- core/ai/policy.ts (toCardTarget, decideCard)
- core/ai/card-policy.ts (AiCardTarget, AiCardChoice.stealCard/facilityType)

**期望输入**

    AiCardChoice

**期望输出**

    CardTarget（不再返回 null）；搶奪卡带 steal:{kind:'card', id: stealCard}

**核心逻辑 / 算法指导**

    facility → {kind:'facility'}；stock → {kind:'stock'}；object → {kind:'object'}；
    改建卡对公園：facilityType 通过 useCard 的 extra 传（在 T-008 定义的接口上）。
    known-deviations 的 Q-CARD-2 改为「已解决」，保留历史。

**验收测试**

    card-policy.test.ts / policy.test.ts：每种目标一条「AI 选中 → useCard ok」。

**涉及文件**

- packages/core/src/ai/policy.ts
- docs/known-deviations.md

### T-010

**停留/轉向/烏龜卡可指向四大惡人与機器娃娃（P0-11 卡片侧）**

- 模块 `MOD-05` · 需求 `REQ-05.1` · 状态 `done` · 估算 0.6 单元
- 依赖：T-001
- 证据：选择掩码 0x446ae8 / 0x445e4d / 0x446656（未解）；
需求方口述：控制卡对四大惡人有效、魔法屋男性效果不影响他们（docs/original-ui.md）。

**依赖的其他类 / 文件**

- {'core/rules/special-actors.ts (SpecialActor': 'direction, stepsRemaining, halted)'}
- core/cards/stay.ts, turn-and-house.ts, tortoise.ts
- core/state/reduce.ts (playCard：actor 目标不走 players 路径)

**期望输入**

    useCard(ctx, 14|6|30, { kind:'actor', actor })

**期望输出**

    停留：specialActors[actor-4].halted = 停留天数（同真人）
    轉向：direction 取反，lastNodeId/nodeId 互换
    烏龜：stepsRemaining 走法改为每回合 1 格（沿用 tortoise 的天数字段，NPC 记录里放 +15 single_step）

**核心逻辑 / 算法指导**

    1. 先用 disasm 读三处掩码：bit 含义可能是「可选目标类别位图」（玩家位 0..3、NPC 位 4..7）。解出即按它；解不出按口述实现并登记 Q-NPC-3。
    2. registry：actor 目标不进 players 路径；返回 UseCardResult.actors（写回 specialActors）。
    3. 每张卡对 NPC 的效果只改 SpecialActor 字段，不改玩家。

**验收测试**

    3 卡 × 4 NPC + 機器娃娃 各一条；对不在棋盘上的 NPC（place≠board）fail。

**涉及文件**

- packages/core/src/cards/registry.ts
- packages/core/src/rules/special-actors.ts
- packages/core/src/state/reduce.ts

### T-011

**魔法屋男性效果不影响四大惡人；路障/地雷对 NPC 的行为核对（P0-11 道具侧）**

- 模块 `MOD-05` · 需求 `REQ-05.1` · 状态 `done` · 估算 0.3 单元
- 依赖：无（可立即开工）
- 证据：docs/original-ui.md 口述；魔法屋 VA 见 places/magic-house.ts 头注释

**依赖的其他类 / 文件**

- core/places/magic-house.ts
- core/rules/npc-walk.ts (runNpc：TRAP_TO_TOOL 已处理踩到路障/地雷/炸彈)

**期望输入**

    魔法屋 12 功能的目标集合

**期望输出**

    凡按性别筛目标的功能，候选只含玩家，不含 specialActors

**核心逻辑 / 算法指导**

    1. 列出魔法屋里按「男性」筛的功能，确认其候选生成函数只遍历 players。
    2. 写一条测试：NPC 在场时使用该功能，specialActors 不变。
    3. 路障/地雷：跑 npc-walk.test.ts 现有用例，确认 NPC 踩到即触发且回家（已实现），补一条「路障拦停 NPC」。

**验收测试**

    magic-house.test.ts +1；npc-walk.test.ts +1

**涉及文件**

- packages/core/src/places/magic-house.test.ts
- packages/core/src/rules/npc-walk.test.ts

> 大概率是纯验证卡；若发现魔法屋确实会选到 NPC，改候选函数。

### T-012

**找到 NPC 记录 +14 halted / +15 single_step 的写入点并接进 runNpc（P0-12）**

- 模块 `MOD-05` · 需求 `REQ-05.2` · 状态 `done` · 估算 0.5 单元
- 依赖：无（可立即开工）
- 证据：读点 0x0040de1a / 0x0040de34；表 0x498e28 步长 16，槽 = 4 + actor

**依赖的其他类 / 文件**

- tools/disasm.py (xref 0x498e28+14 / +15 的各 NPC 槽地址)
- core/rules/special-actors.ts, npc-walk.ts

**期望输入**

    写入点的汇编

**期望输出**

    runNpc 在对应事件（被路障拦、被停留卡、烏龜）置 halted / single_step；每日倒数

**核心逻辑 / 算法指导**

    1. 对 5 个槽分别 xref +14/+15 的绝对地址（0x498e28 + i*16 + 14/15），找 mov 写入。
    2. 若写入点在卡片/道具效果里 → 与 T-010 合并语义；若在走子里 → 在 runNpc 里置位。
    3. 找不到：登记 Q-NPC-2，写明查过的地址。

**验收测试**

    special-actors.test.ts：halted 倒数到 0 才走；single_step 每回合一格。

**涉及文件**

- packages/core/src/rules/npc-walk.ts
- packages/core/src/rules/special-actors.ts
- docs/known-deviations.md

## B · AI 保真（core/ai）

### T-013

**翻译股票打分函数 0x0042c075，AI 买哪一支（P1-4）**

- 模块 `MOD-09` · 需求 `REQ-09.1` · 状态 `done` · 估算 1.0 单元
- 依赖：无（可立即开工）
- 证据：VA 0x0042c075 起约 700 行；企業 +0x24 資產額、+0x2c 累積盈餘

**依赖的其他类 / 文件**

- core/ai/stock-policy.ts (decideStockTrade)
- core/places/stock-market.ts (StockState, isLimitUp)
- core/places/company.ts (companyFunds 累積盈餘)
- data/stocks.ts

**期望输入**

    state.market.stocks[12], state.holdings[me], commercials[], companyFunds[], me.cash, me.stockRatio

**期望输出**

    scoreStock(j) → number；pickStockToBuy(state) → index | -1；买多少股沿用现有 stockRatio 预算

**核心逻辑 / 算法指导**

    1. 逐段翻译打分：每个指标写成独立小函数（如 trendScore、valueScore、holdingPenalty），带 VA。
    2. 浮点部分用 Math.fround 保持单精度顺序；整数部分 Math.trunc。
    3. 跳过漲停、休市（已有闸）；打分相同取下标小的（原版循环顺序）。
    4. 卖出侧若同函数内 → 一并翻译；否则另开卡。

**验收测试**

    stock-policy.test.ts：3 个构造局面手算分数与排序一致；同种子重放一致；soak 不卡死。

**涉及文件**

- packages/core/src/ai/stock-policy.ts
- packages/core/src/ai/stock-policy.test.ts

> 把 Q-AI-1 结案。

### T-014

**核对 AI 总调度顺序 fcn_00418c55（P1-5）**

- 模块 `MOD-09` · 需求 `REQ-09.2` · 状态 `done` · 估算 0.5 单元
- 依赖：无（可立即开工）
- 证据：fcn_00418c55：买股 → 卖股 → fcn_00436b0a → 买地/盖房 → rand&1 → 用卡/用道具

**依赖的其他类 / 文件**

- core/ai/policy.ts (decideAction 的 awaitingRoll 分支)
- core/ai/card-policy.ts, tool-policy.ts, stock-policy.ts

**期望输入**

    state（awaitingRoll）

**期望输出**

    decideAction 按原版顺序返回第一条可行 action；rand&1 用 aiRoll 替身

**核心逻辑 / 算法指导**

    1. 读 0x418c55，确认每一步的调用与早退条件；fcn_00436b0a 是什么（可能是公佈欄）。
    2. 因为每帧只返回一个 action，用「本回合已做过哪些步」的隐式判据：例如买股后 holdings 变了就不会再买；
       若原版一回合内每步至多一次，需要 state 里记 turnStep 位图（新字段 aiTurnMask，endTurn 清零）。
    3. 一回合最多一卡一道具（0x441cf0 每回合调一次）在此一并落实。

**验收测试**

    policy.test.ts：构造局面让每步都可行，验证顺序；重放一致。

**涉及文件**

- packages/core/src/ai/policy.ts
- packages/core/src/state/types.ts
- packages/core/src/state/reduce.ts

> 新增 state 字段要更新 savegame 版本或给默认值。

### T-015

**AI 研發项目选择按研究所 UI 的电脑分支定案（P1-6）**

- 模块 `MOD-09` · 需求 `REQ-09.3` · 状态 `done` · 估算 0.3 单元
- 依赖：无（可立即开工）
- 证据：研究所屏字串 → xref → UI 函数里 cmp byte [player+0x15], 2 的分支

**依赖的其他类 / 文件**

- core/rules/facility.ts (aiPickResearchProject, startResearch)
- core/state/reduce.ts (aiStartResearch)

**期望输入**

    facilityLevel, cash, 已有道具

**期望输出**

    project 1..5

**核心逻辑 / 算法指导**

    1. 定位电脑分支；若是 rand()%level+1 之类，把随机搬到 reducer（已有精神：AI 随机在 reducer 掷）。
    2. 替换 aiPickResearchProject 的占位实现，带 VA。

**验收测试**

    facility-rules.test.ts：各等级的可选范围；同种子一致。

**涉及文件**

- packages/core/src/rules/facility.ts
- packages/core/src/state/reduce.ts

> Q-LAB-1 结案。

### T-016

**翻译 AI 卖股 0x0042c79f（调度第 1 步）**

- 模块 `MOD-09` · 需求 `REQ-09.2` · 状态 `done` · 估算 1.0 单元
- 依赖：无（可立即开工）
- 证据：VA 0x0042c79f..0x0042d0e4：入口两道闸——距還款日 <= 6 天且 存款+現金 < 貸款 → 必须卖；
否则 rand()%3 != 0 → 不卖；休市 → 不卖。然后 0x42c844 起逐支打分（与买入侧同款的
+0x2c/總天數、+0x24/10000 等指标），选一支卖出，股数规则在 0x42cf7c 之后。

**依赖的其他类 / 文件**

- core/ai/stock-policy.ts (decideStockTrade 的兄弟：decideStockSell)
- core/ai/policy.ts (awaitingRoll 的 case 1 现在直接 aiNext)
- core/places/stock-market.ts (isLimitDown)

**期望输入**

    state（awaitingRoll，aiStep == 1），topo.commercials

**期望输出**

    { type:'sellStock', stock, shares } | null；null 时 policy 发 aiNext

**核心逻辑 / 算法指导**

    1. 先把「必须卖」闸门写成 mustSell(me, today)；rand()%3 用 aiRoll 替身（D-004）。
    2. 打分逐段翻译成小函数（带 VA），与买入侧共用 recentAverage / stockScoreInput。
    3. 跌停不能卖（柜台会拒）→ 跳过，避免 AI 提一个必拒的 action。

**验收测试**

    stock-policy.test.ts：必须卖闸门、三分之一闸门、跌停跳过、同种子一致。

**涉及文件**

- packages/core/src/ai/stock-policy.ts
- packages/core/src/ai/policy.ts

> 做完把 policy.ts 的 case 1 接上。

## C · 表现层 22 屏（client）

### T-020

**新增 core 指令 setAi{player, whoPlays, aiFlags, personality}（託管AI 的规则侧）**

- 模块 `MOD-04` · 需求 `REQ-12.1` · 状态 `done` · 估算 0.2 单元
- 依赖：无（可立即开工）
- 被依赖：T-021
- 证据：Data.mkf #77 託管AI 对话框；docs/original-screens.md S3（14 条字串）

**依赖的其他类 / 文件**

- core/state/actions.ts, reduce.ts
- core/state/types.ts (Player.whoPlays / aiFlags / personality)

**期望输入**

    { type:'setAi', player, whoPlays: 1|2, aiFlags?: 0..3, personality?: 0..2 }

**期望输出**

    对应玩家字段改写；任何阶段都可用；出局者拒绝

**核心逻辑 / 算法指导**

    1. reduce 增加 case：校验 player 活着、字段范围；只改这三个字段。
    2. 若把当前玩家从真人切成电脑且 phase=awaitingRoll，下一帧由 client 的 scheduleAi 自然接管——core 不做别的。

**验收测试**

    reduce 测试：切换后 isAiControlled 变；越界拒绝（返回原对象）。

**涉及文件**

- packages/core/src/state/actions.ts
- packages/core/src/state/reduce.ts

> 联机时该指令只允许改自己的座位（T-070 校验）。

### T-021

**託管AI 屏（工具列 #3）**

- 模块 `MOD-12` · 需求 `REQ-12.1` · 状态 `todo` · 估算 0.6 单元
- 依赖：T-020
- 证据：Data.mkf #77；S3：三种個性 乖寶寶/普通人/大老奸、會用卡/會用道具 开关、託管 开关，坐标见 original-screens.md

**依赖的其他类 / 文件**

- client/dialog.ts (对话框皮肤), client/assets.ts (SpriteCache)
- client/main.ts (onToolbar case 2 → 打开)

**期望输入**

    state.players[]（whoPlays/aiFlags/personality）

**期望输出**

    点击 → dispatch(setAi{...})；ESC/关闭钮回到棋盘

**核心逻辑 / 算法指导**

    1. aiSettings.ts：常量表 ROWS（每位玩家一行：头像、託管钮、两个能力开关、三个個性单选）来自 S3 坐标。
    2. drawAiSettings(ctx, state)、hitAiSettings(x,y) → {player, control} | null。
    3. main.ts：Screen 增加 'aiSettings'；命中即 dispatch。

**验收测试**

    aiSettings.test.ts：hit 覆盖每个控件；越界 null。

**涉及文件**

- packages/client/src/ai-settings.ts
- packages/client/src/ai-settings.test.ts
- packages/client/src/main.ts

### T-022

**個人資產表屏（工具列 #7）**

- 模块 `MOD-12` · 需求 `REQ-12.2` · 状态 `todo` · 估算 0.5 单元
- 依赖：无（可立即开工）
- 被依赖：T-023
- 证据：Panel.mkf #9；S7 字段：現金/存款/貸款/地產/股票/總資產 等

**依赖的其他类 / 文件**

- core/rules/wealth.ts (wealthOf)
- core/state/reduce.ts (valuationsOf)
- client/dialog.ts

**期望输入**

    state, topo, 当前玩家

**期望输出**

    只读屏；关闭钮/ESC 回棋盘

**核心逻辑 / 算法指导**

    1. assetSheet.ts：LABELS[]（文字、x、y、对齐）从汇编抄；数值全部来自 wealthOf/valuationsOf，不在 client 里加减。
    2. 千分位与货币格式沿用 hud.ts 的 formatMoney。

**验收测试**

    assetSheet.test.ts：layout 快照 + hitClose。

**涉及文件**

- packages/client/src/asset-sheet.ts
- packages/client/src/asset-sheet.test.ts

### T-023

**資產表下的三张清單（資產/地產/股票）翻页**

- 模块 `MOD-12` · 需求 `REQ-12.2` · 状态 `todo` · 估算 0.5 单元
- 依赖：T-022
- 证据：S7 三个页签；行高/列位从同一 UI 函数抄

**依赖的其他类 / 文件**

- client/asset-sheet.ts
- core/state/reduce.ts (allEffectiveLands/Facilities, valuationsOf)

**期望输入**

    state, topo

**期望输出**

    页签切换；地產清單列出地块/設施（名、等级、估值）；股票清單列持仓、成本、市值

**核心逻辑 / 算法指导**

    1. 三个纯函数 assetRows / estateRows / stockRows(state, topo) → string[][]。
    2. 超过一页时分页钮；页数 = ceil(rows/每页行数)。

**验收测试**

    rows 函数：给定构造状态输出行数与内容。

**涉及文件**

- packages/client/src/asset-sheet.ts

### T-024

**道具欄浮窗（工具列 #8，5×3 = 15 格）**

- 模块 `MOD-12` · 需求 `REQ-12.3` · 状态 `todo` · 估算 0.5 单元
- 依赖：无（可立即开工）
- 被依赖：T-025
- 证据：S8：紧排 15 格，图标 + 数量；道具图标资源号见 data/tools.ts

**依赖的其他类 / 文件**

- core/rules/tools.ts (toolCount, toolsOf)
- core/rules/tool-effects.ts (能否用的预判)
- client/main.ts (dispatch useTool)

**期望输入**

    state.tools, currentPlayer

**期望输出**

    点击一格 → 无目标道具直接 dispatch(useTool{toolId})；放置类/指向类 → 进入 T-026 拾取模式

**核心逻辑 / 算法指导**

    1. inventory.ts：GRID{ x,y,cols:5,rows:3,cell }；cellRect(i)；hitInventory(x,y) → 槽下标。
    2. 只显示数量 > 0 的道具，按 id 升序紧排（原版顺序核对 S8）。
    3. 用不了（tool-effects 预判 false）的格子灰显，点击无效。

**验收测试**

    inventory.test.ts：排布、hit、灰显判定。

**涉及文件**

- packages/client/src/inventory.ts
- packages/client/src/inventory.test.ts

### T-025

**卡片欄浮窗（工具列 #9）**

- 模块 `MOD-12` · 需求 `REQ-12.3` · 状态 `todo` · 估算 0.4 单元
- 依赖：T-024
- 证据：S9

**依赖的其他类 / 文件**

- client/inventory.ts (同一套网格)
- data/cards.ts, card-registry.ts (selection 类型)
- core/cards/registry.ts (useCard 预判)

**期望输入**

    state.players[cur].cards

**期望输出**

    无目标卡直接 dispatch(useCard)；需目标 → T-026 拾取模式，拾取完成再 dispatch

**核心逻辑 / 算法指导**

    1. 复用 inventory.ts 的网格，数据源换成 cards（可重复出现同一张）。
    2. 被动卡（18–21）灰显不可点。

**验收测试**

    cardsPanel.test.ts

**涉及文件**

- packages/client/src/inventory.ts

### T-026

**目标拾取模式（选玩家 / 地块 / 設施 / 物件 / 格子）**

- 模块 `MOD-12` · 需求 `REQ-12.3` · 状态 `todo` · 估算 0.8 单元
- 依赖：T-001
- 证据：原版选目标：地图上高亮可选格；玩家目标弹头像列表（S 截图待补）

**依赖的其他类 / 文件**

- client/render.ts (pickNodeAt, nodeToScreen)
- core/cards/target.ts (targetClassOf, validateTarget)
- client/main.ts (输入状态机)

**期望输入**

    { cardId | toolId, targetClass }

**期望输出**

    CardTarget / useTool.nodeId；ESC 取消

**核心逻辑 / 算法指导**

    1. picking.ts：状态 { kind, cardOrTool, candidates: Set<nodeId|playerIndex|objectIndex> }。
    2. candidates 由 core 预判生成：对每个候选跑一次 useCard/useTool 的空跑（ok 才算候选）——保持 client 无规则。
    3. 渲染：候选格描边；点击命中 → 组装 target → dispatch；未命中忽略。

**验收测试**

    picking.test.ts：候选生成用构造状态；点击映射。

**涉及文件**

- packages/client/src/picking.ts
- packages/client/src/picking.test.ts
- packages/client/src/main.ts

> AI 不用此模块（它在 core/ai 里选）。

### T-027

**側欄四页（日历 / 月历 / 小地图 / 持股）**

- 模块 `MOD-12` · 需求 `REQ-12.4` · 状态 `todo` · 估算 0.6 单元
- 依赖：无（可立即开工）
- 证据：Panel.mkf #0 图 0..3；S6/S10–S12 字段与底部固定钮位置

**依赖的其他类 / 文件**

- client/hud.ts (Hud, SidebarView, hitSidebar)
- core/places/calendar.ts

**期望输入**

    state（year/month/day、holdings、market）

**期望输出**

    四页切换；底部钮固定

**核心逻辑 / 算法指导**

    1. SidebarView 增加 'holdings'；每页一个 drawXxx(ctx, state)。
    2. 底部钮矩形从汇编抄；hitSidebarButton(x,y) → 页号。

**验收测试**

    hud.test.ts：hit 与页切换。

**涉及文件**

- packages/client/src/hud.ts

### T-028

**小地圖旋转钮（地圖向左/右旋轉）**

- 模块 `MOD-12` · 需求 `REQ-12.5` · 状态 `todo` · 估算 0.2 单元
- 依赖：无（可立即开工）
- 证据：S6 两颗箭头钮；熱鍵表「地圖向左旋轉/向右旋轉」

**依赖的其他类 / 文件**

- client/render.ts (view 0..7), client/hotkeys.ts, client/hud.ts

**期望输入**

    点击/熱鍵

**期望输出**

    view = (view ± 1) & 7；重绘

**核心逻辑 / 算法指导**

    hud.ts 加两个矩形与 hit；main.ts rotateView(±1) 已有。

**验收测试**

    hud.test.ts +2

**涉及文件**

- packages/client/src/hud.ts
- packages/client/src/main.ts

### T-029

**銀行屏（存/取/貸/還 + 特別融資）**

- 模块 `MOD-12` · 需求 `REQ-12.6` · 状态 `todo` · 估算 0.8 单元
- 依赖：无（可立即开工）
- 证据：Panel.mkf #23；docs/original-ui.md U-3：白卡左申請/右償還；董事長多一条額度；rich4_ui_bank.asm 的坐标

**依赖的其他类 / 文件**

- core/places/bank.ts, special-finance.ts
- client/dialog.ts (AmountPage 填数页)
- client/scenes.ts (SCENE.bank = 23)

**期望输入**

    pending{bank}, player 财务字段

**期望输出**

    dispatch(bank{op, amount})；金额来自填数页；超额由 core 拒绝（返回原 state）时屏上提示

**核心逻辑 / 算法指导**

    1. bankScreen.ts：六个钮矩形 + 四行数字（現金/存款/貸款/融資）位置；董事長时多画一行。
    2. 点钮 → 打开 AmountPage(op)，确认 → dispatch。
    3. 利率、上限只显示 core 算出的值（bank.ts 导出 interestRate/loanLimit）。

**验收测试**

    bankScreen.test.ts：hit 六钮、董事長行显隐。

**涉及文件**

- packages/client/src/bank-screen.ts
- packages/client/src/bank-screen.test.ts
- packages/client/src/interactions.ts

### T-030

**股市屏（行情列表 + 买/卖）**

- 模块 `MOD-12` · 需求 `REQ-12.7` · 状态 `todo` · 估算 0.8 单元
- 依赖：无（可立即开工）
- 被依赖：T-031
- 证据：Panel.mkf #75；U-5；rich4_ui_stock.asm

**依赖的其他类 / 文件**

- core/places/stock-market.ts (stockStatus, marketOpenOn)
- core/state/reduce.ts (valuationsOf)
- client/dialog.ts (AmountPage)

**期望输入**

    state.market, holdings[cur]

**期望输出**

    dispatch(buyStock/sellStock{stock, shares})；漲停/跌停/停牌/休市按状态显示提示色

**核心逻辑 / 算法指导**

    1. stockScreen.ts：12 行表格（名、現價、漲跌、持股）；行矩形 hitRow。
    2. 选中行 + 买/卖钮 → AmountPage（股数）→ dispatch。
    3. 休市日整屏只读并显示「今日休市」。

**验收测试**

    stockScreen.test.ts：行 hit、状态色映射（用 stockStatus）。

**涉及文件**

- packages/client/src/stock-screen.ts
- packages/client/src/stock-screen.test.ts

### T-031

**持股彙總屏（買股份 / 企業董事長）**

- 模块 `MOD-12` · 需求 `REQ-12.7` · 状态 `todo` · 估算 0.5 单元
- 依赖：T-030
- 证据：Panel.mkf #76；pending{buyShares}

**依赖的其他类 / 文件**

- core/places/commercial.ts (排名/董事長)
- client/stock-screen.ts

**期望输入**

    pending{buyShares}, commercialShares, commercialOwners

**期望输出**

    dispatch(buyShares{shares})

**核心逻辑 / 算法指导**

    复用 stock-screen 的表格组件；显示各企業前四持股与董事長；买股份走 AmountPage。

**验收测试**

    hit + 排名显示

**涉及文件**

- packages/client/src/stock-screen.ts

### T-032

**商店屏（卡片/道具切换、买、卖自己的）**

- 模块 `MOD-12` · 需求 `REQ-12.8` · 状态 `todo` · 估算 0.8 单元
- 依赖：无（可立即开工）
- 证据：Panel.mkf #10；U-2：右上三角切换卡/道具；右下自己的可卖；rich4_shop.asm

**依赖的其他类 / 文件**

- core/places/shop.ts (货架、买卖价)
- client/scenes.ts (SCENE.shop = 10)

**期望输入**

    pending{shop}（cards[], tools[]）, 玩家 cards/tools

**期望输出**

    dispatch(shop{op:buyCard|buyTool|sellCard|sellTool, id, count})

**核心逻辑 / 算法指导**

    1. shopScreen.ts：货架网格（上）、自己的网格（下）、切换三角、离开钮；价格取 core 的 cardPrice/toolPrice×物價。
    2. 点货架格 → 买；点自己的格 → 卖；数量多件时 AmountPage。

**验收测试**

    shopScreen.test.ts：网格 hit、切换、买不起灰显。

**涉及文件**

- packages/client/src/shop-screen.ts
- packages/client/src/shop-screen.test.ts

### T-033

**公佈欄屏（挂 / 撤 / 买 / 出价输入）**

- 模块 `MOD-12` · 需求 `REQ-12.9` · 状态 `todo` · 估算 0.8 单元
- 依赖：无（可立即开工）
- 证据：Panel.mkf #73；S13 版式（路障 3,000 元示例）

**依赖的其他类 / 文件**

- core/places/notice-board.ts (LISTING, 四种市價)
- client/dialog.ts (AmountPage)

**期望输入**

    state.noticeBoard[玩家][槽]

**期望输出**

    dispatch(noticeBoard{op:'list',kind,id,price} | withdraw | buy)

**核心逻辑 / 算法指导**

    1. boardScreen.ts：四位玩家各一列槽位；自己的列可撤、可挂（挂 → 选物 → 填价）；别人的列可买。
    2. 市價默认值来自 core 的 *ListPrice；卖家可改。

**验收测试**

    boardScreen.test.ts

**涉及文件**

- packages/client/src/board-screen.ts
- packages/client/src/board-screen.test.ts

### T-034

**拍賣屏（PASS / +1000 / +5000、挥锤动画）**

- 模块 `MOD-12` · 需求 `REQ-12.10` · 状态 `todo` · 估算 0.8 单元
- 依赖：无（可立即开工）
- 证据：Panel.mkf #26；U-7：左挥锤、右 Q 版小人与加价钮

**依赖的其他类 / 文件**

- core/rules/auction.ts (竞价规则、AI 出价)
- client/scenes.ts (SCENE.auction = 26)

**期望输入**

    pending{auction: entityId, basePrice, bidders}

**期望输出**

    dispatch(auction{winner, price})：真人按钮出价；AI 出价由 core 的 auction 规则算（client 只播放）

**核心逻辑 / 算法指导**

    1. 竞价回合状态机放 client（谁轮到、当前价）；每轮询问 core：aiBid(state, bidder) → 价或 pass（若 auction.ts 没有，先补到 core，作为本卡的前置小改）。
    2. 三次无人加价 → dispatch(auction{winner, price})。
    3. 挥锤动画：三帧循环，节拍按「動畫過程」设定。

**验收测试**

    auctionScreen.test.ts：状态机（加价/PASS/流拍）。

**涉及文件**

- packages/client/src/auction-screen.ts
- packages/client/src/auction-screen.test.ts
- packages/core/src/rules/auction.ts

> 拍賣卡（T-007）与破產拍賣都走这屏。

### T-035

**樂透投注屏**

- 模块 `MOD-12` · 需求 `REQ-12.11` · 状态 `todo` · 估算 0.5 单元
- 依赖：无（可立即开工）
- 被依赖：T-036
- 证据：Panel.mkf #12；U-8 貓女、獎池

**依赖的其他类 / 文件**

- core/places/lottery.ts
- client/scenes.ts (SCENE.lotteryCounter = 12)

**期望输入**

    pending{lottery: available[], price, owned}

**期望输出**

    dispatch(lottery{number})

**核心逻辑 / 算法指导**

    号码网格（可买的亮、已卖的灰）、獎池数字、离开钮；点号码 → dispatch。

**验收测试**

    lotteryScreen.test.ts

**涉及文件**

- packages/client/src/lottery-screen.ts

### T-036

**樂透開獎动画屏**

- 模块 `MOD-12` · 需求 `REQ-12.11` · 状态 `todo` · 估算 0.5 单元
- 依赖：T-035
- 证据：Panel.mkf #15；摇球动画帧

**依赖的其他类 / 文件**

- core/places/lottery.ts (開獎结果已在 state.lastEvent / lottery)
- client/scenes.ts (SCENE.lotteryDraw = 15)

**期望输入**

    開獎结果（中奖号、得主、金额）

**期望输出**

    纯播放；结束后关闭

**核心逻辑 / 算法指导**

    摇球 N 帧 → 停在中奖号 → 显示得主；「動畫過程」关闭时直接显示结果。

**验收测试**

    帧序列纯函数测试

**涉及文件**

- packages/client/src/lottery-screen.ts

### T-037

**魔法屋屏（外圈 12 功能悬停高亮 + 中央文字 + 音）**

- 模块 `MOD-12` · 需求 `REQ-12.12` · 状态 `todo` · 估算 0.8 单元
- 依赖：无（可立即开工）
- 证据：Panel.mkf #18；U-9

**依赖的其他类 / 文件**

- core/places/magic-house.ts, data/magic-house.ts (12 功能文案)
- client/audio.ts

**期望输入**

    pending{magic}

**期望输出**

    dispatch 选中的功能（响应形状见 interaction.ts）

**核心逻辑 / 算法指导**

    1. 12 个扇区的命中用角度：atan2(y-cy, x-cx) → 扇区号；半径范围从汇编抄。
    2. 悬停：高亮扇区 + 中央显示该功能文案；点击 → dispatch。
    3. 音效编号：SOUND_IDS 里没有的先不放（不乱响）。

**验收测试**

    magicScreen.test.ts：角度→扇区映射 12 条。

**涉及文件**

- packages/client/src/magic-screen.ts
- packages/client/src/magic-screen.test.ts

### T-038

**監獄 / 醫院保釋屏（八个位子，含四大惡人）**

- 模块 `MOD-12` · 需求 `REQ-12.13` · 状态 `todo` · 估算 0.6 单元
- 依赖：无（可立即开工）
- 证据：Panel.mkf #63 / #65；NPC 保釋 300 點

**依赖的其他类 / 文件**

- core/rules/visit.ts, confinement.ts, special-actors.ts
- client/scenes.ts (prison 63 / hospital 65)

**期望输入**

    pending{bail: slots[]}, prisonOccupancy/hospitalOccupancy, specialActors

**期望输出**

    dispatch(bail{slot}) 或 decline

**核心逻辑 / 算法指导**

    八个位子矩形；有人的位子画头像（玩家或 NPC）与保釋价；点 → dispatch。

**验收测试**

    bailScreen.test.ts

**涉及文件**

- packages/client/src/bail-screen.ts

### T-039

**旅館 / 購物中心轉盤动画**

- 模块 `MOD-12` · 需求 `REQ-12.14` · 状态 `todo` · 估算 0.5 单元
- 依赖：无（可立即开工）
- 证据：表 0x475d0c；D-003（真人点击时机不复刻，结果由 core 定）

**依赖的其他类 / 文件**

- core/rules/facility.ts (WHEEL_TABLE, spinWheel 的结果已在 state)

**期望输入**

    本次轉盤的起点与落点槽号（reduce 记进 lastEvent 或新字段 lastWheel）

**期望输出**

    纯播放：指针从起点走到落点；「動畫過程」关闭直接显示

**核心逻辑 / 算法指导**

    若 state 没记轉盤过程，先在 core 加 lastWheel{wheel, start, stop}（小改，带测试）。

**验收测试**

    帧序列纯函数测试

**涉及文件**

- packages/client/src/wheel.ts
- packages/core/src/state/reduce.ts

> 素材待认：先用 12 格圆盘的占位绘制，资源号找到后替换。

### T-040

**研究所选項目屏**

- 模块 `MOD-12` · 需求 `REQ-12.14` · 状态 `todo` · 估算 0.4 单元
- 依赖：无（可立即开工）
- 证据：研究所屏字串 → xref；素材待认

**依赖的其他类 / 文件**

- core/rules/facility.ts (RESEARCH_MIN/MAX_PROJECT, researchTool)

**期望输入**

    facilityId, facilityLevel（决定可选項目数）

**期望输出**

    dispatch(research{facilityId, project})

**核心逻辑 / 算法指导**

    列表 1..level 的項目（名 = 研发出的道具名）；点 → dispatch。

**验收测试**

    researchScreen.test.ts

**涉及文件**

- packages/client/src/research-screen.ts

### T-041

**每月結算 + 頒獎屏**

- 模块 `MOD-12` · 需求 `REQ-12.15` · 状态 `todo` · 估算 0.5 单元
- 依赖：无（可立即开工）
- 证据：Panel.mkf #25；U-15

**依赖的其他类 / 文件**

- core/rules/monthly.ts (月結结果需可读：在 state 记 lastMonthly 或由 reduce 返回摘要)

**期望输入**

    月結摘要（各玩家收入/支出/利息/頒獎）

**期望输出**

    只读屏；确认后继续

**核心逻辑 / 算法指导**

    若 core 没有摘要，先加 state.lastMonthly（小改）；屏只排版。

**验收测试**

    layout 快照

**涉及文件**

- packages/client/src/monthly-screen.ts
- packages/core/src/state/reduce.ts

### T-042

**小游戏一：企鵝挖寶（specialKind 6）**

- 模块 `MOD-12` · 需求 `REQ-12.16` · 状态 `todo` · 估算 1.0 单元
- 依赖：无（可立即开工）
- 证据：Panel.mkf #80；mkf 11；玩法先看原版录屏/口述（Q-MINI-1）

**依赖的其他类 / 文件**

- core/places/minigame.ts (只收 score)
- client/scenes.ts (SCENE.penguinDig = 80)

**期望输入**

    pending{minigame: kind}

**期望输出**

    dispatch(minigame{score|null})；玩法状态机全部在 client

**核心逻辑 / 算法指导**

    1. 先写 docs/original-ui.md 的玩法描述（需求方提供），再实现。
    2. 状态机：开始 → 玩家操作 N 回合 → 结算分数 → dispatch。
    3. 随机用 client 自己的 PRNG（分数进 core 才是确定性的边界）。

**验收测试**

    状态机纯函数测试

**涉及文件**

- packages/client/src/minigame-penguin.ts

> 玩法未知前 blocked。

### T-043

**小游戏二：七彩氣球（specialKind 7）**

- 模块 `MOD-12` · 需求 `REQ-12.16` · 状态 `todo` · 估算 1.0 单元
- 依赖：无（可立即开工）
- 证据：Panel.mkf #91；mkf 19

**依赖的其他类 / 文件**

- core/places/minigame.ts
- client/scenes.ts (SCENE.balloons = 91)

**期望输入**

    pending{minigame}

**期望输出**

    dispatch(minigame{score|null})

**核心逻辑 / 算法指导**

    同 T-042。

**验收测试**

    状态机测试

**涉及文件**

- packages/client/src/minigame-balloon.ts

> 玩法未知前 blocked。

### T-044

**小游戏三（mkf 22，先认玩法与资源）**

- 模块 `MOD-12` · 需求 `REQ-12.16` · 状态 `blocked` · 估算 1.0 单元
- 依赖：无（可立即开工）
- 证据：mkf 22；Q-MINI-1

**依赖的其他类 / 文件**

- core/places/minigame.ts

**期望输入**

    pending{minigame}

**期望输出**

    dispatch(minigame{score|null})

**核心逻辑 / 算法指导**

    先解资源与玩法，再照 T-042。

**验收测试**

    状态机测试

**涉及文件**

- packages/client/src/minigame-3.ts

> 需求方确认是哪个小游戏后解除 blocked。

### T-045

**輔助說明屏（工具列 #1）**

- 模块 `MOD-12` · 需求 `REQ-12.17` · 状态 `todo` · 估算 0.4 单元
- 依赖：无（可立即开工）
- 证据：help.mkf；工具列 #1「遊戲百科」

**依赖的其他类 / 文件**

- client/assets.ts

**期望输入**

    help.mkf 的页图

**期望输出**

    翻页浏览；关闭

**核心逻辑 / 算法指导**

    help.mkf 加进 ARCHIVES；页索引 0..n；上一页/下一页/关闭三钮。

**验收测试**

    hit 测试

**涉及文件**

- packages/client/src/help-screen.ts
- packages/client/src/assets.ts

### T-046

**走子补间动画与时序（玩家棋子）**

- 模块 `MOD-12` · 需求 `REQ-12.18` · 状态 `todo` · 估算 1.0 单元
- 依赖：无（可立即开工）
- 被依赖：T-047, T-049
- 证据：jump.mkf 72 组动画；rich4_animate_object.asm；原版录屏逐帧

**依赖的其他类 / 文件**

- client/render.ts (BoardRenderer, characterSprite, directionalImage)
- client/main.ts (step 节拍与 humanDelay)

**期望输入**

    before/after 两个 state 的 nodeId；「遊戲速度/動畫過程」设定

**期望输出**

    每步 step 之间播放 N 帧插值（起点→终点，跳跃弧线），帧数与速度档对应

**核心逻辑 / 算法指导**

    1. tween.ts：帧序列纯函数 framesFor(from, to, speed) → {x,y,frame}[]。
    2. main.ts：dispatch(step) 后不立刻再 step，等 tween 播完再派下一步。
    3. 「動畫過程」关闭 → 帧数 0。

**验收测试**

    framesFor 的帧数/端点测试；与录屏比对误差 <2 帧（人工）

**涉及文件**

- packages/client/src/tween.ts
- packages/client/src/main.ts

### T-047

**四大惡人与機器娃娃的棋子渲染与走子动画**

- 模块 `MOD-12` · 需求 `REQ-12.18` · 状态 `todo` · 估算 0.6 单元
- 依赖：T-046
- 证据：NPC 精灵资源号（Data.mkf，待认）；docs/original-screens.md

**依赖的其他类 / 文件**

- core/rules/special-actors.ts (SpecialActor.nodeId/direction/place)
- client/render.ts, client/tween.ts

**期望输入**

    state.specialActors

**期望输出**

    place=board 的 NPC 画在其 nodeId；被释放后逐格动画

**核心逻辑 / 算法指导**

    BoardRenderer 增加 actors 层；NPC 一次走多格时按 T-046 的 tween 串播。

**验收测试**

    渲染输入映射测试

**涉及文件**

- packages/client/src/render.ts

### T-048

**開局跳伞过场（可跳过）**

- 模块 `MOD-12` · 需求 `REQ-12.19` · 状态 `todo` · 估算 0.5 单元
- 依赖：无（可立即开工）
- 证据：U-10；Airplane.avi / 跳伞精灵（待认）

**依赖的其他类 / 文件**

- client/main.ts (startGame)
- client/assets.ts

**期望输入**

    开局玩家列表与起点

**期望输出**

    过场播放 → 落到各自起点 → 进入第一回合；点击跳过

**核心逻辑 / 算法指导**

    过场是纯表现：不派任何 action；结束后才 dispatch(startTurn)。

**验收测试**

    跳过逻辑测试

**涉及文件**

- packages/client/src/intro.ts

> avi 不解码，用精灵帧复刻。

### T-049

**船（海路）棋子形态**

- 模块 `MOD-12` · 需求 `REQ-12.19` · 状态 `todo` · 估算 0.4 单元
- 依赖：T-046
- 证据：U-11；海路格的 type/flags 位（map-format.md）

**依赖的其他类 / 文件**

- client/render.ts
- core/loaders/map.ts (节点 flags/type 判海路)

**期望输入**

    玩家所在节点是否海路

**期望输出**

    海路上用船精灵代替角色精灵

**核心逻辑 / 算法指导**

    isSeaNode(node) 纯函数（从 map-format 抄位）；characterSprite 分支。

**验收测试**

    isSeaNode 测试

**涉及文件**

- packages/client/src/render.ts

### T-050

**地塊归属彩边 + GO 钮三态 + 標題音效**

- 模块 `MOD-12` · 需求 `REQ-12.19` · 状态 `todo` · 估算 0.4 单元
- 依赖：无（可立即开工）
- 证据：U-14 彩边；GO 钮态见 gameui.ts；U-1 標題音效编号（SOUND_IDS）

**依赖的其他类 / 文件**

- client/render.ts
- client/gameui.ts (GO_IMAGE)
- client/title.ts
- client/audio.ts

**期望输入**

    landOwner/facilityOwner；phase；标题进入

**期望输出**

    地块按 owner 颜色描边；GO 钮 normal/hot/disabled；标题播音效

**核心逻辑 / 算法指导**

    颜色取 CHARACTERS[character].color（C-ENG-2 先实测字节序）。

**验收测试**

    颜色映射测试

**涉及文件**

- packages/client/src/render.ts
- packages/client/src/title.ts

### T-051

**解析 Speaking.mkf 語音索引（1375 段 → 事件/角色映射表）**

- 模块 `MOD-11` · 需求 `REQ-12.20` · 状态 `todo` · 估算 0.8 单元
- 依赖：无（可立即开工）
- 被依赖：T-052
- 证据：rich4_player_say_on_events.asm；Speaking.mkf

**依赖的其他类 / 文件**

- assets-pipeline/src/audio.ts
- tools/disasm.py

**期望输入**

    asm 里的 (角色, 事件) → 資源号 计算式

**期望输出**

    data/speech.ts：speechIndex(character, event) → number，带 @source

**核心逻辑 / 算法指导**

    找到索引公式（通常 base + character×stride + event）；用 mkf 条目数反推验证。

**验收测试**

    binary-truth：条目数与公式覆盖一致

**涉及文件**

- packages/data/src/speech.ts

> Q9/Q11 结案。

### T-052

**語音触发点接线（playSoundFor 扩展）**

- 模块 `MOD-12` · 需求 `REQ-12.20` · 状态 `todo` · 估算 0.5 单元
- 依赖：T-051
- 证据：rich4_player_say_on_events.asm 的触发点列表

**依赖的其他类 / 文件**

- client/main.ts (playSoundFor)
- client/audio.ts
- data/speech.ts

**期望输入**

    before/after state

**期望输出**

    在对应事件（买地、收租、破產、中奖…）播该角色语音；「音效」关闭则静音

**核心逻辑 / 算法指导**

    把 playSoundFor 改成事件探测器列表：detectors[] 每个返回 event|null；命中即 play(Speaking, speechIndex(...))。

**验收测试**

    detectors 单测（构造 before/after）

**涉及文件**

- packages/client/src/main.ts
- packages/client/src/speech.ts

### T-053

**存档落到文件（Tauri fs，6 槽 + 自动）**

- 模块 `MOD-13` · 需求 `REQ-12.21` · 状态 `todo` · 估算 0.5 单元
- 依赖：无（可立即开工）
- 被依赖：T-054
- 证据：原版 SAVE0..5.DAT 槽位；Q-SAVE-1

**依赖的其他类 / 文件**

- client/host.ts
- client/saveload.ts
- core/loaders/savegame.ts (serializeGame/deserializeGame)

**期望输入**

    slot 0..6, GameState

**期望输出**

    桌面：$APPDATA/rich4/SAVEn.json；浏览器：localStorage 兜底

**核心逻辑 / 算法指导**

    host.ts 加 readSave/writeSave/listSaves（Tauri command 或 localStorage）；saveload.ts 的行数据从 listSaves 来。

**验收测试**

    saveload.test.ts：往返一致

**涉及文件**

- packages/client/src/host.ts
- packages/desktop/src-tauri/src/main.rs

### T-054

**读原版 SAVE*.DAT 进游戏（导入入口 + 缺口提示）**

- 模块 `MOD-12` · 需求 `REQ-12.21` · 状态 `todo` · 估算 0.4 单元
- 依赖：T-053
- 证据：docs 存档格式 §7.6

**依赖的其他类 / 文件**

- core/loaders/save.ts (parseSave)
- savegame.ts (importOriginalSave)
- client/saveload.ts

**期望输入**

    用户选中的 .DAT 文件

**期望输出**

    state = importOriginalSave(...).state；gaps 列表弹窗告知

**核心逻辑 / 算法指导**

    读档屏加「匯入原版存檔」钮 → pickFile → parseSave → importOriginalSave → loadState。

**验收测试**

    fixtures 的两份原版存档导入后 isGameOver=false 且资产对齐

**涉及文件**

- packages/client/src/saveload.ts
- packages/client/src/main.ts

### T-055

**Windows 构建（Tauri）**

- 模块 `MOD-13` · 需求 `REQ-12.22` · 状态 `todo` · 估算 0.5 单元
- 依赖：无（可立即开工）
- 被依赖：T-056
- 证据：—

**依赖的其他类 / 文件**

- packages/desktop/src-tauri/tauri.conf.json

**期望输入**

    CI runner windows-latest

**期望输出**

    .msi / .exe，素材随包

**核心逻辑 / 算法指导**

    GitHub Actions 矩阵；资源路径用 Tauri resolveResource 而非硬编码；字体回退检查繁体显示。

**验收测试**

    CI 构建成功 + 冒烟启动到标题

**涉及文件**

- .github/workflows/build.yml

### T-056

**Linux 构建（Tauri，AppImage）**

- 模块 `MOD-13` · 需求 `REQ-12.22` · 状态 `todo` · 估算 0.5 单元
- 依赖：T-055
- 证据：—

**依赖的其他类 / 文件**

- .github/workflows/build.yml

**期望输入**

    ubuntu-latest

**期望输出**

    AppImage

**核心逻辑 / 算法指导**

    同 T-055；webkit2gtk 依赖列进 workflow。

**验收测试**

    CI 构建成功

**涉及文件**

- .github/workflows/build.yml

## D · 画质升级管线（assets-pipeline）

### T-060

**素材分类器（UI / 地形 tile / 角色精灵 / 背景大图 / 字体）**

- 模块 `MOD-11` · 需求 `REQ-11.1` · 状态 `done` · 估算 0.4 单元
- 依赖：无（可立即开工）
- 被依赖：T-061
- 证据：DEVELOPMENT_PLAN §6 步骤 2 分类表；docs/assets.md

**依赖的其他类 / 文件**

- assets-pipeline/src/cli-upscale.ts (cmdPlan)
- extracted/**/meta.json

**期望输入**

    AssetEntry{ archive, index, w, h, x, y, frames, paletteKind }

**期望输出**

    category: 'ui'|'tile'|'sprite'|'background'|'font'，写进 upscale-queue/manifest.json

**核心逻辑 / 算法指导**

    规则按优先级：档案名（Panel.mkf → ui）→ 尺寸（32×32 且来自 GND → tile；≥ 640×480 → background）
    → 帧数 > 1 → sprite → 字形档案 → font；其余 ui。每条规则一个纯函数，可单测。

**验收测试**

    classify.test.ts：每类 2 个样本

**涉及文件**

- packages/assets-pipeline/src/classify.ts
- packages/assets-pipeline/src/classify.test.ts

### T-061

**按帧切片 + Alpha 分离，产出 upscale-queue/**

- 模块 `MOD-11` · 需求 `REQ-11.1` · 状态 `todo` · 估算 0.6 单元
- 依赖：T-060
- 被依赖：T-062
- 证据：C-AST-4（Alpha 分离）、C-AST-5（按帧）

**依赖的其他类 / 文件**

- assets-pipeline/src/sprite.ts (decodeSprite)
- cli-upscale.ts

**期望输入**

    extracted PNG + meta；分类结果

**期望输出**

    upscale-queue/rgb/<id>_f<n>.png、alpha/<id>_f<n>.png、manifest.json（原尺寸、锚点、类别、模型建议）

**核心逻辑 / 算法指导**

    每帧：rgb = 颜色通道（透明像素填最近不透明色，避免黑边）；alpha = 单通道灰度。
    manifest 记 sha256 便于回填校验。

**验收测试**

    往返：切片→合并（不放大）逐字节等于原图

**涉及文件**

- packages/assets-pipeline/src/slice.ts
- packages/assets-pipeline/src/slice.test.ts

### T-062

**回填校验：尺寸恰 4×、Alpha 合并、去彩边**

- 模块 `MOD-11` · 需求 `REQ-11.1` · 状态 `todo` · 估算 0.6 单元
- 依赖：T-061
- 被依赖：T-063
- 证据：C-AST-3（构图不变）

**依赖的其他类 / 文件**

- cli-upscale.ts (cmdIngest)

**期望输入**

    assets/upscale-done/rgb|alpha 同名 PNG

**期望输出**

    合并后的 RGBA 帧；不合格项列表（尺寸错、缺 alpha、哈希不匹配）

**核心逻辑 / 算法指导**

    1. 尺寸 ≠ 4× → 拒绝并列出。
    2. alpha 放大后二值化阈值 128（避免半透明毛边）；边缘 1px 内 RGB 用最近不透明像素填。
    3. 去彩边：对 alpha 边界像素做 3×3 中值。

**验收测试**

    构造 8×8 样本；坏尺寸被拒

**涉及文件**

- packages/assets-pipeline/src/merge.ts
- packages/assets-pipeline/src/merge.test.ts

### T-063

**重拼精灵 + 锚点 ×4 + 写 hd-manifest.json**

- 模块 `MOD-11` · 需求 `REQ-11.1` · 状态 `todo` · 估算 0.4 单元
- 依赖：T-062
- 被依赖：T-064, T-065, T-066
- 证据：C-AST-6

**依赖的其他类 / 文件**

- assets/hd-manifest.json
- cli-upscale.ts

**期望输入**

    合并后的帧 + 原 meta

**期望输出**

    assets/hd/<档案>/<资源>-<图>.png + meta（x×4, y×4）；manifest 记模型/参数/输入输出哈希

**核心逻辑 / 算法指导**

    帧顺序与原 meta 一致；manifest 条目幂等（同哈希不重写）。

**验收测试**

    锚点 ×4；manifest 幂等

**涉及文件**

- packages/assets-pipeline/src/assemble.ts

### T-064

**地形 tile 接缝检查**

- 模块 `MOD-11` · 需求 `REQ-11.1` · 状态 `todo` · 估算 0.5 单元
- 依赖：T-063
- 证据：C-AST-7

**依赖的其他类 / 文件**

- assets-pipeline/src/ground.ts (布局表)

**期望输入**

    hd tiles + GND 布局

**期望输出**

    报告：相邻 tile 边缘色差 > 阈值的坐标；可选自动修补（边缘 2px 双向羽化）

**核心逻辑 / 算法指导**

    对布局里每对相邻 tile 取边缘列/行，算平均 ΔE；> 阈值记录。

**验收测试**

    人造接缝被检出；无缝样本 0 报告

**涉及文件**

- packages/assets-pipeline/src/seams.ts

### T-065

**SpriteCache 按图优先读 hd，缺则回退原图**

- 模块 `MOD-12` · 需求 `REQ-11.1` · 状态 `todo` · 估算 0.4 单元
- 依赖：T-063
- 证据：PRD §4.5

**依赖的其他类 / 文件**

- client/assets.ts (SpriteCache)
- client/host.ts (assetBase)

**期望输入**

    get(archive, resource, image)

**期望输出**

    hd 存在 → 4× 位图 + 锚点 ×4，渲染时按 stage 缩放；否则原图

**核心逻辑 / 算法指导**

    查 hd-manifest 内存索引（启动时读一次）；纹理按需加载并 LRU 释放（C-PERF-2）。

**验收测试**

    回退路径测试；内存上限测试（模拟）

**涉及文件**

- packages/client/src/assets.ts

### T-066

**并排比对页（原图 / HD）供人工过审**

- 模块 `MOD-11` · 需求 `REQ-11.1` · 状态 `todo` · 估算 0.3 单元
- 依赖：T-063
- 证据：DEVELOPMENT_PLAN §10.2

**依赖的其他类 / 文件**

- cli-upscale.ts

**期望输入**

    hd-manifest

**期望输出**

    assets/hd-review.html（静态，本地打开）

**核心逻辑 / 算法指导**

    每条目一行：原图（放大 4× 最近邻）| HD；可按类别筛。

**验收测试**

    生成不抛错；条目数一致

**涉及文件**

- packages/assets-pipeline/src/review.ts

## E · 联网对战（server + client）

### T-070

**WebSocket 服务器主循环（join / intent / 广播）**

- 模块 `MOD-14` · 需求 `REQ-14.1` · 状态 `done` · 估算 0.8 单元
- 依赖：无（可立即开工）
- 被依赖：T-071, T-072, T-074
- 证据：PRD §3 MOD-14 伪代码

**依赖的其他类 / 文件**

- server/src/room.ts (Room)
- core/net/protocol.ts (ClientMessage/ServerMessage)
- ws

**期望输入**

    ws 连接；ClientMessage

**期望输出**

    ServerMessage 广播；每房间一个 Room

**核心逻辑 / 算法指导**

    onMessage(join): 版本不符 → error；取/建 Room；assignSeat；send joined；broadcast room。
    onMessage(intent): room.submit(seat, action) → ok 则 broadcast action{seq}，否则 error{reason}。
    setAi 指令只允许改自己的座位。

**验收测试**

    server.test.ts：两个内存 ws 客户端；非法 intent 不占序号

**涉及文件**

- packages/server/src/hub.ts
- packages/server/src/ws-server.ts
- packages/server/src/hub.test.ts

> C-LEG-5：不做公开大厅。集线器 hub.ts 与传输无关（内存连接可测）；ws 适配器运行时动态 import，起真服务器前 `pnpm --filter @rich4/server add ws`（离线 store 里没有）。

### T-071

**座位分配与断线重连（同名复用座位、since(seq) 补发）**

- 模块 `MOD-14` · 需求 `REQ-14.1` · 状态 `done` · 估算 0.6 单元
- 依赖：T-070
- 被依赖：T-073, T-077
- 证据：PRD §4.4

**依赖的其他类 / 文件**

- server/src/room.ts (since)

**期望输入**

    join{name} 来自断线中的座位；可选 lastSeq

**期望输出**

    joined{seat 同前}；补发 since(lastSeq ?? 0) 的全部 action

**核心逻辑 / 算法指导**

    Room 维护 seatState: connected|disconnected|ai；重连即 connected 并停掉接管计时器。

**验收测试**

    断开→重连→fingerprint 与服务器一致

**涉及文件**

- packages/server/src/room.ts
- packages/server/src/index.ts

### T-072

**checksum / desync 检测与处理**

- 模块 `MOD-14` · 需求 `REQ-14.1` · 状态 `done` · 估算 0.4 单元
- 依赖：T-070
- 被依赖：T-077
- 证据：PRD §4.4

**依赖的其他类 / 文件**

- core/net/protocol.ts (stateFingerprint)

**期望输入**

    checksum{seq, hash}

**期望输出**

    不一致 → desync 广播；该客户端自动请求全量重放（since(0)）重建

**核心逻辑 / 算法指导**

    Room 记每 10 seq 的 fingerprint 环形表；比对；desync 后客户端丢弃本地状态重放。

**验收测试**

    人为篡改客户端状态触发 desync 并自愈

**涉及文件**

- packages/server/src/room.ts
- packages/client/src/net-client.ts

### T-073

**AI 补位（掉线 30s 后服务器代打，重连归还）**

- 模块 `MOD-14` · 需求 `REQ-14.3` · 状态 `done` · 估算 0.5 单元
- 依赖：T-071
- 被依赖：T-077
- 证据：DEVELOPMENT_PLAN §6 步骤 3

**依赖的其他类 / 文件**

- core/ai/policy.ts (decideAction)
- server/src/room.ts

**期望输入**

    座位 disconnected 超时

**期望输出**

    座位标 kind:'computer'（不改 core 的 whoPlays，只在服务器侧产 action）；每步 submit 同一路径

**核心逻辑 / 算法指导**

    定时器 → 循环 decideAction(mirror) → submit(seat, action) 直到轮到别人；重连即停。

**验收测试**

    掉线玩家的回合被推进；重连后不再代打

**涉及文件**

- packages/server/src/room.ts

### T-074

**客户端联机模块 net-client（连接、发意图、按 seq 应用）**

- 模块 `MOD-12` · 需求 `REQ-14.2` · 状态 `todo` · 估算 0.8 单元
- 依赖：T-070
- 被依赖：T-075, T-076, T-077
- 证据：PRD §3 MOD-14 REQ-14.2

**依赖的其他类 / 文件**

- client/main.ts (dispatch)
- core/net/protocol.ts

**期望输入**

    url, room, name

**期望输出**

    onStart → newGame(seed...)；onAction → dispatchLocal；本地输入 → send intent（不直接 dispatch）

**核心逻辑 / 算法指导**

    mode = 'online' 时 main.ts 的 dispatch 改为 send intent；只有服务器回的 action 才进 reduce。
    seq 乱序 → 请求 since(last)。每 10 seq 发 checksum。

**验收测试**

    假服务器（内存）往返；乱序恢复

**涉及文件**

- packages/client/src/net-client.ts
- packages/client/src/main.ts

### T-075

**掷骰本地预测动画（结果以服务器为准）**

- 模块 `MOD-12` · 需求 `REQ-14.2` · 状态 `todo` · 估算 0.3 单元
- 依赖：T-074
- 证据：—

**依赖的其他类 / 文件**

- client/dialog.ts (drawDice)
- net-client.ts

**期望输入**

    本地点 GO

**期望输出**

    立刻播骰子滚动动画；收到 action{rollDice} 后停在真实点数

**核心逻辑 / 算法指导**

    动画不读 state.dice；收到 action 后再 dispatch 并定格。

**验收测试**

    帧序列测试

**涉及文件**

- packages/client/src/dice-anim.ts

### T-076

**联机大厅 UI（建房/加房/座位/角色/地图/开始）**

- 模块 `MOD-12` · 需求 `REQ-14.4` · 状态 `todo` · 估算 0.8 单元
- 依赖：T-074
- 证据：复用 setup.ts 版式；无原版对照

**依赖的其他类 / 文件**

- client/setup.ts (复用開局设置的角色/地图控件)
- net-client.ts

**期望输入**

    RoomInfo

**期望输出**

    房主 start → 服务器广播 start

**核心逻辑 / 算法指导**

    大厅 = setup 屏 + 座位联机态；非房主控件只读。

**验收测试**

    hit 测试；座位同步渲染

**涉及文件**

- packages/client/src/lobby.ts

> 这是本项目唯一无原版对照的屏，风格向 setup.ts 靠。

### T-077

**联机端到端测试：4 客户端同进程跑完整局，与单机同种子逐字节一致**

- 模块 `MOD-14` · 需求 `REQ-14` · 状态 `done` · 估算 0.5 单元
- 依赖：T-071, T-072, T-073, T-074
- 证据：C-DET-4；DEVELOPMENT_PLAN §6 步骤 3 验收

**依赖的其他类 / 文件**

- server/src/index.ts
- client/net-client.ts
- core/state/reduce.ts (reduceAll)

**期望输入**

    seed, map, 4 个 AI 座位

**期望输出**

    四份客户端状态 fingerprint 相同 == 单机 reduceAll 的 fingerprint

**核心逻辑 / 算法指导**

    内存 ws；AI 由服务器代打（T-073 路径）；结束后比对。

**验收测试**

    本卡即测试

**涉及文件**

- packages/server/src/e2e.test.ts

## F · 规则补缺（known-deviations 剩余 Q 项）

### T-080

**停牌中柜台不能买卖（Q-STOCK-3）**

- 模块 `MOD-07` · 需求 `Q-STOCK-3` · 状态 `done` · 估算 0.1 单元
- 依赖：无（可立即开工）
- 证据：0x0042aef4 / 0x0042b02f `cmp byte [股票 + 0x02], 0 / jne 跳过`

**依赖的其他类 / 文件**

- core/state/reduce.ts (tradeStock)
- core/places/stock.ts (StockState.f6)

**期望输入**

    buyStock / sellStock 指令，目标股票 f6 != 0

**期望输出**

    reduce 原样返回（拒绝）；AI 侧选股/賣股已跳过停牌股

**核心逻辑 / 算法指导**

    tradeStock 在漲跌停判定前加一条 `if (stock.f6 !== 0) return state`。

**验收测试**

    stock-limits.test.ts：停牌时买/卖都拒；倒数归零后能买。

**涉及文件**

- packages/core/src/state/reduce.ts
- packages/core/src/places/stock-limits.test.ts

### T-081

**保險理賠接线：找齐 0x44ba63 的调用点（Q-INS-1）**

- 模块 `MOD-07` · 需求 `Q-INS-1` · 状态 `done` · 估算 0.6 单元
- 依赖：无（可立即开工）
- 证据：0x44ba63(玩家, 損失, 旗标)；已知调用点 0x0041a82d（旅館）；其余用 callers 定位

**依赖的其他类 / 文件**

- core/places/company.ts (insurancePayout)
- core/state/reduce.ts (旅館住店 / 被狗咬 / 踩雷 / 炸彈 / 監獄 各处損失)

**期望输入**

    玩家在保險期内（insuranceDays != 0）蒙受的每一笔損失

**期望输出**

    保險公司（行業別 4 的企業）pay_money(公司, 玩家, 損失, 1) 進現金；公司盈餘相应减少

**核心逻辑 / 算法指导**

    1. `callers 0x0044ba63` 列全；逐个对到本引擎的损失点。
    2. 每处在扣款之后调 insurancePayout(state, player, loss)；没有保險公司的地图不赔。

**验收测试**

    每个调用点一条：有保險期赔、没有不赔；公司盈餘为负也照赔（读 exe 定）。

**涉及文件**

- packages/core/src/state/reduce.ts
- packages/core/src/places/company.ts

### T-082

**設施收費前的三条免收 + 免費卡自动使用 + 死神顯靈由他人賠償（Q-FAC-2）**

- 模块 `MOD-05` · 需求 `Q-FAC-2` · 状态 `done` · 估算 0.8 单元
- 依赖：无（可立即开工）
- 证据：0x0041a3cc（設施收費）走与住宅相同的 0x41d559：房屋查封中 / 與%s同盟中 / 死神顯靈；免費卡 0x0041a670；死神賠償 0x40fbb8 @ 0x0041a6a3

**依赖的其他类 / 文件**

- core/state/reduce.ts (settleFacility)
- core/rules/rent.ts / toll.ts（住宅那边同一函数的三条免收）
- core/cards/registry.ts 只读

**期望输入**

    踩到别人的設施

**期望输出**

    查封中不收；与地主同盟不收；地主身上是死神则不收且改由『他人賠償』；toll >= 2000×物價 或 付不起 → 自动用免費卡（手里有才）

**核心逻辑 / 算法指导**

    1. 先看住宅那边这三条在本引擎哪儿（grep 同盟/死神/查封），把判定抽成共用函数。
    2. settleFacility 在算出 toll 之后依次套用；免費卡自动使用走 registry 的 useCard(20) 路径（被动卡的自动触发）。
    3. 死神賠償：读 0x40fbb8 定谁赔多少。

**验收测试**

    三条免收各一条；免費卡两种触发；死神賠償一条。

**涉及文件**

- packages/core/src/state/reduce.ts
- packages/core/src/rules/rent.ts

> 設施查封位本身要 T-008 才进状态；这里先接同盟与死神两条，查封留钩子。

### T-083

**魔法屋「就地加蓋房屋」对設施生效（Q-MAGIC-2）**

- 模块 `MOD-07` · 需求 `Q-MAGIC-2` · 状态 `done` · 估算 0.2 单元
- 依赖：无（可立即开工）
- 证据：0x40b110 对設施同样生效

**依赖的其他类 / 文件**

- core/places/magic-house.ts (applyMagicRequest build)
- core/state/reduce.ts (freeBuildFacility)

**期望输入**

    魔法屋选中「就地加蓋」，目标站在設施上

**期望输出**

    設施等级 +1（不超上限），与住宅同价（免费）

**核心逻辑 / 算法指导**

    build 分支：目标节点 ref 是 facility → freeBuildFacility；否则原路。

**验收测试**

    magic-house.test.ts +2

**涉及文件**

- packages/core/src/places/magic-house.ts
- packages/core/src/state/reduce.ts

### T-084

**查封／漲價的涨价位进状态并按天递减（Q-LAND-2 + T-008 的設施部分）**

- 模块 `MOD-05` · 需求 `Q-LAND-2` · 状态 `done` · 估算 0.5 单元
- 依赖：无（可立即开工）
- 证据：查封卡 0x51 / 漲價卡高半字节；每日递减 0x0041d114（地块 +0x17）与 0x0041d160（設施 +0x1c）；租金翻倍 0x00419b09

**依赖的其他类 / 文件**

- core/state/types.ts
- core/state/reduce.ts (playCard 写回、advanceGameDay 的每日递减)
- core/rules/land-mutation.ts
- core/rules/toll-flow.ts (tollExemption 读它)
- core/rules/rent.ts (collectRent 涨价翻倍)

**期望输入**

    查封卡/漲價卡效果；每日推进

**期望输出**

    GameState.landPriceStatus[] / facilityPriceStatus[]；免收与漲價按状态值判

**核心逻辑 / 算法指导**

    1. 两个数组，开局从地图初值抄；playCard 把 lands[].priceStatus 落回；設施同理（T-008 接上后）。
    2. advanceGameDay：高半字节每天 −0x10，减到 0 整字节清零（0x0041d114/0x0041d160/0x0041d129）。
       ★ 递减循环在 `cmp edi,1 / jne 0x41d0ff` 的跨月守卫之外，是每天不是每月——卡面先写「按月」，
       回汇编核实后改正（PRD 未写节奏，以 exe 为准）。
    3. 读取方：tollExemption（查封免收）、collectRent 地主份 ×2（0x00419b09，同盟份不翻）、
       設施租金 applyPriceStatus ×2。

**验收测试**

    查封后免收、5 天后解封；漲價后租金翻倍、5 天后回落。

**涉及文件**

- packages/core/src/state/types.ts
- packages/core/src/state/reduce.ts
- packages/core/src/rules/land-mutation.ts
- packages/core/src/rules/rent.ts

