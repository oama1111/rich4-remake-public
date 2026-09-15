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
  // ── 投注屏（0x0042f7fc 的各状态）──
  /** 开屏第一句 —— 语音 11 */
  counterHello: t('哈囉！\n一券在手，\n希望無窮！', 0x464399),
  /** 状态 1→2 —— 语音 12 */
  counterPrice: t('只要一千元，\n就有獲得大獎\n的機會！', 0x4643bb),
  /** 状态 2→3：可以点号了 —— 语音 13 */
  counterPick: t('請圈選您的\n幸運號碼～', 0x4643e3),
  /** 买中之后（0x0042f974 的 0x406 处理）—— 语音 14 */
  counterBye: t('拜拜！祝您中獎！', 0x4643fe),
  /** 现金 < 1000，屏一闪即关 —— 语音 15 */
  counterNoCash: t('太可惜了！\n您的現金不足～', 0x464414),
  /** 紧接上一条 —— 语音 16 */
  counterComeAgain: t('下次再來吧！', 0x464433),

  // ── 開獎屏（0x0043010c 的各状态）──
  /** 状态 1 —— 语音 17 */
  drawIntro: t('嗨！\n又到了每月\n十五號樂透\n開獎時間～', 0x464445),
  /** 状态 1→2 —— 语音 18 */
  drawRolling: t('現在馬上為您\n開出這一期的\n號碼．．。', 0x464470),
  /** 状态 4：开出的号有人买 —— 语音 19 */
  drawWinnerIs: t('本月份的得主\n是．．．。', 0x46449a),
  /** 状态 5→6 —— 语音 32 */
  drawWinAll: t('恭喜您獨得\n所有獎金！', 0x4644b7),
  /** 状态 7：开出的号没人买 —— 语音 33 */
  drawNoWinner: t('SORRY！\n本月份沒有人\n得獎～', 0x4644d2),
  /** 状态 7→8 —— 语音 34 */
  drawCarryOver: t('獎金將累積\n到下個月．\n．．．。', 0x4644f3),
  /** 状态 8→9 —— 语音 35 */
  drawHopeNext: t('希望下次\n得獎者就\n是您！', 0x464517),
  /** 状态 9→10 —— 语音 36 */
  drawHurryUp: t('行動要快喔！', 0x464535),
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
  ...Object.values(BUTTON),
  ...Object.values(FIELD),
  ...Object.values(BANK),
  ...Object.values(BAIL),
  ...Object.values(LOTTERY),
  ...Object.values(PLACE),
  ...Object.values(TOOLBAR_TIPS),
];
