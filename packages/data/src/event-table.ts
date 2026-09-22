/*
 * 新聞／命運事件表
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 由 rich4.exe 的两张函数指针表提取：
 *   新聞 `events_calls_table[]`  @ VA 0x00475e24（36 项）
 *   命運 `fortune_call_table[]`  @ VA 0x00475ef0（37 项）
 *   复核：`python3 tools/disasm.py scan news all` / `scan fortune all`
 *
 * `factor`：该事件的金额 = `物价指数 × factor`。
 *   原版用 `shl/add/sub` 移位链凑乘法，没有现成立即数可读，
 *   故由符号执行还原。还原出的系数**全部是整百**，这条不变式本身
 *   就是还原正确的佐证（见测试）。`null` 表示不涉及固定金额
 *   （可能是百分比、天数、或作用于企业而非玩家）。
 *
 * `text`：原版提示语，含 `#NNNN` 编号前缀与 `%d`/`%s` 占位符。
 *   `stripEventCode()` 可去掉编号前缀。
 *   （素材约束见 DEVELOPMENT_PLAN.md 的 C-LEG-2：本项目为个人练习，
 *   文案入库；图素／音乐等大体积二进制仍不入库。）
 */

/** 一条事件的结构信息 */
import { stripVoiceCode } from './voice-code.ts';

export interface EventEntry {
  id: number;
  /** 效果函数在原版 exe 中的虚拟地址 */
  va: number;
  /** 金额系数：金额 = 物价指数 × factor；null 表示不适用 */
  factor: number | null;
  /**
   * 该事件触达的关键效果，由**控制流可达性**分析得出
   * （从事件函数入口做有界遍历，看能走到哪个已知函数）：
   *
   * - `pay`      → `pay_money(current, -1, 金额, 0)`：进公库，
   *                **含存款级联与破产判定**
   * - `give`     → `give_money(current, 金额, 1)`（VA 0x0041d3f4）：
   *                **直接加现金**，无级联、不会破产
   * - `prison`   → `send_to_prison`
   * - `hospital` → `send_to_hospital`
   * - `loan`     → 直接给 `player.loan`(+0x24) 加钱（冒貸）
   * - `bankBan`  → `add byte [player+0x3b], 0x1e`，银行拒绝往来 30 天
   *
   * ★ `pay` 与 `give` **不是对称的**——这条差异必须保留。
   *
   * 空数组表示效果不落在以上任何一条上（多半作用于企业或地块，
   * 或尚未分析），并非"无效果"。
   */
  effects: readonly (
    | 'pay'
    | 'give'
    | 'prison'
    | 'hospital'
    | 'loan'
    | 'bankBan'
    | 'loanFreeze'
    /**
     * 新聞 0 / 2：**把在监/在院的人放出来** —— `days = 0x80`（待释放）+ 清占用槽。
     *   @source `rich4_news.asm` 的 `fcn_00449006`（医院，VA 0x0044903d 起）与
     *   `fcn_00448f45`（监狱，VA 0x00448f01 起）
     */
    | 'releasePrison'
    | 'releaseHospital'
    /**
     * 新聞 1 / 3：**给在监/在院的人加 %d 天** —— `days = (days + n) & 0x7f`。
     *   ★ `& 0x7f` 会把「待释放」的 0x80 抹掉 ⇒ 本来今天就能出来的又被关回去。
     *   @source `fcn_00448ffd`（监狱，VA 0x00448fa8 起）/ `fcn_00449081`（医院，VA 0x004490e8 起）
     */
    | 'extendPrison'
    | 'extendHospital'
    /**
     * 新聞 16 / 17：**行人／車輛休息一回合** —— 把所有满足交通方式的在场玩家的
     *   `+0x38`（`days_stopping`）写成 **1**。16 只打**行人**（`traffic_method == 0`），
     *   17 只打**非行人**。@source `fcn_0044a5d6` 的循环（VA 0x0044a606 起）与
     *   `fcn_0044a657` 的循环（VA 0x0044a68b 起）
     */
    | 'stopPedestrians'
    | 'stopVehicles'
    /**
     * 新聞 24 / 25：**12 支股票的 `newsFlag`(`+7`) 直接赋值** —— 24 写 `1`
     *   （低半字节 = 利空 1 天）、25 写 `0x10`（高半字节 = 利多 1 天）。
     *   ★ 是**赋值**不是置位 ⇒ 会把原有剩余天数冲掉。
     *   @source VA 0x0044b035..0x0044b047 / 0x0044b080..0x0044b092
     */
    | 'marketBearish'
    | 'marketBullish'
    /**
     * 新聞 26：**全股市暂停交易 10 天** —— `mov dword [0x4990dc], 0xa`
     *   （VA 0x0044b0c6）。该全局量就是 `fcn_00428d01` 里那个「休市」判据。
     */
    | 'marketClose'
    /**
     * 新聞 27：**随机挑一支股票停牌** —— `f6(+6) = 0xf`，并把 `price` 冻结成
     *   `openPrice`、写回 `history[股票][day-1]`。@source VA 0x0044b0f8..0x0044b193
     *   ★ 文案说「１０天」而立即数是 `0xf`(15)：**照抄立即数**。
     */
    | 'suspendStock'
    /**
     * 新聞 28：**在停牌股里随机挑一支恢复**（`f6 = 0`）@source VA 0x0044b1c3..0x0044b24d
     *   ★ 原版在「一支停牌股都没有」时 `idiv 0` 会**除零崩** —— 本引擎不做这件事
     *   （那一支直接什么都不做）。
     */
    | 'resumeStock'
    /**
     * 新聞 6 / 14：**随机挑一块地（或一处設施），把同名地块的地价 ×1.3 / ×0.7**。
     *
     * @source `fcn_004494e0`（6，常量 `[0x4654dc]` = 1.3）/ `fcn_0044a220`（14，`[0x46561c]` = 0.7）：
     * ```asm
     * edx = rand() % (num_lands + num_facilities)      ; ★ 地先、設施后
     * if (edx < num_lands) {                           ; —— 地块那一支
     *   target = land(edx)                             ; 1 基下标 = edx+1
     *   for (i = 1; i <= num_lands; i++)               ; ★ 扫**全部**地块
     *     if (strcmp(land(i).name, target.name) == 0)  ;   同名的
     *       land(i).+0x1c = trunc(land(i).+0x1c × C)   ;   land_price × C（frndint = 截断）
     * } else {                                         ; —— 設施那一支
     *   fac = facility(edx - num_lands)
     *   fac.+0x22 = trunc(fac.+0x22 × C)               ; ★ 只改**挑中那一处**（不扫同名）
     * }
     * ```
     */
    | 'raiseLandPrice'
    | 'lowerLandPrice'
    /**
     * 新聞 5/15/19/21：**随机挑一处「建筑」按 `mutate_land` 的某个模式改**。
     *
     * 三条信息：**候选集**（全部 / 只挑有等级的建筑 / 只挑地块）、**模式**（0 拆一级 / 1 清归属）。
     *
     * | 事件 | 候选集 | 模式 | @source |
     * |---|---|---|---|
     * | 5 外星怪獸襲擊%s 摧毀建築一棟 | 地块 + 設施，且 `level != 0` | **1** | `fcn_004492a0`（VA 0x4492d0 / 0x449308 两级过滤；0x449408 后 `push 1`）|
     * | 15 %s一處民宅瓦斯爆炸 房屋失火 | **只地块**，且 `level != 0` | **0** | `fcn_0044a453`（0x44a47d 的过滤循环；0x44a536 `push 0`）|
     * | 19 %s山洪爆發土地流失 | 地块 + 設施，**不过滤** | **1** | `fcn_0044a91e`（0x44a943 直接 `rand()%(地+設施)`；0x44a9xx `push 1`）|
     * | 21 龍捲風侵襲%s 摧毀房屋一棟 | 地块 + 設施，**不过滤** | **0** | `fcn_0044ac99`（0x44acbd；0x44adf5 `push 0`）|
     *
     * ★ 四个函数都**不看 `affected`**；候选集为空时原版 `idiv` 会**除零崩**，
     *   本引擎那一支什么都不做（与 28 同一处理）。
     * ★ 改的是复用 helper `mutate_land`（VA 0x0040ab4a，地块与設施各一套分支），
     *   见 `cards/monster.ts` 的 `mutateLand` / `mutateFacilityInfo`。
     */
    | 'demolishBuiltLand'
    | 'clearOwnerBuilt'
    | 'clearOwnerAny'
    | 'demolishAny'
    /**
     * 新聞 18「%s強烈地震房屋倒塌」：随机挑一处（地块+設施，**不过滤**），
     *   模式 0；**地块那一支把同名地块全拆一级**（和 6/14 同一套 `strcmp` 循环），
     *   設施那一支只拆挑中那一处。@source `fcn_0044a6e0`（选择 VA 0x44a6f4；
     *   同名循环 0x44a80c；設施分支 0x44a8xx）
     */
    | 'demolishSameName'
    /**
     * 新聞 20「%s超級颱風侵襲 多處房屋受損」：随机挑一处（地块+設施，**不过滤**），
     *   然后以它为心打一发 **`damage_area(半径 0x64, flags 6, 轻重 0, 攻击者 -1)`**。
     *
     * @source `fcn_0044ab2c` 的 phase 2（VA 0x0044ac02 起）：
     * ```asm
     * push -1 / push 0 / push 6 / push 0x64 / call 0x40ac7b
     * ;      ↑攻击者  ↑轻重 ↑flags  ↑半径
     * ```
     *   `flags = 6 = 0x4|0x2` ⇒ **打住宅和設施，不打范围里的人**（0x20 没置）；
     *   攻击者 `-1` ⇒ **不记敌意**（`damage_area` 里 `cmp esi,0xffffffff / je` 跳过）。
     *   ★ 与飛彈/核彈走的是**同一个** `damage_area`，只是参数不同。
     */
    | 'typhoonBlast'
    /**
     * 新聞 4「外星人攻打地球」：**随机挑一处盖了房子的地块／設施，以它为心打一发
     *   `damage_area(半径 0x64, flags 0x26, 轻重 1, 攻击者 -1)`（重击），再把被炸到的
     *   人送医院 3 天**。
     *
     * @source `fcn_0044913d` 的施加阶段（VA 0x00449175 起）：
     * ```asm
     * ; ① 候选表：先 level != 0 的地块（id = i+0x7d0），再 level != 0 的設施（id = i+0xfa0）
     * 0044918d  cmp  byte [edx + eax + 0x1a], 0 / je 跳过      ; land.level
     * 004491c6  cmp  byte [edx + eax + 0x1a], 0 / je 跳过      ; facility.level
     * 004491dd  call 0x456f2d                                  ; rand()
     * 004491e7  idiv esi                                       ; rand() % 候选数
     * 00449203  call 0x40af12                                  ; 取挑中那一处的 (x, y)
     * 0044921d  call 0x41d476                                  ; 移镜头（表现层）
     * ; ② 爆心：半径 0x64、flags 0x26（住宅|設施|范围里的人）、**轻重 = 1**、攻击者 -1
     * 00449225  push -1 / 00449227 push 1 / 00449229 push 0x26 / 0044922b push 0x64
     * 0044922d  call 0x40ac7b
     * ; ③ 表现层：载 0x213 号资源 → 播动画 → free（0x450441 / 0x45144f / 0x456e11）
     * ; ④ 扫玩家 0..num_players-1，凡被 0x40cd07 挂上「被炸」位（`+0x15 & 0x40`）的送医院 3 天
     * 00449279  test byte [eax + 0x496b7d], 0x40 / je 跳过
     * 00449285  call 0x43ec3f                                  ; send_to_hospital(player, 3)
     * ; ⑤ 00449290 call 0x41d546                                 ; 地图重绘（表现层）
     * ```
     *
     * ★ 三条容易读错的地方，逐条钉住：
     *   1. **`0x64` 是半径，不是「攻击者」**；`heavy` 是**另一列**（`push 1`）。
     *      半径 100 ⇒ 方窗 `|dx|<=100 && |dy|<=100`，**不是核彈那种全图**。
     *   2. `flags = 0x26` ⇒ 与飛彈同掩码：**连范围里的人一起打**
     *      （0x20 置了位），故会 `0x40cd07` 毁车 + 挂位，随后 ④ 送医。
     *   3. 攻击者 `-1` ⇒ `damage_area` 里两条 `cmp esi,-1 / je` 都跳过，
     *      **全程不记任何敌意**（与飛彈/核彈不同）。
     *
     * ⚠️ 它**不是** `hospital` 效果：`hospital` 走的是「关 N 天、天数由
     *   `ctx.days ?? literal` 给」那一支，而本事件的文案里没有 `%d`
     *   （`literal` 为 null）⇒ 先前记成 `['hospital']` 时每次抽到都直接报
     *   `unimplemented`，一次爆炸都不打。天数 `3` 是 ④ 那个 `push 3` 的立即数，
     *   住在 `news-effects.ts` 的 `ALIEN_HOSPITAL_DAYS`，不进 `literal`。
     */
    | 'alienBlast'
    /**
     * 新聞 30/33/34：**随机挑一家企業，罚它 `companyAmount` 元**（`+0x28` 与 `+0x2c` 同时减），
     *   再按该企业对应的股票写 `newsFlag = 3`（利空 3 天）并**立刻重算当日价**。
     *   @source `fcn_0044b374`（30）/ `fcn_0044b53f`（33）/ `fcn_0044b57d`（34）：
     *   `sub dword [ebx+0x28], imm` / `sub dword [ebx+0x2c], imm` 之后
     *   `cmp byte [ebx+0x19], 0xc / jae 跳过` → `byte [stocks + (type)*36 + 7] = 3` → `call 0x429040(type+1)`
     */
    | 'companyPenalty'
    /**
     * 新聞 31：**海外投資獲利 20000** —— 两家同时 +20000，股票 `newsFlag = 0x30`（利多 3 天）。
     *   @source `fcn_0044b419`：`add dword [ebx+0x28], 0x4e20` / `…+0x2c` / `= 0x30`
     */
    | 'companyGain'
    /**
     * 新聞 32：**海外投資虧損 20000** —— 两家同时 −20000，股票 `newsFlag = 4`（利空 4 天）。
     *   @source `fcn_0044b4a8`：`sub dword [ebx+0x28], 0x4e20` / `…+0x2c` / `= 4`
     */
    | 'companyLoss'
    /**
     * 新聞 35：**獲利調高一倍** —— `+0x28 = x*2`、`+0x2c += x*2`，
     *   股票 `newsFlag = (x/10000) << 4`（利多，天数按获利规模算）并重算当日价。
     *   ★ 候选集**只收 `+0x28 > 10000` 的企業**；一家都没有时原版 `idiv` 除零崩，
     *   本引擎那一支什么都不做。
     *   @source `fcn_0044b5f5`（VA 0x0044b618 的过滤循环 / 0x0044b641 起的效果）
     */
    | 'companyProfitDouble'
    /**
     * 新聞 7：**公開拍賣公有土地一處** —— 挑一块（或一处設施）**无主**的，
     *   然后直接开一场拍卖。
     *
     * @source `fcn_00449735`：
     * ```asm
     * ; phase 1：收 0x19(owner)==0 的地块与設施，rand() % 数量 挑一个，画名字
     * ; phase 2（VA 0x00449896）：
     * push 1 / push target / push -1 / call _rich4_ui_auction_entry
     * ;      ↑第三参  ↑待拍实体  ↑第一参 = 卖家（-1 = 没有卖家席位）
     * ```
     *   起拍价与竞价循环就是既有的那套（`run_auction` VA 0x0043bde5 =
     *   本引擎的 `rules/auction.ts` + `pending: {kind:'auction'}`）。
     */
    | 'publicAuction'
    /**
     * 新聞 29「%s違法超貸 經營者%s坐牢５天」：**随机挑一家有主企業的經營者**，关他 **5** 天。
     *
     * @source `fcn_0044b25b`（281 B，`events_calls_table[29]`，VA 0x0044b25b）——
     *   **两阶段**，逐行如下：
     * ```asm
     * ; ── phase 0（`[esp+0xd4] == 0`，公告阶段）──
     * 0044b272  mov  eax, 1
     * 0044b279  mov  edx, dword ptr [0x498e7c]          ; 企業表基址
     * 0044b27f  mov  esi, dword ptr [0x498e90]          ; 企業家数
     * 0044b285  cmp  eax, esi / jg 0x44b29e             ; ★ for (eax = 1; eax <= esi; eax++)，1 基
     * 0044b289  imul ecx, eax, 0x34
     * 0044b28c  cmp  byte ptr [ecx + edx + 0x18], 0     ; ★ +0x18 = 企業 owner（1 基玩家号）
     * 0044b291  je   0x44b29b                           ;    0 = 无主 ⇒ 不收
     * 0044b293  mov  dword ptr [esp + ebx*4 + 0x80], eax ; 候选[ebx++] = 企業号
     * 0044b29e  call 0x456f2d                           ; ★ rand()，**恰好一次**
     * 0044b2a8  idiv ebx                                ; rand() % 候选数
     * 0044b2aa  imul ebx, [esp + edx*4 + 0x80], 0x34
     * 0044b2b2  add  ebx, [0x498e7c]                    ; 挑中的企業记录
     * 0044b2bb  mov  al, byte ptr [ebx + 0x18] / dec eax
     * 0044b2bf  imul eax, eax, 0x68
     * 0044b2c2  mov  ebp, dword ptr [eax + 0x496b68]     ; chairman = owner − 1 的**名字串指针**
     * 0044b2c8  push ebp / call 0x452946                 ; 名字先去空格（0x452946 = 去掉 0x20）
     * 0044b2e5  push 0x4657ba / lea eax, [ebx + 4] / call 0x457110
     *           ; sprintf(buf, "%s違法超貸\n經營者%s坐牢５天", 企業名(+4), 經營者名)
     * 0044b30e  call 0x44fabc                            ; draw_text(0x48c5ac+0xc, buf, 0x18, 0x136, 0)
     * 0044b31c  mov  dword ptr [0x48c59c], eax            ; ★ 把 chairman 留给 phase 1
     * ; ── phase 1（施加）──
     * 0044b343  call 0x41d476                            ; 移镜头（表现层）
     * 0044b351  push ebx / call 0x441210                 ; ★ 免罪(21) → 嫁禍(19) 二级判定
     * 0044b35a  cmp  eax, -1 / je 0x44b36a               ; 免罪卡 ⇒ 整条作废
     * 0044b35f  push 5 / push eax / call 0x43d593         ; send_to_prison(实际受害者, **5**)
     * ```
     *
     * ★ 三条容易读错的地方，逐条钉住：
     *   1. **两个 `%s` 的次序**：第一个是**企業名字**（`0x34` 的记录里 `+0/+2` 是 x/y、
     *      `+4` 才是名字串）、第二个才是**經營者（玩家）的名字**。⇒ 读出来是
     *      「ＸＸ公司違法超貸 經營者ＹＹ坐牢５天」。
     *   2. **候选只看 `+0x18 != 0`**（有主），**不看**經營者是否出局/被关着 ——
     *      后者只出现在**抽牌前置条件** `check_news` case 29 的
     *      `fcn_0040d73f(owner − 1)` 里（见 `events/news.ts` 的 `isNewsFeasible`）。
     *   3. 天数 `5` 是 phase 1 的立即数（`0044b35f push 5`）；文案里「５」是全角字、
     *      没有 `%d` ⇒ `literal` 保持 `null`（同 4/20/26 的既有先例）。
     *      常量住在 `news-effects.ts` 的 `NEWS_CHAIRMAN_PRISON_DAYS`。
     *
     * ★ 候选为 0 时原版 `idiv ebx`（ebx = 0）**除零崩**；本引擎那一支
     *   **什么都不做、也不掷随机数**（与 5/18/19/21/28/35 同一处理）。
     * ★ 这条**不再是** `prison`：泛用的 `prison` 分支关的是 `affected`（= 抽牌者），
     *   而它关的是**随机抽中的那家企業的經營者**，还带免罪/嫁禍二级判定。
     *   记成 `prison` 会让随机流少走一格、并且「关错人」。
     */
    | 'companyChairmanPrison'
      /**
     * 命運 6/7：**強迫出國觀光 / 被外星人綁架 N 天** —— 写 `days_disappearing`(`+0x33`)
     *   = `天數 | (原因 << 6)`（低 6 位是天數、高 2 位是原因：0 觀光 / 1 綁架）。
     *   @source `fcn_0044c5d8`(6) / `fcn_0044c6ed`(7) 的施加阶段尾部
     *   `fcn_0040d375(player, 天數, 原因)`（`rich4_player_utils.asm:189`：
     *   `al = 原因 << 6; ah = 天數; or ah, al`）。
     *   ★ 神明加持同坐牢那一支：档位 1 → 逃過此劫（整条作废），档位 2 → **天數翻倍**。
     */
    | 'disappear'
    /**
     * 命運 5：**今天是你生日，向每人收取一張卡片**。
     *
     * @source `fcn_0044c3b7`：
     * ```asm
     * for (i = 0; i < num_players; i++) {
     *   if (i == current) continue;
     *   if (player[i].who_plays == 0) continue;        ; 出局跳过
     *   if (player_card_num(i) == 0) continue;         ; 手上没牌跳过
     *   if (player[current].who_plays > 1) {           ; ★ 收卡的是**电脑**
     *     card = player_drop_random_card(i);           ; 0x441e77 随机一张
     *     receive_card(current, card);                 ; 0x4412e4
     *   } else {
     *     … 真人：原版弹**选牌界面** …
     *   }
     * }
     * ```
     * ★ 本引擎**没有**「从对方手牌里挑一张」的界面（`搶奪卡` 的真人路径同样未接），
     *   故真人当寿星时也走随机那一条 —— **登记为近似**，与 D-003「真人点击时机不复刻」
     *   同一条口径。
     */
    | 'birthdayCard'
)[];
  /** 提示文案在 exe 数据段中的虚拟地址 */
  textVa: number;
  /** 原版提示语（BIG5 解码后） */
  text: string;
  /**
   * 文案里 `%d` 处代入的**字面常量**（公告阶段 `mov [0x48c5b4], imm`）。
   *
   * ⚠️ 它的单位由文案决定，**不一定是天数**：
   * - 「坐牢%d天」「住院%d天」→ 天
   * - 「損失股票%d％」→ 百分比
   *
   * 故字段名不叫 days。为 null 表示该事件的 `%d` 来自 `factor × 物价指数`
   * 而非字面常量。
   */
  literal: number | null;
  /**
   * **写死的金额** —— 原版那条事件处理函数里直接 `add/sub dword [企業+0x28], imm`。
   *
   * ⚠️ 与 `factor` 的区别：`factor` 是「金额 = 物價指數 × factor」，这个**不乘物價**；
   *   与 `literal` 的区别：`literal` 是**文案里 `%d`** 的代入值，而这些文案里的数字
   *   是全角字写死的、没有 `%d`。只有企業那几条（30..34）用得上。
   */
  companyAmount?: number;
  /**
   * 施加阶段先问一次神明加持（`fcn_0044b896`），这是**问法**：
   *
   * | 值 | 压栈 | 读哪个字段 | 高值 → | 低值 → |
   * |---|---|---|---|---|
   * | `'reward'` | `(0,0)` | `+0x46` 財運 | 2 加倍 | 1 作废 |
   * | `'penalty'` | `(0,1)` | `+0x46` 財運 | 1 免付 | 2 加倍 |
   * | `'misfortune'` | `(1,1)` | `+0x48` 福運 | 1 逃過 | 2 加倍 |
   *
   * `null` / 缺省 = 该事件**不问**（原版整个 .text 里只有命运事件问，
   * 新闻事件一个都没问）。
   *
   * @source 每个命运函数施加阶段（`cmp dword [esp+0x94], 0 / jne`）开头的
   *   `push ? / push ? / call 0x44b896`，逐处读过；映射见
   *   `rules/blessing.ts` 的 `BlessingKind` 与 `fortune-effects.ts`。
   */
  blessing?: 'reward' | 'penalty' | 'misfortune';
}

/**
 * 去掉文案开头的 `#NNNN` 四位编号。
 * 该前缀是原版的格式码——显示函数 `0x0044fabc` 以 `cmp ah, 0x23`（'#'）
 * 识别并解析它，不是注释。
 */
export function stripEventCode(text: string): string {
  // ★ 收敛到唯一入口 `parseVoiceCode`（`@source 0x0044fabc` 的 `add ebx,5`：
  //   前缀恒为 5 个字符，无论那 4 位是不是数字）。
  //   先前这里用 `/^#\d{4}/` 正则在"不足 4 位"时不剥、在"多于 4 位"时行为也不同，
  //   与原版"永远跳过 5 个字符"不一致。
  return stripVoiceCode(text);
}

/** 新聞事件，36 项 */
export const NEWS_EVENTS: readonly EventEntry[] = [
  { id: 0, va: 0x00448eca, factor: null, effects: ['releasePrison'], textVa: 0x465424, text: "#0149獄中囚犯無罪開釋", literal: null },
  { id: 1, va: 0x00448f45, factor: null, effects: ['extendPrison'], textVa: 0x46543a, text: "#0150獄中囚犯延長刑期%d天", literal: 3 },
  { id: 2, va: 0x00449006, factor: null, effects: ['releaseHospital'], textVa: 0x465454, text: "#0151住院中病患提前出院", literal: null },
  { id: 3, va: 0x00449081, factor: null, effects: ['extendHospital'], textVa: 0x46546c, text: "#0152住院中病患延長住院%d天", literal: 3 },
  // ★ 订正（2026-09 本轮）：先前记成 `['hospital']` —— 那是**错的**。
  //   `@source fcn_0044913d`：它不打「关 N 天」那条路，而是
  //   `damage_area(0x64, 0x26, 1, -1)` 打一发**重击**（半径仍是 100），
  //   再把被炸到的人送医 3 天（`push 3 / call 0x43ec3f`，VA 0x00449282）。
  //   `literal` 保持 null 是对的：文案「外星人攻打地球」里没有 `%d`，
  //   原版也没有写 `[0x48c5b4]`。见 `effects` 联合里 `alienBlast` 的长注释。
  { id: 4, va: 0x0044913d, factor: null, effects: ['alienBlast'], textVa: 0x465488, text: "#0153外星人攻打地球", literal: null },
  { id: 5, va: 0x004492a0, factor: null, effects: ['clearOwnerBuilt'], textVa: 0x46549c, text: "#0154外星怪獸襲擊%s\n摧毀建築一棟", literal: null },
  { id: 6, va: 0x004494e0, factor: null, effects: ['raiseLandPrice'], textVa: 0x4654bd, text: "#0155%s公告地價調漲３０％", literal: null },
  { id: 7, va: 0x00449735, factor: null, effects: ['publicAuction'], textVa: 0x4654e4, text: "#0156公開拍賣%s\n公有土地一處", literal: null },
  { id: 8, va: 0x004498b3, factor: 10000, effects: ['give'], textVa: 0x465501, text: "#0157公開表揚第一大地主\n%s獲得%d元獎勵", literal: null },
  { id: 9, va: 0x00449a8a, factor: 5000, effects: ['give'], textVa: 0x465528, text: "#0158公開補助土地最少者\n%s獲得%d元補助", literal: null },
  { id: 10, va: 0x00449b9c, factor: 10000, effects: ['give'], textVa: 0x46554f, text: "#0159公開表揚股市第一大戶\n%s獲得%d元獎勵", literal: null },
  { id: 11, va: 0x00449c7c, factor: null, effects: ['pay'], textVa: 0x465578, text: "#0160所有人繳交所得稅５％", literal: null },
  { id: 12, va: 0x00449de6, factor: null, effects: ['pay'], textVa: 0x4655ac, text: "#0161所有人繳交地價稅５％", literal: null },
  { id: 13, va: 0x0044a029, factor: null, effects: ['pay'], textVa: 0x4655d4, text: "#0162所有人繳交證交稅５％", literal: null },
  { id: 14, va: 0x0044a220, factor: null, effects: ['lowerLandPrice'], textVa: 0x4655fc, text: "#0163%s房屋鬧鬼\n地價下跌３０％", literal: null },
  { id: 15, va: 0x0044a453, factor: null, effects: ['demolishBuiltLand'], textVa: 0x465624, text: "#0164%s一處民宅瓦斯爆炸\n房屋失火", literal: null },
  { id: 16, va: 0x0044a5d6, factor: null, effects: ['stopPedestrians'], textVa: 0x465645, text: "#0165豪雨特報\n行人休息一回合", literal: null },
  { id: 17, va: 0x0044a657, factor: null, effects: ['stopVehicles'], textVa: 0x465662, text: "#0166交通阻塞\n汽車停止一回合", literal: null },
  { id: 18, va: 0x0044a6e0, factor: null, effects: ['demolishSameName'], textVa: 0x46567f, text: "#0167%s強烈地震房屋倒塌", literal: null },
  { id: 19, va: 0x0044a91e, factor: null, effects: ['clearOwnerAny'], textVa: 0x465697, text: "#0168%s山洪爆發土地流失", literal: null },
  { id: 20, va: 0x0044ab2c, factor: null, effects: ['typhoonBlast'], textVa: 0x4656af, text: "#0169超級颱風侵襲%s\n多處房屋受損", literal: null },
  { id: 21, va: 0x0044ac99, factor: null, effects: ['demolishAny'], textVa: 0x4656d0, text: "#0170龍捲風侵襲%s\n摧毀房屋一棟", literal: null },
  // @source 0x0044aeb6 `mov bh, 0xf` → 所有在场玩家 +0x3c = 15（0x0044aed2）
  { id: 22, va: 0x0044ae89, factor: null, effects: ['loanFreeze'], textVa: 0x4656ef, text: "#0171銀行擠兌停止放款１５天", literal: null },
  { id: 23, va: 0x0044aedb, factor: null, effects: ['give'], textVa: 0x46570b, text: "#0172銀行加發１０％儲金紅利", literal: null },
  { id: 24, va: 0x0044b00a, factor: null, effects: ['marketBearish'], textVa: 0x46573c, text: "#0173股市低迷不振重挫崩盤", literal: null },
  { id: 25, va: 0x0044b055, factor: null, effects: ['marketBullish'], textVa: 0x465756, text: "#0174股市氣勢如虹全面上漲", literal: null },
  { id: 26, va: 0x0044b0a0, factor: null, effects: ['marketClose'], textVa: 0x465770, text: "#0175股市暫停交易１０天", literal: null },
  { id: 27, va: 0x0044b0d1, factor: null, effects: ['suspendStock'], textVa: 0x465788, text: "#0176%s股票暫停交易１０天", literal: null },
  { id: 28, va: 0x0044b1a3, factor: null, effects: ['resumeStock'], textVa: 0x4657a2, text: "#0177%s股票恢復上市交易", literal: null },
  // ★★ 订正（2026-09 本轮）：先前记成 `['prison']` + `literal: null`，两条叠起来
  //   正好是**死路** —— `reduce.ts` 的 `drawAndApplyNews` 不给 `days`，泛用 `prison`
  //   分支 `days = ctx.days ?? entry.literal` 得 `null` ⇒ 每次都报 `unimplemented`，
  //   **一次都不关人**（连随机数也不掷）。而它真正做的事是「随机挑一家有主企業的
  //   經營者、关 5 天、中途还要过免罪(21)→嫁禍(19)」，走 `companyChairmanPrison`。
  //   `literal` 保持 `null` 是**对的**（文案里的「５」是全角字、没有 `%d`）。
  { id: 29, va: 0x0044b25b, factor: null, effects: ['companyChairmanPrison'], textVa: 0x4657ba, text: "#0178%s違法超貸\n經營者%s坐牢５天", literal: null },
  { id: 30, va: 0x0044b374, factor: null, effects: ['companyPenalty'], companyAmount: 10000, textVa: 0x4657db, text: "#0179%s工廠排放污水\n罰款10000元", literal: null },
  { id: 31, va: 0x0044b419, factor: null, effects: ['companyGain'], companyAmount: 20000, textVa: 0x4657fb, text: "#0180%s海外投資\n獲利20000元", literal: null },
  { id: 32, va: 0x0044b4a8, factor: null, effects: ['companyLoss'], companyAmount: 20000, textVa: 0x465817, text: "#0181%s海外投資\n虧損20000元", literal: null },
  { id: 33, va: 0x0044b53f, factor: null, effects: ['companyPenalty'], companyAmount: 10000, textVa: 0x465833, text: "#0182%s違規開發山坡地\n罰款10000元", literal: null },
  { id: 34, va: 0x0044b57d, factor: null, effects: ['companyPenalty'], companyAmount: 5000, textVa: 0x465855, text: "#0183%s製造噪音公害\n罰款5000元", literal: null },
  { id: 35, va: 0x0044b5f5, factor: null, effects: ['companyProfitDouble'], textVa: 0x465874, text: "#0184%s獲利調高一倍", literal: null },
];

/** 命運事件，37 项 */
export const FORTUNE_EVENTS: readonly EventEntry[] = [
  { id: 0, va: 0x0044be16, factor: null, effects: ['give'], textVa: 0x465915, text: "#0185強制拆除房屋一棟", literal: null },
  { id: 1, va: 0x0044bfb1, factor: null, effects: ['give'], textVa: 0x46592b, text: "#0186強制徵收土地一處", literal: null },
  { id: 2, va: 0x0044c0e8, factor: 10000, effects: ['loan'], textVa: 0x465941, text: "#0187人頭被盜用冒貸%d元", literal: null, blessing: 'penalty' },
  { id: 3, va: 0x0044c229, factor: null, effects: ['bankBan'], textVa: 0x465959, text: "#0188支票跳票\n銀行拒絕往來一個月", literal: null, blessing: 'penalty' },
  // ★★ 2026-09-22（第十份试玩回报）：`literal` 先前是 null ⇒ 文案里的 `%d` 被渲染成「？」
  //   （`event-box-screen.ts` 的 `eventBoxDescription`：literal→factor×物价→都没有就 '？'）。
  //   原版这个 `%d` 是**硬编码 10**（`@source 0x0044c2d4 mov ecx,0xa`；
  //   `rich4-spec/docs/systems/fortune.md:490-513`，`bank.md:1030-1032` 同）。
  //   ⚠️ **不能改用 `factor`** —— 那会变成 `10 × 物價指數`，与原版不符。
  { id: 4, va: 0x0044c2c2, factor: null, effects: ['pay'], textVa: 0x46597a, text: "#0189侵入銀行電腦\n挪用其他人存款%d％", literal: 10 },
  { id: 5, va: 0x0044c3b7, factor: null, effects: ['birthdayCard'], textVa: 0x4659a4, text: "#0190今天是你生日\n向每人收取一張卡片", literal: null },
  { id: 6, va: 0x0044c5d8, factor: null, effects: ['disappear'], textVa: 0x4659d8, text: "#0191強迫出國觀光%d天", literal: 3, blessing: 'misfortune' },
  { id: 7, va: 0x0044c6ed, factor: null, effects: ['disappear'], textVa: 0x4659ee, text: "#0192被外星人綁架%d天", literal: 3, blessing: 'misfortune' },
  // ⚠️ 下面五条（8/9 卖股票、10/11 丢车、32 变卖卡片道具）的 `effects` 是**空的**：
  //   命运这一支有一部分**按事件号分派**（见 `events/fortune-effects.ts` 的
  //   `FORTUNE_SPECIAL_IDS`），不是靠这张表的效果位。**空 ≠ 没实现**。
  { id: 8, va: 0x0044c7ef, factor: null, effects: [], textVa: 0x465a04, text: "#0193股票違約交割損失股票%d％", literal: 10, blessing: 'penalty' },
  { id: 9, va: 0x0044c91f, factor: null, effects: [], textVa: 0x465a28, text: "#0194變賣所有股票求現", literal: null, blessing: 'penalty' },
  { id: 10, va: 0x0044ca46, factor: null, effects: [], textVa: 0x465a3e, text: "#0195機車被偷遺失", literal: null, blessing: 'misfortune' },
  { id: 11, va: 0x0044cb53, factor: null, effects: [], textVa: 0x465a50, text: "#0196汽車撞電線桿全毀", literal: null, blessing: 'misfortune' },
  { id: 12, va: 0x0044cc53, factor: null, effects: ['hospital'], textVa: 0x465a66, text: "#0197掉進水溝就醫%d天", literal: 3, blessing: 'misfortune' },
  { id: 13, va: 0x0044cd6c, factor: null, effects: ['hospital'], textVa: 0x465a7c, text: "#0198騎機車摔傷住院%d天", literal: 3 },
  { id: 14, va: 0x0044cd99, factor: 3000, effects: ['pay'], textVa: 0x465a94, text: "#0199行人闖越馬路罰款%d元", literal: null, blessing: 'penalty' },
  { id: 15, va: 0x0044cf1e, factor: 3000, effects: ['pay'], textVa: 0x465aae, text: "#0200騎機車未戴安全帽\n罰款%d元", literal: null, blessing: 'penalty' },
  { id: 16, va: 0x0044d06d, factor: 3000, effects: ['pay'], textVa: 0x465acd, text: "#0201汽車超速罰款%d元", literal: null },
  { id: 17, va: 0x0044d0d6, factor: 6000, effects: ['pay'], textVa: 0x465ae3, text: "#0202請所有人吃大餐\n花費%d元", literal: null, blessing: 'penalty' },
  { id: 18, va: 0x0044d1a5, factor: 600, effects: ['pay'], textVa: 0x465b00, text: "#0203亂丟垃圾罰款%d元", literal: null, blessing: 'penalty' },
  { id: 19, va: 0x0044d1e0, factor: 1500, effects: ['pay'], textVa: 0x465b16, text: "#0204你家小狗亂大小便\n罰款%d元", literal: null, blessing: 'penalty' },
  { id: 20, va: 0x0044d224, factor: 1000, effects: ['give'], textVa: 0x465b35, text: "#0205在路邊撿到%d元", literal: null, blessing: 'reward' },
  { id: 21, va: 0x0044d33b, factor: 2000, effects: ['give'], textVa: 0x465b49, text: "#0206在路邊撿到%d元", literal: null, blessing: 'reward' },
  { id: 22, va: 0x0044d3db, factor: 3000, effects: ['give'], textVa: 0x465b5d, text: "#0207在路邊撿到%d元", literal: null, blessing: 'reward' },
  { id: 23, va: 0x0044d41e, factor: 1000, effects: ['pay'], textVa: 0x465b71, text: "#0208遺失錢包損失%d元", literal: null, blessing: 'penalty' },
  { id: 24, va: 0x0044d462, factor: 2000, effects: ['pay'], textVa: 0x465b87, text: "#0209遺失錢包損失%d元", literal: null, blessing: 'penalty' },
  { id: 25, va: 0x0044d4a6, factor: 10000, effects: ['give'], textVa: 0x465b9d, text: "#0210意外獲得遺產%d元", literal: null, blessing: 'reward' },
  { id: 26, va: 0x0044d4e7, factor: 8000, effects: ['pay'], textVa: 0x465bb3, text: "#0211被倒會損失%d元", literal: null, blessing: 'penalty' },
  { id: 27, va: 0x0044d52b, factor: 4000, effects: ['give'], textVa: 0x465bc7, text: "#0212發票中獎%d元", literal: null, blessing: 'reward' },
  { id: 28, va: 0x0044d56e, factor: 6000, effects: ['give'], textVa: 0x465bd9, text: "#0213發票中獎%d元", literal: null, blessing: 'reward' },
  { id: 29, va: 0x0044d5b1, factor: 8000, effects: ['give'], textVa: 0x465beb, text: "#0214發票中獎%d元", literal: null, blessing: 'reward' },
  { id: 30, va: 0x0044d5f4, factor: 5000, effects: ['pay'], textVa: 0x465bfd, text: "#0215付保險金%d元", literal: null, blessing: 'penalty' },
  { id: 31, va: 0x0044d636, factor: 5000, effects: ['give'], textVa: 0x465c0f, text: "#0216領取保險金%d元", literal: null, blessing: 'reward' },
  { id: 32, va: 0x0044d677, factor: null, effects: [], textVa: 0x465c23, text: "#0217變賣所有卡片道具", literal: null, blessing: 'misfortune' },
  { id: 33, va: 0x0044d783, factor: null, effects: ['prison'], textVa: 0x465c39, text: "#0218酒醉大鬧警局坐牢%d天", literal: 3, blessing: 'misfortune' },
  { id: 34, va: 0x0044d8cf, factor: null, effects: ['prison'], textVa: 0x465c53, text: "#0219防礙風化坐牢%d天", literal: 5 },
  { id: 35, va: 0x0044d8fd, factor: null, effects: ['prison'], textVa: 0x465c69, text: "#0220走私毒品坐牢%d天", literal: 7 },
  { id: 36, va: 0x0044d92b, factor: null, effects: ['prison'], textVa: 0x465c7f, text: "#0221販賣大補帖坐牢%d天", literal: 9 },
];

export function newsEvent(id: number): EventEntry | undefined {
  return NEWS_EVENTS.find((e) => e.id === id);
}

export function fortuneEvent(id: number): EventEntry | undefined {
  return FORTUNE_EVENTS.find((e) => e.id === id);
}

/** 金额 = 物价指数 × factor */
export function eventAmount(entry: EventEntry, priceIndex: number): number {
  return entry.factor === null ? 0 : entry.factor * priceIndex;
}
