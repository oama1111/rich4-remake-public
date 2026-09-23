/*
 * 原版的文案 —— 从 rich4.exe 的 DGROUP 段原样取出
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这里**一个字都不是自己写的**。每一条都带虚拟地址，
 *   `messages.test.ts` 会拿 rich4.exe 逐条比对，改一个字就红。
 *
 * ⚠️ 格式串里的 `%s` / `%d` 与 `\n\n` 都是原版自己的。凡是要往界面上
 *   放文字，先来这里找有没有现成的，不要另写一份中文 —— 自己写的那份
 *   跟原版永远差一点，而差在哪没人说得清。
 *
 * ⚠️ 原版是 Big5 编码的繁体中文。两字词中间那两个空格（「現  金」）
 *   是**两个半角空格**（0x20 0x20），按等宽格排出来的，不是排版失误。
 *   看着像一个全角空格，改成全角就不对了。照抄。
 */

/** 一条原版文案：文本 + 它在 rich4.exe 里的虚拟地址 */
export interface OriginalText {
  readonly text: string;
  readonly va: number;
}

const t = (text: string, va: number): OriginalText => ({ text, va });

/** 落地时的询问。★ `\n\n` 是原版自己的分段，不是我们加的。 */
export const PROMPT = {
  /** 买地：%s 地名、%d 价钱 */
  buyLand: t('%s\n\n費用:%d元\n\n是否買下此地？', 0x4639e1),
  /** 盖房：%s 地名、%d 造价 */
  upgradeLand: t('%s\n\n升級費用:%d元\n\n是否升級？', 0x46396d),
  /** 入股：%s 企业名、%d 每股售价 */
  buyShares: t('%s\n\n每股售價%d\n\n是否認購股份？', 0x463b75),
  /** 嫁祸卡选人：%s 对象名 */
  frameUp: t('是否嫁禍給%s？', 0x46534e),
} as const;

/** 提示与失败 */
export const NOTICE = {
  cashShort: t('您的現金不足！', 0x46398b),
  toolBoxFull: t('道具欄已滿\n\n無法購買！', 0x463e72),
  pickFrameTarget: t('請選擇嫁禍對象...', 0x46535d),
  /** %s 玩家名 */
  pickBuildSite: t('%s\n\n請選擇欲加蓋地點', 0x463a4a),
  pickFacilityKind: t('請選擇設施類別', 0x465289),
  pickToolToMake: t('請選擇欲開發道具', 0x465298),
  sellSharesCount: t('請輸入欲賣出的張數', 0x463ea0),
} as const;

/** 收租与免收 —— 每一条都对应一种「这次不用付」的理由 */
export const RENT = {
  /** %s 地名、%s 地主、%d 租金、%s 项目名 */
  payOneOwner: t('%s\n\n此地屬%s\n\n請付%d元%s', 0x4639b3),
  /** %s 地名、%s 与 %s 两个地主、%d 租金、%s 项目名 */
  payTwoOwners: t('%s\n\n屬%s與%s\n\n請付%d元%s', 0x46399a),
  /** %s 企业名、%s 董事长、%d、%s */
  payChairman: t('%s\n\n董事長%s\n\n請付%d元%s', 0x463a31),
  /** %s 帮派名、%s 帮主、%d、%s */
  payBoss: t('%s\n\n幫主%s\n\n請付%d元%s', 0x463a6a),
  /** 房屋查封中 */
  freeSealed: t('房屋查封中\n\n免收%s！', 0x463bb8),
  /** 同盟卡 */
  freeAllied: t('與%s同盟中\n\n免收%s！', 0x463bcd),
  /** 死神 */
  freeReaper: t('死神顯靈\n\n免收%s！', 0x463be2),
  /** 地主住宿中 */
  freeHotel: t('%s住宿中\n\n免收%s！', 0x463bf5),
  /** 地主消失中 */
  freeVanished: t('%s消失中\n\n免收%s！', 0x463c08),
  /** 地主坐牢中 */
  freePrison: t('%s坐牢中\n\n免收%s！', 0x463c1b),
  /** 地主住院中 */
  freeHospital: t('%s住院中\n\n免收%s！', 0x463c2e),
  /** 地主冬眠中 */
  freeWinterSleep: t('%s冬眠中\n\n免收%s！', 0x463c41),
  /** 地主梦游中 */
  freeSleepwalk: t('%s夢遊中\n\n免收%s！', 0x463c54),
  /** 小财神减半 */
  halfLuckyGod: t('小財神顯靈\n\n%s減免一半！', 0x463c67),
  /** 死神显灵，由 %s 赔偿 %s */
  reaperPays: t('死神顯靈\n\n由%s賠償%s', 0x4639cc),
} as const;

/**
 * 回合开始时「被阻碍」的訊息框 —— 住宿／消失／坐牢／住院／冬眠 五句。
 *
 * ★ 原版在回合开始判定函数 `fcn_0040c912`（VA 0x0040c912）里**对当前玩家无条件弹**
 *   （`rich4.asm:6561`）—— 不分真人与电脑。那里的 `test byte [player+0x15], 0x30`
 *   闸门（`0x0040c969`）是「走回棋盘 0x10 / 被外力挪过 0x20」，**不是电脑位**
 *   （电脑 `who_plays = 2`，`2 & 0x30 == 0`），命中的那一支不弹框。
 *
 * @source 五条模板在 DGROUP 里的地址（`rich4.asm:27908-27952` 那一段
 *   `ref_004631e0` / `ref_004631f5` / `ref_0046320a` / `ref_0046321f` / `ref_00463234`），
 *   天数口径照抄：
 * ```text
 * 0x4631e0  %s住宿中   天数 = (v & 0x7f) + 1
 * 0x4631f5  %s消失中   天数 = (v & 0x3f) + 1
 * 0x46320a  %s坐牢中   天数 = (v & 0x7f) + 1
 * 0x46321f  %s住院中   天数 = (v & 0x7f) + 1
 * 0x463234  %s冬眠中   天数 = (v & 0x7f) + 1
 * ```
 *   框时长与其余通用訊息框一致 = `push 0x5dc`（1500 ms）。
 */
export const CONFINEMENT = {
  /** %s 玩家名、%d 剩余天数 @source 0x4631e0 */
  hotel: t('%s住宿中\n\n還剩%d天！', 0x4631e0),
  /** %s 玩家名、%d 剩余天数 @source 0x4631f5 —— ★ 天数用 `& 0x3f` */
  disappearing: t('%s消失中\n\n還剩%d天！', 0x4631f5),
  /** %s 玩家名、%d 剩余天数 @source 0x46320a */
  prison: t('%s坐牢中\n\n還剩%d天！', 0x46320a),
  /** %s 玩家名、%d 剩余天数 @source 0x46321f */
  hospital: t('%s住院中\n\n還剩%d天！', 0x46321f),
  /** %s 玩家名、%d 剩余天数 @source 0x463234 */
  sleeping: t('%s冬眠中\n\n還剩%d天！', 0x463234),
} as const;

/**
 * 設施过路费的棕色訊息框 —— `0x0041a3cc`（設施收费那一路）里那三段 `sprintf`。
 *
 * @source 推串点（`0x457110` = Watcom `sprintf`）：
 * ```asm
 * 0041a46e  push 0x4639ff   ; 旅館：%d#1 = 轉盤倍數（= 住几天）、%d#2 = 倍數 × 單價
 * 0041a4c4  push 0x463a14   ; 購物中心：%d#1 = 單價、%d#2 = 轉盤倍數、%d#3 = 總額
 * 0041a55d  push 0x463a31   ; 加油站：借用 RENT.payChairman，名字是常量「加油站」
 * ```
 * 三条都汇到 `0x41a56f push 0x5dc / call 0x440cac`（1500 ms 通用訊息框）。
 */
export const FACILITY_TOLL = {
  /** type 1 旅館：%d 住几天、%d 費用 @source 0x0041a46e `push 0x4639ff` */
  hotel: t('休息%d天\n\n費用%d元！', 0x4639ff),
  /** type 2 購物中心：%d 單價、%d 倍數、%d 總額 @source 0x0041a4c4 `push 0x463a14` */
  mall: t('您的消費金額為\n\n%dx%d倍=%d元', 0x463a14),
} as const;

/**
 * 棕色訊息框那一族里剩下的几句 —— 得点格 / 抽卡格 / 禮物 / 寶箱 / 乞丐 / 小偷。
 *
 * @source 逐句的推串点与框时长：
 * ```asm
 * 0041b1c3  push 0x463a81   ; 得５０點（`0x41b1be push 0x3e8` = 1000 ms）
 * 0041b25d  push 0x463a8e   ; 得３０點（1000 ms）
 * 0041b2e1  push 0x463a9b   ; 得１０點（1000 ms）
 * 0041b35d  push 0x463aa8   ; 抽卡格「得到%s！」（0x5dc = 1500 ms）
 * 0041b956  push 0x463aa8   ; 禮物「得到%s！」（1500 ms）
 * 0041bb4e  push 0x463ad3   ; 寶箱「得到５００點券！」（1500 ms）
 * 0041b656  push 0x463ab1   ; 乞丐「施捨給乞丐%d元」（1500 ms）
 * 0041ba0a  push 0x463ac0   ; 小偷五种战利品「小偷偷得%s\n\n給%s！」（1500 ms）
 * ```
 */
export const MESSAGE_BOX = {
  /** 特５０點格 —— 无占位符 @source 0x0041b1c3 `push 0x463a81` */
  points50: t('得點券５０點', 0x463a81),
  /** 特３０點格 @source 0x0041b25d `push 0x463a8e` */
  points30: t('得點券３０點', 0x463a8e),
  /** 特１０點格 @source 0x0041b2e1 `push 0x463a9b` */
  points10: t('得點券１０點', 0x463a9b),
  /** 小遊戲「不玩」白拿的點券 @source 0x00415472 `push 0x463797`（框停 0x7d0 = 2000 ms）*/
  pointsMinigame: t('得點券%d點', 0x463797),
  /** %s 卡片名 / 道具名 —— 抽卡格与禮物**共用同一个串地址** @source 0x0041b35d / 0x0041b956 */
  got: t('得到%s！', 0x463aa8),
  /** 寶箱：无占位符，500 是写死在串里的 @source 0x0041bb4e `push 0x463ad3` */
  got500Points: t('得到５００點券！', 0x463ad3),
  /** %d 施捨金额 @source 0x0041b656 `push 0x463ab1` */
  alms: t('施捨給乞丐%d元', 0x463ab1),
  /** %s 战利品名、%s 主人名 @source 0x0041ba0a 等五处 `push 0x463ac0` */
  thiefLoot: t('小偷偷得%s\n\n給%s！', 0x463ac0),
} as const;

/** 通用按钮 */
export const BUTTON = {
  ok: t('確定', 0x463d2e),
  cancel: t('取消', 0x463d33),
  buy: t('購 買', 0x463efd),
  withdrawBid: t('撤 件', 0x463ef7),
  pass: t('ＰＡＳＳ', 0x465055),
  giveUp: t('放棄', 0x46505e),
  exit: t('EXIT', 0x463f5f),
  sell: t('賣出', 0x463ffd),
} as const;

/** 面板与清单的字段名 —— 注意原版在两字词中间**留两个半角空格** */
export const FIELD = {
  cash: t('現  金', 0x463db3),
  deposit: t('存  款', 0x463dba),
  loan: t('貸  款', 0x463dc1),
  totalAssets: t('總資產', 0x463dc8),
  stock: t('股  票', 0x463dcf),
  points: t('點  卷', 0x463dd6),
  insurance: t('保險期', 0x463ddd),
  company: t('企  業', 0x463de4),
  land: t('土  地', 0x463deb),
  facility: t('設  施', 0x463df2),
  house: t('房  屋', 0x463d65),
  chainStore: t('連鎖店', 0x463d6c),
  location: t('地  點', 0x463d73),
  development: t('開發狀況', 0x463d7a),
  price: t('價  格', 0x463d83),
  toll: t('收  費', 0x463d8a),
  lease: t('租  期', 0x463d91),
  emptyLot: t('空  地', 0x463e49),
  residential: t('住宅區', 0x463d57),
  commercial: t('商業區', 0x463d5e),
} as const;

/** 銀行柜台 */
export const BANK = {
  /** ATM 入口 `fcn_004379c9`：拒絕往來期内 @source `0x004379ef push 0x464bed`（框停 `0x3e8` = 1000 ms）*/
  rejected: t('銀行拒絕往來\n\n還剩%d天！', 0x464bed),
  /** ATM 窗 `0x408` 那一支：銀行暫停放款期内开 ATM @source `0x00437123 push 0x464bd4`（框停 `0x5dc` = 1500 ms）*/
  frozen: t('銀行暫停放款\n\n還剩%d天！', 0x464bd4),
  applyLoan: t('申請貸款', 0x464a81),
  repayLoan: t('償還貸款', 0x464a8a),
  specialFinance: t('特別融資', 0x464a93),
  cashTurnover: t('週轉現金', 0x464a9c),
  returnFunds: t('歸還款項', 0x464aa5),
  customerDeposits: t('客戶存款總額', 0x464aae),
  currentCredit: t('目前融資金額', 0x464abb),
  creditLeft: t('尚可融資金額', 0x464ac8),
  /** %d 天 */
  daysToDue: t('距還款日%d天', 0x464a74),
  /** %s 玩家名 */
  greeting: t('%s您好', 0x464aee),
} as const;

/** 探監/探病 */
export const BAIL = {
  bailPoints: t('保釋點數', 0x465140),
  /** %s 囚犯名 */
  bailWho: t('保釋%s', 0x465169),
  /** %d 点 */
  pointsN: t('%d點', 0x465149),
} as const;

/**
 * 樂透 —— 投注屏（`Panel.mkf` #12）与開獎屏（#15）的台词。
 *
 * ★ 这些串在 exe 里都以 `'#' + 4 位数字` 开头。那不是字符串 id，
 *   而是**插播语音的编号**：`rich4_draw_text` 见到首字符 `'#'` 就把这 5 个字符
 *   解析成一个编号交给 `fcn_0045441a`（VA 0x0045441a —— 从 `Speaking.mkf`
 *   取该段语音播放，且只在音效开关 `cfg+3` 打开时才播），随后 `add ebx, 5`
 *   跳过它、再画剩下的字。
 *   所以**屏上显示的文字不含这 5 个字符**，下面每个 VA 都是跳过之后的地址
 *   （= 原版指针表里的地址 + 5）。每条的语音号写在行尾。
 *
 * @source 指针表 `0x004755f8`（投注屏，6 项）与 `0x00475610` 起（開獎屏，逐条一个）
 */
export const LOTTERY = {
  /*
   * ★★ 2026-09-22（第十一份試玩回報 #14「进入乐透购买模块没有…猫女台词语音」）：
   *   这 14 条串在移植时**把 `#NNNN` 语音码弄丢了**（只留在注释里），
   *   而客户端的语音只认**字面前缀**（`voice-sink.ts` 的 `parseVoiceCode` 要求 `#` + 4 位）⇒ 整屏静音。
   *
   *   修法：`va` 从前缀**后一格**改指**前缀起点**（原值 − 5），`text` 补回 `#NNNN`。
   *   这样 `messages.test.ts` 的逐字节对 exe 守卫仍然成立 —— 我逐条核过 `va-5` 处的 5 个字节，
   *   14 条全部是 `#NNNN` 且与注释的语音号一致（例：`0x464394` = `#0011`、`0x464440` = `#0017`）。
   */
  // ── 投注屏（0x0042f7fc 的各状态）──
  /** 开屏第一句 —— 语音 11 */
  counterHello: t('#0011哈囉！\n一券在手，\n希望無窮！', 0x464394),
  /** 状态 1→2 —— 语音 12 */
  counterPrice: t('#0012只要一千元，\n就有獲得大獎\n的機會！', 0x4643b6),
  /** 状态 2→3：可以点号了 —— 语音 13 */
  counterPick: t('#0013請圈選您的\n幸運號碼～', 0x4643de),
  /** 买中之后（0x0042f974 的 0x406 处理）—— 语音 14 */
  counterBye: t('#0014拜拜！祝您中獎！', 0x4643f9),
  /** 现金 < 1000，屏一闪即关 —— 语音 15 */
  counterNoCash: t('#0015太可惜了！\n您的現金不足～', 0x46440f),
  /** 紧接上一条 —— 语音 16 */
  counterComeAgain: t('#0016下次再來吧！', 0x46442e),

  // ── 開獎屏（0x0043010c 的各状态）──
  /** 状态 1 —— 语音 17 */
  drawIntro: t('#0017嗨！\n又到了每月\n十五號樂透\n開獎時間～', 0x464440),
  /** 状态 1→2 —— 语音 18 */
  drawRolling: t('#0018現在馬上為您\n開出這一期的\n號碼．．。', 0x46446b),
  /** 状态 4：开出的号有人买 —— 语音 19 */
  drawWinnerIs: t('#0019本月份的得主\n是．．．。', 0x464495),
  /** 状态 5→6 —— 语音 32 */
  drawWinAll: t('#0032恭喜您獨得\n所有獎金！', 0x4644b2),
  /** 状态 7：开出的号没人买 —— 语音 33 */
  drawNoWinner: t('#0033SORRY！\n本月份沒有人\n得獎～', 0x4644cd),
  /** 状态 7→8 —— 语音 34 */
  drawCarryOver: t('#0034獎金將累積\n到下個月．\n．．．。', 0x4644ee),
  /** 状态 8→9 —— 语音 35 */
  drawHopeNext: t('#0035希望下次\n得獎者就\n是您！', 0x464512),
  /** 状态 9→10 —— 语音 36 */
  drawHurryUp: t('#0036行動要快喔！', 0x464530),
  /** 開獎屏上的标签，后面紧跟公库金额 —— 这一条**没有**语音前缀 */
  poolLabel: t('累積獎金', 0x4645d9),
} as const;

/** 格子/神明/人物的名字表 —— 一段连续排列的串 */
export const PLACE = {
  park: t('公園', 0x465e5f),
  penguinDig: t('企鵝挖寶', 0x465e64),
  departmentStore: t('百貨公司', 0x465e6d),
  fate: t('命運', 0x465e76),
  news: t('新聞', 0x465e9d),
  prison: t('監獄', 0x465ea2),
  bank: t('銀行', 0x465ea7),
  lottery: t('樂透', 0x465eac),
  hospital: t('醫院', 0x465eb1),
  magicHouse: t('魔法屋', 0x465eb6),
  beggar: t('乞丐', 0x465ebd),
  landGod: t('土地公', 0x465ec2),
} as const;

/**
 * 工具栏/操作项的名字。
 *
 * @source 指针表 `0x00476028`，20 项，指向 `0x00465dc0..0x00465e3b` 的一段连续串。
 *
 * ⚠️ **哪个图标对应第几项没查证** —— 用到这张表的那段代码没定位到，
 *   `TOOLBAR_LABELS`（client/assets.ts）里那 11 个名字仍是照图标外观猜的。
 *   这里先把原文收下来，等映射解出来再替换过去。
 */
export const TOOLBAR_TIPS = {
  gameOps: t('遊戲操作', 0x465dc0),
  calendar: t('日、月曆', 0x465dc9),
  landData: t('地產資料', 0x465dd2),
  otherData: t('其他資料', 0x465ddb),
  priceIndex: t('物價指數', 0x465de4),
  stockData: t('股票資料', 0x465ded),
  fundData: t('資金資料', 0x465df6),
  load: t('LOAD', 0x465dff),
  save: t('SAVE', 0x465e04),
  cards: t('卡片', 0x465e09),
  trade: t('交易', 0x465e0e),
  map: t('地圖', 0x465e13),
  system: t('系統', 0x465e18),
  stockMarket: t('股市', 0x465e1d),
  advance: t('前進', 0x465e22),
  query: t('查詢', 0x465e27),
  autoPlay: t('託管', 0x465e2c),
  tools: t('道具', 0x465e31),
  help: t('說明', 0x465e36),
  companies: t('公司企業', 0x465e3b),
} as const;

/**
 * 神明附身那一刻那扇**老虎机窗**的台詞 —— 四種模板，`%s` = 神明名。
 *
 * @source 跳表 `0x4406ee` 的四個分支（`fcn_00440706`）：
 *   `0x4652a9` / `0x4652c1` / `0x4652d1` / `0x4652e7`；
 *   名字取自 `_rich4_god_names`（0x47ed7a，16 项，见 `GOD_NAMES`）。
 *
 * ⚠️ 每条结尾那三个点**不是省略号**，是三个半角句点 —— 金額会被
 *   `sprintf("%d元")` **再画一遍在同一个落点**（0x465284）盖上去。
 */
export const GOD_ATTACH = {
  /** 0 小財神（`arg = 0`）*/
  collect: t('%s附身\n\n向所有對手收...', 0x4652a9),
  /** 1 大財神（`arg = 1`）*/
  give: t('%s附身\n\n送您...', 0x4652c1),
  /** 4 小窮神（`arg = 4`）*/
  payAll: t('%s附身\n\n付給每個人...', 0x4652d1),
  /** 5 大窮神（`arg = 5`）*/
  loss: t('%s附身\n\n損失...', 0x4652e7),
  /** 金額那一行 `sprintf(0x465284, 金額)` @source 0x0043f68c 那一支 */
  amount: t('%d元', 0x465284),
} as const;

/**
 * 神明**落脚顯靈**的三句（天使・福神 / 惡魔 / 土地公）。
 *
 * @source `fcn_0040f381`（落点尾块 `0x0041b086` 调）与 `fcn_0040f8be`（自己地升級后 `0x00419a48` 调）：
 *   `0x0040f463` / `0x0040f4bd` / `0x0040f959` / `0x0040f9ad push 0x4634c0`（`%s` = 神明名，
 *   天使那支取 `[0x47ed9a]`、福神那支取 `[0x47ed76 + god_info*4]`）、
 *   `0x0040f60b push 0x4634d7`、`0x0040f873 push 0x4634f2`；都走 `0x440cac(…, 0x5dc)`。
 */
/**
 * 商店：董事長蒞臨的贈禮 @source `0x464378`（`_rich4_ui_shop_entry` 0x0042e9f8 的 `push 0x464378`）。
 * `%s` = 送的那件东西的名字（道具名或卡名）。
 */
export const SHOP = {
  chairmanGift: t('歡迎董事長光臨\n\n送您%s！', 0x464378),
} as const;

export const GOD_MANIFEST = {
  /** 天使 / 小福神 / 大福神 */
  build: t('%s顯靈\n\n加蓋一層房屋！', 0x4634c0),
  /** 惡魔（原文就是「小惡魔」）*/
  demolish: t('小惡魔顯靈\n\n拆毀一層房屋！', 0x4634d7),
  /** 土地公 */
  seize: t('土地公顯靈\n\n強佔土地！', 0x4634f2),
  /**
   * 衰神/死神拦下消费（`fcn_0040fa61`）。
   *
   * ★★ 2026-09-22 订正：先前这里写「『拘資』是原版错字、1:1 照抄」—— **那句注释是错的**。
   *   逐字节复核 exe（`0x463514`，fileOff 400148，len 18）：
   *   `2573c5e3c6460a0aa7ebb8eaa5a2b1d1a149` = `%s顯靈\n\n投資失敗！`；
   *   整个 DGROUP（158720 字节）里「拘資」出现 **0** 次、「投資失敗」出现 **1** 次。
   *   ⇒ 当初从 asm/注释转写时写错了字，现在改回 exe 上的原文。
   */
  blockPurchase: t('%s顯靈\n\n投資失敗！', 0x463514),
  /** 福神附身得卡（`0x0040ee13`）：`%s` = 神明名、卡名 */
  gotCard: t('%s附身\n\n得到%s！', 0x4632fd),
  /**
   * 大福神附身得**两张**卡（`fcn_0040ee50`，`0x0040eed7 push 0x463353`，`0x0040eee9 push 0x5dc`）。
   *
   * ⚠️ `%s` × 2 = **两张卡名**（先抽到的那张在前）—— 这一条里**没有**神明名，
   *   格式串自己写着「大福神」，与 `gotCard` 的 `[神明名, 卡名]` 形状不同。
   */
  gotCardTwo: t('大福神附身\n\n得到%s及%s！', 0x463353),
} as const;

/**
 * 魔法屋效果派发 `0x431caa` 与电脑那一支（`0x0043380a`）的訊息框 / 台词串（2026-09-23）。
 *
 * @source
 * - `nameHead`：`0x00431cee push 0x46482a`（十二支都是它）→ `sprintf(buf, "%s\n\n", [player+0] 名字)`，
 *   随后 `strcat(buf, [0x475724 + 16*效果] 效果名)` → `0x440cac(buf, 0x5dc)`；
 * - `gotCard`：「得一張卡片」那一支 `0x00432122 push 0x464839`（发卡 `0x004320ee call 0x441e12` 之后） → `sprintf("得到%s！", 卡名)` 再 strcat；
 * - `spin`：电脑那一支 `0x004339a1 push 0x464842` → `sprintf("%s\n\n%s", 条件名, 效果名)` → `0x440cac(…, 0x5dc)`；
 * - `ponder`：加蓋 / 拆除 / 拍賣三支收尾 `0x00432094 push 0x46482f / push 0 / push 中签者 / 0x004320a2 call player_say`。
 */
export const MAGIC_HOUSE_TEXT = {
  nameHead: t('%s\n\n', 0x46482a),
  gotCard: t('得到%s！', 0x464839),
  spin: t('%s\n\n%s', 0x464842),
  ponder: t('？？？...', 0x46482f),
} as const;

/**
 * 神明的名字 —— 16 項，**下标 = 物件種類 − 1**。
 *
 * @source `_rich4_god_names` @ VA 0x47ed7a（指针表），每條串間隔 7 字節
 *   （三個 Big5 字 + NUL）；第一項 `0x466640` = 小財神。
 *   `objects_info[i].type = i + 1`，故 `種類` 1..16 → 下标 0..15。
 */
export const GOD_NAMES: readonly OriginalText[] = [
  t('小財神', 0x466640),
  t('大財神', 0x466647),
  t('小福神', 0x46664e),
  t('大福神', 0x466655),
  t('小窮神', 0x46665c),
  t('大窮神', 0x466663),
  t('小衰神', 0x46666a),
  t('大衰神', 0x466671),
  t('天使', 0x466678),
  t('惡魔', 0x46667d),
  t('惡犬', 0x466682),
  t('土地公', 0x466687),
  t('禮物', 0x46668e),
  t('寶箱', 0x466693),
  t('死神', 0x466698),
  t('路障', 0x46669d),
];

/** 種類（1 基，与 `objects_info[i].type` 同一套编码）→ 神明名；越界给空串 */
export function godNameOf(type: number): string {
  return GOD_NAMES[type - 1]?.text ?? '';
}

/**
 * 物件名表 —— `0x0047edaa` 起 6 个指针，**第 0 项就是種類 13**。
 *
 * @source 指针表 @ VA 0x0047edaa（每项 4 字节），逐项读出的串地址：
 *   `0x46668e 禮物 / 0x466693 寶箱 / 0x466698 死神 / 0x46669d 路障 /
 *    0x4666a2 地雷 / 0x4666a7 定時炸彈`。
 *   前三项与 `GOD_NAMES` 的尾段**是同一个地址**（原版共用串），后两项只有这张表有。
 *   消费者：小偷五种战利品那一句 `小偷偷得%s\n\n給%s！`
 *   （`0x0041ba03 mov edi,[0x47edaa]` / `0x0041bc1a [0x47edae]` /
 *    `0x0041bdd9 [0x47edb6]` / `0x0041bf8a [0x47edba]` / `0x0041c0e6 [0x47edbe]`）。
 */
export const OBJECT_NAMES: readonly OriginalText[] = [
  t('禮物', 0x46668e),
  t('寶箱', 0x466693),
  t('死神', 0x466698),
  t('路障', 0x46669d),
  t('地雷', 0x4666a2),
  t('定時炸彈', 0x4666a7),
];

/** 物件種類（13..18）→ 名字；越界给空串（下表下标 = 種類 − 13） */
export function objectNameOf(type: number): string {
  return OBJECT_NAMES[type - 13]?.text ?? '';
}

/** 把 `%s` / `%d` 依次替换掉 —— 原版用的是 C 的 sprintf，这里只做它用到的那两种 */
export function formatOriginal(fmt: string, ...args: (string | number)[]): string {
  let i = 0;
  return fmt.replace(/%[sd]/g, () => String(args[i++] ?? ''));
}

/** 所有文案的平铺清单，给测试逐条核对用 */
export const ALL_TEXTS: readonly OriginalText[] = [
  ...Object.values(PROMPT),
  ...Object.values(NOTICE),
  ...Object.values(RENT),
  ...Object.values(CONFINEMENT),
  ...Object.values(FACILITY_TOLL),
  ...Object.values(MESSAGE_BOX),
  ...Object.values(BUTTON),
  ...Object.values(FIELD),
  ...Object.values(BANK),
  ...Object.values(BAIL),
  ...Object.values(LOTTERY),
  ...Object.values(PLACE),
  ...Object.values(TOOLBAR_TIPS),
  ...Object.values(GOD_ATTACH),
  // ★★ 2026-09-22：`GOD_MANIFEST` 整块进来了（先前只放 `gotCardTwo`）。
  //   挡了它一阵子的那条 —— `blockPurchase` 的「拘資」——已经订正成 exe 上的「投資失敗」
  //   （那是当初转写写错的字，不是原版错字；见该条自己的注释），
  //   所以现在可以整块交给下面那条逐字比对守着，四条都有了护栏。
  ...Object.values(GOD_MANIFEST),
  ...Object.values(MAGIC_HOUSE_TEXT),
  ...GOD_NAMES,
  ...OBJECT_NAMES,
];
