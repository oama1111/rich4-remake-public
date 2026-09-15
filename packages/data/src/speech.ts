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
