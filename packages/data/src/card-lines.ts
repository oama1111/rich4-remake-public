/*
 * 卡牌使用者台词表 —— 12 角色 × 30 张卡 = 360 条
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★★ 为什么要有这个模块：`speech.ts` 里的 `SPEECH_LINES` 是**另一张表**
 *    （`_rich4_event_strings`，VA `0x48084a`，行距 108 字节 = 27 槽），
 *    装的是「受击 / 情境」台词。**用卡时角色说的那一句不在那张表里**，
 *    而在本表：VA `0x48123a`，行距 **360 字节**（90 槽），本模块只取**槽 0..29**。
 *
 *    此前复刻侧只有前者 ⇒ 用卡时**一个字都不说、语音也不响**（见
 *    `rich4-remake/docs/gaps/README.md` §7.89(2) 的取证）。
 *
 * ── 寻址（都在 exe 里可核） ─────────────────────────────────────────────
 *
 * ```asm
 * ; @source 0x4420f2（均富卡，14 处同形）
 * 004420f7  mov  dl, byte ptr [eax + 0x496b7b]   ; 角色号 = player + 0x13
 * 004420ff  shl  eax, 2 / sub eax, edx / shl eax, 3
 * 00442107  mov  edx, eax / shl eax, 4 / sub eax, edx   ; = 360 × 角色号
 * 0044210e  mov  ebx, dword ptr [eax + 0x48123a]        ; ★ 槽 0 = 卡 1
 * 00442118  call 0x44ef41                                ; player_say(player, 3, 台词)
 * ```
 *
 * 第 `card` 张卡（1..30）读**槽 `card-1`**：卡 2 读 `0x48123e`、卡 22 读 `0x48128e`、
 * 卡 30 读 `0x4812ae`（`rich4-spec/docs/systems/data-tables.md` §3.3 与表 54 已登记）。
 *
 * ── 语音号 ────────────────────────────────────────────────────────────
 *
 * 每条串以 `'#' + 4 位十进制` 开头，那个数就是 `Speaking.mkf` 的资源号
 * （`_rich4_player_say` 自己解析，见 `voice-code.ts`），且恒等于：
 *
 *     voice = 426 + 52 × 角色号 + (卡号 − 1)        （360 条无例外）
 *
 * 即每角色占 **52 个连续语音号**，前 30 个就是 30 张卡的台词
 * （`rich4-spec` 的通道 2 测试 `tests/test_god_charm_cards.py` 的 `[L]` 段全扫过）。
 *
 * ── 金貝貝（角色 11） ─────────────────────────────────────────────────
 *
 * 与 `SPEECH_LINES` 同一套约定：那一列整列是 `#NNNN@DD`，`@DD` 是
 * `Data.mkf #0x207` 的表情图号（本表落成 `emoji` 字段）。**照样有语音**
 * （`#NNNN` 部分不是空的），故 `voice` 与 `emoji` 并存、不是二选一。
 *
 * ── 诚实边界 ──────────────────────────────────────────────────────────
 *
 * 角色 6 的卡 15/16 两条（`#0752晚安∼` / `#0753做個好夢吧∼`）在原版里以
 * **造字区双字节 `\x9d\xdd`** 结尾（Big5 用户造字区）。
 * WHATWG 表（浏览器 / Node 的 `TextDecoder('big5')`，也是本仓库既定的解码器）
 * 把它映射到 **PUA `U+ECBF`**；**Python 自带的 `big5` codec 拒收这一段**
 * （会给出 U+FFFD）⇒ 生成脚本**改用 node 解码**，本表照此保留 `U+ECBF`（不猜字形），
 * `card-lines.test.ts` 把这两条钉住。
 *
 * 生成：`python3 tools/gen-card-lines.py --ts`（真值校验见 `card-lines.test.ts`，
 * 逐条与 `rich4.exe` 的指针表比对，360 条全量）。
 */

import type { SpeechLine } from './speech.ts';

/** 每角色的卡牌台词槽数（= 卡号数） @source `0x48123a` 槽 0..29 */
export const CARD_LINES_PER_CHARACTER = 30;

/** 指针表基址 @source VA 0x0048123a */
export const CARD_LINE_TABLE_VA = 0x48123a;

/** 行距：90 槽 × 4 字节 @source 0x442107 的 `shl 4 / sub` 合成 360 */
export const CARD_LINE_STRIDE_BYTES = 360;

/** 语音号基数（角色 0 卡 1）@source 串头 `#0426` */
export const CARD_LINE_VOICE_BASE = 426;

/** 每角色的语音号跨度（30 条卡牌台词 + 22 条其它情境）@source 角色 1 卡 1 = `#0478` */
export const CARD_LINE_VOICE_STRIDE = 52;

/**
 * 卡牌台词的语音号：`426 + 52 × 角色 + (卡号 − 1)`。
 *
 * ★ 这个式子**不是**推断 —— 360 条串的 `#NNNN` 前缀逐条比对无例外
 *   （`rich4-spec/tests/test_god_charm_cards.py` 的 `[L]` 段；
 *    `card-lines.test.ts` 里也从 `rich4.exe` 侧再核一遍）。
 */
export function cardLineVoice(character: number, card: number): number {
  return CARD_LINE_VOICE_BASE + CARD_LINE_VOICE_STRIDE * character + (card - 1);
}

/** 一个角色的一张卡台词；越界抛（与 `speechLine()` 同一套约定） */
export function cardLine(character: number, card: number): SpeechLine {
  if (!Number.isInteger(character) || character < 0 || character >= CARD_LINES.length) {
    throw new RangeError(`卡牌台词：角色号越界 ${character}（合法 0..${CARD_LINES.length - 1}）`);
  }
  if (!Number.isInteger(card) || card < 1 || card > CARD_LINES_PER_CHARACTER) {
    throw new RangeError(`卡牌台词：卡号越界 ${card}（合法 1..${CARD_LINES_PER_CHARACTER}）`);
  }
  const row = CARD_LINES[character]!;
  return row[card - 1]!;
}

/**
 * 角色下标 0..11 → 30 条卡牌台词（下标 = 卡号 − 1）。
 *
 * `[表情图号, 文本]`：表情图号非 `null` 时（金貝貝整列）文本字段是 `@DD` 形状，
 * 语义与 `SPEECH_LINES` 完全一致。
 */
export const CARD_LINES: readonly (readonly SpeechLine[])[] = [
  // ── 角色 0 ──
  [
    [null, '有錢大家花！'],
    [null, '朋友有\n通財之義！'],
    [null, '讓我把它\n據為己有！！'],
    [null, '黃金地段\n讓給你！！'],
    [null, '給你面子\n才跟你換的喔！'],
    [null, '向後轉！\n齊步走！！'],
    [null, '不必謝我！！'],
    [null, '漫天喊價\n就地還錢！'],
    [null, '喔！\n哈利路亞！'],
    [null, '嗚！\n邪惡的使者～'],
    [null, '全部夷為\n平地！！'],
    [null, '真礙眼！！！'],
    [null, '把值錢的東西\n交出來！！'],
    [null, '不許動！！'],
    [null, '早睡早起\n身體好！'],
    [null, '睡吧睡吧～'],
    [null, '去吃牢飯吧！！'],
    [null, '拖你一起\n下水！！'],
    [null, '怕你不成！！！'],
    [null, '有錢也不給你！'],
    [null, '想抓我\n還早得很呢！'],
    [null, '快滾！\n我不需要你！'],
    [null, '快來幫我吧！'],
    [null, '跟著我買股票\n準沒錯！'],
    [null, '這支股票\n太貴了！！'],
    [null, '別想逃漏稅！'],
    [null, '小本經營\n恕不賒欠！！'],
    [null, '年度回饋，\n全面免費！'],
    [null, '好哥兒們！！'],
    [null, '瞧你那溫吞\n的模樣！'],
  ],
  // ── 角色 1 ──
  [
    [null, '四海之內\n皆兄弟！'],
    [null, '拿些錢來\n週轉週轉吧！'],
    [null, '喜歡就給它\n買起來！'],
    [null, '今天是搬家的\n好日子！'],
    [null, '你的房子比較\n堅固喔！'],
    [null, '此路不通！'],
    [null, '幫你一個忙～'],
    [null, '生活困難，\n賣屋求現～'],
    [null, '阿拉真主！\n請派使者降臨！'],
    [null, '讓你們嚐嚐\n惡魔的厲害！'],
    [null, '全都給我拆了！'],
    [null, '違章建築，\n隨報隨拆！'],
    [null, '好東西要與\n好朋友分享！'],
    [null, '留下來\n讓我款待！'],
    [null, '祝你們有一個\n好夢～'],
    [null, '睡～\n深深熟睡～'],
    [null, '法網恢恢\n疏而不漏！'],
    [null, '這下你\n高興了吧！！'],
    [null, '幸好有\n代罪羔羊～'],
    [null, '能省則省！'],
    [null, '想害我？\n門都沒有！！'],
    [null, '您去忙您的吧！'],
    [null, '天靈靈地靈靈！'],
    [null, '我是護盤高手！'],
    [null, '我是操盤高手！'],
    [null, '閒閒沒事\n繳繳稅吧！'],
    [null, '反應成本\n適度調漲～'],
    [null, '黑店誰要去啊？'],
    [null, '團結力量大！'],
    [null, '趕著去\n投胎啊？！'],
  ],
  // ── 角色 2 ──
  [
    [null, '大家不用\n感謝我！'],
    [null, '朋友之間\n別計較太多！'],
    [null, '這塊地不錯喔！'],
    [null, '換換風水吧！'],
    [null, '把房子過戶\n給我吧！'],
    [null, '道路施工，\n敬請改道！'],
    [null, '請包商來\n估個價吧！'],
    [null, '要喝西北風了！'],
    [null, '給你好看！！'],
    [null, '你們的\n報應來了！'],
    [null, '哥吉拉～～～'],
    [null, '就是看你\n不順眼！'],
    [null, '要錢要命\n要老婆？'],
    [null, '讓我盡盡\n地主之誼！'],
    [null, '安息吧！'],
    [null, '祝你美夢成真。'],
    [null, '天理昭彰\n報應不爽！'],
    [null, '跟我作伴吧！'],
    [null, '找個倒楣鬼～'],
    [null, '我才不爽付呢！'],
    [null, '別傻了！！'],
    [null, '你把我害得\n夠慘了！'],
    [null, '有請諸神降臨！'],
    [null, '等著收錢吧！！'],
    [null, '再不拋售\n就來不及了！'],
    [null, '萬稅萬稅\n萬萬稅！！'],
    [null, '入不敷出～'],
    [null, '替你貼上封條！'],
    [null, '天下沒有\n永遠的敵人！'],
    [null, '急什麼？！'],
  ],
  // ── 角色 3 ──
  [
    [null, '老虎不發威，\n把我當病貓？！'],
    [null, '借我\n週轉一下吧！'],
    [null, '買了它！'],
    [null, '不好意思，換個\n地皮你看如何？'],
    [null, '換個房子\n住住看也不錯。'],
    [null, '苦海無邊\n回頭是岸'],
    [null, '換換口味吧'],
    [null, '家境清寒，\n變賣家產～'],
    [null, '神愛世人～'],
    [null, '甜心～出來吧！'],
    [null, '小黃！\n快來幫我～'],
    [null, '你蓋我就拆～'],
    [null, '哎喲～\n你後面有什麼？'],
    [null, '站住別動！'],
    [null, '睡吧睡吧！'],
    [null, '小心\n別踩到狗屎啊！\n呵呵～'],
    [null, '嘿嘿，\n可別怪我喔。'],
    [null, '別以為\n老娘好欺負！'],
    [null, '幸好\n我早有防備～'],
    [null, '不用找了，\n哈哈哈！'],
    [null, '免死金牌在此！'],
    [null, '惡靈退散！！！'],
    [null, '嗯～來嘛！'],
    [null, '想投資\n跟著我就對啦！'],
    [null, '投「機」人，\n你們要小心嘍！'],
    [null, '看你一副\n逃漏稅的樣子。'],
    [null, '租金太便宜了，\n我都沒賺到錢。'],
    [null, '不覺得這條路的\n收費太貴了嗎？'],
    [null, '跟我合作\n準沒錯！'],
    [null, '慢慢走吧！\n哈哈哈！'],
  ],
  // ── 角色 4 ──
  [
    [null, '逗陣就是有緣～'],
    [null, '加減補助啦～'],
    [null, '老厝邊免計較～'],
    [null, '這裡\n風水不壞喔～'],
    [null, '破厝換別莊！'],
    [null, '少年人\n要知進退！'],
    [null, '我以早\n是土水師！'],
    [null, '大俗賣！\n大俗賣！'],
    [null, '起厝\n就要起歸排！'],
    [null, '請到\n一個魔神仔～'],
    [null, '拆掉\n重蓋卡緊啦！'],
    [null, '拆厝喔！'],
    [null, '我是賊仔賊公會\n的會長！'],
    [null, '稍等一下唷！'],
    [null, '卡早睡咧\n卡有眠～'],
    [null, '有魂無體\n親像稻草人～'],
    [null, '別人的失敗\n就是我的快樂！'],
    [null, '報一咧\n老鼠啊冤！'],
    [null, '歹勢！歹勢！'],
    [null, '好家在！'],
    [null, '人不是阮殺的～'],
    [null, '奉送啟程！'],
    [null, '拜請拜請！\n大仙王爺公，\n小仙王爺仔～'],
    [null, '阮的現金目前\n攏寄在股市～'],
    [null, '股票不通意！！'],
    [null, '你敢有納稅？'],
    [null, '起價卡好賺食！'],
    [null, '轉去呷自己啦！'],
    [null, '跟我逗陣\n有好嘸壞～'],
    [null, '呷緊弄破碗～'],
  ],
  // ── 角色 5 ──
  [
    [null, '這是\n你們的榮幸！'],
    [null, '嘻嘻～\n別生氣喔！'],
    [null, '這裡\n本公主徵收了！'],
    [null, '看得起你\n才跟你換！'],
    [null, '由不得你說不！'],
    [null, '我命令你\n向後轉！'],
    [null, '你品味真差！！'],
    [null, '惡作劇一下。'],
    [null, '萬能的天使！\n賜給我\n神奇的力量～'],
    [null, '好戲在後頭！！'],
    [null, '來福！咬它！'],
    [null, '景觀太差了吧？'],
    [null, '你的東西\n本公主要了！'],
    [null, '多休息一會吧！\n呵呵呵！'],
    [null, '睡吧！\nBABY！'],
    [null, '不要掉到\n水溝裡去喔！'],
    [null, '接受\n法律的制裁吧！'],
    [null, '你休想得逞！'],
    [null, '找個替死鬼～'],
    [null, '一毛都不給你！'],
    [null, '還好\n本公主命大。'],
    [null, '走開！\n別煩我！'],
    [null, '給本公主過來！'],
    [null, '大漲長紅！'],
    [null, '跌到谷底～'],
    [null, '繳錢給國庫吧！'],
    [null, '這裡\n收費太低了！'],
    [null, '禁止營業！'],
    [null, '不必受寵若驚！'],
    [null, '慢慢來\n才不會跌倒'],
  ],
  // ── 角色 6 ──
  [
    [null, '哈囉，分錢哦！'],
    [null, '抱歉抱歉，\n您沒事吧？'],
    [null, '買地！買地！'],
    [null, '換地！換地！'],
    [null, '換間屋子吧！'],
    [null, '轉向，轉向！'],
    [null, '給我改建吧！'],
    [null, '大拍賣！\n大拍賣！'],
    [null, '阿門！'],
    [null, '喔啦喔啦\n喔啦喔啦～'],
    [null, '哥基拉，上！'],
    [null, '把你拆得\n稀巴爛！'],
    [null, '謝啦，謝啦！'],
    [null, '給我停！'],
    [null, '晚安～'],
    [null, '做個好夢吧～'],
    [null, '莎唷那拉，\n再見！'],
    [null, '復仇給你看！?'],
    [null, '為我而死吧！'],
    [null, '哎呀，我真是\n太受歡迎了！'],
    [null, '呼呼呼，\n我是無敵的！'],
    [null, '拜拜，我的神～'],
    [null, '出來吧，\n我的神！'],
    [null, '全壘打！'],
    [null, '怪醫黑傑克！'],
    [null, '喂喂，繳稅繳稅'],
    [null, '漲！漲！'],
    [null, '跌！跌！'],
    [null, '喔喔，\n我親愛的摯友～'],
    [null, '脖子伸長點\n慢慢等吧！'],
  ],
  // ── 角色 7 ──
  [
    [null, '我想買糖吃～'],
    [null, '生氣會長\n皺紋喔！'],
    [null, '好想要耶～'],
    [null, '你的好像\n比較好～'],
    [null, '我的\n漂亮房子讓你住'],
    [null, '想要\n回去看看嗎？'],
    [null, '開個小玩笑！'],
    [null, '房價狂飆，\n不賣可惜！'],
    [null, '我來為\n大眾服務！'],
    [null, '我要消除禍害！'],
    [null, '令人期待\n的一刻！！'],
    [null, '遵照都市計畫\n建設好嗎？'],
    [null, '借用一下！'],
    [null, '就地休息\n一下吧！'],
    [null, '眾人皆睡\n我獨醒～'],
    [null, '還亂跑？\n你該上床了！'],
    [null, '呵呵！\n休息幾天吧！'],
    [null, '要怪先怪自己吧'],
    [null, '不是故意的，\n別怪我喔'],
    [null, '請人家一下嘛！'],
    [null, '好壞喔，\n想害人家～'],
    [null, '啊哈去吧～\n沒什麼了不起～'],
    [null, '我需要幫忙！！'],
    [null, '選哪一支\n股票好呢？'],
    [null, '趕快脫手\n以免套牢喔！'],
    [null, '納稅是國民\n應盡的義務！'],
    [null, '這樣\n才合乎成本嘛！'],
    [null, '做做善事吧！'],
    [null, '我們是\n同一國的！'],
    [null, '你走的很\n悠閒嘛！'],
  ],
  // ── 角色 8 ──
  [
    [null, '你們的錢\n就是我的錢！'],
    [null, '把錢捐給\n有需要的人吧！'],
    [null, '這塊地賣我吧！'],
    [null, '烏咪\n要跟你換地！'],
    [null, '烏咪\n想跟你換房子～'],
    [null, '耍得你團團轉！'],
    [null, '我變我變\n我變變變～'],
    [null, '烏咪要讓這塊地\n換主人～'],
    [null, '烏咪要\n請天使出來了！'],
    [null, '烏咪\n請惡魔懲罰你！'],
    [null, '哈！\n把它夷為平地！'],
    [null, '嘻！\n不拆手癢～'],
    [null, '東西給我！'],
    [null, '不准動！哈哈！'],
    [null, '睡覺時間到了！'],
    [null, '請君保重，\n呵呵！'],
    [null, '代替月亮\n懲罰你！！'],
    [null, '可惡！\n你也別想跑！'],
    [null, '請你多多\n擔待吧！'],
    [null, '土匪啊！\n我才不付呢。'],
    [null, '神經！\n害不到我啦！'],
    [null, '你走開啦！！'],
    [null, '我背你走！'],
    [null, '喔～～～～\n股票快漲價！'],
    [null, '喔～～～～\n股票快跌！'],
    [null, '被我抓到了吧！'],
    [null, '這個地段\n也該漲價了吧？'],
    [null, '斷水斷電，\n禁止營業！'],
    [null, '跟我一國\n好處多多喔！'],
    [null, '祝你像牠\n一樣長壽！'],
  ],
  // ── 角色 9 ──
  [
    [null, '有飯大家吃，\n有錢大家花！'],
    [null, '拿些錢\n來花花吧！'],
    [null, '這棟房子\n不錯喔～'],
    [null, '打個商量吧！'],
    [null, '交換一下吧！'],
    [null, '苦海無邊，\n回頭是岸！'],
    [null, '幫你換個\n新造型！'],
    [null, '快喔！\n價高者得～'],
    [null, '天使降臨！！'],
    [null, '惡魔現身！！'],
    [null, '讓我來\n為民除害！！'],
    [null, '維護市容整潔\n人人有責！'],
    [null, '你的就是我的，\n我的還是我的！'],
    [null, '別急著走嘛！'],
    [null, '休息是為了走\n更長的路！'],
    [null, '過馬路\n要小心喔！'],
    [null, '人家\n不是故意的～'],
    [null, '這是你自找的！'],
    [null, '委屈您了～'],
    [null, '人家很窮的！'],
    [null, '人家是無辜的～'],
    [null, '請您\n快快離開吧！！'],
    [null, '有請仙人降臨！'],
    [null, '大紅股票\n高高漲！！'],
    [null, '跌個慘兮兮～'],
    [null, '好國民\n要繳稅喔！'],
    [null, '物價上漲囉！！'],
    [null, '嘻嘻！\n關門大吉！'],
    [null, '聯合次要敵人\n打擊主要敵人！'],
    [null, '嘻！\n你是屬烏龜的～'],
  ],
  // ── 角色 10 ──
  [
    [null, '嘻嘻嘻～'],
    [null, '小錢、小錢！'],
    [null, '我要據為己有！'],
    [null, '好玩嘛！'],
    [null, '我不是故意的！'],
    [null, '別走這邊！'],
    [null, '我能幫助你嗎？'],
    [null, '大拍賣！'],
    [null, '哈利路亞！'],
    [null, '陰陽魔界～'],
    [null, '喔！酷！'],
    [null, '別緊張！'],
    [null, '給我！'],
    [null, '別動！'],
    [null, '睡覺時間到了～'],
    [null, '就像一場夢～'],
    [null, '不過開開玩笑！'],
    [null, '你罪有應得！'],
    [null, '太可憐了！'],
    [null, '我才不付！'],
    [null, '這不算什麼！'],
    [null, '走開！'],
    [null, '請過來！'],
    [null, '我會轉運的！'],
    [null, '看我的！'],
    [null, '我會給你\n收據的！'],
    [null, '太好賺了～'],
    [null, '結束營業！'],
    [null, '嗨！我的朋友！'],
    [null, '減速慢行！'],
  ],
  // ── 角色 11 ──
  [
    [19, '@19'],
    [19, '@19'],
    [11, '@11'],
    [12, '@12'],
    [11, '@11'],
    [12, '@12'],
    [11, '@11'],
    [12, '@12'],
    [11, '@11'],
    [19, '@19'],
    [8, '@08'],
    [8, '@08'],
    [8, '@08'],
    [12, '@12'],
    [18, '@18'],
    [18, '@18'],
    [19, '@19'],
    [8, '@08'],
    [19, '@19'],
    [11, '@11'],
    [12, '@12'],
    [11, '@11'],
    [12, '@12'],
    [20, '@20'],
    [20, '@20'],
    [11, '@11'],
    [12, '@12'],
    [11, '@11'],
    [14, '@14'],
    [19, '@19'],
  ],
];

/** 全部 360 条（= 12 × 30） */
export const CARD_LINE_COUNT = CARD_LINES.length * CARD_LINES_PER_CHARACTER;

/**
 * ★ 第十四份：**免費卡用完之后地主回的那一句** —— 同一张指针表的**槽 79**（`0x48123a + 79×4 = 0x481376`）。
 *
 * @source `0x00444b72`..`0x00444b98`（免費卡 `fcn_00444a60` 的尾巴）：
 * ```asm
 * 00444b66  mov ecx, [esp+0x98]          ; 第 2 实参 = 地主（企業那一路传 −1）
 * 00444b6d  cmp ecx, -1 / je 收尾
 * 00444b8e  mov edi, [eax + 0x481376]    ; 地主的角色行 + 槽 79
 * 00444b95  push 1 / push ecx / call 0x44ef41   ; 表情号 1
 * ```
 * 语音号就是串头的 `#NNNN`：`426 + 52×角色 + 48`（12 条无例外，`card-lines.test.ts` 逐条对 exe）。
 */
export const FREE_CARD_ANSWER_SLOT = 79;
export const FREE_CARD_ANSWER_VOICE_OFFSET = 48;

/** 角色 0..11 → 地主那一句（`[表情图号, 文本]`，金貝貝那一格是 `@DD`） */
export const FREE_CARD_ANSWER_LINES: readonly SpeechLine[] = [
  [null, '算了！\n老子有的是錢。'],
  [null, '吝嗇鬼！！！'],
  [null, '想白吃白喝啊？'],
  [null, '小氣巴拉～'],
  [null, '噠嘛好啊！'],
  [null, '下次就沒\n這麼好運了！'],
  [null, '嘖！'],
  [null, '這點錢\n都要賒賬～'],
  [null, '烏咪討厭\n賴賬的人！！'],
  [null, '小錢也要省？！'],
  [null, '給我錢！！'],
  [15, '@15'],
];

/** 地主那一句的语音号 */
export function freeCardAnswerVoice(character: number): number {
  return CARD_LINE_VOICE_BASE + CARD_LINE_VOICE_STRIDE * character + FREE_CARD_ANSWER_VOICE_OFFSET;
}

/**
 * ★ 第十四份：**嫁禍卡生效后替死鬼回的那一句** —— 同一张指针表的**槽 78**（`0x48123a + 78×4 = 0x481372`）。
 *
 * @source `fcn_0044476a` 尾巴 `0x00444a25`..`0x00444a4b`：
 * ```asm
 * 00444a41  mov edi, [eax + 0x481372]    ; 替死鬼的角色行 + 槽 78
 * 00444a48  push 2 / push ebx / call 0x44ef41   ; 表情号 2
 * ```
 * 语音号 = 串头 `#NNNN` = `426 + 52×角色 + 47`（12 条逐条对 exe，见 `card-lines.test.ts`）。
 */
export const SCAPEGOAT_ANSWER_SLOT = 78;
export const SCAPEGOAT_ANSWER_VOICE_OFFSET = 47;

export const SCAPEGOAT_ANSWER_LINES: readonly SpeechLine[] = [
  [null, '喂！\n有沒有搞錯啊？'],
  [null, '我招誰惹誰啊？'],
  [null, '給我記住！'],
  [null, '終於認清\n你的真面目了！'],
  [null, '麥牽拖厝邊啦！'],
  [null, '真是無妄之災！'],
  [null, '放開我，\n放開我！'],
  [null, '別找我麻煩！！'],
  [null, '跟我沒關係！！'],
  [null, '關人家什麼事！'],
  [null, '為何是我？'],
  [9, '@09'],
];

export function scapegoatAnswerVoice(character: number): number {
  return CARD_LINE_VOICE_BASE + CARD_LINE_VOICE_STRIDE * character + SCAPEGOAT_ANSWER_VOICE_OFFSET;
}
