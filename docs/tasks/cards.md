# 任务卡片（自动生成，勿手改；改 cards.yaml 后重跑 `python3 tools/task-cards.py render`）

共 **73** 张卡，估算 **39.8** 单元，已完成 25.8。

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
| [T-021](#t-021) | 託管AI 屏（工具列 #3） | MOD-12 | REQ-12.1 | `done` | 0.6 | T-020 |
| [T-022](#t-022) | 個人資產表屏（工具列 #7） | MOD-12 | REQ-12.2 | `done` | 0.5 | — |
| [T-023](#t-023) | 資產表下的三张清單（資產/地產/股票）翻页 | MOD-12 | REQ-12.2 | `done` | 0.5 | T-022 |
| [T-024](#t-024) | 道具欄浮窗（工具列 #8，5×3 = 15 格） | MOD-12 | REQ-12.3 | `done` | 0.5 | — |
| [T-025](#t-025) | 卡片欄浮窗（工具列 #9） | MOD-12 | REQ-12.3 | `todo` | 0.4 | T-024 |
| [T-026](#t-026) | 目标拾取模式（选玩家 / 地块 / 設施 / 物件 / 格子） | MOD-12 | REQ-12.3 | `done` | 0.8 | T-001 |
| [T-027](#t-027) | 側欄四页（資金 / 地產 / 股票 / 其他） | MOD-12 | REQ-12.4 | `done` | 0.6 | — |
| [T-028](#t-028) | 小地圖旋转钮（地圖向左/右旋轉） | MOD-12 | REQ-12.5 | `done` | 0.2 | — |
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
| [T-046](#t-046) | 走子补间动画与时序（玩家棋子） | MOD-12 | REQ-12.18 | `done` | 1.0 | — |
| [T-047](#t-047) | 四大惡人与機器娃娃的棋子渲染与走子动画 | MOD-12 | REQ-12.18 | `todo` | 0.6 | T-046 |
| [T-048](#t-048) | 開局跳伞过场（可跳过） | MOD-12 | REQ-12.19 | `done` | 0.5 | — |
| [T-049](#t-049) | 载具棋子形态（走路 / 機車 / 汽車 / 船） | MOD-12 | REQ-12.19 | `done` | 0.4 | T-046 |
| [T-050](#t-050) | 地塊归属彩边 + GO 钮三态 + 標題音效 | MOD-12 | REQ-12.19 | `done` | 0.4 | — |
| [T-051](#t-051) | 解析 Speaking.mkf 語音索引（1375 段 → 事件/角色映射表） | MOD-11 | REQ-12.20 | `todo` | 0.8 | — |
| [T-052](#t-052) | 語音触发点接线（playSoundFor 扩展） | MOD-12 | REQ-12.20 | `todo` | 0.5 | T-051 |
| [T-053](#t-053) | 存档落到文件（Tauri fs，6 槽 + 自动） | MOD-13 | REQ-12.21 | `done` | 0.5 | — |
| [T-054](#t-054) | 读原版 SAVE*.DAT 进游戏（导入入口 + 缺口提示） | MOD-12 | REQ-12.21 | `done` | 0.4 | T-053 |
| [T-055](#t-055) | Windows 构建（Tauri） | MOD-13 | REQ-12.22 | `done` | 0.5 | — |
| [T-056](#t-056) | Linux 构建（Tauri，AppImage） | MOD-13 | REQ-12.22 | `done` | 0.5 | T-055 |
| [T-060](#t-060) | 素材分类器（UI / 地形 tile / 角色精灵 / 背景大图 / 字体） | MOD-11 | REQ-11.1 | `done` | 0.4 | — |
| [T-061](#t-061) | 按帧切片 + Alpha 分离，产出 upscale-queue/ | MOD-11 | REQ-11.1 | `done` | 0.6 | T-060 |
| [T-062](#t-062) | 回填校验：尺寸恰 4×、Alpha 合并、去彩边 | MOD-11 | REQ-11.1 | `done` | 0.6 | T-061 |
| [T-063](#t-063) | 重拼精灵 + 锚点 ×4 + 写 hd-manifest.json | MOD-11 | REQ-11.1 | `done` | 0.4 | T-062 |
| [T-064](#t-064) | 地形 tile 接缝检查 | MOD-11 | REQ-11.1 | `done` | 0.5 | T-063 |
| [T-065](#t-065) | SpriteCache 按图优先读 hd，缺则回退原图 | MOD-12 | REQ-11.1 | `done` | 0.4 | T-063 |
| [T-066](#t-066) | 并排比对页（原图 / HD）供人工过审 | MOD-11 | REQ-11.1 | `done` | 0.3 | T-063 |
| [T-070](#t-070) | WebSocket 服务器主循环（join / intent / 广播） | MOD-14 | REQ-14.1 | `done` | 0.8 | — |
| [T-071](#t-071) | 座位分配与断线重连（同名复用座位、since(seq) 补发） | MOD-14 | REQ-14.1 | `done` | 0.6 | T-070 |
| [T-072](#t-072) | checksum / desync 检测与处理 | MOD-14 | REQ-14.1 | `done` | 0.4 | T-070 |
| [T-073](#t-073) | AI 补位（掉线 30s 后服务器代打，重连归还） | MOD-14 | REQ-14.3 | `done` | 0.5 | T-071 |
| [T-074](#t-074) | 客户端联机模块 net-client（连接、发意图、按 seq 应用） | MOD-12 | REQ-14.2 | `done` | 0.8 | T-070 |
| [T-075](#t-075) | 掷骰本地预测动画（结果以服务器为准） | MOD-12 | REQ-14.2 | `done` | 0.3 | T-074 |
| [T-076](#t-076) | 联机大厅 UI（进房/座位/开始） | MOD-12 | REQ-14.4 | `done` | 0.8 | T-074 |
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

- 模块 `MOD-12` · 需求 `REQ-12.1` · 状态 `done` · 估算 0.6 单元
- 依赖：T-020
- 证据：★ **Panel.mkf #77**（不是 Data.mkf —— 见下）；坐标全部来自 VA 0x0041e345 起的反汇编；S3

**依赖的其他类 / 文件**

- client/dialog.ts (对话框皮肤), client/assets.ts (SpriteCache)
- client/main.ts (onToolbar case 2 / 熱鍵「託管」→ 打开；Screen 'aiSettings')
- core/state/reduce.ts (setAi 扩字段), core/state/types.ts (Player.cashRatio)

**期望输入**

    state.players[]（whoPlays/aiFlags/personality/cashRatio/stockRatio）

**期望输出**

    確定 → 逐条 dispatch(setAi{...})（只发变过的行）；取消/ESC → 什么都不做

**核心逻辑 / 算法指导**

    ★ 档案订正：`original-screens.md` 写的是「Data.mkf 资源 0x4d」，但入口用的是
      `[0x48a05c]`，而 `[0x48a0e4]` 才是 Data.mkf。实测 Data.mkf #77 是解不出的压缩数据，
      **Panel.mkf #77 才是那一屏**（435×355 的对话框底图，渲染出来就是那张绿面板）。
    1. 底图 #0（含标题条、五个圆点、两条滑槽、两颗按钮面）；文字坐标取自反汇编，
       与底图上的图形逐项吻合（圆点 x=193、文字 x=244，y 差 ≤2）。
    2. **只列真人座位**（@source VA 0x0041e5a6 `+0x15 & 1`）—— 托管是把**自己**交给 AI。
    3. 编辑走**草稿**：原版也是先编一份暂存表、按確定才拷回（VA 0x0041e577）。
       「取消」于是天然等于「什么都不做」，不需要记原始值回滚。
    4. 比例滑块除以 `w-1` 而非 `w`：滑槽命中区是半开区间，除以 `w` 会让**满档取不到**
       （拖到底只到 99%），而「全存银行」恰恰是最常用的那一档。
    5. 5 个字段一起发（引擎的 setAi 五个字段都可选）；引擎侧**任一字段越界即整条拒绝**，
       不做部分生效。

**验收测试**

    ai-settings.test.ts 35 条：只列真人 / 五个旋钮的读写 / 比例首尾正是 0 与 100 /
    控件互不重叠且都在对话框内 / 圆点与文字锚点对得上 / 滑槽改的是「当前玩家」那一行 /
    竖排文字逐字画 / 精灵全缺也不抛。
    core/state/set-ai.test.ts 27 条：两种调用方（服务器只发 whoPlays、屏发五项）/
    越界即整条拒绝（11 条边界 + 「一项越界则合法项也不生效」）/ 只改指定玩家 /
    cashRatio 初值来自角色表 f25。

**涉及文件**

- packages/client/src/ai-settings.ts
- packages/client/src/ai-settings.test.ts
- packages/client/src/main.ts
- packages/core/src/state/set-ai.test.ts

> ⚠️ 两个亮/暗行图的用法没跟到（Q-LAYOUT-1）；cashRatio 目前没有规则读它（Q-BANK-3）。目视验证已完成（Q-BUILD-1 已修），并按实机截图与反汇编订正了字号与对齐（flag 跳表 0x44faa0）。

### T-022

**個人資產表屏（工具列 #7）**

- 模块 `MOD-12` · 需求 `REQ-12.2` · 状态 `done` · 估算 0.5 单元
- 依赖：无（可立即开工）
- 被依赖：T-023
- 证据：Panel.mkf #9（25 张）；S7 字段：現金/存款/貸款/總資產｜股票/點卷/保險期/企業｜土地/連鎖店/房屋/設施

**依赖的其他类 / 文件**

- core/state/panel.ts (panelValues / assetCounts)
- client/panel.ts (currency)
- client/assets.ts (portraitResource)

**期望输入**

    state, topo, 显示的玩家, 视图号, 按下态

**期望输出**

    只读屏；右键或 EXIT 钮回棋盘；点顶栏页签换玩家；点三颗钮换视图

**核心逻辑 / 算法指导**

    1. asset-sheet.ts 只摆位置与画字，**数值全部来自 core**（panelValues / assetCounts）。
    2. 底图 = Panel.mkf 资源 9 的**图 `视图号`**（0 資產總表 / 1 地產清單 / 2 股票清單）。
    3. 12 个字段标签只画在视图 0（原版把它们画进**图 0**）；视图 1/2 的列名另画。
    4. 按下/抬起两段：按下的那一下画高亮（钮底图 12 / EXIT 图 6），抬手才动作。

**验收测试**

    asset-sheet.test.ts：版式常量 + 命中框 + 页签 + 15 格 + 取值；core/state/panel.test.ts：assetCounts 四条。

**涉及文件**

- packages/client/src/asset-sheet.ts
- packages/client/src/asset-sheet.test.ts
- packages/core/src/state/panel.ts

> **2026-09-15 做完**（反汇编逐条取证 + 浏览器逐屏目视核过）。

## 与上一版取证的三处**订正**（照 exe，先前记错了）

1. **底图不是一张**：资源 9 是 **SMP、25 张**，三张 640×480 的分别是三个视图的底图，
   取图偏移是 `[0x48c270] + 0xc + view*12`（`spr_smp` 的 chunk 表，
   `graph_st` 12 字节/项）@source VA 0x423088。
2. **12 个字段标签不是「烘在底图里」**：是 `fcn_00422443` 开局**画进图 0**
   （`[0x48c270] + 0xc`）@source VA 0x422443。因为底图取的是图 `view`，
   所以**只有视图 0 有这 12 条**。
3. **那两排「数值」其实是两张清单的列名**，不是视图 0 的字段值：
   视图 1 的 5 列（地點/開發狀況/價格/收費/租期）画进图 1、y=112、x 取自
   int16 表 `0x475454` = `[168,264,356,448,540]`；视图 2 的 3 列
   （股票名稱/持有張數/總市價）画进图 2、y=68、x 取自 `0x47545e` = `[204,332,476]`。
   视图 0 的八条字段值另有位置（见下）。

## 取到的常量

| 是什么 | 值 | @source |
|---|---|---|
| 入口 | 工具栏派发表 `0x417d39` 的 **[6]** → VA 0x424492；窗口过程 `fcn_00423cf3` | VA 0x423cf3 |
| 底图 | `Panel.mkf` **资源 9** 的**图 `[0x4753fc]`**，画在 (0,0) | 载入 VA 0x4244xx、取图 0x423088 |
| 12 个标签 | x=142 / 430，y=88/136/184/232 与 296/344/392/440，20 号、居中、`0x101010` | `fcn_00422443` |
| 八条字段值 | **右对齐（flag 6）、28 号**：左列 x=**330**、右列 x=**602**，y=88/136/184/232 | VA 0x4232f3 起 |
| 四条计数 | 右对齐 x=**250**，y=296/344/392/440，28 号 | VA 0x4235ef |
| 顶栏页签 | 图 3（当前）/ 图 4，**88 宽**，落点 `(16+88i, 14)`；名字居中于 `x+44, y=30`、20 号 | VA 0x423237 |
| EXIT 钮 | 图 5 / 按下 图 6，锚点落点 (547,23)；命中框 `x∈[492,602] y∈[9,38]` | VA 0x4230f4 / 0x423dd1 |
| 头像 | `map.mkf` 的角色图，锚点 (60,100) | VA 0x4230bf |
| 神明图标 | 图 `13 + (godInfo−1)`，锚点 (60,188)；`godInfo==0` 时**整块不画** | VA 0x4231a1（表 `0x475464` 步长 4 = `[0,13,14,15,16]`）|
| 神明天数 | 同块内的 `"%d天"`（`+0x3e`）画在 (60,234)、16 号 | VA 0x42321f |
| 三颗下钻钮 | 命中框 `x∈[12,109]`、40 高、步进 64、首颗 y=282；文字 (60, 302/366/430) 20 号居中 | VA 0x424163 / 0x4231c3 |
| 钮的高亮底 | 图 **12**（97×40，正好盖住整颗钮），**只在按下时**画 | VA 0x42419f |
| 15 格道具欄 | x 从 300 起、dx=72、`x>588` 换行（y+=32），y0=281；图标 = 资源 **0x4a** 第 i 张、`×N` 右对齐在 `x+30` | VA 0x4236da |
| 15 格卡片欄 | 同上几何，y0=385，只画**卡名**（居中） | VA 0x4237b3 |
| 关屏 | 右键（`WM_RBUTTONUP`）；EXIT 钮（按下记状态 1、抬手走跳表） | VA 0x424409 / 0x4241f2 |

## 判定：原版**没有**的东西（不要加）

- **没有悬停高亮**：钮底图 12 与 EXIT 图 6 只在 `WM_LBUTTONDOWN` 那一下画，
  抬手整屏重画。故本屏也只在**按下**时画。
- **没有 ESC 关屏**：0x100 那条分支（VA 0x424374）只认 RICH4.CFG 里配的
  两个翻页键（给地產清單翻页用，属 T-023）。先前代码里的 ESC 关屏已删掉。

## 顺带修掉的两处

- **core 的「連鎖店」判据错了**：`land.h` 写明 `+0x18 = type`（chained store or house），
  原版两处（侧栏 VA 0x416355、本屏 VA 0x423583）都拿 **type≠0** 判連鎖店；
  先前 core 用的是 `level≠0`。新增 `assetCounts()` 把这四条计数集中到 core，
  `panelValues.estate` 改为复用它。
- **`main.ts` 的 `screen` 切了但画面不动**（`blitStage()` 被提前 `return` 跳过）——
  见 `known-deviations.md` 的 Q-STAGE-1。

⚠️ **剩下的**：视图 1/2 的**数据行**（含地產清單那两颗翻页箭头）是 **T-023**，
本卡只画到列名。

### T-023

**資產表下的三张清單（資產/地產/股票）翻页**

- 模块 `MOD-12` · 需求 `REQ-12.2` · 状态 `done` · 估算 0.5 单元
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

> **2026-09-15 做完**（反汇编逐条取证 + 浏览器逐项核过）。

## 先纠正两条上一轮记错的

1. **翻页键就是 PgUp/PgDn**（不是「别的键」）。原版 VA 0x424374 拿的是
   RICH4.CFG 的 `cfg+66`/`cfg+68`，而按 `hotkeys.ts` 的映射
   （绑定 i ↔ `cfg+0x10+2i`）那正好是 `DEFAULT_BINDINGS[25]/[26]` = PgUp/PgDn。
   **上箭头/PgUp = 上一页**（参数 2）、**下箭头/PgDn = 下一页**（参数 1）。
2. **三张清單的列名与数据行不是一回事**：列名（表头）由 `fcn_00422443`
   画进各自底图（T-022 已做）；数据行另有出处（见下）。

## 三种「清单」的数据行分别在哪画

| 视图 | 数据行出处 |
|---|---|
| 0 資產總表 | **没有行** —— 那一屏是 12 个字段 + 四条计数 + 两块 15 格 |
| 1 地產清單 | `fcn_004225a3(kind, action)`（VA 0x4225a3）—— 窗口过程**只在 `[0x4753fc] == 1` 时调** |
| 2 股票清單 | `loc_004238b1`（VA 0x4238b1）—— 在 `fcn_00423070` 里，**不是** `fcn_004225a3` |

## 视图 1：5 个「种类」格（这才是上一轮没跟出来的东西）

顶上那排 5 格（75×33，`(120+75i, 64)`，文字居中在 `(157+75i, 80)`，
选中那颗盖 **图 11**）点一下就换「列哪一类」——
`[0x475400]` 是**种类**，不是页号（上一轮记成页号了）：

| 种类 | 串表 `0x4753d4` | 内容（取数跳表 `0x423b27`）|
|---|---|---|
| 0 | 全  部 | 我名下的**地块**，然后我名下的**設施** |
| 1 | 住宅區 | 我名下的地块（不分等级）|
| 2 | 商業區 | 我名下的設施 |
| 3 | 房  屋 | 我名下 `type == 0 && level != 0` 的地块 |
| 4 | 連鎖店 | 我名下 `type != 0 && level != 0` 的地块 |

条目编码（同一张表两处共用）：地块 = `下标 + 0x7d0`、設施 = `下标 + 0xfa0`。

## 视图 1 的行几何与五列

- 每页 **10** 行（`[0x475408]`）、首行 **y=144**、步进 **32**。
- 五列（`SHEET_ROW_COL`）—— 注意 價格/收費 的 x 是**表头 x 再加偏移**：

| 列 | x | 对齐 | 内容 |
|---|---|---|---|
| 地點 | 168 | 居中 | 名字 |
| 開發狀況 | 264 | 居中 | 地块：`type==0` → 等级名（表 `0x475138`：空地/平房/店舖/商場/商業大樓/摩天大樓/公園）；`type!=0` → 固定串「連鎖店」。設施：`level==0` → 空地，否则种类名（表 `0x475150`：公園/旅館/購物中心/加油站/研究所）|
| 價  格 | 356+38=394 | 右 | 地块 `(房价×等级 + 地价)×物價指數`；設施 `(費率[0]×等级 + 地价)×物價指數` |
| 收  費 | 448+42=490 | 右 | 地块 `type==0` → `calculateLandToll(主人, 地块名)`（**同名区累加**）；`type!=0` → ★ 见下。設施 `type!=0 && level!=0` → `費率[等级]×物價指數` |
| 租  期 | 540 | 居中 | `landTenure`/`facilityTenure`（打包日期）→ `"%02d/%d/%d"`，0 → 「無限期」|

★ **連鎖店那一列的「收費」是个原版怪招，照抄**：它显示的不是该地块主人的
过路费，而是**入口处**按「当前显示玩家」算的那一个
（VA 0x4225e6 `calculate_land_toll(显示玩家+1, NULL)`，整个函数共用一份 `ebp`）。

## 翻页

- 两颗箭头 30×30：**上 (593,369)**、**下 (593,417)**；按下时盖 图 7 / 图 8
  （常态那两颗烘在图 1 的底图里）。命中 `x∈[593,623]`。
- 上一页：起点为 0 就不动；否则 `−10`。下一页：**`起点 + 11 > 总数`** 才不动
  （不是 +10，最后一页剩 1 条也要能翻过去），否则 `+10`。
  规则抽成纯函数 `estatePageAfter()`，已单测。
- 换视图/换玩家/换种类都 `fcn_004225a3(kind, 0)` → 分页归零。

## 视图 2：12 支股票

- **全列 12 支**，不管有没有持仓；首行 **y=100**、步进 32。
- 三列：名字 x=204（居中）、持仓 x=`332+52`、市价 x=`476+60`（都右对齐）。
- ★ 持仓那列走的也是货币串 —— **带 `$`**（原版如此，别"修正"）。
- 股票表按地图取：`stocksOfMap(state.globalMapId)`（原版 `stocks_on_map` 是
  该地图的 12 支，不是全局 96 支）。

### T-024

**道具欄浮窗（工具列 #8，5×3 = 15 格）**

- 模块 `MOD-12` · 需求 `REQ-12.3` · 状态 `done` · 估算 0.5 单元
- 依赖：无（可立即开工）
- 被依赖：T-025
- 证据：S8：紧排 15 格，图标 + 数量

**依赖的其他类 / 文件**

- core/state (state.tools)
- data/tools.ts (13 件道具名)
- client/main.ts (dispatch useTool)

**期望输入**

    state.tools, state.currentPlayer, state.players[cur].trafficMethod

**期望输出**

    点击一格 → 无目标道具直接 dispatch(useTool{toolId})；放置类/指向类 → 进入 T-026 拾取模式（**尚未做，如实告知**）

**核心逻辑 / 算法指导**

    1. inventory.ts：INV_CELL{ x0:19,y0:135,w:80,h:56,cols:5,rows:3 }；invCellRect(slot)；hitInventory(x,y) → 槽号。
    2. 只显示数量 > 0 的道具，按 id 升序紧排（原版顺序核对 S8）。
    3. 点击：按下记状态 + 确认音，**抬手**才用出去（原版两段）。

**验收测试**

    inventory.test.ts：网格/hit/紧排/当前玩家/直发判定/载具徽章。

**涉及文件**

- packages/client/src/inventory.ts
- packages/client/src/inventory.test.ts

> **2026-09-15 做完**（反汇编逐条取证 + 浏览器逐项核过）。上一轮那张取证表
有三处要订正，一并写在下面。

## 图标的资源号（上一轮说「没解出来」，其实就在同一张表里）

图标**不是**另有一套图集：`fcn_00447c6e`（VA 0x447c6e）里是
`[sheet + 0xc + (道具号 + 2) * 12]` —— **`Panel.mkf` 资源 11 的第 `道具号 + 2` 张**。
资源 11 共 17 张：图 0/1 = 两张底图，**图 2..14 = 13 件道具图标**，
图 15/16 = 80×56 的「載具徽章」。

## 网格与元素的**真实几何**（上一轮是按底图分隔线量的，差了一点）

命中在 `fcn_00445c14` 的 `WM_LBUTTONDOWN`（VA 0x445c8f），用的是**屏幕坐标**：

```
x∈[19,419)  y∈[135,303)          ; 不是 (14,130)+… 那套
col=(x−19)/80  row=(y−135)/56    ; 槽号 = row*5 + col
```

底图画在 (14,130)，所以**格原点 = 屏幕 (19,135) = 底图局部 (5,5)** ——
上一轮量的 (5,5)/(80,56) 是对的，但格尺寸是 **80×56**（不是 76×52），
因为相邻格是紧挨着的（分隔线画在格里侧）。

| 元素 | 底图局部位置 | 对齐 @source |
|---|---|---|
| 道具图标（图 `道具号+2`）| 锚点落在 `(29+80c, 33+56r)` | `fcn_004562a5` = 按锚点、透明的贴图 |
| 数量 `×%d`（格式串 `0x4653e0`）| `(79+80c, 23+56r)` | flag **1 = 右上**（x 是右边界、y 是上边界）|
| 卡名（卡片欄）| `(45+80c, 33+56r)` | flag 2 = 正中，**只画名字、不画图标** |
| 載具徽章 | 左上 `(325,117)` = 末格 (4,2) | VA 0x447e08，**不透明**贴图，盖在格子上 |

文字一律 **20 号白字 + `0x101010` 描边**（`create_font(0x14, 0xffffff, 0x101010, 3, 0)`）。

## 載具徽章（上一轮完全没提到）

道具欄的**末格**会盖一张 80×56 的图：`traffic_method == 1` → 图 **15**（機車）、
`== 2` → 图 **16**（汽車），**两张都带红色禁止圈**；走路（0）不画。
即「你正在用的那台載具，在道具欄里显示成打叉」。
★ 徽章**盖在图标之上**，且它那格不参与命中（`[0x48c548]` 里仍是 0）。

## 弹窗自己只负责「选」

`_rich4_ui_use_tool_entry` 拿到 `Wait_0402_Message` 的返回值后**直接**
`call tool_functions[道具号]`（VA 0x447f4b）—— 真正的「用」在那边。
所以**选目标那一段属 T-026**：本卡对需要目标的道具如实记一条日志，
**不假装发得出去**（否则会发出 `nodeId=0` 的无效指令）。

哪些「不用再问」由 core 的既有实现定：**機器娃娃(1) / 機車(5) / 汽車(6) / 時光機(10)**；
其余九件（路障/地雷/定時炸彈/飛彈/遙控骰子/機器工人/傳送機/工程車/核子飛彈）都要目标或点数。

## 原版**没有**的东西

- **没有按下高亮**：按下只记状态 + 放确认音（音效 1），抬手才动作。
- 关窗只有**右键**（VA 0x445dad 抛回 0）。没有 ESC。
- 没有标题栏、没有确定/取消钮 —— 底图就是一块纯格子板。

## 上一轮那张取证表里**错的三条**

1. 「图标资源号还没解出来」→ 就在资源 11 里（见上）。
2. 「格 76×52」→ **80×56**。
3. 「画在屏幕 (14,130)（棋盘局部 (14,90)）」→ 屏幕坐标就是 (14,130)，
   没有「棋盘局部」那一层（棋盘区原点在 (0,40)，换算出来是 (14,90)，
   但命中与绘制**都用屏幕坐标**）。

⚠️ 卡片欄（工具列 #9）是 **T-025**；`inventory.ts` 那边的 `cardEntries` /
`drawInventory('cards')` 已经写好并测过，T-025 接上去即可。
- **网格是量底图量的**：图上有 6 条竖分隔线 x=5/84/164/244/324/404、
  4 条横分隔线 y=5/60/116/172 ⇒ 首格 **(5,5)**、间距 **(80,56)**、格 **76×52**；
  5 + 5×80 = 405 ≈ 图宽 412、5 + 3×56 = 173 ≈ 图高 180，两头对得上。
- 紧排规则已由 S8 证实（8 号排第 5 格）。

⚠️ **还没解出的**（下一轮的主要工作量）：**每格图标的资源号**。
两个浮窗的窗口过程在 `rich4_ui_use_tool.asm` / `rich4_ui_use_card.asm`，
画图标那段还要跟（线索：`fcn_00447c6e` 里有 `add eax, 0x86` / `+0xc`
这种「基址 + 图号」；卡片与道具各一套图集）。
图标没解出来之前不要提交这屏 —— 画出来是空格子。

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

> 2026-09-15 已做**取证**（下一轮照抄即可）：

- 两个浮窗**共用同一张底图**：`Panel.mkf` 资源 **11**（412×180），
  图 **0 = 卡片欄**（灰绿）、图 **1 = 道具欄**（粉红）；
  都画在屏幕 **(14, 130)**（棋盘局部 (14, 90)）。
  @source `_rich4_ui_use_card_entry` VA 0x441baa（`read_mkf(panel,11,0,0)`，
  图 0 画在 0x0e/0x82）与 `_rich4_ui_use_tool_entry` VA 0x447d97（同资源、图 1）。
- **网格是量底图量的**：图上有 6 条竖分隔线 x=5/84/164/244/324/404、
  4 条横分隔线 y=5/60/116/172 ⇒ 首格 **(5,5)**、间距 **(80,56)**、格 **76×52**；
  5 + 5×80 = 405 ≈ 图宽 412、5 + 3×56 = 173 ≈ 图高 180，两头对得上。
- 紧排规则已由 S8 证实（8 号排第 5 格）。

⚠️ **还没解出的**（下一轮的主要工作量）：**每格图标的资源号**。
两个浮窗的窗口过程在 `rich4_ui_use_tool.asm` / `rich4_ui_use_card.asm`，
画图标那段还要跟（线索：`fcn_00447c6e` 里有 `add eax, 0x86` / `+0xc`
这种「基址 + 图号」；卡片与道具各一套图集）。
图标没解出来之前不要提交这屏 —— 画出来是空格子。

### T-026

**目标拾取模式（选玩家 / 地块 / 設施 / 物件 / 格子）**

- 模块 `MOD-12` · 需求 `REQ-12.3` · 状态 `done` · 估算 0.8 单元
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

> **2026-09-15 做完**（反汇编逐条取证 + 浏览器逐项核过）。

## ★ 先纠正一条：原版的反馈是**鼠标指针变形**，不是棋盘上描边

上一轮卡里写的「候选格描边」是我们自己想的东西。读 `_rich4_select_instance_callback`
（VA 0x445e4d，就是 `_rich4_select_instance_with_mouse` VA 0x446ae8 交给消息循环的
那个窗口过程）之后，真相反过来：**那个窗口过程一帧棋盘都不画**（WM_PAINT 只是把
离屏面贴回屏幕，VA 0x4466fa），反馈全在指针上：

| 情形 | 指针 | @source |
|---|---|---|
| 光标底下**能选** | 换成**那件道具/那张卡自己的光标**（路障→STOP 牌子、地雷→尖刺球、定時炸彈→炸彈、各卡→「卡片」）| VA 0x4465ba |
| **不能选** | 换成**红叉**（图 5）| VA 0x4465f4 |
| 贴近棋盘四边 | 方向箭头（图 34/40/38…）**并把镜头往那个方向推** | VA 0x44609b 起 |

指针图集 = **`Data.mkf` 资源 0**（43 张；0/1/2 = 路障/地雷/定時炸彈、
5 = 红叉、12 = 卡片、34..40 = 八个方向）@source VA 0x4020fa。

## 选择参数：一个数同时管「什么算数」和「指针长什么样」

两个调用方都只传一个参数（卡是 `selectionParam`、道具见下表）：

- **低 16 位 = 类别位**：bit0 格子 / bit1 地块 / bit2 設施 / **bit3 目标必选
  （右键不许取消）** / bit4 玩家 / bit5 特殊棋子。这几条就是
  `_rich4_select_instance_callback` 里那串 `test byte [0x48c594], …`。
- **高 16 位 = 指针形状**：`形状 = 高16位的低字节`、`热点x = 高16位的高字节 + 1`
  （VA 0x445ec1 的 `xor ah, dh` / `xor bl, dl` 两处**字节**异或）。
  路障 `1` → 图 0；地雷 `0x10001` → 图 1；定時炸彈 `0x20001` → 图 2；
  飛彈 `0x300c0` → 图 3；核子飛彈 `0x400c0` → 图 4；
  各张卡 `0xe0c0XYZ` → 图 12、热点 (15, 10) —— 与 asm 里的
  `fcn_004021f8(12, 15, 10)` 逐位对上。

道具的选择参数（`TOOL_SELECT_PARAM`）：路障 `1`、地雷 `0x10001`、
定時炸彈 `0x20001`、飛彈 `0x300c0`、核子飛彈 `0x400c0`、
機器工人 `0x2090006`、傳送機 `0x2090001`。

## 候选合法性：**问 core**，client 不重写规则

「这一格算不算数」= 空跑一遍规则。为此新增 `core/state/preview.ts`：

- `canUseCard(state, topo, cardId, target)` —— 包 `useCard`，顺带把
  **AI 出牌前那个 `willWork` 也改成调它**，两边从此一份实现。
- `canUseTool(state, topo, toolId, nodeId, value)` —— 包 `useToolAction`
  （该函数**被拒时原样返回传入的 state**，故「返回值 !== 原 state」即「会生效」）。

⚠️ 预演还会查「牌在不在手上」（`notInHand`）—— 对 UI 正是想要的行为。

## 每个类别怎么枚举候选

| 类别 | 候选落点 |
|---|---|
| 道具 | **所有格子**（哪一格算数由 `canUseTool` 定）|
| land / landOrFacility | 节点里 `ref.kind === 'land'` / `'facility'` 的，取节点的 x/y |
| anyPlayer / player | 每个在场玩家的**所在节点**（原版也是点棋子本身，没有「头像列表」）|
| playerOrActor | 再加 `state.specialActors`（编号 = 下标 + 4）|
| object | `state.objects` 里 `nodeId != 0` 的（下标 + 1）|
| **stock** | ✗ 没有棋盘落点 —— 紅卡/黑卡原版走的是另一套（`selection: 'ai'`），要自己的列表 UI |

## ★ 顺手修掉两个**下标错位**的真 bug（T-022 / T-024 都中）

core 的 `state.tools` 下标是 **`玩家×15 + 道具号`**（1 基、0 号空置 ——
证据是 `loaders/savegame.ts` 把原版的 `owned[id-1]` 写进 `tools[… + id]`，
以及 `toolCount` 的实现）。而两处绘制都按 `道具号 − 1` 读，于是：
道具欄与資產表右下那块的**图标与数量整体错了一格**（少显示 13 号、0 号永远空）。
图号也各差一格：**资源 0x4a 的图号 = 道具号 − 1**、**资源 11 的图号 = 道具号 + 1**。

## 没做的（已登记 `known-deviations.md` 的 Q-PICK-1）

- **贴边推镜头** + 那四支方向箭头指针（VA 0x44609b 起，方向表 `0x4751b0`）。
- 股票（紅/黑卡）与請神符的目标列表 UI。
- **遙控骰子**要的是一个 1..18 的点数，不是空间目标 —— 它得有自己那个输入 UI。

### T-027

**側欄四页（資金 / 地產 / 股票 / 其他）**

- 模块 `MOD-12` · 需求 `REQ-12.4` · 状态 `done` · 估算 0.6 单元
- 依赖：无（可立即开工）
- 证据：Panel.mkf #0 图 0..3；S6/S10–S12；VA 0x00416123 / 0x004014b1 / 0x00415f59 / VA 0x00417eba

**依赖的其他类 / 文件**

- client/hud.ts (Hud, PANEL_TAGS, PANEL_ROWS, PANEL_VALUE_*)
- client/panel.ts (panelRows), core/state/panel.ts (panelValues)

**期望输入**

    state（players、holdings、market、commercialOwners）+ topo

**期望输出**

    四页底图与切页；每页三行标签+数值；底部固定「物價指數 N」

**核心逻辑 / 算法指导**

    1. 底图 = Panel.mkf 资源 0 的**图[页]**，画在 (440,0)（VA 0x00416123）。
    2. 页号**每个玩家一份**（0x48be24+玩家号），由熱鍵 PgUp/PgDn 切 (页∓1)&3
       （VA 0x004014b1/0x004014ee）——**点标签不切页**（全 exe 无命中判定，别自己加）。
    3. 每页三值走 4 路跳表 0x415f59（0x4162d4/0x416355/0x41646c/0x4165e1），
       各行格式不同（见 core/state/panel.ts 的表）。
    4. 行标签是原版**开局画进页面图**的（VA 0x00417eba，x=10/y=80·145·208），
       资源里只有图标 —— 我们每帧照同样坐标画。
    5. 底部固定一行「物價指數  %d」（VA 0x004161b8，格式串 0x4638f5）。

**验收测试**

    core/state/panel.test.ts 9 条；client/panel.test.ts 6 条；hud.test.ts 的 tag 几何。

**涉及文件**

- packages/client/src/hud.ts
- packages/client/src/panel.ts
- packages/core/src/state/panel.ts

> 2026-09-15 完成。★ 卡片原文写「日历/月历/小地图/持股」与「底部钮」——与 S6/S10–S12
不符，已按截图与 exe 改正：四页是 **資金/地產/股票/其他**；底部是**固定一行字**、
不是钮；切页**只认熱鍵**。★ 四页共有的「角色色长条」见 T-027b（未做，见 known-deviations）。

### T-028

**小地圖旋转钮（地圖向左/右旋轉）**

- 模块 `MOD-12` · 需求 `REQ-12.5` · 状态 `done` · 估算 0.2 单元
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

- 模块 `MOD-12` · 需求 `REQ-12.18` · 状态 `done` · 估算 1.0 单元
- 依赖：无（可立即开工）
- 被依赖：T-047, T-049
- 证据：jump.mkf 72 组动画；rich4_animate_object.asm；原版录屏逐帧

**依赖的其他类 / 文件**

- client/render.ts (BoardRenderer, characterSprite, directionalImage)
- client/main.ts (step 节拍与 humanDelay)

**期望输入**

    before/after 两个 state 的 nodeId；「遊戲速度/動畫過程」设定

**期望输出**

    每步 step 之间播放 N 帧插值（起点→终点；**线性**，不是弧线），帧数由屏幕距离定

**核心逻辑 / 算法指导**

    1. tween.ts：帧序列纯函数 framesFor(from, to, speed) → {x,y,frame}[]。
    2. main.ts：dispatch(step) 后不立刻再 step，等 tween 播完再派下一步。
    3. 「動畫過程」关闭 → 帧数 0。

**验收测试**

    framesFor 的帧数/端点测试；与录屏比对误差 <2 帧（人工）

**涉及文件**

- packages/client/src/tween.ts
- packages/client/src/main.ts

> 2026-09-15 完成。★ 帧数/节拍**照 exe**（`_rich4_animate_object` VA 0x0040e669）：
帧数 = trunc(屏幕距离 × 0.125) + 1、线性等分、每帧固定 24 ms —— 卡里那句
「跳跃弧线」是猜的，实际是直线；「与录屏比对」也不必了（公式已从 exe 读出，
并用 tween.test.ts 9 条钉住）。实现在 client/tween.ts + render.ts（补间位置）
⚠️ 仍未接：**四大惡人 / 機器娃娃**那趟 —— 他们在 core 里一次算完整轮移动、
不发 `step` action，故补间起不来（本行的 output 栏要求含他们）。
+ main.ts（起补间、按补间时长排下一步）。浏览器实测：moving 期间画面 61 个
采样里 53 帧各不相同 ⇒ 确实在逐帧滑。

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

- 模块 `MOD-12` · 需求 `REQ-12.19` · 状态 `done` · 估算 0.5 单元
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

> 2026-09-15 完成（**机制**；画面见 Q-INTRO-1）。★ 卡片写的「avi 不解码，用精灵帧复刻」
—— 查证后**精灵帧也没有**：原版放的 AVI 是 Indeo 4.1 且**全是残档**
（每个恰好 5112 字节、只 1 个 338 字节视频块却声明 15 帧），故画面复刻不了。
已做的是能确证的两条：**时序**（avih：15 帧 × 66667 µs ≈ 1 s、画面 312×160）
与**可跳过**（纯表现、不派 action、放完或任意键/点击后才进棋盘）。
实现 `client/intro.ts` + 5 条断言；实测跑了 60 帧后进棋盘 ✓。

### T-049

**载具棋子形态（走路 / 機車 / 汽車 / 船）**

- 模块 `MOD-12` · 需求 `REQ-12.19` · 状态 `done` · 估算 0.4 单元
- 依赖：T-046
- 证据：U-11；`_rich4_update_player_sprite` VA 0x0040bbd8

**依赖的其他类 / 文件**

- client/render.ts
- client/assets.ts (characterSetBase)

**期望输入**

    玩家的 trafficMethod

**期望输出**

    按交通方式选角色图组（站 / 走 / 手持骰子）

**核心逻辑 / 算法指导**

    图组基号 = 0x80 + 角色×21 + (交通方式 & 3)×3，该组三个资源依次是
    **站 / 走 / 手持骰子**。

**验收测试**

    characterSetBase 映射测试（四种交通方式各一条 + 越界 & 3）

**涉及文件**

- packages/client/src/assets.ts
- packages/client/src/render.ts

> 2026-09-15 完成。★ **卡片原写「按海路格判（isSeaNode）」是错的** —— 查 exe 后确认
形态只由 `player+0x11`（traffic_method）决定，与地形无关：
```asm
mov al, byte [player+0x11] ; and al, 3
… eax = 3 × 交通方式 ; add edi, eax    ; edi = 0x80 + 角色×21 + 3t
read_mkf(data_mkf, edi / edi+1 / edi+2) ; 站 / 走 / 手持骰子
```
故 0 走路 → k0..2、1 機車 → k3..5、2 汽車 → k6..8、**3 船 → k9..11**。
（先前 assets.ts 里那张表把 k9..12 目测成「工程车」，其实是**船**。）

### T-050

**地塊归属彩边 + GO 钮三态 + 標題音效**

- 模块 `MOD-12` · 需求 `REQ-12.19` · 状态 `done` · 估算 0.4 单元
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

> 2026-09-15 完成（三部分）：
- **地塊归属彩边**：调色板索引 255 那套（VA 0x0040987d），先前的轮次已做
  （`assets.ts` 的 RING_PALETTE_INDEX + render.ts 按角色色传入）。
- **GO 钮三组图**：见 Q-UI-4 —— 图号 = 组(0 普通/2 禁止通行/4 烏龜) + 帧(0/1，
  每 500 ms 翻转)。组从 `player.blocking.stopping` / `.tortoiseWalking` 读。
- **標題音效**：悬停 = 音效 **0**（`[0x48231a]`）、确认 = **1**（`[0x482322]`）
  @source rich4_ui_main.asm 的 WM_MOUSEMOVE / WM_LBUTTONDOWN；
  `SOUND_IDS.TITLE_HOVER / TITLE_CLICK` + 一条断言。
⚠️ §11 的 P2-19 是**合并条目**（还含 T-048 跳伞、T-049 船），故等那两张做完再打勾。""

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

- 模块 `MOD-13` · 需求 `REQ-12.21` · 状态 `done` · 估算 0.5 单元
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
- packages/desktop/src-tauri/src/lib.rs

> 2026-09-15 完成。★ 卡片写的 `src/main.rs` 是错的 —— 命令注册与实现都在 **`lib.rs`**
（`main.rs` 只有 `run()`），已按实际改卡。
实现：`lib.rs` 加 `read_save/write_save/list_saves`（存
`<AppData>/saves/SAVE<n>.json`，槽号沿用原版 SAVE0..5）；`host.ts` 加
`SaveStore` 抽象（桌面 = 开机预载进内存 + 写回落文件；浏览器 = localStorage）；
`saveload.ts` 的 readSlot/writeSlot 改为走这个口；boot 里 `initSaveStore()`。
4 条断言（往返一致 / 空槽不是错 / 坏档只记 error / readSlots 概览）。
⚠️ 内容仍是 **JSON**，不是原版二进制格式（那是 Q-SAVE-1）。

### T-054

**读原版 SAVE*.DAT 进游戏（导入入口 + 缺口提示）**

- 模块 `MOD-12` · 需求 `REQ-12.21` · 状态 `done` · 估算 0.4 单元
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

> 2026-09-15 完成。
- 讀取屏左下角加「匯入原版存檔」钮（`importRect` / `hitImport`）——
  ⚠️ **原版没有这个钮**，是复刻版为「把旧存档带进来」加的，位置是我们定的；
  `drawSaveLoad` 里画它，只出现在 load 模式。
- `main.ts` 的 `pickSaveFile()` 用 `<input type=file>`（浏览器与桌面 webview 同一路），
  `importOriginalSaveFile()` = `parseSave` → `importOriginalSave(save, 存档自带的地图)`
  → `loadState`（顺带换地图）。
- ⚠️ 卡片写「缺口弹窗告知」，这里走**屏幕日志**（对话框那套是给游戏内交互用的）；
  缺口内容一字不改：`formatGaps` 逐条「字段：原因」。
- core 一侧的「两份原版存档导入后 isGameOver=false、资产对齐」在
  `savegame.test.ts` 里早就有了；本卡补 3 条客户端断言（钮的几何/只在 load 有/
  与行命中不重叠 + formatGaps）。

### T-055

**Windows 构建（Tauri）**

- 模块 `MOD-13` · 需求 `REQ-12.22` · 状态 `done` · 估算 0.5 单元
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

> 2026-09-15 完成（配置与工作流就位；**真机验收只能在 CI 上**）。
- `.github/workflows/build.yml`：三平台矩阵（macos/windows/ubuntu）+ 先跑 `pnpm check`
- `tauri.conf.json` 的 `bundle.targets` 加 `msi`/`nsis`（另补 `dmg`/`appimage`/`deb`）；
  `bundle.icon` 改成 32/128/128@2x + `.icns` + **`.ico`**（Windows 必须有 ico）
- 图标用 `npx tauri icon` 从原 icon.png 生成整套（已删掉不需要的 android/ios 目录）
- 素材不入库（太大）：CI 里用 `secrets.RICH4_ASSETS` 可选取一份，没有也能构建
⚠️ 本机是 macOS，打不出 Windows 的包 —— **验收只能到「配置与工作流就位 + 本机
  cargo check 通过」**，真机产物要 CI 跑一次。

### T-056

**Linux 构建（Tauri，AppImage）**

- 模块 `MOD-13` · 需求 `REQ-12.22` · 状态 `done` · 估算 0.5 单元
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

> 2026-09-15 完成（同 T-055 的 workflow）。Linux 那份单独列了依赖：
`libwebkit2gtk-4.1-dev` / `libappindicator3-dev` / `librsvg2-dev` / `patchelf`
/ `libayatana-appindicator3-dev` / `libgtk-3-dev`，产物 AppImage + deb。
⚠️ 同上：**本机 macOS 无法验收**，要 CI 跑一次。

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

- 模块 `MOD-11` · 需求 `REQ-11.1` · 状态 `done` · 估算 0.6 单元
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

- 模块 `MOD-11` · 需求 `REQ-11.1` · 状态 `done` · 估算 0.6 单元
- 依赖：T-061
- 被依赖：T-063
- 证据：C-AST-3（构图不变）

**依赖的其他类 / 文件**

- cli-upscale.ts (cmdMerge)

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

- 模块 `MOD-11` · 需求 `REQ-11.1` · 状态 `done` · 估算 0.4 单元
- 依赖：T-062
- 被依赖：T-064, T-065, T-066
- 证据：C-AST-6；PRD §4.5（hd 路径命名）

**依赖的其他类 / 文件**

- assets/hd-manifest.json
- cli-upscale.ts
- upscale.ts (recordResult)

**期望输入**

    合并后的帧（`<done>/merged/`）+ 原 meta（队列清单 + manifest.tasks 的数字身份/原尺寸/原锚点）

**期望输出**

    assets/hd/<档案>/<资源>-<图>.png + manifest 条目（模型/参数/输入输出哈希、outAnchor ×实际倍率）

**核心逻辑 / 算法指导**

    1. 帧顺序按队列清单（= 原素材清单顺序）走。
    2. 锚点用 upscale 的 recordResult（内部按**实际输出尺寸**缩放）——不是把 scale 乘一下了事，
       工具常把结果对齐到 4 的倍数，按请求值算会系统性偏移。
    3. 落盘前校验产物尺寸恰为 原图×scale（与 T-062 同一条规则），不合规不写 hd。
    4. 幂等：产物哈希与该条目上次记录的 outHash 相同 → 整帧跳过，一个字节都不重写。

**验收测试**

    锚点 ×4；manifest 幂等（连跑两次 written 为空）；尺寸不合规不落盘

**涉及文件**

- packages/assets-pipeline/src/assemble.ts
- packages/assets-pipeline/src/assemble.test.ts
- packages/assets-pipeline/src/cli-upscale.ts

> hd 路径由 assemble.ts 的 hdRelativePath **单点定义**，client 的 SpriteCache（T-065）读同一函数（PRD §4.5）。

### T-064

**地形 tile 接缝检查**

- 模块 `MOD-11` · 需求 `REQ-11.1` · 状态 `done` · 估算 0.5 单元
- 依赖：T-063
- 证据：C-AST-7（其判据已按实测改写，见 DEVELOPMENT_PLAN §5.4）

**依赖的其他类 / 文件**

- assets-pipeline/src/ground.ts (布局表)

**期望输入**

    ★ **原图 + 放大图**两张（同图放大前后）＋ GND 布局；不是只看放大图

**期望输出**

    报告：放大后**新增**的接缝（增量 ΔE 降序）+ 坐标；可选自动修补（边缘 2px 双向羽化）

**核心逻辑 / 算法指导**

    ★ 判据是**放大前后对比**，不是绝对阈值 —— 这是实测逼出来的结论：
      原版底图同时有高频纹理（水面/草地）与真地形交界，只看放大图的阈值区分不了
      它们与超分伪影（逐像素 ΔE>2.3 报 10224/10224，带内均值也报约 60%，而画面肉眼无接缝）。
    1. compareTileSeams(original, upscaled)：逐条缝算**带内均值** ΔE（先对带内像素求 RGB
       均值再转 Lab，顺带抹掉高频噪声），after − before > 一个 JND(2.3) 才报。
    2. 取带宽度两侧按 scale 换算，保证比的是同一段地形长度。
    3. findTileSeams 保留为**诊断**用途（单图绝对色差），明确标注「真地形边界也会报」。
    4. featherSeams：两侧各 band 像素成对线性过渡，对侧颜色只从输入快照读（否则越补越糊）。

**验收测试**

    人造接缝被检出；无缝样本 0 报告；★ 忠实放大 0 误报；★ 噪声纹理不误报；尺寸非整数倍抛错

**涉及文件**

- packages/assets-pipeline/src/seams.ts
- packages/assets-pipeline/src/seams.test.ts

> ⚠️ 底图目前不在超分清单里（Q-GND-4），无真实输入，只能用合成夹具验；已在真实地图上验证判据（忠实 ×4 报 0/60）。

### T-065

**SpriteCache 按图优先读 hd，缺则回退原图**

- 模块 `MOD-12` · 需求 `REQ-11.1` · 状态 `done` · 估算 0.4 单元
- 依赖：T-063
- 证据：PRD §4.5

**依赖的其他类 / 文件**

- client/assets.ts (SpriteCache)
- client/host.ts (assetBase/hdBase)
- client/main.ts (boot 接线)

**期望输入**

    get(archive, resource, image)

**期望输出**

    hd 存在 → 4× 位图 + 锚点取清单记的值；否则原图。**按图回退**，不是整包

**核心逻辑 / 算法指导**

    1. loadHdSource(hdBase)：拉 `<hd 目录>-manifest.json`（与目录同级），
       只有**既有 tasks 又有 results** 的图才算有 HD；拉不到就整包走原图。
    2. hdSourceFromManifest：档案名要去掉 `.mkf`（清单里存的是 `Data`）；
       取产物用 upscale.ts 的 hdRelativePath（写读两侧同一函数）。
    3. SpriteCache.get：HD 优先，fetch/解码任一环失败就回退原图这一张。
    4. ★ HD 路径**不补 colorKeyBlack**：透明性管线已烘进 alpha，且 AI 放大后
       「纯黑」不再是精确 0，按 RGB==0 再抠一次只会抠不动或抠错。
    5. ★ HD 产物交**浏览器原生解码**（`createImageBitmap(new Blob([bytes]))`），
       不自己 `decodePng` —— 那会经 `png.ts` 把 `node:zlib` 拖进前端包（Q-BUILD-1）。
       尺寸取自位图、锚点取自清单，都不需要 JS 解 PNG。
    6. LRU：精灵与原始字节各有上限；淘汰时调 onEvict 通知持有引用的一方
       （真正的内存释放要消费方配合，见 Q-PERF-1）。

**验收测试**

    回退路径 6 条（无来源/拉不到/坏 PNG/按图混用/空槽/缓存命中）；LRU 4 条；清单 4 条

**涉及文件**

- packages/client/src/assets.ts
- packages/client/src/assets.test.ts
- packages/client/src/host.ts
- packages/client/src/main.ts

> ⚠️ LRU 只移出自己这张表，释放内存需 render.ts 接 onEvict（Q-PERF-1）；桌面端 hd 路由未接（同条）。

### T-066

**并排比对页（原图 / HD）供人工过审**

- 模块 `MOD-11` · 需求 `REQ-11.1` · 状态 `done` · 估算 0.3 单元
- 依赖：T-063
- 证据：DEVELOPMENT_PLAN §10.2

**依赖的其他类 / 文件**

- cli-upscale.ts (cmdReview)
- assemble.ts (hdRelativePath)
- upscale.ts (UpscaleManifest)

**期望输入**

    hd-manifest + hd 目录 + assets-clean 目录

**期望输出**

    assets/hd-review.html（静态，双击即开，图片走相对路径）

**核心逻辑 / 算法指导**

    1. buildReviewRows：只列**有产物**的条目（既在 tasks 又在 results）——
       还在排队的不该进过审页，否则大半是破图；保持清单原顺序。
       两侧命名各用各的：原图是 extract 的 `input` 名，HD 是 hdRelativePath。
    2. renderReviewHtml：每行两张图等比并排；原图那侧不预生成 4× 中间产物，
       直接在 HTML 里用 `image-rendering: pixelated` 撑到 HD 的显示尺寸
       —— 浏览器放大即最近邻，逐像素等价，却省掉一份 16 倍体积的中间图。
    3. 按类别下拉筛选；拼进 HTML 的一切都转义。

**验收测试**

    生成不抛错；条目数一致（卡片数 == 行数 == 图数/2）；只列有产物的；转义；空清单

**涉及文件**

- packages/assets-pipeline/src/review.ts
- packages/assets-pipeline/src/review.test.ts
- packages/assets-pipeline/src/cli-upscale.ts

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

> ⚠️ 客户端「自愈」那半还没做，见 known-deviations.md 的 Q-NET-1（本卡标 done 只成立到服务端广播为止）

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

- 模块 `MOD-12` · 需求 `REQ-14.2` · 状态 `done` · 估算 0.8 单元
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
    seq 乱序 → 先攒着、凑齐按序施加（WS 可靠有序，缺号只来自重连，重连走 join{since} 补发）；
    每 10 seq 发一次 checksum。

**验收测试**

    假服务器（内存）往返；乱序恢复

**涉及文件**

- packages/client/src/net-client.ts
- packages/client/src/main.ts

### T-075

**掷骰本地预测动画（结果以服务器为准）**

- 模块 `MOD-12` · 需求 `REQ-14.2` · 状态 `done` · 估算 0.3 单元
- 依赖：T-074
- 证据：—

**依赖的其他类 / 文件**

- client/dialog.ts (drawDice)
- net-client.ts
- client/main.ts (dispatch/applyAction/渲染分支)

**期望输入**

    本地点 GO

**期望输出**

    立刻播骰子滚动动画；收到 action{rollDice} 后停在真实点数

**核心逻辑 / 算法指导**

    1. 不读 state.dice（此刻还是旧的）、不用 Math.random、不写 state ——
       滚动脸用 (帧号, 颗号) 的确定性散列，测试能钉死、录像能复现、
       也不会进 history 破坏 C-DET-4。
    2. dispatch（联机分支）见 rollDice 就 start(me.ndices)；applyAction 里
       reduce 后见 rollDice 且 net !== null 就 settle(state.dice) 定格。
    3. 走出走子阶段（phase !== 'moving'）就 cancel —— 否则定格的骰子会一直
       挂在画面上、GO 鈕再也不出现。
    4. 滚超时（3s，服务器没回/断线）交还给权威显示：**假装比诚实更糟**。
    5. 单机从不 start，故整条路径对单机是空操作。

**验收测试**

    帧序列 15 条：1..6 范围、确定性、相邻帧换脸、不定格不参与、超时交还、cancel、重 start

**涉及文件**

- packages/client/src/dice-anim.ts
- packages/client/src/dice-anim.test.ts
- packages/client/src/main.ts

### T-076

**联机大厅 UI（进房/座位/开始）**

- 模块 `MOD-12` · 需求 `REQ-14.4` · 状态 `done` · 估算 0.8 单元
- 依赖：T-074
- 证据：复用 setup.ts 版式；无原版对照

**依赖的其他类 / 文件**

- client/setup.ts (复用座位摆位/按钮常量)
- net-client.ts
- client/main.ts (Screen 'lobby')

**期望输入**

    RoomInfo（服务器给的房间快照）

**期望输出**

    座位板（名字/角色/在線/電腦）+ 房主「開始」+「離開」；房主 start → 服务器广播 start

**核心逻辑 / 算法指导**

    1. 座位内容**全部来自 RoomInfo**，大厅一个字节都不自己决定 —— 否则
       「我以为我选的是忍者、服务器记的是錢夫人」要到开局才炸。
    2. lobbySlots 摊成定长 4 格（空座也画，玩家看得出还剩几个位子）；
       connected 缺省当**离线**显示 —— 服务器没说的话不谎报「人在」。
    3. hitLobby：非房主点「開始」返回 **null**（只读控件不该是可点的东西，
       免得调用方写成「先接住再判断」，也免得 hover 骗玩家）。
    4. 座位是服务器分配的，故座位区只读；改角色/换地图要协议，见 Q-NET-2。

**验收测试**

    hit 20 条：控件互不重叠（四角+中心）、非房主点不到開始、座位对号、空座/离线/截断名渲染

**涉及文件**

- packages/client/src/lobby.ts
- packages/client/src/lobby.test.ts
- packages/client/src/main.ts

> 这是本项目唯一无原版对照的屏，风格向 setup.ts 靠。角色/地图选择待协议（Q-NET-2）。

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

