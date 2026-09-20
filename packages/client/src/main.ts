/*
 * 客户端入口
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2 / C-ARC-4：本文件负责**输入与呈现**，一条规则都不含。
 *   所有状态变更都表达为 action 交给 `reduce()`；
 *   这正是联机能免改造接入的前提——本地点击和远端消息产生的
 *   是同一种 action，引擎分不出也不需要分出来源。
 */

import { CARD_IMPLS, CHARACTERS, TOOLS, stocksOfMap } from '@rich4/data';
import { setVoiceSink } from './voice-sink.ts';
import { LogRing } from './log-ring.ts';
// ★ 魔法屋那一屏的 dev 直达钩子（`__rich4.magic` / `__rich4.magicHouse`，只在 DEV 下挂）——
//   这一屏**要玩到才会出现**（落点随机），验收它只能反复进屏，见下面那个 dev 分支。
import { magicScreenState } from './magic-screen.ts';
import {  autoAction,
  ACTOR_DOLL,
  directionOf,
  PLACEMENT_TOOLS,
  VEHICLE_DICE,
  teleportPlayer,
  decideAction,
  isAiTurn,
  PANEL_PAGE_COUNT,
  holidayIndexOf,
  weekdayOf,
  dayNumberSince1998,
  DEFAULT_INITIAL_FUND,
  defaultStartDate,
  MAX_HAND_CARDS,
  MAX_TOOL_COUNT,
  newGame,
  reduce,
  parseMap,
  parseSave,
  importOriginalSaveWithSnapshots,
  roomMapId,
  specialSlotOf,
  SPECIAL_KIND,
  STOCK_STATUS,
  stockStatus,
  serializeGame,
  actingSeat,
  isAiControlled,
  stateFingerprint,
  toolCount,
  winConditionsOf,
  type Action,
  type CardTarget,
  type GameState,
  type MapTopology,
  type Rich4Map,
  type RoomInfo,
  type TargetClass,
  orphanedAuction,
} from '@rich4/core';
import { NetClient, netParamsFrom } from './net-client.ts';
import { DiceRollFx, DICE_SOUND as DICE_ROLL_SOUND } from './dice-roll.ts';
import { RENDER_MS, tickMs } from './tick.ts';
import { walkTweenFor } from './tween.ts';
import { drawLobby, hitLobby, isHostSeat, lobbySlots, type LobbyHit } from './lobby.ts';
import { PANEL_ROWS } from './hud.ts';
import { panelRows } from './panel.ts';
import {
  aiSettingsDraft,
  applyAiSettingsHit,
  AI_ORIGIN,
  drawAiSettings,
  hitAiSettings,
  rowMatchesPlayer,
  type AiSettingRow,
  type AiSettingsHit,
} from './ai-settings.ts';
import {
  loadArchives,
  loadGround,
  loadHdSource,
  type HdSource,
  readMapData,
  SpriteCache,
  loadHolidayArt,
  loadMinigameBackground,
  loadMinimapBackground,
  screenDirection,
  type ArchiveName,
  type LoadedArchives,
  type Sprite,
} from './assets.ts';
import { onEventBoxArtReady, setEventBoxArchives } from './event-box-screen.ts';
// ★ 「請選擇設施類別」那扇窗（Q-TOOL-4）—— 真人盖**等级 0 的設施**时要先选种类
//   （原版 `fcn_00440aac` / 窗口过程 `fcn_0043fae4`）。
import { PICKER_TOOL_ID, openFacilityPicker, pickerNeededFor } from './facility-picker.ts';
import { needsStealPick, openStealPicker } from './steal-picker.ts';
import { AMOUNT_BAR_DRAG_SOUND, amountBarDragValue } from './amount-window.ts';
import {
  Hud,
  SIDEBAR,
  clampCameraCenter,
  hitCalendarToggle,
  hitMinimapArrow,
  hitMinimapBody,
  hitPanelTag,
  hitSidebar,
  minimapToWorld,
  type MinimapArrowId,
  type SidebarView,
} from './hud.ts';
import {
  CONTROL,
  DEFAULT_OPTIONS,
  DIALOG,
  OPTIONS_RESOURCE,
  applyOptionsHit,
  controlHit,
  drawOptions,
  hitControl,
  volumeOf,
  HOTKEY_NAMES,
  SIDE_BUTTONS,
  type GameOptions,
} from './options.ts';
import {
  DATE_AT,
  DATE_CTRL,
  HOTKEY_AT,
  HOTKEY_CTRL,
  HOTKEY_DEFAULT_KEYS,
  applyDateHit,
  confirmOutcome,
  drawDatePage,
  drawHotkeyPage,
  drawYesNo,
  hitDateControl,
  hitDatePage,
  hitHotkeyPage,
  hitYesNo,
  hotkeyAssign,
  hotkeySpot,
  type DateDraft,
  type OptionsOutcome,
} from './options-pages.ts';
import { SoundPlayer, shouldRetriggerVoice } from './audio.ts';
import { cardPlaySpeech, openingSpeech, speechBubblesFor, speechEventsFor } from './speech.ts';
import { SpeechQueue, drawSpeechBubble, type SpeechBubble } from './speech-bubble.ts';
// 台词字幕用的是 canvas 文字（原版 `_rich4_create_font(0x10, 0x101010, …)` 那一路）
import { font } from './font.ts';
import { MusicPlayer, shouldResumeAfterUnlock } from './music.ts';
// Q8：音色库（.sf2）—— 用户自备，有就用采样还原音色，没有就退回振荡器
import { parseSoundFont } from './soundfont.ts';
import {
  assetBase,
  currentGameDir,
  initConfigStore,
  configStore,
  initSaveStore,
  hdBase,
  isDesktop,
  hostLog,
  writeReport,
  loadSavedSoundFont,
  pickGameDir,
  pickSoundFont,
  warpCursor,
  type PickResult,
} from './host.ts';
import { BOARD_BGM_FILES, MIDI_PLAYLIST, PLACE_TOOL_SOUND, SOUND_IDS, nextBoardBgm } from '@rich4/assets-pipeline';
import {
  BoardRenderer,
  cameraCenter,
  characterCamera,
  pixelCamera,
  hitToolbar,
  pickNodeAt,
  worldToScreen,
  type Camera,
} from './render.ts';
import {
  CARD_FLIGHT_IMAGE,
  CARD_FLIGHT_NO_OBJECT,
  CARD_FLIGHT_TYPE,
  THROW_SETTLE_MS,
  cardFlightPlan,
  flightDone,
  makeObjectFlight,
  objectFacing,
  type CardFlightPlan,
  type ObjectFlight,
} from './throw-fx.ts';
// ★ 原地建屋动效（Q-TOOL-6 / E6）—— 与上面那套投掷动效**不是一回事**：
//   大锤是整块 440×440 的 FLIC 直接盖在棋盘左上角，不动位置、不进绘制槽。
//   ★ 三条消费点共用：機器工人（9）、魔法屋「就地加蓋」、天使卡（9）——
//   bit7 一律由 core 算（`GameState.lastBuildUpgrades`），这里只排段序（C-ARC-2）。
import {
  beginBuildFx,
  buildClip,
  buildFxBitmap,
  buildFxPlan,
  buildUpgradesOf,
  BUILD_FX_ARCHIVE,
  stepBuildFx,
  type BuildClipName,
  type BuildFx,
} from './build-fx.ts';
// ★ 「送進監獄／醫院」那一段 FLIC（Q-ANIM-1 的「受管辖但仍未接」之一）——
//   与建屋影片同一套：整幅 FLIC 直接盖在棋盘上、**阻塞**、播完才放行回合驱动。
import { confineClip, confineFxTrigger } from './confine-fx.ts';
// ★ 神明降臨／發威那一段影片（Q-ANIM-1）—— 与住院/入獄同一支 `fcn_0045144f`，
//   于是共用 `board-film.ts` 的播放与下面那一份「棋盘影片」宿主状态。
import { godFilmSpec, godFxTrigger } from './god-fx.ts';
// ★ 「踩到惡犬」那一段影片（試玩回報：踩到狗直接進醫院、没有咬人动画/配音）——
//   同一支 `fcn_0045144f` 的第三位客人，规格与判据见 `dog-fx.ts`。
import { dogBiteFxTrigger } from './dog-fx.ts';
// ★ 新聞 4「外星人攻打地球」的飛碟影片（試玩回報）—— 同一支 `fcn_0045144f`，
//   规格与判据见 `alien-news-fx.ts`。
import { alienNewsFxTrigger, NEWS_ALIEN_ID } from './alien-news-fx.ts';
import {
  beginBoardFilm,
  boardFilmBitmap,
  boardFilmDone,
  type BoardFilm,
  type BoardFilmSpec,
} from './board-film.ts';
// ★ 影片窗口内棋盘按 **before** 那一帧画（试玩3 #1/#9，issue #19）——
//   原版 `fcn_0045144f` 是阻塞的，播完才重绘棋盘；core 却一条 action 就把
//   等级/附身写完了。纯函数与逐项判据见 `deferred-board.ts`。
import { boardStateForFilm } from './deferred-board.ts';
import { TOOLBAR_LABELS, loadSetupScene as loadSetupSceneAsset } from './assets.ts';
import { interactionUi, type InteractionUi } from './interactions.ts';
// ★ 「取消」那一拍的梯子 —— ESC 与右键**共用同一份**（原版就是这么干的：
//   钩子把取消键变成 `WM_RBUTTONUP 0x205`，主窗口过程只交给栈顶那扇窗）。
//   取证与全表见 `panel-cancel.ts` 头部。
import { CANCEL_SOUND, cancelLayerOf, type CancelLayer } from './panel-cancel.ts';
// ★ 股市柜台的填数页壳 —— 与銀行/公佈欄/上市企業**同一个**通用填数页。
import { stockAmountForm } from './amount-form.ts';
// ★ 通用填数窗**自己那张键盘表**（@source `loc_00452e4b`）：0-9 / 退格 / C / M / H / Enter。
import {
  amountKeyOfVk,
  amountKeyStep,
  amountSlotOfId,
  amountVkOf,
  type AmountKey,
} from './amount-keys.ts';
import {
  drawAdvance,
  drawDialog,
  drawDice,
  drawDiceFlic,
  hitAdvance,
  hitDiceToggle,
  hitDialog,
  layoutDialog,
  usesYesNo,
  type AmountPage,
  type DialogHit,
} from './dialog.ts';
import { DICE_FLIC_BASE, GO_IMAGE, type SpriteFn } from './gameui.ts';
import { GO_SIZE, goButton, boardToScreen } from './go-button.ts';
import { createCursorWarper, measureCanvas, type CursorWarpFrame } from './cursor-warp.ts';

/**
 * 最近一次棋盘 `mousedown` 走到了哪一步 —— **只读诊断**，给浏览器长跑排错用。
 *
 * canvas 里的命中看不见，长跑只能靠这几个字段区分「没点到 GO」/「点到了但
 * `requestRoll` 被拒」/「掷了但回合驱动没接上」。不参与任何判定。
 */
export const inputTrace: {
  stage: readonly [number, number] | null;
  diceToggle: number | null;
  goPressed: boolean;
  rollRequested: boolean;
  earlyReturn: string | null;
} = { stage: null, diceToggle: null, goPressed: false, rollRequested: false, earlyReturn: null };
import { moveSoundId } from './move-sound.ts';
import { CHARACTER_POSE, characterSetBase, type LoadedFlic } from './assets.ts';
import { HOTKEY, hotkeyOf, vkOf, type KeyBinding } from './hotkeys.ts';
import {
  configHotkeyKeys,
  decodeConfig,
  encodeConfig,
} from './config-file.ts';
import { SCENE_ARCHIVE, sceneFor } from './scenes.ts';
import { onMinigameBackgroundReady, setMinigameBackground } from './minigame-bg.ts';
import {
  AUTOSAVE_SLOT,
  LOAD_SLOTS,
  SAVE_SLOTS,
  drawSaveLoad,
  formatGaps,
  hitImport,
  hitSaveLoad,
  outsideSaveLoad,
  readSlots,
  slotOfRow,
  writeSlot,
  type SaveLoadMode,
  type SlotInfo,
} from './saveload.ts';
import { clockSeed, reduceWithHostRng, reseedAfterLoad } from './rng-host.ts';
import { FlightRecorder, reportFileName } from './flight-recorder.ts';
import { holidayBgmOnDayAdvance } from './holiday-bgm.ts';
import { LAYOUT, SCREEN_H, SCREEN_W, stageMetrics, toStage, type StageMetrics } from './stage.ts';
import { drawTitle, hitTitle, TITLE_RESOURCE } from './title.ts';
import { drawIntro, introDone } from './intro.ts';
import {
  activePlayers,
  assetRows,
  drawAssetSheet,
  estatePageAfter,
  hitSheetArrow,
  hitSheetBtn,
  hitSheetExit,
  hitSheetKind,
  hitSheetTab,
  type SheetUi,
} from './asset-sheet.ts';
import {
  drawStockDetail,
  stockDetailFrom,
  type StockDetailView,
} from './stock-detail.ts';
import {
  STOCK_PLATE_BUY,
  STOCK_PLATE_EXIT,
  STOCK_PLATE_INFO,
  STOCK_PLATE_PAGE,
  STOCK_PLATE_SELL,
  STOCK_NO_BUY,
  STOCK_NO_SELL,
  STOCK_PICK_FEEDBACK_MS,
  drawStockScreen,
  hitStockPlate,
  hitStockRow,
  stockCounterBuyMax,
  stockCounterClosed,
  stockPickCardAction,
  stockRowsFrom,
  type StockPickMode,
  type StockView,
} from './stock-screen.ts';
import {
  DICE_SOUND_CANCEL,
  DICE_SOUND_PICK,
  drawDiceChoose,
  hitDiceFace,
  remoteDiceActions,
} from './dice-choose.ts';
import { drawToast, reportToast, toastVisible, type Toast } from './toast.ts';
import { nearestSummonableObject, summonCardAction } from './object-pick.ts';
import {
  drawTip,
  tipModel,
  TIP_ARCHIVE,
  TIP_RESOURCE,
  type TipModel,
} from './node-tip.ts';
import {
  FINANCE_BORROW,
  LOAN_BLINK_IDLE,
  LOAN_BUTTONS,
  LOAN_EXIT,
  drawBankLoan,
  hitFinanceButton,
  hitLoanButton,
  loanBlinkImage,
  loanBlinkStart,
  loanBlinkStep,
  type LoanBlink,
  type LoanOp,
} from './bank-loan.ts';
import {
  atmAmount,
  atmLimit,
  atmPress,
  drawBankAtm,
  hitAtmButton,
  type AtmState,
} from './bank-screen.ts';
import {
  ATM_BAR,
  LOAN_BUBBLE_MS,
  LOAN_TICK_MS,
  atmApplyCode,
  atmCodeOfKey,
  atmDragToClick,
  atmSeekAmount,
  drawLoanBubble,
  drawLoanPanels,
  drawLoanPressed,
  loanDueDays,
  loanSlideDone,
  loanSlideStep,
  loanStart,
  loanStep,
  type LoanPanelsView,
  type LoanUi,
} from './bank-dynamic.ts';
import {
  INV_VEHICLE_IMAGE,
  REMOTE_DICE_TOOL,
  cardEntries,
  drawInventory,
  hitInventory,
  routeCardPick,
  toolEntries,
  toolIsDirect,
} from './inventory.ts';
import {
  SHOP_BUBBLE_MS,
  SHOP_PAGE,
  SHOP_SLIDE_MS,
  blinkStart,
  blinkStep,
  cellItemAt,
  drawShopScreen,
  hitShopCell,
  hitShopExit,
  hitShopShelf,
  hitShopSwitch,
  shopEntryOf,
  shopMessage,
  shopRows,
  slideDone,
  slideStart,
  slideStep,
  type ShopBlink,
  type ShopPage,
  type ShopShelfRow,
  type ShopSlide,
} from './shop-screen.ts';
import {
  canPayOnScreen,
  drawBailScreen,
  hitBailSlot,
  type BailSlotView,
} from './bail-screen.ts';
import { SCREENS } from './screens.ts';
// ★ 只给「挪指针」那条判据用（`cursor-warp.ts` 的另外三处固定落点）
import { facilityPickerScreen } from './facility-picker.ts';
import { researchScreen } from './research-screen.ts';
// ★ 只给 dev 钩子用（`__rich4.auctionView()`）：竞价轮转发生在 canvas 屏里，
//   自动化看不见就没法验收「电脑跟不跟价、落槌演没演」。
import { auctionRunForTest } from './auction-screen.ts';
// ★ 镜头该盯谁：判据是纯函数（第四份回报第 2/5 条）
import { cameraFollowTarget } from './camera-follow.ts';
// ★ 只给 dev 钩子用（`__rich4.lotteryDraw()`）：開獎屏要等到 15 号才出现
import { lotteryDrawCue, lotteryDrawView } from './lottery-draw-screen.ts';
import { openBigMap } from './big-map-screen.ts';
// ★ 遊戲百科（`helpScreen`）不在这里单独引 —— 它登记在 `screens.ts` 里，
//   ESC 与右键都走那条登记契约（本屏的 `hotkey` / `contextmenu` 是同一支）。
import { openHelpAt } from './help-screen.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';
import {
  CURSOR_ARCHIVE,
  CURSOR_RESOURCE,
  PICK_CLASS,
  PICK_CURSOR_INVALID,
  PICK_EDGE,
  PICK_EDGE_ARROW,
  PICK_SCROLL_STEP_MIN,
  PICK_SCROLL_TICK_MS,
  TOOL_SELECT_PARAM,
  hitCandidate,
  pickClasses,
  pickCursorFor,
  pickEdgeOf,
  pickScrollCamera,
  pickScrollNextStep,
  startPick,
  type PickEdge,
  type PickSession,
} from './picking.ts';
import {
  MONEY_VALUES,
  defaultSetup,
  drawSetup,
  fillComputerSeats,
  setupDown,
  setupMove,
  setupOutro,
  setupPhase,
  setupUp,
  type SetupState,
} from './setup.ts';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>('board');
// ⚠️ 側欄不再是独立的 HTML 画布 —— 它是舞台 640×480 里的一块
//   （见 stage.ts 的 LAYOUT.panel），跟着一起缩放，命中判定也走舞台坐标。
const ctx = (() => {
  const c = canvas.getContext('2d');
  if (c === null) throw new Error('无法取得 2D 绘图上下文');
  return c;
})();

const logEl = $('log');
const metaEl = $('meta');
const playersEl = $('players');
const actionsEl = $('actions');
const interactionEl = $('interaction');

/**
 * 最近若干行日志的**环**（F9 回报里带上）—— 实现在 `log-ring.ts`（可单测）。
 *
 * ★ 为什么要有：日志栏只在屏幕上留 120 行、而且**不进报告** ——
 *   事后复盘时最想知道的往往正是「出事前那几行说了什么」
 *   （「⚠ 电脑在 X 无事可做，已停手」「底圖載入失敗」…）。
 */
const logRing = new LogRing();

function log(msg: string): void {
  hostLog(msg);
  logRing.push(msg);
  const d = document.createElement('div');
  d.textContent = msg;
  logEl.prepend(d);
  while (logEl.childElementCount > 120) logEl.lastElementChild?.remove();
}

// ============================================================
//  状态
// ============================================================

let map: Rich4Map;
let topo: MapTopology;
let state: GameState;
let camera: Camera;
let hoverNode: number | null = null;
/**
 * 名牌浮标（Q-HOVER-1）—— 原版棋盘窗口过程在 `WM_LBUTTONDOWN` 上画、
 * 在 `WM_LBUTTONUP` / `WM_MOUSEMOVE` 上擦（VA 0x004186bd → `fcn_00417559`，
 * 擦除是 `fcn_00417c67`）。所以它**只在按住左键期间**挂在屏幕上。
 */
let nodeTip: TipModel | null = null;
let renderer: BoardRenderer;
/**
 * 右下角那块 200×200 现在显示哪一面。
 * @source RICH4.CFG offset 5：00 日曆 / 01 小地圖 / 02 兩者輪流
 *   —— 原版默认哪一个没查证，这里先开日曆（那是它的原生面貌）。
 */
let sidebarView: SidebarView = 'calendar';

/**
 * 右上角面板现在显示第几页（0 資金 / 1 地產 / 2 股票 / 3 其他）—— **每个玩家一份**。
 *
 * @source 原版是 4 个字节的数组 `0x48be24 + 玩家号`（VA 0x00417f98 附近
 *   `mov dword [0x48be24], edi` 开局清零），由 PgUp/PgDn 那对熱鍵切换
 *   `(页 ∓ 1) & 3`（VA 0x004014b1 / 0x004014ee）。
 * ★ **点 tag 不换页** —— 原版那四个标签只在绘制处被引用（串表 `0x475274`），
 *   没有任何命中判定。
 */
const panelPages: number[] = [0, 0, 0, 0];

/** 設定屏的取值。@source 字段与范围见 options.ts / RICH4.CFG */
let options: GameOptions = { ...DEFAULT_OPTIONS };
/** 进 設定 屏之前待在哪一屏 —— 取消时要回去 */
let optionsReturn: Screen = 'title';
/** 右上角三个按钮用哪一组文字：0 標題頁 / 1 遊戲中 */
let optionsVariant = 0;
let optionsDraft: GameOptions = { ...DEFAULT_OPTIONS };
/**
 * 当前按住不放的控件号（原版 `[0x474d74]`）。
 *
 * ★ 两个「照着原版」的点：动作分按下/抬手两半（进度条、灯、視窗、樂曲在**按下**
 *   就生效；取消/確定/右上角三颗要**抬手**才算），而抬手时**不重新命中判定** ——
 *   按下后拖到别处再松手，仍算点的是原来那颗（VA 0x00410820 直接用按下时记的值）。
 */
let optionsPressed: number | null = null;

/**
 * 設定屏上盖着的那一层（Q-OPT-1）：日期頁 / 熱鍵頁 / 通用 YES/NO 框。
 * `null` = 只有主面板。
 *
 * ★ 三者都是原版**另开一扇窗口**的模态层（`fcn_00410ac3` / `fcn_00411122` /
 *   `fcn_0045367e`），所以在设定屏自己的鼠标处理里分流，不走 `screens.ts`
 *   那张登记表。「遊戲說明」才是登记的整屏（`help-screen.ts`）。
 */
type OptionsSub =
  | {
      kind: 'date';
      /** 正在编辑的日期（原版 `[0x48bb84..87]`）*/
      draft: DateDraft;
      /** 开屏那一刻的系统今天（原版 `[0x48bb5c]`，给「熱 鍵」那颗用）*/
      today: DateDraft;
      /** 正按住的控件号（原版 `[0x474d78]`）*/
      pressed: number | null;
    }
  | {
      kind: 'hotkey';
      /** 28 条键位（原版 `0x48bb10` 那份工作副本）*/
      keys: number[];
      /** 正按住的**值**（原版 `[0x48bb9e]`）*/
      pressed: number | null;
      /** 正在等按键的那一条（原版 `[0x48bba6]`，1 基）*/
      capture: number | null;
      /** 进捕获时存下的旧值（原版 `[0x48bb8c]`，右键取消要还回去）*/
      oldValue: number;
      /** 闪白这一拍亮不亮（原版 `[0x48bbaa]`）*/
      blink: boolean;
    }
  | {
      kind: 'yesno';
      /** 是哪一颗黄钮（0 重新遊戲 / 1 認輸投降 / 2 結束遊戲）*/
      side: number;
      /** 鼠标压在哪一半（1 左 YES / 2 右 NO / `null`）*/
      hot: number | null;
    };

let optionsSub: OptionsSub | null = null;

/**
 * 設定屏「日期更改」改出来的日期（原版 `[0x48bb50]` / `[0x497160]`）。
 *
 * ⚠️ 原版这是**下一局的起始日期**，写进 RICH4.CFG；本引擎的 `newGame` 目前把
 *   开局日期写死成 1998/1/1（core 那边没有这个入参，本轮边界外），所以先把
 *   它留在客户端，记在 `docs/known-deviations.md` 的 Q-OPT-1。
 */
let optionsDate: DateDraft = { year: 1998, month: 1, day: 1 };

/** 熱鍵頁那份键位表（原版 `0x497168` 的 56 字节）。出厂默认 = 表 `0x47edc2` */
let optionsKeys: number[] = [...HOTKEY_DEFAULT_KEYS];

/**
 * 把 `RICH4.CFG` 里那一份读回来 —— 开机一次（原版 `rich4_read_config()` 也是开机一次）。
 *
 * @source `rich4_read_config()` VA 0x00411e8f（`rich4_initialize.asm:169`）：
 *   `fread(&global_rich4_cfg, sizeof(global_rich4_cfg), 1, fp)`，
 *   文件不在就用出厂默认。本引擎多一步「读不出来就保持当前默认」。
 *
 * ⚠️ **日期故意不在这里应用**：原版 `rich4_read_config` 紧接着就用
 *   `libc_getdate()`（系统当天）**覆盖** day/month/year（见 `rules/setup.ts`
 *   的 `defaultStartDate`），所以文件里那一份日期根本不作数 ——
 *   我们照同一条走（`startGame` 里注入系统当天）。
 */
function loadConfigFromStore(): void {
  const cfg = decodeConfig(configStore().read());
  if (cfg === null) return;
  options = {
    ...options,
    speed: cfg.speed,
    animation: cfg.animation,
    music: cfg.music,
    sound: cfg.sound,
    autoSave: cfg.autoSave,
    windowView: cfg.view,
  };
  optionsKeys = configHotkeyKeys(cfg);
}

/**
 * 把当前设定 + 键位整份写回 `RICH4.CFG` —— 設定屏与熱鍵頁的「確定」各调一次。
 *
 * @source `rich4_write_config()` VA 0x00411f80：
 *   `fwrite(&global_rich4_cfg, sizeof(global_rich4_cfg), 1, fp)`（整份覆盖）。
 *
 * ★ 日期那三个字节写的是**当前这一局的日期**（`CFG+8` 就是它，
 *   日推进 `fcn_00452117(&CFG+8)` 逐日改的就是这一格）——
 *   不在对局里时退回 `optionsDate`。
 */
function saveConfigToStore(): void {
  const d = screen === 'game' ? { year: state.year, month: state.month, day: state.day } : optionsDate;
  const bytes = encodeConfig({
    speed: options.speed,
    animation: options.animation,
    music: options.music,
    sound: options.sound,
    autoSave: options.autoSave,
    view: options.windowView,
    year: d.year,
    month: d.month,
    day: d.day,
    // ⚠️ 写回去的是**word**（低字节键、高字节修饰），与 `rich4_key_t` 同布局
    hotkeys: optionsKeys.map((w) => ({ vk: w & 0xff, mod: (w >> 8) & 0xff })),
  });
  const err = configStore().write(bytes);
  if (err !== null) log(`⚠ 設定檔寫入失敗：${err}`);
}

/**
 * 把熱鍵頁那份 **28 个 word** 翻成 `hotkeyOf` 要的 `KeyBinding[]`。
 *
 * ★ 每一条是 `rich4_key_t`（`rich4_config_file.h`）：**低字节 = 键、高字节 = 修饰键**
 *   —— 原版键位表 `0x47edc2` 的 dump 就是 `38 39 40 37 … 81 17`，
 *   末条 `(81,17)` = 低字节 `0x51`('Q') + 高字节 `0x11`(CTRL) = `CTRL-Q`。
 *   熱鍵頁的 `hotkeyAssign()` 也是按这个布局 `or` 进低字节、`0x11` 写 `0x1100`。
 *
 * ⚠️ 先前这里把整条 word 当成 `vk`、还另外从 `DEFAULT_BINDINGS` 猜修饰位 ——
 *   **错**：出厂第 28 条于是变成 `vk = 0x1151`（4433）而永远匹配不上，
 *   而 `Ctrl+Q`（原版「結束程式」）也就按不动了。2026-09-16 订正。
 *
 * @param keys 28 个 word（`HOTKEY_DEFAULT_KEYS` 的形态）
 */
function bindingsOf(keys: readonly number[]): KeyBinding[] {
  const out: KeyBinding[] = [];
  for (let i = 0; i < HOTKEY_DEFAULT_KEYS.length; i++) {
    const word = keys[i] ?? HOTKEY_DEFAULT_KEYS[i]!;
    out.push({ vk: word & 0xff, mod: (word >> 8) & 0xff });
  }
  return out;
}

/** 熱鍵頁等待按键时那条 250ms 的闪白定时器（原版 `SetTimer(hwnd, id, 0xfa, 0)`）*/
let hotkeyBlinkTimer: number | null = null;

/** 对话框正在填数的那一页；`null` 表示还在选项页 */
let amountPage: AmountPage | null = null;

/**
 * 通用填数页**开的时候**那串数字是 `"0"`，不是上限。
 *
 * @source VA 0x00452c91（`fcn_00452c02` 的 `0x401`＝建窗那一支）：
 * ```asm
 * 00452c99  mov byte [0x48caac], 0x30   ; buf[0] = '0'
 * 00452ca0  mov byte [0x48caad], ah     ; buf[1] = 0
 * ```
 * 那扇窗从头到尾只被这几处写过 `[0x48caac]`：建窗（这里）、C（`0x453145`）、
 * 退格（`0x45317d`）、接数字（`0x4531c4`）、夹上限 / M（`0x4530e9` 的 `itoa`）、
 * 拖金额栏到最左（`0x45341a`）—— **没有任何一处预填上限**。
 * ⇒ 想要上限得自己按 `M`（`loc_004530e9`）；「一开窗就按確定」＝ 没填（返回 0）。
 */
const AMOUNT_INITIAL = 0;

/**
 * 銀行 ATM 面板（T-029a）—— 原版的「存款/提款」不是通用填数页，
 * 是 `Panel.mkf` 资源 24 那台带数字键盘的 ATM（VA 0x4379c9）。
 * `atmFill` 就是那条选项自带的 `amount.fill`（金额定了才发得出去）。
 */
let atm: AtmState | null = null;
let atmFill: ((n: number) => Action) | null = null;
let atmLabel = '';
/**
 * ATM 正被按住的「码」（原版 `[0x48c40b]`，= 钮序号 + 1；`null` = 没按住）。
 *
 * 鼠标那一路由按下/抬起各写一次；**键盘那一路原版是「按下 → 假装抬手」**，
 * 所以这里记一个 `atmCodeAt`，下一拍（`BANK_TICK_MS`）就自动清掉 ——
 * 效果是按下图只亮一瞬，与「假抬手」同观感。
 */
let atmCode: number | null = null;
let atmCodeAt = 0;

/** 关掉 ATM 面板 */
function closeAtm(): void {
  atm = null;
  atmFill = null;
  atmCode = null;
}

/**
 * 金额栏拖到屏幕 x 处（原版 `loc_00437413` 的换算）。
 * 条内 x = 屏 x − 118（`0x76`），换算见 `atmSeekAmount`。
 */
function atmSeekTo(screenX: number): void {
  const st = atm;
  if (st === null) return;
  const n = atmSeekAmount(screenX - ATM_BAR.x, atmLimit(st));
  atm = { ...st, digits: n <= 0 ? '0' : String(n) };
  requestRender();
}

/** ↵ 確認：金额定了才发得出去（原版 `loc_004377e6` → `Post_0402_Message`）*/
function atmConfirm(): void {
  const st = atm;
  if (st === null) return;
  const n = Math.trunc(atmAmount(st));
  const fill = atmFill;
  closeAtm();
  if (n > 0 && fill !== null) {
    log(`▶ ${atmLabel} ${n}`);
    dispatch(fill(n));
  }
  requestRender();
}

/**
 * ATM 那几个键的 VK 码。
 *
 * `hotkeys.ts` 的 `vkOf()` 只覆盖熱鍵用得到的那些键，**没有数字与退格** ——
 * 所以这里补上 ATM 需要的那几类。★ 只认主键盘的 `Digit0..9`（VK 0x30..0x39），
 * 小键盘的 VK 是 0x60..0x69，原版那张表里**没有**它们，所以这里也不加。
 * @source `loc_004374ac` 的键表
 */
function atmVkOf(e: KeyboardEvent): number | null {
  const v = vkOf(e);
  if (v !== null) return v;
  if (e.code === 'Backspace') return 0x08;
  if (e.code.startsWith('Digit') && e.code.length === 6) {
    const d = e.code.charCodeAt(5) - 0x30;
    if (d >= 0 && d <= 9) return 0x30 + d;
  }
  return null;
}

/**
 * ATM 的 `0x100`（`WM_KEYDOWN`）：**原版键盘这一支与鼠标共用抬手那套分发**
 * （`loc_004374ac` 设 `[0x48c40b]` 后 `PostMessage(hwnd, 0x202, 0, 0)`），
 * 所以这里直接用 `atmApplyCode`（= `loc_0043762d` 的纯函数版）。
 *
 * @param code 钮序号 + 1（见 `ATM_KEY_VK`）；`4` = 金额栏
 */
function atmKey(code: number): void {
  const st = atm;
  if (st === null) return;
  atmCode = code;
  atmCodeAt = performance.now();
  const btn = code - 1;
  if (btn === 3) {
    // @source `loc_004375dc`：合成一次金额栏点击，坐标 (0xdc, 0xdf) = (220,223)
    atmSeekTo(0xdc);
    return;
  }
  if (btn === 2) {
    closeAtm();
    requestRender();
    return;
  }
  if (btn === 17) {
    atmConfirm();
    return;
  }
  if (btn === 0 || btn === 1) {
    const next = atmPress(st, btn, bankFrozen());
    if (next !== null) atm = next;
    requestRender();
    return;
  }
  atm = { ...st, digits: atmApplyCode(st.digits, code, atmLimit(st)) };
  requestRender();
}

/**
 * 貸款屏的界面状态（原版 `[0x48c3dd]` / `[0x48c3d5]` / `[0x48c3e1]` 那一串）。
 * `null` = 这一屏没开。
 */
let loanUi: LoanUi | null = null;
/** 上一次推进滑入 / 气泡的时刻（原版那 50ms 一拍）*/
let loanAt = 0;

/** 现在是不是「銀行暫停放款」状态 @source player+0x3c（`bankFreezeDays`）*/
function bankFrozen(): boolean {
  return (state.players[state.currentPlayer]?.bankFreezeDays ?? 0) !== 0;
}

/**
 * 銀行落点的第 ② 屏（貸款屏，T-029b）开着吗。
 *
 * 原版两屏的次序：ATM（`_rich4_ui_bank_atm_entry`）→ 貸款屏（`_rich4_ui_bank_entry`）。
 * ATM 开着时只画 ATM（它是模態的那一台）。
 */
function bankPending(): { chairman: boolean; hasLoan: boolean } | null {
  const p = state.pending;
  if (p === null || p.kind !== 'bank') return null;
  const me = state.players[state.currentPlayer];
  return { chairman: p.specialFinance !== null, hasLoan: (me?.loan ?? 0) !== 0 };
}

/** 贷款屏点了一颗钮 → 开对应的**填数页**（沿用银行对话里那一行的上限与 fill）*/
function openLoanAmount(op: LoanOp): void {
  const ui = currentDialog();
  if (ui === null) return;
  const idx = ui.choices.findIndex(
    (c) => c.amount !== undefined && c.action.type === 'bank' && c.action.op === op,
  );
  const c = idx >= 0 ? ui.choices[idx] : undefined;
  if (c?.amount === undefined) return;
  amountPage = { choice: idx, value: AMOUNT_INITIAL };
  dialogHot = null;
  requestRender();
}
let dialogHot: DialogHit | null = null;

// ── 貸款屏的动态部分（Q-BANK-1 / T-029c）────────────────────
//
// 原版 `fcn_00435062` 是个窗口过程：`0x401` 铺场、`0x405` 说第一句、
// `0x113` 定时器（50ms）推滑入与气泡、`0x201/0x202/0x205` 收鼠标、
// `0x409/0x40a` 是填数页回来。那些**纯逻辑**都在 `bank-dynamic.ts`，
// 本文件只做「事件进来 → 状态机 → effect 接上 IO」。

/** 定时器节拍（原版 `SetTimer(hwnd, 深度, 0x32, 0)` = 50ms）*/
const BANK_TICK_MS = LOAN_TICK_MS;

/** 气泡是哪一刻挂上的（到点自收，与商店同一支 `fcn_0044ee18`）*/
let loanBubbleAt = 0;

/**
 * 董事長眨眼（Q-BANK-1a）—— 子对话框 `fcn_00434492` 那一支的 100 ms 定时器。
 *
 * ★ 与贷款屏主屏那 50 ms **不是同一支**：`SetTimer(hwnd, id, 0x64, 0)` `:976`。
 *   状态机的细节（掷闸 1/1024、档 0→1→2、最后一拍恢复底图）见 `bank-loan.ts`
 *   的 `LOAN_BLINK_*`。这里只负责「什么时候走一拍」与「这一拍该盖哪张图」。
 */
let loanBlink: LoanBlink = LOAN_BLINK_IDLE;

/** 这一屏开着吗；开着就保证有一份界面状态（对应原版 `0x401` 铺场）*/
function syncLoanUi(): void {
  const p = state.pending;
  if (p === null || p.kind !== 'bank') {
    loanUi = null;
    return;
  }
  if (loanUi === null) {
    // ★ 那一句招呼归「動畫過程」管：@source `loc_00435200`（VA 0x00435200，銀行 `0x405` 那一拍）
    //   `cmp byte [0x497159], 0 / je → st = 3`（`[0x48c3d5]` 直接跳到「需要我為您服務嗎」
    //   那一档，**不**说 `#0075`）。`[0x497159]` 就是 `RICH4.CFG+1`（`rich4_read_config()`
    //   VA 0x00411e8f 把 72 字节读进 `0x497158`），本引擎对应 `options.animation`。
    //   先前这里写死 `true` —— 设定关掉也照样打招呼（已订正，见 Q-ANIM-1）。
    loanUi = loanStart(options.animation);
    // ★ 進銀行的配乐 @source `ui_bank.asm:3557` `push 4 / call fcn_004549cf`
    //   ⇒ id 4 → `MIDI05.MID` → 磁盘名 `midi05.mid`（表 `0x47e793`，见 `SCREEN_BGM.bank`）
    void playTrackFile('midi05.mid');
    loanAt = performance.now();
    loanBubbleAt = loanAt;
    // 计数器清零、下一拍从开屏那一刻起算（原版 `loc_0043453a` 的 `[0x48c3ce] = 0`）
    loanBlink = loanBlinkStart(loanAt);
  }
}

/** 把状态机给出的 effect 接上 IO（原版是 `PostMessage` / `Wait_0402_Message`）*/
function loanEffect(ui: LoanUi, effect: ReturnType<typeof loanStep>['effect']): void {
  const hadBubble = loanUi?.bubble ?? null;
  loanUi = ui;
  if (hadBubble !== ui.bubble) loanBubbleAt = performance.now();
  if (effect === null) return;
  if (effect.kind === 'close') {
    loanUi = null;
    dispatch({ type: 'declineDecision' });
    return;
  }
  if (effect.kind === 'financeClosed') {
    // 子对话框自己给自己发的那条消息（`Post_0402_Message`）—— 绕回来走状态机
    loanSend({ kind: 'financeClosed', ok: effect.ok });
    return;
  }
  // 只剩 openForm：★ op 直接透传（`LoanOp` 四值都在 `currentDialog()` 的 choices 里）——
  // 先前写成 `op === 'borrow' ? 'borrow' : 'repay'`，于是 **`financeBorrow`
  // 会被当成 `repay`**（Q-BANK-1a 接三颗小钮时撞出来的）。
  openLoanAmount(effect.op);
}

/** 走一步状态机并把 effect 接上 */
function loanSend(ev: Parameters<typeof loanStep>[1]): void {
  const ui = loanUi;
  if (ui === null) return;
  const r = loanStep(ui, ev);
  loanEffect(r.ui, r.effect);
}

/**
 * 填数页回来了 —— 原版 `0x409`/`0x40a` 拿到 `fcn_00453544` 的返回值那一刻。
 *
 * | 状态 | 原版判据 | 结果 |
 * |---|---|---|
 * | 借款 | 额 > 0 | `st=7` + 「貸款手續完成」|
 * | 借款 | 额 = 0 | `st=8`（不挂气泡，下一拍滑回去）|
 * | 还款 | 额 > 现金+存款 | `st=9` + 「您的現金不足」|
 * | 还款 | 额 ≤ 现金+存款 | `st=8` + 「還款手續已完成」|
 */
function loanFormClosed(amount: number): void {
  if (loanUi === null) return;
  const me = state.players[state.currentPlayer];
  loanSend({
    kind: 'formClosed',
    amount,
    cash: me?.cash ?? 0,
    deposit: me?.moneyInBank ?? 0,
  });
}

/**
 * 貸款屏每帧走一次（对应原版那支 50ms 的 `0x113` 定时器）：
 * 推滑入、气泡到点（`fcn_0044ee18` —— **没有气泡时它也返回 1**）、
 * 键盘按下码那一瞬的清除。
 */
function bankTick(now: number): void {
  if (atmCode !== null && now - atmCodeAt >= BANK_TICK_MS) atmCode = null;
  if (loanUi === null) return;
  // ★ 董事长眨眼：**子对话框那一支自己的 100 ms 定时器**，与下面那 50 ms 分开数；
  //   而且它只在「填数页没开着」时才走 @source `0x4347a2` 的 `cmp [0x48c3cc], 4 / je`。
  if (loanUi.financeOpen && amountPage === null) {
    const next = loanBlinkStep(loanBlink, now, Math.random);
    if (next !== loanBlink) {
      loanBlink = next;
      requestRender();
    }
  }
  if (now - loanAt < LOAN_TICK_MS) return;
  loanAt = now;
  if (!loanSlideDone(loanUi.slide)) {
    loanUi = { ...loanUi, slide: loanSlideStep(loanUi.slide) };
  }
  const bubble = loanUi.bubble;
  if (bubble === null || now - loanBubbleAt >= LOAN_BUBBLE_MS) {
    loanSend({ kind: 'bubbleEnd' });
  }
}

/**
 * 这一刻两块滑入面板该画什么 —— 全部取自玩家记录与全局日期。
 *
 * | 面板上 | 原版 |
 * |---|---|
 * | 头像 | `[0x498eb0 + 0x34×玩家] + 0xc` = `map.mkf` 资源 `角色+0x1b` 图 0（`portraitResource`）|
 * | 名字 | `player+0x00` |
 * | 現金/存款/貸款 | `player+0x1c/0x20/0x24` |
 * | 年/月/日/星期 | `[0x497160]`（打包日期）+ `0x47511c` 星期名表 |
 * | 節日插画 | `fcn_004521f0(今天) != −1` 时整张盖掉季节底图 |
 * | 距還款日 | `player+0x2c`（还款到期日）与今天的天号差 @source `fcn_004521aa` |
 */
function loanPanelView(ui: LoanUi): LoanPanelsView {
  const me = state.players[state.currentPlayer];
  const today = { year: state.year, month: state.month, day: state.day };
  const packed = me?.loanDueDate ?? 0;
  const due =
    packed === 0
      ? null
      : { year: packed >>> 16, month: (packed >>> 8) & 0xff, day: packed & 0xff };
  return {
    slide: ui.slide,
    character: me?.character ?? 0,
    name: me === undefined ? '' : (CHARACTERS[me.character]?.name ?? ''),
    money: [me?.cash ?? 0, me?.moneyInBank ?? 0, me?.loan ?? 0],
    date: today,
    weekday: weekdayOf(today.year, today.month, today.day),
    globalMapId: state.globalMapId,
    holidayArt,
    dueDays: due === null ? null : loanDueDays(today, due, dayNumberSince1998),
  };
}

// ── 股市屏（T-030）────────────────────────────────────────
/** 现在看的是哪一页（0 行情 / 1 持股） —— 点页码牌换 @source loc_0042aec4 */
let stockPage = 0;
let stockHover: number | null = null;
/** 选中的行（0 基）—— 原版 `[0x48c2eb]` 是 1 基，这里换成本地口径 */
let stockSel: number | null = null;
/**
 * 股市那一屏的**填数页**（買進／賣出股数）。
 *
 * 原版走的是通用填数函数 `fcn_00453544(上限)`；引擎那条路只服务
 * `pending` 对话，所以这里拿它自己的那一份状态合成一个「对话」出来，
 * 把通用的排版与命中（`drawDialog` / `hitDialog` / `onDialogHit`）复用上。
 */
let stockAmount: { kind: 'buy' | 'sell'; stock: number; max: number } | null = null;
/**
 * 「上市公司資訊」详情卡开着时是**哪一支**（`null` = 没开）。
 *
 * @source `loc_0042b203`：`Wait_0402_Message(fcn_00429d65, 选中行−1)`。
 * 那一屏没有可点的东西：**左键或右键抬起都直接退卡**（`loc_0042aa08`）。
 */
let stockDetail: number | null = null;

/**
 * **选股模式**（Q-PICK-2）—— 紅卡/黑卡借股市屏选一支股票。
 *
 * 非 `null` 时 `screen === 'stock'` 但这一屏只干「点一行 → 抛回行号」：
 * 原版就是 `_rich4_ui_stock_entry` 带了参数 1/2（`[0x48c2ed]` 那个模式）。
 * 悬停反馈是**白框**（`pickHover`），点中之后那一支当场涨/跌 **10%**、停 1 秒再收屏。
 * @source `loc_0042b0da` / `loc_0042adf3`
 */
let stockPick: { cardId: number; mode: StockPickMode } | null = null;
/**
 * 选中之后到收屏之间的 1 秒 —— 原版 `0x45285e(0x3e8)` 是**阻塞**等待，
 * 这里用定时器（`dispatch` 已经把那支股票涨/跌好了，这一秒是给玩家看的）。
 */
let stockPickAt: number | null = null;

/**
 * 遙控骰子那盘点数盘（道具 8，Q-PICK-2）—— 盖在棋盘上的模态小盘。
 * `hover` = 悬停的骰面 1..6（0/null = 没有）。
 * @source `rich4_tool_yaokongtouzi.asm` **VA 0x004470f8** 起
 */
let dicePick: { hover: number | null } | null = null;

/**
 * 下一条 `rollDice` 是**遥控骰子**定死的点数 → 不播预动作/滚骰（试玩回报：
 * 「选择了1点应该是直接跳过正常扔骰子阶段然后让角色走1点」）。
 *
 * ★ 点数由 `dice-choose.ts` 的 `remoteDiceActions` 写进 `forcedDice`，这里只掐表现；
 *   纯客户端状态，不进 `GameState`（点数的真值仍在 core）。
 */
let forcedRollSkipFx = false;

/** 该股对应的地图企业（没上市就返回 null）@source 股票记录 +4 = 企業序号 */
function stockCommercial(stockIndex: number): { type: number; stockIndex: number } | null {
  const comm = state.market.stocks[stockIndex]?.commercialIndex ?? 0;
  if (comm === 0) return null;
  const c = map.commercials.find((x) => x.id === comm);
  return c === undefined ? null : { type: c.type, stockIndex: c.stockIndex };
}

/** 开详情卡 @source `loc_0042b0b7`（上市公司資訊）/ `loc_0042b1a4`（再点选中那行）*/
function openStockDetail(stockIndex: number): void {
  stockDetail = stockIndex;
  requestRender();
}

function closeStockDetail(): void {
  if (stockDetail === null) return;
  stockDetail = null;
  requestRender();
}

/** 详情卡要画的东西 */
function stockDetailView(): StockDetailView | null {
  if (stockDetail === null) return null;
  return stockDetailFrom(
    state,
    stockDetail,
    state.currentPlayer,
    stockNames(),
    state.players.map((p) => CHARACTERS[p.character]?.name ?? `角色${p.character}`),
    stockCommercial(stockDetail),
  );
}

function openStock(): void {
  if (screen === 'stock') return;
  stockPage = 0;
  stockHover = null;
  stockSel = null;
  stockAmount = null;
  amountPage = null;
  dialogHot = null;
  screen = 'stock';
  requestRender();
}

function closeStock(): void {
  if (screen !== 'stock') return;
  screen = 'game';
  stockDetail = null;
  stockAmount = null;
  amountPage = null;
  dialogHot = null;
  stockPick = null;
  stockPickAt = null;
  requestRender();
}

/**
 * 开**选股模式**（Q-PICK-2）：紅卡/黑卡借股市屏点一支股票。
 *
 * @source 紅卡 VA 0x00444fea 起（`push 1` 在 0x00444ff8）/ 黑卡 VA 0x004450ae 起
 *   （`push 2` 在 0x004450bc）—— 都是
 *   `push mode; call _rich4_ui_stock_entry`，参数 1 = 紅、2 = 黑；
 *   非 0 返回 = 行号（1 基）= 选中的股票。
 */
function openStockPick(cardId: number, mode: StockPickMode): void {
  stockPage = 0;
  stockHover = null;
  stockSel = null;
  stockAmount = null;
  amountPage = null;
  dialogHot = null;
  stockPick = { cardId, mode };
  stockPickAt = null;
  screen = 'stock';
  requestRender();
}

/**
 * 选股模式下点中第 `row` 行。
 *
 * ★ 原版在**抛回行号之前**先把 `newsFlag` 打上、`0x429040(row)` 当场把价格算出来，
 *   再停 1 秒（@source `loc_0042b0da` 的 `0x45285e(0x3e8)`）。
 *   本引擎把「改行情」收在 core（C-ARC-2），所以这里**先 dispatch**——
 *   那一支当场涨/跌好，屏上停 1 秒给玩家看，然后收屏。
 */
function stockPickChoose(row: number): void {
  const pick = stockPick;
  if (pick === null || stockPickAt !== null) return;
  const act = stockPickCardAction(pick.cardId, row);
  if (act === null) return;
  // @source `loc_0042b19c` 那一声播的是点中音（0x482322 = 1）
  sound.play('Effect.mkf', SOUND_IDS.TITLE_CLICK);
  dispatch(act);
  stockPickAt = performance.now();
  requestRender();
  // 反馈这一秒过完就收屏（`closeStock` 顺手把 stockPick 清掉）
  window.setTimeout(() => {
    if (stockPick === null) return;
    if (performance.now() - (stockPickAt ?? 0) < STOCK_PICK_FEEDBACK_MS) return;
    stockPickAt = null;
    closeStock();
  }, STOCK_PICK_FEEDBACK_MS);
}

/**
 * 取消选股（右键）：原版 `loc_0042b22f` 在 page == 0 时 Post(0) 抛回 0 ——
 * 卡不消耗，而 `_rich4_ui_use_card_entry` 见返回 0 就**把卡片欄再开回来**
 * （@source `loc_00441ce1` 的 `je loc_00441c22`）。故这里也照做。
 */
function cancelStockPick(playSound = true): void {
  const pick = stockPick;
  if (pick === null) return;
  // @source `loc_0042b25a` 的 `play_sound_effect(0x482332)` —— 音效 4
  //   ⚠️ 休市那条路（訊息框 `loc_0042aa08`）**没有**音效，故留一个开关
  if (playSound) sound.play('Effect.mkf', STOCK_PICK_CANCEL_SOUND);
  stockPick = null;
  stockPickAt = null;
  closeStock();
  // 抛回 0 ⇒ `_rich4_ui_use_card_entry` 把卡片欄再开回来（@source `loc_00441ce1`）
  openInventory('cards');
}

/** 12 支股票的名字 —— core 的状态不带名字，在 `@rich4/data` 的表里 */
function stockNames(): string[] {
  return stocksOfMap(state.globalMapId).map((s) => s.name);
}

/** 这一屏要画的东西 */
function stockView(): StockView {
  const me = state.players[state.currentPlayer];
  return {
    page: stockPage,
    closed: stockCounterClosed(state),
    deposit: me?.moneyInBank ?? 0,
    rows: stockRowsFrom(state, state.currentPlayer, stockNames()),
    // 持股页的页头要竖着排各玩家的名字（原版读 `player+0` 那个字符串）
    playerNames: state.players.map(
      (p) => CHARACTERS[p.character]?.name ?? `角色${p.character}`,
    ),
    // ★ 选股模式走的是**另一条支路**（`loc_0042abbb`）：普通屏那套悬停/选中不画，
    //   只画一个白框（`pickHover`）
    hover: stockPick === null ? stockHover : null,
    selected: stockPick === null ? stockSel : null,
    pickHover: stockPick === null ? null : stockHover,
  };
}

/** 点某一行的**动作**：没选中就先选中；已选中的再点一下 = 上市公司資訊（T-030b 未做）*/
function stockPickRow(row: number): void {
  if (stockSel === row) {
    // 在**已选中**那一行上再点一下 = 开详情卡 @source `loc_0042b1a4` 的 PostMessage(0x40b)
    log('▶ 上市公司資訊');
    openStockDetail(row);
    return;
  }
  stockSel = row;
  requestRender();
}

/** 買進 / 賣出 @source `loc_0042aee4` / `loc_0042afff` */
function stockTrade(kind: 'buy' | 'sell'): void {
  const row = stockSel;
  if (row === null) return;
  const st = state.market.stocks[row];
  const me = state.players[state.currentPlayer];
  if (st === undefined || me === undefined) return;
  // 停牌那支两支都不理 @source `cmp byte [stocks+6], 0 / jne 退`
  if (st.f6 !== 0) return;
  const status = stockStatus(st.openPrice, st.price);
  if (kind === 'buy') {
    if (status === STOCK_STATUS.limitUp) {
      log(`▶ ${STOCK_NO_BUY}`); // @source 串 0x464088
      return;
    }
    // 上限 = min(流通量, 存款 ÷ 股价) @source `loc_0042af30`
    // ★ 算式收在 `stock-screen.ts` 的 `stockCounterBuyMax`（与上市企業那条
    //   并列：两条上限都由模块给出，这里只把结果交给通用填数窗）
    const max = stockCounterBuyMax(me.moneyInBank, st.price, st.f10);
    if (max <= 0) return;
    stockAmount = { kind: 'buy', stock: row, max };
  } else {
    if (status === STOCK_STATUS.limitDown) {
      log(`▶ ${STOCK_NO_SELL}`); // @source 串 0x464097
      return;
    }
    const held = state.holdings[state.currentPlayer]?.[row]?.amount ?? 0;
    if (held <= 0) return;
    stockAmount = { kind: 'sell', stock: row, max: held };
  }
  amountPage = { choice: 0, value: AMOUNT_INITIAL };
  dialogHot = null;
  requestRender();
}

/**
 * 把股市的填数页交给通用排版用。
 *
 * ★ 壳子本体在 `amount-form.ts`（那里能单测）—— 它交出的就是
 *   `interactions.ts` 各条 `amount` 的那种形状，版式/命中一律走
 *   `dialog.ts` 的 `layoutDialog` / `hitDialog` / `drawDialog`。
 *   本文件**不**再自己排这一页。
 */
function stockAmountUi(): InteractionUi | null {
  const a = stockAmount;
  if (a === null) return null;
  return stockAmountForm(a, stockNames()[a.stock] ?? '');
}

// ── 存讀檔屏 ───────────────────────────────────────────────
let saveLoadMode: SaveLoadMode = 'load';
let saveLoadReturn: Screen = 'title';
let saveLoadSlots: SlotInfo[] = [];
let saveLoadHot: number | null = null;

function openSaveLoad(mode: SaveLoadMode, from: Screen): void {
  saveLoadMode = mode;
  saveLoadReturn = from;
  saveLoadSlots = readSlots(mode === 'load' ? LOAD_SLOTS : SAVE_SLOTS + 1);
  saveLoadHot = null;
  screen = 'saveload';
  requestRender();
}

function closeSaveLoad(): void {
  screen = saveLoadReturn;
  saveLoadHot = null;
  requestRender();
}

/** 选中了某一行 */
function onSaveLoadRow(row: number): void {
  const slot = slotOfRow(saveLoadMode, row);
  if (saveLoadMode === 'save') {
    const err = writeSlot(slot, state);
    log(err === null ? `▶ 已存入第 ${slot} 格` : `⚠ 存檔失敗：${err}`);
    if (err === null) closeSaveLoad();
    else saveLoadSlots = readSlots(SAVE_SLOTS + 1);
    requestRender();
    return;
  }
  const info = saveLoadSlots.find((x) => x.slot === slot);
  if (info === undefined || info.state === null) {
    log(info !== undefined && info.error !== null ? `⚠ 第 ${slot} 格讀不出來：${info.error}` : `⚠ 第 ${slot} 格是空的`);
    return;
  }
  loadState(info.state);
}

/**
 * 把读出来的状态接上。
 *
 * ★ 地图要跟着换：存档里记着 `globalMapId`，不换的话棋子会落在另一张图的
 *   节点号上 —— 那种错不会立刻报，会在几步之后以「走到了奇怪的地方」出现。
 */
function loadState(next: GameState, mapOverride: Rich4Map | null = null): void {
  if (net !== null) {
    log('⚠ 聯機中不能讀檔：局面由伺服器的 action 流決定');
    return;
  }
  // ★ 匯入原版存檔时传 `mapOverride`（= 存档自带那块地图）——状态与画面必须同一张图。
  map = mapOverride ?? parseMap(readMapData(archives, next.globalMapId));
  topo = {
    nodes: map.nodes,
    lands: map.lands,
    facilities: map.facilities,
    commercials: map.commercials,
    landscapes: map.landscapes,
  };
  // ★★ 单机读档后重新播种（原版 `0x402FA1` 的 `srand(GetTickCount())`）——
  //   这就是「读档重开刷结果」：同一份存档读两次，之后的骰子/股价/事件都不一样。
  //   原先没有任何宿主接线，原版存档导入路径给的还是固定占位 `1` ⇒ 每次都一样。
  state = reseedAfterLoad(next, topo);
  history.length = 0;
  recorder.reset();
  hoverNode = null;
  nodeTip = null; // 换局面/读档时把名牌收掉（Q-HOVER-1）
  amountPage = null;
  const first = map.nodes[state.players[state.currentPlayer]?.nodeId ?? 1];
  camera = characterCamera(first?.x ?? 0, first?.y ?? 0, state.viewRotation);
  screen = 'game';
  // ★ 读档进棋盘：背景曲换**下一首** @source `sub_00401981(1)` → `0x004019c6 push 0 / call sub_00454d91`
  holidayBgmDays = 0; // @source 0x00404128 读档清零（節日曲不进存档）
  playBoardBgm(0);
  log(`▶ 讀檔：地圖 ${next.globalMapId}　${next.year}/${next.month}/${next.day}`);

  setGround(null);
  void loadGround(archives, next.globalMapId, hdSource).then((g) => {
    setGround(g);
    requestRender();
  });
  loadMinimapAssets(next.globalMapId);
  requestRender();
  renderPanel();
  scheduleAi();
  scheduleHumanTurn();
}

/**
 * 人类回合里那些**没得选**的步骤，由这个定时器自己走完。
 *
 * ★ 原版里玩家只按一次「前進」，棋子就自己走完并停在落点上。先前本引擎
 *   把 `startTurn / step / settle / endTurn` 全做成了调试抽屉里的按钮，
 *   而抽屉默认收起——于是正常开局时**连骰子都掷不了**。
 *
 * 停下来等人的只有两处：`awaitingRoll`（等「前進」）与 `awaitingDecision`
 * （等对话框）。**岔路没有交互** —— 原版从不问玩家走哪边（见 core 的
 * `pickNextNode`）。
 */
let humanTimer: number | null = null;

/**
 * 两个自动步骤之间隔多久。
 *
 * ★ 不再是「我们拍的三个毫秒数」：
 *   一格要走 `N` 个 tick（`N = trunc(距离 / 走子速度)`，见 `tween.ts`），
 *   一个 tick 是 `20ms × [6,4,2,0][游戏速度]`（见 `tick.ts`）——
 *   所以「走一步」的节拍就是这段补间的时长，必须等它播完才走下一步，
 *   否则棋子会在半路被瞬移打断。
 *   非走子的步骤（回合开始/结算/收尾）至少等一个 tick。
 */
function humanDelay(): number {
  if (!options.animation) return 0;
  return paceDelay();
}

/**
 * 两条机械步骤之间该等多久：至少一个 tick；刚起了一段走子补间就等它**剩下的**那一截。
 * 真人（`humanDelay`）与电脑（`aiDelay`）共用 —— 原版不分人机，都是同一个 tick 循环在推。
 */
function paceDelay(): number {
  return Math.max(tickMs(options.speed), renderer.walkRemainingMs());
}

/**
 * 替身那一趟**播完了吗** —— 派下一步之前的一道闸（T-047）。
 *
 * ★ 为什么 `humanDelay()` 挡不住它：替身的整趟是在**一次** `dispatch` 里跑完的
 *   （core 的 `npcRound` / `bail` / 道具 1），而它的补间要等下一次 `draw()` 才起得来 ——
 *   排定时器的那一刻 `renderer.actorWalkRemainingMs()` 还是 0，`lastWalkMs()`
 *   又只看玩家那条，两个都帮不上忙。不挡的后果：替身滑到一半，下一次
 *   `dispatch` 就把画面打断（看上去还是瞬移）。
 *
 * 判据分两问：
 *  ① `renderer.walkDone()`（**已含替身那条**）为假 → 正在播，重排定时器即可；
 *  ② 为真、但 `state.lastNpcWalks` 换过一份新的 → 有一趟刚发生，而 `draw()`
 *     可能还没轮到它（补间是在 draw 里起的）。这种情况**等一帧（rAF）**再问，
 *     让 draw() 有机会把补间起起来；同一份只等一次（记进 `npcWalksDrawn`），
 *     不会为同一趟反复等 —— 「動畫過程」关掉或路径不足两格时补间压根不起，
 *     那天第二问当场放行，所以**不会死等**。
 *
 * 放在**两个自动驱动**（`scheduleHumanTurn` / `scheduleAi`）的定时器回调开头：
 * 只有它们会「替玩家/电脑」连着派 action；人手点按钮那种 dispatch 不在此列
 * （那时不会同时有替身在走，见上面 `humanDelay` 的注释）。
 *
 * @param reschedule 被挡下时怎么重排（两个驱动各自的排程函数）
 * @returns true = 已重排，调用方直接 return，别派下一步
 */
let npcWalksDrawn: GameState['lastNpcWalks'] | null = null;

/**
 * **演出类整屏** —— 事件起播、自己计时（或等一下点击）收屏，期间棋局不许往前走。
 *
 * ★★ 2026-09-19（第三份试玩回报 1/5/9/12 的共同根因）：原版的每一段演出都是**同步/模态**的
 *   （魔法屋 `modal_msg_pump`、事件框 `fcn_004544f6` 的等待循环、月結 / 開獎 / 分紅屏各自的模态循环…），
 *   演出期间主循环根本不跑。本引擎的 core 一条 action 就把后果写完，演出是事后补的 ——
 *   而两个回合驱动（`scheduleAi` / `scheduleHumanTurn`）先前**只等走子与几段棋盘影片**，
 *   不等整屏演出：魔法屋屏还在说开场白，后面三家电脑已经走完了（实测停在開場白时棋局已到第 3 回合）；
 *   事件框因为「上一段没播完就丢掉新的一段」，电脑踩到命運 / 新聞时经常一声不响。
 *
 * ⚠️ 只列**纯演出**的屏。待决交互类（拍賣 / 樂透投注 / 研究所 / 小遊戲 / 買賣框）不在此列 ——
 *   它们要靠回合驱动或屏自己把 `pending` 答掉，挡了会死锁。
 */
const BLOCKING_PRESENTATIONS: ReadonlySet<string> = new Set([
  'shares',
  'lottery-draw',
  'monthly',
  'magic',
  'eventBox',
  'notice',
  'wheel',
  'god-slot',
]);

/**
 * 此刻是不是有一段**纯演出**在接管整屏（判据就是上面那张表）。
 *
 * ★ 抽出来给两处共用：`holdForActorWalk` 的闸，以及 `speechTick` 的**台词冻结**。
 */
function blockingPresentation(): boolean {
  const overlay = activeUiScreen();
  return overlay !== null && BLOCKING_PRESENTATIONS.has(overlay.id);
}

function holdForActorWalk(reschedule: () => void): boolean {
  if (screen !== 'game') return false;
  if (blockingPresentation()) {
    reschedule();
    return true;
  }
  if (!renderer.walkDone()) {
    reschedule();
    return true;
  }
  // ★ 投掷动效（放置類道具）也在播 → 等它播完再派下一步：原版那一段
  //   `place_object → animate_object → 音效` 是**阻塞**的（VA 0x00446bf4 起），
  //   不等就会出现「物件还在飞，下一次 dispatch 已经把画面翻页了」。
  if (objectFlight !== null) {
    reschedule();
    return true;
  }
  // ★ 建屋影片（機器工人）同理，而且原版这一段的阻塞更长
  //   （大锤 3876 ms + 满级 2772 ms，`fcn_0045144f` 是**同步**播放的）——
  //   不等就会出现「影片还在放，AI 已经把下一条 action 派完了」。
  if (buildFx !== null || pendingBuildFx !== null) {
    reschedule();
    return true;
  }
  // ★ 送進監獄／醫院那段影片同理，而且原版是**阻塞**的（`fcn_0045144f` 自己的
  //   `PeekMessage` 循环）：医院 62×100 ms = 6.2 秒、入獄 35×71 ms ≈ 2.5 秒。
  //   不等它播完就派下一步，动画就会被下一次棋盘重绘吃掉。
  if (boardFilm !== null || pendingBoardFilm !== null) {
    reschedule();
    return true;
  }
  // ★★ 「踩到惡犬」那一段（狗咬 → 救护车）**也是同一份** `boardFilm` 状态，
  //   所以上面那一条已经把它挡住了；这里多守一道 `pendingBoardFilmAfter`，
  //   防的是「狗咬刚播完、救护车还没起播」那一拍的空档
  //   （@source 两只影片都是阻塞的 `fcn_0045144f`，见 `dog-fx.ts` 的文件头）。
  if (pendingBoardFilmAfter !== null) {
    reschedule();
    return true;
  }
  if (state.lastNpcWalks.length > 0 && state.lastNpcWalks !== npcWalksDrawn) {
    npcWalksDrawn = state.lastNpcWalks;
    requestAnimationFrame(reschedule);
    return true;
  }
  // ★★ 还有台词在演 → 等它演完再派下一步。
  //
  //   原版 `_rich4_player_say`（VA 0x0044ef41）是**阻塞**的：画完字幕/表情后
  //   `push 0x3e8 / call fcn_004544f6`（VA 0x0044f1a6）—— 那是个
  //   「等消息或到点」的循环（VA 0x00454520 起 `PeekMessage` + `timeGetTime` 比对，
  //   超时才 `0x4545b1` 返回）。也就是说：**原版在角色把一句话说完（0x3e8 ms）
  //   之前，调用它的那整条回合流程根本不往下走**。
  //   本引擎的队列是异步的，不挡就会出现「上一句还没说完，下一个 NPC 已经开始行动」。
  //
  //   ★ 判据取 `speechQueue.length > 0`：队列只在 `speechTick()` 里逐段收
  //   （`speechQueue.tick`），而 `speechTick` 在演出期间**被冻结**（见那里），
  //   所以「屏还在演」与「台词还没演完」两件事由这一条一并挡住。
  if (speechQueue.length > 0) {
    reschedule();
    return true;
  }
  return false;
}

/**
 * 自動存檔。
 *
 * @source RICH4.CFG offset 4 `auto save: 01 enabled`；原版的自動存檔占
 *   **0 号槽**，所以 LOAD 屏比 SAVE 屏多一行（见 saveload.ts）。
 *
 * ⚠️ 什么时机存、存几次，原版没查证。这里取「每个真人回合开始存一次」——
 *   与時光機的快照同一个时机，也是最有用的那个点。
 */
function autosaveIfEnabled(): void {
  if (!options.autoSave) return;
  if (screen !== 'game') return;
  if (state.phase !== 'awaitingRoll') return;
  if (isAiTurn(state)) return;
  // 联机的局面由服务器的 action 流决定，读档会把本机拉离同步；先不存
  if (net !== null) return;
  const err = writeSlot(AUTOSAVE_SLOT, state);
  if (err !== null) log(`⚠ 自動存檔失敗：${err}`);
}

/** 真人那条驱动这一次排程是不是「演出还没播完，回头再看一眼」 */
let humanRepoll = false;

function scheduleHumanTurn(): void {
  if (humanTimer !== null) {
    clearTimeout(humanTimer);
    humanTimer = null;
  }
  if (screen !== 'game') return;
  // 联机：别人的回合由他的客户端（或服务器代打）推进，本机只看
  if (!localSeatActive()) return;
  // 轮到电脑就交给 scheduleAi，别两个驱动同时动手
  if (isAiTurn(state) || autoAction(state) !== null) return;
  // 掷骰那一段还在播 —— 交给 dicePoll，别两条驱动同时动手
  if (diceFx.active) return;
  const next = mechanicalAction();
  if (next === null) return;
  humanTimer = window.setTimeout(() => {
    humanTimer = null;
    // ★ 节拍闸（T-047）：替身还在滑就重排、绝不派下一步 —— 判据见 holdForActorWalk
    // 被演出挡下时按一个渲染周期回头看（`humanDelay()` 在「動畫過程 = 关」时是 0，会变成空转）
    if (
      holdForActorWalk(() => {
        humanRepoll = true;
        scheduleHumanTurn();
      })
    ) {
      return;
    }
    if (next.type === 'step') stepTick();
    dispatch(next);
  }, humanRepoll ? RENDER_MS : humanDelay());
  humanRepoll = false;
}

/** 当前这一步是不是「没得选」的 —— 是就返回它，否则 null */
function mechanicalAction(): Action | null {
  // ★ **有待决交互就一律停下**，跟阶段无关。
  //   銀行/樂透/百貨/拍賣 这几种落点给出 pending 时阶段已经是 `turnEnd`，
  //   而 `turnEnd` 在下面是要自动 `endTurn` 的 —— 那会把交互一起清掉，
  //   于是真人永远进不了这几个场所。
  if (state.pending !== null && state.pending.kind !== 'none') return null;
  // ★ 掷骰那一段（预动作 + 滚骰 + 500ms 定格）没播完就不许走子 ——
  //   原版这三段是**串行**的（`fcn_0040d7c4` 每 tick 只走一个状态）。
  if (diceFx.active) return null;
  switch (state.phase) {
    case 'turnStart':
      return { type: 'startTurn' };
    case 'moving':
      return { type: 'step' };
    case 'settling':
      return { type: 'settle' };
    case 'turnEnd':
      // ★ 回合边界的惡人段（T-047 的 D-T047-5）：这一輪还有惡人没走就得先走一个。
      //   判据与 core 的 `autoAction` **同源**（那边也把它们放在最前面），
      //   这里照抄一遍是为了让「真人回合」这条路也能把惡人段走完 ——
      //   `scheduleAi` 只在电脑回合动手，真人等到自己回合时游标已经过了惡人。
      if ((state.pendingNpcSlots ?? []).length > 0) return { type: 'npcStep' };
      return { type: 'endTurn' };
    default:
      return null; // awaitingRoll / awaitingDecision：等人
  }
}

/** 给 gameui/dialog 用的同步取图 —— 与 spriteNow 同一个缓存 */
const uiSprite: SpriteFn = (archive, resource, index, colorKeyBlack = false) =>
  spriteNow(archive, resource, index, colorKeyBlack);

/**
 * 这个玩家最多能掷几颗骰子。
 *
 * @source 原版把上限放在 `traffic_method`（player +0x11）里：走路 1、機車 2、
 *   汽車 3（VA 0x004172e6 `al = [+0x11] & 3` 后按 0/1/2/3 走四路跳表）。
 * ⚠️ 本引擎还没有交通工具，恒为 1；`ndices`（+0x12）已经在模型里了。
 */
function maxDiceOf(p: { trafficMethod: number }): number {
  return VEHICLE_DICE.get(p.trafficMethod & 3) ?? 1;
}

/**
 * 「取消」这一拍 —— 从最上面那一层开始收。
 *
 * ★ **ESC 与右键都走这里**，因为原版两者本来就是同一条消息：
 *   全局键盘钩子把 RICH4.CFG 的取消键补成 `WM_RBUTTONUP (0x205)`
 *   （@source VA 0x004011c3），而主窗口过程只把它交给 `windowCallbacks` 栈顶
 *   （@source rich4_main VA 0x00401b33）—— 所以每一屏「关窗」的副作用
 *   （放取消音、清掉选中行、退回上一页、返回 0/−1…）也必须一致。
 *   梯子本身与逐层的取证 VA 在 `panel-cancel.ts` 的 `CANCEL_LADDER`。
 *
 * ⚠️ **不在梯子里**的那一条：右键清掉小地图标记（没有模态窗口时钩子不发 0x205，
 *   而是置 `[0x46caff]`，@source VA 0x004011af）—— 它只挂右键，见 `contextmenu`。
 *
 * @returns true = 这一拍有人接了（调用方该把事件吃掉）
 */
function cancelTopPanel(): boolean {
  const layer = cancelLayerOf({
    screen,
    overlay: activeUiScreen() !== null,
    pick: pick !== null,
    dicePick: dicePick !== null,
    atm: atm !== null,
    dialog: currentDialog() !== null,
    amountPage: amountPage !== null,
    optionsSub: optionsSub !== null,
    stockPick: stockPick !== null,
    stockDetail: stockDetail !== null,
    stockAmount: stockAmount !== null,
    stockPage,
    shop: shopUi !== null,
    bail: state.pending?.kind === 'bail',
    loan: bankPending() !== null,
  });
  return layer === null ? false : applyCancelLayer(layer);
}

/** 真正动手的那一半 —— 与 `cancelLayerOf` **一对一**（梯子上每层恰好一条） */
function applyCancelLayer(layer: CancelLayer): boolean {
  switch (layer) {
    case 'pick':
      // @source loc_004466b8：可取消的才退；目标必选（`[0x48c594]` bit3）的不认
      if (pick !== null && pick.cancellable) {
        sound.play('Effect.mkf', CANCEL_SOUND);
        endPick();
      }
      return true;
    case 'dicePick':
      cancelDicePick();
      return true;
    // @source loc_0043791e：关面板，★ 不放音
    case 'atm':
      closeAtm();
      requestRender();
      return true;
    case 'amountPage': {
      // @source loc_004534a3：放取消音 → 关填数窗，返回 0（= 没填）
      const ui = currentDialog();
      sound.play('Effect.mkf', CANCEL_SOUND);
      if (ui !== null) onDialogHit(ui, { kind: 'amountCancel' });
      else closeAmountPage();
      requestRender();
      return true;
    }
    case 'dialog': {
      // @source loc_004539a2：放取消音 → 关訊息框，返回 0（= NO）
      const ui = currentDialog();
      if (ui === null) return false;
      sound.play('Effect.mkf', CANCEL_SOUND);
      cancelDialogChoice(ui);
      return true;
    }
    case 'optionsSub':
      cancelOptionsSub();
      return true;
    // @source fcn_0041095b：关設定屏，返回 0（★ 不放音）
    case 'options':
      optionsPressed = null;
      screen = optionsReturn;
      requestRender();
      return true;
    // @source loc_0041e2ba：关屏 = 取消（草稿不拷回；★ 不放音）
    case 'aiSettings':
      closeAiSettings(false);
      return true;
    // @source loc_00403934 / loc_00403cf4：放取消音 + 关屏，返回 −1
    case 'saveload':
      sound.play('Effect.mkf', CANCEL_SOUND);
      closeSaveLoad();
      return true;
    // @source loc_00424409：关屏（★ 不放音）
    case 'assets':
      closeAssets();
      return true;
    // @source loc_00441671 / loc_004418b9 / loc_00445dad：关浮窗（★ 不放音）
    case 'inventory':
      closeInventory();
      return true;
    // @source loc_0042b22f（`[0x48c2ed] != 0`）：放取消音 + 抛回 0 = 卡不消耗
    case 'stockPick':
      cancelStockPick();
      return true;
    // @source loc_0042aa08：关详情卡，回股市屏（★ 不放音）
    case 'stockDetail':
      closeStockDetail();
      return true;
    case 'stockAmount':
      // 填数窗那一条与上面 `amountPage` 同一个 @source（loc_004534a3）
      sound.play('Effect.mkf', CANCEL_SOUND);
      stockAmount = null;
      closeAmountPage();
      requestRender();
      return true;
    case 'stockPage':
      // @source loc_0042b22f：退回行情页 + **清掉选中行**（`[0x48c2eb] = 0`）
      stockPage = 0;
      stockSel = null;
      requestRender();
      return true;
    // @source loc_0042b25a：放取消音 + 关股市屏
    case 'stock':
      sound.play('Effect.mkf', CANCEL_SOUND);
      closeStock();
      return true;
    // @source fcn_0042d37f 的 0x205：直接走人（★ 不说道别语、不放音）
    case 'shop':
      if (!shopUi?.closing) dispatch({ type: 'declineDecision' });
      return true;
    // @source loc_0043d266（監獄）/ loc_0043e7c7（醫院）：关屏，返回 0 = 不保釋
    case 'bail':
      bailHot = null;
      dispatch({ type: 'declineDecision' });
      return true;
    // @source loc_00435f6d：放取消音 + 说再见 + 关贷款屏（状态机自己走）
    case 'loan':
      loanSend({ kind: 'cancel' });
      return true;
  }
}

/**
 * 訊息框上「取消」选哪一项 —— 原版 `fcn_0045367e` 的 0x205 是
 * `Post_0402_Message(0)`，即**返回 0 = NO**；本引擎的对话框把「不了」
 * 统一写成 `declineDecision`（`rules/interaction.ts` 的 `responseMatches` 认它）。
 */
function cancelDialogChoice(ui: InteractionUi): void {
  const idx = ui.choices.findIndex((c) => c.action.type === 'declineDecision');
  onDialogHit(ui, { kind: 'choice', index: idx >= 0 ? idx : ui.choices.length - 1 });
}

/**
 * 一个熱鍵按下去做什么。返回 `false` 表示「这个键本引擎不管」，
 * 让调试键那一路有机会接手。
 *
 * ★ 2026-09-16：原先这里有一句 `const name = HOTKEY_NAMES[fn]` 只服务于
 *   末尾那句「⚠ 尚未實作」的日志 —— 四个熱鍵（股市/卡片/道具/查詢）接上之后
 *   日志没了，它也就成了未用变量（eslint 报错）。表本身仍由熱鍵頁用。
 */
function handleHotkey(fn: number): boolean {
  // ★ 登记的整屏先认领熱鍵（契约见 ui-screen.ts）
  {
    const env = uiEnv();
    for (const s of SCREENS) {
      if (s.hotkey?.(fn, env) === true) return true;
    }
  }

  switch (fn) {
    // ── 对话框上的答复 ──
    case HOTKEY.yes:
    case HOTKEY.confirm: {
      // 設定屏的通用 YES/NO 框先认（原版 `fcn_0045367e` 拿 `[0x497178]` 那把「是」键比）
      if (optionsSub !== null && optionsSub.kind === 'yesno') {
        answerYesNo(true);
        return true;
      }
      const ui = currentDialog();
      if (ui === null) return false;
      onDialogHit(ui, { kind: 'choice', index: 0 });
      return true;
    }
    case HOTKEY.no: {
      if (optionsSub !== null && optionsSub.kind === 'yesno') {
        answerYesNo(false);
        return true;
      }
      const ui = currentDialog();
      if (ui === null) return false;
      onDialogHit(ui, { kind: 'choice', index: Math.min(1, ui.choices.length - 1) });
      return true;
    }
    case HOTKEY.cancel:
      // ★ 原版钩子把这个键补成 `WM_RBUTTONUP (0x205)`（@source VA 0x004011c3），
      //   所以它与右键**共用同一把梯子** —— 见 `cancelTopPanel`。
      return cancelTopPanel();

    // ── 回合 ──
    case HOTKEY.advance:
      if (!awaitingHumanRoll()) return false;
      // ★ 预动作先播，数满每向帧数那一 tick 才真的掷（见 `requestRoll`）
      //   动画正开着 → 这一次没接走，重排驱动，等它收摊自己来（别让按键白按）
      if (!requestRoll()) scheduleHumanTurn();
      return true;
    case HOTKEY.chooseDiceCount: {
      // 在允许的颗数之间轮换
      const me = state.players[state.currentPlayer];
      if (me === undefined || !awaitingHumanRoll()) return false;
      const max = maxDiceOf(me);
      dispatch({ type: 'setDiceCount', count: (me.ndices % max) + 1 });
      return true;
    }

    // ── 視角 ──
    // ★ 大地圖**不是视角切换** —— 它是一扇独立的**模态弹窗**
    //   （原版窗口过程 `fcn_0040a801` @VA 0x0040a801，入口 `_rich4_ui_small_map_entry`
    //   @VA 0x0040a9bd）。画法与判据见 `big-map-screen.ts`。
    case HOTKEY.map:
      if (screen !== 'game') return false;
      openBigMap(uiEnv());
      return true;
    case HOTKEY.rotateLeft:
      rotateView(-1);
      return true;
    case HOTKEY.rotateRight:
      rotateView(1);
      return true;
    case HOTKEY.switchOption:
    case HOTKEY.switchWindowGroup:
      // 右下角那块 200×200 轮换：日曆 → 月曆 → 小地圖
      sidebarView =
        sidebarView === 'calendar' ? 'month' : sidebarView === 'month' ? 'map' : 'calendar';
      return true;
    case HOTKEY.query:
      openAssets();
      return true;
    case HOTKEY.pageUp:
    case HOTKEY.pageDown:
      // 資產表屏开着时，PgUp/PgDn 归它翻**地產清單**（原版 VA 0x424374：
      // 那两个键就是 RICH4.CFG 的 `cfg+66`/`cfg+68`，正好是 PgUp/PgDn；
      // 且只在视图 1 生效）。
      if (screen === 'assets') {
        pageEstateList(fn === HOTKEY.pageUp ? -1 : 1);
        return true;
      }
      cyclePanelPage(fn === HOTKEY.pageUp ? -1 : 1);
      return true;

    // ── 系统 ──
    case HOTKEY.system:
      if (screen !== 'options') openOptions(screen);
      return true;
    case HOTKEY.saveGame:
      if (screen !== 'game') return false;
      openSaveLoad('save', 'game');
      return true;
    case HOTKEY.loadGame:
      openSaveLoad('load', screen === 'game' ? 'game' : 'title');
      return true;
    case HOTKEY.autoPlay:
      // 热键「託管」= 开託管AI 屏（工具列 #3）—— 不是「本机托管开关」
      if (screen === 'aiSettings') closeAiSettings(false);
      else if (screen === 'game') openAiSettings('game');
      return true;

    // ── 方向鍵（原版叫「游標」）──
    // ★ 原版这四个鍵是**移动鼠標指针**（`rich4_keyboard_hook.asm` 开头就是
    //   `GetCursorPos` + `SetCursorPos(x±10, y±10)`，@source VA 0x00401059..0x004010a9），
    //   也就是給纯键盘用户指方向用的。浏览器里**移不了系统光标**，
    //   所以我们既不能照抄、也不该拿它去做原版没有的事（先前的「平移地图视角」
    //   就是本引擎自己发明的，已随 `setViewMode` 删除，见 D-086-5 / T-086）。
    //   ⇒ 如实：这四个鍵在本引擎里**什么都不做**。登记在 `docs/deviations/T-086.md`。
    case HOTKEY.cursorUp:
    case HOTKEY.cursorDown:
    case HOTKEY.cursorLeft:
    case HOTKEY.cursorRight:
      return false;

    // ── 四个熱鍵接到**與工具列同一顆鈕**的入口 ──
    //   @source 熱鍵表（`rich4_cfg` +16 起，見 `hotkeys.ts`）與工具列跳表
    //   `0x417d39` 是同一批功能：股市 12 / 卡片 14 / 道具 15 / 查詢 16。
    //   （13「交易」與 18「輔助說明」由登記屏自己認領，見 `board-screen` / `help-screen`。）
    case HOTKEY.stockMarket:
      if (screen === 'stock') closeStock();
      else if (screen === 'game') openStock();
      return true;
    case HOTKEY.cards:
      if (screen === 'inventory' && invKind === 'cards') closeInventory();
      else openInventory('cards');
      return true;
    case HOTKEY.tools:
      if (screen === 'inventory' && invKind === 'tools') closeInventory();
      else openInventory('tools');
      return true;
    case HOTKEY.query:
      if (screen === 'assets') closeAssets();
      else if (screen === 'game') openAssets();
      return true;

    // ── 浏览器里做不了 / 无意义的 ──
    default:
      return false;
  }
}

/**
 * 一步棋走完后开始播补间。
 *
 * @source `fcn_0040c05c`（VA 0x0040c05c）：tick 数 = `trunc(世界距离 / 走子速度)`，
 *   线性等分、**一个 tick 一帧** —— 细节与出处见 `client/tween.ts`。
 *   起点用 state 里的 `lastNodeId`（core 的 step 会把它设成走之前那一格）。
 *
 * ★ 传给 `startWalk` 的是**世界坐标**（节点 x/y）：原版这一支不碰投影
 *   （起点 `0x40c1d4`、终点 `0x40c205` 都是节点记录的 `+0x00/+0x02`），
 *   所以镜头/视角/缩放都不影响一格几 tick。
 */
function startStepTween(playerIndex: number): void {
  const p = state.players[playerIndex];
  if (p === undefined) return;
  const from = map.nodes[p.lastNodeId - 1];
  const to = map.nodes[p.nodeId - 1];
  if (from === undefined || to === undefined) return;
  renderer.startWalk(
    playerIndex,
    { x: from.x, y: from.y },
    { x: to.x, y: to.y },
    p.trafficMethod & 3,
    false,
    tickMs(options.speed),
  );
}

/** 当前玩家的朝向换算到屏幕方位 @source VA 0x0040882d */
function currentScreenDir(): number {
  const me = state.players[state.currentPlayer];
  return me === undefined ? 0 : screenDirection(me.direction, camera.view);
}

/**
 * 滚骰的音效 —— 音效 **10**（0.14 s）。
 *
 * @source VA 0x004195ed `fcn_00450cda(0x48235a, 0)` 先把音效登记给影片，
 *   影片画完（0x00419620）再 `rich4_play_sound_effect(0x48235a)`
 *   （0x00419628）。`0x48235a` = 音效表 `0x48234a` 的索引 2 → 编号 **10**。
 *   ⚠️ 「登记给影片」那一支要影片内部有触发帧才会响（`[0x48c850]`），
 *   本引擎的播放是逐帧画，故只按**影片开播那一刻**响一次。
 */
function playDiceSound(): void {
  sound.play('Effect.mkf', DICE_ROLL_SOUND);
}

/**
 * 走一格时播该玩家交通方式的移动音效。
 *
 * @source 音效 VA 0x0040d9f2（详见 `@rich4/assets-pipeline` 的 `MOVE_SOUND`）：
 *   走完一格、重置走路帧之前，按 `traffic_method` 从表 `0x48234a` 取
 *   （走路 44 / 機車 45 / 汽車 46 / 船 53）。
 *
 * ★ 走路**帧**不在这里推了：原版是 `fcn_0040c05c` 每 tick 推一格
 *   （VA 0x0040c751），而 tick 是跟着补间走的 —— 故交给 `render.ts` 的
 *   `#walkScreen` 按已过去的 tick 数补齐。见 `known-deviations.md` Q-TURN-1 §5。
 */
function stepTick(): void {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return;
  // ★ 号从 `move-sound.ts` 取（与 exe 的表同源，别再抄第二份映射）。
  //   @source 走一格放一次：`fcn_0040d7c4` 的 state 2 尾（VA 0x0040d9f2）
  const id = moveSoundId(me.trafficMethod & 3);
  sound.play('Effect.mkf', id);
  // 记住在放哪一个 —— 整趟走完要 Stop（原版 state 1 的 0x0040d8dc 用**同一个索引**），
  // 否则汽车那 2.72 秒的引擎声会一直响到下一回合（音频层虽然同路会停前一个，
  // 但那只有「下一格」才触发，走完最后一格没人停）。
  moveSoundPlaying = id;
}

/** 正在放的移动音效号（null = 没在放）—— 整趟走完由 `syncMoveSound()` 停掉 */
let moveSoundPlaying: number | null = null;

/**
 * 走子整趟结束时把移动音效停掉。
 *
 * @source `fcn_0040d7c4` 的 state 1（走子段，VA 0x0040d8d3）：`[0x48baf8] == 0`
 *   （整趟走完）那一次才 `rich4_stop_sound_effect`（0x0040d8dc），索引是同一个
 *   `[0x4749d4]`。逐格**不**停 —— 原版就是「每格 Play、整趟完 Stop」。
 */
function syncMoveSound(): void {
  if (moveSoundPlaying === null) return;
  if (!renderer.walkDone()) return;
  sound.stop('Effect.mkf', moveSoundPlaying);
  moveSoundPlaying = null;
}

// ============================================================
//  掷骰那一段（预动作 → 滚骰 → 定格）
// ============================================================

/** 滚骰影片缓存 —— `Panel.mkf` 4/5/6 各是一段 36 帧的 FLIC，解一次就留着 */
const diceFlic = new Map<number, LoadedFlic | null>();
const diceFlicPending = new Set<number>();

/** 取滚骰影片；没解出来的先返回 null 并在后台解，解完再重画一帧 */
function diceFlicNow(count: number): LoadedFlic | null {
  const hit = diceFlic.get(count);
  if (hit !== undefined) return hit;
  const cache = sprites;
  if (cache !== null && !diceFlicPending.has(count)) {
    diceFlicPending.add(count);
    void cache.getFlic('Panel.mkf', DICE_FLIC_BASE + count).then((f) => {
      diceFlic.set(count, f);
      diceFlicPending.delete(count);
      diceFx.attachFlic(f);
      requestRender();
    });
  }
  return null;
}

/**
 * 「手持骰子的走路」每向几帧 —— 预动作要几个 tick。
 * @source VA 0x0040d975：数到 `图数 / 8` 那一 tick 才掷
 */
function diceAnticipateTicks(me: { character: number; trafficMethod: number }): number {
  const count = sprites?.imageCount('Data.mkf', characterSetBase(me.character, me.trafficMethod) + CHARACTER_POSE.dice) ?? 0;
  return count > 0 ? Math.max(1, count >> 3) : 9;
}

/**
 * 「该掷骰了」的唯一入口。
 *
 * ★ 原版**先播预动作再掷**，不是掷完再补动画：`fcn_0040defe` 把状态设成
 *   2（掷骰），角色播「手持骰子的走路」；数满每向帧数那一 tick 才调
 *   `fcn_00419572` 去 `rand()%6+1` 并播滚骰影片。所以要在这里拦一道。
 *
 * 已经在播就什么都不做（幂等）。
 */
function requestRoll(): boolean {
  // ★ 已经有动画在播 → **这一次没接走**（返回 false）。调用方必须据此重排，
  //   否则这一拍就此丢失、再没人驱动（2026-09-16 长跑抓到的硬卡死）。
  if (diceFx.active) return false;
  const me = state.players[state.currentPlayer];
  if (me === undefined) return false;
  const count = Math.max(1, Math.min(3, me.ndices || 1));
  diceFlicNow(count);
  diceFx.begin(performance.now(), diceAnticipateTicks(me), tickMs(options.speed), count);
  anticipateFrame = 0;
  rollRequestedAt = 0;
  requestRender();
  window.setTimeout(dicePoll, 16);
  return true;
}

/** 预动作已经推过几帧了 —— 原版是**每 tick 一帧**（VA 0x0040d975 `inc [0x498ea3]`）*/
let anticipateFrame = 0;
/** 催过 `rollDice` 的时刻；用来给联机兜底（服务器不回就收摊） */
let rollRequestedAt = 0;
/** 催过之后最多等这么久 —— 联机时服务器不答复不能一直空转 */
const ROLL_WAIT_TIMEOUT_MS = 3000;

/**
 * 掷骰那一段的轮询：数满预动作就掷，掷完继续要帧直到 500 ms 定格走完。
 *
 * ★★ 2026-09-16 第二次修「掷完骰子人不走」—— 第一版**修错了地方**。
 *
 *   为什么必须在这里收尾：`diceFx.tick(now)` 会在**同一次调用里**把
 *   `hold → idle`（`dice-roll.ts` 的 `#advance`），也就是「动画播完」这件事
 *   发生在函数**中部**，而不是下一次调用的入口。于是：
 *   · 入口那道 `if (!diceFx.active) { 补驱动 }` 永远轮不到（进来时还 active）；
 *   · 尾部 `if (diceFx.active) setTimeout(dicePoll, 16)` 因为已经 idle 而**不再重排**
 *     ⇒ 补驱动那一支彻底成了死代码，而 `scheduleHumanTurn` / `scheduleAi`
 *     都以 `diceFx.active` 为闸，`rollDice` 落地那次调用又因动画刚开当场返回，
 *     真人就永久停在 `phase === 'moving'`、棋子一步不走。
 *
 *   ⇒ 所以「动画是否刚好在这一拍结束」必须在 `tick()` **之后**再判一次，
 *     结束就当场补驱动并收摊。入口那道保留：别的岔路（自己起动画、
 *     联机超时 cancel）也会从 idle 状态进来。
 */
function dicePoll(): void {
  if (!diceFx.active) {
    // ★★ 骰子那一段播完必须**补一次回合驱动**（2026-09-16 修「掷完骰子人不走」）。
    //   为什么需要：`scheduleHumanTurn`/`scheduleAi` 都以 `diceFx.active` 为闸，
    //   而 `rollDice` 那次 `applyAction` 末尾叫它们时动画刚开、当场返回；
    //   播完若不再叫一次，真人就永远停在 `phase === 'moving'`、棋子一步不走。
    resumeTurnDriver();
    return;
  }
  const now = performance.now();
  // ★★ 相位推进必须在**这里**做，不能只靠绘制（2026-09-16 长跑抓到的硬卡死：
  //   有整屏接管盖住棋盘时 `drawDiceFx()` 不再被调用，相位就永远停在 tumble，
  //   `active` 恒真 ⇒ 回合驱动全被这道闸挡死、整局冻住）。
  //   `tick()` 的返回值 = 「定格刚好在这一拍播完」—— 必须用它，不能事后看 `active`：
  //   结束那一拍 `active` 已经是 false，靠它去重排就把最后一次补驱动吞了。
  const ended = diceFx.tick(now);

  // ★ 定格走完的那一拍：当场补驱动（这里是唯一能抓住「播完」这条边的地方）
  if (ended) {
    requestRender();
    resumeTurnDriver();
    return;
  }

  // 预动作：角色「手持骰子的走路」按 tick 推进 —— 与滚骰/走子的走路帧同一个计数器
  if (diceFx.phase === 'anticipate') {
    const f = diceFx.anticipationFrame(now);
    if (f > anticipateFrame) {
      renderer.advanceWalk(f - anticipateFrame);
      anticipateFrame = f;
    }
  }

  if (diceFx.wantsRoll && diceFx.anticipationDone(now)) {
    diceFx.markRollRequested();
    rollRequestedAt = now;
    // ★ 这一刻才真的掷（@source VA 0x0040d9aa 的 `call fcn_00419572`）
    dispatch({ type: 'rollDice' });
    // 影片可能还没解完；解完的回调会再挂一次
    diceFx.attachFlic(diceFlic.get(diceFx.diceCount) ?? null);
  }

  // 联机兜底：催过之后服务器迟迟不回就收摊，别一直空转
  if (diceFx.phase === 'anticipate' && rollRequestedAt > 0 && now - rollRequestedAt > ROLL_WAIT_TIMEOUT_MS) {
    diceFx.cancel();
    // ★ 收摊同样要让回合驱动接着跑（`cancel()` 把相位摆回 idle，而这道闸
    //   一旦没人重排就再也没人叫 `scheduleHumanTurn`）。
    resumeTurnDriver();
    return;
  }

  if (diceFx.phase === 'tumble') diceFlicNow(diceFx.diceCount);
  requestRender();
  if (diceFx.active) window.setTimeout(dicePoll, 16);
}

/**
 * 骰子那一段收摊之后**补一次回合驱动**。
 *
 * ★ 抽成独立函数是为了能单独钉住：`scheduleAi()` 与 `scheduleHumanTurn()`
 *   都必须被叫到，少一个就会有一类座位永久卡在 `awaitingRoll`/`moving`。
 */
function resumeTurnDriver(): void {
  scheduleAi();
  scheduleHumanTurn();
}

/** 轮到人、还没掷骰 */
function awaitingHumanRoll(): boolean {
  return screen === 'game' && state.phase === 'awaitingRoll' && !isAiTurn(state) && localSeatActive();
}

/**
 * 这一帧棋盘上要不要盖一块对话框。
 *
 * ★ 这是「人能不能真的把这局玩下去」的关键：`pending` 给得出，就必须
 *   答得掉。原先答复控件只在 HTML 调试抽屉里，而抽屉默认是收起的——
 *   也就是正常开局时**根本没法回答买地**。
 *
 * ★ 但「答得掉」指的是**该答的那个人**答得掉。待决交互属于**当前玩家**
 *   那个回合：他落在自己格子上，引擎才问「買不買／蓋不蓋」。电脑（含被
 *   托管的人类座位）那一手由 `scheduleAi` → `decideAction` 自己答；
 *   若也给人弹窗，人就能替电脑买地、替电脑加蓋 —— 买的是**别人脚下**那块地，
 *   钱从别人账上扣，人自己什么都没得到，只是把电脑的一步搅了。
 *   联机的 `localSeatActive()` 管的是另一头（别的**真人**座位别替他答），
 *   两者都要有。
 */
function currentDialog(): InteractionUi | null {
  if (screen !== 'game') return null;
  // 联机：待决交互只由当前座位的客户端回答；旁人不弹窗，免得替别人答
  if (!localSeatActive()) return null;
  // 电脑/托管的回合由 AI 自己答，人不要替他答
  if (isAiTurn(state)) return null;
  return state.pending === null ? null : interactionUi(state.pending, state);
}

/** 走完一次对话框交互，回到选项页 */
function closeAmountPage(): void {
  amountPage = null;
  dialogHot = null;
}

/** 对话框上点到了什么 */
const __devHits: unknown[] = [];
function onDialogHit(ui: InteractionUi, hit: DialogHit): void {
  if (import.meta.env.DEV) __devHits.push(hit);
  if (hit.kind === 'choice') {
    const c = ui.choices[hit.index];
    if (c === undefined) return;
    // ★ 存款 / 提款：原版走的是**銀行那台 ATM**（资源 24 的面板 + 数字键盘），
    //   不是通用填数页 —— 见 bank-screen.ts 头部的取证。
    if (
      c.amount !== undefined &&
      c.action.type === 'bank' &&
      (c.action.op === 'deposit' || c.action.op === 'withdraw')
    ) {
      atm = {
        mode: c.action.op === 'deposit' ? 0 : 1,
        digits: '',
        limits: [
          c.action.op === 'deposit' ? c.amount.max : 0,
          c.action.op === 'withdraw' ? c.amount.max : 0,
        ],
      };
      atmFill = c.amount.fill;
      atmLabel = c.amount.label;
      dialogHot = null;
      requestRender();
      return;
    }
    // 要填数的选项：先进填数页，别直接派 action
    if (c.amount !== undefined) {
      // ★ 开窗初值：原版認購股份那一支把**上限**当第一个实参传进填数窗
      //   （见 `interactions.ts` 的 `amount.initial`），其余各条照旧从 0 起
      amountPage = {
        choice: hit.index,
        value: c.amount.initial ?? AMOUNT_INITIAL,
      };
      dialogHot = null;
      requestRender();
      return;
    }
    log(ui.title === '' ? `▶ ${c.label}` : `▶ ${ui.title}：${c.label}`);
    closeAmountPage();
    dispatch(c.action);
    return;
  }

  const page = amountPage;
  const amount = page === null ? undefined : ui.choices[page.choice]?.amount;
  if (page === null || amount === undefined) return;

  switch (hit.kind) {
    // ★ 原版键盘窗上按了第几号钮（B-5(i)/B-6(i)）—— 与键盘那一路**同一个出口**：
    //   查同一张 `AMOUNT_SLOT_BY_ID`，再走 `onAmountKey` 那套（数字/退格/C/M/Enter）。
    case 'amountSlot': {
      const slot = amountSlotOfId(hit.id);
      if (slot === null) return;
      switch (slot.kind) {
        case 'digit':
          onAmountKey(ui, { kind: 'digit', digit: slot.digit });
          return;
        case 'backspace':
          onAmountKey(ui, { kind: 'backspace' });
          return;
        case 'clear':
          onAmountKey(ui, { kind: 'clear' });
          return;
        case 'max':
          onAmountKey(ui, { kind: 'max' });
          return;
        case 'ok':
          onAmountKey(ui, { kind: 'ok' });
          return;
        default:
          return; // 金额栏光标不在这张表里（原版是拖动）
      }
    }
    case 'amountStep':
      amountPage = { ...page, value: Math.max(0, Math.min(amount.max, page.value + hit.delta)) };
      requestRender();
      return;
    case 'amountMax':
      amountPage = { ...page, value: amount.max };
      requestRender();
      return;
    case 'amountCancel':
      closeAmountPage();
      // ★ 貸款屏（T-029c）：填数页收摊要告诉状态机 —— 原版那是
      //   `fcn_00453544` 返回 0，`0x409`/`0x40a` 拿它决定下一步（不挂气泡地收尾）
      loanFormClosed(0);
      requestRender();
      return;
    case 'amountOk': {
      const n = Math.trunc(page.value);
      closeAmountPage();
      // ★ 先让貸款屏的状态机吃掉这次结果（0x409/0x40a 的语义），再派 action ——
      //   派完 action 可能整条 `pending` 都换了，那时状态机已经走到位了
      loanFormClosed(n);
      // ★ 0 等于没做这件事 —— 派一个 0 的 action 只会被引擎原样退回，
      //   然后交互还留在那儿，看起来像卡住了
      if (n <= 0) {
        requestRender();
        return;
      }
      log(`▶ ${ui.title === '' ? '' : `${ui.title}：`}${amount.label} ${n}`);
      dispatch(amount.fill(n));
      return;
    }
  }
}

/**
 * 通用填数页收到**一次按键** —— 与鼠标那一路走同一个出口。
 *
 * ★ 原版那扇窗（`fcn_00453544` 的窗口过程 `fcn_00452c02`）在 `0x100` 里把键翻成
 * 「哪颗钮被按下」的序号，再合成一条 `WM_LBUTTONUP (0x202)`；
 * 而 0x202 落到 `loc_00452fce` —— **与鼠标抬手是同一段**（`loc_00452d0e`）。
 * 所以这里也不另开一条路：值变了就写回同一个 `amountPage`，
 * Enter（序号 3、`loc_00453116` 的 `Post_0402_Message`）就走 `amountOk` 那一支。
 *
 * ⚠️ 取消不在那张表里 —— 见 `amount-keys.ts` 头部：ESC 是钩子补成 `0x205` 关的窗。
 */
function onAmountKey(ui: InteractionUi, key: AmountKey): void {
  const page = amountPage;
  const amount = page === null ? undefined : ui.choices[page.choice]?.amount;
  if (page === null || amount === undefined) return;
  const step = amountKeyStep(page.value, amount.max, key);
  if (step.submit) {
    onDialogHit(ui, { kind: 'amountOk' });
    return;
  }
  amountPage = { choice: page.choice, value: step.value };
  requestRender();
}

function openOptions(from: Screen): void {
  optionsReturn = from;
  optionsVariant = from === 'game' ? 1 : 0;
  optionsDraft = { ...options };
  optionsPressed = null;
  closeOptionsSub();
  screen = 'options';
  requestRender();
}

/**
 * 設定屏用到的四个音效号 —— **全都从 `0x48231a` 那张指针表里读出来的**
 * （`play_sound_effect(0, &entry)` 取 `[entry]` 当号）：
 *
 * | 号 | 表项 | 谁在用 |
 * |---|---|---|
 * | 1 | `0x482322` | 几乎每一颗控件（`fcn_00410537/572/5b9/f4`、`fcn_004107xx`） |
 * | 2 | `0x48232a` | 確 定（`fcn_004106c1` 的 `(idx−7)^1 = 0`） |
 * | 3 | `0x48233a` | 樂曲列表在「音樂關著」时（`fcn_00410668` 的 `loc_004106b0`） |
 * | 4 | `0x482332` | 取 消（`fcn_004106c1` 的 `(idx−7)^1 = 1`） |
 */
const OPTION_SOUND = { click: 1, ok: 2, denied: 3, cancel: 4 } as const;

/**
 * 設定屏**按下**（原版 `0x201` → `fcn_004103a3` 的 `loc_004104af`）。
 *
 * 按下这一刻就发生的：改取值、亮灯、点樂曲（**立刻换曲**）、贴按下图、放音效。
 * 只有取消/確定/右上角三颗要等抬手（见 `onOptionsUp`）。
 */
function onOptionsDown(sx: number, sy: number): void {
  // ── 副屏先接（原版那三扇窗口各有自己的 WM_LBUTTONDOWN）──
  if (optionsSub !== null) {
    onOptionsSubDown(sx, sy);
    return;
  }
  const x = sx - DIALOG.x;
  const y = sy - DIALOG.y;
  if (x < 0 || y < 0 || x >= DIALOG.w || y >= DIALOG.h) return;
  const ctrl = hitControl(x, y);
  if (ctrl === null) return; // 没点中任何控件 —— 原版把 [0x474d74] 留成 16，什么都不做
  const hit = controlHit(ctrl, x, y);
  if (hit === null) return;
  optionsPressed = ctrl;

  if (hit.kind === 'track') {
    // 音樂關著就點不動樂曲 —— 原版放「不行」音（音效 3）后原样退回。
    if (optionsDraft.music === 0) {
      sound.play('Effect.mkf', OPTION_SOUND.denied);
      return;
    }
    // ★ 原版点一下**立刻换曲**（`fcn_00454d91(行号+1)`），不等「確定」、
    //   取消也不回退。列表里反白的那一行是「正在放的那首」。
    optionsDraft = { ...optionsDraft, track: hit.value };
    // @source 0x00410671..0x00410687：`(y − 0xe2) / 15 + 1` → `sub_00454d91(行号 + 1)` ——
    //   点的是**背景曲单**里的第几首（8 首），所以它也得记成背景曲，回棋盘才不会被「接回背景曲」顶掉
    if (hit.value >= 0 && hit.value < BOARD_BGM_FILES.length) playBoardBgm(hit.value + 1);
    else void playTrack(hit.value);
    requestRender();
    return;
  }

  if (hit.kind === 'cancel') sound.play('Effect.mkf', OPTION_SOUND.cancel);
  else if (hit.kind === 'ok') sound.play('Effect.mkf', OPTION_SOUND.ok);
  else sound.play('Effect.mkf', OPTION_SOUND.click);

  // 这三类按下只贴图，动作留到抬手
  if (hit.kind === 'cancel' || hit.kind === 'ok' || hit.kind === 'side') {
    requestRender();
    return;
  }

  // ⚠️ 音量**不**当场变 —— 原版也是按「確定」写回 cfg 之后音乐/音效才跟着走
  //   （`fcn_00410969` 里的 `fcn_004549cf` / `fcn_0045497b`）。
  optionsDraft = applyOptionsHit(optionsDraft, hit);
  requestRender();
}

/**
 * 設定屏**抬手**（原版 `0x202` → `loc_00410820`）。
 *
 * ★ 抬手时**不重新命中判定**：`loc_00410820` 直接拿按下时记下的控件号，
 *   所以「按住取消 → 拖到对话框外 → 松手」仍然算点了取消。
 */
function onOptionsUp(): void {
  // ── 副屏先接（原版那三扇窗口各有自己的 WM_LBUTTONUP）──
  if (optionsSub !== null) {
    onOptionsSubUp();
    return;
  }
  const ctrl = optionsPressed;
  optionsPressed = null;
  if (ctrl === null) return;
  requestRender();
  // 只有右上角三颗（3..5）与取消/確定（7..8）在抬手时才做事
  if (ctrl < CONTROL.SIDE_0 || ctrl > CONTROL.OK) return;
  if (ctrl === CONTROL.CANCEL) {
    // 取消 = 丢掉草稿，什么都不拷回
    screen = optionsReturn;
    requestRender();
    return;
  }
  if (ctrl === CONTROL.OK) {
    applyOptions(optionsDraft);
    screen = optionsReturn;
    requestRender();
    return;
  }
  onOptionsSide(ctrl - CONTROL.SIDE_0);
}

// ============================================================
//  設定屏的三个副屏 —— Q-OPT-1
// ============================================================

/** 收掉副屏（顺带停掉熱鍵頁那条闪白定时器）*/
function closeOptionsSub(): void {
  optionsSub = null;
  if (hotkeyBlinkTimer !== null) {
    window.clearInterval(hotkeyBlinkTimer);
    hotkeyBlinkTimer = null;
  }
}

/** 副屏的素材出口：资源号 + 图号 + 抠黑 */
function optionsSubSprite(resource: number, index: number, colorKeyBlack = false) {
  return spriteNow('Data.mkf', resource, index, colorKeyBlack);
}

/** 这一个副屏的素材出口（`optionsSubSprite` 的两参包装，给 `drawYesNo` 用）*/
function optionsPageSprite(resource: number, index: number, colorKeyBlack?: boolean) {
  return optionsSubSprite(resource, index, colorKeyBlack ?? false);
}

/**
 * 開「日期頁」—— 原版 `0x4119e3`：先把三个钮的字烘进图 2、再取一次系统今天，
 * 然后开模态窗口（`0x410ac3`）；「確定」抛回来的日期写进 `[0x48bb50]` /
 * `RICH4.CFG+8`（= **当前游戏日期**，见 `setDate` 的注释）。
 *
 * ★ 草稿的初值：原版每一行都用 `_libc_getdate()` 取**系统今天**
 *   （`fcn_004119e3` 的 `push eax / call _libc_getdate`），不是上一次改的值 ——
 *   所以这里跟 `today` 走（`systemToday()`），`optionsDate` 只用来记「改过之后
 *   这一局是哪天」，进游戏时同步给 `state`。
 */
function openDatePage(): void {
  const today = systemToday();
  optionsSub = {
    kind: 'date',
    // 原版每开一次都从**系统今天**起算（± 钮在那个基础上加减）
    draft: screen === 'game' ? { year: state.year, month: state.month, day: state.day } : { ...today },
    today,
    pressed: null,
  };
  requestRender();
}

/** 開「熱鍵頁」—— 原版 `0x411a86`（模态窗口 `0x411122`，结果没人接）*/
function openHotkeyPage(): void {
  optionsSub = {
    kind: 'hotkey',
    keys: [...optionsKeys],
    pressed: null,
    capture: null,
    oldValue: 0,
    blink: false,
  };
  requestRender();
}

/** 系统今天（原版 `fcn_00458331` = DOS 取日期；「熱 鍵」那颗回的就是它）*/
function systemToday(): DateDraft {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** 熱鍵頁那条 250ms 的闪白 @source `fcn_00411122` 的 `SetTimer(hwnd, id, 0xfa, 0)` */
function startHotkeyBlink(): void {
  if (hotkeyBlinkTimer !== null) return;
  hotkeyBlinkTimer = window.setInterval(() => {
    if (optionsSub === null || optionsSub.kind !== 'hotkey' || optionsSub.capture === null) {
      closeOptionsSubTimerOnly();
      return;
    }
    optionsSub = { ...optionsSub, blink: !optionsSub.blink };
    requestRender();
  }, 250);
}

function closeOptionsSubTimerOnly(): void {
  if (hotkeyBlinkTimer === null) return;
  window.clearInterval(hotkeyBlinkTimer);
  hotkeyBlinkTimer = null;
}

/**
 * 副屏的**按下**。
 *
 * @source 日期頁 `0x410bc8`（命中后按下就贴按下图 / 选中那天 / 放音效）、
 *   熱鍵頁 `0x4113d9`（命中后按下就压凹那一块 / 放音效）、
 *   YES/NO 框**没有** WM_LBUTTONDOWN 处理（只认移动与抬手）。
 */
function onOptionsSubDown(sx: number, sy: number): void {
  const sub = optionsSub;
  if (sub === null) return;
  if (sub.kind === 'date') {
    const dx = sx - DATE_AT.x;
    const dy = sy - DATE_AT.y;
    const hit = hitDatePage(dx, dy, sub.draft);
    if (hit === null) {
      // 命中格块但没落在任何一天上（格与格之间有 2~3px 空档）：原版照样先放
      // 「按下」音再找格（`0x410e78` 的 `play_sound_effect` 在最前面）。
      if (hitDateControl(dx, dy) === DATE_CTRL.GRID) sound.play('Effect.mkf', OPTION_SOUND.click);
      return;
    }
    // 音效表 `0x48231a`：微调与日曆格 = 1、熱鍵 = 1、取消 = 4、確定 = 2 @source 0x410d84 起
    if (hit.kind === 'spin' || hit.kind === 'day' || hit.ctrl === DATE_CTRL.TODAY) {
      sound.play('Effect.mkf', OPTION_SOUND.click);
    } else if (hit.ctrl === DATE_CTRL.CANCEL) {
      sound.play('Effect.mkf', OPTION_SOUND.cancel);
    } else {
      sound.play('Effect.mkf', OPTION_SOUND.ok);
    }
    // 日曆格是**按下就选中并整屏重画** @source 0x410e78
    const draft = hit.kind === 'day' ? applyDateHit(sub.draft, hit, sub.today) : sub.draft;
    optionsSub = { ...sub, draft, pressed: hit.ctrl };
    requestRender();
    return;
  }
  if (sub.kind === 'hotkey') {
    const hit = hitHotkeyPage(sx - HOTKEY_AT.x, sy - HOTKEY_AT.y);
    if (hit === null) return;
    // 音效表 `0x48231a`：行 / 原始設定 = 1（`0x482322`）、取消 = 4（`0x482332`）、
    // 確定 = 2（`0x48232a`）@source 0x411657 / 0x4116d9 / 0x4115b8
    sound.play(
      'Effect.mkf',
      hit.kind === 'button' && hit.action === 'cancel'
        ? OPTION_SOUND.cancel
        : hit.kind === 'button' && hit.action === 'ok'
          ? OPTION_SOUND.ok
          : OPTION_SOUND.click,
    );
    optionsSub = { ...sub, pressed: hit.ctrl };
    requestRender();
    return;
  }
  // YES/NO 框：原版只认 0x200 / 0x202 / 0x205 —— 按下这一下不算。
  // ⚠️ 但原版开框时 `SetCursorPos(左上+0x16)` 把光标挪进了框里（`0x453719`），
  //   于是必定先来一发 WM_MOUSEMOVE 把高亮打上；本引擎不挪用户的光标，
  //   所以这里**按下也记一次高亮**，否则「点一下左半 = 是」在没移动鼠标时无效。
  if (sub.kind === 'yesno') {
    const hot = hitYesNo(sx, sy);
    if (hot !== sub.hot) {
      optionsSub = { ...sub, hot };
      requestRender();
    }
  }
}

/**
 * 副屏的**抬手**（抬手不重新命中判定，直接拿按下时记下的值）。
 *
 * @source 日期頁 `0x410f3d` 的跳表 `0x410aa7`；熱鍵頁 `0x41170f`（`0x64 原始設定 /
 *   0x65 取消 / 0x66 確定 / 1..30 进捕获`）；YES/NO 框 `0x453892`。
 */
function onOptionsSubUp(): void {
  const sub = optionsSub;
  if (sub === null) return;
  if (sub.kind === 'date') {
    const ctrl = sub.pressed;
    optionsSub = { ...sub, pressed: null };
    requestRender();
    if (ctrl === null) return;
    if (ctrl <= DATE_CTRL.YEAR_DOWN) {
      const field = ctrl === DATE_CTRL.MONTH_UP || ctrl === DATE_CTRL.MONTH_DOWN ? 'month' : 'year';
      const delta = ctrl === DATE_CTRL.MONTH_UP || ctrl === DATE_CTRL.YEAR_UP ? -1 : 1;
      optionsSub = {
        ...sub,
        pressed: null,
        draft: applyDateHit(sub.draft, { kind: 'spin', ctrl, field, delta }, sub.today),
      };
      requestRender();
      return;
    }
    if (ctrl === DATE_CTRL.TODAY) {
      optionsSub = { ...sub, pressed: null, draft: { ...sub.today } };
      requestRender();
      return;
    }
    if (ctrl === DATE_CTRL.CANCEL) {
      // 抛 −1 —— 什么都不拷回（`0x41104c`）
      closeOptionsSub();
      requestRender();
      return;
    }
    if (ctrl === DATE_CTRL.OK) {
      // 抛回日期（`0x411081`）→ 存进 `[0x48bb50]` / `RICH4.CFG+8`（`[0x497160]`）
      optionsDate = { ...sub.draft };
      // ★ 2026-09-16 接线：`RICH4.CFG+8` 就是**当前游戏日期**的存放处
      //   （日推进 `fcn_00452117(&CFG+8)` 是读-改-写，VA 0x0045217c 写回同一格），
      //   所以「確定」要**当场把这一局的日期改掉** —— 先前只记在客户端一个
      //   变量里、core 一无所知（登记为 Q-OPT-1，已结案）。
      //   进游戏之后才有效：标题屏上还没有 `state` 可改（原版那一刻 `CFG+8`
      //   是配置文件里的初始值，本引擎的开局日期由 `newGame` 给）。
      // ★ 也写回 `RICH4.CFG`（`CFG+8` 就是当前游戏日期那一格）
      saveConfigToStore();
      if (screen === 'game') {
        dispatch({ type: 'setDate', year: optionsDate.year, month: optionsDate.month, day: optionsDate.day });
        log(`▶ 日期更改：${optionsDate.year} 年 ${optionsDate.month} 月 ${optionsDate.day} 日`);
      } else {
        log(
          `▶ 日期更改：${optionsDate.year} 年 ${optionsDate.month} 月 ${optionsDate.day} 日` +
            '（標題屏没有进行中的对局，只记下这一份）',
        );
      }
      closeOptionsSub();
      requestRender();
    }
    return;
  }
  if (sub.kind === 'hotkey') {
    const ctrl = sub.pressed;
    optionsSub = { ...sub, pressed: null };
    requestRender();
    if (ctrl === null) return;
    if (ctrl === HOTKEY_CTRL.DEFAULTS) {
      // 原始設定：出厂默认拷回工作副本，**不关屏** @source 0x411744
      optionsSub = { ...sub, pressed: null, keys: [...HOTKEY_DEFAULT_KEYS], capture: null };
      requestRender();
      return;
    }
    if (ctrl === HOTKEY_CTRL.CANCEL) {
      // 取 消：关屏、不写回 @source 0x41177a
      closeOptionsSub();
      requestRender();
      return;
    }
    if (ctrl === HOTKEY_CTRL.OK) {
      // 確 定：写回 `0x497168` + 存 CFG（`0x411f80`）@source 0x4117bc
      optionsKeys = [...sub.keys];
      // ★ 写回 `RICH4.CFG` @source `rich4_write_config()` VA 0x00411f80
      //   （原版 `0x411f80` 那一调就是它）—— 先前只改内存，重开就没了（Q-OPT-1）。
      saveConfigToStore();
      log('▶ 熱鍵設定：已更新並寫入 RICH4.CFG');
      closeOptionsSub();
      requestRender();
      return;
    }
    // 行：进捕获（先把这一条清 0、旧值存起来）@source 0x411804 起
    const index = hotkeySlotFor(ctrl);
    if (index === null) return;
    const keys = [...sub.keys];
    const oldValue = keys[index] ?? 0;
    keys[index] = 0;
    optionsSub = { ...sub, pressed: null, keys, capture: ctrl, oldValue, blink: true };
    startHotkeyBlink();
    requestRender();
    return;
  }
  // YES/NO 框：左键抬手才算（`0x453892`）
  if (sub.kind === 'yesno') {
    const hot = sub.hot;
    if (hot === null) return;
    answerYesNo(hot === 1);
  }
}

/**
 * 熱鍵頁**等按键**时把浏览器事件翻成原版的 VK 码。
 *
 * ⚠️ 不复用 `hotkeys.ts` 的 `vkOf()` —— 那只覆盖熱鍵本身用得到的那几个键，
 *   没有数字 / F1..F12 / 退格 / Home / End / Ins 这些，而原版的键名表
 *   `0x47edfa` 有 78 项（`Backspace` 到 `'`）。这里按**物理键位**（`e.code`）
 *   翻，和 `vkOf()` 同一条理由（布局无关）。
 */
function captureVk(e: KeyboardEvent): number | null {
  const c = e.code;
  if (c.startsWith('Key') && c.length === 4) return c.charCodeAt(3);
  if (c.startsWith('Digit') && c.length === 6) return 0x30 + Number(c.slice(5));
  if (c.startsWith('F') && c.length <= 3) {
    const n = Number(c.slice(1));
    if (n >= 1 && n <= 12) return 0x70 + (n - 1);
  }
  const table: Record<string, number> = {
    Backspace: 0x08, Tab: 0x09, Enter: 0x0d, NumpadEnter: 0x0d,
    ControlLeft: 0x11, ControlRight: 0x11, Escape: 0x1b, Space: 0x20,
    PageUp: 0x21, PageDown: 0x22, End: 0x23, Home: 0x24,
    ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28,
    Insert: 0x2d,
    NumpadMultiply: 0x6a, NumpadAdd: 0x6b, NumpadSubtract: 0x6d, NumpadDivide: 0x6f,
    Semicolon: 0xba, Equal: 0xbb, Comma: 0xbc, Minus: 0xbd, Period: 0xbe, Slash: 0xbf,
    Backquote: 0xc0, BracketLeft: 0xdb, Backslash: 0xdc, BracketRight: 0xdd, Quote: 0xde,
  };
  return table[c] ?? null;
}

/**
 * 熱鍵頁在等按键时收到一个键（原版 `0x41183b`）。
 *
 * @source 键名表 `0x47edfa` 里查不到就不理；`CTRL`(0x11) 置 `0x1100`；
 *   其余 `or` 进低字节；与别的条目撞车就不改。
 */
function onHotkeyCapture(code: number): boolean {
  const sub = optionsSub;
  if (sub === null || sub.kind !== 'hotkey' || sub.capture === null) return false;
  const index = hotkeySlotFor(sub.capture);
  if (index === null) {
    optionsSub = { ...sub, capture: null };
    requestRender();
    return true;
  }
  const next = hotkeyAssign(sub.keys, index, code);
  optionsSub = { ...sub, keys: next ?? sub.keys, capture: next === null ? sub.capture : null };
  if (next !== null) closeOptionsSubTimerOnly();
  requestRender();
  return true;
}

/** 右键：熱鍵頁先取消捕获（还回旧值），否则关屏；日期頁/YES-NO 关屏 */
function cancelOptionsSub(): void {
  const sub = optionsSub;
  if (sub === null) return;
  if (sub.kind === 'hotkey' && sub.capture !== null) {
    const index = hotkeySlotFor(sub.capture);
    const keys = [...sub.keys];
    if (index !== null) keys[index] = sub.oldValue;
    optionsSub = { ...sub, keys, capture: null, blink: false };
    closeOptionsSubTimerOnly();
    requestRender();
    return;
  }
  // YES/NO 框右键 = 「否」@source 0x4539a2（与 NO 同一条路）
  if (sub.kind === 'yesno') {
    answerYesNo(false);
    return;
  }
  closeOptionsSub();
  requestRender();
}

/**
 * YES/NO 框的结果落地 —— 原版 `fcn_00410838` 的 `cmp eax,1 / jne`：
 * **答「是」才做**，答「否」（含右键）直接回去。
 */
function answerYesNo(yes: boolean): void {
  const sub = optionsSub;
  if (sub === null || sub.kind !== 'yesno') return;
  const outcome = confirmOutcome(sub.side, yes);
  closeOptionsSub();
  if (outcome === null) {
    requestRender();
    return;
  }
  applyOptionsOutcome(outcome);
}

/**
 * 遊戲中那三颗答「是」之后的路 —— `[0x474d74] − 2`：1 重新遊戲 / 2 認輸投降 / 3 結束遊戲。
 *
 * @source `0x411e4b` 起那张三路跳表：1 → `0x411aa3`（重开）、
 *   2 → `0x411ae0`（该玩家退出，原版只在 3 人以上的联机里真做）、
 *   3 → `0x411b46`（存 CFG 后退回标题）。
 */
function applyOptionsOutcome(outcome: OptionsOutcome): void {
  if (outcome === 'restart') {
    log('▶ 重新遊戲');
    startGame();
    return;
  }
  if (outcome === 'surrender') {
    surrenderLocalSeat();
    return;
  }
  log('▶ 結束遊戲：回標題');
  enterTitleScreen();
}

/**
 * 認輸投降 —— 把**本地座位**交给电脑（原版 `0x411ae0` 那条路：该玩家退出、
 * 由电脑接手；它只在真人多于一人的局里真做，`cmp [0x499104],1 / jle` 单人直接返回）。
 *
 * ★ 「交出座位」走的是 core 既有的 `setAi`（服务器掉线代打用的就是它：
 *   `whoPlays = HUMAN|AUTOPILOT`），**不自己造规则**。
 */
function surrenderLocalSeat(): void {
  const seat = localHumanSeat();
  if (seat === null) {
    log('⚠ 認輸投降：本機沒有真人座位');
    requestRender();
    return;
  }
  const humans = state.players.filter(
    (p, i) => i !== seat && (p.whoPlays & 0x03) === 0x01 && isAlivePlayer(p),
  ).length;
  if (humans === 0) {
    // 原版 `0x411af1`：只有一个真人时**什么都不做**
    log('⚠ 認輸投降：只有一位真人（原版這條路也是什麼都不做）');
    requestRender();
    return;
  }
  const me = state.players[seat];
  dispatch({
    type: 'setAi',
    player: seat,
    whoPlays: me === undefined ? 0x05 : (me.whoPlays & 0x03) | 0x04,
  });
  log(`▶ 認輸投降：${seat + 1} 號座交給電腦`);
  requestRender();
}

/** 本地真人座位（原版 `[0x49910c]`）：联机用 `net.seat`，单机取第一个真人 */
function localHumanSeat(): number | null {
  if (net !== null) return net.seat;
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (p !== undefined && (p.whoPlays & 0x03) === 0x01) return i;
  }
  return null;
}

/** 玩家还在场上（`whoPlays & 3 != 0`）—— 与 core `isAlive` 同一条判据 */
function isAlivePlayer(p: { whoPlays: number }): boolean {
  return (p.whoPlays & 0x03) !== 0;
}

/**
 * 右上角三颗黄钮（抬手才算）。
 *
 * @source `fcn_00410838`：`[0x48bb58]`（= 入口参数）非 0 就是**遊戲中**进来，
 *   先弹一个 Yes/No 确认框（`_rich4_ui_yesno(0x140, 0xc8)` = 画在 (320,200)），
 *   答「是」才把 `[0x474d74] − 2`（1 重新遊戲 / 2 認輸投降 / 3 結束遊戲）抛回去；
 *   是 0（標題頁）则直接进那一屏，**没有确认框**。
 */
function onOptionsSide(index: number): void {
  const label = SIDE_BUTTONS[optionsVariant]?.[index] ?? '';
  if (optionsVariant !== 0) {
    // 遊戲中：先弹通用 YES/NO 框（`0x4108ec` 两次 push 0xc8/0x140）
    optionsSub = { kind: 'yesno', side: index, hot: null };
    requestRender();
    return;
  }
  // 標題頁：三颗各自推开一整屏 —— 跳表 `[0x474d5c + 4*控件号]`
  if (index === 0) {
    openDatePage();
    return;
  }
  if (index === 1) {
    openHotkeyPage();
    return;
  }
  if (index === 2) {
    // 遊戲說明 = `_rich4_ui_help_entry(-1, -1)` @source 0x411a96（居中）
    log(`▶ ${label}`);
    openHelpAt(uiEnv(), -1, -1);
    return;
  }
}

/** 画盖在設定主面板上的那一层（日期頁 / 熱鍵頁 / YES/NO 框）*/
function drawOptionsSub(): void {
  const sub = optionsSub;
  if (sub === null) return;
  if (sub.kind === 'date') {
    drawDatePage(stageCtx, optionsPageSprite, { draft: sub.draft, pressed: sub.pressed });
    return;
  }
  if (sub.kind === 'hotkey') {
    drawHotkeyPage(stageCtx, optionsPageSprite, HOTKEY_NAMES, {
      keys: sub.keys,
      pressed: sub.pressed,
      capture: hotkeyCaptureSlot(sub),
      blink: sub.blink,
    });
    return;
  }
  drawYesNo(stageCtx, optionsPageSprite, sub.hot);
}

/**
 * 熱鍵頁的 `值`（`0x48bb9e`）→ 数组下标。
 * ★ 口径在 `options-pages.ts` 的 `hotkeySpot` / `hotkeyEditSlot` 里（**含原版
 *   第二列那个差一**），这里只借一下，不另写一份。
 */
function hotkeySlotFor(ctrl: number): number | null {
  return hotkeySpot(ctrl)?.slot ?? null;
}

/** 等待按键的那一条在数组里的下标（画闪白用）*/
function hotkeyCaptureSlot(sub: { capture: number | null }): number | null {
  return sub.capture === null ? null : hotkeySlotFor(sub.capture);
}

/**
 * 开「託管AI」（工具列 #3 / 热键`託管`）。
 *
 * ★ 先把当前设置抄成一份**草稿**：原版也是编辑一份暂存表、按「確定」才拷回
 *   玩家结构（VA 0x0041e259）。这样「取消」天然就是「什么都不做」，
 *   不需要记住原始值再回滚。
 */
function openAiSettings(from: Screen): void {
  aiReturn = from;
  aiDraft = aiSettingsDraft(state);
  aiHot = null;
  screen = 'aiSettings';
  requestRender();
}

/**
 * 关掉；`commit` 为真时把草稿里**变过的行**逐条发给引擎。
 *
 * 一行一个 `setAi`（引擎的 action 是按玩家给的）；没变过的行不发，
 * 免得往 `history` 里塞一堆空动作、也免得联机时白占序号。
 */
function closeAiSettings(commit: boolean): void {
  const draft = aiDraft;
  aiDraft = null;
  aiHot = null;
  screen = aiReturn;

  if (commit && draft !== null) {
    let changed = 0;
    for (const row of draft) {
      const p = state.players[row.player];
      if (p === undefined || rowMatchesPlayer(row, p)) continue;
      dispatch({
        type: 'setAi',
        player: row.player,
        whoPlays: row.whoPlays,
        aiFlags: row.aiFlags,
        personality: row.personality,
        cashRatio: row.cashRatio,
        stockRatio: row.stockRatio,
      });
      changed++;
    }
    log(changed === 0 ? '託管設定：未變更' : `託管設定：已更新 ${changed} 位`);
  }
  requestRender();
}

/** 把設定的取值真的作用到播放器与側欄上 */
function applyOptions(next: GameOptions): void {
  options = next;
  sound.setMuted(next.sound === 0);
  sound.volume = volumeOf(next.sound);
  music.setVolume(next.music === 0 ? 0 : volumeOf(next.music) * 0.25);
  // 設定里那三项：00 日曆 / 01 小地圖 / 02 兩者輪流（RICH4.CFG offset 5）
  // ⚠️ 「兩者輪流」怎么轮没查证，先当日曆（点一下可以手动换）
  sidebarView = next.windowView === 1 ? 'map' : 'calendar';
  // ⚠️ 换曲**不在这里** —— 原版是点列表那一下就立刻换（见 `onOptionsDown`），
  //   「確定」只负责把 cfg 写回去、并按新的音量档调播放器（VA 0x004109e2）。
  //   这里只在「音乐本来是关的、现在打开了」时补一次起播。
  // @source 0x004109b5..0x004109da：音乐开着、且刚才是关的（`ebx == 0`）⇒
  //   当前记的是背景曲（`[0x47e772] & 0x80`）就 `sub_00454d91(0)` = **背景曲的下一首**，
  //   否则 `fcn_004549cf([0x47e772])` 重放那首场所曲。設定屏只从標題／棋盘进，故这里总是背景曲那一支。
  if (next.music > 0 && !music.playing) playBoardBgm(0);
  if (next.music === 0) music.stop();
  // ★ 把 16 字节设定 + 28 条键位整份写回 `RICH4.CFG`
  //   @source `rich4_write_config()` VA 0x00411f80 —— 原版「確定」正是这一调
  //   （`loc_004109e2` 一带：写 cfg → 按新音量档调播放器）。先前只改内存（Q-OPT-1）。
  saveConfigToStore();
  requestRender();
}
let hud: Hud;
let sprites: SpriteCache | null = null;
let archives: LoadedArchives;

/** 開局設定的当前值 */
let setup: SetupState = defaultSetup();
/** 開局設定那一屏的整屏场景（`jump.mkf` 里那张 640×480，已经压到半亮） */
let setupScene: ImageBitmap | null = null;
/** 场景按哪张地图解的 —— 换地图要重新解 */
let setupSceneFor = -1;

/**
 * 点 `OK` 之后那段「拉幕」（原版状态 2）的开始时刻；null = 不在拉幕里。
 *
 * ★ 原版点 `OK` 并不是直接进棋盘：先由定时器把空座位补成電腦，再进状态 2 ——
 *   角色格往左、竖栏往右滑出屏幕、底部小人往右走出画面，**播完**才真的开局。
 *   见 `setup.ts` 的 `OUTRO_TICK_MS` / `outroOffsets`。
 */
let setupOutroAt: number | null = null;
/** 拉幕开始那一刻的场景滚动量（这期间原版不再推进它） */
let setupOutroScroll = 0;

/**
 * 按当前地图把开局设定屏的背景场景解出来。
 *
 * ★ 原版换地图时会重新 `read_mkf` + 换算一遍（`VA 0x00405625`），
 *   所以这里也只在**地图真的变了**的时候重解。
 */
function loadSetupScene(mapId: number): void {
  if (setupSceneFor === mapId) return;
  setupSceneFor = mapId;
  setupScene = null;
  void loadSetupSceneAsset(archives, mapId).then((bmp) => {
    if (setupSceneFor !== mapId) return;
    setupScene = bmp;
    requestRender();
  });
}

/**
 * 同步取一张图；没解出来的先返回 null 并在后台解，解完再重画一帧。
 *
 * ★ 画面是同步画的，而解码是异步的。不能在绘制里 await，
 *   否则一帧要等十几张图。故「先画能画的，解完再补一帧」。
 */
const spriteReady = new Map<string, Sprite | null>();
const spritePending = new Set<string>();
let spriteArrived = false;
function spriteNow(
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack = false,
): Sprite | null {
  const key = `${archive}:${resource}:${index}:${colorKeyBlack ? 'k' : ''}`;
  const hit = spriteReady.get(key);
  if (hit !== undefined) return hit;
  const cache = sprites;
  if (cache !== null && !spritePending.has(key)) {
    spritePending.add(key);
    void cache.get(archive, resource, index, colorKeyBlack).then((s) => {
      spriteReady.set(key, s);
      spritePending.delete(key);
      spriteArrived = true;
      requestRender();
    });
  }
  return null;
}

/**
 * 音效。
 *
 * ⚠️ 浏览器要求用户手势之后才能出声，故在首次点击/按键时解锁。
 *   在此之前的播放请求会被安静丢弃。
 */
const sound = new SoundPlayer();
// ★ 把「文本里的 #NNNN」接到同一个 SoundPlayer 上 —— 这是那 610 个低编号
//   能出声的唯一途径（见 `voice-sink.ts` 的说明）。
//
// ★ 去抖：`#NNNN` 的触发挂在**绘制**里（原版 `drawText_colorcode` 也是），
//   而复刻是整屏每帧重画 —— 实测魔法屋入口台词 2 秒被画 126 次，同一句于是被
//   `Stop → Play` 上百次，永远只响头几十毫秒。见 `audio.ts` 的
//   `VOICE_RETRIGGER_GAP_MS`。这里记住上一声真正起播的号与时刻。
let lastVoiceCode: number | null = null;
let lastVoiceAt = 0;
setVoiceSink((voice) => {
  // ★ 语音档案按需装载：`Speaking.mkf` 57MB，开机不装。此前只有**角色台词**
  //   那条路（`playSoundFor` → `ensureSpeakingArchive`）会拉它，于是文本里的
  //   `#NNNN`（魔法屋女巫那三句 `#0037/#0038/#0039` 就在这一类）在档案到货前
  //   一律被 `SoundPlayer.play` 安静丢掉 —— 用户报的「魔法屋没有女巫语音」。
  ensureSpeakingArchive();
  const now = performance.now();
  // ★ 两道闸门：同一句**还在响**就不重起（长语音不能被砍成结巴）；
  //   同一句连着来按 `VOICE_RETRIGGER_GAP_MS` 去抖（挡解码期间与每帧重画）。
  const stillPlaying = sound.isPlaying('Speaking.mkf', voice);
  if (!shouldRetriggerVoice(lastVoiceCode, lastVoiceAt, voice, now, stillPlaying)) return;
  lastVoiceCode = voice;
  lastVoiceAt = now;
  sound.play('Speaking.mkf', voice);
});

/**
 * 背景音乐。
 *
 * ⚠️ 与音效一样，得等用户手势之后才能出声；第一次点击时连音乐一起解锁，
 *   顺手放第一首。曲目顺序照 `MIDI_PLAYLIST`（取自游戏目录的 `Midi.txt`）。
 */
const music = new MusicPlayer();
// 一首背景曲放完 ⇒ 换下一首 @source `sub_00454d2c`（MCI 的放完通知）→ `sub_00454d91(0)`
music.onEnded = () => {
  if (bgmBackground) playBoardBgm(0);
};
/** 当前播到清单里的第几首 */
let musicTrack = 0;
let musicStarted = false;

async function playTrack(index: number): Promise<void> {
  const name = MIDI_PLAYLIST[((index % MIDI_PLAYLIST.length) + MIDI_PLAYLIST.length) % MIDI_PLAYLIST.length];
  if (name === undefined) return;
  musicTrack = index;
  await playTrackFile(name);
}

/**
 * 按**文件名**放一首（按屏取曲走这条 —— 原版 `fcn_004549cf(id)`）。
 *
 * ★ 与 `playTrack(index)` 的区别：那个是「整张清单顺序播」（`Midi.txt` 的顺序），
 *   这条是「某屏点名要哪一首」；曲号→文件名的映射在
 *   `@rich4/assets-pipeline` 的 `SCREEN_BGM` / `bgmAssetFileFor`。
 */
/**
 * 節日曲还要放几天 @source `[0x46cb06]` 的低 4 位。非 0 期间场所曲一律不放、场所收屏也不接背景曲
 * —— 整套节拍见 `holiday-bgm.ts`。
 */
let holidayBgmDays = 0;

/** 日推进那一刻的節日配乐 @source `sub_0041cf67` 开头 + `sub_00452444` */
function onDayAdvancedBgm(next: GameState): void {
  const step = holidayBgmOnDayAdvance(holidayBgmDays, next.globalMapId, next.year, next.month, next.day);
  holidayBgmDays = step.days;
  // 節日曲放完：接回背景曲的**下一首** @source 0x0041cf8e `call sub_00454acb` / 0x0041cf93 `push 0 / call sub_00454d91`
  if (step.ended) playBoardBgm(0);
  // 起節日曲：`fcn_004549cf(曲号 | 0x8000)` —— 0x8000 = 不记背景曲的断点（放完接的是下一首，不是断点）
  if (step.play !== null) {
    bgmBackground = false;
    bgmSaved = null;
    music.setLoop(true);
    void loadAndPlay(step.play, 0);
  }
}

async function playTrackFile(name: string): Promise<void> {
  // ★ 節日曲期间场所曲不放 @source `fcn_004549cf` 开头 0x004549da `cmp byte [0x46cb06],0 / jne 返回`
  if (holidayBgmDays > 0 && screen === 'game') return;
  // ★ 场所曲 / 標題曲打断背景曲：先把「放到哪儿了」记下来，回棋盘时接着放
  //   @source `fcn_004549cf` 开头：当前是背景曲（`[0x47e772] & 0x80`）⇒ `sub_00454b1a` 记位置
  if (bgmBackground) bgmSaved = { index: bgmIndex, at: music.positionS };
  bgmBackground = false;
  music.setLoop(true); // 场所曲放完原地重放 @source `sub_00454d2c` 的 `play mid from 0`
  await loadAndPlay(name, 0);
}

// ── 棋盘背景曲（8 首轮放）—— 三支例程的说明与出处见 `BOARD_BGM_FILES` ──

/** 背景曲号 0..7 @source `[0x47e771]` */
let bgmIndex = 0;
/** 此刻放的是不是背景曲 @source `[0x47e772] & 0x80` */
let bgmBackground = false;
/** 背景曲被场所曲打断时记下的位置 @source `[0x48cb70 + n]` / `[0x48cb50 + n×4]` */
let bgmSaved: { index: number; at: number } | null = null;

/**
 * 放背景曲 @source `sub_00454d91(arg)`：`arg ≠ 0` ⇒ 曲号 = `arg − 1`；`arg = 0` ⇒ 下一首。
 */
function playBoardBgm(arg: number): void {
  bgmIndex = arg !== 0 ? (arg - 1) & 7 : nextBoardBgm(bgmIndex);
  bgmBackground = true;
  bgmSaved = null;
  music.setLoop(false); // 放完换下一首（`music.onEnded`），不是单曲循环
  void loadAndPlay(BOARD_BGM_FILES[bgmIndex] ?? 'Rich08.mid', 0);
}

/**
 * 场所收屏 → 接着放被打断的背景曲 @source `sub_00454bcc`（每个场所的模态循环一返回就调）。
 * 没有记录（开局就进了场所之类）就从下一首放起。
 */
function restoreBoardBgm(): void {
  const saved = bgmSaved;
  if (saved === null) {
    playBoardBgm(0);
    return;
  }
  bgmIndex = saved.index;
  bgmBackground = true;
  bgmSaved = null;
  music.setLoop(false);
  void loadAndPlay(BOARD_BGM_FILES[bgmIndex] ?? 'Rich08.mid', saved.at);
}

/** 監獄／醫院探訪屏这一场的配乐点过了没有 */
let bailBgmOn = false;

/**
 * 監獄／醫院探訪屏的配乐 @source `0x0043d38c push 0xf`（監獄 ⇒ MIDI15）/ `0x0043ea38 push 0x10`（醫院 ⇒ MIDI16），
 *   两处紧跟着就是各自的模态循环，返回后 `sub_00454bcc` 接回背景曲（`boardBgmDue`）。
 */
function syncBailBgm(): void {
  const p = state.pending;
  if (screen !== 'game' || p === null || p.kind !== 'bail') {
    bailBgmOn = false;
    return;
  }
  if (bailBgmOn) return;
  bailBgmOn = true;
  void playTrackFile(p.place === 'prison' ? 'midi15.mid' : 'midi16.mid');
}

/**
 * 棋盘上该不该把背景曲接回来：人在棋盘、放的不是背景曲、而且**没有任何场所开着**。
 * 原版是各场所自己在模态循环返回后调 `sub_00454bcc`；本引擎的场所有的是整屏（`activeUiScreen`）、
 * 有的挂在 `pending` 上（銀行 / 商店 / 樂透…），统一在渲染循环里判这一条，免得每个出口各写一遍。
 */
function boardBgmDue(): boolean {
  if (screen !== 'game' || bgmBackground) return false;
  // 節日曲还在放 ⇒ 不接背景曲 @source `sub_00454bcc` 的 0x00454bd5 同一道闸
  if (holidayBgmDays > 0) return false;
  if (activeUiScreen() !== null) return false;
  const kind = state.pending?.kind;
  if (kind !== undefined && kind !== 'none') return false;
  return true;
}

async function loadAndPlay(name: string, fromS: number): Promise<void> {
  try {
    // ⚠️ 磁盘上的文件名是小写（midi01.mid），`Midi.txt` 里是大写；
    //   大小写敏感的文件系统上按实际文件名取，取不到就试另一种写法。
    let res = await fetch(`${assetBase()}/${name}`);
    if (!res.ok) res = await fetch(`${assetBase()}/${name.toLowerCase()}`);
    if (!res.ok) {
      log(`⚠ 找不到配乐 ${name}`);
      return;
    }
    music.play(name, new Uint8Array(await res.arrayBuffer()), fromS);
    log(`♪ ${name}`);
    renderPanel();
  } catch {
    log(`⚠ 配乐 ${name} 载入失败`);
  }
}

/** 第一次用户手势：把音效与音乐一起解锁，并补播解锁前点过的那一首 */
function unlockAudio(): void {
  sound.unlock();
  music.unlock();
  if (musicStarted) return;
  musicStarted = true;
  // ★ 解锁**之前**点过的那一首（标题 MIDI01 就是开机就点的）由
  //   `MusicPlayer.unlock()` 从 `#pending` 里自己补播；这里只处理「那次点播
  //   没赶上上下文、现在也没有曲子」的兜底。
  const resume = shouldResumeAfterUnlock(screen, music.current);
  if (resume === null) return;
  // ★ 第一次手势时人在標題畫面 → 点的是標題那一首（`fcn_004026e2` 的 `fcn_004549cf(0)`），
  //   不是 `Midi.txt` 清单的第一首；清单只在棋盘/其它没点名曲子的场合当兜底。
  if (screen === 'title') void playTrackFile('midi01.mid');
  // 人已经在棋盘 / 片头上（调试直达、或点播没赶上解锁）⇒ 起的是**背景曲**，不是一首场所曲
  else if (screen === 'game' || screen === 'intro') playBoardBgm(1);
  else void playTrackFile(resume);
}

/**
 * ★ 任何一次用户交互都要能解锁音频 —— 不只是画布上的那一下。
 *
 * 浏览器（以及 Tauri 的 webview，同一套 autoplay 政策）要求 `AudioContext`
 * 在**用户手势之后**才能出声。先前只有 `#board` 画布的 mousedown/click 与
 * window 的 keydown 会解锁：用户点在右侧面板/日志、或者触摸屏上点一下，
 * 都没解锁 —— 表现就是「打开游戏后背景音乐不自动播，要点（画布）一下才播」。
 *
 * 这里在 window 上补 pointerdown / keydown / click / touchstart 四条，
 * `capture` + `once`：捕获相先于任何业务监听，命中一次就摘掉。解锁后立刻
 * 补播当前该放的那首（见 `unlockAudio`）。桌面版与浏览器同源，**不写平台分支**。
 */
function bindAudioUnlock(): void {
  const once: AddEventListenerOptions = { once: true, capture: true };
  const types: readonly (keyof WindowEventMap)[] = [
    'pointerdown',
    'keydown',
    'click',
    'touchstart',
  ];
  for (const type of types) window.addEventListener(type, () => unlockAudio(), once);
}

/**
 * 原版底图。
 *
 * 节点坐标与底图像素同一个原点，直接按 (0, 0) 铺即可
 * （依据见 assets-pipeline 的 ground.ts）。G 键可开关，
 * 方括号/分号/引号键微调偏移——留作核对手段。
 */
let ground: ImageBitmap | null = null;

/**
 * HD 素材来源（拿不到清单就是 null）—— `boot()` 里定，之后只读。
 *
 * 底图也要走它：`loadGround` 的第三参数。见 Q-PERF-GND §三 第 1 条。
 */
let hdSource: HdSource | null = null;

/**
 * 换一张底图。
 *
 * ★ **换图即丢**是这一层的释放策略：HD 底图是 9216²（324MB），
 *   不 `close()` 也要等 GC，而它一直有引用直到下一张来 —— 显式关掉旧的
 *   才不会出现「两张 324MB 同时活着」。与 `loadGround` 的调用点一一对应。
 */
function setGround(next: ImageBitmap | null): void {
  if (ground !== null && ground !== next) ground.close();
  ground = next;
}
let showGround = true;
const groundOffset = { x: 0, y: 0 };

/**
 * 小地图底图 —— `map.mkf` 资源 `(地图号 + 0x10)` 图 0（200×200 的成品图）。
 * 换地图时要跟着换，见 `loadMapAssets`。
 */
let minimapBg: ImageBitmap | null = null;

/**
 * 小地图上的**标记点**（世界坐标）。点小地图留下，镜头就停在它上面。
 *
 * @source 原版三个全局：`[0x48be18]`（非 0 = 有标记）、
 *   `[0x48be1c]`/`[0x48be20]`（世界坐标，已夹在 `[220, 2084]`）。
 *   镜头居中时（`fcn_00415e70`，VA 0x00415e70）**有标记就用标记、否则用当前玩家**；
 *   走到标记上、或右键点别处，标记就清掉。
 */
let minimapMarker: { x: number; y: number } | null = null;
/**
 * ★★ 换人行动时把小地图标记收掉、镜头交还给当前玩家（试玩 4：
 *   「手动调整小地图后，镜头无法自动跟随接下来的行动」）。
 *
 * 原版 `fcn_00415e70` 的居中判据是**有标记就用标记、否则用当前玩家**；
 * 而本引擎点小地图会同时置 `followPlayer = false`（`centerOnMarker`）——
 * 那个标志**只在右键 / 走到标记上**才恢复，于是「下一位开始行动」时镜头
 * 仍然钉在旧标记上。
 *
 * 口径：**回合换人的那一条 action** 到来时把标记收掉（标记是「看一眼」
 * 的工具，不是模式开关）：这样 NPC 走子与自己的新回合都会重新跟随。
 */
function retargetCameraOnTurnChange(before: GameState): void {
  if (minimapMarker === null && followPlayer) return;
  const changed =
    before.currentPlayer !== state.currentPlayer || before.turnCount !== state.turnCount;
  if (!changed) return;
  minimapMarker = null;
  followPlayer = true;
}

/** 正按着的小地图箭头（松开才转视角）@source `[0x48be28]` */
let pressedMinimapArrow: MinimapArrowId | null = null;
/** 鼠标悬停的小地图箭头 —— 悬停时换成高亮图 @source VA 0x00418415 */
let hotMinimapArrow: MinimapArrowId | null = null;
/** 正拖着小地图（按住本体平移镜头）@source `[0x48be29]` / 拖动中 `[0x48be2a]` */
let draggingMinimap = false;

/** 换地图时重取小地图底图（`map.mkf` 资源 `地图号+0x10` 图 0） */
function loadMinimapAssets(globalMapId: number): void {
  if (archives === null) return;
  minimapBg = null;
  void loadMinimapBackground(archives, globalMapId).then((b) => {
    minimapBg = b;
    requestRender();
  });
}

/**
 * 今天的節日插画（`Data.mkf` 的 200×200 裸位图）。非節日为 null。
 *
 * ★ 它随**日期**变，而日期是走子走出来的 —— 所以不挂事件，改成每次渲染时
 *   「对一遍」：算一下今天该是哪张，与手里那张不同就去取。幂等，且不必去
 *   猜日期在哪几个动作里会被改。
 */
let holidayArt: ImageBitmap | null = null;
let holidayKey: string | null = null;

function syncHolidayArt(): void {
  if (archives === null || screen !== 'game') return;
  const idx = holidayIndexOf(state.globalMapId, state.year, state.month, state.day);
  const key = `${state.globalMapId}:${idx}`;
  if (key === holidayKey) return;

  holidayKey = key;
  holidayArt = null;
  if (idx < 0) return;
  void loadHolidayArt(archives, state.globalMapId, idx).then((b) => {
    if (holidayKey !== key) return; // 期间又翻页了，这张已经过期
    holidayArt = b;
    requestRender();
  });
}

/**
 * 镜头跟随当前玩家。
 *
 * 原版的视野就是**跟着棋子走的**（截图里看到的是 1:1 的局部，
 * 全局靠右下角的小地图），故默认开启。
 * 用户一旦自己拖动或缩放视图就自动关掉——别跟玩家抢镜头。
 */
let followPlayer = true;

/** 正按着的工具栏按钮 —— 抬手时按它派发 @source `[0x48be28]`（WM_LBUTTONDOWN 写入） */
let pressedTool: number | null = null;

/**
 * 光标底下那个工具栏按钮 —— **只管高亮**。
 *
 * ★ 原版的高亮跟「按下」是**两个变量**：`[0x48bde4]` 在 WM_MOUSEMOVE 里
 *   按 `x/40` 更新（`loc_00418b0a`），鼠标一离开工具栏就置 −1；
 *   而按下态 `[0x48be28]` 是 WM_LBUTTONDOWN 写的。所以**没按也会亮** ——
 *   先前只用一个变量，等于把「按下去才亮」当成了原版行为。
 */
let hotTool: number | null = null;

/** 走过的 action —— 回放、联机对账、以及排错都靠它 */
const history: Action[] = [];

/**
 * 联机句柄；单机为 null。
 *
 * ★ 联机时（T-074 / PRD REQ-14.2）本地**从不**自己 reduce 自己的输入：
 *   `dispatch` 只把 action 作为意图发给服务器，服务器定序广播回来的
 *   才由 `applyAction` 施加。于是本地输入、远端输入、电脑代打三者走的
 *   是同一条路，与单机的 reduce 完全一样——这就是确定性联机不需要回滚的原因。
 */
let net: NetClient | null = null;

/**
 * 掷骰的本地预测动画（T-075）。纯表现：不读 `state.dice`、不写 state，
 * 故与确定性重放（C-DET-4）无关——`history` 里绝不会出现它。
 */
const diceFx = new DiceRollFx();

/** 只有自己座位的回合才轮到本机做决定（联机）；单机永远是 */
function localSeatActive(): boolean {
  return net === null || net.seat === state.currentPlayer;
}

function dispatch(action: Action): void {
  if (net !== null) {
    net.submit(action);
    return;
  }
  applyAction(action);
}

/**
 * 飞行记录仪（`flight-recorder.ts`）—— 旁路抄一份「起点快照 + 每条 action + 宿主种子」，
 * 出事时按 **F9** 落成一份可重放的问题回报。纯旁路：不读也不写 `state`（C-DET-4）。
 */
const recorder = new FlightRecorder();

/**
 * **两条施加路径共用**的漏斗（`applyAction` 与 `scheduleAi`）：种子在这里取一次，
 * 既喂给 `reduceWithHostRng`、也记进轨迹 —— 少了它，日推进那次 `reseed` 就重放不出来。
 */
function reduceRecorded(action: Action): GameState {
  const seed = clockSeed();
  const before = state;
  const next = reduceWithHostRng(before, action, topo, seed);
  if (next !== before) {
    recorder.record({ t: Date.now(), action, seed }, before.turnCount, () => serializeGame(before));
    // 只认**日推进**（`sub_0041cf67`）；設定屏「日期頁」直接改日期那一条（`setDate`）不走那支函数
    const dayMoved = next.day !== before.day || next.month !== before.month || next.year !== before.year;
    if (dayMoved && action.type !== 'setDate') onDayAdvancedBgm(next);
  }
  return next;
}

/**
 * 屏幕提示条（toast）—— 见 `toast.ts`。只留**最新一条**，到点自己收。
 *
 * ★ 原版没有这个东西，是需求方明确要求的（F9 存回报要有明显提示）。
 *   画在渲染链的最上面（见 `requestRender` 的帧尾），所以任何一屏都盖得住。
 */
let toast: Toast | null = null;

/** 出一份问题回报（F9 / 未捕获异常 / `__rich4.report()`）；落盘位置写进日志栏 + toast */
let reportBusy = false;
function fileReport(reason: 'manual' | 'error' | 'stall', note = ''): void {
  if (reportBusy) return;
  reportBusy = true;
  let screenshot: string | null = null;
  try {
    screenshot = canvas.toDataURL('image/png');
  } catch {
    screenshot = null; // 画布被污染 / 取不到就算了，别因为截图丢掉整份回报
  }
  const now = new Date();
  const report = recorder.report({
    reason,
    note,
    env: {
      userAgent: navigator.userAgent,
      desktop: isDesktop(),
      url: window.location.href,
      screen,
      // ★ 此刻接管整屏的那一屏（`null` = 棋盘本身）—— 光看 `screen`
      //   分不出「卡在魔法屋」还是「卡在開獎屏」，而这两类的复现路径完全不同。
      overlay: activeUiScreen()?.id ?? null,
      phase: state.phase,
      currentPlayer: state.currentPlayer,
      pending: state.pending?.kind ?? null,
      turnCount: state.turnCount,
      mode: state.mode,
      net: net === null ? null : { seat: net.seat },
      options,
      canvas: { w: canvas.width, h: canvas.height, dpr: window.devicePixelRatio },
      // ★ 出事前最后 120 行日志（见 `logRing`）
      log: logRing.toArray(),
    },
    finalState: serializeGame(state),
    finalFingerprint: stateFingerprint(state),
    finalTurn: state.turnCount,
    screenshot,
    now,
  });
  void writeReport(reportFileName(now, reason), JSON.stringify(report))
    .then((where) => {
      log(where === null ? '⚠ 問題回報寫不出去' : `📝 問題回報已存：${where}`);
      // ★ 试玩回报：日志栏那行没人看得见 ⇒ 再立一条明显的 toast（失败是另一类）
      toast = reportToast(performance.now(), where);
      requestRender();
    })
    .finally(() => {
      reportBusy = false;
    });
}

/** 真正施加一条 action：单机由 dispatch 直达，联机由服务器广播到达 */
function applyAction(action: Action): void {
  const before = state;
  retargetCameraOnTurnChange(before);
  // ★ 单机：日推进那一刻由宿主重新播种（原版 `0x41D06E` 的 `srand(GetTickCount())`）——
  //   见 `rng-host.ts`；联机策略下它是空操作。
  state = reduceRecorded(action);
  if (state !== before) {
    // ★ 掷骰那一段：点数到手 → 开滚。影片没解好先挂着，解完再补。
    //   纯表现，`diceFx` 不读也不写 state（C-DET-4）。
    if (action.type === 'rollDice') {
      // ★ 遥控骰子（8）：点数已经由玩家选定 ⇒ **这一掷不播预动作/滚骰**（试玩回报）。
      //   原版这一段仍会播滚骰影片（`fcn_00419572` 的 `call 0x45144f`），
      //   跳过动画是需求方要求的偏离，见 `forcedRollSkipFx` 的注释。
      if (forcedRollSkipFx) {
        forcedRollSkipFx = false;
        diceFx.cancel();
      } else {
        // 单机的预动作已经在 `requestRoll` 里起好了；联机时点数由服务器定序，
        // 本机这一按只负责把动画领走（不动画就自己起一段）。
        if (!diceFx.active) {
          const me = state.players[state.currentPlayer];
          if (me !== undefined) {
            diceFlicNow(Math.max(1, Math.min(3, me.ndices || 1)));
            diceFx.begin(performance.now(), diceAnticipateTicks(me), tickMs(options.speed), me.ndices || 1);
            // ★ 自己起的动画也要挂上 `dicePoll` —— 这条岔路先前没挂，于是相位没人推进、
            //   `active` 恒真，回合驱动全被挡死（同一天的第二个卡死来源）。
            window.setTimeout(dicePoll, 16);
          }
        }
        diceFx.roll(performance.now(), state.dice, diceFlic.get(state.dice.length) ?? null);
        playDiceSound();
      }
    } else if (state.phase !== 'moving' && !diceFx.active) {
      diceFx.cancel();
    }
    // 这一条 action 该起哪些表现动效（真人 / 联机广播两条来源都经过这里）
    startActionFx(action, before);
    // 走子补间（真人 / 联机两条来源都在这一条路上）
    tweenStepIfMoved(action, before);
  }
  if (state !== before) {
    history.push(action);
    notifyApplied(before);
  }
  requestRender();
  renderPanel();
  scheduleAi();
  scheduleHumanTurn();
  autosaveIfEnabled();
}

/**
 * 一条 action **已经落地**之后的通知：音效 / 語音 / 台词气泡、界面状态同步、各整屏的起播。
 *
 * ★★ 2026-09-19（第三份试玩回报 #5 / #6 / #11）：这一段先前**只挂在 `applyAction` 上**，
 *   而电脑那条是绕开它自己 `reduce` 的直路（`scheduleAi`）—— 于是电脑的一切动作：
 *   - 語音与角色台词气泡一句不出（`playSoundFor` 是唯一出口）；
 *   - 踩到 命運 / 新聞 / 魔法屋 不出提示框（各整屏靠 `event(before, after)` 起播）；
 *   - 機器娃娃上路的那一声（音效 38）不响。
 *   原版这些都**不分人机**。与 `startActionFx` 同一个教训：两条来源必须共用出口。
 */
function notifyApplied(before: GameState): void {
  playSoundFor(before, state);
  // ★ 状态一变，填数页指着的那个选项下标就可能已经不是同一回事了
  //   （`pending` 换了一种，甚至换了人）。一律收掉。
  amountPage = null;
  dialogHot = null;
  // ★ 商店的界面状态跟着 `pending` 走：进店时快照货架、铺开场；离店时清掉。
  //   放在这里是因为不管谁答的（本地点、AI、服务器广播）都会经过这一条。
  // ⚠️ 电脑自己逛店 / 进銀行时**不铺场**（保持先前的行为：那两屏是给真人点的，
  //   电脑那一手由 `decidePending` 直接答掉；原版此刻是否铺场未查证，不擅自改）。
  const aiVenue = isAiTurn(state) && (state.pending?.kind === 'shop' || state.pending?.kind === 'bank');
  if (!aiVenue) {
    syncShopUi();
    // ★ 銀行貸款屏的界面状态（T-029c）同理：`pending.kind === 'bank'` 时铺场，
    //   离场时清掉。状态机自己会跨 action 活着，所以只在**首次**看见它时建。
    syncLoanUi();
  }
  // ★ 登记的整屏：把「刚刚发生了什么」告诉它们（開獎 / 月結 / 魔法屋 / 事件框靠这个起播）
  const env = uiEnv();
  for (const s of SCREENS) s.event?.(before, state, env);
}

/**
 * 一条 action 落地后该起哪些**表现动效** —— 两条来源（真人 `dispatch → applyAction`、
 * 电脑 `scheduleAi` 的直路）**共用这一个出口**。
 *
 * ★ 2026-09-16 抽出来：先前三处钩子只挂在 `applyAction` 上，而电脑那条是绕开它
 *   自己 `reduce` 的直路 —— 结果**电脑用道具时看不到任何动效**（投掷 / 大锤），
 *   卡片飞行只在 AI 那条补了一句。原版这些影片**不分人机**都会播
 *   （唯一的例外是 20/22 个卡片调用点带 `who_plays == 1` 闸门，见 `throw-fx.ts`）。
 *
 * 纯表现：不读也不写 `GameState`（C-DET-4）。
 */
function startActionFx(action: Action, before: GameState): void {
  // 放置類道具（路障/地雷/定時炸彈）真正落地 → 投掷动效 + 落地音
  if (action.type === 'useTool') startObjectFlight(before, action);
  // 機器工人（9）/ 魔法屋「就地加蓋」/ 天使卡（9）原地建屋 → 大锤影片
  // （盖到 5 级时接 `0x20b`）。判据在 core 的 `lastBuildUpgrades` 里，不看 action 种类。
  startBuildFx(before);
  // 卡片 / 請神符的飞行动效（Q-TOOL-5）—— 是否真的播由 exe 的闸门定
  if (action.type === 'useCard') startCardFlight(before, action);
  // ★★ 「踩到惡犬」那一段（試玩回報：踩到狗直接進醫院、没有咬人动画/配音）——
  //   **必须排在 `startConfineFx` 之前**：原版那一支先把 0x214 播完、才走到
  //   `send_to_hospital` 里的 0x20c（VA 0x0041b837 → 0x0043ed59）。
  //   这一段不带 `options.animation` 闸（原版那一支没有 `cmp [0x497159], 0`），
  //   详见 `dog-fx.ts` / `startDogFx`。
  startDogFx(before, state);
  // ★ 「送進監獄／醫院」那一段 FLIC（Q-ANIM-1 未接清单之一）—— 与 action 种类无关：
  //   判据是**占用表/计数变没变**（`confine-fx.ts` 的 `confineFxTrigger`），
  //   因为送去坐牢/住院的来源有十来个（卡、狗咬、踩雷、命運、新聞、罰款…），
  //   逐个 action 种类去接必漏。
  startConfineFx(before, state);
  // ★ 神明降臨／發威（Q-ANIM-1）—— 判据是 `player.godInfo` 刚变（`god-fx.ts`）
  startGodFx(before, state);
  // ★ 新聞 4「外星人攻打地球」的飛碟影片（試玩回報：那一段被整个跳过）——
  //   判据是 `lastEvent` 刚变成 `{ news, 4 }`（`alien-news-fx.ts`）。
  //   ⚠️ **排在这里**（住院影片之后）：原版 `fcn_0044913d` 是先让
  //   `damage_area` 里那几次 `send_to_hospital`（各自播 0x20c）跑完、
  //   最后才 `read_mkf(0x213)` + `fcn_0045144f`（VA 0x00449245/0x0044925b）。
  //   ⚠️ 也**不**加 `options.animation` 闸：原版这一支里没有
  //   `cmp [0x497159], 0`（与住院/入獄/神明那三支不同），照 exe 走。
  startAlienNewsFx(before, state);
}

/**
 * 走一格之后起走子补间。
 *
 * ★★ 2026-09-16 修「真人走子是瞬移」：先前**只有 AI 那条**（`scheduleAi` 里的
 *   `reduce` 直路）调 `startStepTween`，真人走 `dispatch → applyAction` 这条
 *   完全没起补间 —— 于是自己走的一步直接跳过去，与 T-046 的契约（逐格滑）不符。
 *   放在 `applyAction` 里统一覆盖「本地点 / 联机广播」两条来源；
 *   AI 那条不走这里（它自己 `reduce` + 起补间），所以不会重复起。
 */
function tweenStepIfMoved(action: Action, before: GameState): void {
  if (state === before) return;
  // ★★ 判据与起终点都收在 `walkTweenFor`（纯函数、有单测）：
  //   ① 走一格：`lastNodeId → nodeId` 两格之间；
  //   ② 「走回棋盘」那一回合（第 86/87 条）：core 把 `x/y` 从綠島/醫院大樓
  //      回填成監獄/醫院格 —— 原版由走路例程逐帧走回去
  //      （`trunc(676 / 8) = 84` tick，**世界距离**，见 `startStepTween`）。
  const t =
    action.type === 'step' || action.type === 'startTurn'
      ? walkTweenFor(action.type, before, state, (id) => map.nodes[id - 1])
      : null;
  if (t === null) return;
  const p = state.players[t.player];
  // ★ `t.special`（不写死 false）：走回棋盘走 `dist × 0.125` 那一支 —— 见 `tween.ts`
  renderer.startWalk(
    t.player,
    t.from,
    t.to,
    (p?.trafficMethod ?? 0) & 3,
    t.special,
    tickMs(options.speed),
  );
}

/**
 * `Speaking.mkf` 的**按需装载**（T-052）。
 *
 * ★ 它 57MB，开机不装（见 `boot()` 末尾的注释）；第一次真的要说话时才在
 *   后台拉一次 —— 这就是 `audio.ts` 里「Speaking.mkf 按需再装」那一条的
 *   「需」。`SoundPlayer.play` 在档案没装时安静丢弃，故**头一句听不到**，
 *   之后的都能听到。这个取舍是刻意的：不为一次可能的语音拖慢开局。
 *
 * ⚠️ 音效关掉时连拉都不拉（`sound.muted`）—— 静音那一条路仍然只有
 *   `SoundPlayer` 自己在走，这里不另开一条。
 */
let speakingLoading = false;
function ensureSpeakingArchive(): void {
  if (speakingLoading || sound.muted) return;
  speakingLoading = true;
  void fetch(`${assetBase()}/Speaking.mkf`)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((buf) => {
      if (buf === null) return;
      sound.addArchive('Speaking.mkf', new Uint8Array(buf));
      log('語音载入：Speaking.mkf（角色語音）');
    })
    .catch(() => {
      speakingLoading = false; // 失败就允许下次重试
      log('⚠ 語音载入失败');
    });
}

/**
 * 按状态变化放音。
 *
 * ⚠️ 只接**能从调用点反查出编号**的那几个事件（见 assets-pipeline 的
 *   `SOUND_IDS`）。其余事件的音效编号还没查，宁可不响也不乱响。
 *
 * ⚠️ 另外：编号与 `Effect.mkf` 的资源号是否直接相等**尚未验证**，
 *   中间可能还隔着一张表。听起来不对就是这个原因。
 *
 * ★ T-052 起这里还接**角色語音**：`speechEventsFor(before, after)`（见
 *   `speech.ts`）把状态跃迁翻成 `(玩家, 事件号)`，再由 `speechResourcesFor`
 *   换算成 `Speaking.mkf` 资源号。探测器本身是纯函数（不读 DOM、不碰音频、
 *   不动 PRNG），故能单测。
 *
 * ⚠️ 原版的 `_rich4_player_say` 是**一句播完再返回**，而这里的两三个
 *   `sound.play` 是即发即忘 —— 同一动作派生多句时会叠着响。登记在
 *   `docs/deviations/T-052.md`。
 */
function playSoundFor(before: GameState, after: GameState): void {
  // 有人出局
  const deadBefore = before.players.filter((p) => p.whoPlays === 0).length;
  const deadAfter = after.players.filter((p) => p.whoPlays === 0).length;
  if (deadAfter > deadBefore) {
    sound.play('Effect.mkf', SOUND_IDS.BANKRUPT);
  } else if (after.pending?.kind === 'bank' && before.pending?.kind !== 'bank') {
    // 落在银行
    sound.play('Effect.mkf', SOUND_IDS.BANK);
  }

  // ★ **使用道具 1（機器娃娃）**那一下 —— 音效 38（见 `SOUND_IDS.DOLL`）。
  //
  // @source VA 0x0040deb9..0x0040dedc（`fcn_0040dd1f` 的 actor 8 分支）：
  //   娃娃上路那一支**不查交通方式**，直接播移动音效表 0x48234a 的**第 9 项**
  //   （走完再按同一个索引 `[0x4749d4] = 9` 把它 Stop，VA 0x0040d8dc）。
  //
  // ⚠️ 判据不能看替身记录：`runDoll` 走完就把它收回 `idleActor()`
  //   （`specialActors[4]` 在动作前后都是「未出场」），看记录等于永远认不出来。
  //   能认的只有 core **刚交出来的那趟路径** —— `lastNpcWalks` 是整体覆写，
  //   数组换了身份就说明刚发生了一趟；槽 4 只可能是娃娃（`npcRound` 走 0..3、
  //   `bail` 走被保釋那个惡人的槽）。看动作类型也行，但这条对
  //   「AI 用 / 服务器广播用」同样成立 —— 原版也是谁在场都听得见。
  if (
    after.lastNpcWalks !== before.lastNpcWalks &&
    after.lastNpcWalks.some((w) => w.slot === specialSlotOf(ACTOR_DOLL))
  ) {
    sound.play('Effect.mkf', SOUND_IDS.DOLL);
  }

  // 角色語音（T-052）。`speechResourceFor` 已经把越界挡在外面 ——
  // T-051 的 `speechIndex()` 对越界**抛 RangeError**（原版无边界检查），
  // 表现层不该因此把整局打断，故这里只播合法的那几个。
  // ★★ 先出**卡牌台词**（原版那句在卡片函数体内，先于效果引发的台词），
  //   再出状态跃迁派生的台词 —— 顺序与原版一致。
  const cardBubbles = cardPlaySpeech(before, after);
  if (cardBubbles.length > 0 && speechQueue.push(cardBubbles, performance.now()) > 0) {
    requestRender();
  }
  const spoken = speechEventsFor(before, after, topo);
  if (spoken.length === 0) return;
  ensureSpeakingArchive();
  // ★ 语音**不在这里放** —— 见 `speechTick()`。
  //   原版 `_rich4_player_say` 是**一句播完再返回**（同步），一次 `applyAction`
  //   里派生出的两三句是**一前一后**；先前这里循环 `sound.play` 是**同时**响
  //   （登记为 Q-SPEECH-6）。现在语音跟着**显示队列**走：一段开始显示才放它那句。
  // ★ 2026-09-16：不光出声，还把**说话人自己那一句**显示出来。
  //   原版 `_rich4_player_say` 的两步（白字字幕 + 金貝貝那种 `@DD` 表情图）
  //   由 `speech-bubble.ts` 负责；`speechBubblesFor` 把 `SayEvent` 翻成排好版的段落。
  //   金貝貝那一列**整列没有文本也没有语音**，只有一张 `Data.mkf #0x207` 的表情图
  //   （见 `@rich4/data` 的 `SPEECH_LINES` 与 `speechEmojiImage`）。
  if (speechQueue.push(speechBubblesFor(after, spoken), performance.now()) > 0) {
    requestRender();
  }
}

// ============================================================
//  电脑玩家
// ============================================================

let aiTimer: number | null = null;

/**
 * 轮到电脑时自动走。
 *
 * ★ AI 产出的 action 与人类点按钮产生的**完全同类**，
 *   都经由 `dispatch` 走同一个 reduce（C-ARC-4）。
 *   这里唯一的差别只是「谁按的」和一个便于观战的延时。
 */
function scheduleAi(): void {
  if (aiTimer !== null) {
    clearTimeout(aiTimer);
    aiTimer = null;
  }
  // ★ 出局者的回合由引擎推进，与「是否开着托管」无关——
  //   否则人类玩家一破产，整局就停在他身上不动了。
  // ★ 但**出局者名下排着拍卖**时 `autoAction` 同样返回 null（它不认竞价），
  //   这时必须照常去问 `decideAction` —— 它会替在场座位上还没出局的电脑举牌
  //   （见 `state/reduce.ts` 的 `orphanedAuction`）。否则破产清算那几场拍卖
  //   会把整局钉在 `awaitingDecision` 上。
  if (
    autoAction(state) === null &&
    (!aiAutoPlay || !isAiTurn(state)) &&
    !orphanedAuction(state)
  ) {
    return;
  }
  // 联机：电脑座位由服务器代打，别的真人座位由他们自己的客户端驱动；
  //   本机只替**自己的座位**拿主意（出局后的空转、本机开的託管），并且
  //   照样作为意图发出去，不在本地施加。
  if (!localSeatActive()) return;
  // ★ 联机的竞价：AI 控制的那一口（电脑 / 掉线代打 / 本机开的託管）**全部**归服务器出
  //   （`server/hub.ts` 的 `#driveComputers`）；提交权此刻属于举牌者而不是回合主人
  //   （core `actingSeat`），本机再发只会被定序器拒掉（issue #9）。
  if (net !== null && state.pending?.kind === 'auction') return;
  aiTimer = window.setTimeout(() => {
    aiTimer = null;
    // ★ 节拍闸（T-047）：替身还在滑就重排、绝不派下一步 —— 判据见 holdForActorWalk
    //   重排用**一个渲染周期**去看（`aiRepoll`），不是再等一整个 AI 间隔
    if (
      holdForActorWalk(() => {
        aiRepoll = true;
        scheduleAi();
      })
    ) {
      return;
    }
    const action = decideAction({ state, map });
    if (action === null) {
      // 轮到电脑却拿不出 action —— 这是**卡住**，不是「没事可做」，
      // 必须说出来。先前这里是静默 return，一个漏掉的 scheduleAi 就此藏了很久。
      // ★ 例外：拍賣 pending 期间 core 会**故意**返回 null —— 竞价循环由
      //   `auction-screen.ts` 驱动（它每次问 core 的 `auctionNextBid`），
      //   这里不是卡住，别刷屏（Q-AUC-1）。
      if (isAiTurn(state) && state.pending?.kind !== 'auction') {
        log(`⚠ 电脑在 ${state.phase} 无事可做，已停手`);
      }
      return;
    }
    if (net !== null) {
      net.submit(action);
      return;
    }
    if (action.type === 'step') stepTick();
    // ★ 掷骰先播预动作再掷：拦一道，等 `dicePoll` 里真的 dispatch
    if (action.type === 'rollDice') {
      // 动画正开着（上一次还没收摊）→ 这一拍没接走，**必须重排**，
      // 否则电脑永远停在 awaitingRoll（实测卡死 84 秒以上且不自愈）。
      if (!requestRoll()) scheduleAi();
      return;
    }
    const before = state;
    const walker = action.type === 'step' ? state.currentPlayer : null;
    // ★ 与 `applyAction` 同一个宿主播种漏斗（日推进后重播种）
    state = reduceRecorded(action);
    if (walker !== null && state !== before) startStepTween(walker);
    // ★ 「走回棋盘」那一回合也要演一段位移（与 `tweenStepIfMoved` 同源）
    if (action.type === 'startTurn' && state !== before) tweenStepIfMoved(action, before);
    // ★ 动效出口**与 `applyAction` 共用同一个函数**（Q-TOOL-5 ⑤14）：
    //   电脑这一步是**绕开 `applyAction` 的直路**（它自己 `reduce`），
    //   先前只在这里补了 `useCard` —— 于是电脑用道具（路障/地雷/炸彈的投掷、
    //   機器工人的大锤）**一次动效都看不到**，而原版不分人机都会播。
    if (state !== before) startActionFx(action, before);
    if (state === before) {
      log(`⚠ AI 在 ${before.phase} 给出无效 action ${action.type}，已停手`);
      aiAutoPlay = false;
      renderPanel();
      return;
    }
    history.push(action);
    aiLastAction = action.type;
    notifyApplied(before);
    requestRender();
    renderPanel();
    scheduleAi();
    scheduleHumanTurn(); // 电脑走完，轮到人时接着推进机械步骤
  }, aiDelay());
}

let aiAutoPlay = true;
/** 电脑上一条生效的 action —— 只用来定下一条该等多久 */
let aiLastAction: Action['type'] | null = null;
/** 这一次排程是不是「演出还没播完，回头再看一眼」 */
let aiRepoll = false;

/**
 * 电脑两条 action 之间等多久。
 *
 * ★★ 2026-09-19（试玩回报「游戏进行速度偏慢」）：先前这里是**写死的 120 ms**，而且
 *   `holdForActorWalk` 的重排也按 120 ms 轮询。用飞行记录仪的时间戳实测一个电脑回合：
 *   `startTurn →(124)→ aiNext →(124)→ aiNext →(124)→ aiNext → rollDice`、落地后
 *   `settle →(124)→ buy →(124)→ endTurn →(124)→ startTurn` —— **每回合约 1 秒是纯空等**；
 *   每走一格还被向上取整到 124 ms 的倍数（速度 2 档一格补间 240 ms，实际花 372 ms）。
 *
 *   原版没有这种间隔：棋盘由 20 ms 的多媒体定时器驱动、按速度档分频成 tick（`tick.ts`），
 *   电脑那条「买股 → 卖股 → 特別融資/公佈欄 → 用卡|用道具 → 掷骰」的决策链是**同一个函数
 *   一口气跑完的**（`fcn_00418c55`，@source VA 0x00418dc6 起），不跨 tick。
 *
 * ⇒ 与真人的机械步骤同一条规则（`humanDelay`）：至少一个 tick、走子则等那段补间播完；
 *   `aiNext` 只是本引擎把那条决策链拆成的内部簿记，**不占时间**；
 *   等演出的重排按一个渲染周期（20 ms）看。
 */
function aiDelay(): number {
  if (aiRepoll) {
    aiRepoll = false;
    return RENDER_MS;
  }
  if (aiLastAction === 'aiNext') return 0;
  return paceDelay();
}

// ============================================================
//  渲染循环
// ============================================================

/**
 * 舞台 —— 一块 640×480 的离屏画布，所有画面都先画在它上面。
 *
 * ★ 这是「复刻原版画面」的做法：原版就是 640×480 的定屏，各区块位置
 *   是固定像素。先画满一张 640×480，再**整数倍**放大贴到窗口中央，
 *   画面比例、取景、像素锐度就全对了。
 */
const stage = document.createElement('canvas');
stage.width = SCREEN_W;
stage.height = SCREEN_H;
const stageCtx = (() => {
  const c = stage.getContext('2d');
  if (c === null) throw new Error('无法取得舞台绘图上下文');
  return c;
})();

/** 棋盘的离屏画布 —— 439×440，正是原版棋盘区的大小 */
const boardCanvas = document.createElement('canvas');
boardCanvas.width = LAYOUT.board.w;
boardCanvas.height = LAYOUT.board.h;
const boardCtx = (() => {
  const c = boardCanvas.getContext('2d');
  if (c === null) throw new Error('无法取得棋盘绘图上下文');
  return c;
})();

/** 側欄的离屏画布 —— 200×480 */
const hudCanvasOff = document.createElement('canvas');
hudCanvasOff.width = LAYOUT.panel.w;
hudCanvasOff.height = SCREEN_H;
const hudOffCtx = (() => {
  const c = hudCanvasOff.getContext('2d');
  if (c === null) throw new Error('无法取得側欄绘图上下文');
  return c;
})();

/** 当前屏幕 */
type Screen =
  | 'title' | 'setup' | 'options' | 'saveload' | 'lobby' | 'aiSettings' | 'intro' | 'assets'
  | 'inventory' | 'stock' | 'game';
let screen: Screen = 'title';

/**
 * 個人資產表屏（T-022）当前看的是哪个视图（0 資產總表 / 1 地產清單 / 2 股票清單）。
 * @source 原版 `[0x4753fc]`，由窗口过程的状态机置（VA 0x42420b `[0x48c284]−2`）。
 */
let assetView = 0;
/**
 * 本屏显示的是**哪个玩家**。
 * @source 原版 `[0x48c27c]` —— 开屏时取当前玩家（VA 0x423d6c），点顶栏页签可换（VA 0x424042）。
 */
let assetWho = 0;
/**
 * 本屏的**按下态 + 当前选择** —— 原版只在 `WM_LBUTTONDOWN` 那一下画高亮、
 * `WM_LBUTTONUP` 才动作（VA 0x424163 钮 / 0x423dd1 EXIT），抬手 0x202 走
 * `[0x48c284]` 的跳表。★ 抬手时**不再看光标位置** —— 原版就认按下那一刻记下的状态。
 *
 * `kind` / `pageStart` 是视图 1 的「列哪一类」「从第几条开始」，
 * 对应原版的 `[0x475400]` / `[0x475404]`。
 */
let sheetUi: SheetUi = { btn: null, exit: false, kind: 0, pageStart: 0, arrow: null };

/** 换视图/换玩家/换种类都会把分页归零（原版 `fcn_004225a3(kind, 0)`）*/
function resetSheetPage(): void {
  sheetUi = { ...sheetUi, pageStart: 0 };
}

/**
 * 视图 1 翻页 —— 上箭头/上一页传 −1、下箭头/下一页传 +1。
 *
 * @source VA 0x422613（下一页）：`if ([0x475404] + 0xb > 总数) 什么都不做；
 *   否则 [0x475404] += 0xa`；VA 0x422630（上一页）：`if ([0x475404] == 0)
 *   什么都不做；否则 -= 0xa`。**每页 10 行**，页起点按 10 走。
 */
function pageEstateList(dir: number): void {
  const total = assetRows(state, topo, assetWho, sheetUi.kind).length;
  const next = estatePageAfter(total, sheetUi.pageStart, dir);
  if (next === sheetUi.pageStart) return;
  sheetUi = { ...sheetUi, pageStart: next };
  requestRender();
}

function openAssets(): void {
  if (screen === 'game') {
    assetView = 0;
    assetWho = state.currentPlayer;
    sheetUi = { btn: null, exit: false, kind: 0, pageStart: 0, arrow: null };
    screen = 'assets';
    requestRender();
  }
}

function closeAssets(): void {
  if (screen !== 'assets') return;
  screen = 'game';
  requestRender();
}

/**
 * 道具欄浮窗（T-024）当前选中的道具号（原版 `[0x48c560]` 存的是**道具号 + 1**，
 * 0 = 没选）。★ 原版**按下就记状态**、**抬手才动作**（VA 0x445c8f / 0x445d84）。
 */
let invPicked: number | null = null;
/** 开着的是哪一栏：道具（工具列 #8）还是卡片（#9）@source VA 0x447d97 / 0x441baa */
let invKind: 'tools' | 'cards' = 'tools';

// ── 目标拾取模式（T-026）──
// ★ 它是**盖在棋盘上**的一个模式，不是另一屏：原版只是把窗口过程交给模态
//   消息循环，棋盘照画（VA 0x445e4d）。所以这里是 `screen === 'game' && pick !== null`。
/** 当前这一次拾取；`null` = 没在拾取 */
let pick: PickSession | null = null;
/** 光标底下是第几个候选 */
let pickHover: number | null = null;

/** 拾取时的自定义指针缓存（用原版指针图集生成 CSS cursor）*/
const pickCursorCss = new Map<number, string | null>();

/**
 * 把原版的指针图（`Data.mkf` 资源 0）变成 CSS cursor。
 *
 * ★ 原版选目标的反馈**就是换指针**（`fcn_004021f8`，VA 0x4465ba / 0x4465f4），
 *   棋盘上不画任何东西 —— 所以这里也不在棋盘上画标记。
 * 返回 `null` 说明图还没解码好；到货后 `spriteArrived` 会让下一帧重来。
 */
function pickCursorSprite(shape: number, hotX: number, hotY: number): string | null {
  const hit = pickCursorCss.get(shape);
  if (hit !== undefined) return hit;
  const s = spriteNow(CURSOR_ARCHIVE, CURSOR_RESOURCE, shape, true);
  if (s === null) return null; // 还没解码：**别缓存**，下一帧再问
  const c = document.createElement('canvas');
  c.width = s.width;
  c.height = s.height;
  c.getContext('2d')?.drawImage(s.bitmap, 0, 0);
  const css = `url(${c.toDataURL()}) ${hotX} ${hotY}, auto`;
  pickCursorCss.set(shape, css);
  return css;
}

/** 按当前拾取状态换指针 */
function refreshPickCursor(): void {
  if (pick === null) {
    canvas.style.cursor = '';
    return;
  }
  // ★ 贴边时**指针就是那支箭头**，优先于「悬停在候选上」那支
  //   @source `loc_0044609b`：贴边分支里 `[0x48c564] != 0` 会让悬停判定直接返回
  //   ⇒ 优先级 箭头 > 道具/卡片自己的指针 > 红叉。
  if (pickEdge !== PICK_EDGE.none) {
    const arrow = PICK_EDGE_ARROW.get(pickEdge) ?? PICK_CURSOR_INVALID.image;
    const cssArrow = pickCursorSprite(arrow, 1, 0);
    canvas.style.cursor = cssArrow ?? '';
    return;
  }
  const shape = pickCursorFor(pick, pickHover !== null);
  const css = pickCursorSprite(shape.image, shape.hotX, shape.hotY);
  // 图还没到 → 先别把系统指针藏掉，否则会出现「没有指针」
  canvas.style.cursor = css ?? '';
}

/**
 * ★ 贴边推镜头的状态（Q-PICK-1）—— 纯表现，不进 `GameState`。
 *
 * @source `rich4_ui_use_tool.asm` 的 `_rich4_select_instance_callback`：
 *   贴边时 `[0x48c568]` 记方向、`[0x48c56c]` 记步长（8 起、每次 +4、上限 68）、
 *   `[0x48c570]/[0x48c574]` 是**像素**级的镜头中心；`SetTimer(…, 0x32, 0)`
 *   每 50 ms 推一次。离开边缘时 `KillTimer` + 步长复位 8。
 *   贴边期间指针换成八方向箭头（图 34/40/38/36），且**跳过悬停判定**
 *   （`[0x48c564] != 0` → 直接返回）—— 即「箭头 > 道具指针 > 红叉」。
 */
let pickEdge: PickEdge = PICK_EDGE.none;
let pickEdgeStep = PICK_SCROLL_STEP_MIN;
let pickEdgeTimer: number | null = null;

/** 停掉贴边推镜头（离开边缘 / 结束拾取 / 关屏）*/
function stopPickEdgeScroll(): void {
  if (pickEdgeTimer !== null) {
    window.clearInterval(pickEdgeTimer);
    pickEdgeTimer = null;
  }
  // @source `loc_0044609b` 的「否则」那一支：`[0x48c56c] = 8`
  pickEdgeStep = PICK_SCROLL_STEP_MIN;
  if (pickEdge !== PICK_EDGE.none) {
    pickEdge = PICK_EDGE.none;
    refreshPickCursor();
  }
}

/**
 * 贴边推镜头的一拍 @source `loc_00445f88`（`0x113` 定时器分支）：
 * 用**本次**的步长按方向表推镜头中心、clamp 到 [220, 2084]，然后步长 +4。
 */
function tickPickEdgeScroll(): void {
  if (pick === null || pickEdge === PICK_EDGE.none) {
    stopPickEdgeScroll();
    return;
  }
  const step = pickEdgeStep;
  pickEdgeStep = pickScrollNextStep(step);
  const next = pickScrollCamera(cameraCenter(camera), pickEdge, camera.view, step);
  const cur = cameraCenter(camera);
  if (next.x === cur.x && next.y === cur.y) return;
  camera = pixelCamera(next.x, next.y, camera.view);
  // 跟着镜头走的那几样要让它们重算（与拖动/传送同一条路）
  followPlayer = false;
  requestRender();
}

/** 结束拾取（`cancel` = 用户放弃）*/
function endPick(): void {
  if (pick === null) return;
  stopPickEdgeScroll();
  pick = null;
  pickHover = null;
  canvas.style.cursor = '';
  requestRender();
}

function openInventory(kind: 'tools' | 'cards'): void {
  if (screen !== 'game') return;
  invPicked = null;
  invKind = kind;
  screen = 'inventory';
  requestRender();
}

function closeInventory(): void {
  if (screen !== 'inventory') return;
  invPicked = null;
  screen = 'game';
  requestRender();
}

// ── 卡片商店／道具商店（百貨公司，P2-8 / U-2）──────────────────
//
// ★ 这一屏**不是**另一张 `Screen`，而是「待决交互是这个」时棋盘区的替代画面 ——
//   原版就是模态开一个窗口，进来时棋盘已经不在画了。
//
// 原版把这些全放在一串全局里，这里照抄成一份：
// | 本模块 | 原版 | 干什么 |
// |---|---|---|
// | `page` | `[0x48c310]` | 0 卡片店 / 1 道具店 |
// | `shown` | `[0x48c349 + 页]` | 本次进店这一页开过场没有 |
// | `slide` | `[0x48c333] / [0x48c337] / [0x48c33b] / [0x48c33f]` | 货架栏与格子的滑入 |
// | `pressed` | `[0x48c347]` | 正按住的钮（抬手才动作）|
// | `bubble` | `[0x4762c4]` | 老板娘那句话 + 到点自收 |
// | `blink` | `[0x48c32f] / [0x48c314]` | 老板娘脸上那两个小动作 |
// | `shelf` / `bought` | `[0x48c31c]` / `[0x48c2f8]` | 货架快照 + 已经买掉的行 |

interface ShopUi {
  page: ShopPage;
  shown: [boolean, boolean];
  slide: ShopSlide;
  /** 上一次推滑入的时刻（原版那 100ms 一帧的节拍）*/
  slideAt: number;
  pressed: 'switch' | 'exit' | null;
  bubble: { text: string; until: number } | null;
  /**
   * 已经按了 EXIT、正等着道别那句话说完再关门。
   * @source `loc_0042e686`：抬手先出气泡、把 `[0x48c318]` 置 4，
   *   气泡到期（状态 2→3）之后才 `Post_0402_Message` 关窗。
   */
  closing: boolean;
  /**
   * 正被按住的**自己那一格** —— 卖成交后画成「凹进去」，抬手复原。
   * @source `loc_0042e0e4` 调 `fcn_00451b9e`（压入），抬手 `loc_0042e7ec` 调
   *   `fcn_00451d4e`（复原）并重贴一次格子底图。
   */
  pressedCell: number | null;
  /** 开店那一刻的货架 —— 买过的行**不从这份快照里去掉** */
  shelf: { cards: readonly ShopShelfRow[]; tools: readonly ShopShelfRow[] };
  /** 已经买掉的行下标（原版是把那两个货架数组的对应字节清 0）*/
  bought: { cards: Set<number>; tools: Set<number> };
  blink: ShopBlink;
}

let shopUi: ShopUi | null = null;

/**
 * 光标底下的監獄／醫院槽位 —— 原版 `[0x48c4c4]`，不在那一屏时为 null。
 *
 * ★ 它只记录**光标位置**；真正按的是抬手时的坐标（`loc_0043cfdb` 现算）。
 */
let bailHot: number | null = null;

/** 当前这一屏的占用表（監獄 / 醫院各一张，见 `rules/visit.ts`）*/
function bailOccupancy(): readonly number[] {
  const pending = state.pending;
  if (pending === null || pending.kind !== 'bail') return [];
  return pending.place === 'prison' ? state.prisonOccupancy : state.hospitalOccupancy;
}

/**
 * 每个**有人**的槽位画谁。
 *
 * @source `loc_0043d8f2`：`slot < 4` 取 `player[slot].character`；
 *   4..7 是四个惡人，图号由槽位本身决定（`0xd + slot` / `0x16 + slot`），
 *   没有 character 可言 —— 这里给 0，取图时用不到。
 */
function bailViews(): BailSlotView[] {
  const out: BailSlotView[] = [];
  const occ = bailOccupancy();
  const pending = state.pending;
  const named = new Map<number, string>();
  if (pending !== null && pending.kind === 'bail') {
    for (const c of pending.candidates) named.set(c.slot, c.name);
  }
  for (let slot = 0; slot < occ.length; slot++) {
    if ((occ[slot] ?? 0) === 0) continue;
    const p = state.players[slot];
    out.push({
      slot,
      character: p?.character ?? 0,
      // 名字由 core 给（`bailCandidates` 已经按玩家/犯人分好了）；取不到就兜底
      name: named.get(slot) ?? (p === undefined ? `犯人${slot}` : ''),
    });
  }
  return out;
}

/** 監獄／醫院那一屏 —— 与商店一样是**整屏**，画它的时候棋盘不画 */
function drawBailStage(): void {
  const pending = state.pending;
  if (pending === null || pending.kind !== 'bail') return;
  const me = state.players[state.currentPlayer];
  if (me === undefined) return;
  stageCtx.fillStyle = '#000';
  stageCtx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  drawBailScreen(stageCtx, pending.place, bailViews(), me.points, bailHot, spriteNow);
}

/** 原版面板上的两句提示都是 2 秒（`fcn_0044ee18` 的 0x7d0）*/
function shopSay(ui: ShopUi, text: string, now: number): void {
  ui.bubble = { text, until: now + SHOP_BUBBLE_MS };
}

/**
 * 换页：只在本次进店**这一页第一次**看时才播开场 —— 判据就是原版那两个标志
 * `[0x48c349]` / `[0x48c34a]`（`shown[页]`），分支落在 `shopEntryOf`（纯函数、带单测）。
 */
function shopGotoPage(ui: ShopUi, page: ShopPage, now: number): void {
  ui.page = page;
  ui.pressed = null;
  const entry = shopEntryOf(page, !ui.shown[page]);
  if (entry.entry !== null) {
    ui.shown[page] = true;
    shopSay(ui, entry.entry, now);
  } else {
    // 标志 != 0：直接到位（原版这时只 `PostMessage(0x40e)` 画點數，不弹气泡）
    ui.bubble = null;
  }
  ui.slide = entry.slide;
  ui.blink = blinkStart();
}

/** 开店 / 换玩家换局时把界面状态按当前 `pending` 重铺 */
function syncShopUi(): void {
  const pending = state.pending;
  if (pending === null || pending.kind !== 'shop') {
    shopUi = null;
    return;
  }
  // ★ 只在**第一次**看见这个商店时建快照：那之后的 `pending.cards/tools` 会因为
  //   买到手而变短，而原版货架上的字是烤进图里的，不会消失。
  if (shopUi === null) {
    const ui: ShopUi = {
      page: SHOP_PAGE.cards,
      // ★ `shown[页]` = 原版那两个字节 `[0x48c349]` / `[0x48c34a]`
      //   （= 「这一页的开场已经播过」），而它们在 `loc_0042d423`（`0x401` 铺场）
      //   里是这么初始化的：
      //   ```asm
      //   0042d423  mov al, byte [0x497159]   ; ★ RICH4.CFG+1 = 「動畫過程」
      //   0042d427  xor al, 1
      //   0042d429  mov byte [0x48c349], al   ; 页 0（卡片）
      //   0042d42c  mov byte [0x48c34a], al   ; 页 1（道具）
      //   ```
      //   ⇒ **设定关掉时两个标志一开始就是 1**：进店直接摆到位、不播滑入、
      //   也不弹那句开场白（`0x405` 那一拍走 `loc_0042d5ba` → `PostMessage(0x40e)`，
      //   而 `0x40e` 的处理器 `loc_0042d499` 只是画**點數**那一块）。
      //   先前这里写死 `[false, false]` —— 设定关掉也照样播开场（已订正，见 Q-ANIM-1）。
      shown: [!options.animation, !options.animation],
      slide: slideStart(),
      slideAt: 0,
      pressed: null,
      bubble: null,
      closing: false,
      pressedCell: null,
      shelf: {
        cards: shopRows(SHOP_PAGE.cards, pending),
        tools: shopRows(SHOP_PAGE.tools, pending),
      },
      bought: { cards: new Set<number>(), tools: new Set<number>() },
      blink: blinkStart(),
    };
    shopUi = ui;
    // ★ 進商店的配乐 @source `shop.asm:2196` `push 6 / call fcn_004549cf`
    //   ⇒ id 6 → `MIDI07.MID` → 磁盘名 `midi07.mid`（见 `SCREEN_BGM.shop`）
    void playTrackFile('midi07.mid');
    shopGotoPage(ui, SHOP_PAGE.cards, performance.now());
  }
}

/** 这一下点在了哪儿 */
type ShopHit =
  | { at: 'switch' }
  | { at: 'exit' }
  | { at: 'cell'; slot: number }
  | { at: 'shelf'; row: number }
  | null;

/**
 * 判定顺序**照抄原版** `loc_0042de4c` 那四段 `cmp`：
 * 切页钮 → EXIT → 自己的格子 → 货架。
 *
 * ★ 顺序颠倒会点错东西：切页钮的框（542..627）与 EXIT 的框（556..636）在 x 上重叠，
 *   而且两页的货架 x 范围也几乎一样。
 */
function hitShop(x: number, y: number): ShopHit {
  const ui = shopUi;
  if (ui === null) return null;
  if (hitShopSwitch(x, y)) return { at: 'switch' };
  if (hitShopExit(x, y)) return { at: 'exit' };
  const slot = hitShopCell(x, y);
  if (slot !== null) return { at: 'cell', slot };
  const row = hitShopShelf(ui.page, x, y);
  if (row !== null) return { at: 'shelf', row };
  return null;
}

/** 这一页「自己有什么」—— 卡片按手牌槽、道具按紧排表（与 T-024 同一套）*/
function shopCells(page: ShopPage): ReturnType<typeof cardEntries> {
  return page === SHOP_PAGE.cards
    ? cardEntries(state, state.currentPlayer)
    : toolEntries(state, state.currentPlayer);
}

/**
 * 卖一件（按下即卖，原版在 `WM_LBUTTONDOWN` 里直接调 `fcn_0042d145` / `fcn_0042d1b2`）。
 *
 * @source `loc_0042e148` 卡片、`loc_0042e39c` 道具 —— 都是**点一下卖一件**，不弹确认。
 * @returns 真的卖掉了才返回 true（空槽／没这东西时原版**不会**做那个按压效果）
 */
function shopSell(page: ShopPage, slot: number): boolean {
  const item = cellItemAt(page, shopCells(page), slot);
  if (item === null) return false;
  sound.play('Effect.mkf', SOUND_IDS.TITLE_CLICK);
  dispatch(
    page === SHOP_PAGE.cards
      ? { type: 'shop', op: 'sellCard', id: item.id }
      : { type: 'shop', op: 'sellTool', id: item.id, count: 1 },
  );
  return true;
}

/**
 * 买一行（按下即买）。
 *
 * @source `loc_0042e1eb`（卡片）/ `loc_0042e466`（道具）—— 两道闸的**顺序**不能反：
 *   先看 `點數` 够不够（不够就弹「點數不足」），再看装不装得下（满了弹「欄已滿」）。
 *   两道闸都只是弹个气泡，**屏幕不关**。
 */
function shopBuy(page: ShopPage, row: number, now: number): void {
  const ui = shopUi;
  if (ui === null || state.pending?.kind !== 'shop') return;
  const rows = page === SHOP_PAGE.cards ? ui.shelf.cards : ui.shelf.tools;
  const sold = page === SHOP_PAGE.cards ? ui.bought.cards : ui.bought.tools;
  const item = rows[row];
  const me = state.players[state.currentPlayer];
  if (item === undefined || sold.has(row) || me === undefined) return;

  if (me.points < item.price) {
    shopSay(ui, shopMessage(page, 'notEnough'), now);
    requestRender();
    return;
  }
  // ★ 卡片看手牌满没满、道具看这一件是不是已经有 9 个 @source `loc_0042e1eb` / `loc_0042e466`
  const full =
    page === SHOP_PAGE.cards
      ? me.cards.length >= MAX_HAND_CARDS
      : toolCount(state.tools, state.currentPlayer, item.id) >= MAX_TOOL_COUNT;
  if (full) {
    shopSay(ui, shopMessage(page, 'full'), now);
    requestRender();
    return;
  }

  sold.add(row);
  sound.play('Effect.mkf', SOUND_IDS.TITLE_CLICK);
  dispatch(
    page === SHOP_PAGE.cards
      ? { type: 'shop', op: 'buyCard', id: item.id }
      : { type: 'shop', op: 'buyTool', id: item.id },
  );
}

/**
 * 抬手：把选中的道具用出去。
 *
 * @source VA 0x447f4b —— `_rich4_ui_use_tool_entry` 拿到返回值后直接
 *   `call tool_functions[道具号]`。**弹窗自己只负责「选」**。
 *
 * ⚠️ 需要目标/数字的那几件（路障/地雷/定時炸彈/飛彈/機器工人/傳送機/工程車/
 *   核子飛彈）要先选目标，那一步是 **T-026**。
 * ★ 遙控骰子（8）不吃棋盘目标 —— 它开的是自己的**六颗骰面盘**（Q-PICK-2），
 *   参数表里本来就没有它，所以单列一支。
 */
function applyInventoryPick(): void {
  const id = invPicked;
  const kind = invKind;
  closeInventory();
  if (id === null) return;
  if (kind === 'cards') {
    applyCardPick(id);
    return;
  }
  if (toolIsDirect(id)) {
    dispatch({ type: 'useTool', toolId: id });
    return;
  }
  // ★ 遙控骰子（8）：原版真人那一支直接开点数盘（**VA 0x004470f8** 起），不进拾取模式
  if (id === REMOTE_DICE_TOOL) {
    openDicePick();
    return;
  }
  // 需要目标的那几件：进拾取模式（T-026）。参数表见 `picking.ts` 的 TOOL_SELECT_PARAM。
  const param = TOOL_SELECT_PARAM.get(id);
  if (param === undefined) {
    log(`「${TOOLS[id - 1]?.name ?? `道具${id}`}」的目标选择原版走的是另一套（还没接）`);
    return;
  }
  startToolPick(id, param);
}

/**
 * 开遙控骰子的点数盘（道具 8）—— Q-PICK-2。
 *
 * @source `rich4_tool_yaokongtouzi.asm` **VA 0x004470f8** 起：真人那一支读
 *   `Panel.mkf` **#72**、把盘子贴在 (92,300)，然后 `Wait_0402_Message(fcn_00446774)`
 *   —— 模态盖在棋盘上。选中的骰面（1..6）写进 `[0x475dd8]`，掷骰时当**总步数**用。
 */
function openDicePick(): void {
  dicePick = { hover: null };
  requestRender();
}

/** 点了一颗骰面：发 `useTool{8, value}` + 当场这一掷（`rollDice`）并收盘；`0` = 什么都不做 */
function dicePickChoose(face: number): void {
  const acts = remoteDiceActions(face);
  if (acts === null) return;
  // @source `loc_00446a39` 的 `play_sound_effect(0x482322)` —— 音效 1
  sound.play('Effect.mkf', DICE_SOUND_PICK);
  dicePick = null;
  // ★ 原版道具函数自己把这一回合推起来（VA 0x00447260 `call fcn_0040dd1f`，见
  //   `dice-choose.ts` 的 `remoteDiceActions`），所以这里紧跟一条 `rollDice`，
  //   玩家不用再按「前進」。点数已定 ⇒ 这一掷不播预动作/滚骰（见 `forcedRollSkipFx`）。
  if (state.phase === 'awaitingRoll') forcedRollSkipFx = true;
  for (const act of acts) dispatch(act);
  requestRender();
}

/** 取消点数盘（右键）：原版 `loc_00446a66` 的 `Post_0402_Message(0)` —— 道具不消耗 */
function cancelDicePick(): void {
  // @source `loc_00446a68` 的 `play_sound_effect(0x482332)` —— 音效 4
  sound.play('Effect.mkf', DICE_SOUND_CANCEL);
  dicePick = null;
  requestRender();
}

/**
 * 卡片欄选了一张卡之后。
 *
 * @source `_rich4_ui_use_card_entry` VA 0x441c22 起：弹窗拿到卡号后
 *   `sprintf("使用%s", 卡名)` → 报台词 → `call card_functions[卡号]`；
 *   **返回 0（没用成）就播失败音并重新弹一次卡片欄**（`jmp loc_00441c22`）。
 *
 * 这里照同一条路走：先用 core 预演「这张牌现在出不出得了」——
 *   - 出得了且**不需要目标** → 直接发 `useCard{target: none}`；
 *   - 需要目标 → 进 T-026 拾取模式（选择参数取自卡片表）；
 *   - 出不了（被动卡、或时机不对）→ 播失败音（音效 4）并**把弹窗再开回来**。
 *
 * ★ 原版**不灰显**被动卡（`fcn_00441b0a` 只画卡名，一个颜色一张字体），
 *   所以这里也不灰显 —— 上一轮卡里写的「被动卡灰显不可点」是自己想的。
 */
function applyCardPick(cardId: number): void {
  log(`使用${CARD_IMPLS[cardId - 1]?.name ?? `卡${cardId}`}`);
  const route = routeCardPick(state, topo, cardId);
  if (route.kind === 'use') {
    dispatch({ type: 'useCard', cardId, target: { kind: 'none' } });
    return;
  }
  if (route.kind === 'pick') {
    startCardPick(cardId, route.cls, route.param);
    return;
  }
  // ★ Q-PICK-2：紅卡/黑卡借股市屏选股（原版 `_rich4_ui_stock_entry` 参数 1/2）
  if (route.kind === 'stockPick') {
    openStockPick(cardId, route.mode);
    return;
  }
  // ★ Q-PICK-2：請神符**没有选择 UI** —— 原版 `0x444d1a` 自动请最近的那尊；
  //   一个都请不到时返回 0（卡不消耗）→ 走下面「用不成」那条路。
  if (route.kind === 'objectAuto') {
    const handle = nearestSummonableObject(state, topo);
    const act = summonCardAction(handle);
    if (act === null) {
      sound.play('Effect.mkf', SOUND_CARD_FAILED);
      openInventory('cards');
      return;
    }
    dispatch(act);
    return;
  }
  // ★ 改建卡站在**等级 ≥ 1 的設施**上：原版是卡片函数自己开「請選擇設施類別」窗
  //   （VA 0x004431c8 `push 1 / call 0x440aac`），选完把种类写进設施记录；
  //   右键取消返回 **−1** → 卡片函数返回 0 → 这张卡**不消耗**
  //   （VA 0x004431d7 / `loc_004412de`），并照原版那条循环播失败音、把卡片欄开回来。
  if (route.kind === 'facilityPick') {
    openFacilityPicker((type) => {
      if (type === null) {
        sound.play('Effect.mkf', SOUND_CARD_FAILED);
        openInventory('cards');
        return;
      }
      dispatch({ type: 'useCard', cardId, target: { kind: 'none', facilityType: type } });
    });
    return;
  }
  // 用不成：失败音 + 把弹窗开回来（原版的循环）
  sound.play('Effect.mkf', SOUND_CARD_FAILED);
  if (route.needsOwnList) log('（这张卡要选目标 —— 那类选择界面还没做）');
  else openInventory('cards');
}

/**
 * 「这张牌没用成」的音效 —— 音效 **3**
 * @source `_rich4_ui_use_card_entry` VA 0x441cd2 的 `play_sound_effect(0x48233a)`；
 *   音效号表在 `0x48231a`、**8 字节一项**（`play_sound_effect` 取 `[ptr]`，
 *   @source VA 0x004542d8），故 `[0x48233a] = 3`。
 *   ⚠️ 先前这里写 4 并把「4」归给 `0x48233a` —— 4 是 **`0x482332`**（取消）的值。
 */
const SOUND_CARD_FAILED = 3;

/**
 * 「取消」音效 —— 音效 **4** @source `0x482332`（选股模式右键 `loc_0042b25a`、
 *   选目标回调右键 `0x4466b8` 都播它）。
 */
const STOCK_PICK_CANCEL_SOUND = 4;

/**
 * 「选中了一个目标」的音效 —— 音效 **2**
 * @source `_rich4_select_instance_callback` VA 0x44666a 的
 *   `play_sound_effect(0x48232a)`；`[0x48232a] = 2`。
 */
const SOUND_TARGET_PICKED = 2;

/** 进「选目标」的拾取模式（卡片那一类）*/
function startCardPick(cardId: number, cls: TargetClass, param: number): void {
  // ★ 进拾取前先把上一轮的贴边推镜头收掉（`[0x48c56c]` 复位 8）
  stopPickEdgeScroll();
  pick = startPick(state, topo, { kind: 'card', cardId }, cls, param);
  pickHover = null;
  if (pick.candidates.length === 0) {
    log(`「使用${CARD_IMPLS[cardId - 1]?.name ?? ''}」现在没有能选的目标`);
  }
  refreshPickCursor();
  requestRender();
}

/** 进「选一格」的拾取模式（道具那一类目标都是格子）*/
function startToolPick(toolId: number, param: number): void {
  stopPickEdgeScroll();
  pick = startPick(state, topo, { kind: 'tool', toolId }, 'none', param);
  pickHover = null;
  if (pick.candidates.length === 0) {
    log(`「${TOOLS[toolId - 1]?.name ?? `道具${toolId}`}」现在没有能放的地方`);
  }
  refreshPickCursor();
  requestRender();
}

/**
 * 開局跳伞过场（T-048）：起点时刻与「用户跳过」标志。
 * ★ 纯表现 —— 不派 action，结束只把 screen 放回 game（C-DET-4）。
 */
let introStartedAt = 0;
let introSkipped = false;
/**
 * 过场那一下音效放过了没有（`Effect.mkf` #25，原版只放一次）。
 * ★ 由这里持有而不是让 `intro.ts` 自己记 —— 那个模块是纯绘制，
 *   不许有跨帧状态（C-DET-4）。
 */
let introSoundPlayed = false;

/** 过场结束 → 进棋盘 */
function endIntro(): void {
  if (screen !== 'intro') return;
  screen = 'game';
  requestRender();
  // ★★ **必须补这一拍**（2026-09-16 修「进游戏后 GO 鈕点不动」）：
  //   `startGame()` 起的那两个回合驱动都带 `if (screen !== 'game') return`
  //   （`scheduleAi` / `scheduleHumanTurn`），而开局那一刻 `screen` 还是 `'intro'`，
  //   于是它们当场返回 —— 过场放完若不再叫一次，真人回合就永远停在
  //   `phase === 'turnStart'`：`awaitingHumanRoll()` 恒为假 ⇒
  //   **GO 鈕点不动、骰子也掷不出去**。单测验的是 reduce，看不见驱动这一层，
  //   只有真进一局才会暴露。
  scheduleAi();
  scheduleHumanTurn();
}

/** 託管AI 屏的编辑草稿（原版也是先编一份暂存表、按確定才拷回）——不在这一屏时为 null */
let aiDraft: AiSettingRow[] | null = null;
let aiHot: AiSettingsHit | null = null;
let aiReturn: Screen = 'game';

/** 联机大厅的房间快照（服务器给的；本机不改它）——不在大厅时为 null */
let lobbyRoom: RoomInfo | null = null;
let lobbyHot: LobbyHit | null = null;

/** 断开当前联机连接（「離開」用）；单机时为 null */
let netClose: (() => void) | null = null;

/**
 * 进大厅：只要房间还没开局就停在这一屏。
 *
 * 已经在游戏里（重连时 `start` 会再来一次）就不退回去——那会把正在下的
 * 一局推回大厅。
 */
function enterLobby(info: RoomInfo): void {
  lobbyRoom = info;
  if (info.started || screen === 'game') return;
  if (screen !== 'lobby') {
    screen = 'lobby';
    lobbyHot = null;
  }
  requestRender();
}

/**
 * 回／進**標題畫面** —— 顺手点标题那一首。
 *
 * @source `ui_main.asm:187`（函数 `fcn_004026e2`）：`fcn_00402460(0)` 画标题 →
 *   `fcn_00454acb()`（**先停**当前曲）→ `rich4_ui_options_entry(0)` →
 *   `fcn_004549cf(0)`（★ id 0 ⇒ 文件名表 `0x47e793` 第 0 项 ⇒ **`MIDI01.MID`**）。
 *   另一处同实参的调用点在 `ui_main.asm:483`（標題窗口那条消息回调同样形状）。
 * ⇒ 每次**进**標題都从头放 MIDI01（不是「没在放才放」）。
 */
function enterTitleScreen(): void {
  screen = 'title';
  void playTrackFile('midi01.mid');
  requestRender();
}

/** 离开大厅：断开连接、回標題 */
function leaveLobby(): void {
  netClose?.();
  netClose = null;
  net = null;
  lobbyRoom = null;
  lobbyHot = null;
  log('已離開聯機大廳');
  enterTitleScreen();
}
/** 標題畫面上鼠标悬着的按钮 */
let titleHot: number | null = null;

let renderQueued = false;
// ============================================================
//  整屏 UI 的登记表（契约见 ui-screen.ts；表本身在 screens.ts）
// ============================================================

/**
 * 登记的整屏要用的 FLIC／ANM 影片缓存（按 `档案#资源号`）——
 * 与滚骰那张分开，因为这里的键是档案 + 资源号，不只有 Panel。
 * 解出来会自己重画一帧（屏里的 `flic()` 因此不需要缓存 `null`）。
 */
const uiFlics = new Map<string, LoadedFlic | null>();
const uiFlicPending = new Set<string>();

function uiFlicNow(archive: string, resource: number): LoadedFlic | null {
  const key = `${archive}#${resource}`;
  const hit = uiFlics.get(key);
  if (hit !== undefined) return hit;
  const cache = sprites;
  if (cache !== null && !uiFlicPending.has(key)) {
    uiFlicPending.add(key);
    void cache.getFlic(archive as ArchiveName, resource).then((f) => {
      uiFlics.set(key, f);
      uiFlicPending.delete(key);
      requestRender();
    });
  }
  return null;
}

/**
 * 这一帧交给各屏的环境。
 *
 * ⚠️ 每调一次算一次 `performance.now()` —— 屏幕若要「本帧同一个时刻」，
 *   自己取一次 `env.now` 存着用。
 */
function uiEnv(): UiScreenEnv {
  return {
    screen,
    state,
    topo,
    map,
    now: performance.now(),
    stage: stageCtx,
    // ★ 遊戲設定的「動畫過程」（`RICH4.CFG+1` bit0 = `[0x497159]`，`ui-screen.ts`
    //   的 `UiScreenEnv.animation`）。
    //   ⚠️ 2026-09-16 核过 exe：**拍賣屏與旅館/購物中心轉盤不受它管辖**
    //   （`rich4_ui_auction.asm` 只读 `cfg+8`；转盘那两支一处都没读 `[0x497159]`），
    //   真正读它的屏见 `docs/deviations/Q-ANIM-1.md`。当前已接的三处：
    //   小遊戲進場（`minigame-screen.ts`）、銀行招呼（下面 `syncLoanUi`）、
    //   樂透投注开屏（`lottery-screen.ts` 的 `resetUi(now, animate)`）。
    animation: options.animation,
    sprite: spriteNow,
    flic: uiFlicNow,
    dispatch,
    localSeat: net === null ? null : net.seat,
    requestRender,
    log,
    // ★ 音效两条出口：`playEffect(id, loop?)` 与 `stopEffect(id)`。
    //   循环的那一路原版是 `_rich4_play_sound_effect(flags=1, …)`（= `DSBPLAY_LOOPING`），
    //   第一处用途是轉盤的 52 号（0.089 s，不循环就只是一声「嗒」）——
    //   见 `wheel-screen.ts` 与 `audio.ts` 的 `play(archive, resource, loop)`。
    playEffect: (id: number, loop = false) => sound.play('Effect.mkf', id, loop),
    stopEffect: (id: number) => sound.stop('Effect.mkf', id),
    // ★ 按屏取曲（原版 `fcn_004549cf(id)`）：屏只报**磁盘文件名**，
    //   载入/替换由这里统一做（与 `playTrack` 同一条载入路径）。
    music: (file: string) => {
      void playTrackFile(file);
    },
  };
}

/** 此刻接管整屏的那一屏（登记表里 `active()` 为真的第一项）；没有则 null */
function activeUiScreen(): UiScreen | null {
  const env = uiEnv();
  for (const s of SCREENS) {
    if (s.active(env)) return s;
  }
  return null;
}

/**
 * 正在播的**投掷动效** —— 纯表现，不进 `GameState`（C-DET-4）。
 *
 * ★ 原版这一整套在 `use_tool_luzhang/dilei/dingshizhadan`（VA 0x00446b9x 起）
 *   里是**阻塞**的：`place_object` → `animate_object`（物件从角色身上飞到目标格，
 *   每帧 24 ms）→ 收尾停 100 ms → `play_sound_effect(落地音)` → `refresh_screen`。
 *   期间棋盘一次都不重绘，所以那件物件**只以飞行的样子出现**，落地后才在格子上；
 *   这里照同一条规矩：飞行期间 `renderer` 把它从静态绘制槽里藏掉
 *   （见 `RenderInput.objectFlight`），播完才放落地音。
 *
 * 规格与逐条 VA 见 `throw-fx.ts`。
 */
let objectFlight: ObjectFlight | null = null;

/**
 * 正在排队的角色台词（T-052 的屏幕那一半）。
 *
 * ★ 原版 `_rich4_player_say`（VA 0x0044ef41）是**阻塞**的一句一句演
 *   （画字 → 贴表情 → `fcn_004544f6(1000)` 等 1 秒），本引擎不能在 `dispatch`
 *   里阻塞，故改成队列：`playSoundFor` 排入，渲染循环按 `SPEECH_HOLD_MS` 逐段收。
 *   纯表现，不读也不写 `GameState`（C-DET-4）。
 */
const speechQueue = new SpeechQueue();

/** 这一件飞完该放哪个音效号（0 = 不放音） */
let objectFlightSound = 0;

/**
 * 播完一条投掷：放落地音 + 让静态那件露出来。
 *
 * @source 音效在 `animate_object` **返回之后**才响 —— VA 0x00446c58（路障 33）、
 *   0x00446d39（地雷 34）、0x00446e1a（定時炸彈 10）。
 */
function finishObjectFlight(): void {
  if (objectFlight === null) return;
  const id = objectFlightSound;
  objectFlight = null;
  objectFlightSound = 0;
  if (id > 0) sound.play('Effect.mkf', id);
  requestRender();
}

/**
 * 每帧推进投掷动效：没播完就再排一帧，播完就收（放音、复原）。
 *
 * 挂在 `requestRender` 的 rAF 回调里，与走子补间同一个套路 —— 不无条件续帧，
 * 免得变成死循环。
 */
function tickObjectFlight(now: number): void {
  const f = objectFlight;
  if (f === null) return;
  if (flightDone(f, now)) {
    finishObjectFlight();
    return;
  }
  requestRender();
}

/**
 * 一条 `useTool` 恰好**放下**了一件东西 → 起播投掷动效。
 *
 * ★ 判据只认「新落地的那一件」：拿前后两份物件表逐格比 `nodeId`，找出
 *   `before` 里不在这一格、`after` 里在这一格、且种类对得上的那一件。
 *   这样联机（服务器广播回来）与 AI 走同一条路，也不会把先前放的当成这一次的。
 *
 * 起点取**当前玩家所在格**（原版读的是玩家记录里的实时像素坐标
 * `player + 0x8/+0xa`）—— 使用道具时角色就站在那一格上。
 */
function startObjectFlight(
  before: GameState,
  action: { type: 'useTool'; toolId: number; nodeId?: number },
): void {
  const nodeId = action.nodeId ?? 0;
  const objectType = PLACEMENT_TOOLS.get(action.toolId);
  if (objectType === undefined || nodeId <= 0) return;
  const me = state.players[state.currentPlayer];
  const to = map.nodes[nodeId - 1];
  const from = me === undefined ? undefined : map.nodes[me.nodeId - 1];
  if (to === undefined || from === undefined) return;

  // 新落地的那一件（下标）—— 只认「这一格上**新**多出来的那一件」
  let slot = -1;
  for (let i = 0; i < state.objects.length; i++) {
    const after = state.objects[i];
    if (after === undefined || after.type !== objectType) continue;
    if (after.nodeId !== nodeId || after.attached !== 0) continue;
    if (before.objects[i]?.nodeId === nodeId) continue; // 原先就在这一格的，不是这次放的
    slot = i;
    break;
  }
  if (slot < 0) return;

  // ★ 两端点**开播前**换算成屏幕坐标（原版 `fcn_00409a23` 只做这一次，
  //   之后每帧都在屏幕空间累加）；任一端在 29×29 窗口外就不播，直接放音。
  const vp = { w: LAYOUT.board.w, h: LAYOUT.board.h };
  const a = worldToScreen(from.x, from.y, camera, vp);
  const b = worldToScreen(to.x, to.y, camera, vp);
  const id = PLACE_TOOL_SOUND.get(action.toolId) ?? 0;
  const started = beginObjectFlight({
    objectIndex: slot,
    type: objectType,
    facing: objectFacing(to, map.nodes, directionOf),
    from: a,
    to: b,
    settleMs: THROW_SETTLE_MS,
  });
  if (!started) {
    // @source VA 0x0040e6f2：`fcn_00409a23` 换算后两轴都为 0（起点就是落点，
    //   例如把路障放在自己脚下）→ `test edx,edx / jne` + `test ecx,ecx / je`
    //   直接 `loc_0040ea5a` 返回 —— **一帧都不画**，连那 100 ms 也不停，
    //   于是调用方紧接着就放了落地音。
    if (id > 0) sound.play('Effect.mkf', id);
    return;
  }
  objectFlightSound = id;
}

/**
 * 起播一条投掷/飞行 —— 两端点在**开播前**换算成屏幕坐标（原版 `fcn_00409a23`
 * 只做这一次），之后每帧都在屏幕空间线性累加，镜头中途动也不改端点。
 *
 * 返回 `false` = 这一条**一帧都不播**：任一端换算不出屏幕坐标，或两点重合
 * （@source VA 0x0040e6f2 的 `test edx,edx / jne` + `test ecx,ecx / je`）。
 * 那时调用方自己收尾（放置類道具是**接着就放落地音**）。
 */
function beginObjectFlight(args: {
  objectIndex: number;
  type: number;
  facing: number;
  image?: number;
  from: { x: number; y: number } | null;
  to: { x: number; y: number } | null;
  settleMs?: number;
}): boolean {
  const { from, to } = args;
  if (from === null || to === null) return false;
  if (from.x === to.x && from.y === to.y) return false;
  // 上一条还没播完就被顶掉（连着的两次使用）：先把它的音放掉，别吞掉
  if (objectFlight !== null) finishObjectFlight();
  objectFlight = makeObjectFlight({
    objectIndex: args.objectIndex,
    type: args.type,
    facing: args.facing,
    ...(args.image === undefined ? {} : { image: args.image }),
    from,
    to,
    start: performance.now(),
    ...(args.settleMs === undefined ? {} : { settleMs: args.settleMs }),
  });
  objectFlightSound = 0;
  requestRender();
  return true;
}

// ============================================================
//  ★ Q-TOOL-5 ①：卡片 / 請神符 的飞行 —— 另外 23 个 `animate_object` 调用点
// ============================================================

/**
 * 一次 `useCard` **真的生效了** → 该起就起那段「卡片（或神明）从 A 飞到 B」。
 *
 * 规格与 23 个调用点逐条的 VA 见 `throw-fx.ts` 的 `CARD_FLIGHT_SITES`。
 * 三条要点：
 *
 * 1. **飞的是卡片**（22 个点）：原版 `push 0` 当 arg1 ⇒ `animate_object` 走
 *    `handle == 0` 那一支，画 `Data.mkf` **415**（种类 20 那套图，只有 1 张）
 *    的**第 0 帧**；棋盘上没有对应物件可藏（`objectIndex = -1`）。
 * 2. **請神符**（VA 0x00444efa）例外：飞的是**神明自己**那套图，
 *    方向是**从神明所在的格飞向出牌者**（与原版其余各点反向），arg6 = 0；
 *    飞行期间那件神明要从棋盘上藏掉（原版 `mov word [objects_info[i]+2], 0`）。
 * 3. **闸门**：22 个卡片点里 20 个在出牌者 `who_plays == 1`（纯人类）时整段跳过
 *    —— 这是 exe 的实际行为（同一条函数开头那个字段的另一个用法把 1 钉成人类），
 *    照抄。故本动效在**电脑出牌**（或被托管）时才看得见。
 */
function startCardFlight(
  before: GameState,
  action: { type: 'useCard'; cardId: number; target?: CardTarget },
): void {
  const me = before.players[before.currentPlayer];
  if (me === undefined) return;
  const here = map.nodes[me.nodeId - 1];
  if (here === undefined) return;

  const plan: CardFlightPlan | null = cardFlightPlan({
    cardId: action.cardId,
    whoPlays: me.whoPlays,
    target: action.target ?? { kind: 'none' },
    actor: { x: here.x, y: here.y },
    anchor: {
      player: (index) => {
        const p = before.players[index];
        if (p === undefined) return null;
        const n = map.nodes[p.nodeId - 1];
        return n === undefined ? null : { x: n.x, y: n.y };
      },
      land: (entityId) => {
        const l = map.lands.find((x) => x.id === entityId);
        return l === undefined ? null : { x: l.x, y: l.y };
      },
      facility: (facilityId) => {
        const f = map.facilities.find((x) => x.id === facilityId);
        return f === undefined ? null : { x: f.x, y: f.y };
      },
      object: (objectIndex) => {
        // ★ 起点取**飞行前**的记录（`before`）：原版先算终点再把它从图上摘掉
        const o = before.objects[objectIndex - 1];
        if (o === undefined || o.nodeId <= 0) return null;
        const n = map.nodes[o.nodeId - 1];
        if (n === undefined) return null;
        return {
          x: n.x,
          y: n.y,
          type: o.type,
          // 原版读 `objects_info[i] + 1`（place_object 写入的朝向）；本引擎没这个字段，
          // 按同一条规则当场推（与「放地上」那一路共用 `objectFacing`）
          facing: objectFacing(n, map.nodes, directionOf),
        };
      },
    },
  });
  if (plan === null) return;

  const vp = { w: LAYOUT.board.w, h: LAYOUT.board.h };
  const a = worldToScreen(plan.from.x, plan.from.y, camera, vp);
  const b = worldToScreen(plan.to.x, plan.to.y, camera, vp);
  if (plan.sprite.kind === 'card') {
    beginObjectFlight({
      objectIndex: CARD_FLIGHT_NO_OBJECT,
      type: CARD_FLIGHT_TYPE,
      facing: 0,
      image: CARD_FLIGHT_IMAGE,
      from: a,
      to: b,
      settleMs: plan.settleMs,
    });
    return;
  }
  beginObjectFlight({
    objectIndex: plan.sprite.objectIndex - 1,
    type: plan.sprite.type,
    facing: plan.sprite.facing,
    from: a,
    to: b,
    settleMs: plan.settleMs,
  });
  // ★ 卡片飞行**没有**收尾音效：23 个调用点后面都没有 `play_sound_effect`
  //   （`xref 0x4542ce` 在这 23 个点之后一条都没有）—— 与放置類道具不同。
}

// ============================================================
//  機器工人（9）的原地建屋动效 —— Q-TOOL-6
// ============================================================

/**
 * 正在播的**建屋动效** —— 纯表现，不进 `GameState`（C-DET-4）。
 *
 * ★ 原版 `rich4_use_tool_jiqigongren`（VA 0x00447295）的次序是
 *   **先结算、后播片**：`fcn_0040b110` 把等级 +1（0x00447345）→ 播 `Data.mkf`
 *   0x229 的大锤（68 帧 × 57 ms）→ 若刚好盖到 5 级（bit7）再接 0x20b
 *   （66 帧 × 42 ms）→ 最后 `refresh_screen`。规格与逐条 VA 见 `build-fx.ts`。
 */
let buildFx: BuildFx | null = null;

/**
 * 「影片起播那一拍**之前**」的 state 快照（`null` = 现在没有影片在播）——
 * 影片窗口里棋盘按它画，播完才切回 after。见 `deferred-board.ts`。
 *
 * ★ 一份就够：建屋与棋盘影片都由 `startActionFx` 在**同一条 action** 里起，
 *   而影片期间回合驱动被闸住（`holdForActorWalk`），state 不会再变 ——
 *   所以两条影片的快照必然是同一次 `applyAction` 的 `before`。
 */
let deferredBoardBefore: GameState | null = null;

/**
 * 「该播、但影片还没解好」的待播请求（`null` = 没有）——
 * 原版 `read_mkf` 是**同步**的、解完才 `fcn_0045144f`；浏览器里解 68 帧要几百毫秒，
 * 所以先挂在这里，`tickBuildFx` 一看到影片到货就起时间轴（音效也在那时才响）。
 */
let pendingBuildFx: { maxed: boolean; first: BuildClipName } | null = null;

/** 建屋影片缓存（按资源号）—— 440×440 × 68 帧很占显存，播完就 `close()` */
const buildFlics = new Map<number, LoadedFlic | null>();
const buildFlicPending = new Set<number>();

/** 取一段建屋影片（没解过就先挂个异步，本帧返回 null）—— 与 `diceFlicNow` 同一套路 */
function buildFlicNow(clip: BuildClipName): LoadedFlic | null {
  const resource = buildClip(clip).resource;
  const hit = buildFlics.get(resource);
  if (hit !== undefined) return hit;
  const cache = sprites;
  if (cache !== null && !buildFlicPending.has(resource)) {
    buildFlicPending.add(resource);
    void cache.getFlic(BUILD_FX_ARCHIVE, resource).then((f) => {
      buildFlics.set(resource, f);
      buildFlicPending.delete(resource);
      requestRender();
    });
  }
  return null;
}

/** 放掉一段影片的位图（原版是一段一段 `read_mkf` → 播 → `libc_free`，不两段同时占着）*/
function releaseBuildFlic(resource: number): void {
  buildFlics.get(resource)?.close();
  buildFlics.delete(resource);
}

/** 收摊：影片的位图全放掉（一段 440×440 × 60 多帧 ≈ 52 MB，留着太占显存）*/
function releaseBuildFlics(): void {
  for (const f of buildFlics.values()) f?.close();
  buildFlics.clear();
}

/** 一段影片开播时放它那条音效 @source VA 0x00447350 `push 0x5b` / 0x0040b0f4 `push 0x5a` */
function playBuildFxSound(clip: BuildClipName): void {
  const id = buildClip(clip).sound;
  if (id > 0) sound.play('Effect.mkf', id);
}

// ============================================================
//  送進監獄／醫院那一段影片（`confine-fx.ts`）
// ============================================================

/**
 * 正在播的那一段**棋盘影片**（`null` = 没在播）。
 *
 * 这一族演出在原版里共用同一支 `fcn_0045144f`（VA 0x0045144f）——「整幅帧直接贴屏幕、
 * 阻塞播完」—— 目前有三位客人：
 *   - 建屋（機器工人，`build-fx.ts`）—— 它自己那套两段式还在用 `buildFx`，不在此列；
 *   - 送進監獄／醫院（`confine-fx.ts`，@source VA 0x0043ed27 / 0x0043d67b）；
 *   - 神明降臨／發威（`god-fx.ts`，@source `_rich4_attach_god` VA 0x0040ea62 的跳表）。
 * 播放规则统一在 `board-film.ts`，这里只负责「解码 → 起时间轴 → 播完放行回合驱动」。
 */
let boardFilm: BoardFilm | null = null;

/**
 * 「该播、但影片还没解好」的待播请求 —— 原版 `read_mkf` 是同步的，
 * 真解码在后台，解完才起时间轴（音效也在那时才响）。
 */
let pendingBoardFilm: BoardFilmSpec | null = null;

/**
 * 「这一段播完，紧接着播下一段」—— 原版那两次 `fcn_0045144f` 是**串行**的
 * （踩到惡犬那一支：`read_mkf(0x214)` → 播狗咬 → `wreck_vehicle` →
 * `send_to_hospital` → `read_mkf(0x20c)` → 播救护车，VA 0x0041b8cd / 0x0043ed59），
 * 而本引擎一次只解一段、只播一段，于是把第二段挂在这里
 * （@source VA 0x0041b837 那一支，见 `dog-fx.ts` 的文件头）。
 */
let pendingBoardFilmAfter: BoardFilmSpec | null = null;

/** 影片缓存（按「档案:资源号」）—— 440×440 × 几十帧不小，播完就 `close()` */
const boardFilmFlics = new Map<string, LoadedFlic | null>();
const boardFilmPending = new Set<string>();

function boardFilmFlicNow(spec: BoardFilmSpec): LoadedFlic | null {
  const key = `${spec.archive}:${spec.resource}`;
  const hit = boardFilmFlics.get(key);
  if (hit !== undefined) return hit;
  if (sprites !== null && !boardFilmPending.has(key)) {
    boardFilmPending.add(key);
    void sprites.getFlic(spec.archive, spec.resource).then((f) => {
      boardFilmFlics.set(key, f);
      boardFilmPending.delete(key);
      requestRender();
    });
  }
  return null;
}

function releaseBoardFilmFlics(): void {
  for (const f of boardFilmFlics.values()) f?.close();
  boardFilmFlics.clear();
}

/**
 * 起播一段棋盘影片（原版那一下 `fcn_0045144f`）。
 *
 * @param after 这一段播完**紧接着**播的那一段（原版两次 `fcn_0045144f` 是串行的
 *   —— 只有「踩到惡犬」那一支用得上：狗咬 → 救护车，见 `dog-fx.ts` 的文件头）。
 *   不传 = 播完就放行（与先前一样）。
 */
function startBoardFilm(spec: BoardFilmSpec, after?: BoardFilmSpec): void {
  // 上一条还没播完就被顶掉：直接换掉并放掉旧位图（原版是阻塞的，两段不会重叠）
  if (boardFilm !== null) {
    boardFilm = null;
    releaseBoardFilmFlics();
  }
  pendingBoardFilm = spec;
  // ★ 省略 `after` = **保留**已排好的下一段（「踩到惡犬」那一拍：
  //   `startDogFx` 先把 0x20c 排在狗咬后面，`startConfineFx` 随后再进来，
  //   它不带 `after`，不能把那一行覆盖掉）。
  if (after !== undefined) pendingBoardFilmAfter = after;
  boardFilmFlicNow(spec);
  requestRender();
}

/**
 * 这一拍有没有人**刚被送进**医院／监狱 —— 有就起播那一段影片。
 *
 * ★ 只在「動畫過程」开着时播：@source `cmp byte [0x497159], 0 / je 跳过`
 *   （医院 VA 0x0043ed27、监狱 VA 0x0043d67b），与其它屏同一个开关。
 *   判据（占用表 0→1 / 计数变大）见 `confine-fx.ts` 的 `confineFxTrigger`。
 */
function startConfineFx(before: GameState, after: GameState): void {
  if (!options.animation) return;
  const kind = confineFxTrigger(before, after);
  if (kind === null) return;
  // 影片窗口里棋盘按 before 画（见 `deferred-board.ts`）—— 起播前先记下快照
  deferredBoardBefore = before;
  startBoardFilm(confineClip(kind));
}

/**
 * 这一拍有没有神明**刚附身** —— 有就播那一段影片。
 *
 * ★ 同样只在「動畫過程」开着时播（@source 各函数开头那句 `cmp [0x497159], 0`）。
 *   判据与派发表见 `god-fx.ts`（编号 11/13/14 没有影片）。
 */
function startGodFx(before: GameState, after: GameState): void {
  if (!options.animation) return;
  const id = godFxTrigger(before, after);
  if (id === null) return;
  const spec = godFilmSpec(id);
  if (spec !== null) {
    // ★ 影片窗口里棋盘按 before 画：神明还站在地上、主人身上还没有标记
    //   （见 `deferred-board.ts`）。起播前先记下这一拍之前的快照。
    deferredBoardBefore = before;
    startBoardFilm(spec);
  }
}

/**
 * 这一拍是不是「踩到惡犬、徒步被咬」—— 是就播狗咬那一段影片，
 * 并把救护车那一段（`confine-fx.ts` 的 `startConfineFx`）**排队**在它后面。
 *
 * ★ **没有** `options.animation` 闸：医院／入獄／神明那三支的调用点各自写着
 *   `cmp byte [0x497159], 0 / je 跳过`，而惡犬那一支（VA 0x0041b837）从头到尾
 *   **没有这一句** —— 原版不管「動畫過程」开没开都 `read_mkf(0x214)` + 播。
 *   照 exe 走（与 `startAlienNewsFx` 同一条规矩）。
 *
 * ★ 次序：这一支必须在 `startConfineFx` **之前**跑。两次调用都会写
 *   `pendingBoardFilmAfter`（狗咬那一段把它设成救护车、`startConfineFx`
 *   再进来时 `after` 省略 ⇒ 保留原值），于是狗咬播完自动接救护车。
 */
function startDogFx(before: GameState, after: GameState): void {
  const spec = dogBiteFxTrigger(before, after);
  if (spec === null) return;
  // 影片窗口里棋盘按 before 画：狗还在那一格上（`deferred-board.ts`）
  deferredBoardBefore = before;
  startBoardFilm(spec);
  log(`影片：踩到惡犬 ${spec.id}（${spec.frames} 帧 × ${spec.frameMs} ms）`);
}

/**
 * 这一拍是不是剛抽到新聞 4「外星人攻打地球」—— 是就播飛碟那一段影片。
 *
 * ★ **没有** `options.animation` 闸：住院／入獄／神明那三支的调用点各自写着
 *   `cmp byte [0x497159], 0 / je 跳过`，而 `fcn_0044913d` 里**没有这一句**
 *   （VA 0x00449235..0x00449269 一路直下）。原版播它不看「動畫過程」，
 *   本引擎照 exe 走；playtest 报告里的「被直接跳过」正是这一段从来没接。
 *
 * ★ 起播就是同一条 `startBoardFilm` 路：整幅 440×440 贴在屏幕 (0,0x28) =
 *   棋盘左上角，`pendingBoardFilm` 会等这一拍的走子补间播完才起时间轴
 *   （`tickBoardFilm`），播完放行回合驱动 —— 与住院/入獄/神明完全一致。
 */
function startAlienNewsFx(before: GameState, after: GameState): void {
  const spec = alienNewsFxTrigger(before, after);
  if (spec === null) return;
  // 影片窗口里棋盘按 before 画：房子还没被掀掉（`deferred-board.ts`）
  deferredBoardBefore = before;
  startBoardFilm(spec);
  log(`影片：新聞 ${NEWS_ALIEN_ID} 外星人攻打地球`);
}

/**
 * 每帧推进这一段：
 *   ① 影片还在解 → 解完才起时间轴（原版 `read_mkf` 在前、`fcn_0045144f` 在后）；
 *   ② 播完 → 收摊（放掉位图）+ **补一次回合驱动**（这一段是阻塞的，见 `holdForWalk`）。
 *
 * ★★ 起播还要等**这一步的走子补间播完**（试玩3 #1，issue #19）：
 *   原版这一段影片是在走子例程**里面**、棋子已经滑到那一格之后才被调用的
 *   （落点处理 VA 0x0041b440 每走一格跑一次 —— 出处见 `rules/object-landing.ts`
 *   文件头；附身那一支要求剩余步数 `[0x48baf8] == 0`，见同文件的 `@source`）。
 *   而 `startActionFx` 是在补间**起播的同一拍**调用的（真人那条还排在
 *   `tweenStepIfMoved` 之前），不等它就会「人物还没走完，神明附身的影片先盖上去」。
 *
 * ★★ 新聞 4 那一段还要多等一件事（`spec.afterOverlay`）：原版是訊息框先播满
 *   2400 ms（`fcn_0044b6df` 的 `0x0044b862 push 0x960`）、框收掉之后事件函数体
 *   才 `read_mkf(0x213)` + `fcn_0045144f`（VA 0x00449245 / 0x0044925b）。
 *   本引擎的訊息框是**浮窗**（`event-box-screen.ts` 的 `windowed: true`）盖在
 *   (0,0)-(440,480)，正好把 (0,40)-(440,480) 的整块影片遮死 ⇒ 不等它收屏，
 *   飛碟那 4.1 秒就白播了。只对那一支生效（别的影片调用点都在訊息框之外）。
 *
 * 挂在 `requestRender` 的 rAF 回调里，与建屋影片同一个套路。
 */
function tickBoardFilm(now: number): void {
  // ── ⓪ 该接下一段了吗（原版两次 `fcn_0045144f` 是串行的：狗咬 → 救护车）──
  //   判据是「上一段已经收摊」：收摊那条路会把 `boardFilm` 与 `pendingBoardFilm`
  //   都置空，而这一段**只在两者都空时**接管，于是它既不会插到正在播的那一段
  //   前面，也不需要跟 `startBoardFilm` 抢 `pendingBoardFilm`。
  const after = pendingBoardFilmAfter;
  if (after !== null && boardFilm === null && pendingBoardFilm === null) {
    const key = `${after.archive}:${after.resource}`;
    if (boardFilmFlics.has(key)) {
      pendingBoardFilmAfter = null;
      boardFilm = beginBoardFilm(after, now);
      log(`影片：開始 ${after.id}（${after.frames} 帧 × ${after.frameMs} ms）`);
      if (after.sound >= 0) sound.play('Effect.mkf', after.sound);
      requestRender();
      return;
    }
    // 还没解好 → 现在就解，并**保留**排队标记：`holdForActorWalk` 靠它
    // 挡住「两段之间的空档」，别让 AI 在第二段起播前先派下一步。
    boardFilmFlicNow(after);
    if (boardFilmPending.has(key)) return;
    // 真取不到（没有素材）就整段放弃，免得把回合驱动永远卡在这里
    pendingBoardFilmAfter = null;
  }
  const pending = pendingBoardFilm;
  if (pending !== null) {
    // 补间没播完就先不起播；`requestRender` 那条「补间没完就再排一帧」会一直叫醒我们
    if (!renderer.walkDone(now)) return;
    // 訊息框那一段盖着整块棋盘 ⇒ 原版次序是框先、片后，等它收屏
    if (pending.afterOverlay === true && activeUiScreen() !== null) {
      requestRender();
      return;
    }
    const key = `${pending.archive}:${pending.resource}`;
    if (!boardFilmFlics.has(key)) {
      // 还在解（`.then` 会再 `requestRender`）；真取不到就整段放弃，免得卡住回合驱动
      if (boardFilmPending.has(key)) return;
      pendingBoardFilm = null;
      return;
    }
    pendingBoardFilm = null;
    boardFilm = beginBoardFilm(pending, now);
    log(`影片：開始 ${pending.id}（${pending.frames} 帧 × ${pending.frameMs} ms）`);
    if (pending.sound >= 0) sound.play('Effect.mkf', pending.sound);
    requestRender();
    return;
  }
  const film = boardFilm;
  if (film === null) return;
  if (!boardFilmDone(film, now)) {
    requestRender();
    return;
  }
  boardFilm = null;
  releaseBoardFilmFlics();
  // ★ 阻塞那一段播完了 —— 若后面还排着一段（狗咬 → 救护车），就交给上面 ⓪ 那一步；
  //   只有**两段都播完**才把回合驱动接回去（`scheduleHumanTurn` / `scheduleAi`
  //   都以它为闸，不补这一下人就永远停在原地）。
  if (pendingBoardFilmAfter === null) resumeTurnDriver();
  requestRender();
}

/** 这一刻该贴哪一帧（屏幕落点由规格给）—— 没在播或影片没到货就是 null */
function currentBoardFilmFrame(now: number): {
  bitmap: CanvasImageSource;
  x: number;
  y: number;
  w: number;
  h: number;
} | null {
  const film = boardFilm;
  if (film === null) return null;
  const spec = film.spec;
  const bitmap = boardFilmBitmap(film, now, boardFilmFlics.get(`${spec.archive}:${spec.resource}`) ?? null);
  if (bitmap === null) return null;
  // ★ 交给渲染器的必须是**棋盘局部**坐标：规格里的 (x,y) 是原版的**屏幕**坐标
  //   （住院 (0,210)、入獄/神明 (0,40)），而棋盘的离屏画布 439×440 最后被贴到
  //   屏幕 (0, 40)（`LAYOUT.board`）—— 所以局部 y = 屏幕 y − `LAYOUT.board.y`。
  return { bitmap, x: spec.x, y: spec.y - LAYOUT.board.y, w: spec.width, h: spec.height };
}

/**
 * 本 action 里有没有「原地加蓋」→ 有就起播建屋动效。
 *
 * ★ 三条消费点共用这一个出口（见 `build-fx.ts` 文件头第 5 条）：
 *   機器工人（9）/ 魔法屋「就地加蓋房屋」/ 天使卡（9）。
 *
 * ★★ C-ARC-2：判据**不是**这里比出来的 —— core 把 `0x40b110` 返回值的 bit7
 *   放在 `GameState.lastBuildUpgrades`（`BuildUpgradeHint`，瞬态、不进指纹，
 *   C-DET-4）。先前这里是 `reachedMaxLandLevel(before.landLevel, state.landLevel,
 *   landId)` —— 客户端自己按「加之前 4、加之后 5」判，而且注释还把
 *   「設施支不置位」写反了（`0x0040b21a mov eax, 0x81` 明明白白置位）。
 *   现在只读 core 的契约，等级比较一行也不在客户端。
 *
 * ★ 只在**状态真的变了**之后调（`applyAction` 里 `state !== before` 那一支）：
 *   原版是「选到目标就扣道具」，盖不动也照样播（0x004472fb 在 0x00447345 之前）；
 *   本引擎的既定口径是「只在真正生效时才收走道具」，于是没生效就不播。
 *   这条差异登记在 `docs/deviations/Q-TOOL-6.md`。
 *
 * ⚠️ 影片**一段一段解**（这里只解第一段；第二段等第一段播完再解）——
 *   照原版 `read_mkf` → 播 → `libc_free` 的节奏，别把两段 100 MB 一起压在显存里。
 *   首次用的时候解 68 帧要几百毫秒，所以**解完才起时间轴**（原版也是先
 *   `read_mkf` 再 `fcn_0045144f`）—— 那之前挂在 `pendingBuildFx` 上，见 `tickBuildFx`。
 */
function startBuildFx(before: GameState): void {
  const plan = buildFxPlan(buildUpgradesOf(state, before));
  if (!plan.hammer && !plan.maxLevel) return;
  // ★ 加蓋那一级的可见性也要按到影片之后（issue #19 第 9 条）：原版
  //   `fcn_0040b110` 先把 `+0x1a` 加 1、**再**播大锤，播片期间棋盘不重绘。
  //   浏览器里解 68 帧要几百毫秒，不按住就会「房子先修好了」（见 `deferred-board.ts`）。
  deferredBoardBefore = before;
  // 上一条还没播完就被顶掉：直接换掉并放掉旧位图（原版是阻塞的，两段不会重叠）
  if (buildFx !== null) {
    buildFx = null;
    releaseBuildFlics();
  }
  // ★ 天使卡那一支（0x004434c0）**没有** 0x229：直接从 0x20b 起播。
  const first: BuildClipName = plan.hammer ? 'hammer' : 'maxLevel';
  buildFlicNow(first);
  pendingBuildFx = { maxed: plan.maxLevel, first };
  requestRender();
}

/**
 * 每帧推进建屋动效：
 *   ① 影片还在解 → 解完才起时间轴（原版 `read_mkf` 在前、`fcn_0045144f` 在后）；
 *   ② 两段都播完 → 收摊（放掉位图）。
 *
 * 挂在 `requestRender` 的 rAF 回调里，与走子补间 / 投掷动效同一个套路 ——
 * 靠**时间轴**推进（`stepBuildFx` 只在到点时才翻片），不无条件续帧。
 *
 * ★ 与棋盘影片同理，起播要等这一步的走子补间播完（试玩3 #1）：原版这些影片都在
 *   走子例程**之后**才播。機器工人/魔法屋/天使卡这几条 action 本来不带补间，
 *   所以这道等待通常一次都不触发 —— 加上它只是为了与 `tickBoardFilm` 同一条规矩。
 */
function tickBuildFx(now: number): void {
  // ── ① 待播：等第一段影片解好 ──
  const pending = pendingBuildFx;
  if (pending !== null) {
    // 补间没播完就先不起播；`requestRender` 那条「补间没完就再排一帧」会一直叫醒我们
    if (!renderer.walkDone(now)) return;
    const res = buildClip(pending.first).resource;
    if (!buildFlics.has(res)) {
      // 还在解（`buildFlicNow` 的 `.then` 会再 `requestRender`）；真取不到就整段放弃，
      // 免得把 AI 的下一步永远卡在这里（没有素材时不播，只少一段动画）
      if (buildFlicPending.has(res)) return;
      pendingBuildFx = null;
      return;
    }
    pendingBuildFx = null;
    const flic = buildFlics.get(res) ?? null;
    if (flic === null) return;
    // ★ 天使卡那一支直接从 0x20b 起播（`withHammer = false`）—— 见 `startBuildFx`。
    buildFx = beginBuildFx(performance.now(), pending.maxed, pending.first === 'hammer');
    playBuildFxSound(pending.first);
    requestRender();
    return;
  }
  // ── ② 正在播 ──
  const fx = buildFx;
  if (fx === null) return;
  const next = stepBuildFx(fx, now);
  if (next === null) {
    buildFx = null;
    releaseBuildFlics();
    requestRender();
    return;
  }
  if (next.clip !== fx.clip) {
    // 翻片：上一段播完就放掉（照原版 `libc_free` 的节奏），下一段这时才解
    releaseBuildFlic(buildClip(fx.clip).resource);
    playBuildFxSound(next.clip);
    buildFlicNow(next.clip);
  }
  buildFx = next;
  requestRender();
}

/** 这一刻该贴哪一帧（棋盘局部左上角）—— 没在播或影片没到货就是 null */
function currentBuildFxBitmap(now: number): CanvasImageSource | null {
  const fx = buildFx;
  if (fx === null) return null;
  return buildFxBitmap(fx, now, {
    hammer: buildFlics.get(buildClip('hammer').resource) ?? null,
    maxLevel: buildFlics.get(buildClip('maxLevel').resource) ?? null,
  });
}

/**
 * 这一帧**棋盘**该按哪一份 state 画 —— 影片窗口里按 before
 * （加蓋那一格还是旧房子、神明还站在地上而不是附在主人身上）。
 *
 * ★ 只换棋盘那一处的入参：侧栏 / 工具栏 / 訊息框都不读这几个字段，
 *   它们的数字本来就该当场更新（`hud.ts` 里没有 `landLevel`/`godInfo`）。
 * ★ 窗口的判据是四条影片状态位（正在播 **或** 还没解码）—— 解码那几百毫秒
 *   棋盘是露着的，正是需求方看到「效果先于动画」的那一段。见 `deferred-board.ts`。
 */
function boardDrawState(): GameState {
  return boardStateForFilm(state, deferredBoardBefore, {
    buildPlaying: buildFx !== null,
    buildPending: pendingBuildFx !== null,
    filmPlaying: boardFilm !== null,
    filmPending: pendingBoardFilm !== null,
  });
}

function requestRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    resizeCanvas();
    syncBailBgm();
    // 场所都收了、放的还是场所曲 ⇒ 把背景曲从被打断的位置接回来（`sub_00454bcc`）
    if (boardBgmDue()) restoreBoardBgm();
    // ★ 登记过的整屏每帧收一次 `tick`（不管此刻是不是它在接管）——
    //   演出类屏幕靠它察觉状态变化、推进动画。**屏幕自己要续帧就调
    //   `env.requestRender()`**，别指望这里无条件重排（会转成死循环）。
    // ★ 只有**此刻接管整屏的那一屏**收 `tick`（D-T031-4）。
    //   每一屏的「起播」都走 `event()`（`main.ts` 在 state 变化时统一派），
    //   `tick` 只负责推进**自己正在播的那一段** —— 所以给没上屏的屏也 tick
    //   会让它们的动画在别人背后偷跑（分红屏占屏那 3 秒里開獎屏照样在走）。
    //   **屏幕自己要续帧就调 `env.requestRender()`**，别指望这里无条件重排（会死循环）。
    let overlay = activeUiScreen();
    if (overlay !== null) {
      overlay.tick?.(uiEnv());
      // ★★ 2026-09-16 修「收屏那一帧整屏全黑」（外部审查 B-10）：`tick()` 可能
      //   **自己把屏收掉**（樂透投注屏的 `bye` 到点就 `active()` 变假并清掉
      //   `byeView`；月結屏、魔法屋也是同一写法）。而下面那句
      //   `if (overlay !== null) { … overlay.draw() }` 用的是**tick 之前**的
      //   快照 —— 于是这一帧既不画棋盘（overlay 还在）又什么都没画出来
      //   （draw 已无内容可画），在刚被 `fillRect('#000')` 清黑的舞台上就是
      //   一整帧纯黑。原版收屏是销毁窗口、当场露出棋盘，所以这里必须在
      //   tick 之后**重新问一次**「现在谁接管」，让这一帧就画回棋盘。
      overlay = activeUiScreen();
    }
    // ★ 走子补间要**逐帧**重绘（T-046）：补间没播完就再排一帧，
    //   否则棋子会停在这一步的第一帧上，直到下一次 dispatch 才动。
    if (screen === 'game' && !renderer.walkDone()) requestRender();
    // ★ 走子整趟结束时停掉移动音效（逐格不停，见 `syncMoveSound`）
    if (screen === 'game') syncMoveSound();
    // ★ 投掷动效（放置類道具）同理：没播完就再排一帧；播完那一下才放落地音
    //   （原版顺序：动画 → 收尾停 100 ms → 音效，见 `startObjectFlight`）
    if (screen === 'game') tickObjectFlight(performance.now());
    // ★ 建屋动效（機器工人）同理：两段时间轴没走完就再排一帧，走完就放掉位图
    if (screen === 'game') tickBuildFx(performance.now());
    // ★ 送進監獄／醫院那段影片同理（Q-ANIM-1）：按帧时序推进，播完补一次回合驱动
    if (screen === 'game') tickBoardFilm(performance.now());
    // ★ 原版会替玩家把系统指针挪到按钮上（试玩3 #2）：时机刚从关变开就挪一次
    cursorWarper.update();
    if (screen === 'game') shopTick(performance.now());
    // ★ 銀行两屏的动态部分（Q-BANK-1）：貸款屏的滑入/气泡 + ATM 键盘按下码的清除
    if (screen === 'game') bankTick(performance.now());
    // ★ 角色台词（T-052）：**不限定 `game` 屏** —— 语音在任何一屏都可能派出来
    //   （开局宣言、破產、勝利宣言…），队列的收尾不能因为屏幕上盖着别的东西就停住。
    speechTick(performance.now());

    stageCtx.imageSmoothingEnabled = false;
    stageCtx.fillStyle = '#000';
    stageCtx.fillRect(0, 0, SCREEN_W, SCREEN_H);

    if (overlay !== null) {
      // ★ 登记的整屏接管：棋盘、侧栏、工具栏一概不画（原版这些屏也是整屏窗口）
      // ★ 例外是**浮窗**（`windowed: true`，如大地圖彈窗）：原版只把被盖住的
      //   那一块盖上去，周围的棋盘/工具栏/侧栏照旧露着 —— 故先照常画一整帧。
      if (overlay.windowed === true && screen === 'game') drawGameStage();
      overlay.draw(uiEnv());
    } else if (screen === 'title') {
      drawTitle(stageCtx, titleHot, spriteNow);
    } else if (screen === 'intro') {
      // ★ 过场要**逐帧**推进：没播完就再排一帧（与走子补间同一个道理），
      //   否则只画第一帧就冻住 —— 类型检查与单测都看不出这一条。
      // ★ 也**不能在这里 `return`** —— 见下面 assets 那条的同一条注释：
      //   `blitStage()` 在这条链末尾，提前返回就是白画（过场此前就是这样，
      //   一直没显示出来）。
      // ★ 2026-09-16：接上原版的**回退分支**素材（jump.mkf 的底图 + 跳伞 FLIC +
      //   角色 FLIC + Effect #25）。原先只画一块占位框。素材都在 `assets/`，
      //   取不到就那一步静默跳过（只剩一行「按任意鍵跳過」）。
      // ★ 2026-09-18：**每个玩家各两段**（Jxx 跳出去 + Fxx 背降落伞下降）——
      //   资源号由**该玩家的 `character`** 索引（`0x2f+角色` / `0x3b+角色`），
      //   所以这里必须把**全桌**的角色号交给它，不能只给 `players[0]`。
      //   @source `fcn_00415872` VA 0x004158e0（预载）与 0x00415b58 / 0x00415c76（播放）。
      const introCast = state.players.map((p) => p.character);
      drawIntro(stageCtx, performance.now() - introStartedAt, {
        sprite: spriteNow,
        flic: uiFlicNow,
        // ★ 音效只放一次：`drawIntro` 只在 `soundPlayed !== true` 那一帧回调，
        //   这里回调到就把标志立起来（原版也在铺完底图之后放一下）。
        playEffect: (id: number) => {
          if (introSoundPlayed) return;
          introSoundPlayed = true;
          sound.play('Effect.mkf', id);
        },
        characters: introCast,
        soundPlayed: introSoundPlayed,
      });
      if (introDone(introStartedAt, performance.now(), introSkipped, introCast)) endIntro();
      else requestRender();
    } else if (screen === 'assets') {
      // ★ **不要在这里 `return`** —— `blitStage()` 在这条链的末尾，
      //   提前返回等于画了不上屏（上一轮就是这样：`screen` 都切过去了，
      //   画面却一直停在棋盘上）。
      drawAssetSheet(stageCtx, spriteNow, state, topo, assetWho, assetView, sheetUi);
    } else if (screen === 'inventory') {
      // 浮窗**盖在棋盘上**（原版只是把被盖住的那块存下来、退出时贴回去），
      // 所以先照常画一整帧棋盘，再把浮窗叠上去。
      drawGameStage();
      drawInventory(
        stageCtx,
        spriteNow,
        invKind,
        invKind === 'tools'
          ? toolEntries(state, state.currentPlayer)
          : cardEntries(state, state.currentPlayer),
        // 载具徽章只有道具欄有：`traffic_method` 1 = 機車、2 = 汽車 @source VA 0x447e08
        invKind === 'tools'
          ? (INV_VEHICLE_IMAGE.get(state.players[state.currentPlayer]?.trafficMethod ?? 0) ?? null)
          : null,
      );
    } else if (screen === 'setup') {
      // ★ 这一屏的定时器是**一直跑**的（背景在横向循环滚、小人在逐帧走），
      //   所以每次画完都再排一帧 —— 与过场同一个道理 @source VA 0x00404feb
      const now = performance.now();
      const outro =
        setupOutroAt === null ? null : setupOutro(now, setupOutroAt, setupOutroScroll);
      // ★ 拉幕播完（最后一名小人走出画面）→ 这才真的开局。
      //   原版是自己给自己 PostMessage 一个 WM_KEYDOWN，见 setup.ts 的注释。
      if (drawSetup(stageCtx, setup, spriteNow, now, setupScene, outro)) {
        finishSetupOutro();
        return;
      }
      requestRender();
    } else if (screen === 'saveload') {
      // 盖在原来那一屏上（原版也是这样）
      if (saveLoadReturn === 'game') drawGameStage();
      else drawTitle(stageCtx, null, spriteNow);
      stageCtx.fillStyle = 'rgba(0,0,0,0.45)';
      stageCtx.fillRect(0, 0, SCREEN_W, SCREEN_H);
      drawSaveLoad(stageCtx, saveLoadMode, saveLoadSlots, saveLoadHot, uiSprite);
    } else if (screen === 'aiSettings') {
      // 託管AI 是**盖在棋盘上**的对话框（原版就是这样），与設定同一套画法
      if (aiReturn === 'game') drawGameStage();
      stageCtx.fillStyle = 'rgba(0,0,0,0.45)';
      stageCtx.fillRect(0, 0, SCREEN_W, SCREEN_H);
      const draft = aiDraft ?? [];
      drawAiSettings(stageCtx, state, draft, aiHot, (archive, resource, index) =>
        spriteNow(archive, resource, index, true),
      );
    } else if (screen === 'lobby') {
      drawLobby(
        stageCtx,
        lobbySlots(lobbyRoom, net?.seat ?? null),
        net?.seat ?? null,
        isHostSeat(net?.seat ?? null),
        lobbyRoom?.started ?? false,
        lobbyHot,
        (archive, resource, index) => spriteNow(archive, resource, index),
        (t) => stageCtx.measureText(t).width,
        // ★ Q-NET-2：房间地图也来自服务器快照（缺省 0 兼容旧快照）
        roomMapId(lobbyRoom),
      );
    } else if (screen === 'options') {
      // 設定是**盖在**原来那一屏上的对话框（原版就是这样）
      if (optionsReturn === 'game') drawGameStage();
      else drawTitle(stageCtx, null, spriteNow);
      stageCtx.fillStyle = 'rgba(0,0,0,0.45)';
      stageCtx.fillRect(0, 0, SCREEN_W, SCREEN_H);
      drawOptions(
        stageCtx,
        optionsDraft,
        optionsVariant,
        optionsPressed,
        musicTrack,
        (i, key = false) => spriteNow('Data.mkf', OPTIONS_RESOURCE, i, key),
      );
      // ── 副屏盖在主面板上（原版是另开一扇窗口）──
      if (optionsSub !== null) drawOptionsSub();
    } else if (screen === 'stock') {
      // 股市是**整屏**的（原版那扇窗口盖住棋盘），画法与銀行那两屏同一条路
      drawStockScreen(stageCtx, spriteNow, stockView());
      // 详情卡是**模态**的（原版另开一扇窗口），盖在最上面
      const detail = stockDetailView();
      if (detail !== null) drawStockDetail(stageCtx, spriteNow, detail);
      const ui = stockAmountUi();
      if (ui !== null && amountPage !== null) {
        // 填数页照棋盘坐标排版，整体平移过去（`fcn_00453544` 也是另开一窗）
        stageCtx.save();
        stageCtx.translate(LAYOUT.board.x, LAYOUT.board.y);
        drawDialog(stageCtx, uiSprite, ui, amountPage, dialogHot);
        stageCtx.restore();
      }
    } else {
      drawGameStage();
    }

    // 銀行落点那两屏（T-029）：貸款屏先铺（整屏 640×480），ATM 是模態的盖它上面；
    // 若填数页开着，再把棋盘那块（对话框在上面）贴回来 —— 原版的填数页也是
    // 盖在银行屏上的（`fcn_00453544` 那一声调用就在贷款屏的状态机里）。
    const bank = bankPending();
    if (bank !== null && atm === null) {
      // 三条数额 = 額度 / 已用 / 額度−已用 @source `fcn_00433c20`：
      // 依次是 `arg`、`player+0x28`、`arg − player+0x28`。
      // 而 `pending.specialFinance.available` 就是 `額度 − 已用`（core 的
      // `specialFinanceAvailable`）⇒ 額度 = available + owed。
      const fin = state.pending?.kind === 'bank' ? state.pending.specialFinance : null;
      const owed = fin?.owed ?? 0;
      const room = fin?.available ?? 0;
      // ★ 三条数额的**数字**只有子对话框开着才画（原版是子对话框 0x405 那一拍
      //   调 `fcn_00433c20` 画的）；点「窗」之前只有底图上那几个**标签**。
      const financeOpen = loanUi?.financeOpen === true;
      drawBankLoan(stageCtx, spriteNow, {
        chairman: bank.chairman,
        frozen: bankFrozen(),
        subDialog: financeOpen,
        finance: financeOpen ? [room + owed, owed, room] : null,
        // 董事长眨眼（子对话框那支 100 ms 定时器）；它不在时（或填数页开着时）不眨
        // @source `0x4347a2` 的 `cmp [0x48c3cc], 4 / je`
        blink: financeOpen && amountPage === null ? loanBlinkImage(loanBlink) : null,
      });
      // Q-BANK-1：两块**滑入面板**压在底图上 —— 玩家面板 200×280 @(0,y)、
      // 日期面板 200×200 @(280,y)，y = `[0x48c3d5]` @source fcn_00435062。
      if (loanUi !== null) {
        drawLoanPanels(stageCtx, spriteNow, loanPanelView(loanUi));
        // EXIT 的按下图（图 19）—— 四颗钮里只有它有 @source loc_00435cca
        drawLoanPressed(stageCtx, spriteNow, loanUi.pressed, {
          x0: LOAN_BUTTONS[LOAN_EXIT]!.x0,
          y0: LOAN_BUTTONS[LOAN_EXIT]!.y0,
        });
        // 店員那句话（气泡底图 = 资源 23 图 21，锚点落 (240,80)）@source fcn_00434186
        if (loanUi.bubble !== null) drawLoanBubble(stageCtx, spriteNow, loanUi.bubble.text);
      }
    }
    if (atm !== null) drawBankAtm(stageCtx, spriteNow, atm, bankFrozen(), atmCode);
    if (bank !== null && atm === null && amountPage !== null) {
      // 填数页（`fcn_00453544`）是**另开一个窗口**盖在银行屏上的，所以这里
      // 单独把它画到舞台 —— 不能整块贴回棋盘画布（那样四周会透出地图）。
      // 它的排版仍照棋盘坐标走，于是整体平移过去；命中判定也照旧走棋盘坐标。
      const pageDlg = currentDialog();
      if (pageDlg !== null) {
        stageCtx.save();
        stageCtx.translate(LAYOUT.board.x, LAYOUT.board.y);
        drawDialog(stageCtx, uiSprite, pageDlg, amountPage, dialogHot);
        stageCtx.restore();
      }
    }

    // ── 遙控骰子的点数盘（Q-PICK-2）──
    // ★ 原版是**另开一扇模态窗口**盖在棋盘上（`_rich4_use_tool_yaokongtouzi` 把
    //   `Panel.mkf` #72 贴到 (92,300) 之后才进 `Wait_0402_Message`），
    //   所以这里也画在链尾、盖住底下那一屏。
    if (dicePick !== null) drawDiceChoose(stageCtx, spriteNow, dicePick.hover);

    // ── 角色台词（T-052 的屏幕那一半）──
    // ★ 画在链尾、盖住底下那一屏，与原版一致：`_rich4_player_say` 的第 ① 步
    //   （白字字幕）与第 ② 步（金貝貝的 `Data.mkf #0x207` 表情图）都是直接
    //   画在**整块舞台**上的（坐标就是屏幕坐标，见 `speech-bubble.ts`）。
    //   ⚠️ 不能画在 `drawGameStage()` 里 —— 那一趟只在 `screen === 'game'` 时走，
    //   而语音是**任何一屏**都可能派出来的。
    {
      const bubble = speechQueue.current();
      if (bubble !== null) {
        stageCtx.save();
        drawSpeechBubble(bubble, { ctx: stageCtx, sprite: uiSprite, font });
        stageCtx.restore();
      }
    }

    // ── 屏幕提示条（`toast.ts`）──
    // ★ 画在**最上面**：整屏接管、模态窗、台词之后。原版没有这东西，是需求方
    //   明确要求的非叙事提示（F9 回报的落盘确认），所以不必与哪一屏对齐。
    drawToast(stageCtx, toast, performance.now(), SCREEN_W, SCREEN_H);

    // 拾取模式的指针图要**解码完才能用**。首帧拿不到就返回 null，
    // 而光标只在 hover 变化时才刷新 —— 于是「一次都没悬停到」时指针会空着。
    // 图到货（spriteArrived）时补一次，这一条不能省。
    if (pick !== null && spriteArrived) refreshPickCursor();

    blitStage();

    // 有精灵在本帧解码完成 → 再画一次，把它们补上；
    // 骰子在滚也要继续要帧，否则动画只有一格；
    // 商店开着也要一直要帧 —— 原版那儿挂着一个 50ms 的定时器（`SetTimer(hwnd, 0x32, …)`）。
    // 銀行貸款屏同理（Q-BANK-1：滑入与气泡都要逐帧看）；ATM 只在键盘那一下补一帧。
    // ★ 台词也一样：一段显示 `SPEECH_HOLD_MS` 毫秒，到点由 `speechTick` 收掉并要下一帧。
    // ★ toast 同理：还没到点就接着要帧（到点那一帧画空 = 自己擦掉）。
    if (
      renderer.dirty ||
      hud.dirty ||
      spriteArrived ||
      diceFx.active ||
      shopUi !== null ||
      loanUi !== null ||
      atmCode !== null ||
      speechQueue.length > 0 ||
      toastVisible(toast, performance.now())
    ) {
      renderer.clearDirty();
      hud.clearDirty();
      spriteArrived = false;
      requestRender();
    }
  });
}

/**
 * 台词队列的节拍 —— 每帧走一次：收掉到点的那段、给刚上台的那段放语音。
 *
 * ★ **先放语音、再按语音时长把这一段撑长**：原版 `_rich4_player_say` 的收尾是
 *   `fcn_004544f6(0x3e8)` —— 那是个「**还有没有声音在响**，没有就再等 1000 ms」
 *   的循环（VA 0x00454520 起 `PeekMessage` + `timeGetTime` 比对）。所以原版
 *   **一定**是语音播完才开始数那 1000 ms。本引擎并行，于是长句会出现
 *   「字先没了、声音还在」；这里在起播后问一次时长、把它加进显示时间。
 *
 * ★ **顺序**也是照原版来的：语音跟着**队列**一段一段放，不再同时响
 *   （先前那次 `for (…) sound.play(…)` 登记为 Q-SPEECH-6，已订正）。
 */
let spokenBubble: SpeechBubble | null = null;

function speechTick(now: number): void {
  // ★★ 演出在演 → 台词**整队冻结**（不倒数、不上台、不放语音）。
  //
  //   原版每一段演出都是**同步**的：`_rich4_player_say`（VA 0x0044ef41）与
  //   轉盤（`fcn_0044090e` → `fcn_0043f7c6`）都是**阻塞调用**，谁先谁后由
  //   同一段落地流程里的**调用顺序**定死 —— 例如設施收費那一段：
  //   ```asm
  //   0041a458  call 0x44090e     ; ★ 轉盤（阻塞：轉完才返回盤上的數）
  //   0041a460  [esp+0xd0] = eax  ; 轉盤值（旅館天數 / 購物中心倍數）
  //   0041a579  call 0x440cac     ; 費用訊息框（轉盤之後）
  //   0041a5c0  call 0x40df69     ; 收費（錢真的轉手）
  //   0041a71e  call 0x44f42d     ; 付款人的台詞（事件 9/10/11）—— 收費之後
  //   ```
  //   而付款人那一句是**收費那一路**派出来的，所以原版**必定**是
  //   「轉盤停 → 訊息框 → 付款人的台詞」。
  //
  //   本引擎把 consequences 一次写完，台词在 action 落地时就排进了队列；
  //   先前这里照样逐帧收，于是轉盤還在轉，付款人的台词已经在屏幕上说完
  //   （试玩回报：「盘子还没停下来 NPC 的台词都触发了」）。
  //   冻在这一支里，等于把「同步演出」的语义补回来：**演出期间台词一步都不走**。
  //
  //   ⚠️ `SpeechQueue` 的时间基准是**绝对时刻**（`shownAt`），所以解冻时要把
  //      已经过去的那一段演出从队列的时间轴上挪掉（见 `speechFrozenAt`）——
  //      否则解冻后第一帧就会把整段冻结期算成「已经演完了」，那一段一闪而过。
  if (blockingPresentation()) {
    if (speechFrozenAt === null) speechFrozenAt = now;
    return;
  }
  const frozenAt = speechFrozenAt;
  if (frozenAt !== null) {
    // 解冻：冻了多久就从时间轴上挪掉多久（已演的那一截原样保留）
    speechFrozenAt = null;
    if (speechQueue.length > 0) speechQueue.rebase(frozenAt, now);
  }
  if (speechQueue.tick(now)) requestRender();
  const cur = speechQueue.current();
  if (cur === spokenBubble) return;
  // 换段了（含「从无到有」与「清空」）
  spokenBubble = cur;
  if (cur === null || cur.voice === null) return;
  sound.play('Speaking.mkf', cur.voice);
  // ★ 语音比字幕长就把字幕撑到语音播完 —— 原版是「播完再数 1000 ms」
  const voiceMs = sound.durationOf('Speaking.mkf', cur.voice);
  if (voiceMs !== null) speechQueue.extend(voiceMs);
  requestRender();
}

/**
 * 商店开着时每帧走一次：滑入、气泡到点自收。
 *
 * ★ 滑入**不能按屏幕刷新率走** —— 原版那 8 帧是每 100ms 一帧
 *   （50ms 的定时器 + `[0x48c348] ^= 1` 隔一次动一下），共约 0.8 秒。
 *   这么做既对得上原版的手感，也顺手把每帧的绘制省下来。
 */
function shopTick(now: number): void {
  const ui = shopUi;
  if (ui === null) return;
  if (!slideDone(ui.slide) && now - ui.slideAt >= SHOP_SLIDE_MS) {
    ui.slideAt = now;
    ui.slide = slideStep(ui.slide);
    // 滑入到位才说「請挑選…」—— 原版是动画走完那一刻才发 0x40d（`loc_0042d75e` 尾）
    if (slideDone(ui.slide)) shopSay(ui, shopMessage(ui.page, 'hint'), now);
  }
  if (ui.bubble === null || now < ui.bubble.until) return;
  ui.bubble = null;
  // ★ 道别那句话说完才真的关门 @source `loc_0042e686` → 状态 2→3→4
  if (ui.closing) dispatch({ type: 'declineDecision' });
}

/**
 * 画掷骰那一段当前该画的东西。
 *
 * ★ 三段串行，全部照 exe：
 *   预动作 —— 角色播「手持骰子的走路」（由 `characterPoseOf` 交给渲染器，
 *   这里什么都不画）；滚骰 —— FLIC 逐帧；定格 —— 点数图盖上去留 500 ms。
 */
function drawDiceFx(ctx: CanvasRenderingContext2D, now: number): void {
  if (!diceFx.active) return;
  const flic = diceFx.flicBitmap(now);
  if (flic !== null) {
    drawDiceFlic(ctx, flic, currentScreenDir());
    return;
  }
  // 定格段：点数图盖上去。滚骰段走到这儿只可能是影片还没解好 —— 也先把点数摆出来，
  // 总比让画面空着强（这一步不是原版行为，是缺素材时的兜底）。
  const pips = diceFx.pips(now) ?? diceFx.dice;
  if (pips.length > 0) drawDice(ctx, uiSprite, pips, currentScreenDir());
}

/**
 * 掷骰那一段角色摆哪一组图 —— 原版整段都停在「手持骰子」上。
 * @returns `CHARACTER_POSE` 的值，或 null（不覆盖）
 */
function characterPoseOf(): number | null {
  return diceFx.characterPose === 'dice' ? CHARACTER_POSE.dice : null;
}

/** 把游戏画面的三块摆到舞台上 */
function drawGameStage(): void {
  // ★ 百貨公司是**整屏**的一屏，不等于在棋盘上盖个框 —— 它一开，棋盘就不画了。
  if (shopUi !== null && currentDialog() !== null) {
    drawShopStage();
    return;
  }
  // ★ 監獄／醫院保釋屏同样是整屏（T-038）—— 棋盘、侧栏全不画
  if (screen === 'game' && state.pending?.kind === 'bail') {
    drawBailStage();
    return;
  }
  const dlgNow = currentDialog();
  const scene = screen === 'game' ? sceneFor(state.pending) : null;
  if (scene !== null && dlgNow !== null) {
    drawSceneStage(scene, dlgNow);
    return;
  }
  syncHolidayArt();
  if (followPlayer) centerOnCurrentPlayer();

  renderer.draw({
    map,
    // ★ 影片窗口里棋盘按 before 画（试玩3 #1/#9）——加蓋那一格/神明标记不许
    //   在影片起播前先出现。侧栏那几处不读这几个字段，故只换棋盘这一处。
    state: boardDrawState(),
    camera,
    hoverNode,
    ground: showGround ? ground : null,
    groundOffset,
    characterPose: characterPoseOf(),
    viewport: { w: LAYOUT.board.w, h: LAYOUT.board.h },
    // ★ 替身（四大惡人／機器娃娃）那一趟的整趟路径由 core 交出来（T-047）：
    //   `runNpc` / `runDoll` 的中间格是岔路上 rand() 选的，渲染器事后推不出来，
    //   所以 core 把它落在 `GameState.lastNpcWalks`（纯表现提示，不进指纹）。
    actorWalks: state.lastNpcWalks,
    // ★ 这里**没有**「動畫過程」开关：原版 `[0x497159]` 只管影片（FLIC），
    //   走子补间（`0x40c05c` / `0x40d7c4`）一处都没读它 —— 关掉動畫過程时
    //   棋子照样逐格滑。见 `render.ts` 的 `DrawInput` 与 `startWalk`。
    // 一个 tick 多少毫秒：与玩家那条、与 core 的 tick 同一个节拍
    tickMs: tickMs(options.speed),
    // 原版 [0x49910c] 为 4..8（替身在行动）时传它，只影响同屏幕 Y 时谁压在上面。
    // ⚠️ core 目前**不暴露**「此刻是谁在行动」—— 它是一次动作里跑完整趟的，
    //   没有可以读的中间态，故这里按「没有替身在行动」处理（留空）。
    currentActor: null,
    // 放置類道具的投掷动效（纯表现，不进 state）—— 飞着的那一件由渲染器画在
    // 清单之上，同时把它从静态槽里藏掉（原版动画期间棋盘不重绘）
    objectFlight,
    // 機器工人（9）的原地建屋影片（Q-TOOL-6）—— 两段 FLIC 合起来 440×440
    // 盖在棋盘左上角，**不进绘制槽**、也没有自己的落点（落点是常数）。
    buildFx: currentBuildFxBitmap(performance.now()),
    // ★ 「盖在棋盘上的阻塞影片」（Q-ANIM-1）—— 落点/尺寸随哪一段变
    //   （住院 440×74 @(0,210)，入獄/神明 440×440 @(0,40)），所以整份交出去。
    boardFilm: currentBoardFilmFrame(performance.now()),
  });
  const dlg = currentDialog();
  const me = state.players[state.currentPlayer];
  if (dlg !== null) {
    drawDialog(boardCtx, uiSprite, dlg, amountPage, dialogHot);
  } else if (diceFx.active) {
    // ★ 掷骰那一段（Q-TURN-1 §3/§4）：滚骰是 `Panel.mkf` 4/5/6 的 **FLIC**，
    //   滚完再把 `Panel.mkf` 3 的点数图盖上去定格 500 ms。
    drawDiceFx(boardCtx, performance.now());
  } else if (awaitingHumanRoll() && me !== undefined) {
    // ★ 原版的 GO 鈕 + 骰子数切换（Panel.mkf 资源 7）。
    //   位置是**可拖的**（Q-UI-6），存在 `goButton` 里（= 原版 `[0x475284]/[0x475288]`）
    drawAdvance(boardCtx, uiSprite, goImageOf(me), maxDiceOf(me), me.ndices, goButton.position());
  } else if (state.phase === 'moving' && state.dice.length > 0) {
    drawDice(boardCtx, uiSprite, state.dice, currentScreenDir());
  }
  // ── 名牌浮标（Q-HOVER-1）：原版画在棋盘面上、訊息框那类**独立窗口**之下 ──
  if (nodeTip !== null && dlg === null) {
    drawTip(boardCtx, spriteNow(TIP_ARCHIVE, TIP_RESOURCE, nodeTip.image, true), nodeTip);
  }
  stageCtx.drawImage(boardCanvas, LAYOUT.board.x, LAYOUT.board.y);

  // 工具栏画在棋盘上方（直接画到舞台上）
  renderer.drawToolbarTo(stageCtx, LAYOUT.toolbar.x, LAYOUT.toolbar.y, hotTool);

  hud.draw({
    state,
    map,
    camera,
    minimapBg,
    sidebarView,
    minimapMarker,
    pressedMinimapArrow,
    hotMinimapArrow,
    holidayArt,
    panelPage: panelPages[state.currentPlayer] ?? 0,
    panelRows: panelRows(state, topo, state.currentPlayer, panelPages[state.currentPlayer] ?? 0),
  });
  stageCtx.drawImage(hudCanvasOff, LAYOUT.panel.x, LAYOUT.panel.y);
}

/**
 * 场所屏：整屏一张原版底图，对话框盖在上面。
 *
 * ★ 原版的銀行/樂透/百貨/拍賣/監獄/醫院/小游戏都是**整屏**的，不是在棋盘上
 *   弹个框。底图是哪一张见 `scenes.ts`。
 *
 * ⚠️ 每一屏自己的控件都还没做，上面盖的仍是通用对话框（Q-SCENE-1）。
 *   对话框仍然画进棋盘那块离屏画布，好让命中判定与平时**走同一条路**——
 *   只是这次把棋盘本身清空，让底图透出来。
 */
function drawSceneStage(resource: number, ui: InteractionUi): void {
  const bg = spriteNow(SCENE_ARCHIVE, resource, 0);
  if (bg !== null) stageCtx.drawImage(bg.bitmap, 0, 0, SCREEN_W, SCREEN_H);
  else {
    stageCtx.fillStyle = '#1a1d24';
    stageCtx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  }
  boardCtx.clearRect(0, 0, LAYOUT.board.w, LAYOUT.board.h);
  drawDialog(boardCtx, uiSprite, ui, amountPage, dialogHot);
  stageCtx.drawImage(boardCanvas, LAYOUT.board.x, LAYOUT.board.y);
}

/**
 * 卡片商店／道具商店（百貨公司）整屏 —— P2-8 / U-2。
 *
 * ★ 这一屏**不吃通用对话框**：卖点就是那一屏自己的控件（左侧货架、右下格子、
 *   三角切页钮、EXIT）。位置与命中全在 `shop-screen.ts`，这里只把当前的
 *   局面喂给它。
 *
 */
function drawShopStage(): void {
  const ui = shopUi;
  const pending = state.pending;
  if (ui === null || pending === null || pending.kind !== 'shop') return;
  const me = state.players[state.currentPlayer];
  if (me === undefined) return;

  stageCtx.fillStyle = '#000';
  stageCtx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  drawShopScreen(stageCtx, spriteNow, {
    page: ui.page,
    panelX: ui.slide.panelX,
    gridX: ui.slide.gridX,
    points: me.points,
    shelf: ui.page === SHOP_PAGE.cards ? ui.shelf.cards : ui.shelf.tools,
    cells:
      ui.page === SHOP_PAGE.cards
        ? cardEntries(state, state.currentPlayer)
        : toolEntries(state, state.currentPlayer),
    bubble: ui.bubble === null ? null : ui.bubble.text,
    pressed: ui.pressed,
    pressedCell: ui.pressedCell,
    // 原版用 `_libc_rand`；这一处纯装饰，不进确定性状态，所以用 `Math.random`
    blink: blinkStep(ui.blink, ui.page, performance.now(), Math.random),
  });
}

/** 舞台 → 窗口：整数倍放大、居中、不插值 */
function blitStage(): void {
  const m = currentMetrics();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(stage, m.offsetX, m.offsetY, SCREEN_W * m.scale, SCREEN_H * m.scale);
}

/** 当前的放大倍数与居中偏移（按**设备像素**算） */
function currentMetrics(): StageMetrics {
  return stageMetrics(canvas.width, canvas.height);
}

/** 鼠标事件 → 舞台坐标；落在舞台外返回 null */
function eventToStage(e: MouseEvent): { x: number; y: number } | null {
  const r = canvas.getBoundingClientRect();
  const dpr = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
  return toStage((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr, currentMetrics());
}

// ============================================================
//  原版会替玩家把**系统鼠标指针**挪到按钮上（试玩3 #2）
// ============================================================
//
//  时机与落点的取证见 `cursor-warp.ts`；这里只负责把它接上：
//  「轮到真人等掷骰（GO 鈕上场）」与「棋盘上盖着两个选项的 YES/NO 框」各挪一次。
//  浏览器下 `warpCursor` 是空操作（网页挪不动系统指针）。

/** 这一拍要看的东西 —— 判定与算术全在 `cursor-warp.ts` */
function cursorWarpFrame(): CursorWarpFrame {
  const dlg = currentDialog();
  return {
    awaitingRoll: awaitingHumanRoll(),
    yesNoBox: dlg !== null && usesYesNo(dlg, amountPage),
    // 另外三处固定落点（(220,320)）的时机 —— @source 见 `cursor-warp.ts` 的顶表：
    //   「請選擇設施類別」浮窗（0x0043fb54 / 0x0043ffc2）、研究所面板（0x00440355）、
    //   遥控骰子小盘（0x004467de），四处都是各自窗口的 WM_CREATE。
    facilityPicker: facilityPickerScreen.active(uiEnv()),
    research: researchScreen.active(uiEnv()),
    dicePick: dicePick !== null,
    // `goButton.position()` 是**棋盘画布**坐标，原版那个全局是屏幕坐标
    goScreen: boardToScreen(goButton.position()),
    metrics: currentMetrics(),
    canvas: measureCanvas(canvas),
  };
}

const cursorWarper = createCursorWarper(warpCursor, cursorWarpFrame);

/**
 * 把镜头平滑地移到当前玩家身上。
 *
 * 用逼近而非瞬移：棋子一步一步走，镜头硬跟会晃得厉害。
 * 系数 0.18 是「跟得上但不抖」的经验值，不是原版常量。
 *
 * ★ **有标记点时不动** —— 原版 `fcn_00415e70`（VA 0x00415e70）是
 *   「有标记用标记、没标记才用当前玩家」。棋子走到标记上时标记自动清掉，
 *   镜头随即恢复跟随（原版 VA 0x00418656 `[0x48be18] = 0`）。
 */
function centerOnCurrentPlayer(): void {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return;
  const node = map.nodes[me.nodeId - 1];
  if (node === undefined) return;

  // ★★ 视角跟踪（第四份回报第 2 条，`docs/escalations.md` E-15）：
  //   ① 棋子正在**一步步走**（走子补间）时，镜头跟他的插值位置；
  //   ② **機器娃娃 / 四大惡人**那一趟跟替身，走完自动回到当前玩家；
  //   ③ 手动点过小地图之后，**下一条 action 一起就把镜头交还**（见
  //      `retargetCameraOnTurnChange`，那一条已在上一版落地）。
  //   证据：原版镜头居中只有一支 `fcn_00415e70`（VA 0x00415e70），它取的是
  //   「有标记用标记、否则用 `[0x49910c]` 那个**当前行动者**」；而娃娃/惡人在盘上时
  //   `[0x49910c]` 被切成 4..7（`rules/npc-walk.ts` 的文件头），所以原版那一段
  //   本来就跟着替身走。世界位置的写入点：玩家 `0x40c38a`/`0x40c3a4`、
  //   替身 `fcn_0040dd1f` 那一族。
  // 判据全在 `camera-follow.ts`（纯函数、有单测）；这里只落镜头
  const walkWorld = renderer.actorCenterWorld(performance.now());
  const target = cameraFollowTarget(walkWorld, me, (id) => map.nodes[id - 1]);
  if (target !== null && target.reason !== 'node') {
    camera = { ...camera, tileX: target.x >> 5, tileY: target.y >> 5 };
    return;
  }

  if (minimapMarker !== null) {
    // 走到标记上了？那就把标记收掉，镜头交还给棋子
    if (Math.abs(node.x - minimapMarker.x) <= 16 && Math.abs(node.y - minimapMarker.y) <= 16) {
      minimapMarker = null;
      requestRender();
    } else {
      return;
    }
  }

  // 人物视角：摄像机就是**当前玩家所在的那一块**，原版恒在 29×29 窗口正中
  //   （原先还有一支「地图视角」的平滑逼近，随 `setViewMode` 一起删掉，D-086-5）
  camera = { ...camera, tileX: node.x >> 5, tileY: node.y >> 5 };
}

/**
 * GO 鈕的闪烁帧 —— 每 500 ms 翻一次（`[0x48bdd4]`）。
 *
 * @source `SetTimer(hwnd, 0x1f4, [0x46cad8], 0)`（VA 0x0041801e，周期 = **500 ms**）
 *   + WM_TIMER 处理 `xor byte [0x48bdd4], 1`（VA 0x00418b7e）。
 *   ⇒ **不点它也在闪**，一暗一亮。
 */
const GO_BLINK_MS = 0x1f4;
let goBlink = false;
setInterval(() => {
  goBlink = !goBlink;
  // 没在等人掷骰就不用重画（GO 鈕那时根本不显示）
  if (screen === 'game') requestRender();
}, GO_BLINK_MS);

/**
 * 这一帧该用 GO 鈕的哪张图 = **组 + 闪烁帧**。
 *
 * @source VA 0x0041724d：
 * ```asm
 * xor ebx, ebx
 * cmp byte [player+0x38], 0    ; 停留中（days_stopping）
 * je short … / mov ebx, 2      ; → 组 2 = 禁止通行
 * cmp byte [player+0x39], 0    ; 烏龜中（days_tortoise_walking）
 * je short … / mov ebx, 4      ; → 组 4 = 烏龜（后写的覆盖，故烏龜优先）
 * … draw([0x48bdd4] + ebx)     ; ★ 帧 + 组
 * ```
 */
function goImageOf(me: { blocking: { stopping: number; tortoiseWalking: number } }): number {
  const group =
    me.blocking.tortoiseWalking !== 0
      ? GO_IMAGE.tortoise
      : me.blocking.stopping !== 0
        ? GO_IMAGE.blocked
        : GO_IMAGE.idle;
  return group + (goBlink ? 1 : 0);
}

/**
 * 翻右上角面板的页 —— 只动**当前玩家**那一份。
 *
 * @source 熱鍵处理 VA 0x004014b1 / 0x004014ee：
 * ```asm
 * mov eax, [0x49910c]                 ; 当前玩家
 * mov cl, byte [eax + 0x48be24]       ; 它的页号
 * dec cl                              ; 或 inc cl
 * mov byte [eax + 0x48be24], cl
 * mov ch, cl ; and ch, 3
 * mov byte [eax + 0x48be24], ch       ; ★ (页 ∓ 1) & 3
 * push 1 / call fcn_00415f69          ; 重画面板
 * ```
 */
function cyclePanelPage(delta: number): void {
  const i = state.currentPlayer;
  const cur = panelPages[i] ?? 0;
  panelPages[i] = (cur + delta + PANEL_PAGE_COUNT) % PANEL_PAGE_COUNT;
  log(`▶ 面板：${PANEL_ROWS[panelPages[i]!]?.join(' / ')}`);
  requestRender();
}

/**
 * 直接把面板切到第 `page` 页 —— **点右上角标签才走这条**。
 *
 * @source VA 0x004182fa：页号 = `y / 70`；**与原页相同就整个分支跳过**
 *   （连确认音都不放），否则放确认音、写 `[player + 0x48be24]`、重画面板。
 */
function setPanelPage(i: number, page: number): void {
  if (panelPages[i] === page) return;
  sound.play('Effect.mkf', SOUND_IDS.TITLE_CLICK);
  panelPages[i] = page;
  log(`▶ 面板：${PANEL_ROWS[page]?.join(' / ')}`);
  requestRender();
}

/**
 * 小地图局部坐标 → 镜头中心（世界坐标，已夹紧）。
 *
 * @source VA 0x00418591：`世界 = 局部 × 93/8`，再逐轴夹到 `[220, 2084]`。
 */
function minimapCenterFromLocal(localX: number, localY: number): { x: number; y: number } {
  return {
    x: clampCameraCenter(minimapToWorld(localX)),
    y: clampCameraCenter(minimapToWorld(localY)),
  };
}

/**
 * 把镜头移到标记点（小地图上那一点）。
 * @source VA 0x00415e70 `fcn_00415e70`：有标记就用标记，否则用当前玩家
 */
function centerOnMarker(): void {
  if (minimapMarker === null) return;
  followPlayer = false;
  camera = characterCamera(minimapMarker.x, minimapMarker.y, camera.view);
}

/**
 * 工具栏按钮。
 *
 * ★ 十一颗的功能**已全部定死**（实机截图 + 熱鍵表闭合验证，
 *   见 docs/original-screens.md 第 0 节与 `TOOLBAR_LABELS`）。
 *   下标与 `TOOLBAR_LABELS` 一致（0 基）。
 *
 * ⚠️ 功能确定 ≠ 屏做好了：还没画的那几屏如实记一条「尚未实现」，
 *   不假装有功能。
 */
function onToolbar(i: number): void {
  const name = TOOLBAR_LABELS[i] ?? `按钮${i}`;
  // ★ 登记的整屏可以先认领工具列上的钮（契约见 ui-screen.ts）
  {
    const env = uiEnv();
    for (const s of SCREENS) {
      if (s.toolbar?.(i, env) === true) return;
    }
  }
  switch (i) {
    case 1: // 遊戲設定
      openOptions('game');
      return;
    case 6: // 個人資產表（T-022）
      openAssets();
      return;
    case 7: // 道具欄（T-024）
      openInventory('tools');
      return;
    case 8: // 卡片欄（T-025）
      openInventory('cards');
      return;
    case 2: // 託管AI
      openAiSettings('game');
      return;
    case 3: // 讀取進度
      openSaveLoad('load', 'game');
      return;
    case 4: // 儲存進度
      openSaveLoad('save', 'game');
      return;
    case 5: // 大地圖 —— 开那扇 400×400 的模态弹窗（跳表 0x417d39 第 5 项）
      openBigMap(uiEnv());
      return;
    case 10: // 股市（T-030）
      openStock();
      return;
    default:
      log(`「${name}」尚未实现`);
  }
}

// ★ 这里原来有一个 `setViewMode()`（把镜头切成「整图取景」）—— 那是**本引擎
//   自己发明的**：原版根本没有这种视角，`HOTKEY.map` / 工具列第 6 颗打开的是
//   一扇 400×400 的**模态弹窗**（窗口过程 `fcn_0040a801` @VA 0x0040a801）。
//   改接 `big-map-screen.ts` 之后它就没人调了，按需求方「不许改良」一并删掉（T-086）。
//   ⚠️ 相关的 `camera.mode === 'map'` 判断（游標平移 / 滚轮缩放 / 拖棋盘）随之
//   成为走不到的分支 —— 见 `docs/deviations/T-086.md`。

/**
 * 转视角。
 *
 * ★ 原版有 **8 个视角**、每步 45°，全局 `[0x499088]`。
 *   建筑精灵各有 8 张图正是为此：图号 = `(8 − (朝向 + 视角)) & 7`。
 */
function rotateView(delta: number): void {
  // ★★ 档位**住在状态里**（原版全局 `[0x499088]`，进存档 `+0x2743`）。
  //   先前只改 `camera.view`，于是旋转过的视角既不会被存档带上、读档也不还原（D-06）。
  //   reducer 负责取模，这里把结果同步到镜头。
  dispatch({ type: 'rotateView', delta });
  camera = { ...camera, view: state.viewRotation };
  log(`▶ 视角 ${camera.view}`);
  requestRender();
  renderPanel();
}

/**
 * 画布跟着窗口走。
 *
 * ⚠️ 这里**不再挂 devicePixelRatio 变换**：画面是先画进 640×480 的舞台、
 *   再整数倍放大贴上来的，缩放只该发生一次。再叠一层 dpr 变换会让
 *   放大倍数变成非整数，像素糊掉——那正是要避免的事。
 *   高 DPI 屏上多出来的物理像素用更大的整数倍吃掉。
 */
function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

// ============================================================
//  侧栏
// ============================================================

const money = (n: number): string => n.toLocaleString('zh-Hant');

function renderPanel(): void {
  metaEl.textContent =
    `${state.year} 年 ${state.month} 月 ${state.day} 日` +
    ` ｜ 物价指数 ${state.priceIndex}` +
    ` ｜ 第 ${state.turnCount + 1} 回合` +
    ` ｜ ${state.phase}`;

  playersEl.replaceChildren(
    ...state.players.map((p) => {
      const el = document.createElement('div');
      el.className = `player${p.index === state.currentPlayer ? ' active' : ''}`;
      const name = CHARACTERS[p.character]?.name ?? `角色${p.character}`;
      const dead = p.whoPlays === 0 ? '（出局）' : '';
      const owned = state.landOwner.filter((v) => v === p.index + 1).length;
      el.innerHTML =
        `<div class="name">${name}${dead}</div>` +
        `<div class="money">现金 ${money(p.cash)} ｜ 存款 ${money(p.moneyInBank)}</div>` +
        `<div class="money">节点 ${p.nodeId} ｜ 手牌 ${p.cards.length} ｜ 地产 ${owned}</div>`;
      return el;
    }),
  );

  renderInteraction();
  renderActions();
}

/**
 * 待决交互面板。
 *
 * ★ 这是「人能不能真的把这局玩下去」的关键：银行、樂透、百貨、拍賣、
 *   保釋、小游戏……每一种 `pending` 都得有地方作答，否则轮到真人就卡住。
 *   控件长什么样由 `interactions.ts` 按 `pending` 翻译，**规则一律不在这边**。
 */
function renderInteraction(): void {
  const pending = state.pending;
  const ui = pending === null ? null : interactionUi(pending, state);
  if (ui === null) {
    interactionEl.replaceChildren();
    interactionEl.hidden = true;
    return;
  }

  interactionEl.hidden = false;
  const head = document.createElement('div');
  head.className = 'itx-title';
  head.textContent = ui.title;
  const detail = document.createElement('div');
  detail.className = 'itx-detail';
  detail.textContent = ui.detail;

  const row = document.createElement('div');
  row.className = 'row';
  for (const [idx, c] of ui.choices.entries()) {
    const el = document.createElement('button');
    el.textContent = c.label;
    el.onclick = () => {
      // 需要填数的选项：**开的是画面上那一个通用填数页**（`dialog.ts` 的
      // `AmountPage`），不是另弹一个输入框。
      //
      // ★ 这里原来用 `window.prompt` —— 那是**第二条数字入口**（原版没有这种东西：
      //   全游戏只有一个填数窗 `fcn_00453544`）。需求方 2026-09-16 第 1 条要的就是
      //   「所有涉及输入数字的都用同一个计算器」，故本抽屉也改走那一页。
      if (c.amount !== undefined) {
        // 抽屉里这一份 `ui` 与棋盘上那一份是**同一次翻译**（同一个 pending、
        // 同一段代码），所以下标一一对应。
        if (currentDialog() === null) {
          log(`▶ ${c.label}：这一屏自己接管输入（不是通用填数页）`);
          return;
        }
        amountPage = { choice: idx, value: AMOUNT_INITIAL };
        dialogHot = null;
        requestRender();
        return;
      }
      log(`▶ ${ui.title}：${c.label}`);
      dispatch(c.action);
    };
    row.append(el);
  }

  interactionEl.replaceChildren(head, detail, row);
}


/** 按当前阶段给出可用操作——「哪些可用」由 phase 决定，不重复实现规则 */
function renderActions(): void {
  const buttons: { label: string; action: Action; enabled: boolean }[] = [
    { label: '开始回合', action: { type: 'startTurn' }, enabled: state.phase === 'turnStart' },
    { label: '掷骰', action: { type: 'rollDice' }, enabled: state.phase === 'awaitingRoll' },
    { label: '走一步', action: { type: 'step' }, enabled: state.phase === 'moving' },
    { label: '结算', action: { type: 'settle' }, enabled: state.phase === 'settling' },
    // ★ 買地/盖房只有**落点**留下的那个交互才能做（引擎也照这个把关），
    //   所以按钮按 pending 的种类亮，不按 phase —— phase 是所有交互共用的
    { label: '买地', action: { type: 'buyLand' }, enabled: state.pending?.kind === 'buyLand' },
    { label: '盖房', action: { type: 'upgradeLand' }, enabled: state.pending?.kind === 'upgradeLand' },
    { label: '放弃', action: { type: 'declineDecision' }, enabled: state.phase === 'awaitingDecision' },
    { label: '结束回合', action: { type: 'endTurn' }, enabled: state.phase === 'turnEnd' },
  ];

  actionsEl.replaceChildren(
    ...buttons.map((b) => {
      const el = document.createElement('button');
      el.textContent = b.label;
      el.disabled = !b.enabled;
      el.onclick = () => {
        log(`▶ ${b.label}`);
        // ★ 掷骰这一颗走 `requestRoll` —— 与 GO 鈕同一条路，预动作也会播
        if (b.action.type === 'rollDice') {
          if (!requestRoll()) scheduleHumanTurn();
        } else dispatch(b.action);
      };
      return el;
    }),
    autoButton(),
    aiToggleButton(),
    ...musicButtons(),
  );
}

/**
 * 让用户自备一个音色库（Q8）。
 *
 * ⚠️ **本项目不分发 `.sf2`**（DEVELOPMENT_PLAN §5.6）：原版配乐是 .mid，
 *   听起来什么样取决于当年那块声卡的波表 —— 想还原就得自己有一份音色库。
 *   没有音色库也照放：`MusicPlayer` 会退回振荡器（旋律/节奏/时值仍然精确）。
 *
 * 桌面版选完会拷进 `<AppData>/soundfont/`，下次自动用；浏览器只在本次有效。
 */
async function chooseSoundFont(): Promise<void> {
  const picked = await pickSoundFont();
  if (picked.error !== null) {
    log(`⚠ 音色庫：${picked.error}`);
    return;
  }
  if (picked.data === null) return; // 用户取消，不算错
  try {
    music.setSoundFont(parseSoundFont(picked.data, picked.name ?? ''));
    log(`♪ 音色庫：${picked.name ?? ''}（${music.usingSoundFont ? '已啟用' : '未啟用'}）`);
  } catch {
    log('⚠ 音色庫解析失敗 —— 這一檔不是 SoundFont 2');
  }
}

/** 启动时把上次装的音色库接回来（桌面版才有） */
async function restoreSoundFont(): Promise<void> {
  const saved = await loadSavedSoundFont();
  if (saved === null) return;
  try {
    music.setSoundFont(parseSoundFont(saved.data, saved.name));
    log(`♪ 音色庫：${saved.name}（上次選的）`);
  } catch {
    log('⚠ 上次的音色庫讀不出來，沿用振盪器');
  }
}

/** 配乐控制：上一首 / 播停 / 下一首 / 音色库 */
function musicButtons(): HTMLButtonElement[] {
  const mk = (label: string, title: string, fn: () => void): HTMLButtonElement => {
    const el = document.createElement('button');
    el.textContent = label;
    el.title = title;
    el.onclick = () => {
      unlockAudio();
      fn();
      renderPanel();
    };
    return el;
  };
  return [
    mk('♪◀', '上一首', () => void playTrack(musicTrack - 1)),
    mk(
      music.playing ? `♪ ${music.current}` : '♪ 播放',
      '配乐开关',
      () => {
        if (music.playing) music.stop();
        else void playTrack(musicTrack);
      },
    ),
    mk('♪▶', '下一首', () => void playTrack(musicTrack + 1)),
    // Q8：原版没有这一颗 —— 它是本重制版新增的**音色库**入口（见 known-deviations）
    mk(
      music.usingSoundFont ? '♪ 音色庫✓' : '♪ 選音色庫',
      '音色庫（.sf2，需自備）：有就用採樣還原音色，沒有就退回振盪器',
      () => void chooseSoundFont(),
    ),
  ];
}

/** 观战开关——调试规则时常常要让电脑停下来 */
function aiToggleButton(): HTMLButtonElement {
  const el = document.createElement('button');
  el.textContent = aiAutoPlay ? '电脑：自动' : '电脑：暂停';
  el.onclick = () => {
    aiAutoPlay = !aiAutoPlay;
    log(aiAutoPlay ? '▶ 电脑接管' : '⏸ 电脑暂停');
    renderPanel();
    scheduleAi();
  };
  return el;
}

/** 一键把当前回合走完——手点八个按钮太慢，不利于快速验证规则 */
function autoButton(): HTMLButtonElement {
  const el = document.createElement('button');
  el.textContent = '自动走完本回合';
  el.onclick = () => {
    for (let guard = 0; guard < 200; guard++) {
      const next = nextAutoAction();
      if (next === null) break;
      state = reduce(state, next, topo);
      history.push(next);
    }
    // 这条调试路径直接 `reduce`、不经记录漏斗 ⇒ 旧轨迹接不上了，作废重起（下一条 action 会重取起点）
    recorder.reset();
    log('▶ 自动走完本回合');
    requestRender();
    renderPanel();
    // ★ 必须把电脑那边重新叫起来。这里是直接改 `state` 的，没走 `dispatch`，
    //   而 `scheduleAi` 一向是 `dispatch` 在末尾调的 —— 漏掉这一句，
    //   人这边一走完，整局就停在下一个电脑玩家身上再也不动了。
    scheduleAi();
  };
  return el;
}

/** 当前阶段下「显然该做的那一步」；需要人决策时返回 null */
function nextAutoAction(): Action | null {
  // ★ 有待决交互就停手 —— 那是要人拿主意的。
  //   先前没这一句：银行、樂透、百貨这些是**落点结算后挂在 turnEnd 上**的，
  //   而 turnEnd 的自动动作是 `endTurn`，`endTurn` 又会把 pending 清掉，
  //   于是「自动走完本回合」一路把柜台全冲过去，玩家一次也没看见。
  if (state.pending !== null) return null;
  switch (state.phase) {
    case 'turnStart':
      return { type: 'startTurn' };
    case 'awaitingRoll':
      return { type: 'rollDice' };
    case 'moving':
      return { type: 'step' };
    case 'settling':
      return { type: 'settle' };
    case 'turnEnd':
      return { type: 'endTurn' };
    // awaitingDecision 需要人来决定，停下
    default:
      return null;
  }
}

// ============================================================
//  屏幕切换
// ============================================================

/**
 * 標題畫面的五个按钮。
 *
 * @source 分派表 VA 0x00402566：
 *   [1] LOAD → `_rich4_ui_load_game`、[2] OPTION → `_rich4_ui_options_entry`，
 *   其余三个把按钮号 post 回主消息循环，由 `ref_00401b78` 那张表接走。
 *
 * ★ **START 与 NEW STAGE 的差别已解开**（先前这里挂着「未解开、两者都接去開局設定」）：
 *   `ref_00401b78` 的 [0] 与 [4] 都落到 `loc_00401cc8`（正常開新局），
 *   只是 [4] 多走一句 `loc_00401cbf`：
 *   ```asm
 *   loc_00401cbf  mov word [0x4991b6], 1   ; ★ 舞台 = 1
 *   loc_00401cc8  ... call _rich4_init_new_game
 *   ```
 *   而 `[0x4991b6]` 正是**舞台**（`loc_00406ff6` 用它取竖栏整图 `舞台×20+1`、
 *   也用它选 `0x475208` 那张 `[舞台*4 + 地图]` 的资源表）。
 *   所以 NEW STAGE = 新開一局、但用**第二个舞台的四张新地图**。
 */
function onTitleButton(id: 'start' | 'load' | 'option' | 'exit' | 'newStage'): void {
  switch (id) {
    case 'start':
    case 'newStage':
      screen = 'setup';
      // ★ 原版从標題进来是「新遊戲」（`_rich4_init_new_game`），
      //   进去就把 12 个角色状态与 6 条设定全部清回默认 @source `VA 0x00406f27` 起。
      //   调试用的地址栏参数走的是 `?screen=game` 那条路，不经过这一屏。
      //
      //   NEW STAGE 带进来的是**舞台 1**（`[0x4991b6] = 1`），START 是舞台 0。
      setup = defaultSetup(id === 'newStage' ? 1 : 0);
      setupSceneFor = -1;
      setupOutroAt = null;
      loadSetupScene(setup.mapId);
      requestRender();
      break;
    case 'load':
      openSaveLoad('load', 'title');
      break;
    case 'option':
      openOptions('title');
      break;
    case 'exit':
      log('⚠ 離開：桌面版可直接关窗');
      break;
  }
}

/**
 * 讓用户挑一个原版存档文件（T-054）。
 *
 * ★ 用 `<input type=file>` 而不是 Tauri 的对话框：浏览器与桌面 webview
 *   都能用，一条路两边跑 —— 这屏是唯一需要它的地方，不值得为它分叉。
 */
function pickSaveFile(): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.DAT,.dat,.BIN,.bin';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f === undefined) {
        resolve(null);
        return;
      }
      void f
        .arrayBuffer()
        .then((b) => resolve(new Uint8Array(b)))
        .catch(() => resolve(null));
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/**
 * 匯入原版存档（T-054）：读字节 → `parseSave` → `importOriginalSave` → 顶替当前局面。
 *
 * ★ 还原不了的字段由 core 列进 `gaps`，这里**如实报出来** —— 不静默补零。
 *   ⚠️ 卡片写「弹窗告知」，这里走的是屏幕上的日志（本引擎的对话框是给
 *   游戏内交互用的，为此分叉不值当）；缺口内容一字不改。
 */
async function importOriginalSaveFile(): Promise<void> {
  const bytes = await pickSaveFile();
  if (bytes === null) return;
  try {
    const save = parseSave(bytes);
    // 传进去的只是**退路**：导入器自己会解析存档自带的地图块（那里才有实时归属，
    // 而且未必等于安装目录里那一张 —— 实测 Save0 的块是 55 块地的「底特律」）。
    const archiveMap = parseMap(readMapData(archives, save.gameMap));
    // ★ 用**带快照**的那一支：原版读档后時光機照常能用，只导当前局面的话
    //   四个快照槽会全是 null ⇒ 時光機空转（且不消耗道具）。
    const imported = importOriginalSaveWithSnapshots(bytes, archiveMap);
    // ★ 用**导入器实际用的那张图**换画面：否则会「状态按存档那块、画面按安装目录」。
    loadState(imported.state, imported.map);
    const gaps = imported.gaps;
    const lines = formatGaps(gaps);
    log(
      lines.length === 0
        ? '▶ 已匯入原版存檔（無缺口）'
        : `⚠ 已匯入原版存檔；下列欄位用預設值頂上 —— ${lines.join('；')}`,
    );
  } catch (e) {
    log(`⚠ 匯入原版存檔失敗：${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * 拉幕收尾 —— 真的进棋盘。
 *
 * 两条触发路径都与原版一致：
 * - 自动：最后一名小人走出画面（画的时候发现 blit 没画上）；
 * - 手动：拉幕期间**按键或再点一下** `@source loc_00405f6a`（0x100 / 0x202 / 0x205）。
 */
function finishSetupOutro(): void {
  if (setupOutroAt === null) return;
  setupOutroAt = null;
  startGame();
}

/** 按当前設定开一局 */
function startGame(): void {
  // 联机：开局参数（种子、座位）由服务器下发，这里只是「请房主开局」
  if (net !== null) {
    net.start();
    return;
  }
  const players = Array.from({ length: setup.playerCount }, (_, i) => ({
    character: setup.characters[i] ?? i,
    kind: (setup.human[i] ?? false ? 'human' : 'computer') as 'human' | 'computer',
  }));
  const seed = (Date.now() & 0x7fffffff) >>> 0;

  // ★ 開新局的配乐 @source `new_game.asm:4009` `push 0x8001 / call fcn_004549cf`
  //   ⇒ 掩掉 `0x8000` 旗标得 id 1 → `MIDI02.MID` → `midi02.mid`（见 `SCREEN_BGM.newGame`）
  void playTrackFile('midi02.mid');

  map = parseMap(readMapData(archives, setup.mapId));
  topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials, landscapes: map.landscapes };
  state = newGame({
    map,
    globalMapId: setup.mapId,
    players,
    seed,
    // ★ 開局屏那五条直接决定规则：资金档位（`[0x46cb40]`）、
    //   自带载具（`[0x46cb44]`）、土地權限（`[0x46cb48]`）、
    //   遊戲時間与勝利條件（`[0x46cb4c]`/`[0x46cb50]` → `[0x49911c]`/`[0x499108]`）
    // @source `VA 0x00407032`（资金）、`0x00407219`（载具）、`0x00406f6b`（权限）、
    //   `0x0040737d..0x004073a3`（勝負條件）
    initialFund: MONEY_VALUES[setup.money] ?? DEFAULT_INITIAL_FUND,
    // ★ 开局日期 = **系统当天**钳到 1998-01-01..2010-01-01
    //   @source `_rich4_read_config`（VA 0x00411e8f）用 `libc_getdate()` 覆盖
    //   `CFG+8` 的 day/month/year；钳位常量见 VA 0x00411f30 / 0x00411f49。
    //   core 不许读真实时间（C-DET-2），所以真实时间在这一层注入。
    startDate: defaultStartDate(new Date()),
    startingVehicle: setup.vehicle,
    landTenure: setup.land,
    winConditions: winConditionsOf(setup.money, setup.time, setup.victory),
  });
  history.length = 0;
  recorder.reset();
  // ★ 换局：把上一局「这一刻在播」的影片全收掉。从游戏内菜单走「重新遊戲」时
  //   （`startGame` 会被直接调到），旧局的影片时间轴还挂着 —— 不清的话新棋盘上
  //   会盖着旧局的片子，棋盘还会拿旧局的 before 快照当底（`deferred-board.ts`）。
  buildFx = null;
  pendingBuildFx = null;
  buildFlicPending.clear();
  releaseBuildFlics();
  boardFilm = null;
  pendingBoardFilm = null;
  // 「狗咬 → 救护车」那一段的排队也要一起清（同一条理由：旧局的片子不该接着放）
  pendingBoardFilmAfter = null;
  boardFilmPending.clear();
  releaseBoardFilmFlics();
  deferredBoardBefore = null;
  // GO 鈕的位置回到静态初值（原版 `[0x475284]/[0x475288]` 不存档，重开一盘就复位）
  goButton.reset();

  const first = map.nodes[state.players[0]?.nodeId ?? 1];
  camera = characterCamera(first?.x ?? 0, first?.y ?? 0, state.viewRotation);
  hoverNode = null;
  // ★ 開局先播跳伞过场（T-048）：纯表现、可跳过，之后才进棋盘
  introStartedAt = performance.now();
  introSkipped = false;
  introSoundPlayed = false;
  screen = 'intro';
  // ★ 背景曲从**片头过场里**就起了 @source `0x00415963 push 1 / call sub_00454d91` ⇒ 第一首 = RICH08
  //   （設定屏那首 MIDI02 在設定屏收掉时就停了：`sub_00401543 → sub_00454edc`）
  holidayBgmDays = 0; // @source 0x00401dc4 新开一局清零
  playBoardBgm(1);
  // ★★ `Speaking.mkf` 在**进棋盘这一刻**就开始拉（57 MB）。
  //   此前只有「真的要说话」那一条路会拉它（`playSoundFor` / `voice-sink`），
  //   于是**第一句**——棋盘上的角色台词、樂透投注屏的招呼、開獎屏的主持人——
  //   在档案到货前被 `SoundPlayer.play` 安静丢掉（试玩 3 第 7/8 条：
  //   「进樂透页听不到猫女的语音」「整体感觉语音没怎么触发」）。
  //   棋盘一局是分钟级的，这里提前拉完，后面每一句都在。
  ensureSpeakingArchive();
  // ★ 開局宣言（事件 26）—— **不走任何 action**，故 `playSoundFor` 永远看不到它：
  //   原版那一句在 `fcn_00407842` 里（`@source 0x00407946`，全 exe 唯一一处），
  //   `callers 0x407842` 只有 `0x40cff0` / `0x41da2d` 两处，都是**开/重开一局**，
  //   且都在模态消息框之后、棋盘打开之前。这里在开局的同一个点显式播一次。
  //   台词与語音号：`SPEECH_LINES[角色][26]` / `speechIndex(角色, 26)`。
  if (speechQueue.push(openingSpeech(state), performance.now()) > 0) requestRender();
  log(
    `開局：地圖 ${setup.mapId}　種子 ${seed}　` +
      players.map((p, i) => `P${i + 1}${p.kind === 'human' ? '人' : '電'}`).join(' '),
  );

  // 换地图要重新解底图
  setGround(null);
  void loadGround(archives, setup.mapId, hdSource).then((g) => {
    ground = g;
    if (g !== null) log(`底圖載入：${g.width}×${g.height}（G 鍵開關）`);
    requestRender();
  });
  loadMinimapAssets(setup.mapId);

  requestRender();
  renderPanel();
  scheduleAi();
  scheduleHumanTurn();
}

// ============================================================
//  输入
// ============================================================

function bindInput(): void {
  canvas.addEventListener('mousemove', (e) => {
    const p = eventToStage(e);
    if (p === null) return;

    // ── 名牌浮标：鼠标一动就擦（原版 0x200 那一支 `loc_00418b63` → `fcn_00417c67`）──
    if (nodeTip !== null) {
      nodeTip = null;
      requestRender();
    }

    // ── 登记的整屏（契约见 ui-screen.ts）先接管鼠标 ──
    {
      const overlay = activeUiScreen();
      if (overlay !== null) {
        overlay.move?.(p.x, p.y, uiEnv());
        return;
      }
    }

    // ── 遙控骰子的点数盘（Q-PICK-2）：模态，盖在棋盘上 ──
    //   @source `fcn_00446774` 的 WM_MOUSEMOVE（0x200）：只有**悬停**，
    //   六个钮都没中也只是把高亮清掉（原版 `[0x48c598] = 0`）。
    if (dicePick !== null) {
      const face = hitDiceFace(p.x, p.y);
      const next = face === 0 ? null : face;
      if (next !== dicePick.hover) {
        dicePick = { hover: next };
        requestRender();
      }
      return;
    }

    // ── 股市屏：悬停整行（原版 0x200 那条路）@source loc_0042abbb ──
    if (screen === 'stock') {
      if (stockAmount !== null) return; // 填数页开着：不理会行的悬停
      const row = hitStockRow(p.x, p.y);
      if (row !== stockHover) {
        stockHover = row;
        requestRender();
      }
      return;
    }

    // ── 銀行 ATM（Q-BANK-1）──
    // ★ `0x200`（`loc_00437904`）**不是悬停高亮**：只有「正按着金额栏」（`[0x48c40b] == 4`）
    //   时，才把这次移动当成一次点击重发给自己 —— 也就是拖进度条。
    if (atm !== null) {
      if (atmDragToClick(atmCode) !== null) {
        const q = eventToStage(e);
        if (q !== null) atmSeekTo(q.x);
      }
      return;
    }

    // ── 目标拾取（T-026 + Q-PICK-1）：先判贴边，再判悬停 @source VA 0x44609b ──
    if (screen === 'game' && pick !== null) {
      // ★ 贴边推镜头：选择参数的 bit7 开着才有（飛彈 / 核子飛彈）
      //   @source `loc_0044609b` 的 `test byte [0x48c594], 0x80`
      const classes = pickClasses(pick.param);
      // ★ 坐标口径：`p` 是**舞台**坐标（640×480）；棋盘窗口的 client 原点在
      //   `LAYOUT.board`，所以 `p − LAYOUT.board` 正好是原版那对
      //   `LOWORD(lParam)` / `HIWORD(lParam) − 0x28`（`0x28` = 舞台 y 偏移 40，
      //   见 `PICK_BOARD_OFFSET_Y`）。⇒ 这里**不要再减一次** y 偏移。
      const edge = pickEdgeOf(
        p.x - LAYOUT.board.x,
        p.y - LAYOUT.board.y,
        (classes & PICK_CLASS.edgeScroll) !== 0,
      );
      if (edge !== pickEdge) {
        pickEdge = edge;
        if (edge === PICK_EDGE.none) {
          stopPickEdgeScroll();
        } else {
          // @source `SetTimer(hwnd, id, 0x32, 0)` —— 第一次的步长是 8
          pickEdgeStep = PICK_SCROLL_STEP_MIN;
          if (pickEdgeTimer === null) {
            pickEdgeTimer = window.setInterval(tickPickEdgeScroll, PICK_SCROLL_TICK_MS);
          }
        }
        refreshPickCursor();
      }
      // ★ 贴边中**跳过悬停判定**（原版 `[0x48c564] != 0` 直接返回）
      if (pickEdge !== PICK_EDGE.none) return;

      const next = hitCandidate(
        pick,
        p.x - LAYOUT.board.x,
        p.y - LAYOUT.board.y,
        (wx, wy) => worldToScreen(wx, wy, camera, { w: LAYOUT.board.w, h: LAYOUT.board.h }),
      );
      if (next !== pickHover) {
        pickHover = next;
        refreshPickCursor();
      }
      return;
    }

    if (screen === 'title') {
      const hit = hitTitle(p.x, p.y, (i) => spriteNow('Data.mkf', TITLE_RESOURCE, i, true));
      const next = hit === null ? null : hit.index;
      if (next !== titleHot) {
        titleHot = next;
        // 標題的悬停音 —— 只在**从一个按钮移到另一个**时响（原版同：hover 变了才播）
        // @source rich4_ui_main.asm 的 WM_MOUSEMOVE：`play_sound_effect(0x48231a, 0)`
        if (next !== null) sound.play('Effect.mkf', SOUND_IDS.TITLE_HOVER);
        requestRender();
      }
      return;
    }
    if (screen === 'setup') {
      // ★ 拉幕中忽略悬停 —— 原版状态 2 的分派表里没有 0x200（WM_MOUSEMOVE）
      if (setupOutroAt !== null) return;
      // ★ 悬停音只在**移到一个还没被人选走**的角色上时响一次
      //   @source `VA 0x004051e0`：`cmp byte [该角色状态], 0 / jne` 才 `play_sound_effect`
      const before = setup.hover;
      const next = setupMove(setup, p.x, p.y);
      if (next !== setup) {
        setup = next;
        if (next.hover >= 0 && next.hover !== before && !next.characters.includes(next.hover)) {
          sound.play('Effect.mkf', SOUND_IDS.TITLE_HOVER);
        }
        requestRender();
      }
      return;
    }
    if (screen === 'lobby') {
      const hit = hitLobby(p.x, p.y, {
        isHost: isHostSeat(net?.seat ?? null),
        me: net?.seat ?? null,
        started: lobbyRoom?.started ?? false,
      });
      if (JSON.stringify(hit) !== JSON.stringify(lobbyHot)) {
        lobbyHot = hit;
        requestRender();
      }
      return;
    }
    if (screen === 'aiSettings') {
      // 命中测试用的是**对话框相对坐标**，这里减掉居中偏移
      const hit = hitAiSettings({ x: p.x - AI_ORIGIN.x, y: p.y - AI_ORIGIN.y }, aiDraft ?? [], state.currentPlayer);
      if (JSON.stringify(hit) !== JSON.stringify(aiHot)) {
        aiHot = hit;
        requestRender();
      }
      return;
    }
    if (screen === 'saveload') {
      const hit = hitSaveLoad(saveLoadMode, p.x, p.y);
      if (hit !== saveLoadHot) {
        saveLoadHot = hit;
        requestRender();
      }
      return;
    }
    // ★ 設定屏**没有悬停高亮** —— 原版窗口过程只认 0xf/0x201/0x202/0x203/0x205/0x401，
    //   压根没有 WM_MOUSEMOVE 那条路。所以这里什么都不做。
    if (screen === 'options') {
      // ⚠️ 唯一的例外：通用 YES/NO 框**有** WM_MOUSEMOVE（VA 0x00453745）——
      //   鼠标在哪一半就贴哪一张（左半 = YES、右半 = NO），移出去就贴回素框。
      const sub = optionsSub;
      if (sub !== null && sub.kind === 'yesno') {
        const hot = hitYesNo(p.x, p.y);
        if (hot !== sub.hot) {
          optionsSub = { ...sub, hot };
          requestRender();
        }
      }
      return;
    }

    // 右下角小地图那两颗箭头的**悬停**（原版 VA 0x00418415：鼠标在箭头条上就换成高亮图）
    const hotArrow = sidebarView === 'map' && hitSidebar(p.x - LAYOUT.panel.x, p.y - LAYOUT.panel.y)
      ? hitMinimapArrow(p.x - LAYOUT.panel.x, p.y - LAYOUT.panel.y - SIDEBAR.y)
      : null;
    if (hotArrow !== hotMinimapArrow) {
      hotMinimapArrow = hotArrow;
      requestRender();
    }

    // 工具栏的**悬停高亮**（不是按下态）@source VA 0x00418b0a
    //   按钮号 = `x / 40`，x ≥ 440 或 y ≥ 40 就算离开工具栏 → −1。
    //   高亮**换了才响一声**（`play_sound_effect(0x48231a)`），且只在移到按钮上时响，
    //   从按钮移开不响 —— 与標題 / 開局選人那两处是同一条路子。
    const hotToolNow = shopUi === null && sceneFor(state.pending) === null
      ? hitToolbar(p.x - LAYOUT.toolbar.x, p.y - LAYOUT.toolbar.y)
      : null;
    if (hotToolNow !== hotTool) {
      hotTool = hotToolNow;
      if (hotToolNow !== null) sound.play('Effect.mkf', SOUND_IDS.TITLE_HOVER);
      requestRender();
    }

    if (awaitingHumanRoll()) {
      // GO 鈕底下不做棋盘悬停（原版那块是窗口控件，不是棋盘格）
      const on = hitAdvance(p.x - LAYOUT.board.x, p.y - LAYOUT.board.y, goButton.position());
      if (on) return;
    }

    // 商店是整屏的：它在的时候棋盘不在画，光标底下也没有「节点」可悬停
    if (screen === 'game' && shopUi !== null) return;

    // 監獄／醫院保釋屏：整屏，只记光标在哪个槽位上（原版 0x200 那条路）
    if (screen === 'game' && state.pending?.kind === 'bail') {
      const pending = state.pending;
      const next = hitBailSlot(pending.place, p.x, p.y, bailOccupancy());
      if (next !== bailHot) {
        bailHot = next;
        requestRender();
      }
      return;
    }

    // ── 填数页的**金额栏**：鼠标在栏上滑动就改值 ──
    //   @source `loc_00453394`（通用填数窗的 `WM_MOUSEMOVE`，逐像素 id 必须是 0x10）：
    //   不需要按下 —— 原版那条路只看「鼠标此刻在不在栏上」，滑到哪就换算到哪，
    //   每换一次放一声音效 9（`[0x482352]`）。`H` 键是同一支的伪造按下。
    if (amountPage !== null) {
      const barUi = currentDialog();
      const barAmount = barUi?.choices[amountPage.choice]?.amount;
      if (barAmount !== undefined) {
        const next = amountBarDragValue(
          p.x - LAYOUT.board.x,
          p.y - LAYOUT.board.y,
          barAmount.max,
        );
        if (next !== null) {
          amountPage = { ...amountPage, value: next };
          sound.play('Effect.mkf', AMOUNT_BAR_DRAG_SOUND);
          requestRender();
        }
      }
    }

    // 对话框盖在棋盘上：它在的时候，先问它
    const dlgHover = currentDialog();
    if (dlgHover !== null) {
      const h = hitDialog(
        boardCtx, dlgHover, amountPage,
        p.x - LAYOUT.board.x, p.y - LAYOUT.board.y,
      );
      const next = h === null || h === 'inside' ? null : h;
      if (JSON.stringify(next) !== JSON.stringify(dialogHot)) {
        dialogHot = next;
        requestRender();
      }
      if (h !== null) return; // 框上的点不再落到棋盘
    }

    // ★ 人物视角也能拾取。办法不是去解投影表的逆，而是把每个节点
    //   **正向投一遍**再比屏幕距离（见 render.ts 的 `pickNodeAt`）——
    //   用的就是绘制时那张表，所以「看得见的就点得到」。
    // ⚠️ 坐标要先减去棋盘区在舞台里的偏移：棋盘不是从 (0,0) 开始的，
    //   它在工具栏下面。
    const bx = p.x - LAYOUT.board.x;
    const by = p.y - LAYOUT.board.y;
    const inBoard = bx >= 0 && by >= 0 && bx < LAYOUT.board.w && by < LAYOUT.board.h;
    const hit = inBoard
      ? pickNodeAt(map, bx, by, camera, { w: LAYOUT.board.w, h: LAYOUT.board.h })
      : null;
    if (hit !== hoverNode) {
      hoverNode = hit;
      requestRender();
    }
  });

  canvas.addEventListener('click', (e) => {
    const p = eventToStage(e);
    if (p === null) return;
    unlockAudio();

    // ── 登记的整屏（契约见 ui-screen.ts）在的时候不碰棋盘 ──
    // ★ 真正的事件已经在 `mousedown` / `mouseup` 上派过了（`down` = 按下、`up` = 抬手，
    //   与契约和原版的 WM_LBUTTONDOWN/UP 一致）。浏览器的 `click` 排在 `mouseup` **之后**，
    //   所以这里**绝不能**再派一次 —— 早先那版把 `down` 挂在这一路，导致 `up` 比 `down` 先到，
    //   屏幕的「按下记账、抬手成立」整条时序是反的（T-033 在真浏览器里抓到的）。
    if (activeUiScreen() !== null) return;
    if (screen === 'intro') {
      introSkipped = true;
      requestRender();
      return;
    }
    if (screen === 'title') {
      const hit = hitTitle(p.x, p.y, (i) => spriteNow('Data.mkf', TITLE_RESOURCE, i, true));
      if (hit !== null) {
        // 標題的确认音 @source rich4_ui_main.asm 的 WM_LBUTTONDOWN：
        //   `play_sound_effect(0x482322, 0)`
        sound.play('Effect.mkf', SOUND_IDS.TITLE_CLICK);
        onTitleButton(hit.id);
      }
      return;
    }
    // ── 登记的整屏在的时候，`click` 这一路不碰棋盘（同商店那条注释的道理：
    //   按下的处理已经在 mousedown/mouseup 上做过了，这里再来一次就成两遍）──
    if (activeUiScreen() !== null) return;
    if (screen === 'aiSettings') {
      const hit = hitAiSettings({ x: p.x - AI_ORIGIN.x, y: p.y - AI_ORIGIN.y }, aiDraft ?? [], state.currentPlayer);
      if (hit === null) return;
      if (hit.kind === 'ok') {
        closeAiSettings(true);
        return;
      }
      if (hit.kind === 'cancel') {
        closeAiSettings(false);
        return;
      }
      // 其余都是改草稿；改完重画，还没进引擎（按「確定」才发 action）
      if (aiDraft !== null) {
        aiDraft = applyAiSettingsHit(aiDraft, hit);
        requestRender();
      }
      return;
    }
    if (screen === 'lobby') {
      const hit = hitLobby(p.x, p.y, {
        isHost: isHostSeat(net?.seat ?? null),
        me: net?.seat ?? null,
        started: lobbyRoom?.started ?? false,
      });
      if (hit === null) return;
      // 座位只读（座位是服务器分的，见 Q-NET-2），点它不做事
      if (hit.kind === 'seat') return;
      // ★ Q-NET-2：改角色 / 换地图都只是**发请求** —— 本地一个字都不改，
      //   等服务器校验后广播 `room` 回来才更新（撞车/非房主/已开局都会被拒）。
      if (hit.kind === 'character') {
        net?.setCharacter(hit.character);
        return;
      }
      if (hit.kind === 'map') {
        net?.setMap(hit.globalMapId);
        return;
      }
      if (hit.kind === 'start') {
        net?.start();
        return;
      }
      // 离开：断开并回標題
      leaveLobby();
      return;
    }
    if (screen === 'saveload') {
      // 「匯入原版存檔」钮（T-054）—— 先问它，再问行
      if (hitImport(saveLoadMode, p.x, p.y)) {
        void importOriginalSaveFile();
        return;
      }
      const row = hitSaveLoad(saveLoadMode, p.x, p.y);
      if (row !== null) onSaveLoadRow(row);
      // ★ 点在屏外就退出 —— 原版有取消钮，那颗还没认出来
      else if (outsideSaveLoad(saveLoadMode, p.x, p.y)) closeSaveLoad();
      return;
    }
    // 設定屏、開局設定屏全在 mousedown / mouseup 上处理（原版 0x201 / 0x202 两条分支），
    //   `click` 这一路不碰它们 —— 否则同一次点会被处理两遍。
    if (screen === 'options' || screen === 'setup') return;

    // 商店全在 mousedown / mouseup 上处理（原版 0x201 / 0x202 两条分支），
    //   `click` 这一路不碰它 —— 否则同一次点会被处理两遍。
    if (screen === 'game' && shopUi !== null) return;
    // 監獄／醫院保釋屏同理：整屏接管，别让同一次点再落到通用对话框上
    if (screen === 'game' && state.pending?.kind === 'bail') return;

    // 底下都是棋盘上的交互 —— 其余屏（含個人資產表）到这儿就结束
    if (screen !== 'game') return;
    if (pick !== null) return; // 拾取模式：选中/放弃都走 mouseup 与右键
    // 遙控骰子的点数盘开着：模态，点击已经在 mousedown 里处理过（Q-PICK-2）
    if (dicePick !== null) return;

    // ★ GO 鈕与骰子数切换**不在这里** —— 它们归 `mousedown`（原版是
    //   `WM_LBUTTONDOWN` 那一拍），见 mousedown 里的同名分支。
    //   挂在 `click` 上会让按下/抬手的次序反过来（`click` 在 `mouseup` 之后）。

    // 对话框在的时候，棋盘上的点击一律先给它
    const dlg = currentDialog();
    if (dlg !== null) {
      const h = hitDialog(
        boardCtx, dlg, amountPage,
        p.x - LAYOUT.board.x, p.y - LAYOUT.board.y,
      );
      if (h !== null) {
        if (h !== 'inside') onDialogHit(dlg, h);
        return; // ★ 落在框上但没中按钮也要吃掉，别穿透到棋盘去选格子
      }
    }

    // ★ 先前这里会 `log('节点 N「名字」')` —— 那是占位。原版点棋盘格的反馈
    //   就是一块名牌浮标，它归 `mousedown` 那一拍（Q-HOVER-1），见上面那段。
    // 岔路选择：只有引擎正处于等待方向时才有意义
  });

  // ★ 原先这里挂了一个**滚轮缩放**。原版**没有缩放** —— 人物视角的取景由投影表
  //   定死（只能左右旋转视角），那是本引擎自己发明的，随 `setViewMode` 一起删掉
  //   （D-086-5 / T-086）。滚轮在棋盘上现在什么都不做（也不拦浏览器默认行为）。

  canvas.addEventListener('mousedown', (e) => {
    unlockAudio(); // 浏览器要求在用户手势里建 AudioContext

    // ── 登记的整屏（契约见 ui-screen.ts）：按下这一拍派 `down` ──
    // ★ 原版对应的就是 `WM_LBUTTONDOWN`；`mouseup`（= `WM_LBUTTONUP`）派 `up`。
    //   两者**必须**分派在真的按下/抬手事件上 —— 见 `click` 那一路的注释。
    // ★ 屏在的时候**右键这一拍也要吞掉**：原版模态窗的 `WM_RBUTTONDOWN` 走
    //   `DefWindowProc`，漏给棋盘就会点到 GO 钮（掷骰！）、换侧栏页、在工具列
    //   记下按下号 —— 大地圖彈窗开着时原版一件都不做。
    {
      const overlay = activeUiScreen();
      if (overlay !== null) {
        if (e.button === 0) {
          const q = eventToStage(e);
          if (q !== null) overlay.down?.(q.x, q.y, uiEnv());
        }
        return;
      }
    }

    // ── 遙控骰子的点数盘（Q-PICK-2）：模态期间只有它能收鼠标 ──
    //   按下这一拍**只吞掉**（原版 0x201 只记高亮），选中的那一下在**抬手**
    //   （0x202 = `loc_00446a2c`）；右键的取消走 `contextmenu` 那一路。
    if (dicePick !== null) return;

    // ── 設定屏（原版 0x201）──
    // 每颗控件的**立即动作**都在按下这一刻发生（改值 / 换曲 / 亮灯 / 贴按下图），
    // 只有「取消、確定、右上角三颗」要等抬手。声音也全在按下放。
    if (screen === 'options') {
      if (e.button !== 0) return;
      const q = eventToStage(e);
      if (q === null) return;
      onOptionsDown(q.x, q.y);
      return;
    }

    // ── 開局設定屏（原版 0x201）──
    // ★ 角色格与地图行是**按下就生效**；两颗按钮与六条下拉只记下按下状态，
    //   抬手（0x202）才成立。原版就是这样分的 —— `VA 0x004052bc` 那条大跳表。
    if (screen === 'setup') {
      // ★ 拉幕中：按下（0x201）什么都不做，**抬手**（0x202）才进棋盘 ——
      //   原版状态 2 的分派表里 0x201 落到 DefWindowProc、0x202 才收尾。
      if (setupOutroAt !== null) return;
      if (e.button !== 0) return;
      const q = eventToStage(e);
      if (q === null) return;
      const before = setup;
      const next = setupDown(setup, q.x, q.y);
      setup = next;
      // 选／取消角色、换地图都放同一颗确认音 @source `VA 0x00405384` / `0x004055c2`
      if (next !== before) {
        if (next.characters.length !== before.characters.length) {
          sound.play('Effect.mkf', SOUND_IDS.TITLE_CLICK);
        } else if (next.mapId !== before.mapId) {
          sound.play('Effect.mkf', SOUND_IDS.TITLE_CLICK);
          loadSetupScene(next.mapId);
        } else if (next.playerCount !== before.playerCount || next.vehicle !== before.vehicle) {
          sound.play('Effect.mkf', SOUND_IDS.TITLE_CLICK);
        }
      }
      requestRender();
      return;
    }

    // ── 股市屏（T-030）──────────────────────────────────────
    if (screen === 'stock') {
      // ★★ 填数页（计算器）开着时，**任何点击先给它** —— 这一条必须在「休市就退屏」
      //   之前。原版这扇窗是**独立模态窗**（`fcn_00453544`），自己收 0x201/0x202，
      //   与柜台窗开不开市无关；先前把它排在休市那一支**之后**，于是
      //   休市日（或任何 `closedDays` 非 0 的日子）点计算器上任何一颗数字钮
      //   都等于「点了一下股市屏」⇒ 直接 `closeStock()` 退屏
      //   （试玩 4 报的「鼠标点计算器的数字按钮没反应」）。
      if (stockAmount !== null) {
        const q0 = eventToStage(e);
        if (import.meta.env.DEV) {
          __devHits.push({ q0, cx: e.clientX, cy: e.clientY, box: boardCtx.canvas.getBoundingClientRect().width });
        }
        if (q0 === null) return;
        const ui0 = stockAmountUi();
        if (ui0 !== null) {
          const h0 = hitDialog(boardCtx, ui0, amountPage, q0.x - LAYOUT.board.x, q0.y - LAYOUT.board.y);
          if (import.meta.env.DEV) __devHits.push({ hit: h0 });
          if (h0 !== null && h0 !== 'inside') onDialogHit(ui0, h0);
          if (amountPage === null) stockAmount = null; // 確定/取消都会关掉它
          requestRender();
        }
        return;
      }
      // ★ 休市那一支原版走的是**訊息框**窗口过程：任何一下鼠标都退屏
      //   （@source `fcn_0042b2ec` 的 0x202/0x205 两路都 `Post_0402_Message(0)`）
      //   —— 所以休市日既看不到行情，也不可能交易。
      if (stockCounterClosed(state)) {
        if (e.button === 0 || e.button === 2) {
          // ★ 选股模式碰上休市：原版这一支走訊息框，任何一下鼠标都 `Post(0)`
          //   抛回 0 ⇒ 卡不消耗、卡片欄被开回来（且不播取消音）
          if (stockPick !== null) cancelStockPick(false);
          else closeStock();
        }
        return;
      }
      // 详情卡开着：左键或右键都直接退卡 @source `loc_0042aa08`
      if (stockDetail !== null) {
        if (e.button === 0 || e.button === 2) closeStockDetail();
        return;
      }
      if (e.button !== 0) return; // 右键走 contextmenu（换页 / 离开）
      // ★ 选股模式（Q-PICK-2）：整屏只干「点一行 → 把行号抛回去」。
      //   买卖/换页/详情那一套在这一模式下都够不着 —— 原版点中一行就当场
      //   `Post_0402_Message` 抛回、窗口随即消失（`loc_0042b0da`）。
      if (stockPick !== null) {
        const pq = eventToStage(e);
        if (pq === null) return;
        const prow = hitStockRow(pq.x, pq.y);
        if (prow !== null) stockPickChoose(prow);
        return;
      }
      const q = eventToStage(e);
      if (q === null) return;
      const plate = hitStockPlate(q.x, q.y);
      if (plate !== null) {
        log('▶ 股市：' + ['換頁', '買進', '賣出', '上市公司資訊', '離開'][plate]);
        if (plate === STOCK_PLATE_PAGE) {
          // @source `loc_0042aec4`：换页并把选中清掉
          stockPage = stockPage === 0 ? 1 : 0;
          stockSel = null;
          requestRender();
        } else if (plate === STOCK_PLATE_BUY) {
          stockTrade('buy');
        } else if (plate === STOCK_PLATE_SELL) {
          stockTrade('sell');
        } else if (plate === STOCK_PLATE_INFO) {
          // @source `loc_0042b0b7`：没选行就什么都不做，选了就开那张卡
          if (stockSel !== null) openStockDetail(stockSel);
        } else if (plate === STOCK_PLATE_EXIT) {
          closeStock();
        }
        return;
      }
      const row = hitStockRow(q.x, q.y);
      if (row !== null) stockPickRow(row);
      return;
    }

    // ── 銀行貸款屏（T-029b/T-029c）：四颗钮在**舞台坐标**上 @source loc_00435c12 ──
    const loanNow = bankPending();
    if (e.button === 0 && loanNow !== null && atm === null && amountPage === null) {
      const q = eventToStage(e);
      if (q === null) return;
      // ★ 董事長室左侧那**三颗小钮**先接（Q-BANK-1a）—— 它们是原版**另一个窗口**
      //   `fcn_00434492` 的控件（表 `0x475818`），与主屏那四颗（`0x4757f8`）不在一张表上。
      //   先前只画了图、没有命中框 ⇒ 「週轉現金／歸還款項」点了没反应、
      //   **歸還款項这条路整个走不到**（`repaySpecial` 早就实现了）。
      if (loanNow.chairman) {
        const fb = hitFinanceButton(q.x, q.y);
        if (fb !== null) {
          // ★ 週轉現金被冻结挡住 @source `loc_00434c51`：
          //   `cmp byte [player+0x3c], 0 / jne 清 [0x48c3cf] 并返回` ——
          //   这一下**什么都不做**（不挂气泡、不改状态，只是那颗钮上盖着禁止章）。
          if (fb === FINANCE_BORROW && bankFrozen()) return;
          const pend0 = state.pending;
          // 前置判据照原版：`owed < 額度` 才可週轉（`loc_00434dfb` 的 `jge`）、
          // `owed != 0` 才可歸還（`loc_00434e98` 的 `je`）。
          const owed = pend0?.kind === 'bank' ? pend0.specialFinance?.owed ?? 0 : 0;
          const room = pend0?.kind === 'bank' ? pend0.specialFinance?.available ?? 0 : 0;
          loanSend({ kind: 'finance', btn: fb, canBorrow: room > 0, canRepay: owed !== 0 });
          requestRender();
          return;
        }
      }
      // ★ 子对话框开着时，主屏那四颗**一概不响应** —— 原版那是一扇模态窗
      //   （`Wait_0402_Message`），主窗口收不到鼠标；而且此刻屏上画的是办公室，
      //   四颗钮的矩形落在看不见的地方。
      if (loanUi?.financeOpen === true) return;
      const btn = hitLoanButton(q.x, q.y);
      if (btn === null) return;
      // ★ Q-BANK-1：**不再直接开填数页** —— 原版先走 `fcn_00435062` 的状态机
      //   （滑入表单 + 店員一句话），填数页是气泡说完那一刻 `PostMessage(0x409/0x40a)`
      //   才开的（见 `bank-dynamic.ts` 的 `loanStep`）。
      const pend = state.pending;
      const overLimit = pend?.kind === 'bank' ? pend.loanCapacity <= 0 : false;
      loanSend({
        kind: 'press',
        btn,
        frozen: bankFrozen(),
        hasLoan: loanNow.hasLoan,
        chairman: loanNow.chairman,
        overLimit,
      });
      return;
    }

    // ── 銀行 ATM 面板（T-029a）──
    if (atm !== null) {
      const q = eventToStage(e);
      if (q === null) return;
      const btn = hitAtmButton(q.x, q.y);
      if (btn === null) return;
      // 按下图（`[0x48c40b]` = 钮序号 + 1）@source loc_004371f9
      atmCode = btn + 1;
      atmCodeAt = performance.now();
      // 金额栏（序号 3）：按住就按位置换算金额，之后再拖动由 `mousemove` 接
      // @source loc_00437413
      if (btn === 3) {
        atmSeekTo(q.x);
        return;
      }
      const next = atmPress(atm, btn, bankFrozen());
      if (next === null) {
        closeAtm(); // EXIT
        requestRender();
        return;
      }
      if (btn === 17) {
        // ↵ 確認：金额定了才发得出去（0 = 没做这件事，原版也直接退回来）
        atmConfirm();
        return;
      }
      atm = next;
      requestRender();
      return;
    }

    // ── 道具欄浮窗（T-024）──
    // 按下只**记下选中项 + 放确认音**，抬手才用出去（VA 0x445c8f / 0x445d84）。
    if (screen === 'inventory') {
      const q = eventToStage(e);
      if (q === null) return;
      const slot = hitInventory(q.x, q.y);
      if (slot === null) return;
      // ★ 按**当前这一栏**取表 —— 两栏的格子内容不一样（道具号 vs 卡号），
      //   先前一律查 toolEntries，卡片欄会拿到一个道具号。
      const entries =
        invKind === 'tools'
          ? toolEntries(state, state.currentPlayer)
          : cardEntries(state, state.currentPlayer);
      const hit = entries.find((it) => it.slot === slot);
      if (hit === undefined) return;
      invPicked = hit.id;
      sound.play('Effect.mkf', SOUND_IDS.TITLE_CLICK);
      return;
    }

    // ── 個人資產表屏（T-022）──
    // 按下只**记状态 + 画高亮**，动作全留给抬手（原版 VA 0x424049/0x424163/0x423dd1）。
    if (screen === 'assets') {
      const q = eventToStage(e);
      if (q === null) return;
      // 顶栏页签：原版**按下就换人**（VA 0x424049 里立刻 `[0x48c27c] = 玩家`）
      const tab = hitSheetTab(q.x, q.y, activePlayers(state).length);
      if (tab !== null) {
        const who = activePlayers(state)[tab];
        if (who !== undefined && who !== assetWho) {
          assetWho = who;
          resetSheetPage();
          requestRender();
        }
        return;
      }
      // 视图 1 那 5 个种类格：原版也是**按下就换**（VA 0x423ebb 里立刻
      // `[0x475400] = 种类`，并把分页归零），不分按下/抬起两段。
      const kind = hitSheetKind(q.x, q.y);
      if (kind !== null) {
        // ★ 原版这条分支**不放音效**（VA 0x423eda 里没有 play_sound_effect）。
        if (kind !== sheetUi.kind) {
          sheetUi = { ...sheetUi, kind, pageStart: 0 };
          requestRender();
        }
        return;
      }
      if (hitSheetExit(q.x, q.y)) sheetUi = { ...sheetUi, btn: null, exit: true, arrow: null };
      else {
        const btn = hitSheetBtn(q.x, q.y);
        const arrow = hitSheetArrow(q.x, q.y);
        if (btn !== null) sheetUi = { ...sheetUi, btn, exit: false, arrow: null };
        else if (arrow !== null) sheetUi = { ...sheetUi, btn: null, exit: false, arrow };
      }
      if (sheetUi.btn !== null || sheetUi.exit || sheetUi.arrow !== null) requestRender();
      return;
    }

    if (screen !== 'game') return;
    // ⚠️ 命中判定一律走**舞台坐标**：窗口是整数倍放大且居中的，
    //   直接拿 clientX/clientY 去比 439×40 的工具栏必然对不上。
    const p = eventToStage(e);
    if (p === null) return;

    // 拾取模式是**模态**的（原版那个窗口盖住整屏）—— 棋盘与工具栏都不再接输入
    if (pick !== null) return;

    // ── 卡片商店／道具商店（P2-8 / U-2）──
    // ★ 买与卖是**按下**就发生（原版在 `WM_LBUTTONDOWN` 里直接调买卖函数，
    //   见 `loc_0042e148` 卡片 / `loc_0042e39c` 道具）；两个钮只是记账，动作留给抬手。
    //   命中顺序见 `hitShop`。
    if (shopUi !== null) {
      const ui = shopUi;
      // 气泡还在时，原版只把气泡收掉（`loc_0042de09` 的 `[0x48c318] != 3` 那条分支），
      //   不做别的；正在等道别那句话说完也一样不接输入。
      if (ui.bubble !== null || ui.closing) {
        ui.bubble = null;
        requestRender();
        return;
      }
      const hit = hitShop(p.x, p.y);
      if (hit === null) return;
      if (hit.at === 'switch' || hit.at === 'exit') {
        ui.pressed = hit.at;
        requestRender();
      } else if (hit.at === 'cell') {
        // ★ 卖掉了才把这一格画成「按下凹进去」（原版 `loc_0042e0e4` 只在成交后才调
        //   `fcn_00451b9e`，空槽那条分支直接跳走了）
        if (shopSell(ui.page, hit.slot)) {
          ui.pressedCell = hit.slot;
          requestRender();
        }
      } else {
        shopBuy(ui.page, hit.row, performance.now());
      }
      return;
    }

    // 右上角那四条彩色竖条：**点一下就换页** @source VA 0x004182fa
    // 页号 = `y / 70`；页没变就什么都不做（原版连音效都不放）。
    const tag = hitPanelTag(p.x - LAYOUT.panel.x, p.y - LAYOUT.panel.y);
    if (tag !== null) {
      setPanelPage(state.currentPlayer, tag);
      return;
    }

    const tool = hitToolbar(p.x - LAYOUT.toolbar.x, p.y - LAYOUT.toolbar.y);
    if (tool !== null) {
      pressedTool = tool;
      requestRender();
      return; // 点在工具栏上就不要同时开始拖动地图
    }
    if (hitSidebar(p.x - LAYOUT.panel.x, p.y - LAYOUT.panel.y)) {
      // ★ 右下角那 200×200 —— **日曆那一面也有两颗钮**：太阳/月亮是「日曆 ↔ 月曆」
      //   的切换钮（VA 0x0041838c）。**只有純小地圖那一面（cfg+5 = 1）什么都不接。**
      const lx = p.x - LAYOUT.panel.x;
      const ly = p.y - LAYOUT.panel.y - SIDEBAR.y;
      if (sidebarView !== 'map') {
        const to = hitCalendarToggle(lx, ly);
        if (to !== null) {
          // 已经是这一面 → 什么都不做（原版连音效都不放）
          if (to !== sidebarView) {
            sound.play('Effect.mkf', SOUND_IDS.TITLE_CLICK);
            sidebarView = to;
            requestRender();
          }
          return;
        }
        return;
      }

      const arrow = hitMinimapArrow(lx, ly);
      if (arrow !== null) {
        // 按下先记账 + 亮起来，**松开才转** —— 原版是按下/抬起两段（VA 0x00418415 / 0x004186cb）
        pressedMinimapArrow = arrow;
        requestRender();
        return;
      }
      if (hitMinimapBody(lx, ly)) {
        // 点小地图本体：把光标处的局部坐标换成世界坐标、夹紧，镜头就停在那儿（可继续拖）
        minimapMarker = minimapCenterFromLocal(lx, ly);
        draggingMinimap = true;
        centerOnMarker();
        requestRender();
      }
      return;
    }
    // ★★ GO 鈕（Q-UI-6）：**按下这一拍就掷骰 + 起拖**（原版 VA 0x004181d9 的
    //   `cmp al,0xb` 立刻动作、0x004182c1 的 `cmp al,0xc` 记拖动），抬手只结束拖动。
    //   ⚠️ 这一支**必须在「棋盘拖动」前面**，否则按 GO 会先被当成拖镜头；
    //   也**不能**挂在 `click` 上（先前就是这么接的）：浏览器的 `click` 排在
    //   `mouseup` **之后**，而 `goButton.release()` 在 mouseup 上 ——
    //   先抬手后按下，按钮会卡在「拖动中」跟着鼠标跑。
    if (awaitingHumanRoll()) {
      const me0 = state.players[state.currentPlayer];
      if (me0 !== undefined) {
        const gx = p.x - LAYOUT.board.x;
        const gy = p.y - LAYOUT.board.y;
        inputTrace.stage = [gx, gy];
        inputTrace.diceToggle = null;
        inputTrace.goPressed = false;
        inputTrace.rollRequested = false;
        inputTrace.earlyReturn = 'go-branch';
        // 切换钮盖在 GO 的下缘上，必须先问它（原版也是先判那几颗）
        const n = hitDiceToggle(gx, gy, maxDiceOf(me0), goButton.position());
        inputTrace.diceToggle = n;
        if (n !== null) {
          inputTrace.earlyReturn = 'dice-toggle';
          dispatch({ type: 'setDiceCount', count: n });
          return;
        }
        inputTrace.goPressed = goButton.press(gx, gy, { x: p.x, y: p.y });
        if (inputTrace.goPressed) {
          // 动画正开着 → 这一按没接走，重排驱动（与 `scheduleAi` 那条同一个道理）
          // ★ 重排这一句**不能省**：`requestRoll` 被拒却不重排，这一按就白按、
          //   再没人驱动（`dice-roll.test.ts` 有一条结构断言专门钉它）。
          //   ⚠️ 这一行**必须保持原样**（结构断言按字面钉它）；诊断字段另起一句。
          if (!requestRoll()) scheduleHumanTurn();
          inputTrace.rollRequested = diceFx.active;
          inputTrace.earlyReturn = diceFx.active ? 'rolled' : 'roll-rejected';
          return; // 按在钮上就不再去拖镜头
        }
        inputTrace.earlyReturn = 'go-miss';
      }
    } else {
      inputTrace.stage = [p.x - LAYOUT.board.x, p.y - LAYOUT.board.y];
      inputTrace.earlyReturn = 'not-awaiting-human-roll';
    }

    // 只有棋盘区能拖
    const bx = p.x - LAYOUT.board.x;
    const by = p.y - LAYOUT.board.y;
    if (bx < 0 || by < 0 || bx >= LAYOUT.board.w || by >= LAYOUT.board.h) return;

    // ── 名牌浮标（Q-HOVER-1）────────────────────────────────
    // 原版在棋盘窗口过程的 `WM_LBUTTONDOWN` 那一支里画（VA 0x004186a7）：
    // `x < 0x1b8` 且 `y > 0x28`（= 棋盘格内、工具栏之下）就查光标底下是什么，
    // 命中就放一声 `0x482322`（音效 1）并弹一块 `Data.mkf` 517 的名牌。
    // ★ 弹在**这一拍**，不是 `click` —— 浏览器 `click` 排在 `mouseup` 之后，
    //   而原版抬手那一下就把名牌擦了（`loc_00418878` → `fcn_00417c67`）。
    // ★ 整屏/模态（訊息框、过场、保釋、拾取）盖着棋盘时不弹。
    if (
      by > 0 &&
      currentDialog() === null &&
      sceneFor(state.pending) === null &&
      state.pending?.kind !== 'bail'
    ) {
      const m = tipModel(map, state, bx, by, (wx, wy) =>
        worldToScreen(wx, wy, camera, { w: LAYOUT.board.w, h: LAYOUT.board.h }),
      );
      if (m !== null) {
        sound.play('Effect.mkf', SOUND_IDS.TITLE_CLICK); // @source VA 0x004175c4
        nodeTip = m;
        requestRender();
      }
    }

  });
  window.addEventListener('mouseup', (e) => {
    // 名牌浮标：抬手就擦（原版 `loc_00418878` → `fcn_00417c67` 把底图贴回去）
    if (nodeTip !== null) {
      nodeTip = null;
      requestRender();
    }
    // ── 登记的整屏（契约见 ui-screen.ts）先接管鼠标 ──
    {
      const overlay = activeUiScreen();
      if (overlay !== null) {
        const q = eventToStage(e);
        if (q !== null) overlay.up?.(q.x, q.y, uiEnv());
        return;
      }
    }
    // ── 銀行两屏（T-029c）：抬手才收尾 ──
    //   · 貸款屏 EXIT：`loc_00435ea2`（0x202）—— 按下只记 `[0x48c3e1]`，
    //     抬手的 **那一下**才出「謝謝您的惠顧」并把状态推到 0xb。
    //   · ATM：抬手才分发（`loc_0043762d`）—— 本引擎鼠标那一路仍在按下动作，
    //     这里只把按下图收掉（键盘那一路走的是原版那套「假抬手」，见 `atmKey`）。
    if (atm !== null) {
      atmCode = null;
      requestRender();
      return;
    }
    if (loanUi !== null && amountPage === null) {
      loanSend({ kind: 'release' });
      requestRender();
      return;
    }
    // ── 遙控骰子的点数盘（Q-PICK-2）：**抬手**才认 ──
    //   @source `fcn_00446774` 的 0x202 分支（`loc_00446a2c`）：`[0x48c598] != 0`
    //   就播确认音并把那一颗抛回去；右键的取消在 `contextmenu` 那一路。
    if (dicePick !== null) {
      if (e.button !== 0) return;
      const q = eventToStage(e);
      if (q !== null) dicePickChoose(hitDiceFace(q.x, q.y));
      return;
    }
    // ── 開局設定屏：抬手才收尾（原版 0x202）──
    // ★ 只认按下那一刻记下的控件号，不看抬手时光标在哪（原版就是这么写的）。
    if (screen === 'setup') {
      // ★ 拉幕中：**再点一下**就直接进棋盘（原版状态 2 的 0x202 / 0x205）
      if (setupOutroAt !== null) {
        finishSetupOutro();
        return;
      }
      const pressed = setup.pressed;
      const next = setupUp(setup);
      // ★ 先把按下状态清掉 —— 不然「一个座位都没选就按 OK」会把按钮卡在按下图
      setup = next;
      if (pressed === 1) {
        // `OK` —— 原版至少要有一个真人座位才认，剩下的由电脑补满
        // @source `VA 0x00405771` 的 `cmp byte [0x48a40d], 0 / je`
        if (next.characters.length > 0) {
          sound.play('Effect.mkf', SOUND_IDS.TITLE_CLICK);
          setup = fillComputerSeats(next, Math.random);
          // ★ 补满座位之后**不直接开局** —— 先播「拉幕」（原版状态 2）：
          //   角色格往左、竖栏往右、小人往右走出画面，播完（或按键/再点一下）才进棋盘。
          const now = performance.now();
          setupOutroScroll = setupPhase(now).scroll;
          setupOutroAt = now;
        }
        return;
      }
      if (pressed === 2) {
        enterTitleScreen();
        return;
      }
      if (pressed >= 3) sound.play('Effect.mkf', SOUND_IDS.TITLE_CLICK);
      requestRender();
      return;
    }

    // ── 設定屏：抬手才收尾（原版 0x202）──
    if (screen === 'options') {
      // ★ 只认左键：原版的 `0x202` 是左键抬手，右键走 `0x205`（`contextmenu` 那一路）。
      //   浏览器里右键也会发 mouseup，不加这一条的话「右键 = 否」会变成「是」。
      if (e.button !== 0) return;
      onOptionsUp();
      return;
    }

    // ── 道具欄浮窗：抬手把选中项用出去（VA 0x445d84）──
    if (screen === 'inventory') {
      applyInventoryPick();
      return;
    }

    // ── 個人資產表屏：抬手才动作（照原版 0x202 那条跳表 `[0x48c284]−2`）──
    if (screen === 'assets' && (sheetUi.btn !== null || sheetUi.exit || sheetUi.arrow !== null)) {
      const { btn, exit, arrow } = sheetUi;
      sheetUi = { ...sheetUi, btn: null, exit: false, arrow: null };
      if (exit) closeAssets();
      else if (btn !== null) {
        assetView = btn;
        resetSheetPage();
        requestRender();
      } else if (arrow !== null) {
        // 上箭头 = 上一页、下箭头 = 下一页 @source VA 0x42424e / 0x4242cd
        pageEstateList(arrow === 'up' ? -1 : 1);
      }
      return;
    }

    // ── 卡片商店／道具商店：抬手才处理那两个钮（原版 0x202 那条跳表 `[0x48c347]`）──
    // ★ 抬手**不再看光标位置** —— 原版认的是按下那一刻记下的状态，照抄。
    if (screen === 'game' && shopUi !== null && (shopUi.pressed !== null || shopUi.pressedCell !== null)) {
      const ui = shopUi;
      const pressed = ui.pressed;
      ui.pressed = null;
      // 按过的那一格抬手复原（原版 `loc_0042e7ec` 的 `fcn_00451d4e` + 重贴底图）
      if (ui.pressedCell !== null) {
        ui.pressedCell = null;
        requestRender();
        if (pressed === null) return;
      }
      const now = performance.now();
      if (pressed === 'exit') {
        // 道别那句话说完才真的关门（`shopTick` 里看 `bubble` 到期）
        ui.closing = true;
        shopSay(ui, shopMessage(ui.page, 'bye'), now);
      } else {
        shopGotoPage(ui, ui.page === SHOP_PAGE.cards ? SHOP_PAGE.tools : SHOP_PAGE.cards, now);
      }
      requestRender();
      return;
    }

    // ── 監獄／醫院保釋屏：抬手才保釋（原版 0x202，`loc_0043cef6` / `loc_0043e...`）──
    if (screen === 'game' && state.pending?.kind === 'bail') {
      const pending = state.pending;
      const occupancy = pending.place === 'prison' ? state.prisonOccupancy : state.hospitalOccupancy;
      const q = eventToStage(e);
      if (q !== null) {
        const slot = hitBailSlot(pending.place, q.x, q.y, occupancy);
        if (slot !== null) {
          // ★ 钱不够就**什么都不做**（原版弹一个「點券不足」的訊息框，见下方偏差记录）。
          //   够不够用这一屏自己的判据（`>= 赎金`），不是电脑那条更严的。
          if (canPayOnScreen(state.players[state.currentPlayer]?.points ?? 0, slot)) {
            dispatch({ type: 'bail', slot });
            bailHot = null;
          } else {
            log('點券不足，付不起這位的保釋金');
            requestRender();
          }
        }
      }
      return;
    }

    // ── 目标拾取：抬手才选（原版在 LBUTTONUP 上抛回选中项，VA 0x446656）──
    if (screen === 'game' && pick !== null) {
      const hit = pickHover === null ? undefined : pick.candidates[pickHover];
      if (hit === undefined) {
        // 光标底下没有候选：**只播失败音，不退出**（原版 VA 0x4466a5 就是
        // 放一声就 return，模态循环继续跑）。
        sound.play('Effect.mkf', SOUND_CARD_FAILED);
        return;
      }
      // 选中音 @source VA 0x44666a 的 `play_sound_effect(0x48232a)`（音效 2）
      sound.play('Effect.mkf', SOUND_TARGET_PICKED);
      const source = pick.source;
      endPick();
      if (source.kind === 'card') {
        // ★ 搶奪卡（13）打**人**：原版在这里换成 `fcn_0044192a` 那扇模态选牌窗
        //   （见 `steal-picker.ts`），挑完才 `consume_card` + `receive_card`；
        //   右键取消 = 返回 0 = **卡不消耗**（`rich4_card_qiangduoka.asm:87..123`）。
        const t = hit.target;
        if (t.kind === 'player' && needsStealPick(state, source.cardId, t)) {
          openStealPicker(t.index, 'steal', (pick) => {
            if (pick === null) return; // 取消：什么都不派（照抄 exe）
            dispatch({
              type: 'useCard',
              cardId: source.cardId,
              target: { kind: 'player', index: t.index, steal: pick },
            });
          });
          return;
        }
        dispatch({ type: 'useCard', cardId: source.cardId, target: hit.target });
      } else if (source.toolId === PICKER_TOOL_ID && pickerNeededFor(state, topo, hit.nodeId)) {
        // ★ 機器工人盖**等级 0 的設施**：原版先开「請選擇設施類別」
        //   （`fcn_00440aac`，VA 0x0040b1e2），选完把类型交给 core 的
        //   `freeBuildFacility(…, chosenType)`；右键取消 = 什么都不做。
        const nodeId = hit.nodeId;
        const toolId = source.toolId;
        openFacilityPicker((type) => {
          if (type === null) return;
          dispatch({ type: 'useTool', toolId, nodeId, value: type });
        });
      } else {
        dispatch({ type: 'useTool', toolId: source.toolId, nodeId: hit.nodeId });
      }
      return;
    }

    draggingMinimap = false;
    // GO 鈕的拖动在**抬手**结束（原版 `WM_LBUTTONUP` VA 0x0041885c 只把 `[0x48be2a]` 清 0）
    goButton.release();
    if (pressedMinimapArrow !== null) {
      // 抬起才真的转 —— 左箭头 −1、右箭头 +1，都在 8 个视角里回绕
      // @source VA 0x00418707 `[0x499088] = ([0x499088] ∓ 1) & 7`
      rotateView(pressedMinimapArrow === 1 ? -1 : 1);
      pressedMinimapArrow = null;
      requestRender();
    }
    if (pressedTool !== null) {
      onToolbar(pressedTool);
      pressedTool = null;
      requestRender();
    }
  });
  window.addEventListener('mousemove', (e) => {
    // ── GO 鈕的拖动（Q-UI-6）──
    // 原版在棋盘窗口过程的 WM_MOUSEMOVE 里（VA 0x00418a73）：位置 = 按下时的鼠标
    // + 之后每一拍的位移，夹在 `[0, 640−w] × [0, 480−h]`；拖着的时候**不平移镜头**。
    // 这里听 window（与按下同一条线），鼠标拖出画布也不丢。
    if (goButton.dragging()) {
      const q = eventToStage(e);
      if (q !== null) {
        goButton.move({ x: q.x, y: q.y });
        requestRender();
      }
      return;
    }
    if (draggingMinimap) {
      // 按着小地图拖 —— 光标停在哪，镜头就移到哪（原版 VA 0x0041899b 也是这么算的）
      const p = eventToStage(e);
      if (p === null) return;
      const lx = p.x - LAYOUT.panel.x;
      const ly = p.y - LAYOUT.panel.y - SIDEBAR.y;
      minimapMarker = minimapCenterFromLocal(
        Math.min(SIDEBAR.w - 1, Math.max(0, lx)),
        Math.min(SIDEBAR.h - 1, Math.max(0, ly)),
      );
      centerOnMarker();
      requestRender();
      return;
    }
    // ★ 原先这里还能**拖棋盘**平移镜头。原版不能拖 —— 镜头恒以当前玩家为中心
    //   （`centerOnCurrentPlayer`，原版 `fcn_00415e70`）。那套是本引擎自己发明的，
    //   随 `setViewMode` 一起删掉（D-086-5 / T-086）。
  });

  // 右键 = 原版的 `WM_RBUTTONUP (0x205)`：**关掉最上面那一扇窗**
  // （关不掉的最后一档才是「清掉小地图标记」，@source VA 0x00418893）
  canvas.addEventListener('contextmenu', (e) => {
    // ── 登记的整屏（契约见 ui-screen.ts）：**声明了** `contextmenu` 的屏先收 ──
    // ★ 原版 `WM_RBUTTONUP`（0x205）就是各屏「关掉最上面那扇窗」的那一拍；
    //   大地圖彈窗（`fcn_0040a801`）只有这一条出口。
    // ⚠️ 只拦**声明了**的屏 —— 没声明的照旧走下面的通用梯子。
    {
      const overlay = activeUiScreen();
      if (overlay?.contextmenu !== undefined) {
        e.preventDefault();
        const q = eventToStage(e);
        if (q !== null) overlay.contextmenu(q.x, q.y, uiEnv());
        return;
      }
    }
    // ── 通用取消梯子：与熱鍵 ESC 走的是**同一个函数** ──
    //   原版两键同源（钩子把取消键补成 0x205），逐层取证见 `panel-cancel.ts`。
    //   工具栏那几扇（設定 / 託管AI / 存讀檔 / 大地圖 / 個人資產表 / 道具欄 /
    //   卡片欄 / 股市 / 遊戲百科）全在这把梯子上。
    if (cancelTopPanel()) {
      e.preventDefault();
      return;
    }
    // ── 剩这一条**不在梯子里**：右键清掉小地图标记（@source VA 0x00418893）──
    //   ⚠️ 没有模态窗口时（`callbackSize == 1`）钩子不发 0x205，而是置
    //   `[0x46caff] = 1`（@source VA 0x004011af），所以 ESC 不做这一条。
    if (screen !== 'game' || minimapMarker === null) return;
    e.preventDefault();
    minimapMarker = null;
    followPlayer = true;
    requestRender();
  });

  window.addEventListener('resize', requestRender);

  // ── 熱鍵 ──────────────────────────────────────────────
  //
  // ★ 键位表照原版的 RICH4.CFG（见 hotkeys.ts），功能名用 exe 里的原串。
  //   还没有对应屏幕的功能按了只记一条日志 —— 与工具栏上没实现的按钮
  //   一个待遇：说出来，不假装有反应。
  // ★★ 未捕获异常的总闸。打包后的 `.app` 没有控制台：先前前端一抛错，回合链
  //   （`scheduleAi` / `scheduleHumanTurn` 那几条 setTimeout）就**无声地断掉**，
  //   玩的人只看到「不动了」，开发的人什么都拿不到。现在：记进飞行记录仪、
  //   送桌面壳 stderr、日志栏给一行，并**自动落一份回报**（每种报错只落一次，一局至多 3 份）。
  const reportedErrors = new Set<string>();
  const onUncaught = (kind: 'error' | 'unhandledrejection', message: string, stack: string | null): void => {
    recorder.error({ t: Date.now(), kind, message, stack });
    hostLog(`[${kind}] ${message}${stack === null ? '' : `\n${stack}`}`);
    log(`⚠ 程式錯誤：${message.slice(0, 120)}（按 F9 可另存問題回報）`);
    if (reportedErrors.has(message) || reportedErrors.size >= 3) return;
    reportedErrors.add(message);
    fileReport('error', message);
  };
  window.addEventListener('error', (e) => {
    const err: unknown = e.error;
    onUncaught('error', e.message, err instanceof Error ? (err.stack ?? null) : null);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r: unknown = e.reason;
    onUncaught('unhandledrejection', r instanceof Error ? r.message : String(r), r instanceof Error ? (r.stack ?? null) : null);
  });

  // ★★ 停摆看门狗：**电脑的回合** 60 秒没有任何进展 = 回合链断了（电脑不需要等人）。
  //   真人回合不算 —— 人可以想多久都行。只落一次回报；浏览器下不自动弹下载，只记一行。
  let stallKey = '';
  let stallSince = Date.now();
  let stallReported = false;
  window.setInterval(() => {
    const key = `${screen}|${state.turnCount}|${state.phase}|${state.currentPlayer}|${state.pending?.kind ?? '-'}|${state.stepsRemaining}|${history.length}`;
    const now = Date.now();
    if (key !== stallKey) {
      stallKey = key;
      stallSince = now;
      return;
    }
    if (stallReported || screen !== 'game' || state.phase === 'gameOver' || !isAiTurn(state)) return;
    if (net !== null && !localSeatActive()) return; // 联机：别人的回合卡不卡不由本机判
    // 电脑的回合里也可能在**等人**：竞价轮到真人举牌（core `actingSeat`）⇒ 不算停摆
    const acting = state.players[actingSeat(state)];
    if (acting === undefined || !isAiControlled(acting)) return;
    // 整屏演出（月結、開獎…）可能在等人点一下才收 ⇒ 放宽到 3 分钟，免得误报
    const limit = activeUiScreen() === null ? 60_000 : 180_000;
    if (now - stallSince < limit) return;
    stallReported = true;
    const message = `電腦回合 ${limit / 1000} 秒無進展：${key}`;
    recorder.error({ t: now, kind: 'stall', message, stack: null });
    hostLog(`[stall] ${message}`);
    log(`⚠ ${message}（按 F9 存問題回報）`);
    if (isDesktop()) fileReport('stall', message);
  }, 5_000);

  window.addEventListener('keydown', (e) => {
    // ★ F9 = 问题回报（原版的键名表里没有 F1..F12，不占任何原版热键）
    if (e.key === 'F9') {
      e.preventDefault();
      fileReport('manual');
      return;
    }
    unlockAudio();
    // 开局过场：任意键跳过（原版同样可跳过）
    if (screen === 'intro') {
      introSkipped = true;
      e.preventDefault();
      requestRender();
      return;
    }
    // ★ 開局設定屏的「拉幕」：任意键直接进棋盘
    //   @source 原版状态 2 的分派：`cmp eax,0x100 / je loc_00405f6a`（KillTimer 收尾）
    if (screen === 'setup' && setupOutroAt !== null) {
      finishSetupOutro();
      e.preventDefault();
      return;
    }
    // ── ★ 此刻接管整屏的那一屏先收 `WM_KEYDOWN`（0x101）@source 各处 `PeekMessage` ──
    //   原版那一族「可跳过的等待」（`fcn_004544f6` / `fcn_004528b9` / `fcn_0045144f` /
    //   转盘 / 頒獎屏）在自己的消息循环里认 `0x202` / `0x205` / **`0x101`** 三种，
    //   任一命中就置「跳过」标志。本引擎的 `up`/`contextmenu` 已覆盖前两种，
    //   按键这一条原先没有出口（`hotkey` 只送映射过的 28 个功能）。
    //   ★ 放在**最前**：这些都是模态窗口，`WM_KEYDOWN` 先到它手里，
    //     不能被下面填数窗 / ATM / 熱鍵的按键抢走。
    {
      const overlay = activeUiScreen();
      if (overlay?.key !== undefined) {
        const handled = overlay.key(
          {
            vk: vkOf(e),
            code: e.code,
            ctrl: e.ctrlKey || e.metaKey,
            shift: e.shiftKey,
            alt: e.altKey,
          },
          uiEnv(),
        );
        if (handled) {
          e.preventDefault();
          requestRender();
          return;
        }
      }
    }
    // ── 通用填数窗收键盘 @source `fcn_00452c02` 的 0x100（`loc_00452e4b`）──
    //   ★ 那扇窗**自己**认 0-9 / 退格 / C / M / H / Enter（Q-UI-8 残留项 ③），
    //   而且它是模态的：`WM_KEYDOWN` 先到它手里 —— 所以这一段也排在熱鍵之前
    //   （不这么放，C / M / H / Enter 会被 RICH4.CFG 里同名的熱鍵抢走）。
    //   ⚠️ ESC 不在这张表里：取消键是全局钩子补成 0x205 才关窗的，
    //   那一条仍由下面的 `cancelTopPanel()`（cancelLayerOf 的 `amountPage` 层）收。
    // ★ 股市屏是 `screen === 'stock'`（不是 'game'）—— 那扇填数窗在两种屏上都可能开着
    if (amountPage !== null && (screen === 'game' || screen === 'stock')) {
      const vk = amountVkOf(e);
      const key = vk === null ? null : amountKeyOfVk(vk);
      // ★ 股市买 / 卖的那扇填数窗**不是待决交互**（`stockAmount`，从工具列的股市屏里开），
      //   `currentDialog()` 只认 `state.pending` ⇒ 先前这里拿到 null，键盘整条被丢掉
      //   （2026-09-19 第三份试玩回报 #3：鼠标点得动、键盘敲不动）。鼠标那条路（`stockAmountUi()`）一直是对的。
      const ui = stockAmount !== null ? stockAmountUi() : currentDialog();
      if (key !== null && ui !== null) {
        e.preventDefault();
        onAmountKey(ui, key);
        if (stockAmount !== null && amountPage === null) stockAmount = null; // 確定会关掉它（同鼠标那条路）
        requestRender();
        return;
      }
    }
    // ── 銀行 ATM 收键盘（Q-BANK-1）@source `fcn_00436ef8` 的 0x100（`loc_004374ac`）──
    //   ★ 原版 ATM 是模态窗口：`WM_KEYDOWN` 先到它手里，所以这一段要在熱鍵之前。
    //   键位表见 `bank-dynamic.ts` 的 `ATM_KEY_VK`（7 8 9 / 4 5 6 / 1 2 3 / 0 /
    //   C / Backspace / M=MAX / Enter=↵ / H=拖金额栏）。
    if (atm !== null && screen === 'game' && amountPage === null) {
      const code = atmCodeOfKey(atmVkOf(e) ?? -1);
      if (code !== null) {
        e.preventDefault();
        atmKey(code);
        return;
      }
    }
    // ── 熱鍵頁正在等一个键（原版 `fcn_00411122` 的 WM_KEYDOWN，排在全局熱鍵之前）──
    if (screen === 'options' && optionsSub !== null && optionsSub.kind === 'hotkey'
        && optionsSub.capture !== null) {
      e.preventDefault();
      // 键名表 `0x47edfa` 里没有的键原版也不理（只是继续等）
      onHotkeyCapture(captureVk(e) ?? -1);
      requestRender();
      return;
    }
    // ★ 2026-09-16：走**玩家自定义的那份键位表**，不再是出厂默认 ——
    //   先前 `hotkeyOf(e)` 没传第二个参、永远用 `DEFAULT_BINDINGS`，
    //   于是熱鍵設定屏改完只在内存里躺着、实际输入判定一无所知（Q-OPT-1）。
    //   原版把 28 条键位存在 `RICH4.CFG` 的 0x10..0x47（`global_rich4_cfg.hotkeys`），
    //   熱鍵頁「確定」写回 `[0x497168]`（VA 0x004117bc），输入判定读的就是它。
    //   ⚠️ 本引擎仍**没有** CFG 的读写（那是另一件事，见 Q-OPT-1 的登记），
    //   所以这份自定义只在本局进程内有效。
    const fn = hotkeyOf(e, bindingsOf(optionsKeys));
    if (fn !== null && handleHotkey(fn)) {
      e.preventDefault();
      requestRender();
      return;
    }
    // ── 调试键：原版没有，故一律挪到 Ctrl+Shift 上，不跟熱鍵抢 ──
    if (!e.shiftKey || !(e.ctrlKey || e.metaKey)) return;
    const step = 10;
    switch (e.code) {
      case 'KeyD':
        document.body.classList.toggle('no-debug');
        break;
      case 'KeyG':
        showGround = !showGround;
        log(showGround ? '▶ 显示底图' : '⏸ 隐藏底图');
        break;
      case 'KeyF':
        followPlayer = !followPlayer;
        log(followPlayer ? '▶ 镜头跟随当前玩家' : '⏸ 镜头自由');
        break;
      case 'KeyM':
        sound.setMuted(!sound.muted);
        log(sound.muted ? '⏸ 静音' : '▶ 开声');
        break;
      case 'BracketLeft': groundOffset.x -= step; break;
      case 'BracketRight': groundOffset.x += step; break;
      case 'Semicolon': groundOffset.y -= step; break;
      case 'Quote': groundOffset.y += step; break;
      default: return;
    }
    e.preventDefault();
    requestRender();
  });
}

// ============================================================
//  开局设置
// ============================================================

/** 合法的地图编号 —— `gameStage * 4 + gameMap`，0..7 */
const MAX_GLOBAL_MAP_ID = 7;
/** 原版最多四人 */
const MAX_PLAYERS = 4;

interface Setup {
  globalMapId: number;
  seed: number;
  players: { character: number; kind: 'human' | 'computer' }[];
}

/**
 * 从地址栏读开局设置。
 *
 * ```
 * ?humans=2&ai=2&map=0&seed=1234&chars=0,3,5,7
 * ```
 *
 * ★ **默认是一人三电脑**，不是四台电脑自己打。先前那样默认，
 *   人类玩家根本插不上手 —— 待决交互轮不到他，整局只能干看。
 *   正式的开局界面属于 M4 的后续，这里先让它**能玩**。
 */
function readSetup(): Setup {
  const q = new URLSearchParams(window.location.search);
  const int = (key: string, dflt: number): number => {
    const raw = q.get(key);
    if (raw === null) return dflt;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : dflt;
  };

  const humans = Math.max(0, Math.min(MAX_PLAYERS, int('humans', 1)));
  const total = Math.max(2, Math.min(MAX_PLAYERS, humans + Math.max(0, int('ai', 3))));
  const chars = (q.get('chars') ?? '')
    .split(',')
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n >= 0 && n < CHARACTERS.length);

  const players = Array.from({ length: total }, (_, i) => ({
    character: chars[i] ?? i,
    kind: (i < humans ? 'human' : 'computer') as 'human' | 'computer',
  }));

  return {
    globalMapId: Math.max(0, Math.min(MAX_GLOBAL_MAP_ID, int('map', 0))),
    // 种子是**唯一的非确定性入口**，进 action 日志，重放时照样对得上
    seed: int('seed', 1) >>> 0,
    players,
  };
}

// ============================================================
//  启动
// ============================================================

/**
 * 素材不在时的兜底引导。
 *
 * ★ **正常情况下不会走到这里**：原版素材已经随包打进 `Resources/game/`，
 *   双击即可运行，用户看不到任何选目录的界面。
 *
 * 只有包内素材缺失（例如从源码直接跑一个未打包的 dev 版）时，
 * 才退而请用户指一下目录 —— 有个出口总比一句「载入失败」强。
 */
async function ensureGameDir(): Promise<void> {
  if (!isDesktop()) return;
  if ((await currentGameDir()) !== null) return;

  for (;;) {
    metaEl.innerHTML =
      '<b>没找到原版素材</b><br>' +
      '包内应当自带；这份看来是从源码跑的。请指一下含 Data.mkf、map.mkf、' +
      'Panel.mkf、jump.mkf 的目录。';
    const go = document.createElement('button');
    go.textContent = '选择目录…';
    actionsEl.replaceChildren(go);

    const picked = await new Promise<PickResult>((resolve) => {
      go.onclick = () => {
        go.disabled = true;
        void pickGameDir().then(resolve);
      };
    });

    if (picked.ok && picked.dir !== null) {
      log(`原版目录：${picked.dir}`);
      break;
    }
    if (picked.error !== null) {
      log(`⚠ ${picked.error}`);
      metaEl.innerHTML = `<span class="err">${picked.error}</span>`;
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  actionsEl.replaceChildren();
}

// ============================================================
//  联机（T-074）
// ============================================================

/** 断线后隔多久重连 */
const RECONNECT_MS = 1500;

/**
 * 接上服务器。地址栏 `?ws=ws://host:port&room=r1&name=小明`。
 *
 * ★ 开局参数由服务器 `start` 下发：种子、地图、座位。本机据此建初始状态，
 *   之后**只**施加服务器广播的 action。断线就带着 `since`（本地已施加到几号）
 *   重连，同名认回原座位，服务器补发漏掉的那段。
 */
function connectOnline(url: string, room: string, name: string): void {
  let closedByUs = false;
  const open = (since: number | undefined): void => {
    const ws = new WebSocket(url);
    // 「離開」要能把这条连接断开；重连时会换成新的
    netClose = () => {
      closedByUs = true;
      ws.close();
    };
    const client = new NetClient(
      { send: (text) => ws.send(text) },
      {
        room,
        name,
        ...(since === undefined ? {} : { since }),
        onJoined: (seat, info) => {
          log(`✔ 進房 ${info.id}：我是 ${seat + 1} 號座${seat === 0 ? '（房主，按 START 開局）' : ''}`);
          enterLobby(info);
        },
        onRoom: (info) => {
          log(
            '房間：' +
              info.seats
                .map((s) => `${s.seat + 1}${s.kind === 'human' ? (s.connected === false ? '斷' : '人') : '電'}${s.name}`)
                .join(' '),
          );
          // 有人进出、有人掉线都要立刻反映在大厅上
          enterLobby(info);
        },
        onStart: (start) => {
          // 重连时 start 会再来一次；局面已在，别重建（那会把 since 之前的进度清掉）
          if (since !== undefined && screen === 'game') return;
          lobbyRoom = null;
          lobbyHot = null;
          map = parseMap(readMapData(archives, start.globalMapId));
          topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials, landscapes: map.landscapes };
          // ★ 与服务器镜像（server/room.ts）逐字段一致，否则指纹对不上
          state = newGame({
            map,
            globalMapId: start.globalMapId,
            players: start.seats.map((s) => ({ character: s.character, kind: s.kind })),
            seed: start.seed,
            mode: 'multiplayer',
          });
          history.length = 0;
          recorder.reset();
          hoverNode = null;
          const first = map.nodes[state.players[0]?.nodeId ?? 1];
          camera = characterCamera(first?.x ?? 0, first?.y ?? 0, state.viewRotation);
          screen = 'game';
          log(`開局（聯機）：地圖 ${start.globalMapId}　種子 ${start.seed}`);
          ground = null;
          void loadGround(archives, start.globalMapId).then((g) => {
            ground = g;
            requestRender();
          });
          loadMinimapAssets(start.globalMapId);
          requestRender();
          renderPanel();
          scheduleAi();
          scheduleHumanTurn();
        },
        onAction: (action) => {
          if (action.type === 'step') stepTick();
          applyAction(action);
        },
        onError: (message) => log(`⚠ 伺服器：${message}`),
        onDesync: (d) =>
          log(`⚠ 失步！第 ${d.seq} 號後 ${d.seat + 1} 號座的校驗和 ${d.got} ≠ ${d.expected}，已請求全量重放`),
        // ★ Q-NET-1 自愈：服务器把**完整** action 日志重放回来了 → 整体重建本地状态。
        //   刻意不复用 `applyAction`：那条路会带出动画、音效、AI 排程，
        //   重放几百条等于把特效重放几百遍。这里是「静默」的 reduce，
        //   做完只催一帧并重排驱动。
        onResync: (r) => {
          map = parseMap(readMapData(archives, r.globalMapId));
          topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials, landscapes: map.landscapes };
          state = newGame({
            map,
            globalMapId: r.globalMapId,
            players: r.seats.map((s) => ({ character: s.character, kind: s.kind })),
            seed: r.seed,
            mode: 'multiplayer',
          });
          history.length = 0;
          recorder.reset();
          for (const action of r.actions) {
            state = reduce(state, action, topo);
            history.push(action);
          }
          // 本屏的临时 UI 状态一律收掉：重放可能把 pending 换成了另一种，旧的指认不再成立
          amountPage = null;
          dialogHot = null;
          pick = null;
          pickHover = null;
          hoverNode = null;
          diceFx.cancel();
          // ★ 建屋影片也是「这一刻在播」的东西：本地状态已经重建，旧片子不该接着放
          buildFx = null;
          pendingBuildFx = null;
          buildFlicPending.clear();
          releaseBuildFlics();
          // 影片窗口的 before 快照同理作废（状态已经重放重建，旧快照不再对应任何一帧）
          deferredBoardBefore = null;
          npcWalksDrawn = null;
          log(`⟳ 失步自愈：重放 ${r.actions.length} 條 action，本地狀態已重建（第 ${r.actions.length} 號）`);
          requestRender();
          renderPanel();
          scheduleAi();
          scheduleHumanTurn();
        },
        fingerprint: () => stateFingerprint(state),
      },
    );
    ws.onopen = () => {
      net = client;
      client.join();
    };
    ws.onmessage = (ev) => client.receive(String(ev.data));
    ws.onclose = () => {
      if (closedByUs) return;
      log(`⚠ 與伺服器斷線，${RECONNECT_MS / 1000} 秒後重連…`);
      window.setTimeout(() => open(client.expectedSeq > 0 ? client.expectedSeq - 1 : undefined), RECONNECT_MS);
    };
    ws.onerror = () => {
      /* onclose 会跟着来 */
    };
  };
  window.addEventListener('beforeunload', () => {
    closedByUs = true;
  });
  log(`聯機：連 ${url} 房間 ${room}…`);
  open(undefined);
}

async function boot(): Promise<void> {
  try {
    await ensureGameDir();
    metaEl.textContent = '正在载入原版素材…';
    archives = await loadArchives(assetBase());
    // 新聞/命運 插画与 抽卡 卡面是**无头 RGB555 块**（Data.mkf #441+/#477+/#571+），
    // 走不了 `sprite()`（它要求 SPR/SMP 签名）。把档案句柄交给那一屏，照
    // `minigame-bg.ts` 的同一条路子取原图（见 `event-box-screen.ts` 头注释）。
    setEventBoxArchives(archives);

    // HD 素材可选：拿不到清单（没跑过超分管线、或整个 assets/hd/ 不存在）
    // 就整包走原图。**按图**回退在 SpriteCache 里（PRD §4.5）。
    hdSource = await loadHdSource(hdBase());
    sprites = new SpriteCache(archives, hdSource === null ? {} : { hd: hdSource });
    if (hdSource !== null) log('HD 素材：已接上（缺图的按图回退原图）');

    // 先用地址栏（或默认值）建一局，好让渲染器与面板有东西可读；
    // 但**开机停在標題畫面**——真正的开局在玩家点 START 之后。
    const boot0 = readSetup();
    map = parseMap(readMapData(archives, boot0.globalMapId));
    topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials, landscapes: map.landscapes };
    state = newGame({ map, globalMapId: boot0.globalMapId, players: boot0.players, seed: boot0.seed });
    setup = {
      ...defaultSetup(),
      playerCount: boot0.players.length,
      characters: boot0.players.map((p) => p.character),
      human: boot0.players.map((p) => p.kind === 'human'),
      mapId: boot0.globalMapId,
    };
    // ★ `?screen=game` 跳过標題直接开一局 —— 调试与自动化用，正常玩不走这条。
    //   ⚠️ 必须走 `startGame()` 而不是只把 `screen` 改掉：底图、镜头、
    //   AI 调度都在那儿；只改屏号会进到一个没有底图的空棋盘。
    const straightToGame = new URLSearchParams(window.location.search).get('screen') === 'game';
    // ★ 存档口（T-053）：桌面版把槽位预载进内存，之后读档屏同步取用
    await initSaveStore();
    // ★ `RICH4.CFG`（72 字节 = 16 字节设定 + 28 条键位）—— 原版開機就整份读回来
    //   @source `rich4_read_config()` VA 0x00411e8f（`rich4_initialize.asm:169`）
    await initConfigStore();
    loadConfigFromStore();
    // Q8：上次选的音色库（桌面版存在 <AppData>/soundfont/）接回来再开声
    void restoreSoundFont();

    // ★ 渲染器画进**离屏**画布：棋盘 439×440、側欄 200×480，
    //   都是原版的固定尺寸；缩放由舞台统一做（见 stage.ts）。
    renderer = new BoardRenderer(boardCtx, sprites);
    hud = new Hud(hudOffCtx, sprites);
    // 解码是异步的，绘制是同步的：图到了要有人把下一帧排上，否则画面停在缺图那一帧
    renderer.onSpriteReady = requestRender;
    // 调试辅助层：`?debug=nodes` 才画节点连线与落点菱形（原版没有）
    renderer.debugNodes = new URLSearchParams(window.location.search).get('debug') === 'nodes';
    hud.onSpriteReady = requestRender;
    // 財神接金幣那屏的底图（Panel.mkf #92，无头 640×480 RGB555）——`sprite()` 取不到，
    // 走 raw 出口后交给 `minigame-bg.ts`；图异步到，到了催一帧（见 D-MINI-1）
    onMinigameBackgroundReady(requestRender);
    void loadMinigameBackground(archives).then(setMinigameBackground);
    // 新聞/命運 插画 + 抽卡 卡面也是无头 RGB555 块 —— 同一条 raw 出口，
    // 解好一张催一帧（图异步到，画的时候可能还没有）
    onEventBoxArtReady(requestRender);
    resizeCanvas();
    // ★ 原版开局就是人物视角（等距投影、跟着棋子），全局看右下角小地图
    const first = map.nodes[state.players[0]?.nodeId ?? 1];
    camera = characterCamera(first?.x ?? 0, first?.y ?? 0, state.viewRotation);
    centerOnCurrentPlayer();

    // 开发期调试出口：在控制台里能直接看状态与相机，排错方便。
    //
    // ★ 多出来的三项是给**拾取**排错用的：棋盘画在 canvas 上，
    //   浏览器自动化看不见里面，投影或相机一出错只能靠猜。
    //   有 `project` / `pick` 就能在控制台里直接问「这一点是哪个节点」。
    if (import.meta.env.DEV) {
      (globalThis as unknown as { __rich4?: unknown }).__rich4 = {
        get map() { return map; },
        get state() { return state; },
        get camera() { return camera; },
        get history() { return history; },
        report: (note?: string) => { fileReport('manual', note ?? ''); },
        get recorder() { return { trail: recorder.trailLength, errors: recorder.errorCount }; },
        get hoverNode() { return hoverNode; },
        get screen() { return screen; },
        /** 目标拾取会话（T-026）—— `null` = 没在拾取 */
        get pickSession() { return pick; },
        /** 個人資產表的故事板状态 */
        get sheetUi() { return sheetUi; },
        /** 卡片商店／道具商店的界面状态（页号、滑入位置、气泡、货架快照）*/
        get shopUi() { return shopUi; },
        get setup() { return setup; },
        get options() { return { saved: options, draft: optionsDraft, variant: optionsVariant }; },
        goto: (s: Screen) => { screen = s; requestRender(); },
        /**
         * 按下工具栏第 i 颗按钮 —— 与鼠标点它走**同一个** `onToolbar`。
         * 只是为了在自动化里能少绕一次 canvas 坐标换算（命中本身有单测钉着）。
         */
        toolbar: (i: number) => { onToolbar(i); requestRender(); },
        /** 光标停在第 i 颗工具栏按钮上（原版 `[0x48bde4]`，只管高亮）*/
        hoverToolbar: (i: number | null) => { hotTool = i; requestRender(); },
        /** 直接派一个 action —— 自动化测试用，走的与人点按钮同一条路 */
        dispatch: (a: Action) => { dispatch(a); },
        /**
         * 把当前玩家挪到某一格并结算 —— **只给自动化测试用**。
         * 走的是引擎的傳送機规则（rules/teleport.ts）加一次 settle，
         * 不是另开一条后门。
         */
        warp: (nodeId: number) => {
          const moved = teleportPlayer(state, map.nodes, state.currentPlayer, nodeId);
          if (moved === null) return false;
          // settle 只在 settling 阶段生效，所以先把阶段摆过去
          state = { ...moved, phase: 'settling' };
          dispatch({ type: 'settle' });
          return true;
        },
        /**
         * ★ **直达一场拍卖**：当回合玩家打出「拍賣卡」（卡 8），把竞价挂成待决交互。
         *
         * 走的是与人点手牌**同一条** `useCard` action（不是后门）。加它是因为
         * 竞价屏**要玩到才会出现**（抽到卡 + 打出 + 有人出得起），而「轮到电脑时
         * 他自己跟价 / 放弃、落槌演出」只能在这块屏上验收。
         * @returns 真的开出一场返回 true（`state.pending.kind === 'auction'`）
         */
        /** 此刻接管整屏的那一屏的 id（`null` = 棋盘）—— 给自动化用 */
        overlayId: () => activeUiScreen()?.id ?? null,
        /**
         * ★ 直接开股市的**填数页**（计算器）—— 给自动化用。
         *
         * 「鼠标点数字钮 / MAX」只能在这扇窗上验收，而它**要休市日之外**才开得出来；
         * 这条路只把 `stockAmount + amountPage` 摆好，规则（上限算式）仍走
         * `stock-screen.ts` 的同一批函数。
         * @param row 股票行号（0 基）
         */
        stockAmount: (row = 0, kind: 'buy' | 'sell' = 'buy') => {
          // 存款为 0 时上限恒 0（买股走存款）；休市日流通量也是 0
          //   ⇒ 先勾一笔存款与一点流通量，让窗子真开得出来（只为自动化够得着这扇窗）
          if (kind === 'buy') {
            state = {
              ...state,
              players: state.players.map((p, i) =>
                i === state.currentPlayer ? { ...p, moneyInBank: Math.max(p.moneyInBank, 50000) } : p,
              ),
              market: {
                ...state.market,
                stocks: state.market.stocks.map((x, i) => (i === row ? { ...x, f10: 1000 } : x)),
              },
            };
          }
          const st = state.market.stocks[row];
          const me = state.players[state.currentPlayer];
          if (st === undefined || me === undefined) return false;
          screen = 'stock';
          stockSel = row;
          stockAmount =
            kind === 'buy'
              ? { kind: 'buy', stock: row, max: stockCounterBuyMax(me.moneyInBank, st.price, st.f10) }
              : { kind: 'sell', stock: row, max: state.holdings[state.currentPlayer]?.[row]?.amount ?? 0 };
          amountPage = { choice: 0, value: AMOUNT_INITIAL };
          dialogHot = null;
          requestRender();
          return stockAmount.max > 0;
        },
        /**
         * ★ 直接播一次樂透開獎演出 —— 给自动化用。
         *
         * 開獎是「日期跨到 15 日」的副作用，正常玩要等到那天；这条路只把
         * 那一对 `before/after` 摆出来（`lotteryDrawCue` 的判据与日期推进
         * 那一条完全一样），演出本身一格都不改。
         */
        lotteryDraw: () => {
          const lot = new Array<number>(36).fill(0);
          lot[6] = 1; // 1 号玩家持 07 号
          const before: GameState = {
            ...state,
            day: 14,
            totalDays: state.totalDays,
            pool: 5000,
            lottery: lot,
            players: state.players.map((p, i) => (i === 0 ? { ...p, cash: p.cash + 5000 } : p)),
          };
          const after: GameState = {
            ...before,
            day: 15,
            totalDays: before.totalDays + 1,
            pool: 0,
            lottery: new Array<number>(36).fill(0),
          };
          state = after;
          const cue = lotteryDrawCue(before, after);
          if (cue === null) return 'no-cue';
          // 与状态变化时那条路同一支：各整屏的 `event(before, after)` 统一派
          for (const sc of SCREENS) sc.event?.(before, state, uiEnv());
          requestRender();
          return JSON.stringify(cue);
        },
        /** dev：樂透開獎屏这一帧的演出态 + 气泡行（排「台词不出」用） */
        lotteryView: () => {
          const v = lotteryDrawView(uiEnv());
          if (v === null) return 'null';
          return JSON.stringify({ step: v.step, state: v.state, lines: v.lines, now: uiEnv().now });
        },
        /** dev：`onDialogHit` 收到的每一次命中（自动化排错用） */
        hits: () => JSON.stringify(__devHits),
        /** 股市填数页的**命中框**（舞台坐标）—— 给自动化点用 */
        stockAmountRects: () => {
          const ui = stockAmountUi();
          if (ui === null) return '[]';
          return JSON.stringify(
            layoutDialog(boardCtx, ui, amountPage).buttons.map((b) => ({
              hit: b.hit,
              x: b.rect.x + LAYOUT.board.x,
              y: b.rect.y + LAYOUT.board.y,
              w: b.rect.w,
              h: b.rect.h,
            })),
          );
        },
        /** 股市填数页此刻拿到的上限与当前值 —— 给自动化核对用 */
        stockAmountState: () =>
          JSON.stringify({
            stockAmount,
            amountPage,
            rows: state.market.stocks.map((x) => ({ price: x.price, f10: x.f10 })),
          }),
        /** 手动走一帧渲染回调（与 `requestRender` 里那条同路）—— 给自动化用 */
        pump: () => {
          renderQueued = false;
          requestRender();
        },
        /** 拍卖屏的当前运行态（屏内 + core 的 pending 快照）—— 给自动化用 */
        auctionView: () => {
          const run = auctionRunForTest();
          const p = state.pending;
          return JSON.stringify({
            run:
              run === null
                ? null
                : {
                    current: run.current,
                    phase: run.phase,
                    price: run.price,
                    top: run.top,
                    seats: run.seats.map((s) => ({ player: s.player, state: s.state, away: s.away })),
                  },
            pending:
              p !== null && p.kind === 'auction' && 'seat' in p
                ? { seat: p.seat, price: p.price, top: p.top, status: p.status }
                : null,
          });
        },
        auction: (seat?: number) => {
          // 手上没有就先塞一张（新开局手牌是空的；这一步只为让自动化够得着这块屏）
          const who = seat ?? state.currentPlayer;
          if (!(state.players[who]?.cards ?? []).includes(8)) {
            state = {
              ...state,
              players: state.players.map((p, i) => (i === who ? { ...p, cards: [...p.cards, 8] } : p)),
            };
          }
          // ★ 让**指定的那一家**当回合玩家（= 卖家）—— 竞价名单是「其余三家」，
          //   只有把人放在买家那一侧，才看得到「点完钮电脑跟不跟」。
          state = { ...state, currentPlayer: who, phase: 'awaitingRoll' };
          // ★ 拍賣卡拍的是**他脚下的那块地**；手上没地时先塞一块（只为让自动化够得着）
          {
            const nodeId = state.players[who]?.nodeId ?? 0;
            const land = map.lands.find((l) => l.id === nodeId) ?? null;
            if (land !== null) {
              const owner = [...state.landOwner];
              owner[nodeId] = who + 1;
              const level = [...state.landLevel];
              if ((level[nodeId] ?? 0) < 1) level[nodeId] = 1;
              state = { ...state, landOwner: owner, landLevel: level };
            }
          }
          const beforeP = state.pending;
          dispatch({ type: 'useCard', cardId: 8, target: { kind: 'none' } });
          if (state.pending?.kind !== 'auction') {
            log(
              `[dev] 開拍賣失敗：phase=${state.phase} pending=${state.pending?.kind ?? '-'}` +
                `（之前 ${beforeP?.kind ?? '-'}）`,
            );
          }
          return state.pending?.kind === 'auction';
        },
        /**
         * ★ 魔法屋那一屏的状态（`magicScreenState()`）：`playing` / `phase` /
         *   `hover` / `ring` / `view`。
         *
         * 加它是因为这一屏**要玩到才会出现**（落点随机），而「一圈十二格每一项
         * 都点得到」只能用鼠标真的去点、再读状态来验收；`#log` 里那句
         * `魔法屋：選定 N（功能名）` 是另一半证据。
         */
        magic: () => magicScreenState(),
        /**
         * ★ **直达魔法屋**：把当前玩家挪到地图上任意一格魔法屋并结算。
         *
         * 走的是与 `warp` 同一条引擎规则（`teleportPlayer` + `settle`），
         * **不是后门**；落点从 `map.nodes` 的 `specialKind` 找，判据与
         * `magic-screen.ts` 的 `onMagicHouse` 同一个（`SPECIAL_KIND.MAGIC_HOUSE`）。
         * @returns 找到了并成功结算返回 true
         */
        magicHouse: () => {
          const node = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.MAGIC_HOUSE);
          if (node === undefined) return false;
          const moved = teleportPlayer(state, map.nodes, state.currentPlayer, node.id);
          // ★ 已经站在那一格上时 `teleportPlayer` 返回 null（没有「移动」可言）——
          //   直达钩子照样要能重放，所以这一支直接拿现状态结算。
          state = { ...(moved ?? state), phase: 'settling' };
          dispatch({ type: 'settle' });
          return true;
        },
        /** 地图上所有特殊格：`{ 节点号: specialKind }` */
        specials: () =>
          Object.fromEntries(
            map.nodes.filter((n) => n.specialKind !== 0).map((n) => [n.id, n.specialKind]),
          ),
        /** 当前这一帧对话框上有哪些按钮（棋盘区坐标），给自动化点用 */
        dialog: () => {
          const ui = currentDialog();
          if (ui === null) return null;
          return {
            title: ui.title,
            detail: ui.detail,
            buttons: layoutDialog(boardCtx, ui, amountPage).buttons.map((b) => ({
              label: b.label,
              // 换算到舞台坐标，省得调用方再加一次棋盘偏移
              x: b.rect.x + b.rect.w / 2 + LAYOUT.board.x,
              y: b.rect.y + b.rect.h / 2 + LAYOUT.board.y,
            })),
          };
        },
        /** 查一张图的尺寸与锚点 —— 命中判定对不上时先看这个 */
        sprite: (archive: 'Data.mkf' | 'Panel.mkf', res: number, idx: number, key = false) => {
          const s2 = spriteNow(archive, res, idx, key);
          return s2 === null
            ? null
            : { w: s2.width, h: s2.height, ax: s2.anchorX, ay: s2.anchorY };
        },
        viewport: () => ({ w: LAYOUT.board.w, h: LAYOUT.board.h }),
        /** 某个节点此刻画在**棋盘区**的哪里；不在视野内返回 null */
        project: (nodeId: number) => {
          const n = map.nodes[nodeId - 1];
          if (n === undefined) return null;
          return worldToScreen(n.x, n.y, camera, { w: LAYOUT.board.w, h: LAYOUT.board.h });
        },
        /** 屏幕坐标落在哪个节点上 —— 与鼠标走的是同一条路径 */
        pick: (sx: number, sy: number, radius?: number) =>
          pickNodeAt(map, sx, sy, camera, { w: LAYOUT.board.w, h: LAYOUT.board.h }, radius),
        /**
         * GO 鈕相关 —— 给**浏览器长跑**（`tools/soak-browser.js` 的真人路径模式）用：
         * 它要能问出「GO 现在在哪、点下去算不算命中」，而不是自己猜坐标。
         * 与鼠标走同一个 `goButton` / `hitDiceToggle`，不是第二套判定。
         */
        goButton: () => ({
          x: goButton.position().x,
          y: goButton.position().y,
          w: GO_SIZE.w,
          h: GO_SIZE.h,
          stageX: goButton.position().x + LAYOUT.board.x,
          stageY: goButton.position().y + LAYOUT.board.y,
          dragging: goButton.dragging(),
          awaitingRoll: awaitingHumanRoll(),
        }),
        /** 点这个舞台坐标算不算命中 GO 鈕（长跑用它选点击点） */
        hitGo: (gx: number, gy: number) =>
          hitAdvance(gx - LAYOUT.board.x, gy - LAYOUT.board.y, goButton.position()),
        /** 最近一次棋盘 mousedown 走到哪一步 —— 长跑排错用（纯读） */
        inputTrace: () => inputTrace,
        /**
         * 骰子那一段现在到哪一相了 —— 长跑排错用（纯读）。
         * `active` 恒真而 `phase` 不前进 = 「掷完骰子人不走」那一类卡死。
         */
        diceState: () => ({ phase: diceFx.phase, active: diceFx.active }),
      };
    }

    document.body.classList.add('no-debug');
    bindInput();
    // ★ 第一次交互就解锁音频 —— 画布之外的任意一点/任意一键也算（autoplay 政策）
    bindAudioUnlock();
    const online = netParamsFrom(window.location.search);
    if (online !== null) connectOnline(online.url, online.room, online.name);
    else if (straightToGame) startGame();
    // ★ 一进標題就点 MIDI01（原版 `ui_main.asm:187` → `fcn_004549cf(0)`）。
    //   此刻通常还没有用户手势：`MusicPlayer.play()` 会把它记成 **pending**，
    //   第一次交互时立刻补播，不用再等一次 fetch —— 这就是「打开游戏后
    //   背景音乐要能自动响」（浏览器 autoplay 政策只允许手势之后出声）。
    else enterTitleScreen();
    requestRender();
    renderPanel();
    log(`地图载入：${map.nodes.length} 个节点、${map.lands.length} 块地`);

    // 音效档案后台拉取。Speaking.mkf 有 57MB，先不装。
    void fetch(`${assetBase()}/Effect.mkf`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => {
        if (buf === null) return;
        sound.addArchive('Effect.mkf', new Uint8Array(buf));
        log('音效载入：Effect.mkf（首次点击后开声）');
      })
      .catch(() => log('⚠ 音效载入失败'));

    // ⚠️ **不在这里解底图**。它是 2304×2304（530 万像素），
    //   `createImageBitmap` 一跑就把解码管线占满几秒钟，排在后面的
    //   標題按钮小图迟迟出不来 —— 表现是「第一下点不动」，
    //   看起来像命中判定写错了，其实是图还没解出来。
    //   底图等真的开局了再解（见 startGame）。
  } catch (err) {
    const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    // ★ 桌面壳里看不到控制台，堆栈必须自己送出去
    hostLog(`启动失败：${detail}`);
    metaEl.className = 'err';
    metaEl.textContent = `启动失败：${err instanceof Error ? err.message : String(err)}`;
    throw err;
  }
}

void boot();
