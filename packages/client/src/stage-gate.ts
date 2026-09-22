/*
 * 「这段演出还在跑吗」—— 台词时机的**唯一**判据（W-51）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 原版的 `_rich4_player_say`（VA 0x0044ef41）是**同步阻塞**的：画完字幕/表情之后
 *   `push 0x3e8 / call fcn_004544f6`（VA 0x0044f1a6）—— 那是个「等消息或到点」的
 *   循环（VA 0x00454520 起 `PeekMessage` + `timeGetTime` 比对）。所以「台词与影片
 *   谁先谁后」在原版里 = 这些 `call` 在同一个函数里的**先后**。
 *   本引擎一条 action 把后果一次写完，影片 / 建屋片 / 物件飞行 / 走子补间都是
 *   **事后补的** ⇒ 只有把这些**全部**算进「台上还忙着」，才能把同步语义补回来
 *   （第五份试玩回报：「触发台词的时机也不对」）。
 *
 * ★★ 这张清单**必须**与 `holdForActorWalk`（`main.ts`）里那套闸**同一份** ——
 *   两边各写一套必然漂移：多一条 = 台词被永久押着（死锁），少一条 = 台词抢在影片前。
 *   故本文件是**唯一定义处**：`holdForActorWalk` / `queueSpeech` / `speechTick` 都用它。
 *
 * ⚠️ 卡片飞行**没有**自己的状态位：`startCardFlight`（`main.ts`）的两个分支都走
 *   `beginObjectFlight`，写的就是 `objectFlight` —— 所以清单里只有这一位，
 *   不要再为「卡片飞行」另立一位（多出来的那位永远是 false，等于没接）。
 *
 * 纯函数：不读 DOM、不碰音频、不动 PRNG（C-DET-1/2/4），能单测。
 */

/**
 * 一句台词在原版里排在**这一段演出之前**还是**之后**。
 *
 * - `beforeStage`：原版先 `player_say`、后播影片
 *   （例：壞神附身 —— 台词 → 影片 → 神明台词窗 → 轉盤窗 → 付款）；
 * - `afterStage`：原版先演完影片/訊息框、最后才 `player_say`
 *   （例：送醫院、送監獄、設施收費）。
 *
 * `SayEvent.order` 与 `SpeechDetector.order` 都**没有缺省值**：新增探测器必须
 * 逐条过 W-50 §2.2 的裁定表才能编过（见 `speech.ts` 的 `DETECTORS`）。
 *
 * ★★ **为什么没有第三档 `afterNotice`（2026-09-19 收尾核过）**：§2.2 对福神那一句
 *   裁定的是 `afterNotice`（台词排在**訊息框之后、0x20b 烟花之前**）。回 exe 看，
 *   那一档与 `afterStage` 在**现有探测器上观察等价**：
 *   · 福神自己的台词（`0x0040fa1e` / `0x0040fa5c`）只在落点**没升到 5 级**那一支上说
 *     （`0x004199eb cmp byte [esi+0x1a],5 / jne` 的另一边；升到 5 那一支直接
 *     `jmp 0x41b077`，**根本不调** `0x40f8be`），而 0x20b 只在升到 5 时才播
 *     ⇒ 两者互斥，不存在「要排在烟花之前」的台词；
 *   · 福神升到 5 级那一句是**事件 15**，由 `detectLevelFive` 说，已按 `beforeStage`
 *     排在 0x20b 之前（2026-09-19 从暂定的 `afterStage` 订正过来）。
 *   ⇒ 加一档要多动一处闸（`queueSpeech` / `speechTick`）却影响不到任何一句，
 *   按「不新增原版没有的东西」保留两档；结论记在 `docs/escalations.md` E-19。
 */
export type SpeechOrder = 'beforeStage' | 'afterStage';

/**
 * `stageBusy()` 的入参 —— 一位一个「台上还忙着」的条件。
 *
 * ⚠️ 每一位都必须由 `main.ts` 的 `stageBusyFlags()` 从**当前**状态现取，
 *   不许缓存、不许猜：这些状态位全都是一拍之内就会变的。
 */
export interface StageFlags {
  /** 有一段**纯演出**整屏在接管（`main.ts` 的 `BLOCKING_PRESENTATIONS` 那张表） */
  blockingPresentation: boolean;
  /** 棋盘影片（住院 / 入獄 / 神明 / 狗咬 / 飛碟…）正在播 */
  boardFilm: boolean;
  /** 棋盘影片已排队、还没起播（等补间 / 等解码 / 等訊息框） */
  pendingBoardFilm: boolean;
  /** 「接着还要播一段」（狗咬 → 救护车）已排队 */
  pendingBoardFilmAfter: boolean;
  /** 建屋动效（機器工人大锤 / 满级 0x20b）正在播 */
  buildFx: boolean;
  /** 建屋动效已排队、第一段影片还没解好 */
  pendingBuildFx: boolean;
  /** 物件 / 卡片正在飞（两者是**同一个** `objectFlight`，见文件头 ⚠️） */
  objectFlight: boolean;
  /** 走子补间播完了 —— 传 `renderer.walkDone()`，**不取反** */
  walkDone: boolean;
  /** 掷骰动效在播（预动作 / 滚骰 / 定格三段） */
  diceFxActive: boolean;
  /**
   * 過路費那段「把算進去的每一塊地一起閃一遍」在播（W-69）。
   *
   * ★ 原版 `0x00419c83`（這一段）在 `0x00419d5a call 0x440cac`（費用訊息框）**之前**，
   *   而且 `fcn_00451985` 自己是阻塞的（16×30 ms + 400 ms）——
   *   所以要把它算進「台上還忙著」：訊息框與回合驅動都得等它。
   */
  tollFlash: boolean;
  /**
   * ★ 神明附身的开场白（`fcn_0040e2a2`，2400 ms）正在演 / 排队等影片收屏（第八份试玩回报 #5）。
   *   原版 `0x4528b9(0x960)` 是阻塞等待，效果（发卡 / 收钱窗）与台词都在它之后。
   */
  godLine: boolean;
}

/**
 * 这段演出还在跑吗。
 *
 * 是 ⇒ 这一条 action 派生出来的 **`afterStage`** 台词先押进 `deferredSpeech`；
 * `tickBoardFilm` / `tickBuildFx` 起播前反过来等 `beforeStage` 的句子说完。
 */
export function stageBusy(f: StageFlags): boolean {
  return (
    f.blockingPresentation ||
    f.boardFilm ||
    f.pendingBoardFilm ||
    f.pendingBoardFilmAfter ||
    f.buildFx ||
    f.pendingBuildFx ||
    f.objectFlight ||
    !f.walkDone ||
    f.diceFxActive ||
    f.tollFlash ||
    f.godLine
  );
}

/**
 * 这句台词要不要押进 `deferredSpeech`（= 演出收屏之后再上台）。
 *
 * ★★ **死锁自查**：`beforeStage` 的句子**永不**押后。
 *   两边互等的形状是这样的：`beforeStage` 的台词要等影片起播，而影片又在等
 *   `speechQueue.length === 0`（原版「说完才播」）—— 若这句被 `stageBusy`
 *   押着，影片与台词就永远互相等。
 *   `stage-gate.test.ts` 里立了一条「壞神附身 ⇒ 2 秒内台词与影片都走完」的用例，
 *   并附一条**反例**（把这条规则改坏 ⇒ 模型 2 秒内走不完）证明它抓得住。
 */
export function deferSpeech(order: SpeechOrder, busy: boolean): boolean {
  return order === 'afterStage' && busy;
}

/**
 * 影片 / 建屋动效起播前要不要再等 —— 原版 `player_say` 说完才返回，
 * 调用它的那段流程才走到 `read_mkf + fcn_0045144f`。
 *
 * @param pendingSpeech `speechQueue.length`（还没上台 / 还在台上的句数）
 */
export function filmWaitsForSpeech(pendingSpeech: number): boolean {
  return pendingSpeech > 0;
}
