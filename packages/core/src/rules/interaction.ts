/*
 * 落点交互
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 原版的各个场所（银行、百货、魔法屋、乐透、拍卖……）都是**模态 UI**：
 *   落地后弹窗，玩家在里面操作，操作完才继续回合。
 *
 *   按 C-ARC-2，这些界面不进 core。但「落在这格上会要求玩家做什么」
 *   **是规则**，必须由 core 说了算——否则 UI 和 AI 各自猜一套，
 *   联机时两端就会对不上。
 *
 *   故此处定义一个**待决交互**类型：core 判定「现在需要一个什么样的决定」，
 *   外部（人类 UI 或 AI）给出答案，再以 action 形式送回。
 *   这与卡片目标选择是同一套路子。
 */

import { SPECIAL_KIND } from '../loaders/map.ts';
import type { ConfinementKind } from './confinement.ts';
import type { AuctionSeatStatus } from './auction.ts';

/**
 * 落点要求玩家做的决定。
 *
 * `kind` 之外的字段是**做这个决定所需的信息**，由 core 算好给出——
 * UI 不该自己去翻规则。
 */
export type PendingInteraction =
  /** 无需交互，直接继续 */
  | { kind: 'none' }
  /** 无主地：买或不买 */
  /**
   * ★ `name` 不是多余的：原版的问句本身就是
   *   `'%s\n\n費用:%d元\n\n是否買下此地？'`（@source VA 0x004639e1），
   *   地名是这句话的一部分。让 UI 自己拿 landId 回地图里查，就等于把
   *   「这一格叫什么」这件事散到两处去（C-ARC-2）。
   */
  | { kind: 'buyLand'; landId: number; name: string; price: number }
  /** 自有地：盖或不盖 */
  | { kind: 'upgradeLand'; landId: number; name: string; cost: number }
  /**
   * 无主設施：买或不买。问句与買地共用同一条原文（@source 0x0041a8a5 push 0x4639e1）。
   * 价 = 地價 × 物價指數。
   */
  | { kind: 'buyFacility'; facilityId: number; name: string; price: number }
  /**
   * 自己的**空地**設施（等级 0）：选五种建筑之一并蓋第一级。
   *
   * @source 0x0041a1f2 `cmp level, 0 / jne 加蓋`；真人走 `0x440aac` 选种类，
   *   电脑 `rand() % 4 + 1`。价 = 地價 × 物價指數（与買地相同）。
   * `choices` 是 0..4 全部五种 —— 真人可以选公園，电脑抽不到而已。
   */
  | {
      kind: 'buildFacility';
      facilityId: number;
      name: string;
      price: number;
      choices: readonly number[];
      /**
       * 神明顯靈**代蓋**的那一次（天使 / 福神，`0x40b110` 里的 `0x0040b1e4 call 0x440aac`）：
       * 不收钱、不看归属。缺席 = 落点问出来的那个普通首建。
       */
      free?: true;
    }
  /** 自己的設施（等级 ≥ 1）：加蓋一级。价 = 房價 × 物價指數 */
  | { kind: 'upgradeFacility'; facilityId: number; name: string; cost: number; level: number }
  /**
   * 自己的**已建研究所**：落点收尾时选一个研發項目（1..等级）。
   * @source 0x0041b0b3..0x0041b109：落点结算末尾，`code ∈ 設施 && owner == 我 && 不在夢遊
   *   && type == 4 && level != 0 && (+0x1c & 0xf) == 0（没被查封）` → 开研究所面板 0x44101d；
   *   真人在面板里点（0x4402d7），电脑走 0x4411e7 直接选「等级」那一档。
   */
  | { kind: 'research'; facilityId: number; name: string; level: number; choices: readonly number[] }
  /**
   * 建設公司：选一处自己的地免费加蓋一级。
   * @source 0x0041acd1（别人的建設公司，之后付工程費）/ 0x0041aa3c（自家的，免费）。
   *   真人用 `0x446ae8` 点地图选，电脑走 `0x40b455`（reducer 里直接挑）。
   * `choices` 是可加蓋的实体编码（0x7d0 + 地块 / 0xfa0 + 設施）；`charge` 是选完要不要付工程費。
   */
  | { kind: 'chooseBuildTarget'; commercialId: number; name: string; choices: readonly number[]; charge: boolean }
  /**
   * ★ 第十四份（D-008 收口）：收費那一段问**真人**用不用免費卡（`fcn_00444a60` 真人支，
   *   `0x00444a92 cmp byte [+0x15],1 / je 0x444ad8` → `0x00444af4 call 0x440ba8`，YES = 1 才用）。
   *   `name` = 付款方名字（问句 `%s\n\n是否使用免費卡？` 的 `%s`）；`tail` = 答完接着走的那一段。
   */
  | { kind: 'freeCard'; name: string; tail: TollTailCtx }
  /**
   * ★ 第十四份（D-008 收口）：真人嫁禍卡 —— 候选 = 在场、不是自己（`0x004447bf` / `0x004447c8`，按下标序）。
   *   恰好 1 位 ⇒ YES/NO「是否嫁禍給%s？」（`0x00444849`）；否则 ⇒ 选人窗（`0x004448a1 call 0x440e1a`）。
   *   答 −1（NO / 右键）⇒ 不嫁禍、卡留着。
   */
  | { kind: 'scapegoat'; candidates: readonly number[]; names: readonly string[]; tail: TollTailCtx }
  /**
   * 银行：存、取、借、还，外加董事長专属的特別融資。
   *
   * @source 落点 VA 0x00436668 —— 先查 `days_rejected_by_bank`，
   *   非 0 直接返回（拒绝往来期内连门都进不去）。
   *
   * ★ `specialFinance` 只有**董事長**才有（`null` = 不是董事長 ——
   *   原版那扇窗户里就看不见人）。见 places/special-finance.ts。
   */
  | {
      kind: 'bank';
      wealth: number;
      loanCapacity: number;
      specialFinance: { owed: number; available: number } | null;
    }
  /**
   * ★ **路过**銀行格（走子途中经过、不是落点）弹出来的那台 ATM —— 只有存款 / 提款（第八份试玩回报 #4）。
   *
   * @source 走子每一格的到达处理 `fcn_0041b42d`：`0x0041b53f cmp [格的特殊種類],0xe`（銀行）/
   *   `0x0041b550 cmp byte [player+0x37],0`（夢遊中不弹）/ `0x0041b55d cmp [0x48baf8],0`（**还有步数** = 路过）/
   *   `0x0041b56a cmp [格上物件的種類],0x10`（格上有路障就不弹）→ `0x0041b5ab call 0x4379c9`（ATM 入口：
   *   真人 `who_plays == 1` 开 ATM 窗；电脑按 `cashRatio` 重分；拒絕往來期内只弹「銀行拒絕往來 還剩%d天！」）。
   *   窗是模态的：办完一笔（或右键取消）就关，走子接着走。
   * `phase` 保持 `moving`；`step` 见到它就不动，直到它被清掉。
   *
   * ★ 第十三份试玩回报 #2：**落在**銀行格上也是先开这台 ATM（`landing: true`），关掉之后才进貸款屏 ——
   *   @source 落点分派 `0x0041b396 call 0x4379c9`（ATM 入口）→ `0x0041b39b cmp byte [0x46caf8],0 / jne`
   *   （终局码非 0 就不往下）→ `0x0041b3af call 0x436668`（貸款屏入口）。
   *   `landing` 缺省 = 路过（旧快照里的 `{ kind: 'atm' }` 照旧是路过那台）；落点那台 `phase` 是 `turnEnd`，
   *   答掉（办一笔 / 关窗）之后 `pending` 换成 `kind: 'bank'`。
   */
  | { kind: 'atm'; landing?: true }
  /**
   * ★ **还款提醒窗**（距还款日恰好 3 天、**恰好** `who_plays == 1` 的真人，回合开始时）。
   *
   * @source `0x0041c86d call 0x436a5a` → 跳表 `0x436a4a[3]` = `0x436b01 call 0x43695e` →
   *   `0x00436969 cmp byte [player+0x15], 1 / jne 返回` → 读貸款屏的图（`read_mkf(panel, 0x17)`）、
   *   `0x004369e2 call 0x4549cf(4)`（貸款屏配乐）→ `0x004369f1 call 0x4018e7(0x436034)`（**模态**窗）。
   *   窗过程 `0x436034`：`0x401` 用 `0x434186(0)` 铺貸款屏（店員室 + 两块面板），三句依次挂在店員的气泡里
   *   ——「%s您好」（`0x464aee`）→「您向銀行借貸的\n貸款即將到期。」（`0x464a2d`）→「請不要忘記喔！」（`0x464a4b`），
   *   每句到点（`0x44ee18`，2000 ms）或左键就换下一句，右键直接跳到最后；第三句收了关窗。
   *
   * 相位留在 `turnStart`；答 `declineDecision`（= 关窗）之后 `0x41c84f` 才接着走完这一天的计数。
   * 这扇窗**不改任何状态**（原版窗里只有店員的眨眼动画在掷 `rand()`，本引擎不复刻那段装饰动画）。
   */
  | { kind: 'loanReminder' }
  /**
   * 樂透：挑一个没被买走的号码。
   * @source 落点 VA 0x004315cc
   *
   * ★ 只有**真人**收得到这个交互，而且**一次落点只买一注**：原版买中的那一下
   *   投注屏就自己关了（VA 0x0042ffd1 → `PostMessage(0x406,3,0)` → state 5）。
   *   电脑在原版里根本没有屏，落点当场买完 —— 见 `state/reduce.ts` 的
   *   `landOnLottery`。
   */
  | { kind: 'lottery'; available: number[]; price: number; owned: number }
  /**
   * 拍卖：竞价循环的**状态**。
   *
   * @source `run_auction` VA 0x0043bde5（入口/窗口过程 `fcn_0043a2dd`）
   *
   * ★ Q-AUC-1 定案（2026-09-15）：竞价循环归 core —— 原版那条 100ms 定时器
   *   刷新循环（轮到谁 → 真人点钮 / 电脑算一口 → `loc_0043b295` 复查）
   *   现在立在 `rules/auction.ts`，`state/reduce.ts` 的 `auctionBid`
   *   一个 action 走一口。表现层（`client/auction-screen.ts`）只负责
   *   **收集真人的那一口**并把 core 的每一口演出来。
   *
   * 之所以不能像别的交互那样整条留给表现层：`packages/server` 是**无头**跑
   * core 的（服务器权威），纯 AI 局也走同一条路 —— 没有屏可点，pending
   * 就永远答不掉（soak 卡死）。
   */
  | {
      kind: 'auction';
      entityId: number;
      /** 起拍价 `[0x48c488]` 的初值（= `auctionBasePrice` 的产物） */
      basePrice: number;
      /** 可以出价的玩家下标。core 已排除出局者与**发起者（arg0）** */
      bidders: number[];
      /**
       * **发起者**（= 原版 `arg0`）的玩家下标 —— ★ **第 160 条订正**：
       *   它**不是**「待拍实体的现主」。三条调用点各自的 arg0：
       *   拍賣卡 = **用卡者**（`0x44334e push ebx`，`ebx = [0x49910c]`）、
       *   魔法屋 = 中签者、新聞 7 与破产清算 = **−1**（没有发起者）。
       *
       * ★ 原版在座位表里给「玩家号 == arg0」那一格写状态 **7**
       *   （`0x43c23c mov word [座位+2],7`；判据是 `0x43c22a cmp ebx,ebp`，
       *   `ebp = [esp+0xac] = arg0`），出价循环因此永远跳过它
       *   （`loc_0043b3c2` 的绕圈）。**地主不在排除之列** ——
       *   原版 `0x43c11f` 只看 `+0x15`（出局），从不看 owner ⇒
       *   地主可以举牌把自己的地买回来。
       *   本引擎的 `status` 没有「7」这一档，故把它单列一个字段，让
       *   `auctionFirstSeat` / `auctionAdvanceSeat` 显式跳过他 ——
       *   否则无主地自拍（`bidders` 含发起者且他是 `'active'`）会把出价权
       *   交给他，屏上等他自己点（外部审查 A-3）。
       *
       * ★ 落槌款也付给**这个人**（`0x43c855 pay_money(得标者, arg0, 现价, 0)`）
       *   ⇒ 拍賣卡拍别人的地时，钱归**用卡者**（不是公库、也不是地主）。
       *   `-1` = 没有发起者（款进公库、谁都不排除）。
       */
      seller?: number;
      /** 設施拍卖（拍賣卡踏在設施格上时挂出） */
      facility?: boolean;
      /**
       * ★ 2026-09-24 审计补：流拍后清归属与到期日 —— 只有**拍賣卡**（`0x0044335b` / `0x00443486`）这么做；
       *   魔法屋 / 新聞 7 / 破产清算丢掉 `run_auction` 的返回值，原样不动。见 `AuctionSettlementOptions.clearOnPassIn`。
       */
      clearOnPassIn?: true;
      /** 现价 `[0x48c488]`：每一口加价都改写它；还没人出价时 = `basePrice` */
      price: number;
      /** 当前最高出价者的**玩家下标**；-1 = 还没人出价 @source `[0x48c4a8]` */
      top: number;
      /**
       * 当前最高出价者**出那一口时的现金** @source `[0x48c438]` 之类的现场快照。
       * `loc_0043b183` 要拿「最高者的现金 + 500」当压价线，而最高者可能已经
       * PASS 离场，届时再读他的现金就不是当时那个数了 —— 故出价时记下来。
       * `top < 0` 时无意义。
       */
      topCash: number;
      /**
       * 轮到哪个座位（0..3）@source `[0x48c4a4] & 3`。
       * 座位按玩家下标排，故就是「轮到哪个玩家」。
       */
      seat: number;
      /**
       * 各座位的状态，下标 = 玩家下标 @source `[0x48c436 + 20i]`：
       * `'active'` = 0（还能出价）、`'passed'` = 1（已 PASS，★ 永久）、
       * `'givenUp'` = 4（按了「放棄」/ 出不起，同样永久）。
       */
      status: AuctionSeatStatus[];
      /**
       * 各座位的**心理价位**（下标 = 玩家下标）@source 座位 `+8` `[0x48c438]`。
       * 开拍时算一次就定住；真人座位是 0。
       */
      limits: number[];
    }
  /**
   * **开拍请求** —— 卡片等调用点能提供的那几项。
   *
   * 竞价循环要的其余字段（现价 / 最高者 / 座位状态 / 心理价位）由 core 在
   * 挂出 pending 时补齐（`state/reduce.ts` 的 `openAuction`）—— 因为
   * 「心理价位」要读全局随机状态，只有 reducer 手上有。
   */

  /**
   * 上市企业：买多少股。
   *
   * @source 落点 VA 0x0041d277：拿到股数后
   *   `buy_stock(玩家, commercial[+0x19], 股数, 0)`，末位 0 即「从企业买」。
   *
   * `unitPrice` = `企业资产额 ÷ 10000`（整数除），**从现金付**，
   * 与股市柜台那条（从存款付、按股价）是两回事。
   *
   * ★ `max` 是**通用填数窗的上限**，由 core 按原版 `fcn_0041d1a9` 算好
   *   （见 `places/company.ts` 的 `shareWindowLimit`）。UI 只许把它交给
   *   `AmountPage`，**不许自己再算一遍**（C-ARC-2）。
   */
  | {
      kind: 'buyShares';
      /** 1 基企业序号 */
      commercialId: number;
      /** 企业名，UI 直接用 */
      name: string;
      /** 对应股票下标 0..11 */
      stock: number;
      /** 每股价格 */
      unitPrice: number;
      /** 企业还剩多少股可卖 */
      available: number;
      /**
       * 通用填数窗的**上限** = `min(1000, 現金 ÷ 每股售價, available)`
       * —— 原版 `fcn_00453544(上限)` 吃到的就是这个数。
       *
       * ★ **电脑也吃这个上限**：`0x0041d267 push esi` 把同一个夹好的数交给
       *   `_rich4_calculate_max_purchase_count`（VA 0x0041d839）当上限（见
       *   `places/company.ts` 的 `aiCommercialShareCount`）；reducer 拒收超过它的股数。
       */
      max: number;
      /** 买家现金 —— 只在题面上显示；能买多少股已经由 `max` 定死 */
      cash: number;
    }
  /**
   * 百貨公司：买卖卡片与道具，**花的是點數**。
   *
   * @source `_rich4_player_buy_card` / `_rich4_player_buy_tool`
   *   都从玩家 +0x30（點數）扣，不动现金。
   */
  | {
      kind: 'shop';
      /** 手上的點數 —— 买得起什么由 UI/AI 自己算 */
      points: number;
      /**
       * 货架上的卡片：编号与標價，**按行**（下标 = 货架第几行）。
       *
       * ★ `sold` = 本次进店已经买掉的那一行 —— **留在原位、不删**：原版买完把那一行的货名与价格
       *   用灰字（`create_font(0x14, 0xa0a0a0, 0x101010, 3, 0)`）重画进货架栏那张图、再把货架字节
       *   清 0（点上去 `je` 直接返回）@source 0x0042e236..0x0042e379（卡片）/ 0x0042e4ba..0x0042e5f6（道具）。
       *   没买过的行不带这个字段（进店时的形状与先前一样）。
       */
      cards: { id: number; name: string; price: number; sold?: true }[];
      /** 可买的道具：编号、標價、全局库存（编号 > 8 不限量，给 null）；`sold` 同上 */
      tools: { id: number; name: string; price: number; stock: number | null; sold?: true }[];
      /**
       * **自己手上**的卡片与道具 —— 这一屏能卖，退九成點數。
       *
       * ★ 需求方描述这一屏时说得很清楚：「右下侧是自己已有的卡片列表，
       *   点击可以卖出自己的卡片换得点数」。规则引擎里 `sellCard`/`sellTool`
       *   一直有，只是 `pending` 没把「你手上有什么」带出来，界面便无从显示。
       */
      owned: {
        cards: { id: number; name: string; refund: number }[];
        tools: { id: number; name: string; count: number; refund: number }[];
      };
    }
  /**
   * 小游戏：企鵝挖寶 / 七彩氣球 / 喜從天降。
   *
   * ★ 规则上只产出一笔點券。玩法本身是表现层的事，
   *   分数作为答复送回来（`minigameScore`）；不玩就按 50..69 抽一个。
   *
   * @source 落点跳表第 6/7/8 项，见 places/minigame.ts
   */
  | {
      kind: 'minigame';
      /** 6/7/8，见 `MINIGAME` */
      game: number;
      name: string;
      /** 分数上限 —— 超出会被夹回来 */
      maxScore: number;
    }
  /**
   * 探監／探病：花點券**保釋**里面的人。
   *
   * @source 監獄落点 0x0043d304 / 醫院落点 0x0043e9a4，见 rules/visit.ts
   */
  | {
      kind: 'bail';
      /** 'prison' | 'hospital' */
      place: ConfinementKind;
      candidates: {
        slot: number;
        player: number;
        name: string;
        cost: number;
        affordable: boolean;
      }[];
      /** 访客手上的點券 */
      points: number;
    }
  /**
   * 尚未实现的场所。
   *
   * ⚠️ 这一项存在的意义是**让缺口可见**：落在百货/魔法屋/小游戏上时，
   * 上层会收到一个明确的「这里还没做」，而不是悄无声息地什么都不发生。
   *
   * `options` 用来在「选项表已解出、效果还没做」时把缺口具体到条。
   * 魔法屋曾经是这种情况，现在已实现（见 places/magic-house.ts），
   * 故眼下没有场所在用它——留着是因为三个小游戏迟早会用上。
   */
  /**
   * 命運 5「今天是你生日 向每人收取一張卡片」的**真人**那一支（T-055）。
   *
   * @source `fcn_0044c3b7`（`rich4_fortune.asm:541`）的施加阶段：逐个座位升序筛
   *   「不是自己 / 没出局 / 手上有牌」；**寿星的 `whoPlays == 1`（真人）**时，
   *   每一位合格的人都走一次 `fcn_0044192a(对方, 寿星, 0)` —— 那扇模态选牌窗
   *   （模式 0 ⇒ 只有卡片欄，见 `client/src/steal-picker.ts`）。
   *   电脑当寿星时同一位走 `player_drop_random_card`（当场在 core 里掷）。
   *
   * ⇒ 真人这一支必须**分帧**：本交互挂出时 `players` **一个字都没改**，
   *   `seats` 是还没处理的座位（升序），`seats[0]` 就是此刻要挑的那一位；
   *   答 `{type:'birthdayCard', seat, cardId}`（`cardId = 0` = 原版右键取消，跳过这位）。
   *   ★ 原版那个计数器 `edi` 对**每个合格的人**都 +1（与挑没挑到无关），
   *     故取消也算「处理过一位」—— 座位一律前进。
   */
  | {
      kind: 'birthdayCard';
      /** 还没处理的座位（升序）；空数组不会挂出来（那一位都不合格时当场收尾）*/
      seats: readonly number[];
    }
  /**
   * 魔法屋（**真人**那一支）：目标转盘已经转完，等玩家在女巫窗口里**点一个效果**。
   *
   * @source 入口 `0x0043380a`：`0x0043381b cmp byte [player+0x15], 1 / jne 0x43390b`
   *   —— `who_plays == 1` 开女巫窗口 `0x4325c2`（`0x004338af`），**窗口返回值就是效果号**
   *   （`0x004338b7 mov esi, eax` → `0x004339c5 push esi / call 0x431caa`）。
   *   目标转盘在窗口里转（状态 4，`loc_00432719`：`rand() % 12` 选不出人就重抽），
   *   玩家在状态 7 点 1..12 格（`loc_00432e8e`），返回 `格号 − 1`（`0x00432a74`）。
   *   电脑（`who_plays != 1`）不开窗，两个转盘都 `rand()`（`0x0043390b`），不挂本交互。
   *
   * 答 `{type:'magicHouse', option}`：`option` = 0..11（全部 12 项都点得到）；
   *   `null` = 真人被託管、由电脑那一支替他掷（`rollMagicOption`）。
   */
  | { kind: 'magicHouse'; criterion: number; targets: readonly number[] }
  | { kind: 'unimplemented'; place: string; specialKind: number; options?: readonly string[] };

/**
 * 一段契约：**开拍请求** —— 调用点（拍賣卡等）能提供的那几项。
 *
 * 竞价循环要的其余字段（现价 / 最高者 / 座位状态 / 心理价位）由 core 在挂出
 * pending 时补齐（`state/reduce.ts` 的 `openAuction`）—— 因为「心理价位」
 * 要读全局随机状态与地图表，只有 reducer 手上有。
 */
export type AuctionRequest = Pick<
  Extract<PendingInteraction, { kind: 'auction' }>,
  'kind' | 'entityId' | 'basePrice' | 'bidders' | 'facility' | 'seller' | 'clearOnPassIn'
>;

/** `auction` 的**完整**形状（竞价循环进行中，字段一定齐） */
export type AuctionPending = Extract<PendingInteraction, { kind: 'auction' }>;

/** 各特殊格对应的场所名 —— 仅用于 `unimplemented` 的可读性 */const PLACE_NAMES: Readonly<Record<number, string>> = {
  // ★ **空的** —— 17 种特殊格已全部接上规则：
  //   公園/新聞/命運/監獄/醫院/三个小游戏/樂透/三种點數格/卡片/
  //   銀行/百貨公司/魔法屋。
  //   这张表与 `unimplemented` 那一路**保留不删**：往后要是解出新的
  //   特殊格类型、或者某条规则要临时退场，得有地方明确说「这里还没做」，
  //   而不是悄无声息地什么都不发生。
};

/**
 * 这一格是否需要交互。
 *
 * ⚠️ 監獄與醫院落点**并非总要交互**：原版先查占用表，
 * 无人在押时直接返回（即「探监」没人可探）。
 * 该判断需要占用表，故不在本函数内做——见 `rules/confinement.ts`
 * 的 `anyoneConfined`。
 */
export function needsInteraction(specialKind: number): boolean {
  switch (specialKind) {
    case SPECIAL_KIND.NONE:
    case SPECIAL_KIND.PARK:
    // 新聞/命運/點數/抽卡 都是**即时结算**，不需要玩家做决定
    case SPECIAL_KIND.NEWS:
    case SPECIAL_KIND.FORTUNE:
    case SPECIAL_KIND.POINTS_50:
    case SPECIAL_KIND.POINTS_30:
    case SPECIAL_KIND.POINTS_10:
    case SPECIAL_KIND.CARD:
      return false;
    default:
      return true;
  }
}

/** 该特殊格是否尚未实现 */
export function isUnimplementedPlace(specialKind: number): boolean {
  return specialKind in PLACE_NAMES;
}

/** 构造一个「尚未实现」的交互，带上可读的场所名 */
export function unimplementedPlace(specialKind: number): PendingInteraction {
  const base = {
    kind: 'unimplemented' as const,
    place: PLACE_NAMES[specialKind] ?? `特殊格${specialKind}`,
    specialKind,
  };
  return base;
}

/** 玩家对待决交互给出的答复 */
export type InteractionResponse =
  | { kind: 'decline' }
  | { kind: 'buyLand' }
  | { kind: 'upgradeLand' }
  | { kind: 'buyFacility' }
  | { kind: 'buildFacility'; facilityType: number }
  | { kind: 'upgradeFacility' }
  | { kind: 'research'; project: number }
  | { kind: 'buildTarget'; entityId: number }
  | { kind: 'bankDeposit'; amount: number }
  | { kind: 'bankWithdraw'; amount: number }
  | { kind: 'bankBorrow'; amount: number }
  | { kind: 'bankRepay'; amount: number }
  /** 特別融資：借 / 還。只有銀行董事長能用 */
  | { kind: 'bankFinanceBorrow'; amount: number }
  | { kind: 'bankFinanceRepay'; amount: number }
  | { kind: 'lotteryBuy'; number: number }
  /**
   * 拍賣的一口价 —— 由 core 的循环消费（`state/reduce.ts` 的 `auctionBid`）。
   *
   * ★ Q-AUC-1 之前这里是 `auctionBid{winner, price}`（终局），现已改成
   *   **一口价**：竞价过程本身归 core 了，终局由 core 自己判、自己落。
   */
  | { kind: 'auctionBid'; bidder: number; status: 'raise' | 'pass' | 'giveUp'; step: number }
  | { kind: 'buyShares'; shares: number }
  | { kind: 'shopBuyCard'; cardId: number }
  | { kind: 'shopBuyTool'; toolId: number }
  | { kind: 'shopSellCard'; cardId: number }
  | { kind: 'shopSellTool'; toolId: number; count: number }
  /** 小游戏玩完了，报上得分；`null` 表示没玩（按 50..69 抽） */
  | { kind: 'minigameScore'; score: number | null }
  /** 保釋某个槽位的人 */
  | { kind: 'bail'; slot: number }
  /**
   * 命運 5 生日收卡：挑一位手里的一张（T-055）。
   * `cardId = 0` = 跳过这位（原版选牌窗右键取消）。
   */
  | { kind: 'birthdayCard'; seat: number; cardId: number }
  /** 魔法屋：真人点的效果号 0..11（`null` = 託管，电脑替他掷）*/
  | { kind: 'magicHouse'; option: number | null }
  | { kind: 'freeCard'; use: boolean }
  | { kind: 'scapegoat'; target: number };

/**
 * ★ 第十四份：收費那一段「神明调整之后、付钱之前」的被动卡尾巴走到哪了 —— 答完真人那一问好接着走。
 *   三条路（住宅 `0x00419e01`、設施 `0x0041a648`、企業 `0x0041aed7`）同一个形状。
 */
export interface TollTailCtx {
  route:
    | { path: 'rent'; landId: number }
    | { path: 'facility'; facilityId: number; hotelDays: number }
    | { path: 'company'; commercialId: number; travelDays: number };
  /** 当前玩家（问的人、免費卡 / 嫁禍卡的持有人）*/
  payer: number;
  /** 最后付钱的人（嫁禍 / 死神会换）*/
  who: number;
  /** 当前金额（神明调整之后；用了免費卡就是 0）*/
  toll: number;
  feeName: string;
  /** 免費卡那一步已经走过 */
  freeDone: boolean;
}

/** 答复与待决交互是否配套——防止 UI 送回驴唇不对马嘴的 action */
export function responseMatches(
  pending: PendingInteraction,
  response: InteractionResponse,
): boolean {
  if (response.kind === 'decline') return true;
  switch (pending.kind) {
    case 'buyLand':
      return response.kind === 'buyLand';
    case 'upgradeLand':
      return response.kind === 'upgradeLand';
    case 'buyFacility':
      return response.kind === 'buyFacility';
    case 'buildFacility':
      return response.kind === 'buildFacility';
    case 'upgradeFacility':
      return response.kind === 'upgradeFacility';
    case 'research':
      return response.kind === 'research';
    case 'chooseBuildTarget':
      return response.kind === 'buildTarget';
    case 'bank':
      return response.kind.startsWith('bank');
    case 'atm':
      return response.kind === 'bankDeposit' || response.kind === 'bankWithdraw';
    case 'lottery':
      return response.kind === 'lotteryBuy';
    case 'auction':
      return response.kind === 'auctionBid';
    case 'buyShares':
      return response.kind === 'buyShares';
    case 'shop':
      return response.kind.startsWith('shop');
    case 'minigame':
      return response.kind === 'minigameScore';
    case 'bail':
      return response.kind === 'bail';
    case 'birthdayCard':
      return response.kind === 'birthdayCard';
    case 'magicHouse':
      return response.kind === 'magicHouse';
    case 'freeCard':
      return response.kind === 'freeCard';
    case 'scapegoat':
      return response.kind === 'scapegoat';
    default:
      return false;
  }
}
