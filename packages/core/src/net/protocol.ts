/*
 * 联机协议
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 设计根基：引擎是**确定性**的（C-DET-*），且所有变更都表达为
 *   action（C-ARC-4）。因此联机**不需要同步状态**——只要所有人
 *   按同样的顺序重放同一串 action，就必然得到同样的状态。
 *
 *   服务器只做一件事：**给 action 定序**。它不算规则、不判胜负，
 *   甚至不需要持有完整的游戏状态。
 *
 * ★ C-LEG-5：仅限**各自拥有原版**的私人小圈子对战，
 *   不设公开服务器、不分发素材。
 */

import type { Action } from '../state/actions.ts';

/**
 * 协议版本。双方不一致时直接拒绝连接，避免在半路才发现规则对不上。
 *
 * ★ Q-NET-1 加的 `resync`/`replay` **不动版本号**：这是纯增量消息，
 *   老客户端不认识 `replay` 会按 `default` 忽略（退回「只喊一声」的旧行为），
 *   老服务器不认识 `resync` 也只是不答——规则语义没变，不构成「规则对不上」。
 *   真改了 action 语义或指纹算法时才该 +1。
 *
 * ★★ W-73 **+1（1 → 2）**：`join` 多了一个**必填**的 `clientId`，而且
 *   「认回原座位」的判据从**名字**改成了它 —— 老客户端不带这个字段，
 *   服务器会把它当成非法 `clientId` 直接拒绝。**这是语义变更，必须 +1**：
 *   不 +1 的话，两个朋友起同一个名字就会互相串座（W-73 §3 要修的那件事），
 *   而版本号相同意味着双方都以为对方是「同一版」。
 *
 * ★★ W-74 **再 +1（2 → 3）**：多了 `awaiting` / `alive` / `resume` 三条客户端消息
 *   与 `clock` 一条服务器消息，而它们**改变了对局的推进方式** ——
 *   同一桌里只要有一个客户端不发 `awaiting`，他那一回合到点就会被电脑接走。
 *   老客户端不发 `awaiting` ⇒ 走 45 秒兜底 ⇒ 60+45 秒后**他的回合会被电脑打掉**。
 *   这不是「纯增量、语义没变」（Q-NET-1 那种），必须 +1 把老客户端挡在门外。
 *   任务书 W-74 末尾也明写「与 W-73 分两次加，各自的 PR 各自加」。
 */
/**
 * ★ 2026-09-23（第十一份試玩回報 #1：大廳設置）→ **4**。
 *
 * 為什麼必須 +1：`start` 消息多带了 `options`（總人數/起始資金/載具/地產期限/時間/勝利條件），
 * 而老客戶端不認識它們 ⇒ 會**靜默吃下一局規則不同的對局**（分紅、勝負條件、初始資金都不同）。
 * 這與 W-73（門廳）/ W-74（回合计时）两次 +1 同一性质。
 */
/**
 * ★ 2026-09-23（需求方：「改成單人模式 / 在線聯機兩個入口、在線聯機展示房間列表」）→ **5**。
 *
 * 為什麼 +1：多了 `listRooms` / `rooms` 一對消息，`join` 多了 `mode`（建房 / 加入要求房間
 * 「不存在 / 存在」）。老客戶端沒有房間列表、只會拿房間碼硬闖 —— 在新服務器上它會把一個
 * **已經解散**的房間碼重新建出來、自己當房主，朋友們在列表裡看到的就是一間莫名其妙的空房。
 * 版本號一變，老頁面（瀏覽器裡沒刷新的那個分頁）進門就拿到一句清楚的「協議版本不符」。
 */
/**
 * ★ 2026-09-23（需求方批准的「聯機存檔」設計）→ **6**。
 *
 * 為什麼 +1：`start` / `replay` 可能帶 `snapshot`（從存檔繼續的局，起點是**存下來的局面**
 * 而不是 `newGame`）—— 老客戶端不認識它，會拿種子 `newGame` 出一局**完全不同**的棋盤，
 * 第一條校驗和就失步。另有 `listSaves`/`saves`、`claim`/`unclaim`、`save`/`saved`，
 * `join` 多了 `fromSave` / `claimSeat`，`joined.seat` 可以是 `-1`（在房裡、還沒入座）。
 */
/**
 * ★ 2026-09-24（第十八份試玩回報一批）→ **7**。
 *
 * 為什麼 +1：這一批改了**核心規則與局面形狀**，新老客戶端對同一串 action 會算出不同局面：
 * 商店貨架「買過的留在原位標 sold」（`buyCard`/`buyTool` 帶 `row`）、玩家 2..N **延後落地**
 * （`landingWhoPlays`，第一回合才抽出生格）、每位玩家回合開始重算可成交量、開局走一次行情、
 * 拍賣的出價資格與結果提示、放置禁令擴到「格上有人／物」。老頁面（沒刷新的分頁）若照舊連進來，
 * 第一次落地或第一次購物就失步 —— 版本號一變，它進門就拿到清楚的「協議版本不符」。
 */
/**
 * ★ 2026-09-24（gap-audit #7「联机用卡/道具：旁观端看不到亮牌，或看得晚」）→ **8**。
 *
 * 為什麼 +1：多了一對**純演出**消息 `present`（客户端 → 服务器 → 其餘各端）：真人在卡片欄選定一張卡的那一刻
 * 亮牌（`_rich4_ui_use_card_entry` `0x00441cbc call 0x441f73`，在選目標**之前**）、卡片函數返回 0 的失敗
 * （`0x00441cd9` 失敗音 3 → `0x00441ce3` 卡片欄重開）、選定道具時先說的那一句（`0x00446bcc` 等）與選格取消
 * （`0x4466b8` 音效 4）。老客戶端不認識它，照舊只在 `useCard` 到達時亮牌 —— 規則沒變，但同一桌裡新老頁面
 * 的演出時序不同、而且老頁面不會**發**這條 ⇒ 新頁面上看它用卡又退回「亮得晚」。與 v5 同一個理由：
 * 版本號一變，沒刷新的舊分頁進門就拿到一句清楚的「協議版本不符」。
 * ⚠️ `present` **不進** action 日誌、不進 `replay`、不進 `stateFingerprint` —— 它不改局面。
 */
/**
 * ★ 2026-09-24（第二十六份試玩回報「约翰乔的汽车哪里来的」，pt26-car）→ **9**。
 *
 * 為什麼 +1：**核心規則**改了 —— 電腦（與託管）進百貨公司不再掛 `pending{shop}` 等 AI 答，而是按原版那一支
 * （`0x0042ea2b cmp byte [player+0x15], 1 / jne 0x42ed8d`）在 `settle` 裡當場買賣完就走（`places/ai-shop.ts`），
 * 而且**不抽貨架**（少耗隨機數）。老客戶端對同一條 `settle` 會算出「店還開著」的局面，下一條 `endTurn` 起就失步。
 */
/**
 * ★ 2026-09-25（pt27 回报「忍太郎怎么一下就买了3000股保险公司？」，pt27-stock）→ **10**。
 *
 * 為什麼 +1：電腦踩上市企業的認購股數改照原版（`0x0041d267 push esi / call 0x41d839`：上限
 * `min(1000, 現金÷單價, 餘量)`、再扣 trunc(開局×0.30)×物價 的安全墊），而且 reducer 的 `buyShares`
 * 現在拒收**超過 `pending.max`** 的股數（先前只比餘量）。老客戶端照舊收 `buyShares 3000` 的局面、
 * 新的拒收 ⇒ 同一串 action 算出不同局面；版本號一變，沒刷新的舊分頁進門就拿到「協議版本不符」。
 */
/**
 * ★ 2026-09-25（**六区出处审计**：ai-move / ai-econ / cards / econ / events / loop，协调方一次性 +1）→ **11**。
 *
 * 為什麼 +1：這次審計把六個區的規則逐條重讀 `rich4.exe` 後按原版改，**幾乎每一項修復都改變對局狀態
 * 或全局隨機數的消耗次序** —— 新老客戶端對同一串 action 會算出不同局面（`rngState` 進指紋，故一旦
 * 某一步少擲 / 多擲一次 `rand()`，之後每一步都不同）。老頁面照舊連進來，會在第一次分歧的 action 上失步；
 * 版本號一變，它進門就拿到清楚的「協議版本不符」。六大類：
 *
 * 1. **隨機流次序（最大的一類）**：台詞階梯那 13 處 `rand()` 從「客戶端按狀態哈希擲硬幣、不推進 RNG」
 *    改成 **core 在 exe 擲的那一刻擲**（`rules/speech-rand.ts` 的 `SPEECH_SITE` / `NEWS_OWNER_SITE`，
 *    原值記進純表現瞬態 `lastSpeechRolls`）；神明老虎機自動轉 4 輪、新聞開拍接著同一條流、稅類 / 神明 /
 *    施捨破產的拍賣、首次關押台詞、小偷禮物台詞、惡犬咬惡人後搭檔登場、新聞 4 物件放回（events）；
 *    電腦買股 / 賣股挪進 reducer 按原版擲全局 `rand()`、買卡候選與選股排名照 Watcom `qsort` 的真實次序
 *    （ai-econ）；嫁禍卡無人可嫁時照樣擲門檻數、漲價卡 / 拆除卡的清單次序（ai-move）；天使卡打 0 級設施
 *    的電腦支新增一次 `rand()`（cards）。
 * 2. **局面形狀多了字段**：`pending{auction}.resumePhase`（拍賣卡在掷骰前打出 ⇒ 落槌後回原相位，不再
 *    一律 `turnEnd`；econ）、`pending{auction}.keepOwnerOnPass`（魔法屋流拍不清地主，events）、
 *    `pending.birthdayCard` 的 `receiver` / `magicResume`（魔法屋抽命運三張遇真人壽星續演，events）、
 *    `SpecialActor.home`（老家 +11，存檔讀寫，events）。
 * 3. **校驗和口徑變了**：`stateFingerprint` 納入 `toolStock` / `cardAmount`（`5290899`，cards）——
 *    同一個局面在舊版算出的校驗和與新版不同，這一條本身就必須全端同版。
 * 4. **新增 action / 消息**：`stockScreen`（真人關股市屏 ⇒ 強制收回特別融資，econ）、`noticeBoard` 的
 *    `open` / `close`（開窗先撤失效掛牌、關窗後收回特別融資，ai-econ）。
 * 5. **工具 / 道具的請求語義變了**：傳送機改成原版兩段拾取（先選來源：地塊 / 設施 / 玩家 / 惡人 / 物件，
 *    再選目標），`useTool` 帶的節點 / 值改成原版的精靈碼；新增道具第 14 項「下車」（`traffic → 0`、
 *    骰子 → 1）（cards）。同一條 action 新老客戶端會解釋成不同的搬遷。
 * 6. **純規則修正（單機 / 聯機同一個 reducer）**：過路費記敵意、設施收費與旅館、被嫁禍 / 死神點到的人
 *    出獄住店、破產按在場**真人**數判終局、破產清別人對他的敵意、分紅、拍賣首拍席位與加價檔位、
 *    建設公司真人選地窗、樂透投注屏、龜行只走一步、保險 / 研究所倒數挪回 `0x41c84f`、時光機快照時機、
 *    真人開局資金按角色減半、跨月重擺禮物 / 寶箱、工程車到期、`startTurn` 相位閘、伺服器拒收客戶端
 *    自帶點數的 `rollDice`。逐條出處見 `docs/audit/provenance-*.md` 六份台賬（每行都附 exe VA 與提交號）。
 *
 * ⚠️ 這次 +1 是協調方對**整批審計**一次性升的；六個區的分支各自都沒有動版本號。
 */
export const PROTOCOL_VERSION = 11;
// ★ v6 同一次 +1 裡還有：`start` / `replay` 帶 `startDate`（服務器的今天）—— 聯機開局日期與單機同一個規則。
//   老客戶端不認識它，會照 core 缺省日期（2010-01-01）開局 ⇒ 日期不同，第一次過日子就失步。

// ============================================================
//  客户端 → 服务器
// ============================================================

export type ClientMessage =
  /** 加入房间 */
  | {
      t: 'join';
      version: number;
      room: string;
      /** 昵称，**只用于显示**；断线重连**不再**靠它认座位（见 `clientId`） */
      name: string;
      /**
       * ★ W-73：身份令牌 —— 断线重连**认回原座位**的唯一判据。
       *
       * 为什么不能再用名字：两个朋友起同一个名字会互相串座（任务书 W-73 §3）。
       * 名字重复现在是**允许**的（显示时也不去重），座位只认这 32 位十六进制。
       * 客户端首次生成并存 `localStorage['rich4.clientId']`。
       *
       * ⚠️ 它**不进** `SeatInfo`：不广播给别人（那是本机自己的身份，别人用不上）。
       */
      clientId: string;
      /** 重连时：本地已施加到第几号 action（含），服务器从下一号补发；不带 = 全量补发 */
      since?: number;
      /**
       * ★ 房間列表（v5）：這次 `join` 的意圖。
       *
       * · `'create'` —— 「建立房間」：房間碼**必須還沒人用**（撞上了回 error，客戶端換一個碼再建）；
       * · `'join'`   —— 從列表點「加入 / 重新連線」：房間**必須還在**（列表與點擊之間它可能剛被回收，
       *   這時若照舊「沒有就建一間」，點的人會莫名其妙變成一間空房的房主）；
       * · 不帶 —— 舊語義（有就進、沒有就建）：`?room=` 舊連結與 `tools/net-e2e.js` 走這條。
       */
      mode?: JoinMode;
      /**
       * ★ 聯機存檔（v6）：與 `mode: 'create'` 一起用 —— 這間新房**從這份存檔繼續**。
       *   座位、地圖、開局設定都照存檔（鎖定），起點是存檔裡的局面。
       */
      fromSave?: string;
      /**
       * ★ 聯機存檔（v6）：與 `mode: 'join'` 一起用 —— 已經開局的存檔房裡，**認領**一個
       *   沒人坐、由電腦代打的存檔座位（房間列表上的「認領座位」）。
       */
      claimSeat?: number;
    }
  /**
   * ★ 房間列表（v5）：**訂閱**房間列表。
   *
   * 服務器立刻回一條 `rooms`，之後列表每變一次（有人進出、開局、終局、回收）就再推一條，
   * 直到這條連接 `join` 了某個房間或斷開。
   *
   * `clientId` 只用來算每一行的 `rejoin`（「你在這桌有一個斷線中的座位」）——
   * 服務器**不回**任何人的 `clientId`（見 `RoomSummary`）。
   */
  | { t: 'listRooms'; version: number; clientId: string }
  /**
   * ★ 聯機存檔（v6）：要一份服務器上的存檔列表（一次性，不訂閱）。
   * `clientId` 只用來標出「哪個座位是你」（`SaveSummary.seats[].mine`）—— 同樣**不回**任何人的 `clientId`。
   */
  | { t: 'listSaves'; version: number; clientId: string }
  /**
   * ★ 聯機存檔（v6）：存檔房開局前，「這是我」—— 認領一個還沒人坐的存檔真人座位。
   * 只有**還沒入座**的連接能發（`joined.seat === -1`）。
   */
  | { t: 'claim'; seat: number }
  /**
   * ★ 聯機存檔（v6）：存檔房開局前，把一個座位**放回**「沒人坐」。
   * 房主可以放任何人的（認錯人了），其他人只能放自己的。被放掉的連接退回「還沒入座」。
   */
  | { t: 'unclaim'; seat: number }
  /** ★ 聯機存檔（v6）：房主手動存檔（開局後任何時候）。成功回 `saved`，失敗回 `error` */
  | { t: 'save'; name: string }
  /**
   * ★ 聯機存檔（v6）：刪一份存檔 —— 只有**存檔裡坐過**的人（按 `clientId`）能刪。
   * 服務器回一份新的 `saves`（刪不了另外先回 `error`）。
   */
  | { t: 'deleteSave'; version: number; clientId: string; id: string }
  /**
   * ★ 房主交接（v6）：大廳裡主動「離開」。開局前 ⇒ 當場讓出座位（一般房間後面的人往前挪、
   * 各收到新的 `joined`；存檔房那一座放回「沒人坐」）；走的是房主 ⇒ 房主交給下一位在線真人，
   * 一個都沒有就關房。開局後等同斷線（照舊走掉線代打）。
   */
  | { t: 'leave' }
  /** 房主（0 号座）开局：空座由电脑补位，服务器广播 start */
  | { t: 'start' }
  /**
   * 提交一个意图。
   *
   * ⚠️ 叫「意图」而不是「动作」是有意的：客户端说的不算，
   * 服务器定序之后广播回来的才作数。客户端**不得**先本地施加再等确认——
   * 那样一旦被拒就要回滚，而确定性引擎最不该引入的就是回滚。
   */
  | { t: 'intent'; action: Action }
  /**
   * 状态校验和。
   *
   * 每回合上报一次，服务器比对。不一致说明有人的实现漂了
   * （或被改过），立刻能发现而不是等到对局后期才表现为诡异分歧。
   */
  | { t: 'checksum'; seq: number; hash: string }
  /**
   * 请求**全量重放** —— 失步自愈（Q-NET-1）。
   *
   * ★ 只对**已经 `join` 过的那条连接**有意义：服务器只认 `join` 时绑在
   *   这条连接上的座位，消息里**不带座位也不带名字**——故拿不到别人的重放。
   *   权限上也不多给任何东西：这条连接本来就收得到每一条广播 action。
   */
  | { t: 'resync' }
  /**
   * ★ 大厅设置（Q-NET-2）：改**自己**座位的角色。
   *
   * ⚠️ 服务器**必须**校验，不能信客户端：
   *   · 没进房、或**已经开局** → 拒（角色在 `newGame` 里就固定了，
   *     开局后再改会和服务器镜像、其他客户端的局面都不一致）；
   *   · `character` 不是 `0..LOBBY_CHARACTER_COUNT-1` 的整数 → 拒；
   *   · 该角色已被**别的**座位选了 → 拒（同一房内角色唯一，不能撞车）。
   *
   * ★ 消息里**没有 `seat` 字段**是有意的：改的是哪个座位由服务器从**连接**
   *   上认，客户端连「改别人的角色」这件事都表达不出来 —— 权限不靠客户端自觉。
   *   服务器接受后广播 `{t:'room', room}`，所有人（含发起者）都照广播更新。
   */
  | { t: 'setCharacter'; character: number }
  /**
   * ★ 大厅设置（Q-NET-2）：换房间地图。
   *
   * ⚠️ 服务器**必须**校验：只有房主（0 号座）、且**未开局**才允许，
   *   并且服务器自己手上得真有这张地图的数据；任何一条不满足都拒。
   *   开局时用这份设置（而不是各客户端自己的本地设置）`newGame`。
   */
  | { t: 'setMap'; globalMapId: number }
  /**
   * ★★ 大厅设置（第十一份試玩回報 #1）：开局选项 —— 房间人数 + 单机那五项。
   *
   * 需求方 2026-09-23：「房间人数是指总人数，比如设置总人数4，然后只有2个真人玩家，
   * 点击开局后就自动补2个NPC玩家凑齐4个人数开局」⇒ `seatCount` 是**总人数**（2..4），
   * 不足的座位开局时补电脑 —— 与单机开局设定屏的语义一致。
   *
   * ⚠️ 与 `setCharacter`/`setMap` 同一套权限：只有房主（0 号座）、且**未开局**才允许；
   *   `Partial` 只带要改的那几项（服务器逐项校验，任何一项不合法就整条拒）。
   */
  | { t: 'setOptions'; options: Partial<LobbyOptions> }
  /**
   * ★ W-74：**本机座位已经演完动画、停在等输入上了**。
   *
   * 为什么需要这一条：各客户端要把掷骰、走子、影片那一串演完，玩家才点得了 ——
   * 服务器**不能**从广播那一刻就开始数 60 秒（那会把演出时间也算进玩家头上）。
   * 于是由轮到的那个客户端在「演出结束 + 画面停在等输入」时**主动报一次**。
   *
   * `seq` 必须是**最新的**那条广播的序号：演出期间可能又来了几条 action
   * （别人竞价、系统代打），那些局面下「等输入」这个判断已经不成立了。
   * 同一个 `seq` 只发一次（客户端自己记住，别刷屏）。
   */
  | { t: 'awaiting'; seq: number }
  /**
   * ★ W-74：「我还在这儿，只是还在操作」（逛股市、百貨公司里挑东西）。
   *
   * 本机座位被等待期间，只要有鼠标 / 键盘输入就发，但**每 10 秒最多一次**。
   * 服务器收到就把截止时刻往后延（有硬上限，见 `clock`）。
   */
  | { t: 'alive' }
  /**
   * ★ W-74：**把座位收回来** —— 本机座位被超时託管时，玩家点一下画面就发。
   *
   * 服务器收到 ⇒ `strikes` 清零、镜像里改回 `HUMAN`、广播。
   * 回合中途收回也允许（与「掉线重连归还」走同一段代码）。
   */
  | { t: 'resume' }
  /**
   * ★ v8（gap-audit #7）：**纯演出**提示 —— 本机真人此刻在自己的 UI 里做了一件原版全桌都看得见的事
   *   （亮牌 / 用卡失败 / 道具台词 / 选格取消），请服务器转给其余各端（见 `PresentCue`）。
   *
   * ⚠️ 服务器**必须**校验：只收**轮到的那一座**（`actingSeat`，且不是服务器在代打）、手里真有那张卡 / 那件道具；
   *   限速（`PRESENT_RATE`）；**不进** action 日志 / 重放 / 指纹 —— 它不改局面。
   *   座位号由服务器从连接上认（消息里没有 `seat`）。
   */
  | { t: 'present'; cue: PresentCue };

/**
 * ★ v8（gap-audit #7）：一条纯演出提示的内容。
 *
 * | kind | 行动方那一刻 | 原版 | 旁观端演什么 |
 * |---|---|---|---|
 * | `cardReveal` | 卡片欄选定一张卡 | `0x00441cbc call 0x441f73`（亮牌，在卡片函数 / 选目标之前）| 同一扇亮牌（卡面 + 「使用X卡」+ 音效）；随后那条 `useCard` 不再亮第二遍 |
 * | `cardFailed` | 卡片函数返回 0（目标取消 / 用不成）| `0x00441cd9` 失败音 3 → `0x00441ce3` 卡片欄重开 | 失败音 3（卡片欄是行动方自己的 UI）；忘掉「已亮过」—— 再用一张会再亮一次 |
 * | `toolLine` | 选定要选目标的道具 | 道具函数第一个 `player_say`（路障 `0x00446bcc` 等，在选格 `0x446ae8` 之前）| 同一句道具台词；随后那条 `useTool` 不再说第二遍 |
 * | `toolCancel` | 选格 / 骰面盘右键取消 | `0x4466b8` / `loc_00446a68` 音效 4 | 音效 4 |
 */
export type PresentCue =
  | { kind: 'cardReveal'; cardId: number }
  | { kind: 'cardFailed'; cardId: number }
  | { kind: 'toolLine'; toolId: number }
  | { kind: 'toolCancel'; toolId: number };

/**
 * ★ v8：`present` 的限速 —— 每座每 `windowMs` 最多 `max` 条（超出的静默丢弃）。
 *   原版一次用卡最多「亮牌 → 失败」两件事，人手点卡片欄再快也到不了这个数；只防刷屏。
 */
export const PRESENT_RATE = { max: 8, windowMs: 4000 } as const;

/** 网络来的 `present.cue` 形状对不对（卡号 / 道具号只查是正整数且不离谱，**持有与否**由服务器对镜像查）*/
export function isPresentCue(v: unknown): v is PresentCue {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  const id = (x: unknown): boolean => typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 255;
  switch (c.kind) {
    case 'cardReveal':
    case 'cardFailed':
      return id(c.cardId);
    case 'toolLine':
    case 'toolCancel':
      return id(c.toolId);
    default:
      return false;
  }
}

// ============================================================
//  服务器 → 客户端
// ============================================================

export type ServerMessage =
  /** 加入成功，附带开局参数 */
  | {
      t: 'joined';
      version: number;
      /**
       * 本客户端控制的玩家下标。
       * ★ 聯機存檔（v6）：`-1` = 在存檔房的大廳裡、**還沒入座**（等著點「這是我」）。
       */
      seat: number;
      room: RoomInfo;
    }
  /** 房间状态变化（有人进出、准备就绪） */
  | { t: 'room'; room: RoomInfo }
  /**
   * 开局。
   *
   * ★ `seed` 由**服务器**下发——这是联机确定性的关键：
   *   各客户端不得自行取随机数种子。
   */
  | {
      t: 'start';
      seed: number;
      globalMapId: number;
      seats: SeatInfo[];
      options: LobbyOptions;
      /**
       * ★ v6（單機 / 聯機一致）：開局日期 = **服務器的今天**（與單機 `defaultStartDate(new Date())`
       *   同一個函數、同一段鉗位）。由服務器定、隨 `start` 下發 —— 各客戶端各看各的時鐘，
       *   跨午夜 / 跨時區就會開出不同日期的兩局。從存檔繼續的局不帶（快照裡有自己的日期）。
       */
      startDate?: { year: number; month: number; day: number };
      /**
       * ★ 聯機存檔（v6）：這一局的**起點局面**（`serializeGame` 的文本）。
       *   有它 ⇒ 客戶端 `deserializeGame(snapshot)`，**不** `newGame`；之後的 action 從 0 號接著施加。
       *   沒有 ⇒ 照舊用 `seed` + `options` `newGame`。
       */
      snapshot?: string;
      /**
       * ★★ 第十二份試玩回報（「斷線重連後莫名其妙又進入魔法屋」「所有文本提示又重新觸發了一輪」）：
       *   **进房那一刻日志已经排到第几号**（含；日志为空则 -1）。只在「局已开、有人进房/重连」
       *   那条补发里带；开局广播不带（那时日志是空的）。
       *
       *   紧跟着的补发 action 里，`seq <= through` 的都是**这个人进房之前就已经发生的事**
       *   —— 客户端据此把它们**静默追上**（只 reduce、不起演出），只有之后的实时广播才照常演。
       *   先前客户端分不出「补发」与「实时」，刷新页面后把整局的訊息框 / 魔法屋 / 台词重演一遍。
       *
       *   可选字段：旧服务器不带 ⇒ 客户端退回旧行为（逐条照常施加）。
       */
      through?: number;
    }
  /**
   * 定序后的 action。
   *
   * `seq` 严格递增且连续；客户端必须按序号顺序施加，
   * 收到跳号就说明丢包，应请求补发而不是跳过。
   */
  | { t: 'action'; seq: number; action: Action }
  /** 校验和不一致 —— 指出是谁、在第几步 */
  | { t: 'desync'; seq: number; expected: string; got: string; seat: number }
  /**
   * 全量重放 —— 对 `resync` 的答复（失步自愈，Q-NET-1）。
   *
   * 连开局参数一起给：客户端据此 `newGame` 再从头 reduce 整串 action，
   * 走的是**与单机完全相同**的那条路，故得到的 `stateFingerprint` 与
   * 服务器镜像必然相等（C-DET-*）。刻意**不传状态快照**——快照要额外
   * 定义序列化格式，而确定性引擎只要 action 序列就够。
   *
   * `actions` 从 0 号起完整连续；`through` = 最后一条的 seq（日志为空则 -1），
   * 客户端把「下一条期待的序号」接成 `through + 1`。
   *
   * ⚠️ 只发给**发起 `resync` 的那条连接**，绝不广播。
   */
  | {
      t: 'replay';
      seed: number;
      globalMapId: number;
      seats: SeatInfo[];
      /**
       * ★ 第十一份試玩回報 #1：**开局选项** —— 客户端 `onResync` 用它 `newGame`，
       *   少了它重建出来的局面与服务器镜像就不是同一局（初始资金/胜负条件都不同）。
       */
      options: LobbyOptions;
      /** ★ v6：開局日期；見 `start.startDate` */
      startDate?: { year: number; month: number; day: number };
      /** ★ 聯機存檔（v6）：起點局面；見 `start.snapshot` */
      snapshot?: string;
      through: number;
      actions: { seq: number; action: Action }[];
    }
  /**
   * ★ W-74：**这一回合还剩多久**。
   *
   * 发**剩余毫秒**而不是时间戳：各机时钟不准，传一个绝对时刻等于让每个人
   * 按自己的表算，快的那台会提前把别人的回合判超时。
   *
   * 发三回：**开始数**、被 `alive` **延长**、以及**作废**（`remainingMs: -1`）。
   */
  | { t: 'clock'; seat: number; remainingMs: number; hardRemainingMs: number }
  /**
   * ★ 房間列表（v5）：對 `listRooms` 的答覆，以及之後每一次變化的推送（**整份**替換，不發增量）。
   *
   * 只含**可以出現在列表上**的房間（終局的、沒人在的不列，見 `hub.ts` 的 `#summaries`）。
   */
  | { t: 'rooms'; rooms: RoomSummary[] }
  /** ★ 聯機存檔（v6）：對 `listSaves` 的答覆 */
  | { t: 'saves'; saves: SaveSummary[] }
  /** ★ 聯機存檔（v6）：手動存檔成功（廣播給全桌：大家都知道存了一份） */
  | { t: 'saved'; name: string }
  /**
   * ★ v8（gap-audit #7）：别的座位转来的纯演出提示（**不发回**发起者本人）。
   *
   * `after` = 服务器转发那一刻日志排到第几号（含；空 = -1）—— 行动方做这件事时已经演完了
   * 这之前的全部 action，旁观端据此把它排进收件箱里**同一个位置**（第 `after` 号之后、下一号之前）。
   */
  | { t: 'present'; seat: number; after: number; cue: PresentCue }
  | { t: 'error'; message: string };

/** `join.mode`（v5）—— 見 `ClientMessage` 裡 `join` 的注釋 */
export type JoinMode = 'create' | 'join';

/** 是不是合法的 `join.mode`（不帶 = 舊語義，另算） */
export function isJoinMode(v: unknown): v is JoinMode {
  return v === 'create' || v === 'join';
}

/**
 * 房間列表的一行（v5）。
 *
 * ⚠️ **沒有 `clientId`、沒有座位明細**：列表是發給**還沒進房**的人看的，
 *   別人的身份令牌一個字都不能出去（拿到它就能在斷線時冒名頂替那個座位）。
 */
export interface RoomSummary {
  /** 房間碼（內部 id；介面上只小字顯示，給除錯用） */
  id: string;
  /** 房主（0 號座）的暱稱 */
  host: string;
  /** 已經入座的**真人**數 */
  humans: number;
  /** 總人數（開局時不足的座位補電腦）*/
  seatCount: number;
  /** 已開局 */
  started: boolean;
  globalMapId: number;
  /** 房間建立了多久（毫秒，服務器發出這一條的那一刻算的；客戶端自己往上加）*/
  ageMs: number;
  /** 發 `listRooms` 的那個 `clientId` 在這桌有一個**斷線中**的座位 ⇒ 點了就是「重新連線」 */
  rejoin: boolean;
  /** ★ 聯機存檔（v6）：從存檔繼續的房間（顯示用）*/
  fromSave?: boolean;
  /**
   * ★ 聯機存檔（v6）：**已開局**的存檔房裡、由電腦代打的空座 —— 可以從列表「認領座位」。
   * （開局前的存檔房直接「加入」，進大廳再點「這是我」。）
   */
  vacant?: { seat: number; name: string; character: number }[];
}

/**
 * 服務器上的一份聯機存檔（v6）—— 列表那一行。
 *
 * ⚠️ 同 `RoomSummary`：**沒有 `clientId`**，只給看的人一個 `mine`。
 */
export interface SaveSummary {
  id: string;
  /** 手動存檔的名字；自動存檔是「<房主> 的房間」 */
  name: string;
  kind: 'auto' | 'manual';
  /** 存了多久了（毫秒，服務器發出那一刻算的）*/
  ageMs: number;
  globalMapId: number;
  /** 局面裡的日期與回合 */
  year: number;
  month: number;
  day: number;
  turnCount: number;
  seats: { seat: number; name: string; character: number; kind: 'human' | 'computer'; mine: boolean; alive: boolean }[];
}

/**
 * 列表上這一行的按鈕該是什麼（v5）—— 服務器與客戶端**同一個判據**。
 *
 * · `rejoin`  —— 你在這桌有斷線中的座位：永遠可點（開局了、滿了都一樣，`clientId` 認回原座）；
 * · `playing` —— 已開局、你不在裡面：不可點；
 * · `full`    —— 還沒開局但人滿了：不可點；
 * · `join`    —— 可以加入。
 *
 * ★ 順序是有意的：`rejoin` 先判 —— 滿了 / 開局了的那一桌，對「原來坐在裡面的人」仍然是能回去的。
 */
export type RoomJoinability = 'join' | 'rejoin' | 'claim' | 'full' | 'playing';

/**
 * ★ 聯機存檔（v6）多一種：`claim` —— 已開局的存檔房裡還有電腦代打的空座，可以「認領座位」。
 *   順序：`rejoin` > `claim` > `playing` > `full` > `join`。
 */
export function roomJoinability(
  r: Pick<RoomSummary, 'rejoin' | 'started' | 'humans' | 'seatCount'> & { vacant?: readonly unknown[] },
): RoomJoinability {
  if (r.rejoin) return 'rejoin';
  if (r.started && (r.vacant?.length ?? 0) > 0) return 'claim';
  if (r.started) return 'playing';
  if (r.humans >= r.seatCount) return 'full';
  return 'join';
}

export interface SeatInfo {
  seat: number;
  name: string;
  character: number;
  /** 空座由电脑补位 */
  kind: 'human' | 'computer';
  /** 真人座位此刻是否在线（服务器维护；断线超时后由电脑代打，重连归还） */
  connected?: boolean;
  /**
   * ★ W-74：这个座位此刻**由电脑管着**，以及是哪种原因。
   *
   * · `'offline'` —— 掉线超时，服务器代打（重连即归还）；
   * · `'idle'`    —— 这一回合超时 / 连续超时被託管（点一下画面可收回）。
   *
   * 缺省（`undefined`）＝ 玩家自己拿着。它随 `room` 消息广播给所有人。
   */
  autopilot?: 'offline' | 'idle';
  /**
   * ★ 聯機存檔（v6）：存檔房裡**沒人坐**的真人座位。
   * 開局前 = 可以點「這是我」；開局後 = 由電腦代打，原來的人（或從列表「認領座位」的人）可以接回去。
   */
  vacant?: boolean;
}

export interface RoomInfo {
  id: string;
  seats: SeatInfo[];
  started: boolean;
  /**
   * 房间地图（大厅设置，Q-NET-2）。开局前只有房主（0 号座）能改；
   * 开局时服务器用这一张 `newGame`，不再看各客户端的本地设置。
   *
   * ⚠️ **可选**是有意的：`RoomInfo` 是「房间快照」的通用形状，
   *   谁构造它都不该被迫填地图（旧测试、监控打印都只关心座位）。
   *   缺省按 `0` 读（`roomMapId`）。
   */
  globalMapId?: number;
  /**
   * 房间开局选项（第十一份試玩回報 #1）。与 `globalMapId` 同样是**可选**的
   * （`RoomInfo` 是通用快照形状，旧测试/监控不必被迫填）——缺省按 `LOBBY_DEFAULT_OPTIONS` 读。
   */
  options?: LobbyOptions;
  /**
   * ★ 聯機存檔（v6）：這間房是**從存檔繼續**的 —— 地圖 / 角色 / 開局設定都鎖定成存檔的。
   */
  fromSave?: { name: string };
  /**
   * ★ 聯機存檔（v6）：房主坐在幾號座（`-1` = 房主還沒入座）。
   * 缺省按 0 讀（一般房間的房主就是 0 號座）。存檔房的房主是**建房的那個人**，他可能坐在任何一座。
   */
  hostSeat?: number;
}

/** 房主坐在幾號座；舊快照沒帶 ⇒ 0 */
export function roomHostSeat(room: RoomInfo | null | undefined): number {
  return room?.hostSeat ?? 0;
}

/**
 * 大厅的**开局选项** —— 房间人数 + 单机开局设定屏那五项（角色/地图已另有通道）。
 *
 * 语义逐个对齐 `client/setup.ts` 的 `SetupState`（也就是原版 `0x46cb88..0x46cc00` 那几张表）：
 * | 字段 | 范围 | 来源表 |
 * |---|---|---|
 * | `seatCount` | 2..4 | `PLAYER_COUNT_LABELS`（原版 `0x46cb88`，值 = 人数 − 2）|
 * | `fundIndex` | 0..5 | `GAME_INITIAL_FUNDS`（`0x46cb94`，300000/…/10000）|
 * | `vehicle` | 0..2 | `VEHICLE_LABELS`（`0x46cbac`，步行/機車/汽車）|
 * | `landTenure` | 0..5 | `TENURE_LABELS`（`0x46cbb8`/`0x46cbd0`，無限期/二年/…/一個月）|
 * | `timeIndex` | 0..5 | `GAME_TIME_DAYS`（`0x46cbe8`）|
 * | `victoryIndex` | 0..5 | `VICTORY_FACTORS`（`0x46cc00`，0 = 無限）|
 *
 * ★ 放在 core 是**有意**的：这是**服务器校验**的判据，两端必须同一份数字
 *   （与 `LOBBY_CHARACTER_COUNT` / `LOBBY_MAP_COUNT` 同一个理由）。
 */
export interface LobbyOptions {
  /** **总**人数 2..4（不足的座位开局时补电脑）*/
  seatCount: number;
  /** 初始资金档 0..5（下标进 `GAME_INITIAL_FUNDS`）*/
  fundIndex: number;
  /** 起始载具 0..2 */
  vehicle: number;
  /** 地产有效期档 0..5 */
  landTenure: number;
  /** 游戏时间档 0..5 */
  timeIndex: number;
  /** 胜利条件档 0..5 */
  victoryIndex: number;
}

/** 大厅开局选项的缺省值 —— 与单机开局设定屏的初值一致（四人 / 30 万 / 步行 / 無限期 / 不限時 / 無限）*/
export const LOBBY_DEFAULT_OPTIONS: LobbyOptions = {
  seatCount: 4,
  fundIndex: 0,
  vehicle: 0,
  landTenure: 0,
  timeIndex: 0,
  victoryIndex: 0,
};

/** 总人数的合法范围 @source 原版开局设定屏「遊戲人數」只有 二人/三人/四人 */
export const LOBBY_MIN_SEATS = 2;
export const LOBBY_MAX_SEATS = 4;
/** 六档表（资金/地产/时间/胜利）的项数 */
export const LOBBY_OPTION_STEPS = 6;
/** 起始载具的项数（步行/機車/汽車）*/
export const LOBBY_VEHICLE_STEPS = 3;

const isIndex = (v: unknown, steps: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < steps;

/** 这一项是不是合法的总人数 */
export function isLobbySeatCount(v: unknown): v is number {
  return isIndex(v, LOBBY_MAX_SEATS + 1) && v >= LOBBY_MIN_SEATS;
}

/** 逐项校验一份（可能是部分的）大厅选项；返回 null = 全部合法 */
export function lobbyOptionsError(o: Partial<LobbyOptions>): string | null {
  if (o.seatCount !== undefined && !isLobbySeatCount(o.seatCount)) {
    return `房間人數要是 ${LOBBY_MIN_SEATS}..${LOBBY_MAX_SEATS} 的整數`;
  }
  if (o.fundIndex !== undefined && !isIndex(o.fundIndex, LOBBY_OPTION_STEPS)) return '總資金檔位不合法';
  if (o.vehicle !== undefined && !isIndex(o.vehicle, LOBBY_VEHICLE_STEPS)) return '行進方式不合法';
  if (o.landTenure !== undefined && !isIndex(o.landTenure, LOBBY_OPTION_STEPS)) return '土地權限檔位不合法';
  if (o.timeIndex !== undefined && !isIndex(o.timeIndex, LOBBY_OPTION_STEPS)) return '遊戲時間檔位不合法';
  if (o.victoryIndex !== undefined && !isIndex(o.victoryIndex, LOBBY_OPTION_STEPS)) return '勝利條件檔位不合法';
  return null;
}

/** 把一份（可能是部分的）选项补全到缺省值 */
export function withLobbyDefaults(o: Partial<LobbyOptions> | undefined): LobbyOptions {
  return { ...LOBBY_DEFAULT_OPTIONS, ...(o ?? {}) };
}

/**
 * 大厅设置的可选范围 —— 与客户端的素材一一对应：
 * · 角色 12 个（`client/setup.ts` 的 12 张 72×72 头像，`Data.mkf` 资源 2）；
 * · 地图 8 张（两个舞台 × 四张，`globalMapId` 0..7）。
 *
 * ★ 放在 core 是**有意**的：这两个范围是服务器校验的判据，
 *   客户端与服务器必须用同一份数字；各写一份迟早会漂。
 */
export const LOBBY_CHARACTER_COUNT = 12;
export const LOBBY_MAP_COUNT = 8;

/** `character` 是不是合法的角色号（0..11 的整数） */
export function isLobbyCharacter(character: unknown): character is number {
  return (
    typeof character === 'number' &&
    Number.isInteger(character) &&
    character >= 0 &&
    character < LOBBY_CHARACTER_COUNT
  );
}

/** `globalMapId` 是不是合法的地图号（0..7 的整数） */
export function isLobbyMapId(globalMapId: unknown): globalMapId is number {
  return (
    typeof globalMapId === 'number' &&
    Number.isInteger(globalMapId) &&
    globalMapId >= 0 &&
    globalMapId < LOBBY_MAP_COUNT
  );
}

/**
 * 这个角色是不是已经被**别的**座位占了 —— 「角色不能撞车」的唯一判据。
 *
 * ★ `exceptSeat` 传自己的座位：改角色时「保持不变」不算撞车，
 *   否则每个人一进房就处在自撞状态。
 */
export function characterTaken(
  seats: readonly { seat: number; character: number }[],
  character: number,
  exceptSeat: number,
): boolean {
  return seats.some((s) => s.seat !== exceptSeat && s.character === character);
}

/** 房间快照里的地图号；服务器没给就按 0 读（旧快照兼容） */
export function roomMapId(room: RoomInfo | null | undefined): number {
  return room?.globalMapId ?? 0;
}

/**
 * 房间快照里的开局选项；服务器没给就补缺省（旧快照兼容）。
 *
 * ⚠️ **一定能补全**，不返回 `undefined`：大厅那一栏要照着当前值画，
 *   拿到半份（或没有）就得自己兜底 —— 那种兜底写两遍迟早漂。
 */
export function roomOptions(room: RoomInfo | null | undefined): LobbyOptions {
  return withLobbyDefaults(room?.options);
}

// ============================================================
//  房间码 / 身份令牌 / 昵称（W-73）
// ============================================================

/**
 * 房间码的字符集 —— **去掉了容易看错的 `I` / `O` / `0` / `1`**。
 *
 * 这 32 个字符是**口头念给朋友**用的（「房间码 A B C 2 3 4」），
 * 所以「我念的是 I 还是 1」这种歧义要提前掐掉。
 * 长度 6 ⇒ 32^6 ≈ 10.7 亿，撞房不是这个规模该操心的事。
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

/** 与 `ROOM_CODE_ALPHABET` 逐字对应：`A-H` `J-N` `P-Z` `2-9` */
const ROOM_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

/** 房间码合法吗（6 位、只含上面那 32 个字符） */
export function isRoomCode(value: unknown): value is string {
  return typeof value === 'string' && ROOM_CODE_RE.test(value);
}

/**
 * `clientId` 的形状：**32 位小写十六进制**（16 字节随机数）。
 *
 * 为什么钉死小写：两个客户端「同一个令牌」要能逐字比较，
 * 大小写混着来就会变成两个身份 —— 那正是「认不回座位」的经典成因。
 */
const CLIENT_ID_RE = /^[0-9a-f]{32}$/;

export function isClientId(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_ID_RE.test(value);
}

/** 昵称最多几个**码点**（不是 UTF-16 单元 —— 「𠮷」算一个） */
export const MAX_NAME_CODE_POINTS = 12;

/**
 * 把客户端报上来的名字洗干净；洗不干净（空 / 太长 / 根本不是字符串）返回 `null`。
 *
 * 规则（任务书 W-73 §3）：**去掉控制字符（`\p{Cc}`）**、去首尾空白，
 * 然后按码点数要求 1..12。
 *
 * ⚠️ 判据放在 core 是**有意**的：服务器校验与客户端门厅的即时校验必须用同一份，
 *   否则会出现「门厅放行、服务器拒绝」这种谁也说不清的现象。
 */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // `\p{Cc}` 是 **Unicode 类别**而不是字面控制字符，所以没有 no-control-regex 的问题
  const stripped = raw.replace(/\p{Cc}/gu, '').trim();
  const points = [...stripped];
  if (points.length === 0 || points.length > MAX_NAME_CODE_POINTS) return null;
  return stripped;
}

/** ★ 聯機存檔（v6）：存檔名最多幾個碼點 */
export const MAX_SAVE_NAME_CODE_POINTS = 24;

/** 存檔名的清洗 —— 與 `sanitizeName` 同一套（去控制字元、去首尾空白），只是上限 24 */
export function sanitizeSaveName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const stripped = raw.replace(/\p{Cc}/gu, '').trim();
  const points = [...stripped];
  if (points.length === 0 || points.length > MAX_SAVE_NAME_CODE_POINTS) return null;
  return stripped;
}

// ============================================================
//  状态校验和
// ============================================================

/**
 * 对游戏状态取一个稳定的指纹。
 *
 * ⚠️ **不能直接 `JSON.stringify(state)`**：
 * 对象键的枚举顺序虽然在实践中稳定，但依赖它就等于把协议正确性
 * 押在引擎实现细节上（C-DET-5 明令禁止依赖 `Object.keys` 顺序）。
 * 故这里**显式列出**参与校验的字段并固定其顺序。
 *
 * 只取「规则可见」的量：钱、位置、归属、回合。不含渲染用的临时量。
 */
export function stateFingerprint(
  state: {
  turnCount: number;
  currentPlayer: number;
  day: number;
  month: number;
  year: number;
  priceIndex: number;
  rngState: number;
  players: readonly {
    index: number;
    cash: number;
    moneyInBank: number;
    loan: number;
    nodeId: number;
    whoPlays: number;
  }[];
  landOwner: readonly number[];
  landLevel: readonly number[];
  /** 公库 —— 樂透奖池与破产清算都汇到这里 */
  pool: number;
  /** 樂透号码表 */
  lottery: readonly number[];
  /** 道具持有表 */
  tools: readonly number[];
  /**
   * 道具库存（`0x49731f + 道具号`）与牌堆（`0x499197 + 卡号`）—— 禮物 / 抽卡格 / 福神 / 董事長 /
   * 節日 / 货架都按它们**加权抽**，两端不一致就会抽到不同的东西（2026-09-25 审计补入指纹）。
   * 可选：旧的测试夹具没有这两格 = 不参与。
   */
  toolStock?: readonly number[] | undefined;
  cardAmount?: readonly number[] | undefined;
  /** 股市 —— 只取收盘价与流通量，历史不入指纹（144 天太长且可由价格推出） */
  market: { stocks: readonly { price: number; shares: number }[] };
  /** 各玩家持仓 */
  holdings: readonly (readonly { amount: number }[])[];
  /**
   * 地图物件表 —— 神明在谁身上、还剩几天，炸彈在谁手上、引信到哪了。
   *
   * ★ 这些**全是共享状态**：神明改事件金额倍率、拦消费，炸彈到点会
   *   炸房子送医院。不入指纹，两端就可能一边有神明一边没有，
   *   而校验和照样相等。
   */
  objects: readonly { type: number; nodeId: number; state: number; attached: number }[];
  /**
   * 惡人段的游标 —— 「这一輪的惡人还没走完」是**规则相位**，不是渲染量。
   *
   * ★ `state/types.ts` 上那条注释早就写明「**要进**指纹」（两端在
   *   「游标停在第几个惡人」上不一致就是规则分歧），但实现里一直没接。
   */
  pendingNpcSlots?: readonly number[];
  /**
   * 当前**待决交互** —— 落在特殊格上要求玩家做什么，是规则的一部分。
   *
   * ⚠️ 先前**不在**指纹里：两端若一个挂著「買地」、另一个已经答完，
   *   校验和照样相等。用**规范化 JSON**（键排序）序列化，不依赖 `Object.keys` 顺序
   *   （C-DET-5）。
   */
  pending?: unknown;
  /** 排队中的后续拍卖（一次流程里连开多场时用）—— 同上，是规则状态 */
  pendingQueue?: readonly unknown[];
  },
  opts: { rng?: boolean } = {},
): string {
  const parts: (string | number)[] = [
    state.turnCount,
    state.currentPlayer,
    state.day,
    state.month,
    state.year,
    state.priceIndex,
  ];
  // ★★ `rng: false` 是给**与原版对轨迹**（通道 3）用的：
  //   原版的 PRNG 被表现层共用（台词中间档 3 处 + 事件 18/17 + 拍卖窗口动画 4 处
  //   按帧触发），无头引擎不可能逐位对齐 ⇒ 带着 `rngState` 比对只会一直报**假失步**。
  //   复刻↔复刻（联机）必须保留它：那是 desync 的早期信号。
  //   见 `rich4-spec/docs/verification.md` 通道 3、`docs/deviations/T-052.md`。
  if (opts.rng !== false) parts.push(state.rngState);
  for (const p of state.players) {
    parts.push(p.index, p.cash, p.moneyInBank, p.loan, p.nodeId, p.whoPlays);
  }
  parts.push('|', ...state.landOwner, '|', ...state.landLevel);
  // ★ 下面这几项是后来补进引擎的，一度不在指纹里——那意味着
  //   两端在公库、樂透、股市上分歧时**校验和照样相等**，
  //   desync 会一直拖到有人破产才暴露。指纹必须覆盖所有会变的共享状态。
  parts.push('|', state.pool);
  parts.push('|', ...state.lottery);
  parts.push('|', ...state.tools);
  // 缺席 = 不参与（旧回报里录下的指纹不含这两格，见 client 那两条 fixture 测试）
  if (state.toolStock !== undefined) parts.push('|stock', ...state.toolStock);
  if (state.cardAmount !== undefined) parts.push('|deck', ...state.cardAmount);
  parts.push('|');
  for (const st of state.market.stocks) parts.push(st.price, st.shares);
  parts.push('|');
  for (const row of state.holdings) for (const h of row) parts.push(h.amount);
  parts.push('|');
  for (const o of state.objects) parts.push(o.nodeId, o.state, o.attached);
  // ★ 规则相位的三项（第 50 条补）：游标、待决交互、排队的拍卖
  parts.push('|');
  for (const slot of state.pendingNpcSlots ?? []) parts.push(slot);
  parts.push('|', canonicalJson(state.pending ?? null));
  parts.push('|', canonicalJson(state.pendingQueue ?? []));
  return fnv1a(parts.join(','));
}

/**
 * **规范化 JSON** —— 键按字典序，递归。
 *
 * ⚠️ 不能直接 `JSON.stringify`：那依赖 `Object.keys` 的枚举顺序，而
 * C-DET-5 明令禁止把协议正确性押在它上面。指纹里那两项（`pending` /
 * `pendingQueue`）是**联合类型对象**，两端由同一串 action 生成，
 * 但键序不保证一致 —— 规范化之后「同状态必同指纹」才成立。
 *
 * 数组保序（顺序本身是语义）；`undefined` 按 JSON 惯例丢掉。
 */
function canonicalJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const obj = value as Record<string, unknown>;
  // ★ C-DET-5 禁的是「**依赖** `Object.keys` 的枚举顺序」。这里恰好相反：
  //   取出键名后**先排序再用**，正是不让枚举顺序影响结果 —— 所以是本规则
  //   的定向豁免，不是绕过。
  // eslint-disable-next-line no-restricted-properties -- 见上：排序后使用，与 C-DET-5 同向
  const keys = Object.keys(obj).sort();
  const body = keys
    .filter((k) => obj[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k]));
  return '{' + body.join(',') + '}';
}

/**
 * FNV-1a 32 位。
 *
 * 选它是因为**实现足够短**——协议两端各自实现时不容易写错，
 * 而校验和一旦两端算法不同，就会把「实现一致」误报成 desync。
 * 这里不需要抗碰撞，只需要能发现意外分歧。
 */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
