# 偏离登记表索引（`Q-*` / `D-*`）

> 生成：`python3 tools/index-deviations.py`（WORKPLAN W-21）。
> 来源：`docs/known-deviations.md` + `docs/deviations/*.md` 的**标题行**。
> **状态只按标题行里的标记判**：含「未决」→ 未决；含「有意」→ 有意偏离；
> 有 `~~…~~` / `✅` / 「已结案」→ 结案；其余一律 `?` —— **不读正文猜**。
> 一个编号一行（首次出现处），同编号的其余出现记在「位置」列的「另有 N 处」。

合计 **240** 个编号：结案 75 · 有意偏离 22 · 未决 0 · ? 143；另有 16 个只在正文出现的编号（见文末）。

## 总表（按编号排序）

| 编号 | 标题 | 状态 | 位置 |
|---|---|---|---|
| `D-001` | 随机数播种策略按模式区分 | ? | docs/known-deviations.md:8 |
| `D-002` | 设施 type 1/2 的转盘倍数暂取 1（**已撤销 2026-09-14**） | 结案 | docs/known-deviations.md:619 |
| `D-003` | 轉盤对真人也按「起点 + 第一个数字格」算 | ? | docs/known-deviations.md:626（另有 1 处） |
| `D-004` | AI 個性闸门的「1/3」用状态派生的确定性替身 | ? | docs/known-deviations.md:633 |
| `D-005` | AI 出牌的「视野」不模拟镜头钳位 | ? | docs/known-deviations.md:4111 |
| `D-006` | AI 选股排名用稳定排序（同分按下标升序） | ? | docs/known-deviations.md:4105 |
| `D-007` | 电脑回合的随机数消费点与原版不完全对齐 | ? | docs/known-deviations.md:4083 |
| `D-008` | 免費卡／嫁禍卡的自动使用，真人也按電腦的规则替他决定 | ? | docs/known-deviations.md:742 |
| `D-009` | 卖东西时那一格「凹进去」的效果 —— 已做，但有一处无法逐像素等同 | ? | docs/known-deviations.md:748 |
| `Q-001` | 地图0「台南市」第 1 块地的房价与同区不一致 | ? | docs/known-deviations.md:91 |
| `Q-002` | 购地卡的敌意更新是空操作（原版 bug） | ? | docs/known-deviations.md:435 |
| `D-035-1` | （有意偏离）号格命中不照抄原版那两条越界边 | 有意偏离 | docs/deviations/T-035.md:13 |
| `D-035-2` | （订正）眨眼第 4 步不是「越界读」，是**从图 1 把眼睛拷回来** | ? | docs/deviations/T-035.md:33 |
| `D-035-3` | （有意偏离 / 死代码）嘴贴片 5·6 基本不发生 | 有意偏离 | docs/deviations/T-035.md:57 |
| `D-035-4` | （订正）貓女郎的落点：图 1 在 **(210, −5)**，图 2 在 (154, −8) | ? | docs/deviations/T-035.md:67 |
| `D-035-5` | （订正）蓝色底板与对话气泡 | ? | docs/deviations/T-035.md:85 |
| `D-035-6` | （**已解决 · 已接上**）`Panel#14` 獎金跑馬燈 | ? | docs/deviations/T-035.md:99 |
| `D-035-7` | （订正）「拜拜」那一拍：原版**会亮一下**，本屏自己把它留住 | ? | docs/deviations/T-035.md:116 |
| `D-035-8` | （读反汇编的坑，接手的人避雷）`[0x48c35c]` 是「资源数据 + 0xc」 | ? | docs/deviations/T-035.md:145 |
| `D-035-9` | （订正）「这一屏画什么」的最终清单 —— 别把開獎屏的东西搬过来 | ? | docs/deviations/T-035.md:170 |
| `D-036-1` | （**结构性近似**）中奖号只能从 `before → after` 反推 | ? | docs/deviations/T-036.md:59 |
| `D-036-2` | （近似）脸的「眨眼」改成按帧号推 | ? | docs/deviations/T-036.md:76 |
| `D-036-3` | （未解出）脸的推进周期 | ? | docs/deviations/T-036.md:88 |
| `D-036-4` | （有意）语音不播 | 有意偏离 | docs/deviations/T-036.md:96 |
| `D-036-5` | （有意）`Data.mkf` #517 的人像条 | 有意偏离 | docs/deviations/T-036.md:105 |
| `D-036-6` | （**本轮新增 · 近似**）铭牌底框的「压暗」用 canvas 半透明黑重画 | ? | docs/deviations/T-036.md:113 |
| `D-036-7` | （**本轮新增 · 有意偏离**）号码表用**开奖前**那一份，不是 `state.lottery` | 有意偏离 | docs/deviations/T-036.md:125 |
| `D-040-1` | （有意偏离）項目名只在悬停时画，而且位置**固定** | 有意偏离 | docs/deviations/T-040.md:28 |
| `D-040-2` | （**已销案**）命中判据 `ebx`/`eax` 谁是 x —— 是 **x**，五格横排 | ? | docs/deviations/T-040.md:49 |
| `D-040-3` | ✅ （**已接** · 2026-09-16 补）取消（右键）= 不研發、直接收尾 | 结案 | docs/deviations/T-040.md:113 |
| `D-045-1` | （订正 · 已修）8 行格图（图 **2 / 3**）原来**整个没画** | ? | docs/deviations/T-045.md:22 |
| `D-045-2` | （字段读法已订正 · 章↔资源映射已修）剩下的唯一开放问题：滚动单位 | ? | docs/deviations/T-045.md:78 |
| `D-045-3` | （**已作废**）「上／下滚的画与命中错位」—— 原版本来就是对的 | ? | docs/deviations/T-045.md:262 |
| `D-045-4` | （**已作废**）「右列几处落点互相打架」—— 每一列都自洽 | ? | docs/deviations/T-045.md:287 |
| `D-045-5` | （**本轮新增 · 已知限制**）从設定屏推开时四周仍是纯黑 | ? | docs/deviations/T-045.md:313 |
| `D-086-1` | （有意偏离）「在世」判据改用 `isAlive()`，位置改用节点坐标 | 有意偏离 | docs/deviations/T-086.md:15 |
| `D-086-2` | （有意偏离）浮窗底下的那一帧是**重画**的，不是「存下来再贴回去」 | 有意偏离 | docs/deviations/T-086.md:60 |
| `D-086-3` | （未解出 · 需中央复核）右键关窗走的是浏览器 `contextmenu`，而它的时机随平台变 | ? | docs/deviations/T-086.md:75 |
| `D-086-4` | （有意偏离）键盘在弹窗里被**全部吞掉**，但吞的位置在 `hotkey` 钩子里 | 有意偏离 | docs/deviations/T-086.md:86 |
| `D-086-5` | （有意偏离）删掉了 `setViewMode` 与它带来的整套「地图视角」 | 有意偏离 | docs/deviations/T-086.md:94（另有 1 处） |
| `D-086-6` | （已解出，只作记录）三处先前记错的，本轮核清 | ? | docs/deviations/T-086.md:114 |
| `D-BANK-1` | （**订正 的原文**）面板是 200×280，不是 280×200 | ? | docs/deviations/T-029.md:25 |
| `D-BANK-2` | （**订正 的原文**）`loc_00437904` 不是「悬停反馈」 | ? | docs/deviations/T-029.md:47 |
| `D-BANK-3` | （**cross lines 解开**）`fcn_00433c20` 里那次 `fcn_0045643d` = 擦掉三条数额 | ? | docs/deviations/T-029.md:62 |
| `D-BANK-4` | （**已实现**）貸款屏进屏的两块滑入面板 + 状态机 | ? | docs/deviations/T-029.md:92 |
| `D-BANK-5` | （**已实现**）ATM 的进度条 / 键盘 / `0x408` | ? | docs/deviations/T-029.md:128 |
| `D-BOARD-1` | （已消除）市價／掛牌常數改成 core 的真出口 | ? | docs/deviations/T-033.md:13 |
| `D-BOARD-2` | （有意偏离）出价输入用 `dialog.ts` 的 `AmountPage`，不是原版的数字键盘窗 | 有意偏离 | docs/deviations/T-033.md:37 |
| `D-BOARD-3` | （**五列与滚动都已补全**；三处近似里**两处已解决**）地產选物窗 | ? | docs/deviations/T-033.md:76 |
| `D-BOARD-4` | 買别人的东西**先弹 YES/NO** —— **2026-09-16 已接** | ? | docs/deviations/T-033.md:177 |
| `D-BOARD-5` | （有意偏离，仅剩「近似色」）按下高亮按原版做回了，但颜色是近似 | 有意偏离 | docs/deviations/T-033.md:200 |
| `D-BOARD-6` | （引擎必需，非美术偏离）换人自动收屏 | ? | docs/deviations/T-033.md:221 |
| `D-BOARD-7` | （有意偏离）弹出选单优先吃掉点击；点选单以外先收单再按底下一层 | 有意偏离 | docs/deviations/T-033.md:232 |
| `D-BOARD-8` | （已解决）时序按契约实现：`down` 记账、`up` 成立 | ? | docs/deviations/T-033.md:266 |
| `D-CONFINE-1` | 2026-09-18：关押/住院时的**屏幕坐标**取节点而非景观（） | ? | docs/known-deviations.md:5531 |
| `D-LEGACY-1` | 2026-09-18：原版落点分派器里的**两处未初始化栈读** —— 复刻的处置（ / ） | ? | docs/known-deviations.md:5349 |
| `D-LEGACY-2` | 2026-09-18：原版落点分派器里的**两处未初始化栈读** —— 复刻的处置（ / ） | ? | docs/known-deviations.md:5349 |
| `D-LEGACY-3` | 2026-09-17：魔法屋**目标筛选器**的第二实参是**未初始化栈读** —— 复刻定为「平手全收」（） | ? | docs/known-deviations.md:5662 |
| `D-LEGACY-4` | 2026-09-19：AI 数手牌用「非零槽个数」当循环上界 —— 手牌有洞时会漏牌（） | ? | docs/known-deviations.md:5710 |
| `D-MAGIC-1` | （**结构性近似**）落点只能从 `before → after` 反推 | ? | docs/deviations/T-037.md:23 |
| `D-MAGIC-10` | （近似）女巫只画一处；图 1 在渲染路径里没被画到 | ? | docs/deviations/T-037.md:278 |
| `D-MAGIC-11` | （近似）绘制顺序：底图 → 字框 → 结果字 → 女巫 → 图标 | ? | docs/deviations/T-037.md:302 |
| `D-MAGIC-12` | ✅ （**2026-09-16 已接入口三句**）女巫那几句招呼 | 结案 | docs/deviations/T-037.md:316 |
| `D-MAGIC-2` | （近似）落点的「动作强度」是猜的排序 | ? | docs/deviations/T-037.md:44 |
| `D-MAGIC-3` | （未解出 **✅ 2026-09-19 解出**）`frames` 字段的语义，以及图 11..21 用在哪 | 结案 | docs/deviations/T-037.md:52（另有 1 处） |
| `D-MAGIC-4` | （未解出）悬停时第二张图**索引进不存在的图** | ? | docs/deviations/T-037.md:82 |
| `D-MAGIC-5` | （**已结案 2026-09-16**）音效已接上 | 结案 | docs/deviations/T-037.md:109 |
| `D-MAGIC-6` | （近似）命中几何是**角度**，原版是**逐像素掩膜** | ? | docs/deviations/T-037.md:170 |
| `D-MAGIC-7` | （近似）图标位置与楔形中线**不是一回事** | ? | docs/deviations/T-037.md:207 |
| `D-MAGIC-8` | （近似）转盘演出是**我们**加的 | ? | docs/deviations/T-037.md:222 |
| `D-MAGIC-9` | （**已修**，但记下取证过程）抠黑表第一版是猜的，漏了女巫与图标 | ? | docs/deviations/T-037.md:241 |
| `D-MINI-1` | （**卡面错误，已接入**）財神屏的底图是 `Panel.mkf` **#92**，走无头 RGB555 出口 | ? | docs/deviations/T-042-044.md:56 |
| `D-MINI-10` | ✅ （**已定案**）`scenes.ts` 的 `minigameScene(GIFT_FROM_SKY)` 返回 **92** | 结案 | docs/deviations/T-042-044.md:218 |
| `D-MINI-11` | 小游戏音效 —— **2026-09-16 已接** | ? | docs/deviations/T-042-044.md:231 |
| `D-MINI-2` | ✅ 企鵝的命中表 `Panel.mkf` **#81** —— **2026-09-24 已接**（gap-audit #19；旧条目「取不到、用几何绕开」作废） | 结案 | docs/deviations/T-042-044.md:109 |
| `D-MINI-3` | 入场 FLIC `Panel.mkf` **#78** —— **2026-09-16 已接**（旧条目的「外壳」判断是误读） | ? | docs/deviations/T-042-044.md:115 |
| `D-MINI-4` | （**接口订正**）action 是 `{ type: 'minigame', score }`，不是 `minigameScore` | ? | docs/deviations/T-042-044.md:144 |
| `D-MINI-5` | （**有意偏离**）没有「不玩」这条路 —— 卡面那句「不玩送 null」在原版不存在 | 有意偏离 | docs/deviations/T-042-044.md:154 |
| `D-MINI-6` | （**有意简化**）走行用整数格推，土堆按「走过即抹」实现 | 有意偏离 | docs/deviations/T-042-044.md:177 |
| `D-MINI-7` | （**有意简化**）「接住」的包围盒按当前帧的贴图量，取不到图时用 #100 图 0 兜底 | 有意偏离 | docs/deviations/T-042-044.md:193 |
| `D-MINI-8` | （原版分支走不到）冰屋那张图不画 | ? | docs/deviations/T-042-044.md:204 |
| `D-MINI-9` | （有意保留）入场那 1 秒画土堆，之后不画 | 有意偏离 | docs/deviations/T-042-044.md:211 |
| `D-MONTHLY-1` | （**订正**）结算屏那一行头像的落点 —— 查表值是 **y**、x 是常数 600 | ? | docs/deviations/T-041.md:60 |
| `D-MONTHLY-10` | （**订正**）行头像的图号 = `3×角色 + 47`，**没有**「帧」 | ? | docs/deviations/T-041.md:518 |
| `D-MONTHLY-11` | （**多余**）结算屏上那 4 个「数字球」/ 金币 —— 原版**没有**这些 blit | ? | docs/deviations/T-041.md:562 |
| `D-MONTHLY-12` | （**零件已备齐 · 2026-09-16**）结算屏收尾那只「存款」气泡（图 1，落点 190,10） | ? | docs/deviations/T-041.md:582 |
| `D-MONTHLY-13` | 2026-09-18 补： 的「计数」多了一个 —— `[0x48c42b]` | ? | docs/known-deviations.md:5371（另有 2 处） |
| `D-MONTHLY-2` | ✅ （**已解** · 2026-09-17 复核）頒獎屏 4 列头像的 x/y —— x 按「在榜人数」查表、y 照抄原版 | 结案 | docs/deviations/T-041.md:102 |
| `D-MONTHLY-3` | （**有意补写**）`存款：` / `利息：` 两个标签 | 有意偏离 | docs/deviations/T-041.md:189 |
| `D-MONTHLY-4` | （**订正**）頒獎屏状态 1 贴的那一小块 —— 是**裁切拷贝**，不是缩放 | ? | docs/deviations/T-041.md:209 |
| `D-MONTHLY-5` | 月結／頒獎屏音效 —— **2026-09-16 已接** | ? | docs/deviations/T-041.md:239 |
| `D-MONTHLY-6` | 頒獎屏状态 8/9 的 FLIC 动画 —— **2026-09-16 已接** | ? | docs/deviations/T-041.md:338 |
| `D-MONTHLY-7` | （**机制已解出 · 2026-09-16**）「无人获奖」那句 `別灰心，再加油喔！` | ? | docs/deviations/T-041.md:369 |
| `D-MONTHLY-8` | （**订正**）頒獎屏状态 1 的那一小块 —— 源图是**整屏底图 0**、尺寸 186×410 | ? | docs/deviations/T-041.md:434 |
| `D-MONTHLY-9` | （**未解出**）结算屏那四行文字：原版写进图 `11..14`，**没有**任何 blit | ? | docs/deviations/T-041.md:479 |
| `D-QNUM-1` | —— 已修：x87 取整误读为就近取偶 | ? | docs/deviations/Q-NUM-1.md:162 |
| `D-QNUM-2` | ✅ —— **已改（2026-09-16）**：`地價稅` / `證交稅` 的物价指数乘在截断**前**还是**后** | 结案 | docs/deviations/Q-NUM-1.md:165（另有 2 处） |
| `D-QNUM-3` | ✅ —— **已改（第 57/58 条）**：持股市值确实要 **float32** 累加 | 结案 | docs/deviations/Q-NUM-1.md:189 |
| `D-QNUM-4` | —— **有意保留**：`ai/stock-policy.ts` 的 `holdingsCost` 用 `Math.round` | 有意偏离 | docs/deviations/Q-NUM-1.md:219 |
| `D-QNUM-5` | ✅ —— **已改（2026-09-16）**：賣出打分的 `gainFloor` 读错常量（−2.0 应为 +2.0） | 结案 | docs/deviations/Q-NUM-1.md:226（另有 2 处） |
| `D-QNUM-6` | —— **未解**：1.3 表里那些调用点的逐条归属 | ? | docs/deviations/Q-NUM-1.md:249 |
| `D-T031-1` | （**差在 core**）分红金额：原版**截断**、`companyDividends()` 四舍五入 | ? | docs/deviations/T-031.md:22 |
| `D-T031-3` | （**订正**）起播判据只有「日期跨到 15 日」——**不加**「确实发了红利」的闸 | ? | docs/deviations/T-031.md:61 |
| `D-T031-4` | （**已修正**）本屏与樂透開獎屏谁先演 | ? | docs/deviations/T-031.md:90 |
| `D-T031-5` | （**有意不做**）键盘关不掉这一屏 | 有意偏离 | docs/deviations/T-031.md:113 |
| `D-T031-6` | （**有意忽略**）自动收屏不看「程序在前台」 | 有意偏离 | docs/deviations/T-031.md:125 |
| `D-T031-7` | （**已按 exe 修正**）版面：一家公司**一行**、一位玩家**一列** | ? | docs/deviations/T-031.md:138 |
| `D-T031-8` | （**已按 exe 删除**）董事长那一格的蓝底 —— 原版这屏**没有填色调用** | ? | docs/deviations/T-031.md:172 |
| `D-T034-1` | （**照抄原版**，已定案）PASS 之后那一格显示「住宿中」 | ? | docs/deviations/T-034.md:11 |
| `D-T034-2` | ✅ （**前提被推翻** · 2026-09-16）拍賣屏**不受**「動畫過程」管辖 | 结案 | docs/deviations/T-034.md:40 |
| `D-T034-3` | （解不出）有等级的地块缩略图缺两个全局 | ? | docs/deviations/T-034.md:65 |
| `D-T034-4` | （**已撤销 2026-09-15**）绕圈上限 12 | ? | docs/deviations/T-034.md:89 |
| `D-T034-5` | （**已撤销 2026-09-16**）心理价位里的 `rand()` 曾经换成派生种子 | ? | docs/deviations/T-034.md:104 |
| `D-T034-6` | （**已实证核过**，不是偏离）「Q 版小人」就是黄色描边剪影 | ? | docs/deviations/T-034.md:149 |
| `D-T034-7` | （有意偏离）挥锤动画取三帧；原版没有固定的「三帧」 | 有意偏离 | docs/deviations/T-034.md:184 |
| `D-T034-8` | （记录）dispatch 的形状 | ? | docs/deviations/T-034.md:201 |
| `D-T034-9` | （记录）本轮由浏览器实测发现并修好的两处 | ? | docs/deviations/T-034.md:167 |
| `D-T047-1` | ✅ `reduce` 把 `NpcWalk.path` 丢了 ⇒ 渲染器拿不到中间格 —— **已解决** | 结案 | docs/deviations/T-047.md:21 |
| `D-T047-2` | ✅ 替身的 `+2`（載具）/ `+3`（夢遊走姿）两组图 —— **2026-09-16 两张都接了** | 结案 | docs/deviations/T-047.md:57 |
| `D-T047-3` | `node.flags & 0x80000000` 那一支（`edi + 2` 載具）—— **2026-09-16 已接** | ? | docs/deviations/T-047.md:124 |
| `D-T047-4` | ✅ 夢遊/冬眠的**变灰** —— **玩家与替身两条都已接（2026-09-16）** | 结案 | docs/deviations/T-047.md:152 |
| `D-T047-5` | ✅ 一輪里多个惡人**同时**走（原版是逐个走的）—— **2026-09-16 已改成逐个** | 结案 | docs/deviations/T-047.md:178 |
| `D-T047-6` | ✅ 機器娃娃（以及**走回老家**的惡人）那一趟**起不了补间** —— 卡在渲染器的判据上 —— **已由中央修好** | 结案 | docs/deviations/T-047.md:210 |
| `D-T047-7` | ✅ 「人物行动时仍然是闪烁的」= **补间途中有的帧整帧不画** —— 已修（2026-09-16，表现层） | 结案 | docs/deviations/T-047.md:292 |
| `D-WHEEL-1` | （取證，非近似）起點槽從 `before.rngState` 反推 | ? | docs/deviations/T-039.md:24 |
| `D-WHEEL-10` | （近似）行距 +6 是我们的；阴影照原版 | ? | docs/deviations/T-039.md:221 |
| `D-WHEEL-2` | （**已銷案 2026-09-16**）整屏画在**纯黑**上，原版是画在棋盘上 | ? | docs/deviations/T-039.md:49（另有 2 处） |
| `D-WHEEL-3` | ✅ （**前提被推翻** · 2026-09-16）「動畫過程」**管不到**这一屏 | 结案 | docs/deviations/T-039.md:65 |
| `D-WHEEL-4` | （近似）这一趟转几格是**我们**定的 | ? | docs/deviations/T-039.md:88（另有 2 处） |
| `D-WHEEL-5` | （**已接 2026-09-16**）一个音都不放 | ? | docs/deviations/T-039.md:106（另有 2 处） |
| `D-WHEEL-6` | （近似）真人点一下 = **直接进减速段** | ? | docs/deviations/T-039.md:122 |
| `D-WHEEL-7` | （近似）开场第一帧 | ? | docs/deviations/T-039.md:134 |
| `D-WHEEL-8` | （**旁证已被否定**）Panel #18 的图 11..21 **不是**转盘素材 | ? | docs/deviations/T-039.md:143 |
| `D-WHEEL-9` | （**已接** · 2026-09-16 第三轮）航空 / 保險也走同一扇窗 | ? | docs/deviations/T-039.md:161 |
| `Q-AI-1` | AI 买哪一支股票 —— **已按原版打分实现（2026-09-14）** | 结案 | docs/known-deviations.md:3740 |
| `Q-AI-2` | AI 的「個性闸门」—— 表解出来了（2026-09-14） | ? | docs/known-deviations.md:3770 |
| `Q-AI-3` | AI 的買地/加蓋判定照 `fcn_0041d7d4` 改写（**已修 2026-09-15**） | 结案 | docs/known-deviations.md:4342 |
| `Q-ANIM-1` | 「動畫過程」設定（`RICH4.CFG+1` = `[0x497159]`）到底管哪些屏 | ? | docs/known-deviations.md:5084（另有 1 处） |
| `Q-ANIM-2` | 「踩到惡犬」那一段演出（狗咬 FLIC）—— 取证、落码与三处未接 | ? | docs/deviations/Q-ANIM-2.md:1 |
| `Q-AUC-1` | 拍賣卡挂出的拍賣，电脑那一手没有出价逻辑（**已修 2026-09-15**） | 结案 | docs/known-deviations.md:4296（另有 1 处） |
| `Q-BANK` | ✅ -1a：特別融資子对话框（`fcn_00434492`）—— **三颗小钮已接（2026-09-16）** | 结案 | docs/deviations/T-029.md:254（另有 5 处） |
| `Q-BANK-1` | 銀行那两屏的**动态部分**（2026-09-15，T-029；**主体已做，见 T-029c**） | ? | docs/known-deviations.md:3441（另有 3 处） |
| `Q-BANK-1-0` | 通用金额窗的**面板几何**已补齐（B-5 / B-6 的第一步） | ? | docs/deviations/T-029.md:153 |
| `Q-BANK-3` | `cashRatio`(+0x19) 到银行时按比例重分現金/存款（**已结案 2026-09-16**） | 结案 | docs/known-deviations.md:1280 |
| `Q-BEGGAR-1` | 破产者变乞丐（**已结案**） | 结案 | docs/known-deviations.md:2348 |
| `Q-BOARD-1` | 公佈欄那三件（**已结案 2026-09-14**） | 结案 | docs/known-deviations.md:4242 |
| `Q-BUILD-1` | `node:zlib` 漏进前端 —— **已修（2026-09-14）** | 结案 | docs/known-deviations.md:1207（另有 1 处） |
| `Q-CAL-1` | 節日那天的专属插画 —— **已做（2026-09-14 夜）** | 结案 | docs/known-deviations.md:2872 |
| `Q-CARD-1` | 偏离登记（换地/换屋的目標類別跟脚下走 + 拆除卡的物件分支） | ? | docs/deviations/Q-CARD-1.md:1 |
| `Q-CARD-2` | AI 想出但引擎接不住的目标，会顺延到下一张卡（**已解决 2026-09-14，T-009**） | 结案 | docs/known-deviations.md:3858 |
| `Q-CHAR-1` | 棋子那 21 个资源只认了 2 个 | ? | docs/known-deviations.md:2824 |
| `Q-CO-1` | 真人在建設公司对等级 0 的設施加蓋要选种类 | ? | docs/known-deviations.md:683 |
| `Q-COM-1` | 企业的持股排名与归属（**已结案**） | 结案 | docs/known-deviations.md:1680 |
| `Q-COMMERCIAL-1` | —— 上市企業落点：**路过 vs 停留**、以及买股的「通用填数窗」 | ? | docs/deviations/Q-COMMERCIAL-1.md:1 |
| `Q-DOLL-1` | 機器娃娃（道具 1）的**动画与音效** —— 表现层缺口 | ? | docs/deviations/Q-DOLL-1.md:1（另有 1 处） |
| `Q-DRAW-1` | 棋盘的绘制顺序（遮挡）—— 原版是**一条按屏幕 Y 排的清单**，现在是两层硬叠 | ? | docs/known-deviations.md:4552 |
| `Q-FAC-1` | 设施的 `type` 在地图数据里恒为 0 | ? | docs/known-deviations.md:475 |
| `Q-FAC-2` | 過路費的免收与尾巴 —— 住宅、設施两路都接上了（2026-09-14 结案） | 结案 | docs/known-deviations.md:728 |
| `Q-FORTUNE-1` | ✅ ：命运事件的**神明加持**从没接上 + 四条事件没实现（**2026-09-16 已修**） | 结案 | docs/known-deviations.md:3888（另有 1 处） |
| `Q-GND-2` | 底图格式已完全解出（**已结案**） | 结案 | docs/known-deviations.md:1611 |
| `Q-GND-3` | 底图格式已完全解出（**已结案**） | 结案 | docs/known-deviations.md:1611 |
| `Q-GND-4` | 底图**不在超分清单里** —— **已进管线 2026-09-15**，接缝随之换口径 | ? | docs/known-deviations.md:1410（另有 2 处） |
| `Q-GOD-1` | 神明附身那扇**老虎机窗**（VA 0x00440706 + 0x0043f23e）未接 ✅ **已接（2026-09-16）** | 结案 | docs/known-deviations.md:1992 |
| `Q-GOD-2` | 神明附身那一刻的**發威效果**（跳表 `ref_0040ea9b`）整批未接 ✅ **已接（2026-09-16）** | 结案 | docs/known-deviations.md:1898 |
| `Q-HOVER-1` | 偏离登记 —— 点棋盘上的企业／景物弹出的「名牌浮标」 | ? | docs/deviations/Q-HOVER-1.md:1 |
| `Q-INIT-1` | 每种卡片的初始张数（**已结案 2026-09-14**） | 结案 | docs/known-deviations.md:548 |
| `Q-INIT-2` | 玩家起始节点（**已结案 2026-09-14**） | 结案 | docs/known-deviations.md:582 |
| `Q-INS-1` | 保險理賠 —— 六个调用点找齐并接线（2026-09-14 结案） | 结案 | docs/known-deviations.md:655 |
| `Q-INS-2` | 地图上没有保險公司时原版会写到企業表外 | ? | docs/known-deviations.md:663 |
| `Q-INTRO-1` | 開局跳伞过场的**画面**复刻不了（AVI 是残档 + 专有编码） | ? | docs/known-deviations.md:3226（另有 1 处） |
| `Q-LAB-1` | 研究所 —— 触发点找到了（2026-09-14 结案） | 结案 | docs/known-deviations.md:688 |
| `Q-LAND-1` | 开局地块上**没有**自造色块；四类立体物的图号都吃视角（2026-09-16） | ? | docs/known-deviations.md:4620 |
| `Q-LAND-2` | 查封／漲價的涨价位没进状态（**已结案 2026-09-14，T-008 + T-084**） | 结案 | docs/known-deviations.md:783 |
| ~~`Q-LAYOUT-1`~~ | 「託管AI」屏那两个亮/暗行图的用法 —— **已结案 2026-09-24**（玩家行底板，gap-audit #20） | ✅ | docs/known-deviations.md:1268 |
| `Q-LAYOUT-2` | 日曆底图 —— **「逐月查表」这条推论已被推翻；真正随地图变的是「節日插画」** | ? | docs/known-deviations.md:797 |
| `Q-LAYOUT-3` | 棋盘「纵向拉长」—— **几何全部核对无误；另修掉真实的地图取景 bug** | ? | docs/known-deviations.md:1173 |
| `Q-LAYOUT-4` | 建筑没有正确落在格子里 —— **已修（2026-09-14）** | 结案 | docs/known-deviations.md:1134 |
| `Q-LAYOUT-5` | 视角切换 / 点小地图跳镜头 —— **已做（2026-09-14 夜）** | 结案 | docs/known-deviations.md:1059（另有 1 处） |
| `Q-LAYOUT-6` | 空地归属 logo —— **已修（2026-09-14）** | 结案 | docs/known-deviations.md:998 |
| `Q-LAYOUT-7` | 樂透投注屏的规则与美术都不对 | ? | docs/known-deviations.md:1016 |
| `Q-LAYOUT-8` | 归属圈线用角色专属色 —— **已修（2026-09-14）** | 结案 | docs/known-deviations.md:960 |
| `Q-MAGIC-1` | 魔法屋的「拍賣當格土地」未接 | ? | docs/known-deviations.md:2052 |
| `Q-MAGIC-2` | 魔法屋「就地加蓋房屋」对設施已生效（2026-09-14 结案） | 结案 | docs/known-deviations.md:722 |
| `Q-MINI-1` | ✅ ：小游戏的玩法本身未实现 —— **已实现（2026-09-16，T-042/043/044，玩法逐条从 `rich4_small_games.asm` 读出）** | 结案 | docs/known-deviations.md:1861 |
| `Q-MUSIC-1` | 配乐的**音色**仍不是原版的（但已接上 SoundFont 播放路径） | ? | docs/known-deviations.md:1741 |
| `Q-NET-1` | 客户端 desync **自愈**（**已结案 2026-09-15**；协议走的是候选 2） | 结案 | docs/known-deviations.md:1445 |
| `Q-NET-2` | 大厅里改角色 / 换地图（**已结案 2026-09-15**） | 结案 | docs/known-deviations.md:1308 |
| `Q-NEWS-1` | 新闻 8/9 的地产统计（**已结案**） | 结案 | docs/known-deviations.md:1605 |
| `Q-NPC-1` | ✅ ：四大惡人的行为 —— 规则已全解，**走子循环尚未接线** —— **已接线（2026-09-16，T-047）** | 结案 | docs/known-deviations.md:2261 |
| `Q-NUM-1` | —— 原版 x87 取整 `__round_toward_zero`（VA 0x00457dbc）订正 | ? | docs/deviations/Q-NUM-1.md:1 |
| `Q-OBJ-1` | 物件落点效果（**已结案**） | 结案 | docs/known-deviations.md:2081 |
| `Q-OBJ-2` | ✅ ：物件重新登场的落点挑法 —— **2026-09-16 已接** | 结案 | docs/known-deviations.md:2116 |
| `Q-OBJ-3` | 替身走子（**基础设施已结案**，NPC 行为另计） | 结案 | docs/known-deviations.md:2160 |
| `Q-OPT-1` | 設定屏主面板 + 三个副屏 + 通用 YES/NO 框（**已按表/汇编复刻**） | ? | docs/known-deviations.md:2512 |
| `Q-PANEL-1` | 右上角四条彩色竖条**点了会换页** —— 先前记成「不换页」是错的（**已做 2026-09-15**） | 结案 | docs/known-deviations.md:3332 |
| `Q-PERF-1` | SpriteCache 的 LRU 淘汰**释放不了内存** + 桌面端 HD 路由 —— **已接线 2026-09-15** | ? | docs/known-deviations.md:1374（另有 2 处） |
| `Q-PICK-1` | ✅ ：目标拾取模式的**贴边推镜头** —— **2026-09-16 已接** | 结案 | docs/known-deviations.md:3369（另有 1 处） |
| `Q-PICK-2` | ✅ ：股票/物件两类目标、以及遙控骰子的输入 UI —— **三类都做了（2026-09-16）** | 结案 | docs/known-deviations.md:3537（另有 9 处） |
| `Q-SAVE-1` | ✅ ：存档写在 localStorage，不是文件 —— **桌面已落文件（T-053，`<AppData>/saves/SAVE<n>.json`）；浏览器仍走 localStorage 属预期** | 结案 | docs/known-deviations.md:3705 |
| `Q-SCENE-1` | ✅ ：場所只铺了底图，控件还是通用对话框 —— **已收口（2026-09-15/16，C 组 22 屏全做完）** | 结案 | docs/known-deviations.md:4136 |
| `Q-SETUP-1` | 開局設定屏三条「画得出来、规则/表现上还没接」—— **已接线（2026-09-16）** | ? | docs/known-deviations.md:4380（另有 1 处） |
| `Q-SHOP-1` | 百貨公司的进货清单（**已结案 2026-09-14**） | 结案 | docs/known-deviations.md:2067 |
| `Q-SOUND-1` | 走子音效（`MOVE_SOUND`）的**时机与号** —— 一次订正 + 一个真缺口 | ? | docs/deviations/Q-SOUND-1.md:1 |
| `Q-SPEECH-1` | 卡面的「1375 段」是错的，真值是 **1374** | ? | docs/deviations/T-051.md:6 |
| `Q-SPEECH-10` | `Data.mkf #0x205` / `#0x207` 两张表**不随 `load_map` 预装** | ? | docs/deviations/T-052.md:360 |
| `Q-SPEECH-11` | 卡牌使用者台词：一条**不走状态差分**的新通道（2026-09-19 补） | ? | docs/deviations/T-052.md:376 |
| `Q-SPEECH-2` | 越界**抛错**而不是夹取 —— 这是本项目的选择，不是原版行为 | ? | docs/deviations/T-051.md:19 |
| `Q-SPEECH-3` | ✅ 中间档的 `rand() & 1`（原「一律取前一句」）—— **2026-09-24 WP-3 改判：状态哈希掷硬币** | 结案 | docs/deviations/T-052.md:36 |
| `Q-SPEECH-4` | 「金额」是从 `monthlyPaid` / `monthlyReceived` 的差分还原的 | ? | docs/deviations/T-052.md:61 |
| `Q-SPEECH-5` | ✅ 原先没解的 5 个槽位 —— **2026-09-19 全部接线** | 结案 | docs/deviations/T-052.md:81 |
| `Q-SPEECH-6` | ✅ 同一动作派生多句时会**叠着响** —— **2026-09-16 已修** | 结案 | docs/deviations/T-052.md:262 |
| `Q-SPEECH-7` | 勘误：事件 15 的判据是**地块的 `+0x1a`（等级）**，不是玩家结构 | ? | docs/deviations/T-052.md:282 |
| `Q-SPEECH-8` | `Speaking.mkf` 改成**按需装载**（本项目的选择） | ? | docs/deviations/T-052.md:298 |
| `Q-SPEECH-9` | ✅ （**2026-09-19 W-50 结案 + 大订正**）台词的气泡/头像**照原样画**，只剩「备份棋盘」不做 | 结案 | docs/deviations/T-052.md:312 |
| `Q-SPRITE-1` | 地块建筑与特殊格的资源编号（**已结案**） | 结案 | docs/known-deviations.md:1639 |
| `Q-STAGE-1` | `screen` 切了但画面不动 —— 两处 `return` 抢在 `blitStage()` 前面（**已修 2026-09-15**） | ? | docs/known-deviations.md:3558 |
| `Q-STOCK-1` | 股市休市日（**已结案 2026-09-14**） | 结案 | docs/known-deviations.md:1500 |
| `Q-STOCK-2` | 企业资产额已接入（**已结案**） | 结案 | docs/known-deviations.md:1574 |
| `Q-STOCK-3` | 停牌中柜台不能买卖（**已结案 2026-09-15**；顺带订正偏移） | 结案 | docs/known-deviations.md:1522 |
| `Q-STOCK-4` | 台股屏的**两页**与标题反了（2026-09-15，T-030） | ? | docs/known-deviations.md:1529 |
| `Q-STOCK-5` | 休市日那一屏是**訊息框** —— 只剩「本日休市」，点哪儿都退屏（2026-09-15，T-030） | ? | docs/known-deviations.md:1543 |
| `Q-STOCK-6` | 偏离登记（股市 · **上市公司資訊**详情卡的「有/无上市公司」两支） | ? | docs/deviations/Q-STOCK-6.md:1（另有 9 处） |
| `Q-STOCK-7` | 偏离登记（股市 · 行情表／持股页里**未上市**（`stock + 4 == 0`）的行画什么） | ? | docs/deviations/Q-STOCK-7.md:1（另有 3 处） |
| `Q-TOLL-FX-1` | —— 過路費「同街地块一起闪」的**逐像素** vs **整张精灵** | ? | docs/deviations/Q-TOLL-FX-1.md:1 |
| `Q-TOOL-1` | 飛彈的爆炸范围是近似的 | ? | docs/known-deviations.md:1821（另有 2 处） |
| `Q-TOOL-2` | 傳送機的「搬設施」那一路（**已结案 2026-09-14**） | 结案 | docs/known-deviations.md:3666 |
| `Q-TOOL-3` | 核子飛彈的 AI 判定不接线（**已解决 2026-09-20，第 160 条**） | 结案 | docs/known-deviations.md:3840 |
| `Q-TOOL-4` | 機器工人（9）「无法给自己的地块修成房子」—— 取证、根因与落码 | ? | docs/deviations/Q-TOOL-4.md:1 |
| `Q-TOOL-5` | 其余 23 个 `_rich4_animate_object` 调用点 + 附身物件的绘制 | ? | docs/deviations/Q-TOOL-5.md:1 |
| `Q-TOOL-6` | 機器工人（9）的**表現層** + 研究所名牌第三行 —— 取証、落碼與殘留 | ? | docs/deviations/Q-TOOL-6.md:1 |
| `Q-TURN-1` | 一回合的三段动画（掷骰 / 骰子滚动 / 走子）—— **已从 exe 全量扒出（2026-09-15）** | ? | docs/known-deviations.md:2993（另有 1 处） |
| `Q-UI-1` | 右下角 200×200 的日曆面怎么标示「今天」 | ? | docs/known-deviations.md:2471 |
| `Q-UI-2` | ✅ ：通用询问框那张底图 —— **已认出来（Data.mkf #517 图 5）** | 结案 | docs/known-deviations.md:2699 |
| `Q-UI-3` | 工具栏图标与操作名的对应关系（**已结案 2026-09-14**） | 结案 | docs/known-deviations.md:2754 |
| `Q-UI-4` | GO 鈕的三组图 + 闪烁 —— **已做（2026-09-14 深夜）** | 结案 | docs/known-deviations.md:2897 |
| `Q-UI-5` | 右側欄四个 tag 页（資金 / 地產 / 股票 / 其他）—— **已做（2026-09-14 深夜）** | 结案 | docs/known-deviations.md:2386 |
| `Q-UI-6` | GO 鈕的拖动没做 —— **已做（本轮）** | 结案 | docs/known-deviations.md:3580 |
| `Q-UI-7` | 走子的方向与脚步声 —— **方向已证无误，脚步声已做（2026-09-15）** | 结案 | docs/known-deviations.md:2929 |
| `Q-UI-8` | 偏离登记 —— 「同一个计算器」与「右键关面板」两条交互统一 | ? | docs/deviations/Q-UI-8.md:1 |
| `Q-UI-9` | 偏离登记 —— 通用填数窗（`fcn_00453544`）的**键盘**补齐 | ? | docs/deviations/Q-UI-9.md:1 |

## 未决 + `?`（首席下一轮要审的清单）

> 其中 42 条的标题行里还带「已修 / 已做 / 已解决 / 已接线 / 完成 / 订正」这类字样 ——
> **状态仍按上表四条标记判为 `?`**（不读正文猜），这些字样只是给首席的线索：
> 下一轮可以把它们正式并进标记表，这里就会自动收敛。

- `D-001`（?）随机数播种策略按模式区分 —— docs/known-deviations.md:8
- `D-003`（?）轉盤对真人也按「起点 + 第一个数字格」算 —— docs/known-deviations.md:626
- `D-004`（?）AI 個性闸门的「1/3」用状态派生的确定性替身 —— docs/known-deviations.md:633
- `D-005`（?）AI 出牌的「视野」不模拟镜头钳位 —— docs/known-deviations.md:4111
- `D-006`（?）AI 选股排名用稳定排序（同分按下标升序） —— docs/known-deviations.md:4105
- `D-007`（?）电脑回合的随机数消费点与原版不完全对齐 —— docs/known-deviations.md:4083
- `D-008`（?）免費卡／嫁禍卡的自动使用，真人也按電腦的规则替他决定 —— docs/known-deviations.md:742
- `D-009`（?）卖东西时那一格「凹进去」的效果 —— 已做，但有一处无法逐像素等同 —— docs/known-deviations.md:748
- `Q-001`（?）地图0「台南市」第 1 块地的房价与同区不一致 —— docs/known-deviations.md:91
- `Q-002`（?）购地卡的敌意更新是空操作（原版 bug） —— docs/known-deviations.md:435
- `D-035-2`（?）（订正）眨眼第 4 步不是「越界读」，是**从图 1 把眼睛拷回来** —— docs/deviations/T-035.md:33
- `D-035-4`（?）（订正）貓女郎的落点：图 1 在 **(210, −5)**，图 2 在 (154, −8) —— docs/deviations/T-035.md:67
- `D-035-5`（?）（订正）蓝色底板与对话气泡 —— docs/deviations/T-035.md:85
- `D-035-6`（?）（**已解决 · 已接上**）`Panel#14` 獎金跑馬燈 —— docs/deviations/T-035.md:99
- `D-035-7`（?）（订正）「拜拜」那一拍：原版**会亮一下**，本屏自己把它留住 —— docs/deviations/T-035.md:116
- `D-035-8`（?）（读反汇编的坑，接手的人避雷）`[0x48c35c]` 是「资源数据 + 0xc」 —— docs/deviations/T-035.md:145
- `D-035-9`（?）（订正）「这一屏画什么」的最终清单 —— 别把開獎屏的东西搬过来 —— docs/deviations/T-035.md:170
- `D-036-1`（?）（**结构性近似**）中奖号只能从 `before → after` 反推 —— docs/deviations/T-036.md:59
- `D-036-2`（?）（近似）脸的「眨眼」改成按帧号推 —— docs/deviations/T-036.md:76
- `D-036-3`（?）（未解出）脸的推进周期 —— docs/deviations/T-036.md:88
- `D-036-6`（?）（**本轮新增 · 近似**）铭牌底框的「压暗」用 canvas 半透明黑重画 —— docs/deviations/T-036.md:113
- `D-040-2`（?）（**已销案**）命中判据 `ebx`/`eax` 谁是 x —— 是 **x**，五格横排 —— docs/deviations/T-040.md:49
- `D-045-1`（?）（订正 · 已修）8 行格图（图 **2 / 3**）原来**整个没画** —— docs/deviations/T-045.md:22
- `D-045-2`（?）（字段读法已订正 · 章↔资源映射已修）剩下的唯一开放问题：滚动单位 —— docs/deviations/T-045.md:78
- `D-045-3`（?）（**已作废**）「上／下滚的画与命中错位」—— 原版本来就是对的 —— docs/deviations/T-045.md:262
- `D-045-4`（?）（**已作废**）「右列几处落点互相打架」—— 每一列都自洽 —— docs/deviations/T-045.md:287
- `D-045-5`（?）（**本轮新增 · 已知限制**）从設定屏推开时四周仍是纯黑 —— docs/deviations/T-045.md:313
- `D-086-3`（?）（未解出 · 需中央复核）右键关窗走的是浏览器 `contextmenu`，而它的时机随平台变 —— docs/deviations/T-086.md:75
- `D-086-6`（?）（已解出，只作记录）三处先前记错的，本轮核清 —— docs/deviations/T-086.md:114
- `D-BANK-1`（?）（**订正 的原文**）面板是 200×280，不是 280×200 —— docs/deviations/T-029.md:25
- `D-BANK-2`（?）（**订正 的原文**）`loc_00437904` 不是「悬停反馈」 —— docs/deviations/T-029.md:47
- `D-BANK-3`（?）（**cross lines 解开**）`fcn_00433c20` 里那次 `fcn_0045643d` = 擦掉三条数额 —— docs/deviations/T-029.md:62
- `D-BANK-4`（?）（**已实现**）貸款屏进屏的两块滑入面板 + 状态机 —— docs/deviations/T-029.md:92
- `D-BANK-5`（?）（**已实现**）ATM 的进度条 / 键盘 / `0x408` —— docs/deviations/T-029.md:128
- `D-BOARD-1`（?）（已消除）市價／掛牌常數改成 core 的真出口 —— docs/deviations/T-033.md:13
- `D-BOARD-3`（?）（**五列与滚动都已补全**；三处近似里**两处已解决**）地產选物窗 —— docs/deviations/T-033.md:76
- `D-BOARD-4`（?）買别人的东西**先弹 YES/NO** —— **2026-09-16 已接** —— docs/deviations/T-033.md:177
- `D-BOARD-6`（?）（引擎必需，非美术偏离）换人自动收屏 —— docs/deviations/T-033.md:221
- `D-BOARD-8`（?）（已解决）时序按契约实现：`down` 记账、`up` 成立 —— docs/deviations/T-033.md:266
- `D-CONFINE-1`（?）2026-09-18：关押/住院时的**屏幕坐标**取节点而非景观（） —— docs/known-deviations.md:5531
- `D-LEGACY-1`（?）2026-09-18：原版落点分派器里的**两处未初始化栈读** —— 复刻的处置（ / ） —— docs/known-deviations.md:5349
- `D-LEGACY-2`（?）2026-09-18：原版落点分派器里的**两处未初始化栈读** —— 复刻的处置（ / ） —— docs/known-deviations.md:5349
- `D-LEGACY-3`（?）2026-09-17：魔法屋**目标筛选器**的第二实参是**未初始化栈读** —— 复刻定为「平手全收」（） —— docs/known-deviations.md:5662
- `D-LEGACY-4`（?）2026-09-19：AI 数手牌用「非零槽个数」当循环上界 —— 手牌有洞时会漏牌（） —— docs/known-deviations.md:5710
- `D-MAGIC-1`（?）（**结构性近似**）落点只能从 `before → after` 反推 —— docs/deviations/T-037.md:23
- `D-MAGIC-10`（?）（近似）女巫只画一处；图 1 在渲染路径里没被画到 —— docs/deviations/T-037.md:278
- `D-MAGIC-11`（?）（近似）绘制顺序：底图 → 字框 → 结果字 → 女巫 → 图标 —— docs/deviations/T-037.md:302
- `D-MAGIC-2`（?）（近似）落点的「动作强度」是猜的排序 —— docs/deviations/T-037.md:44
- `D-MAGIC-4`（?）（未解出）悬停时第二张图**索引进不存在的图** —— docs/deviations/T-037.md:82
- `D-MAGIC-6`（?）（近似）命中几何是**角度**，原版是**逐像素掩膜** —— docs/deviations/T-037.md:170
- `D-MAGIC-7`（?）（近似）图标位置与楔形中线**不是一回事** —— docs/deviations/T-037.md:207
- `D-MAGIC-8`（?）（近似）转盘演出是**我们**加的 —— docs/deviations/T-037.md:222
- `D-MAGIC-9`（?）（**已修**，但记下取证过程）抠黑表第一版是猜的，漏了女巫与图标 —— docs/deviations/T-037.md:241
- `D-MINI-1`（?）（**卡面错误，已接入**）財神屏的底图是 `Panel.mkf` **#92**，走无头 RGB555 出口 —— docs/deviations/T-042-044.md:56
- `D-MINI-11`（?）小游戏音效 —— **2026-09-16 已接** —— docs/deviations/T-042-044.md:231
- `D-MINI-2`（结案）✅ 企鵝的命中表 `Panel.mkf` **#81** —— **2026-09-24 已接**（gap-audit #19；旧条目「取不到、用几何绕开」作废） —— docs/deviations/T-042-044.md:109
- `D-MINI-3`（?）入场 FLIC `Panel.mkf` **#78** —— **2026-09-16 已接**（旧条目的「外壳」判断是误读） —— docs/deviations/T-042-044.md:115
- `D-MINI-4`（?）（**接口订正**）action 是 `{ type: 'minigame', score }`，不是 `minigameScore` —— docs/deviations/T-042-044.md:144
- `D-MINI-8`（?）（原版分支走不到）冰屋那张图不画 —— docs/deviations/T-042-044.md:204
- `D-MONTHLY-1`（?）（**订正**）结算屏那一行头像的落点 —— 查表值是 **y**、x 是常数 600 —— docs/deviations/T-041.md:60
- `D-MONTHLY-10`（?）（**订正**）行头像的图号 = `3×角色 + 47`，**没有**「帧」 —— docs/deviations/T-041.md:518
- `D-MONTHLY-11`（?）（**多余**）结算屏上那 4 个「数字球」/ 金币 —— 原版**没有**这些 blit —— docs/deviations/T-041.md:562
- `D-MONTHLY-12`（?）（**零件已备齐 · 2026-09-16**）结算屏收尾那只「存款」气泡（图 1，落点 190,10） —— docs/deviations/T-041.md:582
- `D-MONTHLY-13`（?）2026-09-18 补： 的「计数」多了一个 —— `[0x48c42b]` —— docs/known-deviations.md:5371
- `D-MONTHLY-4`（?）（**订正**）頒獎屏状态 1 贴的那一小块 —— 是**裁切拷贝**，不是缩放 —— docs/deviations/T-041.md:209
- `D-MONTHLY-5`（?）月結／頒獎屏音效 —— **2026-09-16 已接** —— docs/deviations/T-041.md:239
- `D-MONTHLY-6`（?）頒獎屏状态 8/9 的 FLIC 动画 —— **2026-09-16 已接** —— docs/deviations/T-041.md:338
- `D-MONTHLY-7`（?）（**机制已解出 · 2026-09-16**）「无人获奖」那句 `別灰心，再加油喔！` —— docs/deviations/T-041.md:369
- `D-MONTHLY-8`（?）（**订正**）頒獎屏状态 1 的那一小块 —— 源图是**整屏底图 0**、尺寸 186×410 —— docs/deviations/T-041.md:434
- `D-MONTHLY-9`（?）（**未解出**）结算屏那四行文字：原版写进图 `11..14`，**没有**任何 blit —— docs/deviations/T-041.md:479
- `D-QNUM-1`（?）—— 已修：x87 取整误读为就近取偶 —— docs/deviations/Q-NUM-1.md:162
- `D-QNUM-6`（?）—— **未解**：1.3 表里那些调用点的逐条归属 —— docs/deviations/Q-NUM-1.md:249
- `D-T031-1`（?）（**差在 core**）分红金额：原版**截断**、`companyDividends()` 四舍五入 —— docs/deviations/T-031.md:22
- `D-T031-3`（?）（**订正**）起播判据只有「日期跨到 15 日」——**不加**「确实发了红利」的闸 —— docs/deviations/T-031.md:61
- `D-T031-4`（?）（**已修正**）本屏与樂透開獎屏谁先演 —— docs/deviations/T-031.md:90
- `D-T031-7`（?）（**已按 exe 修正**）版面：一家公司**一行**、一位玩家**一列** —— docs/deviations/T-031.md:138
- `D-T031-8`（?）（**已按 exe 删除**）董事长那一格的蓝底 —— 原版这屏**没有填色调用** —— docs/deviations/T-031.md:172
- `D-T034-1`（?）（**照抄原版**，已定案）PASS 之后那一格显示「住宿中」 —— docs/deviations/T-034.md:11
- `D-T034-3`（?）（解不出）有等级的地块缩略图缺两个全局 —— docs/deviations/T-034.md:65
- `D-T034-4`（?）（**已撤销 2026-09-15**）绕圈上限 12 —— docs/deviations/T-034.md:89
- `D-T034-5`（?）（**已撤销 2026-09-16**）心理价位里的 `rand()` 曾经换成派生种子 —— docs/deviations/T-034.md:104
- `D-T034-6`（?）（**已实证核过**，不是偏离）「Q 版小人」就是黄色描边剪影 —— docs/deviations/T-034.md:149
- `D-T034-8`（?）（记录）dispatch 的形状 —— docs/deviations/T-034.md:201
- `D-T034-9`（?）（记录）本轮由浏览器实测发现并修好的两处 —— docs/deviations/T-034.md:167
- `D-T047-3`（?）`node.flags & 0x80000000` 那一支（`edi + 2` 載具）—— **2026-09-16 已接** —— docs/deviations/T-047.md:124
- `D-WHEEL-1`（?）（取證，非近似）起點槽從 `before.rngState` 反推 —— docs/deviations/T-039.md:24
- `D-WHEEL-10`（?）（近似）行距 +6 是我们的；阴影照原版 —— docs/deviations/T-039.md:221
- `D-WHEEL-2`（?）（**已銷案 2026-09-16**）整屏画在**纯黑**上，原版是画在棋盘上 —— docs/deviations/T-039.md:49
- `D-WHEEL-4`（?）（近似）这一趟转几格是**我们**定的 —— docs/deviations/T-039.md:88
- `D-WHEEL-5`（?）（**已接 2026-09-16**）一个音都不放 —— docs/deviations/T-039.md:106
- `D-WHEEL-6`（?）（近似）真人点一下 = **直接进减速段** —— docs/deviations/T-039.md:122
- `D-WHEEL-7`（?）（近似）开场第一帧 —— docs/deviations/T-039.md:134
- `D-WHEEL-8`（?）（**旁证已被否定**）Panel #18 的图 11..21 **不是**转盘素材 —— docs/deviations/T-039.md:143
- `D-WHEEL-9`（?）（**已接** · 2026-09-16 第三轮）航空 / 保險也走同一扇窗 —— docs/deviations/T-039.md:161
- `Q-AI-2`（?）AI 的「個性闸门」—— 表解出来了（2026-09-14） —— docs/known-deviations.md:3770
- `Q-ANIM-1`（?）「動畫過程」設定（`RICH4.CFG+1` = `[0x497159]`）到底管哪些屏 —— docs/known-deviations.md:5084
- `Q-ANIM-2`（?）「踩到惡犬」那一段演出（狗咬 FLIC）—— 取证、落码与三处未接 —— docs/deviations/Q-ANIM-2.md:1
- `Q-BANK-1`（?）銀行那两屏的**动态部分**（2026-09-15，T-029；**主体已做，见 T-029c**） —— docs/known-deviations.md:3441
- `Q-BANK-1-0`（?）通用金额窗的**面板几何**已补齐（B-5 / B-6 的第一步） —— docs/deviations/T-029.md:153
- `Q-CARD-1`（?）偏离登记（换地/换屋的目標類別跟脚下走 + 拆除卡的物件分支） —— docs/deviations/Q-CARD-1.md:1
- `Q-CHAR-1`（?）棋子那 21 个资源只认了 2 个 —— docs/known-deviations.md:2824
- `Q-CO-1`（?）真人在建設公司对等级 0 的設施加蓋要选种类 —— docs/known-deviations.md:683
- `Q-COMMERCIAL-1`（?）—— 上市企業落点：**路过 vs 停留**、以及买股的「通用填数窗」 —— docs/deviations/Q-COMMERCIAL-1.md:1
- `Q-DOLL-1`（?）機器娃娃（道具 1）的**动画与音效** —— 表现层缺口 —— docs/deviations/Q-DOLL-1.md:1
- `Q-DRAW-1`（?）棋盘的绘制顺序（遮挡）—— 原版是**一条按屏幕 Y 排的清单**，现在是两层硬叠 —— docs/known-deviations.md:4552
- `Q-FAC-1`（?）设施的 `type` 在地图数据里恒为 0 —— docs/known-deviations.md:475
- `Q-GND-4`（?）底图**不在超分清单里** —— **已进管线 2026-09-15**，接缝随之换口径 —— docs/known-deviations.md:1410
- `Q-HOVER-1`（?）偏离登记 —— 点棋盘上的企业／景物弹出的「名牌浮标」 —— docs/deviations/Q-HOVER-1.md:1
- `Q-INS-2`（?）地图上没有保險公司时原版会写到企業表外 —— docs/known-deviations.md:663
- `Q-INTRO-1`（?）開局跳伞过场的**画面**复刻不了（AVI 是残档 + 专有编码） —— docs/known-deviations.md:3226
- `Q-LAND-1`（?）开局地块上**没有**自造色块；四类立体物的图号都吃视角（2026-09-16） —— docs/known-deviations.md:4620
- ~~`Q-LAYOUT-1`~~（✅）「託管AI」屏那两个亮/暗行图的用法 —— 已结案 2026-09-24（玩家行底板） —— docs/known-deviations.md:1268
- `Q-LAYOUT-2`（?）日曆底图 —— **「逐月查表」这条推论已被推翻；真正随地图变的是「節日插画」** —— docs/known-deviations.md:797
- `Q-LAYOUT-3`（?）棋盘「纵向拉长」—— **几何全部核对无误；另修掉真实的地图取景 bug** —— docs/known-deviations.md:1173
- `Q-LAYOUT-7`（?）樂透投注屏的规则与美术都不对 —— docs/known-deviations.md:1016
- `Q-MAGIC-1`（?）魔法屋的「拍賣當格土地」未接 —— docs/known-deviations.md:2052
- `Q-MUSIC-1`（?）配乐的**音色**仍不是原版的（但已接上 SoundFont 播放路径） —— docs/known-deviations.md:1741
- `Q-NUM-1`（?）—— 原版 x87 取整 `__round_toward_zero`（VA 0x00457dbc）订正 —— docs/deviations/Q-NUM-1.md:1
- `Q-OPT-1`（?）設定屏主面板 + 三个副屏 + 通用 YES/NO 框（**已按表/汇编复刻**） —— docs/known-deviations.md:2512
- `Q-PERF-1`（?）SpriteCache 的 LRU 淘汰**释放不了内存** + 桌面端 HD 路由 —— **已接线 2026-09-15** —— docs/known-deviations.md:1374
- `Q-SETUP-1`（?）開局設定屏三条「画得出来、规则/表现上还没接」—— **已接线（2026-09-16）** —— docs/known-deviations.md:4380
- `Q-SOUND-1`（?）走子音效（`MOVE_SOUND`）的**时机与号** —— 一次订正 + 一个真缺口 —— docs/deviations/Q-SOUND-1.md:1
- `Q-SPEECH-1`（?）卡面的「1375 段」是错的，真值是 **1374** —— docs/deviations/T-051.md:6
- `Q-SPEECH-10`（?）`Data.mkf #0x205` / `#0x207` 两张表**不随 `load_map` 预装** —— docs/deviations/T-052.md:360
- `Q-SPEECH-11`（?）卡牌使用者台词：一条**不走状态差分**的新通道（2026-09-19 补） —— docs/deviations/T-052.md:376
- `Q-SPEECH-2`（?）越界**抛错**而不是夹取 —— 这是本项目的选择，不是原版行为 —— docs/deviations/T-051.md:19
- `Q-SPEECH-4`（?）「金额」是从 `monthlyPaid` / `monthlyReceived` 的差分还原的 —— docs/deviations/T-052.md:61
- `Q-SPEECH-7`（?）勘误：事件 15 的判据是**地块的 `+0x1a`（等级）**，不是玩家结构 —— docs/deviations/T-052.md:282
- `Q-SPEECH-8`（?）`Speaking.mkf` 改成**按需装载**（本项目的选择） —— docs/deviations/T-052.md:298
- `Q-STAGE-1`（?）`screen` 切了但画面不动 —— 两处 `return` 抢在 `blitStage()` 前面（**已修 2026-09-15**） —— docs/known-deviations.md:3558
- `Q-STOCK-4`（?）台股屏的**两页**与标题反了（2026-09-15，T-030） —— docs/known-deviations.md:1529
- `Q-STOCK-5`（?）休市日那一屏是**訊息框** —— 只剩「本日休市」，点哪儿都退屏（2026-09-15，T-030） —— docs/known-deviations.md:1543
- `Q-STOCK-6`（?）偏离登记（股市 · **上市公司資訊**详情卡的「有/无上市公司」两支） —— docs/deviations/Q-STOCK-6.md:1
- `Q-STOCK-7`（?）偏离登记（股市 · 行情表／持股页里**未上市**（`stock + 4 == 0`）的行画什么） —— docs/deviations/Q-STOCK-7.md:1
- `Q-TOLL-FX-1`（?）—— 過路費「同街地块一起闪」的**逐像素** vs **整张精灵** —— docs/deviations/Q-TOLL-FX-1.md:1
- `Q-TOOL-1`（?）飛彈的爆炸范围是近似的 —— docs/known-deviations.md:1821
- `Q-TOOL-4`（?）機器工人（9）「无法给自己的地块修成房子」—— 取证、根因与落码 —— docs/deviations/Q-TOOL-4.md:1
- `Q-TOOL-5`（?）其余 23 个 `_rich4_animate_object` 调用点 + 附身物件的绘制 —— docs/deviations/Q-TOOL-5.md:1
- `Q-TOOL-6`（?）機器工人（9）的**表現層** + 研究所名牌第三行 —— 取証、落碼與殘留 —— docs/deviations/Q-TOOL-6.md:1
- `Q-TURN-1`（?）一回合的三段动画（掷骰 / 骰子滚动 / 走子）—— **已从 exe 全量扒出（2026-09-15）** —— docs/known-deviations.md:2993
- `Q-UI-1`（?）右下角 200×200 的日曆面怎么标示「今天」 —— docs/known-deviations.md:2471
- `Q-UI-8`（?）偏离登记 —— 「同一个计算器」与「右键关面板」两条交互统一 —— docs/deviations/Q-UI-8.md:1
- `Q-UI-9`（?）偏离登记 —— 通用填数窗（`fcn_00453544`）的**键盘**补齐 —— docs/deviations/Q-UI-9.md:1

## 只在正文出现、没有独立标题的编号（不判状态）

- `D-045-6` —— docs/known-deviations.md:4905
- `D-EVENT-1` —— docs/known-deviations.md:4873
- `D-EVENT-2` —— docs/known-deviations.md:4879
- `D-EVENT-3` —— docs/known-deviations.md:4880
- `D-EVENT-4` —— docs/known-deviations.md:4881
- `D-EVENT-5` —— docs/known-deviations.md:4882
- `D-EVENT-6` —— docs/known-deviations.md:4883
- `D-MINI-12` —— docs/known-deviations.md:5051
- `D-T047-8` —— docs/known-deviations.md:4934
- `D-T053-1` —— docs/known-deviations.md:4977
- `D-T053-2` —— docs/known-deviations.md:4978
- `D-T053-3` —— docs/known-deviations.md:4979
- `D-T055-1` —— docs/known-deviations.md:4969
- `D-T055-2` —— docs/known-deviations.md:4971
- `D-T055-3` —— docs/known-deviations.md:4972
- `Q-FIN-2` —— docs/known-deviations.md:4046
