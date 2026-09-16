/*
 * Speaking.mkf 語音索引 —— (角色, 事件) → 資源號
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 公式（唯一一条，全表 324 项无例外）：
 *
 *     語音號 = 1050 + 27 × 角色号 + 事件号
 *
 *   角色号 0..11（= `CHARACTERS` 的 id = 玩家结构 `+0x13`）、事件号 0..26。
 *   最坏情况 1050 + 27×11 + 26 = **1373**，正好等于 `Speaking.mkf` 的
 *   **最后一个条目号**（见下「条目数」）。
 *
 * ── 取证链（全部落在 rich4.exe 上） ──────────────────────────────
 *
 * ① **表**：`rich4_player_say_on_events.asm` 里 7 个发言人函数反复用同一段寻址：
 *
 *      mov dl, byte [player + 0x13]      ; 角色号（@source 0x0044f246 等 12 处）
 *      mov eax, edx / shl eax,2 / sub eax,edx / shl eax,2
 *                                        ; eax = 12 × 角色号
 *      mov edx, eax
 *      mov ebp, [edx + eax*8 + 0x48084a] ; = 108 × 角色号 + 0x48084a
 *
 *    108 字节 = **27 个 dword 指针**，故 `0x0048084a` 是一张
 *    **12 行 × 27 列的角色台词指针表**，行距 108、列距 4。
 *    （@source VA 0x0044f24c..0x0044f258 / 0x0044f2de.. / 0x0044f377.. …，
 *      本文件 `SPEECH_TABLE_VA` / `SPEECH_STRIDE_BYTES`。）
 *
 * ② **語音號就写在串里**：表里每条串都以 `'#' + 4 位数字` 开头，例如
 *    `"#1050別忌妒我！"`。这个前缀不是 id，是**插播语音的编号**：
 *    `rich4_draw_text`（VA 0x0044fabc）见到首字符 `'#'`（`cmp ah,0x23` @0x0044fb00）
 *    就把 4 位数字解出来（0x0044fb05..0x0044fb4b 的 shl/add 链 = ×1000/×100/×10，
 *    `push`@0x0044fb49 → `call fcn_0045441a`@0x0044fb4e）；
 *    `_rich4_player_say`（VA 0x0044ef41）在 `"#NNNN@…"` 形态下也自己解一次
 *    （`cmp esi,5`@0x0044f0e8 → 0x0044f0ed..0x0044f136 再 `call fcn_0045441a`）。
 * ③ **播放**：`fcn_0045441a(idx)`（VA 0x0045441a）→ `_read_mkf(speaking_mkf, idx, 0, 0)`
 *    （0x00454433..0x00454443，mkf 句柄 = `[0x48a054]`）。**idx 就是资源号本身**，
 *    没有任何偏移或换算。所以「(角色,事件) → 资源号」= 表里那条串的 `#NNNN`。
 * ④ **条目数**：`Speaking.mkf` 头 4 字节 = 索引表偏移 56948030，文件长 56953526,
 *    `(56953526 − 56948030) / 4 = **1374**` 个条目（= `extracted/Speaking/meta.json`
 *    的 `nchunks`，也 = `packages/assets-pipeline/src/audio.ts` 头部写的 1374）。
 *    索引 0..1373 全部存在 ⇒ 公式的最大值 1373 恰好吃满最后一格。
 *    ★ 任务卡 T-051 写的「1375 段」是把 `ls` 数出来的 `meta.json` 也算了一份，
 *      **真实条目数是 1374**（`1374` 才是硬约束，见 speech.test.ts）。
 * ⑤ **表的行数就是 12**：第 12 行（`0x48084a + 12×108 = 0x4808b6`）起不再是这套
 *    台词 —— 该行首项是 `#0236替我除掉障礙物！`，语音号 236，落在公式区间之外。
 *    （行 0..11 的首项分别是 1050 / 1077 / 1104 / 1131 / 1158 / 1185 / 1212 /
 *      1239 / 1266 / 1293 / 1320 / 1347。）
 *
 * ── 27 个槽位怎么被选中 ────────────────────────────────────────
 *
 * 槽位号是**编译期常量**（每个调用点写死自己的列偏移），不是运行期事件码。
 * 7 个发言人函数里有 5 个是「按金额分档 + 偶尔随机二选一」的模板：
 *
 *   `fcn_0044f230`(0x44f230) 阈值 `cmp edx,0x64`(0x44f23f) / `cmp edx,0x32`(0x44f262)
 *        → 列 0 / 0|1（随机）/ 2
 *   `fcn_0044f2c2`(0x44f2c2) 阈值 `cmp edx,6`(0x44f2d1) / `cmp edx,3`(0x44f2f4)
 *        → 列 3 / 3|4（随机）/ 5
 *   `fcn_0044f354`(0x44f354) 阈值 `cmp ebx, [0x4990e8]×0x2328`(0x44f36d，= 9000×物價指數)
 *        / 5000×物價指數(0x44f3b0) / 2000×物價指數(0x44f3f9) → 列 6 / 6|7（随机）/ 8
 *   `fcn_0044f42d`(0x44f42d) 同 9000(0x44f446) / 5000(0x44f486) / `test ebx,ebx`(0x44f4b9)
 *        → 列 9 / 9|10（随机）/ 11
 *   `fcn_0044f567`(0x44f567) 同 9000(0x44f580) / 5000(0x44f5c0) / `test ebx,ebx`(0x44f5f3)
 *        → 列 12 / 12|13（随机）/ 14
 *
 * 另外两个是专用判据：`fcn_0044f4ed`(0x44f4ed) 只在「動手的是最敵對玩家且金額
 * ≥ 5000×物價指數」时说列 18；`fcn_0044f627`(0x44f627) 自己数同一街區 ≥ 3 塊，
 * 按传入参数说列 16 或（1/3 機率）列 17。
 * 列 1 / 4 / 7 / 10 只出现在随机二选一的那条路上（故 `sites` 与相邻列共享）。
 * 列 19..26 由 `rich4.asm` / `rich4_gods.asm` / `rich4_prison_utils.asm` /
 * `rich4_hospital_utils.asm` / `rich4_card_mengyouka.asm` / `rich4_player_bankrupt.asm` /
 * `rich4_new_game.asm` 直接取用。
 *
 * ⚠️ `gloss` 字段是**我读台词 + 调用点得到的注释性说明**，原版**没有**这张
 *    事件名表（它的「表」就是 324 条台词指针）。原版字段名一个都没被我改：
 *    `id` / `line` / `lineVa` / `voice` / `sites` 全是可核对的真值，
 *    `gloss` 只是给人看的（C-FID-2：不臆造原版字段名）。
 */

/** 角色台词指针表基址 @source VA 0x0048084a（`rich4_player_say_on_events.asm` 的 `_rich4_event_strings`） */
export const SPEECH_TABLE_VA = 0x48084a;

/** 行距：108 字节 = 27 个 dword 指针 @source VA 0x0044f258 的 `edx + eax*8` 展开 */
export const SPEECH_STRIDE_BYTES = 108;

/** 每角色的槽位数 @source 108 / 4 */
export const SPEECH_EVENTS_PER_CHARACTER = 27;

/** 角色数 @source 第 12 行（0x004808b6）起不再是这套台词，故恰为 12（= CHARACTERS.length） */
export const SPEECH_CHARACTER_COUNT = 12;

/** 角色 0 槽位 0 的語音號 @source `"#1050別忌妒我！"` @ VA 0x00466bd8 */
export const SPEECH_BASE_INDEX = 1050;

/** 公式能取到的最大語音號 @source 1050 + 27×11 + 26 = 1373 = 最后一个 mkf 条目 */
export const SPEECH_MAX_INDEX = 1373;

/**
 * `Speaking.mkf` 的条目数。
 * @source 头 4 字节 = 索引表偏移 56948030、文件长 56953526 ⇒ (56953526−56948030)/4 = 1374
 * （与 `extracted/Speaking/meta.json` 的 `nchunks`、`assets-pipeline/src/audio.ts` 头部一致）
 */
export const SPEAKING_CHUNK_COUNT = 1374;

/** 一个角色台词槽位 */
export interface SpeechEvent {
  /** 槽位号 0..26（= 表内列号，行内偏移 = id×4） */
  id: number;
  /** 角色 0（約翰喬）在该槽位说的那句 —— exe 表内的 BIG5 原串，含 `#NNNN` 前缀 */
  line: string;
  /** `line` 在 exe 数据段里的 VA */
  lineVa: number;
  /** 語音號 = 1050 + 27×角色 + id；这里是角色 0 的那一份（= 1050 + id） */
  voice: number;
  /**
   * 会取到该槽位的调用点 VA（**取串指令本身**，不是 `call`）。
   * 「随机二选一」的后者没有独占指令，列出来的是配对前者那条
   * （它用 `+eax*4` 在相邻两列里挑一个）；每条都在 speech.test.ts 里比对过。
   */
  sites: readonly number[];
  /** 槽位语义 —— **由台词与调用点读出**，非原版字段 */
  gloss: string;
}

/**
 * 27 个角色台词槽位（`line` 取角色 0 那一列；其余 11 列同号同义）。
 *
 * 每行形状固定：`{ id, line, lineVa, voice, sites, gloss }`。
 * 逐条二进制校验见 `speech.test.ts`（对 324 条串全量比对）。
 */
export const SPEECH_EVENTS: readonly SpeechEvent[] = [
  { id: 0, line: '#1050別忌妒我！', lineVa: 0x00466bd8, voice: 1050, sites: [0x0044f258, 0x0044f288, 0x0044c5b5, 0x0040f8a0, 0x0041b200, 0x004154be],
    gloss: '收入（金額 > 100；50～100 時與 1 號隨機二選一）' },
  { id: 1, line: '#1051鴻運當頭！', lineVa: 0x00466be8, voice: 1051, sites: [0x0044f288],
    gloss: '收入（金額 51～100）' },
  { id: 2, line: '#1052運氣不差！', lineVa: 0x00466bf8, voice: 1052, sites: [0x0044f2aa, 0x0041ac15, 0x0041b28d],
    gloss: '收入（金額 1～50）' },
  { id: 3, line: '#1053我慘了', lineVa: 0x00466c08, voice: 1053, sites: [0x0044f2ea, 0x0044f31a, 0x0044bf8e, 0x004494bc],
    gloss: '支出（金額 > 6；4～6 時與 4 號隨機二選一）' },
  { id: 4, line: '#1054唉呦喂呀', lineVa: 0x00466c14, voice: 1054, sites: [0x0044f31a],
    gloss: '支出（金額 4～6）' },
  { id: 5, line: '#1055死不了人的', lineVa: 0x00466c22, voice: 1055, sites: [0x0044f33c, 0x0044ca1f],
    gloss: '支出（金額 1～3）' },
  { id: 6, line: '#1056這是我應得的！', lineVa: 0x00466c32, voice: 1056, sites: [0x0044f389, 0x0044f3d9],
    gloss: '進帳（≥ 9000 × 物價指數；5000～9000 時與 7 號隨機二選一）' },
  { id: 7, line: '#1057我是全球首富', lineVa: 0x00466c46, voice: 1057, sites: [0x0044f3d9],
    gloss: '進帳（5000～9000 × 物價指數）' },
  { id: 8, line: '#1058蠅頭小利～', lineVa: 0x00466c58, voice: 1058, sites: [0x0044f415, 0x0040ecd3],
    gloss: '進帳（2000～5000 × 物價指數）' },
  { id: 9, line: '#1059老本都快沒了～', lineVa: 0x00466c68, voice: 1059, sites: [0x0044f462, 0x0044f4af],
    gloss: '付錢（≥ 9000 × 物價指數；5000～9000 時與 10 號隨機二選一）' },
  { id: 10, line: '#1060真沒良心！', lineVa: 0x00466c7c, voice: 1060, sites: [0x0044f4af],
    gloss: '付錢（5000～9000 × 物價指數）' },
  { id: 11, line: '#1061拿去啦，\n不用找了～', lineVa: 0x00466c8c, voice: 1061, sites: [0x0044f4d5],
    gloss: '付錢（> 0，且 < 5000 × 物價指數）' },
  { id: 12, line: '#1062上帝保佑～', lineVa: 0x00466ca5, voice: 1062, sites: [0x0044f59c, 0x0044f5e9],
    gloss: '罰款／醫藥費（≥ 9000 × 物價指數；5000～9000 時與 13 號隨機二選一）' },
  { id: 13, line: '#1063耶穌保佑', lineVa: 0x00466cb5, voice: 1063, sites: [0x0044f5e9, 0x0041d6d2],
    gloss: '罰款／醫藥費（5000～9000 × 物價指數）' },
  { id: 14, line: '#1064letitbe', lineVa: 0x00466cc3, voice: 1064, sites: [0x0044f60f],
    gloss: '罰款／醫藥費（> 0，且 < 5000 × 物價指數）' },
  { id: 15, line: '#1065我真佩服自己', lineVa: 0x00466cd0, voice: 1065, sites: [0x0040fa13, 0x00419a0e, 0x0041ab4a],
    gloss: '得意（多個觸發點；其中一處是 `player+0x1a == 5`）' },
  { id: 16, line: '#1066我是個大地主', lineVa: 0x00466ce2, voice: 1066, sites: [0x0044f6d5],
    gloss: '同一街區獨佔 ≥ 3 塊（`fcn_0044f627` 傳入參數為 0 時）' },
  { id: 17, line: '#1067我要稱霸一方了', lineVa: 0x00466cf4, voice: 1067, sites: [0x0044f6ab],
    gloss: '同一街區獨佔 ≥ 3 塊（傳入參數非 0 時，1/3 機率）' },
  { id: 18, line: '#1068兄弟，\n我記住你了', lineVa: 0x00466d08, voice: 1068, sites: [0x0044f549],
    gloss: '被「最敵對玩家」拿走 ≥ 5000 × 物價指數（1/2 機率）' },
  { id: 19, line: '#1069放我出去！', lineVa: 0x00466d1f, voice: 1069, sites: [0x0043d70d, 0x0040ca46],
    gloss: '坐牢' },
  { id: 20, line: '#1070我不要打針！！', lineVa: 0x00466d2f, voice: 1070, sites: [0x0043edbc, 0x0040cabf],
    gloss: '住院' },
  { id: 21, line: '#1071不要吵～～', lineVa: 0x00466d43, voice: 1071, sites: [0x0044434b, 0x0040cb41],
    gloss: '夢遊卡（睡著）' },
  { id: 22, line: '#1072別鬧了！', lineVa: 0x00466d53, voice: 1072, sites: [0x0040ef2f, 0x0040eff8, 0x0040f097],
    gloss: '神明相關（`rich4_gods.asm` 五處）' },
  { id: 23, line: '#1073一場惡夢～', lineVa: 0x00466d61, voice: 1073, sites: [0x0040e64a],
    gloss: '神明 id ∈ {5, 6, 7, 8, 0xf}' },
  { id: 24, line: '#1074哈哈！\n勝利總是在\n正義的一方！', lineVa: 0x00466d71, voice: 1074, sites: [0x0040d055, 0x0041d93c],
    gloss: '勝利宣言（檯面上只剩一名玩家）' },
  { id: 25, line: '#1075不過是\n運氣差了點～', lineVa: 0x00466d95, voice: 1075, sites: [0x0040d237],
    gloss: '破產／敗者' },
  { id: 26, line: '#1076我要再接再勵，\n永往直前！', lineVa: 0x00466dae, voice: 1076, sites: [0x00407946],
    gloss: '開局宣言（呼叫端 `or ah, 0x80` 強制播報）' },
];

/**
 * **每个角色自己的台词**（12 × 27 = 324 条，逐条来自 `rich4.exe`）。
 *
 * ★ 2026-09-16 补齐：`SPEECH_EVENTS` 的 `line` 只存了**角色 0（約翰喬）那一列**
 *   （当时只是为了给 `#NNNN` 做二进制校验），另外 11 个角色自己的台词一直没进仓库。
 *   本表把 324 条全部落下来，槽位语义与 `SPEECH_EVENTS` 同号同义。
 *
 * ★ **金貝貝（角色 11）不会说话**：它那一列 27 条串全是 `@DD` 形状
 *   （`DD` 两位十进制，本次实测用到 01/02/03/04/05/07/08/10/13/15/16/17/18/20/21），
 *   即**一组表情图**。图的出处与图号算式见 `SPEECH_EMOJI_RESOURCE` /
 *   `speechEmojiImage()`。
 *
 * 生成：`python3 tools/gen-speech.py --json`（脚本从 exe 的指针表
 * `0x48084a` 逐项读，BIG5 解码；核对见 `speech.test.ts` 的全量比对）。
 */

/** 一个角色的 27 条台词：`[表情码, 文本]`；表情码为 `null` 时是普通台词 */
export type SpeechLine = readonly [number | null, string];

/** 角色下标 0..11 → 27 条台词（下标 = `SPEECH_EVENTS` 的 `id`）*/
export const SPEECH_LINES: readonly (readonly SpeechLine[])[] = [
  [
    [null, '別忌妒我！'], [null, '鴻運當頭！'], [null, '運氣不差！'], [null, '我慘了'], [null, '唉呦喂呀'], [null, '死不了人的'], [null, '這是我應得的！'], [null, '我是全球首富'], [null, '蠅頭小利～'], [null, '老本都快沒了～'], [null, '真沒良心！'], [null, '拿去啦，\n不用找了～'], [null, '上帝保佑～'], [null, '耶穌保佑'], [null, 'letitbe'], [null, '我真佩服自己'], [null, '我是個大地主'], [null, '我要稱霸一方了'], [null, '兄弟，\n我記住你了'], [null, '放我出去！'], [null, '我不要打針！！'], [null, '不要吵～～'], [null, '別鬧了！'], [null, '一場惡夢～'], [null, '哈哈！\n勝利總是在\n正義的一方！'], [null, '不過是\n運氣差了點～'], [null, '我要再接再勵，\n永往直前！'],
  ],
  [
    [null, '阿拉真主！\n我讚美你！'], [null, '感謝阿拉！'], [null, '運氣好而已啦～'], [null, 'OH～NO！'], [null, '比減肥\n更讓我痛苦！！'], [null, '人生不如意\n十有八九～'], [null, '呵～\n別忌妒我啊！'], [null, '我可是正正當當\n的賺錢喔！'], [null, '嗯～\n聚沙成塔！'], [null, '我的心臟病\n要發作了～'], [null, '我會把它\n賺回來的！！'], [null, '真捨不得！'], [null, '該你的\n還是會給你的！'], [null, '賺到了！'], [null, '能省則省。'], [null, '大家別打\n這棟房子\n的主意喔！'], [null, '可別眼紅哪～'], [null, '羨慕吧！！'], [null, '我怎麼會\n栽在你手上？'], [null, '還剩幾天？'], [null, '我要特別看護！'], [null, '呼嚕呼嚕～'], [null, '我背不動你！！'], [null, '累贅終於走了～'], [null, '我的付出\n終於得到回報！'], [null, '這怎麼可能？！'], [null, '我要東山再起！'],
  ],
  [
    [null, '大吉大利！'], [null, '也該輪到我了！'], [null, '太感激了！'], [null, '天亡我也～'], [null, '面對現實吧～'], [null, '為什麼\n要這樣對我？'], [null, '錢我多的是！'], [null, '謝謝～'], [null, '聊勝於無！'], [null, '哇！囊空如洗～'], [null, '我已經\n忍無可忍了！'], [null, '別跟\n鐵公雞要錢！'], [null, '拔一毛以利\n天下不為也！'], [null, '真是對不起！'], [null, '省起來\n當老婆本！'], [null, '值得慶祝！'], [null, '土地\n是多多益善！'], [null, '房子\n沒人會嫌多～'], [null, '君子報仇\n三年不晚！'], [null, '放我自由～'], [null, '男兒有淚\n不輕彈～'], [null, 'zzZZZ\nΖΖΖΖ'], [null, '去找別人！！'], [null, '厄運終於\n離我遠去！'], [null, '努力是有\n代價的！'], [null, '富貴如浮雲～'], [null, '百折不撓，\n堅毅必勝！'],
  ],
  [
    [null, '今夜做夢\n也會笑～'], [null, '我是幸運女神！'], [null, '不賴嘛～'], [null, '天啊～'], [null, '讓我死了吧！'], [null, '我的媽媽呀！'], [null, '帥呆了！'], [null, '噱海了！'], [null, '賺翻了！'], [null, '豈有此理！'], [null, '不能打折嗎！！'], [null, '為什麼？'], [null, '撿回一條命！'], [null, '真走運！'], [null, '好險～'], [null, '算你便宜一點，\n快來吧！'], [null, '哈哈哈！\n勝利在望！'], [null, '不怕死的\n就過來！'], [null, '老娘跟你沒完！'], [null, '放我出去！！！'], [null, '唉！真倒霉'], [null, 'zzZZZZ\nＺＺＺ'], [null, '難道是\n我太有魅力？'], [null, '離我遠一點！'], [null, '來賓請掌聲鼓勵！'], [null, '哇～我要過\n少奶奶的生活！'], [null, '我錢夫人不會\n就這麼放棄的！'],
  ],
  [
    [null, '福氣啦！'], [null, '歹勢啦！'], [null, '真好運！'], [null, '捺會按呢？？'], [null, '有影嘸？！'], [null, '嘸蝦米！'], [null, '貪財！貪財！'], [null, '嘸魚蝦也好！'], [null, '加減賺！'], [null, '我苦！'], [null, '真衰～'], [null, '哇～真歹命！'], [null, '天公伯保佑！'], [null, '憨人有憨福！'], [null, '好哩家在！'], [null, '大家有閒\n來坐喔！'], [null, '來泡茶啦！'], [null, '樓仔厝起歸排！'], [null, '你家開黑店啊？'], [null, '冤枉啊！'], [null, '唉喲喂呀～'], [null, '鼾鼾～'], [null, '啊！悽慘落魄～'], [null, '早就好走啊～'], [null, '天公疼憨人！'], [null, '火燒罟寮\n嘸魚網～'], [null, '愛拼才會贏！'],
  ],
  [
    [null, '福星高照！'], [null, '天降鴻福！！'], [null, '得意的一天！'], [null, '飛來橫禍！'], [null, '無妄之災！'], [null, '真是不幸～'], [null, '人無橫財不富！'], [null, '多多益善！'], [null, '塞牙縫都不夠！'], [null, '搶錢啊？！'], [null, '哼！這點錢\n也要跟我拿～'], [null, '算本公主賞你的'], [null, '本公主\n就是不想付，\n怎樣？'], [null, '不付\n也是應該的。'], [null, '諒你也不敢\n跟本公主收錢！'], [null, '哈！不要命的\n就來啊！'], [null, '快來這裡玩玩！'], [null, '你們有得瞧囉！'], [null, '本公主跟你有\n深仇大恨嗎？'], [null, '還不放我出去！'], [null, '我要住\n頭等病房！！！'], [null, '我不睏～'], [null, '別弄髒\n我的衣服！！'], [null, '終於肯走了！'], [null, '你們都不是\n對手！！'], [null, '一定有誰\n作弊啦！'], [null, '本公主\n決不放棄！'],
  ],
  [
    [null, '萬歲！\n中大獎了！'], [null, 'Lucky！\n運氣不錯！'], [null, '最近\n運氣不錯嘛！'], [null, '可恨，混帳烏龜\n王八蛋！'], [null, '為…為什麼？'], [null, '嘖，有夠倒楣…'], [null, '哈哈哈，\n真是幸運！'], [null, '喔，進帳了！'], [null, '不錯不錯，\n總比沒有好…'], [null, '啊啊啊…\n世事無常…'], [null, '嘖，這麼貴呀！'], [null, '小意思，\n小意思！'], [null, '哈哈哈，\n很羨慕吧！'], [null, '哈哈，幸運！'], [null, '哼，\n這剛剛好而已！'], [null, '喔喔，\n我真了不起！'], [null, '呵呵呵，\n我還滿行的嘛！'], [null, '呼呼呼，\n誰會來呢，\n真令人期待！'], [null, '你．給．我．\n記·著！'], [null, '放我出去！\n我是無辜的！'], [null, '嗨，漂亮的護士\n妹妹在哪兒？'], [null, 'ZZZ…'], [null, '為什麼是我？'], [null, '呼…\n終於走掉了！'], [null, '呵呵呵，\n功成名就啦！'], [null, '可恨…\n最近有夠背！'], [null, '畜生，\n我偏不信邪！'],
  ],
  [
    [null, '可喜可賀！'], [null, '好幸福喔！'], [null, '嗯～我很滿意！'], [null, '真淒慘～'], [null, '不跟你好了！！'], [null, '好倒楣喔～'], [null, '我是小富婆～'], [null, '哇！賺到了'], [null, '怎麼\n不多給一點？'], [null, '太誇張了！'], [null, '賺的都不夠賠！'], [null, '唉！\n錢乃身外之物～'], [null, '別想我會付錢！'], [null, '下次再給你～'], [null, '省起來！'], [null, '萬丈高樓\n平地起！！'], [null, '總算買到了！'], [null, '好棒喔！'], [null, '為什麼\n要欺負我？'], [null, '放我出去！'], [null, '我要回家～'], [null, 'ΖΖΖΖΖ'], [null, '魔鬼！！'], [null, '最好\n離我遠遠的～'], [null, '回家啦～'], [null, '嗚～\n一毛都不剩～'], [null, '讓我\n再玩一次吧！'],
  ],
  [
    [null, '漂亮！'], [null, '酷斃了！'], [null, '哈哈！\n今天真高興！'], [null, '不可能！！'], [null, '走霉運！'], [null, '太失敗了！'], [null, '大豐收！！'], [null, '哈！意外之財'], [null, '才這點錢啊？'], [null, '為什麼會是我？'], [null, '有沒有搞錯啊？'], [null, '不要緊～'], [null, '捏了一把冷汗～'], [null, '太痛快了！'], [null, '不是我\n不給你喔！'], [null, '真有成就感！！'], [null, '你也來試試看嘛'], [null, '歡迎大家來玩！'], [null, '為什麼\n要跟烏咪作對？'], [null, '烏咪沒有犯罪！'], [null, '醫生在哪裡？'], [null, 'zzzzzz\nZZZZZZ'], [null, '提心弔膽～～'], [null, '終於可以\n鬆一口氣了～'], [null, '你們都不是\n烏咪的對手啦！'], [null, '你們爭氣點\n行不行？'], [null, '再接再勵！'],
  ],
  [
    [null, '我是不是\n在作夢啊？'], [null, '太高興了！'], [null, '好的開始\n是成功的一半！'], [null, '完蛋了！'], [null, '慘了～'], [null, '人家不管啦！'], [null, '哈！財源滾滾。'], [null, '好樣的！'], [null, '嘻～積少成多！'], [null, '人家付不起啦！'], [null, '唉～花錢消災！'], [null, '小意思～'], [null, '嚇人家一跳！！'], [null, '真是萬幸！'], [null, '還好沒事～'], [null, '人家真能幹！'], [null, '有空來坐坐吧！'], [null, '太棒了！'], [null, '錢都被你\n拿光了！'], [null, '人家是無辜的～'], [null, '嗚嗚嗚～～～'], [null, '嗯～'], [null, '不要找我～'], [null, '呼～總算走了！'], [null, '呵呵呵～\n承讓了！'], [null, '嗚～人家一毛\n也不剩了。'], [null, '我不甘心！\n我要捲土重來！'],
  ],
  [
    [null, '帥呆了！'], [null, '太妙了！'], [null, '喔！耶！'], [null, '媽媽咪呀！'], [null, '喔！我的天啊！'], [null, '我不相信！'], [null, '我是有錢人！'], [null, '我賺大錢了！'], [null, '不錯嘛！'], [null, '太貴了！'], [null, '我破產了！'], [null, '沒什麼大不了！'], [null, '幸運！'], [null, '感謝上帝！'], [null, '太美了！'], [null, '好極了！'], [null, '太棒了！'], [null, '萬歲！'], [null, '你不能\n這樣對我！'], [null, '讓我出去！'], [null, '我沒有生病！'], [null, '我不累～'], [null, '喔！不！'], [null, '感謝老天！'], [null, '我是贏家！'], [null, '不公平！'], [null, '讓我再玩一次！'],
  ],
  [
    [4, '@04'], [16, '@16'], [1, '@01'], [3, '@03'], [10, '@10'], [13, '@13'], [17, '@17'], [21, '@21'], [15, '@15'], [3, '@03'], [10, '@10'], [13, '@13'], [5, '@05'], [2, '@02'], [7, '@07'], [4, '@04'], [16, '@16'], [1, '@01'], [8, '@08'], [10, '@10'], [17, '@17'], [18, '@18'], [3, '@03'], [4, '@04'], [16, '@16'], [3, '@03'], [20, '@20'],
  ],
];
/**
 * 金貝貝那组**表情图**的资源号 —— `Data.mkf` **#0x207（519）**。
 *
 * @source `rich4_load_map.asm:578-584`：`read_mkf(_rich4_data_mkf, 0x207)`
 *   → `[0x48bad4]`；而 `rich4.asm:23646-23660` 那一段就是解析 `@DD` 的地方：
 *
 * ```asm
 * 0044f088  xor esi, esi
 * 0044f08a  lea edx, [ebx + esi]      ; ebx = 串首；有 '#' 前缀时 esi = 5
 *           cmp byte [edx], 0x40       ; '@' ?
 *           jne 普通文字
 *           mov al, [edx+1] / sub eax, 0x30   ; 十位
 *           lea ecx, [eax-1] / shl eax,2 / add eax,ecx / add eax,eax
 *           mov dl, [edx+2] / sub edx, 0x30   ; 个位
 *           add eax, edx                       ; eax = 10×十位 + 个位 − 10
 *           push 0x82 / push 0xf0              ; ★ 落点 (0xf0, 0x82)
 *           lea edx, [eax-1]
 *           mov eax, edx / shl eax,2 / sub eax,edx   ; ★ ×3
 * ```
 *
 * ⇒ **图号 = `3×十位 + 个位 − 1`**（机器码那两步是 `3 × (eax − 1)`，
 *   其中 `eax` 已是「按十位分组的 10 步」值）：
 *   code 01→图 0、02→图 1、…、09→图 8、10→图 2、…、19→图 10、20→图 5、21→图 6。
 *   实测该资源共 **21 张**（`assets-clean/Data/0519_000..020.png`），
 *   code 01..21 映射到 0..20 —— **恰好一一对应、不重不漏**。
 */
export const SPEECH_EMOJI_RESOURCE = 0x207;

/** `Data.mkf` #0x207 的**图数** —— 实测 `assets-clean/Data/0519_000..020.png` 共 21 张 */
export const SPEECH_EMOJI_IMAGE_COUNT = 21;

/** 表情落的屏幕坐标 @source 上面那两条 `push 0x82 / push 0xf0`（x 在前、y 在后）*/
export const SPEECH_EMOJI_AT = { x: 0xf0, y: 0x82 } as const;

/**
 * 表情码 → `Data.mkf` #0x207 的图号。
 *
 * @source 上面那段机器码：`3×十位 + 个位 − 1`。**不要**按 `code` 直接乘 3 ——
 *   `+DD` 的两位数字是「十位 / 个位」，而图号算式把十位当作 10 步一组的组号。
 */
export function speechEmojiImage(code: number): number {
  const tens = Math.trunc(code / 10);
  const ones = code % 10;
  return 3 * tens + ones - 1;
}

/** 某个角色某个槽位的台词；越界抛（与 `speechIndex` 同一套约定）*/
export function speechLine(character: number, event: number): SpeechLine {
  if (character < 0 || character >= SPEECH_CHARACTER_COUNT) {
    throw new RangeError(`角色号越界：${character}`);
  }
  if (event < 0 || event >= SPEECH_EVENTS_PER_CHARACTER) {
    throw new RangeError(`事件号越界：${event}`);
  }
  const row = SPEECH_LINES[character];
  const line = row?.[event];
  if (line === undefined) throw new RangeError(`台词表缺项：${character}/${event}`);
  return line;
}

/**
 * `(角色, 事件) → Speaking.mkf 资源号`。
 *
 * 公式 `1050 + 27×角色 + 事件` @source 表项串里的 `#NNNN`：
 * 角色 0..11 的第 0 项分别是 `#1050`(VA 0x00466bd8) / `#1077`(0x00466dcd) /
 * `#1104`(0x0046701a) / `#1131`(0x00467242) / `#1158`(0x0046744c) /
 * `#1185`(0x00467610) / `#1212`(0x00467854) / `#1239`(0x00467ae3) /
 * `#1266`(0x00467cd4) / `#1293`(0x00467edf) / `#1320`(0x004680e3) /
 * `#1347`(0x0046828e)。
 *
 * ⚠️ **越界即抛 `RangeError`，不做夹取。** 判据：
 *   ① 原版**没有**任何夹取 —— 角色号来自 `player+0x13`（游戏中恒为 0..11），
 *      事件号是每个调用点写死的列偏移；越界在原版就是读到别的表（内存里的
 *      下一块数据），**不是**一个可复刻的行为。
 *   ② 本项目对「编号越界」的既有约定就是抛（`characterByKey`、
 *      `MkfArchive.header` 皆然），这里与之一致，免得悄悄播错语音。
 *   换言之：夹取是**改良**（C-FID-1），故不提供。
 */
export function speechIndex(character: number, event: number): number {
  if (!Number.isInteger(character) || character < 0 || character >= SPEECH_CHARACTER_COUNT) {
    throw new RangeError(
      `語音索引：角色号越界 ${character}（合法 0..${SPEECH_CHARACTER_COUNT - 1}）`,
    );
  }
  if (!Number.isInteger(event) || event < 0 || event >= SPEECH_EVENTS_PER_CHARACTER) {
    throw new RangeError(
      `語音索引：事件号越界 ${event}（合法 0..${SPEECH_EVENTS_PER_CHARACTER - 1}）`,
    );
  }
  return SPEECH_BASE_INDEX + SPEECH_EVENTS_PER_CHARACTER * character + event;
}

/** 按槽位号取事件（越界返回 undefined，与 `newsEvent` / `fortuneEvent` 同风格） */
export function speechEvent(id: number): SpeechEvent | undefined {
  return SPEECH_EVENTS.find((e) => e.id === id);
}
