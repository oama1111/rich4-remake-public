/*
 * 客户端入口
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2 / C-ARC-4：本文件负责**输入与呈现**，一条规则都不含。
 *   所有状态变更都表达为 action 交给 `reduce()`；
 *   这正是联机能免改造接入的前提——本地点击和远端消息产生的
 *   是同一种 action，引擎分不出也不需要分出来源。
 */

import { BAIL_CLERK_TEXT, CARD_IMPLS, CHARACTERS, INMATE_THANKS, TOOLS, stocksOfMap } from '@rich4/data';
import { parseVoiceCode } from '@rich4/data';
import {
  captionExpired,
  playVoiceCode,
  setVoiceBusyProbe,
  setVoiceSink,
  setVoiceStopper,
  stopVoice,
  voiceBusy,
} from './voice-sink.ts';
import { LogRing } from './log-ring.ts';
// ★ 开发用的状态注入口（`__rich4.debug.patch` 与三个现成配方，W-53）——
//   只在 DEV 下挂；它**绕过 reduceRecorded**，故调用时会把记录仪标脏。
import {
  applyPatch,
  attachLogLine,
  dogLogLine,
  giveAngel,
  giveSmallPovertyGod,
  nextNodeOf,
  placeDogAhead,
} from './dev-patch.ts';
// ★ 魔法屋那一屏的 dev 直达钩子（`__rich4.magic` / `__rich4.magicHouse`，只在 DEV 下挂）——
//   这一屏**要玩到才会出现**（落点随机），验收它只能反复进屏，见下面那个 dev 分支。
import { isTextEntryTarget } from './text-entry.ts';
import { magicAwaitingPick, magicHumanPickPoint, magicScreen, magicScreenState } from './magic-screen.ts';
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
  roomOptions,
  roomHostSeat,
  specialSlotOf,
  SPECIAL_KIND,
  STOCK_STATUS,
  stockStatus,
  serializeGame,
  actingSeat,
  cardPassiveHolder,
  TOOL_GET_OFF,
  TOOL_TELEPORTER,
  isAiControlled,
  stateFingerprint,
  toolCount,
  GAME_INITIAL_FUNDS,
  winConditionsOf,
  type Action,
  type CardTarget,
  type PresentCue,
  type GameState,
  type JoinMode,
  type MapTopology,
  type Rich4Map,
  type RoomInfo,
  type TargetClass,
  orphanedAuction,
  confineViewTargets,
  type ConfineView,
} from '@rich4/core';
import { NetClient, defaultWsUrl, netParamsFrom } from './net-client.ts';
import { initialNetState } from './net-start.ts';
import { defaultSaveName, promptSaveName } from './net-save.ts';
import {
  browserStorage,
  foyerEntry,
  loadClientId,
  loadName,
  showFoyer,
  withoutRoomParam,
} from './foyer.ts';
import { NetToasts } from './net-toast.ts';
import { DiceRollFx, DICE_SOUND as DICE_ROLL_SOUND, rollsWithoutDice } from './dice-roll.ts';
import { RENDER_MS, tickMs } from './tick.ts';
import { landingPauseRemaining, turnEndPauseTicks, type LandingPause } from './landing-pause.ts';
import { hideLandingPlayer, landingFilmSpec, landingTrigger, openingLandingPlayer } from './landing-fx.ts';
import { walkTweenFor, type WalkTween } from './tween.ts';
import {
  drawLobby,
  hitLobby,
  lobbyIsHost,
  lobbySlots,
  LOBBY_OPTION_ROWS,
  optionIndexOf,
  optionValueOf,
  type LobbyHit,
} from './lobby.ts';
import { PANEL_ROWS, panelActorSlot, panelPlayerOf } from './hud.ts';
import { panelRows } from './panel.ts';
import {
  aiSettingsDown,
  aiSettingsDrag,
  aiSettingsUp,
  AI_ORIGIN,
  drawAiSettings,
  hitAiSettings,
  aiCommitActions,
  openAiSettingsModel,
  type AiSettingRow,
  type AiSettingsModel,
} from './ai-settings.ts';
import {
  archivesFromBytes,
  loadArchives,
  loadGround,
  loadHdSource,
  type HdSource,
  readMapData,
  SpriteCache,
  loadHolidayArt,
  loadMinigameBackground,
  readRawBytes,
  loadMinimapBackground,
  screenDirection,
  type ArchiveName,
  type LoadedArchives,
  type Sprite,
} from './assets.ts';
import { loadAllArchives, type LoadProgress } from './asset-loader.ts';
import {
  cardUsePopupActive,
  dropOwnCardUse,
  eventBoxPending,
  eventBoxScreen,
  eventBoxTailPending,
  eventBoxTailTick,
  setEventBoxStartGate,
  startCardRevealPopup,
  startRemoteCardUsePopup,
  onEventBoxArtReady,
  setEventBoxArchives,
  startOwnCardUsePopup,
} from './event-box-screen.ts';
// ★ 「請選擇設施類別」那扇窗（Q-TOOL-4）—— 真人盖**等级 0 的設施**时要先选种类
//   （原版 `fcn_00440aac` / 窗口过程 `fcn_0043fae4`）。
import {
  PICKER_HIT,
  PICKER_STRIDE,
  PICKER_TOOL_ID,
  facilityPickerOpen,
  openFacilityPicker,
  pickerNeededFor,
  resetFacilityPicker,
  setFacilityPickerGate,
} from './facility-picker.ts';
import { needsStealPick, openStealPicker, resetStealPicker, stealPickerOpen } from './steal-picker.ts';
import { staleLocalModals, type LocalModal } from './turn-modals.ts';
import { AMOUNT_BAR_DRAG_SOUND, amountBarDragValue, parseAmountHitMap, setAmountHitMap } from './amount-window.ts';
import {
  Hud,
  SIDEBAR,
  clampCameraCenter,
  hitCalendarToggle,
  hitMinimapArrow,
  hitMinimapBody,
  hitPanelTag,
  hitMinimapArea,
  hitSidebar,
  minimapToWorld,
  sidebarLayout,
  type CalendarPage,
  type MinimapArrowId,
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
import { SoundPlayer, VoiceChannel, shouldRetriggerVoice } from './audio.ts';
import {
  cardPlaySpeechLines,
  toolUseSpeechLines,
  toolLineOf,
  ownToolLineSpoken,
  TOOL_LINE_ORDER,
  type OwnToolLine,
  speechEventsFor,
  speechLinesFor,
  type SpeechLine,
} from './speech.ts';
import { filmWaitsForSpeech, stageBusy, type SpeechOrder, type StageFlags } from './stage-gate.ts';
// ★★ 第十五份：台词气泡 × 各种框的先后与互斥 —— 一把尺子、两道闸（规格见该模块文件头）
import {
  SCREEN_BOX_TIER,
  insertByRank,
  lineMayEnter,
  lineRank,
  speechAheadOfFilms,
  type BoxSnapshot,
  type SpeechCue,
  type SpeechSnapshot,
} from './presentation-order.ts';
import { fastForwardPresentations, presenterMovedOn } from './follow-presenter.ts';
import {
  SpeechQueue,
  drawSpeechBubble,
  type BubbleSpriteFn,
  type SpeechBubble,
} from './speech-bubble.ts';
// 台词字幕用的是 canvas 文字（原版 `_rich4_create_font(0x10, 0x101010, …)` 那一路）
import { font } from './font.ts';
import {
  GOD_LINE_AT,
  GOD_LINE_COLOR,
  GOD_LINE_FONT_PX,
  GOD_LINE_LINE_HEIGHT,
  GOD_LINE_SHADOW,
  godFilmFrameHeld,
  godLineActive,
  godLineRows,
  godLineShown,
  godLineTrigger,
} from './god-line.ts';
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
  hdTierDir,
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
  pixelCamera,
  hitToolbar,
  pickNodeAt,
  playerAnchorWorld,
  worldToScreen,
  type Camera,
} from './render.ts';
import {
  CARD_FLIGHT_IMAGE,
  CARD_FLIGHT_NO_OBJECT,
  CARD_FLIGHT_TYPE,
  THROW_SETTLE_MS,
  cardFlightPlan,
  cardLandSfx,
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
  buildHammerDone,
  buildUpgradesOf,
  clipDone,
  BUILD_FX_ARCHIVE,
  manifestSoundFor,
  MANIFEST_BUILD_SOUND,
  stepBuildFx,
  type BuildClipName,
  type BuildFx,
} from './build-fx.ts';
// ★ 「送進監獄／醫院」那一段 FLIC（Q-ANIM-1 的「受管辖但仍未接」之一）——
//   与建屋影片同一套：整幅 FLIC 直接盖在棋盘上、**阻塞**、播完才放行回合驱动。
import { confineAfterEventBox, confineClip, confineFxTriggers } from './confine-fx.ts';
// ★★ 第二十五份試玩回報「为什么忽然出现拍卖」：破產那一刻的整屏影片（`Data.mkf` 0x22b）。
//   它是一条**整屏**（`screens.ts` 里排在拍賣屏之前），宿主这边只需要它的「还在演」那一位，
//   用来把事件 25（`afterStage`）与回合驱动押到影片之后。
import { bankruptFilmActive, resetBankruptScreen } from './bankrupt-screen.ts';
// ★ 神明降臨／發威那一段影片（Q-ANIM-1）—— 与住院/入獄同一支 `fcn_0045144f`，
//   于是共用 `board-film.ts` 的播放与下面那一份「棋盘影片」宿主状态。
import { godFilmSpec, godFxTrigger } from './god-fx.ts';
import { GOD_ASCEND_MAX_MS, GOD_ASCEND_SOUND, godAscendTrigger, type GodAscendCue } from './god-ascend-fx.ts';
// ★ 「踩到惡犬」那一段影片（試玩回報：踩到狗直接進醫院、没有咬人动画/配音）——
//   同一支 `fcn_0045144f` 的第三位客人，规格与判据见 `dog-fx.ts`。
import { dogBiteFxTrigger, filmPrecedesSendToHospital } from './dog-fx.ts';
// ★ 新聞 4「外星人攻打地球」的飛碟影片（試玩回報）—— 同一支 `fcn_0045144f`，
//   规格与判据见 `alien-news-fx.ts`。
import { alienNewsFxTrigger, NEWS_ALIEN_ID } from './alien-news-fx.ts';
// 第十二份試玩回報：新聞 5 / 15 / 20 / 21 的整块影片（龍捲風 0x217 等），见 `news-place-fx.ts`
import { newsPlaceFxTrigger } from './news-place-fx.ts';
// ★ 第二十二份（gap-audit #6）：新聞 18 地震 / 19 山洪的白闪 + 静置 —— 规格见 `news-flash-fx.ts`
// ★ A-2：命運 0 拆屋 / 1 徵收走同一支 `fcn_00451985`（共用尾巴 `0x0044bf46`）⇒ `fortuneFlashTrigger`
import { fortuneFlashTrigger, newsFlashPhase, newsFlashTrigger, type NewsFlashCue } from './news-flash-fx.ts';
import { disappearFxTrigger } from './disappear-fx.ts';
// ★ 魔法屋「就地拆除房屋」那一段 0x211（女巫窗口关掉之后 `0x431caa` 里播的）—— 规格/判据见 `magic-fx.ts`
import {
  MAGIC_DEMOLISH_FILM,
  freshMagicBeats,
  freshTurnBeats,
  magicDemolishFxTrigger,
  magicSequenceStart,
  magicSequenceStep,
  type MagicSequence,
} from './magic-fx.ts';
// ★ W-55 行 4：「惡魔顯靈拆屋」那一段 110×110 的爆破片 —— 规格/判据见 `devil-fx.ts`。
import {
  DEVIL_DEMOLISH_FRAME_MS,
  DEVIL_DEMOLISH_FRAMES,
  DEVIL_FX_RESOURCE,
  devilDemolishFilmAt,
  devilDemolishFxTrigger,
} from './devil-fx.ts';
// ★ 飛彈 / 核彈的爆炸影片（`Data.mkf` 0x210 / 0x212）—— 规格/判据见 `missile-fx.ts`。
import { missileFilmFor } from './missile-fx.ts';
import {
  beginBoardFilm,
  boardFilmBitmap,
  boardFilmDone,
  boardFilmHolding,
  boardFilmRedrawn,
  boardFilmWaitsForEventBox,
  type BoardFilm,
  type BoardFilmSpec,
} from './board-film.ts';
// ★ 影片窗口内棋盘按 **before** 那一帧画（试玩3 #1/#9，issue #19）——
//   原版 `fcn_0045144f` 是阻塞的，播完才重绘棋盘；core 却一条 action 就把
//   等级/附身写完了。纯函数与逐项判据见 `deferred-board.ts`。
import { boardFilmWindowOpen, boardStateForFilm, visibleBoardState, type BoardFilmWindow } from './deferred-board.ts';
import { AI_TOOL_NOTICE_KEY, applyVehicleHold, vehicleHoldOf, type VehicleHold } from './vehicle-hold.ts';
import { TOOLBAR_LABELS, loadSetupScene as loadSetupSceneAsset } from './assets.ts';
import { interactionUi, type InteractionUi } from './interactions.ts';
// ★ 「取消」那一拍的梯子 —— ESC 与右键**共用同一份**（原版就是这么干的：
//   钩子把取消键变成 `WM_RBUTTONUP 0x205`，主窗口过程只交给栈顶那扇窗）。
//   取证与全表见 `panel-cancel.ts` 头部。
import { CANCEL_SOUND, cancelLayerOf, type CancelLayer, type CancelSnapshot } from './panel-cancel.ts';
import { isExternalRejection } from './external-rejection.ts';
// ★ 触屏的「右键」：长按 = 右键 + 可见的「取消」钮（需求方 2026-09-24，见 `touch-input.ts`）
import {
  bindTouchGestures,
  cancelButtonPlacement,
  dispatchMouse,
  isTouchDevice,
  longPressAllowed,
  rightClickMeaningful,
} from './touch-input.ts';
import {
  REMINDER_BGM,
  REMINDER_CANCEL_SOUND,
  REMINDER_CLICK_SOUND,
  reminderCancel,
  reminderClick,
  reminderStart,
  reminderTick,
  type LoanReminderUi,
} from './loan-reminder.ts';
// ★ 股市柜台的填数页壳 —— 与銀行/公佈欄/上市企業**同一个**通用填数页。
import { stockAmountForm, stockCounterTradeSound } from './amount-form.ts';
// ★ 通用填数窗**自己那张键盘表**（@source `loc_00452e4b`）：0-9 / 退格 / C / M / H / Enter。
import {
  AMOUNT_WINDOW,
  resetAmountWindowPos,
  amountKeyOfVk,
  amountKeySound,
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
  AmountPressLatch,
  type AmountPage,
  type DialogHit,
} from './dialog.ts';
import { DICE_FLIC_BASE, GO_IMAGE, YESNO_IMAGE, YESNO_RESOURCE, type SpriteFn } from './gameui.ts';
import { GO_SIZE, goButton, boardToScreen } from './go-button.ts';
import { createCursorWarper, measureCanvas, type CursorWarpFrame } from './cursor-warp.ts';
// ★ W-60：回到棋盘那一帧续回合驱动（阻断级 bug 的唯一闸门）—— 判据见该模块文件头。
import { driverParkedByScreen, shouldResumeDriver } from './driver-resume.ts';
import { TOLL_FLASH_TOTAL_MS, tollFlashLevel } from './toll-flash-fx.ts';
import {
  noticeHoldsFilms,
  noticeKeyShowing,
  noticePendingRanks,
  noticeShowing,
  setNoticeCardPopup,
  setNoticeOverlayGate,
  setNoticeSpeechGate,
  setNoticeStartGate,
  queueLocalNotice,
  noticeBoxScreenState,
} from './notice-box-screen.ts';
// ★ 第十三份試玩回報 #1：顯靈加蓋那一格等「顯靈框」收掉才画成新等级（两次重画、两声音效 50）
import {
  MANIFEST_NOTICE_KEY,
  applyManifestHold,
  immediateManifestHints,
  manifestHoldOf,
  type ManifestHold,
} from './manifest-hold.ts';
// ★ 2026-09-22（第十一份試玩回報 #15）：訊息框的起播閘要看「轉盤 / 神明老虎機在不在播」
import { setWheelStartGate, wheelScreenState } from './wheel-screen.ts';
import { godSlotState, setGodSlotStartGate } from './god-slot.ts';
// ★ W-66-a：走子时那串**剩余步数**的大数字（规格/判据见该模块文件头）。
import {
  STEPS_COUNTER_ARCHIVE,
  STEPS_COUNTER_RESOURCE,
  stepsCounterPlan,
  stepsCounterShown,
  stepsCounterValue,
} from './steps-counter.ts';

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
import { CHARACTER_POSE, characterSetBase, characterSleepwalkSprite, type LoadedFlic } from './assets.ts';
import { HOTKEY, hotkeyOf, vkOf, type KeyBinding } from './hotkeys.ts';
import {
  configHotkeyKeys,
  decodeConfig,
  encodeConfig,
} from './config-file.ts';
import { SCENE_ARCHIVE, sceneFor } from './scenes.ts';
import { onMinigameBackgroundReady, setMinigameBackground, setPenguinHitMask } from './minigame-bg.ts';
import { PENGUIN_HIT_RES, parsePenguinHitMask } from './minigame-screen.ts';
import {
  CURSOR_ARCHIVE,
  CURSOR_RESOURCE,
  createSoftCursorLayer,
  cursorShape,
  localTurn,
  resolveCursor,
  type CursorFrame,
  type CursorShape,
  type CursorWant,
} from './soft-cursor.ts';
import {
  AUTOSAVE_SLOT,
  autosaveStep,
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
import { installTextEntryRecovery, installViewportFit, iosViewportContent, isIosWebKit } from './viewport.ts';
import { drawTitle, hitTitle, TITLE_RESOURCE } from './title.ts';
import {
  INTRO_ARCHIVE,
  INTRO_DOOR_RESOURCE,
  drawIntro,
  introDone,
  introFallResource,
  introJumpResource,
} from './intro.ts';
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
  atmOp,
  atmOpen,
  atmPress,
  atmPressSound,
  drawBankAtm,
  hitAtmButton,
  type AtmState,
} from './bank-screen.ts';
import {
  ATM_BAR,
  LOAN_SLIDE,
  LOAN_TICK_MS,
  atmApplyCode,
  atmCodeOfKey,
  atmDragToClick,
  atmSeekAmount,
  drawLoanBubble,
  drawLoanPanels,
  drawLoanPressed,
  loanDueDays,
  loanBubbleVoice,
  loanTickSlide,
  loanStart,
  loanStep,
  type LoanPanelsView,
  type LoanUi,
} from './bank-dynamic.ts';
import {
  INV_SLOTS,
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
  keeperPaintAfter,
  keeperPaintStart,
  type ShopKeeperPaint,
  cellItemAt,
  drawShopScreen,
  hitShopCell,
  hitShopExit,
  SHOP_EXIT_HIT,
  shopBubbleAfterClick,
  shopBubbleExpired,
  hitShopShelf,
  hitShopSwitch,
  shopEntryOf,
  shopMessage,
  shopRows,
  shopShellMayAnswer,
  shopWindowMayOpen,
  slideDone,
  slideStart,
  slideStep,
  type ShopBlink,
  type ShopPage,
  type ShopSlide,
} from './shop-screen.ts';
import {
  BAIL_CLERK_MS,
  BAIL_INMATE_AT,
  BAIL_INMATE_RESOURCE,
  BAIL_PLACES,
  BAIL_YESNO_CENTER,
  HOSPITAL_BYE_NURSE,
  bailFlowHasBubble,
  bailFlowOpen,
  bailFlowStep,
  canPayOnScreen,
  drawBailClerk,
  drawBailScreen,
  hitBailSlot,
  hitBailYesNo,
  type BailClerkBubble,
  type BailClerkKey,
  type BailEvent,
  type BailFlow,
  type BailSlotView,
} from './bail-screen.ts';
import { SCREENS } from './screens.ts';
// ★ 只给「挪指针」那条判据用（`cursor-warp.ts` 的另外三处固定落点）
import { facilityPickerScreen } from './facility-picker.ts';
import { setScapegoatPickerGate } from './scapegoat-picker.ts';
import { researchScreen } from './research-screen.ts';
// ★ 只给 dev 钩子用（`__rich4.auctionView()`）：竞价轮转发生在 canvas 屏里，
//   自动化看不见就没法验收「电脑跟不跟价、落槌演没演」。
import { auctionHumanPassPoint, auctionRunForTest, auctionTrace } from './auction-screen.ts';
// ★ 镜头该盯谁：判据是纯函数（第四份回报第 2/5 条）
import { cameraFollowTarget } from './camera-follow.ts';
// ★ 只给 dev 钩子用（`__rich4.lotteryDraw()`）：開獎屏要等到 15 号才出现
import { lotteryDrawCue, lotteryDrawView } from './lottery-draw-screen.ts';
import { openBigMap } from './big-map-screen.ts';
// ★ 遊戲百科（`helpScreen`）不在这里单独引 —— 它登记在 `screens.ts` 里，
//   ESC 与右键都走那条登记契约（本屏的 `hotkey` / `contextmenu` 是同一支）。
import { openHelpAt } from './help-screen.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';
import { pendingScreens } from './overlay.ts';
import { BLOCKING_PRESENTATIONS, DAY_AND_MAGIC_BOXES, PresentationHost } from './presentation-host.ts';
import { dividendDayCrossed } from './shares-screen.ts';
import { DisplayList, installBitmapCloseGuard } from './display-list.ts';
import { installPageVisibility } from './page-visibility.ts';
import {
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
  COMPANY_BUILD_PARAM,
  teleportTargetParam,
  type PickEdge,
  type PickSession,
} from './picking.ts';
import {
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
import {
  HD_STORAGE_KEY,
  MAX_SURFACE_SCALE,
  drawSprite,
  drawSurface,
  hdStageRequested,
  setCurrentSurfaceScale,
  sizeSurface,
  surfaceScaleCap,
  surfaceScaleFor,
} from './hd-stage.ts';

/**
 * HD 清单的文件名 —— `hdBase()` 是 `${assetBase() 去掉 /game}/hd`，清单在它旁边。
 * 与 `packages/server/src/static.ts` 的素材白名单无关（HD 走另一条路）。
 */
const HD_MANIFEST_NAME = `${hdTierDir()}-manifest.json`;

/**
 * 超分清单的版本（`assets-manifest.json` 里登记了它就有：sha256 前 8 位）。
 *
 * ★ 2026-09-24（W-80 §8 上线）改了口径：先前是「清单里**没有**就一次都不问」（W-72 §5 —— 那时
 *   仓库里那份 3.8 MB 的规划清单没有一张产物，白拉）。线上的超分清单现在是 `tools/hd-deploy.ts`
 *   只挑已验证那几组生成的小清单（brotli 后约 20 KB），没登记时问一次、404 就整包走原图，代价可忽略；
 *   登记了就带 `?v=` 去拉，服务器按不可变长期缓存（`static.ts` 的 `cacheControlFor`）。
 *   这样部署 HD 不必重跑 `precompress` 改 `assets-manifest.json`（那份清单同时管着 7 个档案的长度校验）。
 */
let hdManifestVersion: string | null = null;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>('board');
// ★ 第十二份試玩回報：iPad Safari 地址栏遮住工具栏 —— 页面钉在 `visualViewport` 上，
//   不再用 `100vh`（见 viewport.ts）。越早越好：大厅/门厅也在这块区域里。
const refitViewport = installViewportFit(window, document.body.style);
// ★ 第二十七份（iPhone Safari）「输入文字后画面显示不全」：iOS 上 meta viewport 常驻
//   `maximum-scale=1`（只挡聚焦自动放大，双指缩放照旧），文字框失焦 / 转向后把卷动、缩放
//   收拾回来并按可视区重钉舞台（见 viewport.ts 的 `installTextEntryRecovery`）。
const viewportMeta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
if (viewportMeta !== null && isIosWebKit(navigator)) viewportMeta.content = iosViewportContent(viewportMeta.content);
installTextEntryRecovery({
  win: window,
  doc: document,
  meta: viewportMeta,
  isTextEntry: (t) => isTextEntryTarget(t as EventTarget | null),
  refit: () => {
    refitViewport();
    requestRender();
  },
});
// ⚠️ 側欄不再是独立的 HTML 画布 —— 它是舞台 640×480 里的一块
//   （见 stage.ts 的 LAYOUT.panel），跟着一起缩放，命中判定也走舞台坐标。
const ctx = (() => {
  // ★ 第十九份：不透明画布（每帧先铺黑再贴舞台，本来就没有透明像素）—— 合成时少一次与页面的混合
  const c = canvas.getContext('2d', { alpha: false });
  if (c === null) throw new Error('无法取得 2D 绘图上下文');
  return c;
})();

const logEl = $('log');
const metaEl = $('meta');
const playersEl = $('players');
const actionsEl = $('actions');
const interactionEl = $('interaction');
// ★ W-72 载入屏的三件 DOM（在 `index.html` 里，默认 `hidden`）
const loadBarEl = $('loadbar');
const loadFillEl = $('loadfill');
const loadHintEl = $('loadhint');
const loadRetryEl = $<HTMLButtonElement>('loadretry');
// ★ 一键回报（左下角）
const feedbackBtnEl = $<HTMLButtonElement>('feedback');
const feedbackPanelEl = $<HTMLDivElement>('feedbackpanel');
const feedbackNoteEl = $<HTMLTextAreaElement>('feedbacknote');
const feedbackSendEl = $<HTMLButtonElement>('feedbacksend');
const feedbackCancelEl = $<HTMLButtonElement>('feedbackcancel');
feedbackBtnEl.addEventListener('click', () => {
  feedbackPanelEl.hidden = !feedbackPanelEl.hidden;
  if (!feedbackPanelEl.hidden) feedbackNoteEl.focus();
});
feedbackCancelEl.addEventListener('click', () => {
  feedbackPanelEl.hidden = true;
});
feedbackSendEl.addEventListener('click', () => {
  const note = feedbackNoteEl.value.trim();
  feedbackPanelEl.hidden = true;
  feedbackNoteEl.value = '';
  fileReport('manual', note);
});
// 面板开着时键盘输入是给 textarea 的，别让棋盘的热键（F9 除外）抢走
feedbackNoteEl.addEventListener('keydown', (e) => {
  if (e.key !== 'F9') e.stopPropagation();
});
// ★ W-75 联机提示（右下角堆叠 + 被託管的常驻横幅）
const toastsEl = $('toasts');
const autopilotBannerEl = $('autopilotbanner');
const netToasts = new NetToasts(document, toastsEl, autopilotBannerEl);
/** 上一份房间快照 —— `roomToasts()` 靠前后两份比出「谁进来了 / 谁掉线 / 谁被託管」 */
let lastToastRoom: RoomInfo | null = null;
/**
 * **进房那一刻这一局开了没有**（`RoomInfo.started`，`hub.ts`：`started: t.room !== null`）。
 *
 * ★★ 第九份试玩回报（2026-09-22，Charles）「多人模式开局没有机舱跳伞的过场动画」——
 *   联机要接 `screen = 'intro'`，但**只有「刚开局」那一次**：
 *   刷新 / 断线重连时服务器会补发 `start`（`hub.ts` 的 `since` 补发），
 *   若无条件播过场，每刷新一次就得重看 13 秒。
 *   `since === undefined` 区分不开这两件事（刷新后它本来就是 undefined），
 *   而 `onJoined` 拿到的 `started` 分得开：刚开局 = false、重连 = true。
 *
 * 在 `onJoined` 里写、在 `onStart` 里读（两者同一个 `connectOnline` 闭包，
 * 且 `onJoined` 必先于 `onStart`）。
 */
let roomJoinedUnstarted = false;

// ★ W-74 回合计时（棋盘右上角，剩余 ≤ 20 秒才露出来）
const clockEl = $('clock');
const clockNumEl = $('clocknum');
const clockNameEl = $('clockname');

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
 * 日曆那一面画哪个版式（原版 `[0x497164]` = `RICH4.CFG` +12，出厂 0 = 日曆）。
 *
 * ★★ 第二十一份（「设置里配置组合画面时和原版不符」）：先前这里是一个把**两件事**揉在一起的
 *   `sidebarView: 'calendar' | 'month' | 'map'` —— 右栏版式（`cfg+5`）与日/月曆版式（`[0x497164]`）。
 *   于是 `cfg+5 = 2`（組合畫面）没处可放，被当成日曆。现在拆开：
 *   **右栏版式每帧直接读 `options.windowView`**（原版每次重画都直接读 `cfg+5`，
 *   `fcn_00416e6d` 的 `0x416e74`、`fcn_004169bc` 的 `0x4169c3`、WM_PAINT 的 `0x418bcd`）。
 *
 * ★★ pt22 #12：日/月曆那一格也不再是模块级变量 —— 它就是 cfg 的 +12（`options.calendar`），
 *   开机随 cfg 读回（`loadConfigFromStore`）、点太阳 / 月亮时写回（`saveConfigToStore`），
 *   刷新 / 重开不再回到日曆。原版 `fcn_004169bc` 每次重画都直接读 `[0x497164]`（`0x004169fd`），
 *   这里同样每帧从 `options` 取，没有另存的一份。
 */
function calendarPageOf(o: GameOptions): CalendarPage {
  return o.calendar !== 0 ? 'month' : 'calendar';
}

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
  if (cfg !== null) {
    options = {
      ...options,
      speed: cfg.speed,
      animation: cfg.animation,
      music: cfg.music,
      sound: cfg.sound,
      autoSave: cfg.autoSave,
      windowView: cfg.view,
      // cfg+12 日/月曆（pt22 #12）；旧档没有这一格时 decode 读到的是 0 = 日曆（与出厂同）
      calendar: cfg.calendar ?? 0,
    };
    optionsKeys = configHotkeyKeys(cfg);
  }
  // ★★ 第十一份 #8 / 第十六份：侧栏与設定屏必须同源 —— 现在右栏版式**每帧直接读
  //   `options.windowView`**（`hud.draw` 的 `windowView`），不再有另存的一份，
  //   开机、設定「確定」、熱鍵「切換視窗組」改的都是 `options` 这一处 ⇒ 单机与联机同一条路。
  // 音量也在开机就按 cfg（或出厂值）作用上 —— 只有音量，不写档、不起停曲子（见 `applyVolumes`）
  applyVolumes(options);
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
    calendar: options.calendar,
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
/** 金额定了怎么变成 action；`mode` = 按確認那一刻的提/存（见 `ATM_MODE`：0 提款、1 存款）*/
let atmFill: ((n: number, mode: number) => Action) | null = null;
let atmLabel = '';
/**
 * ★ 第八份试玩回报 #4：**路过銀行**的 ATM（`pending.kind === 'atm'`）—— 原版 `fcn_004379c9` 的 ATM 窗是模态的，
 *   办完一笔（或关窗）就返回，走子在它后面。
 * ★ 第十三份试玩回报 #2：**落在**銀行上也是先开这一台（`pending.landing`），答掉之后 core 才换成貸款屏
 *   （`0x0041b396 call 0x4379c9` → `0x0041b3af call 0x436668`）。
 *   本标志记「这一次 pending 已经开过窗」：玩家右键关掉后 `declineDecision` 把 pending 清掉（或换成貸款屏），下一次再开。
 */
let atmPassOpened = false;

/** 每次 action 之后：core 给出 `pending.kind === 'atm'`（路过 / 落点）⇒ 给本机座位开 ATM；pending 没了 ⇒ 复位 */
function syncAtmPending(): void {
  const p = state.pending;
  if (p === null || p.kind !== 'atm') {
    atmPassOpened = false;
    return;
  }
  if (atmPassOpened || atm !== null || !localSeatActive()) return;
  const me = state.players[state.currentPlayer];
  if (me === undefined) return;
  atmPassOpened = true;
  // ★ 第十三份试玩回报 #1：模式 0 = 提款（左上）、1 = 存款（中间）；暫停放款时默认存款 —— 见 `bank-screen.ts` 文件头
  atm = atmOpen(me.cash, me.moneyInBank, bankFrozen());
  atmFill = (n, mode) => ({ type: 'bank', op: atmOp(mode), amount: n });
  atmLabel = p.landing === true ? '銀行' : '路過銀行';
  // 原版 `fcn_004379c9` 开窗那段（`0x437a2d..0x437a76`）只装 Panel #24 + 跑模态窗，**没有**开窗音效
  requestRender();
}
/**
 * ATM 正被按住的「码」（原版 `[0x48c40b]`，= 钮序号 + 1；`null` = 没按住）。
 *
 * 鼠标那一路由按下/抬起各写一次；**键盘那一路原版是「按下 → 假装抬手」**，
 * 所以这里记一个 `atmCodeAt`，下一拍（`BANK_TICK_MS`）就自动清掉 ——
 * 效果是按下图只亮一瞬，与「假抬手」同观感。
 */
let atmCode: number | null = null;
let atmCodeAt = 0;

/** ATM 按下那一声（Effect.mkf）—— 码 → 音效见 `atmPressSound` */
function atmSound(code: number): void {
  const id = atmPressSound(code);
  if (id !== null) sound.play('Effect.mkf', id);
}

/** 关掉 ATM 面板 */
function closeAtm(): void {
  atm = null;
  atmFill = null;
  atmCode = null;
}

/**
 * 「什么都不办」地关掉 ATM（EXIT 钮 / 键盘 EXIT / 右键 / Esc 四条路汇到这里）。
 * 路过銀行那台还挂着 `pending.kind === 'atm'`：关窗 = 这一格办完了，得把 pending 放掉走子才接得上
 * （core 的 `declineDecision` 对它只清 pending、不结束回合）。落点銀行屏里那台没有 pending，只关面板。
 */
function dismissAtm(): void {
  closeAtm();
  if (state.pending?.kind === 'atm') dispatch({ type: 'declineDecision' });
  requestRender();
}

/**
 * 本机模态窗跟着回合走（判据在 `turn-modals.ts`）：ATM 只随本机回合里的 `pending{atm}` 活着；
 * 选目标 / 点数盘 / 选股 / 設施类别 / 搶奪挑件在回合离开本机真人时收掉。
 * ★ 被收走不是「本人取消」：不回调、不放取消音、不重开卡片欄、不派 action。
 */
function dropStaleLocalModals(): void {
  const stale = staleLocalModals(
    { pendingKind: state.pending?.kind ?? null, localTurn: localTurn({ state, localSeat: net?.seat ?? null }) },
    {
      atm: atm !== null,
      pick: pick !== null,
      dicePick: dicePick !== null,
      stockPick: stockPick !== null,
      facilityPicker: facilityPickerOpen(),
      stealPicker: stealPickerOpen(),
    },
  );
  for (const k of stale) dropLocalModal(k);
  if (stale.length > 0) {
    log(`▷ 回合已不在本機：收掉 ${stale.join(' / ')}`);
    requestRender();
  }
}

function dropLocalModal(k: LocalModal): void {
  switch (k) {
    case 'atm':
      closeAtm();
      return;
    case 'pick':
      endPick();
      return;
    case 'dicePick':
      dicePick = null;
      return;
    case 'stockPick':
      stockPick = null;
      stockPickAt = null;
      if (screen === 'stock') closeStock();
      return;
    case 'facilityPicker':
      resetFacilityPicker();
      return;
    case 'stealPicker':
      resetStealPicker();
      return;
  }
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
  const mode = st.mode;
  closeAtm();
  if (n > 0 && fill !== null) {
    log(`▶ ${atmLabel} ${n}`);
    dispatch(fill(n, mode));
  } else if (state.pending?.kind === 'atm') {
    // 路过銀行那台：没填数就按確認 = 关窗走人（原版模态窗返回 0 ⇒ 什么都不办）
    dispatch({ type: 'declineDecision' });
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
  // 键盘那一声：`0x00437571` 放 7；H（码 4）改发一次按下走金额栏那一支 ⇒ 9（`atmPressSound` 同一张表）
  atmSound(code);
  const btn = code - 1;
  if (btn === 3) {
    // @source `loc_004375dc`：合成一次金额栏点击，坐标 (0xdc, 0xdf) = (220,223)
    atmSeekTo(0xdc);
    return;
  }
  if (btn === 2) {
    dismissAtm();
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
  amountWindowOpened();
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
/** 进门那扇「銀行暫停放款」还在弹，开场押着（记的是那条 action 的 `notices` 引用）*/
let loanFrozenWait: GameState['notices'] | null = null;
/** 已经等过的那一份 `notices`（押过一次就不再押）*/
let loanFrozenHandled: GameState['notices'] | null = null;

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
    // ★ 2026-09-23：进门正暫停放款时，原版在 `0x405` 那一拍**先**弹「銀行暫停放款」（阻塞 1500 ms，
    //   `0x004351f8 call 0x440cac`），框收了才往下走到招呼（`0x00435200`）⇒ 框还在就先不开场。
    if (state.notices !== loanFrozenHandled && state.notices.some((n) => n.key === 'bank.loanFrozen')) {
      // 这一拍訊息框还没入队（`notifyApplied` 里整屏的 `event` 在本函数之后）⇒ 先记下，交给 `bankTick` 等它收
      loanFrozenWait = state.notices;
      return;
    }
    // ★ 那一句招呼归「動畫過程」管：@source `loc_00435200`（VA 0x00435200，銀行 `0x405` 那一拍）
    //   `cmp byte [0x497159], 0 / je → st = 3`（`[0x48c3d5]` 直接跳到「需要我為您服務嗎」
    //   那一档，**不**说 `#0075`）。`[0x497159]` 就是 `RICH4.CFG+1`（`rich4_read_config()`
    //   VA 0x00411e8f 把 72 字节读进 `0x497158`），本引擎对应 `options.animation`。
    //   先前这里写死 `true` —— 设定关掉也照样打招呼（已订正，见 Q-ANIM-1）。
    loanUi = loanStart(options.animation);
    // ★ 进屏那一句招呼的**语音**（`#0075`）：原版 `0x00435210 mov esi,[0x475830]` →
    //   `0x00435d8c call 0x44ecb6` → `0x0044edae call 0x44fabc`（认 `#`）→
    //   `0x0044fb4e call 0x45441a`（`play_speech`）。见 `loanBubbleVoice` 的取证块。
    loanBubbleVoice(null, loanUi.bubble);
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
  // ★★ 第二十六份 panel #2：点掉 / 右键（`0x44ee18(1)`，`0x00434b6c` / `0x00435c1f` / `0x00435f8b` …，`0x0044ee30`
  //   停语音）—— 这几条路都会换掉或收掉气泡，故「气泡变了」就停。换成带语音的新句时这一停是多余的
  //   （`VoiceChannel` 起新句本来就先停旧句），但换成无语音 / 收掉那几条路少不了它，留着。
  if (hadBubble !== null && ui.bubble !== hadBubble) stopVoice();
  if (loanBubbleVoice(hadBubble, ui.bubble)) loanBubbleAt = performance.now();
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

// ── 还款提醒窗（距还款日 3 天、恰好真人，`0x43695e` → `0x436034`）──────────
//
// core 挂 `pending {kind:'loanReminder'}`（相位 `turnStart`）；演法全在 `loan-reminder.ts`，
// 这里只接 IO：开场、每拍、鼠标、关窗时派 `declineDecision`。

/** 提醒窗的演出状态；`null` = 没开 */
let reminderUi: LoanReminderUi | null = null;
/** 已经关过的那一份 pending（联机时关窗那一条还没广播回来，别把同一扇再开一次）*/
let reminderClosed: GameState['pending'] = null;

/** 提醒窗上称呼的名字（`0x00436176 mov ecx, [player+0x00]` → `0x452946` 取名）*/
function reminderName(): string {
  const me = state.players[state.currentPlayer];
  return me === undefined ? '' : (CHARACTERS[me.character]?.name ?? '');
}

/** 该不该开 / 该不该还开着 */
function syncLoanReminder(now: number): void {
  const p = state.pending;
  if (p === null || p.kind !== 'loanReminder' || isAiTurn(state) || p === reminderClosed) {
    reminderUi = null;
    return;
  }
  if (reminderUi !== null) return;
  // ★ 这扇窗在 `0x41c84f` 里，排在同一条 `endTurn` 的日推进（月結屏 / 開獎 / 訊息框…）之后 ⇒ 那些先收场
  if (activeUiScreen() !== null) return;
  // ★★ 第二十六份 panel：换人那一条还在演分界之前那一段（惡人那一趟 / 推日期）⇒ 等它
  if (turnHandoffPending()) return;
  reminderUi = reminderStart(reminderName(), now);
  // @source `0x004369e0 push 4 / call 0x4549cf` —— 貸款屏那一首
  void playTrackFile(REMINDER_BGM);
  requestRender();
}

/** 每帧：开场 / 50 ms 一拍的换句 / 第三句收了就关窗 */
function reminderFrame(now: number): void {
  syncLoanReminder(now);
  if (reminderUi === null) return;
  const r = reminderTick(reminderUi, now, reminderName(), voiceBusy());
  if (r.ui !== reminderUi) {
    reminderUi = r.ui;
    requestRender();
  }
  if (r.close) {
    // @source `0x0043622f KillTimer` / `0x00436240 call 0x401966(0)` —— 窗关了，`0x41c84f` 接着走
    reminderClosed = state.pending;
    reminderUi = null;
    requestRender();
    dispatch({ type: 'declineDecision' });
  }
}

/**
 * 貸款屏每帧走一次（对应原版那支 50ms 的 `0x113` 定时器）：
 * 推滑入、气泡到点（`fcn_0044ee18` —— **没有气泡时它也返回 1**）、
 * 键盘按下码那一瞬的清除。
 */
function bankTick(now: number): void {
  if (atmCode !== null && now - atmCodeAt >= BANK_TICK_MS) atmCode = null;
  reminderFrame(now);
  // ★ 2026-09-23：进门那扇「銀行暫停放款」收了才开场（见 `syncLoanUi`）
  if (loanUi === null && loanFrozenWait !== null) {
    if (noticeBoxScreenActive()) return;
    loanFrozenHandled = loanFrozenWait;
    loanFrozenWait = null;
    if (!aiVenuePending(state)) syncLoanUi();
    requestRender();
  }
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
  // 先走滑入那一段（退净 + 办成过一笔 → st = 0xb），再轮到气泡到点那张表 —— 与原版同一拍的次序
  loanUi = loanTickSlide(loanUi);
  const bubble = loanUi.bubble;
  // ★★ 第二十六份 panel #2：`fcn_0044ee18(0)`（`0x00434766` / `0x00435669`）—— 满 `LOAN_BUBBLE_MS` **且**语音放完才到点
  if (bubble === null || captionExpired(loanBubbleAt, now)) {
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
function loanPanelView(ui: Pick<LoanUi, 'slide'>): LoanPanelsView {
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

/**
 * ★ 2026-09-25 审计补：谁在**自己的回合**里开的股市屏 —— 关屏时替他交 `{type:'stockScreen', op:'close'}`
 *   （`0x0042ba86 push 0 / 0x0042ba88 call 0x436b0a`：三种模式的出口都强制收回特別融資）。
 *   别人的回合里开着看（或联机里不是本机的回合）⇒ 不交。
 */
let stockOpenedOnOwnTurn = false;

function markStockOpener(): void {
  stockOpenedOnOwnTurn = localTurn({ state, localSeat: net?.seat ?? null });
}

function dispatchStockClose(): void {
  if (!stockOpenedOnOwnTurn) return;
  stockOpenedOnOwnTurn = false;
  if (!localTurn({ state, localSeat: net?.seat ?? null })) return;
  const a: Action = { type: 'stockScreen', op: 'close' };
  // 只在真会改局面时才发（空操作在联机里会被定序器当非法拒掉）
  if (reduce(state, a, topo) !== state) dispatch(a);
}

function openStock(): void {
  if (screen === 'stock') return;
  markStockOpener();
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
  dispatchStockClose();
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
  markStockOpener();
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
  // 抛回 0 ⇒ 紅卡/黑卡函数返回 0（`0x0044501e test esi,esi / je 0x445032` → `mov eax, ebx`）
  //   ⇒ `_rich4_ui_use_card_entry` 失败音 3 + 把卡片欄再开回来（@source `0x00441cd9` / `loc_00441ce1`）
  cardUseFailed();
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
      // ★ 2026-09-23：原版弹訊息框「漲停無法買進！」—— `0x0042af18 push 0x800003e8` / `0x0042af1d mov eax,0x464088`
      //   / `0x0042af23 call 0x440cac`：**1000 ms、整扇右移 100**（bit31）。先前只写了一行日志。
      log(`▶ ${STOCK_NO_BUY}`);
      queueLocalNotice({ key: 'stock.limitUpNoBuy', args: [], holdMs: 1000, shiftRight: true });
      requestRender();
      return;
    }
    // 上限 = min(流通量, 存款 ÷ 股价) @source `loc_0042af30`
    // ★ 算式收在 `stock-screen.ts` 的 `stockCounterBuyMax`（与上市企業那条
    //   并列：两条上限都由模块给出，这里只把结果交给通用填数窗）
    const max = stockCounterBuyMax(me.moneyInBank, st.price, st.f10);
    if (max <= 0) return;
    stockAmount = { kind: 'buy', stock: row, max };
  } else {
    // ★ 次序照原版：先看有没有持股（`0x0042b019 cmp [持股], 0 / je 退`），再看跌停 —— 没持股就连框都不弹
    const held = state.holdings[state.currentPlayer]?.[row]?.amount ?? 0;
    if (held <= 0) return;
    if (status === STOCK_STATUS.limitDown) {
      // ★ 2026-09-23：「跌停無法賣出！」—— `0x0042b04b push 0x800003e8` / `0x0042b050 mov eax,0x464097`
      //   / `jmp 0x42af22`（与漲停同一处 `call 0x440cac`）：1000 ms、右移 100
      log(`▶ ${STOCK_NO_SELL}`);
      queueLocalNotice({ key: 'stock.limitDownNoSell', args: [], holdMs: 1000, shiftRight: true });
      requestRender();
      return;
    }
    stockAmount = { kind: 'sell', stock: row, max: held };
  }
  amountWindowOpened();
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
  // ★ 聯機存檔（v6）：聯機時「存檔」存到**伺服器**（房主取名）；「讀檔」會把本機拉離大家的局面，不給
  if (net !== null) {
    if (mode === 'save') void promptNetSave();
    else showNetNotice('聯機中不能讀檔：要接著玩以前的局，請從房間列表「建立房間 → 從存檔繼續」');
    return;
  }
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
  // ★ 读档进棋盘也走 `sub_00401981(1)`（標題读档 `0x401d08 push 1 / jmp 0x401cfe`）⇒ 同样 Post 0x401
  //   ⇒ 面板页号归零（`0x48be24`）；自動存檔从读进来的那一天重新算起（`autosaveStep`）
  panelPages.fill(0);
  autosaveDateKey = null;
  const first = map.nodes[state.players[state.currentPlayer]?.nodeId ?? 1];
  camera = pixelCamera(first?.x ?? 0, first?.y ?? 0, state.viewRotation);
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
// ★ 第十六份：表本体搬到 `presentation-host.ts`（`BLOCKING_PRESENTATIONS`），与单测共用

/**
 * 此刻是不是有一段**纯演出**在接管整屏（判据就是上面那张表）。
 *
 * ★ 抽出来给两处共用：`stageBusyFlags()`（`holdForActorWalk` / 台词的闸），
 *   以及各屏自己的判断。
 */
function blockingPresentation(): boolean {
  // ★★ 第十六份：判据收在 `presentation-host.ts`（与单测同一份）—— 保釋收尾 / 押着的推日期屏 /
  //   接管整屏的那一屏是演出类（女巫窗等点格、訊息框只是排着等台词这两种除外）
  return presentationHost.screensBlocking();
}

/** 保釋屏答完之后那段收尾还在演（见 `blockingPresentation`）*/
function bailClosing(): boolean {
  return bailFlow !== null && state.pending?.kind !== 'bail';
}

/**
 * ★★ W-51：此刻「台上还忙着」的九个条件 —— `stageBusy()`（`stage-gate.ts`，
 * **纯函数、有单测**）的**宿主取值**。这里是唯一一处把它们从运行时状态里取出来的地方。
 *
 * 清单与 `holdForActorWalk` / `queueSpeech` / `speechTick` 共用的那一套**必须同一份**：
 * 两边各写一套必然漂移 —— 多一位 = 台词被永久押着（死锁），少一位 = 台词抢在影片前面。
 *
 * 每一位的来历（都在下面 `holdForActorWalk` 的旧注释里、逐条带 @source）：
 *   - `blockingPresentation`：纯演出整屏（轉盤 / 訊息框 / 事件框 / 月結 …）；
 *   - `boardFilm` / `pendingBoardFilm`：住院 `0x20c`(62×100ms) / 入獄 `0x20d`(35×71ms) /
 *     神明 / 狗咬 `0x214` / 飛碟 `0x213` 那几段**阻塞**影片（`fcn_0045144f`）；
 *   - `pendingBoardFilmAfter`：「狗咬刚播完、救护车还没起播」那一拍的空档；
 *   - `buildFx` / `pendingBuildFx`：機器工人大锤 3876ms + 满级 2772ms；
 *   - `objectFlight`：放置類道具的投掷（`place_object → animate_object → 音效` 是阻塞的，
 *     VA 0x00446bf4 起）。**卡片飞行共用这一位** —— `startCardFlight` 的两个分支都走
 *     `beginObjectFlight`，没有第二个状态变量；
 *   - `walkDone`：走子补间（`renderer.walkDone()`，**已含替身那条**）；
 *   - `diceFxActive`：掷骰三段（预动作 / 滚骰 / 定格）。
 */
function stageBusyFlags(withScreens = true): StageFlags {
  return {
    // ★ 第十六份：`withScreens = false` 给「影片那一类」用（`presentationHost` 的 `filmsBusy`）——
    //   那条路**不许**回头问整屏判据（上一版就是在这里转成了无限递归）
    blockingPresentation: withScreens ? blockingPresentation() : bailClosing(),
    boardFilm: boardFilm !== null,
    pendingBoardFilm: pendingBoardFilm !== null,
    pendingBoardFilmAfter: pendingBoardFilmAfter !== null,
    buildFx: buildFx !== null,
    pendingBuildFx: pendingBuildFx !== null,
    // ★ 挂起的卡片飞行（等亮牌收屏）也算「台上还忙」—— 否则亮牌一收、飞行起播之前那一拍
    //   回合驱动会抢先派下一步
    objectFlight: objectFlight !== null || pendingCardFlight !== null,
    walkDone: renderer.walkDone(),
    diceFxActive: diceFx.active,
    // ★ W-69：過路費閃爍（`fcn_00451985` 是阻塞的，原版在費用訊息框之前）
    // ★ 第二十二份：新聞 18 / 19 那一段（排着 / 闪 / 静置）同算这一位 —— 同一支阻塞的 `fcn_00451985`
    // ★ A-2：命運 0 / 1 那一支（共用尾巴 `0x0044bf46 call 0x451985`）也走这同一个槽
    tollFlash: tollFlash !== null || newsFlash !== null,
    godLine: godLine !== null || pendingGodLine !== null,
    godAscend: godAscend !== null,
    // ★★ 第二十五份：破產影片（`Data.mkf` 0x22b，排在拍賣屏之前的那条整屏）——
    //   原版它是阻塞的，事件 25「不過是運氣差了點～」（`afterStage`）排在它后面。
    //   ⚠️ 判据直接问那一屏自己的状态（它不含任何规则，也不回头问这里 ⇒ 不成环）。
    bankruptFx: bankruptFilmActive(),
  };
}

/**
 * ★ 第十九份（iPhone 发烫）：页面在后台。浏览器此时不跑 rAF ⇒ 演出全冻住，
 *   回合驱动 / 联机收件箱若照旧按渲染周期重排，只是在后台每秒空转几十次。
 */
let pageHidden = false;
/** 后台时有驱动被停在闸口上（回前台要叫醒它们） */
let driversParked = false;

function holdForActorWalk(reschedule: () => void): boolean {
  // ★ 第十九份：后台时不重排 —— 停在这里，回前台由 `onPageShown()` 统一叫醒
  //   （action 还没派 / 收件箱那条还没施加，醒来重新判一次，一条不丢）
  if (pageHidden) {
    driversParked = true;
    return true;
  }
  const held = holdForActorWalkReason();
  noteHold(held);
  if (held === null) return false;
  if (held === 'npcWalk') requestAnimationFrame(reschedule);
  else reschedule();
  return true;
}

/** `holdForActorWalk` 的判据本体：挡着就返回原因，放行返回 null（第十六份：拆出来好计时）*/
function holdForActorWalkReason(): string | null {
  // ★★ 审计 #15：过场期间一步都不派（定时器在过场开始前就排好的那一拍也挡住）
  if (driverParkedByScreen(screen)) return 'intro';
  if (screen !== 'game') return null;
  // ★ D-MAGIC-16：魔法屋逐人那几段还没演完（原版 `0x431caa` 整个循环是阻塞的）
  if (magicSeq !== null) {
    return 'magicSeq';
  }
  // ★ 台上还有演出 ⇒ 等它收摊再派下一步。判据收在 `stageBusy()`（W-51）里，
  //   与 `queueSpeech` / `speechTick` 共用同一份清单 —— 逐位的来历见 `stageBusyFlags`。
  //   （原先这里是九个 `if` 各写一遍：纯演出整屏 / 走子补间 / 物件飞行 / 建屋片 /
  //     棋盘影片 / 两段影片之间的空档；现在一位不多、一位不少地收在一处。）
  if (stageBusy(stageBusyFlags())) {
    return `stage:${stageBusyReason()}`;
  }
  // ★ 第十四份：飛機 / 飛碟那一段还押着（等台词 / 理賠框）—— 它不进 `stageBusy`
  //   （否则押后的台词永远等它，而它又在等台词），回合驱动单独在这里等
  if (pendingDisappearFx !== null) {
    return 'disappearFx';
  }
  // ★ 审计 #17：住进旅館那一段还没起步（等落点例程的框 / 台词收完）—— 同上，不进 `stageBusy`
  if (pendingRelocateWalk !== null) {
    return 'relocateWalk';
  }
  // ★ 第十五份：命運 pass 1 里的演出之后还要对着棋盘停 800 ms（`0x0044dd7b`），数完才轮下一步
  if (eventBoxTailPending()) {
    return 'eventBoxTail';
  }
  if (state.lastNpcWalks.length > 0 && state.lastNpcWalks !== npcWalksDrawn) {
    npcWalksDrawn = state.lastNpcWalks;
    return 'npcWalk';
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
  //   （`speechQueue.tick`），而 `speechTick` 会把**演出期间**派生出来的台词
  //   押在 `heldSpeech` 里（见 `queueSpeech`），所以「屏还在演」与
  //   「台词还没说完」两件事由这一条一并挡住。
  if (speechQueue.length > 0 || heldSpeech.length > 0) {
    return 'speech';
  }
  // ★ 第十四份試玩回報：落在地産格上，落点例程收尾之后原版还要**原地停 8 个 tick** 才换人
  //   （`0x0041b111` 返回 0x88 → `0x0040d840` 每 tick 减一 → 数完才 `0x0040d86f call 0x418ebd`）；
  //   回合开头就被挡（坐牢/住院…框收掉之后）是 3 个 tick（`0x00418ead` 0x83）。
  //   台上刚空下来那一拍起算（顯靈框收掉、2 级露面的那一次重画就在这 8 tick 里被看见）。
  if (landingPause !== null) {
    if (state.phase !== 'turnEnd' || (state.pending !== null && state.pending.kind !== 'none')) {
      if (state.phase !== 'turnEnd') landingPause = null;
    } else {
      const r = landingPauseRemaining(landingPause, performance.now(), tickMs(options.speed));
      landingPause = r.pause;
      if (r.waitMs > 0) {
        return 'landingPause'; // 与上面几道闸同一个重排：一个渲染周期后回头再看
      }
      landingPause = null;
    }
  }
  return null;
}

/** 台上忙的是哪一位（`stageBusy` 为真时）—— 计时 / 日志用；`blockingPresentation` 再细到哪一屏 */
function stageBusyReason(): string {
  const f = stageBusyFlags();
  if (f.blockingPresentation) return `screen:${activeUiScreen()?.id ?? (bailClosing() ? 'bail' : deferredScreenEvents.length > 0 ? 'deferred' : '?')}`;
  for (const [k, v] of Object.entries(f)) if (k === 'walkDone' ? v === false : v === true) return k;
  return '?';
}

/**
 * ★ 第十六份：回合驱动 / 联机收件箱**被挡了多久、挡在哪**（每条原因累计毫秒）—— `__rich4.presStats()` 读。
 * 两次询问之间的时间记给上一次的原因（驱动每个渲染周期问一次）。
 */
const presentationStats: { holdMs: Record<string, number>; unwinds: number; lastAt: number; lastReason: string | null } = {
  holdMs: {},
  unwinds: 0,
  lastAt: 0,
  lastReason: null,
};
function noteHold(reason: string | null): void {
  const now = performance.now();
  const prev = presentationStats.lastReason;
  if (prev !== null && presentationStats.lastAt > 0) {
    const dt = Math.min(now - presentationStats.lastAt, 1000);
    presentationStats.holdMs[prev] = (presentationStats.holdMs[prev] ?? 0) + dt;
  }
  presentationStats.lastAt = now;
  presentationStats.lastReason = reason;
}

/** 落点收尾后的那 8 tick（`landing-pause.ts`）；`null` = 没有要停的 */
let landingPause: LandingPause | null = null;

/**
 * 自動存檔：上一次「已经算过」的游戏日期（`gameDateKey`）。`null` = 这一局还没看过 ——
 * 新局（单机 `startGame` / 联机 `onStart`）与读档（`loadState`）都把它清成 `null`。
 */
let autosaveDateKey: number | null = null;

/**
 * 自動存檔 —— **每推进一天存一次**（0 号槽），时机与判据见 `saveload.ts` 的 `autosaveStep`
 * （@source `0x00419041..0x0041904d`：游标绕回 → 推日期 → 新行动者回合边界 → `cfg+4` 开着就存）。
 *
 * ★ 2026-09-24 订正：先前是「每个真人回合开始存一次」（当时注明「原版没查证」）。
 *   原版不分人机、只在推过日期那一次存。
 * ⚠️ 联机**不存**：局面由服务器的 action 流决定（服务器那边另有存档），本机 0 号槽
 *   若存进联机局面，单机读档会把它当单机局开出来。
 */
function autosaveIfEnabled(next: GameState): void {
  if (net !== null) return;
  // 只在对局里才有 action 施加（`reduceRecorded` 是唯一入口），不会误存標題那份占位局
  const step = autosaveStep(next, autosaveDateKey);
  autosaveDateKey = step.key;
  if (!step.save || !options.autoSave) return;
  const err = writeSlot(AUTOSAVE_SLOT, next);
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
  const layer = cancelLayerOf(cancelSnapshot());
  return layer === null ? false : applyCancelLayer(layer);
}

/** 梯子的输入 —— 全是纯查询（`cancelTopPanel` 与触屏「取消」钮的显隐共用这一份）*/
function cancelSnapshot(): CancelSnapshot {
  return {
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
    bail: bailScreenOn(),
    loan: bankPending() !== null,
    loanReminder: reminderUi !== null,
  };
}

/**
 * 此刻右键**有没有东西可取消/可跳过** —— 与下面 `contextmenu` 处理同一串判据
 * （纯查询；判定本身在 `touch-input.ts` 的 `rightClickMeaningful`，单测钉着）。
 * 触屏上的「取消」钮只在它为真时露出来。
 */
function rightClickMeaningfulNow(): boolean {
  const overlay = activeUiScreen();
  let overlayContextmenu: boolean | null = null;
  if (overlay?.contextmenu !== undefined) overlayContextmenu = overlay.contextmenuLive?.(uiEnv()) ?? true;
  return rightClickMeaningful({
    tollFlash: tollFlash !== null,
    overlayContextmenu,
    cancel: cancelSnapshot(),
    pickCancellable: pick?.cancellable ?? false,
    minimapMarker: minimapMarker !== null,
  });
}

/**
 * 触屏：这一次落指，长按算不算右键 —— 金额条 / 数字键盘那几屏不算
 * （需求方 2026-09-24「在金额条界面就不要用长按取消逻辑了，反正还有按钮」；
 * 判定本身在 `touch-input.ts` 的 `longPressAllowed`，单测钉着）。
 */
function longPressAllowedNow(): boolean {
  const overlay = activeUiScreen();
  return longPressAllowed({
    overlayAmountEntry: overlay === null ? null : (overlay.amountEntry?.(uiEnv()) ?? false),
    cancel: cancelSnapshot(),
  });
}

/** 真正动手的那一半 —— 与 `cancelLayerOf` **一对一**（梯子上每层恰好一条） */
function applyCancelLayer(layer: CancelLayer): boolean {
  switch (layer) {
    case 'pick':
      // @source loc_004466b8：可取消的才退；目标必选（`[0x48c594]` bit3）的不认
      if (pick !== null && pick.cancellable) {
        sound.play('Effect.mkf', CANCEL_SOUND);
        const source = pick.source;
        endPick();
        // ★ 卡片那一类：拾取窗 `Post(0)` ⇒ 卡片函数返回 0（如均貧卡 `0x004421e2 je 0x443069`）
        //   ⇒ `_rich4_ui_use_card_entry` 失败音 3 + 卡片欄重开（`0x00441cd9` / `0x00441ce3`）
        if (source.kind === 'card') cardUseFailed();
        // ★ v8：道具那一类取消只有这一声音效 4（`0x4466b8`）—— 联机时同桌也听得到
        else if (source.kind === 'tool') presentToTable({ kind: 'toolCancel', toolId: source.toolId });
        // ★ 建設公司选地窗右键 ⇒ 窗交回 0（`0x004466c6`）⇒ core 的 `declineDecision` 那一支
        //   （别人家照收 1000 × 物價 / 自家直接到出口）
        else if (source.kind === 'build') dispatch({ type: 'declineDecision' });
      }
      return true;
    case 'dicePick':
      cancelDicePick();
      return true;
    // @source loc_0043791e：关面板，★ 不放音
    case 'atm':
      dismissAtm();
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
      // ★ 2026-09-23：走保釋屏自己的流程 —— 字框挂着 = 收框、YES/NO 开着 = NO、等点时 = 不保
      //   （監獄当场关屏；醫院先道别「要保重身體喔！」再关）
      bailHot = null;
      if (bailFlow !== null) bailSend({ kind: 'cancel' });
      else dispatch({ type: 'declineDecision' });
      return true;
    // @source loc_00435f6d：放取消音 + 说再见 + 关贷款屏（状态机自己走）
    case 'loan':
      loanSend({ kind: 'cancel' });
      return true;
    // @source loc_004365b4：还没到第三句 ⇒ 取消音 + 跳到第三句并收掉（下一拍关窗）；第三句时不理
    case 'loanReminder': {
      const cut = reminderUi === null ? null : reminderCancel(reminderUi);
      if (cut !== null) {
        sound.play('Effect.mkf', REMINDER_CANCEL_SOUND);
        stopVoice(); // `0x004365c3 … push 1 / call 0x44ee18` —— 收框连语音一起停（0x0044ee30）
        reminderUi = cut;
        requestRender();
      }
      return true;
    }
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
      // ★ 貸款屏开着时不认：原版那扇窗（`fcn_00435062`）的消息分派里**没有** `0x100`（键盘），
      //   只有鼠标与自定义消息；它背后那份后备对话框的 choices 不能被 Y/N 键偷点到
      if (loanUi !== null) return false;
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
      if (loanUi !== null) return false; // 同上：貸款屏不收键盘
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
      // ★★ 第二十一份：熱鍵「切換視窗組」轮的是 **`cfg+5` 三态**（日、月曆 → 縮小地圖 → 組合畫面），
      //   不是「日曆 → 月曆 → 小地圖」（日/月曆只由太阳/月亮两颗钮换，`[0x497164]` 不归它管）。
      // @source VA 0x0040121b..0x0040125d（棋盘窗口的熱鍵分派，键 = `[0x497176]` = 熱鍵表第 7 条）：
      //   `inc byte [cfg+5] / cmp dh, 3 / jne / mov [cfg+5], 0` → `fcn_00419703` + `fcn_0041906a(1)` 整屏重画，不放音效。
      //   ⚠️ 原版只改内存里的 cfg，**「結束程式」时**才写档（`0x0040148f call 0x411f80`）；
      //   浏览器没有「结束」那一下，故这里当场写回 —— 与原版退出时落盘的结果相同。
      //   `[0x497174]`（熱鍵第 6 条「切換選項」）在这个分派里没有引用，两条默认都是 Tab，照旧同一支。
      if (screen !== 'game') return false;
      options = { ...options, windowView: (options.windowView + 1) % 3 };
      saveConfigToStore();
      requestRender();
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
      // 組合畫面那块窄版面板**没有页**：原版 `0x004014b1 cmp [cfg+5], 2 / je 0x401523` 把两键吃掉
      if (sidebarLayout(options.windowView).panel !== 'full') return true;
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
/**
 * ★ W-66-b 的 DEV 量测：每段补间起步时与「上一段补间的**理论结束时刻**」之差（毫秒）。
 *
 * 口径：原版是**同一个 tick** 里上一格收尾、下一格起步（`0x0040d936..0x0040d950`），
 * 缝是 0；本引擎要经过 `setTimeout(paceDelay)` → `holdForActorWalk` 可能再等一个
 * `RENDER_MS` → rAF 才起下一段。这里只**量**，读数用 `__rich4.walkGaps()`。
 */
const walkGaps: number[] = [];

/** 记一段补间的起步缝（只在 DEV、且上一段存在时记）@see walkGaps */
function noteWalkGap(): void {
  if (!import.meta.env.DEV) return;
  const prevEnd = renderer.lastWalkEndAt();
  if (prevEnd === null) return;
  walkGaps.push(performance.now() - prevEnd);
  if (walkGaps.length > 600) walkGaps.shift();
}

function startStepTween(playerIndex: number, before: GameState): void {
  const p = state.players[playerIndex];
  const b = before.players[playerIndex];
  if (p === undefined || b === undefined) return;
  // ★ 终点 = 踏上的那一格（与 `tweenStepIfMoved` 同源，见 `tween.ts` 文件头 `landing`）
  const landing = nextNodeOf(before, topo) ?? p.nodeId;
  if (landing === b.nodeId) return;
  const from = map.nodes[b.nodeId - 1];
  const to = map.nodes[landing - 1];
  if (from === undefined || to === undefined) return;
  noteWalkGap();
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
function diceAnticipateTicks(me: { character: number; trafficMethod: number; blocking: { sleepWalking: number } }): number {
  // ★ 夢遊中掷骰那一组是**走路那组的 k2**（不看交通方式）@source 0x0040ba91 `add edi, 2`
  const res =
    me.blocking.sleepWalking !== 0
      ? characterSleepwalkSprite(me.character, CHARACTER_POSE.dice)
      : characterSetBase(me.character, me.trafficMethod) + CHARACTER_POSE.dice;
  const count = sprites?.imageCount('Data.mkf', res) ?? 0;
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
  // ★ 审计 2026-09-25（loop F5）：停留 / 龜行**不进掷骰态** —— 原版起步 `fcn_0040dd1f` 在
  //   `0x0040dd64`（停留：走子态 0）/ `0x0040dd7e`（龜行：`jne 0x40dd40` 直接走一步）就分走了，
  //   预动作（`0x0040d975` 的逐帧计数）与滚骰影片（`0x419572`）都轮不到 ⇒ 当场 `rollDice`、不起动画。
  if (rollsWithoutDice(me)) {
    dispatch({ type: 'rollDice' });
    return true;
  }
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
 * **本机这一掷的 intent 已经发出、还在等服务器回包**（联机）。
 *
 * ★★ 第九份试玩回报「多人模式下玩家扔骰子有个很明显的延迟卡顿」（2026-09-22）。
 *
 *   改动前是一条**死锁**：`pumpNetInbox` 的节拍闸 `holdForActorWalk` 里有
 *   `diceFxActive` 这一位，而自己的 `rollDice` 回包恰恰是**唯一能清掉这一位的东西**
 *   （`diceFx.roll()` 只在 `applyAction` 里调，而 `applyAction` 正被这道闸挡着）
 *   ⇒ 每掷固定空转到 `ROLL_WAIT_TIMEOUT_MS`（3 秒）才由超时 `cancel()` 松开。
 *   单机约 1.7 s 的一段，联机变成 4.7 s + RTT。
 *
 *   现在两点一起改：
 *   ① 这一位为真且队首是 `rollDice` 时，**放行**那条回包（它不是在「打断演出」，
 *      它就是演出在等的东西）；
 *   ② `dicePoll` 在 dispatch 那一刻就调 `diceFx.predictRoll()` 先滚起来，
 *      回包只负责补权威点数 ⇒ 连 RTT 也不必等。
 *
 * 置位：`dispatch` 的联机分支。清位：`applyNetAction` 施加掉那条回包时 /
 * 3 秒超时收摊时 / 服务器拒绝时 / 失步自愈时。
 */
let awaitingOwnRoll = false;

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
    // ★★ 联机预测（第九份试玩回报「掷骰延迟」）：本地不 reduce 自己的输入（等回包），
    //   但滚骰这一段只是「骰子在滚」的画面、**不含点数**（点数图只在 `hold` 相位画），
    //   所以可以**当场开滚**，回包到了由 `applyAction` 的 `diceFx.roll()` 补上权威点数
    //   （`roll()` 对已经在滚的那一段只更新点数、不重启相位）。
    //   没有这一步就还得白等一个 RTT 才看见骰子动。
    if (net !== null && diceFx.predictRoll(performance.now(), diceFlic.get(diceFx.diceCount) ?? null)) {
      // 原版音效随影片一起起；预测起播时就得响，否则会晚一个 RTT
      playDiceSound();
    }
  }

  // 联机兜底：催过之后服务器迟迟不回就收摊，别一直空转
  if (diceFx.phase === 'anticipate' && rollRequestedAt > 0 && now - rollRequestedAt > ROLL_WAIT_TIMEOUT_MS) {
    diceFx.cancel();
    // ★ 这条回包不来了（服务器没答）⇒ 撤掉「在等回包」这一位，
    //   否则 `pumpNetInbox` 会一直放行队首那条 `rollDice`（见 `awaitingOwnRoll`）。
    awaitingOwnRoll = false;
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
/**
 * ★★ 卡片路径里「持卡人那一问」（免費卡 / 嫁禍卡，core `CardPassiveTail`）由**持卡人**答，
 *   与轮到谁无关：出牌的可能是电脑（热座下仍要弹给真人持卡人）、联机下只有持卡人那一端弹。
 *   返回 null = 这一刻不是这种问；否则 = 本机该不该弹。
 */
function cardPassiveDialogOpen(): boolean | null {
  const holder = cardPassiveHolder(state.pending);
  if (holder < 0) return null;
  if (net !== null && net.seat !== holder) return false;
  const h = state.players[holder];
  return h !== undefined && !isAiControlled(h);
}

function currentDialog(): InteractionUi | null {
  if (screen !== 'game') return null;
  // ★★ 20260925-134801926（「为什么直接没让我进商店」）：商店那一趟**开窗之前**不许有能作答的东西。
  //   原版进店三段全是阻塞的（框 → 台词 → 建窗，@source 见 `shopWindowMayOpen`），
  //   而本引擎的商店窗要等框 / 台词都下了台才建 —— 这中间若把 `interactions.ts` 那份
  //   后备壳画到棋盘上并收点击，玩家在框上多点一下就当场 `declineDecision`：
  //   回报现场日志 `付费訊息框：shop.chairmanGift` → `付费訊息框：跳过` → `▶ 百貨公司：EXIT`，
  //   全程没有 `♪ midi07.mid`（商店窗从没建起来）。判据与开窗共用 `shopOpenGate()`。
  //   ⚠️ 这一处也是键盘（是/否/確定）、右键取消梯子与触屏「取消」钮的唯一入口
  //   （`cancelSnapshot().dialog` 读的就是本函数），所以框住这里 = 四条路一起框住。
  if (
    !shopShellMayAnswer({
      pendingKind: state.pending?.kind ?? null,
      windowOpen: shopUi !== null,
      windowMayOpen: shopOpenGate,
    })
  ) {
    return null;
  }
  // ★ 20260925-153539948（「建设公司加盖房子不是展现列表，是我可以自己在地图上任意选择」）：
  //   建設公司选地原版是**点地图**（`0x446ae8`，参数 `0x2090086`），走拾取模式（`tickBuildPick`），不摆后备壳
  if (state.pending?.kind === 'chooseBuildTarget') return null;
  const passive = cardPassiveDialogOpen();
  if (passive !== null) return passive && state.pending !== null ? interactionUi(state.pending, state) : null;
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

/**
 * 填数窗鼠标的「按下记账、抬手动作」（原版 `[0x48cac2]`，见 `dialog.ts` 的 `AmountPressLatch`）。
 * 棋盘对话框、銀行（貸款屏借 / 還、特別融資）、股市屏三处的填数页共用这一个 —— 它们本来就是同一扇窗。
 */
const amountPress = new AmountPressLatch();

/** 开一扇填数窗：落点回到 (0x100, 0x90)、按键记账清空 @source `fcn_00453544` 0x0045359c..0x004535a5 */
function amountWindowOpened(): void {
  resetAmountWindowPos();
  amountPress.reset();
}

/** 此刻开着的填数页属于哪一份交互：股市屏借的那一扇，或棋盘 / 銀行上的对话框；没开就 `null` */
function amountDialogUi(): InteractionUi | null {
  if (amountPage === null) return null;
  if (screen === 'stock') return stockAmount !== null ? stockAmountUi() : null;
  return currentDialog();
}

/**
 * 填数窗**按下**（`WM_LBUTTONDOWN` → `loc_00452d0e`）：记下按在哪一号、放按键音 7 —— 数值不动。
 * @returns 这一下落在填数窗上（调用方不再往下传）
 */
function amountWindowDown(q: { x: number; y: number }): boolean {
  const ui = amountDialogUi();
  if (ui === null || amountPage === null) {
    amountPress.reset();
    return false;
  }
  const h = hitDialog(boardCtx, ui, amountPage, q.x - LAYOUT.board.x, q.y - LAYOUT.board.y);
  const r = amountPress.down(h, q);
  if (r.sound !== null) sound.play('Effect.mkf', r.sound);
  if (r.consumed) requestRender();
  return r.consumed;
}

/**
 * 填数窗**抬手**（`WM_LBUTTONUP` → `loc_00452fce`）：照按下时记下的那一号动作（不看抬手坐标，不再放音）。
 * @returns 这一下办了事
 */
function amountWindowUp(): boolean {
  const pressed = amountPress.up();
  if (pressed === null) return false;
  const ui = amountDialogUi();
  if (ui !== null) onDialogHit(ui, pressed);
  // 股市屏借的那一扇：確定 / 取消都会把填数页关掉 ⇒ 顺手收掉 `stockAmount`
  if (screen === 'stock' && amountPage === null) stockAmount = null;
  requestRender();
  return true;
}

/** 对话框上点到了什么 */
const __devHits: unknown[] = [];
function onDialogHit(ui: InteractionUi, hit: DialogHit): void {
  if (import.meta.env.DEV) __devHits.push(hit);
  if (hit.kind === 'choice') {
    const c = ui.choices[hit.index];
    if (c === undefined) return;
    // （存款 / 提款不在任何对话框里：它们只在 ATM（`pending.kind === 'atm'`，`syncAtmPending`）里办）
    // 要填数的选项：先进填数页，别直接派 action
    if (c.amount !== undefined) {
      // ★ 开窗初值：原版認購股份那一支把**上限**当第一个实参传进填数窗
      //   （见 `interactions.ts` 的 `amount.initial`），其余各条照旧从 0 起
      amountWindowOpened();
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
      // ★ 鼠标那一路：按键音已在**按下**放过（`amountWindowDown`，0x00452d95），这里只动作
      switch (slot.kind) {
        case 'digit':
          onAmountKey(ui, { kind: 'digit', digit: slot.digit }, false);
          return;
        case 'backspace':
          onAmountKey(ui, { kind: 'backspace' }, false);
          return;
        case 'clear':
          onAmountKey(ui, { kind: 'clear' }, false);
          return;
        case 'max':
          onAmountKey(ui, { kind: 'max' }, false);
          return;
        case 'ok':
          onAmountKey(ui, { kind: 'ok' }, false);
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
      // ★★ 第二十一份：股市柜台成交那一下 —— 買進 40 / 賣出 41（`0x0042afab` / `0x0042b093`，在买卖之前）
      const tradeSfx = stockCounterTradeSound(stockAmount, n);
      if (tradeSfx !== null) sound.play('Effect.mkf', tradeSfx);
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
function onAmountKey(ui: InteractionUi, key: AmountKey, playSfx = true): void {
  const page = amountPage;
  const amount = page === null ? undefined : ui.choices[page.choice]?.amount;
  if (page === null || amount === undefined) return;
  // ★ 按键音 7（gap-audit #13）：键盘 0x00452f0e（放完才合成 0x202 ⇒ 音与动作同一拍）。
  //   ★ 鼠标那一路**不在这里放**：原版在**按下**就放了（0x00452d95，`amountWindowDown`），
  //   抬手（0x202）进这里只动作 ⇒ `playSfx = false`。
  //   填数窗只开在本机行动者那一台（别的座位没有 `amountPage`），各端自己放。
  // 键盘那一路先清 `[0x48cac2]`（0x00452e4b）⇒ 拖到一半的窗就此停下
  if (playSfx) amountPress.stopDrag();
  const keySfx = playSfx ? amountKeySound(key) : null;
  if (keySfx !== null) sound.play('Effect.mkf', keySfx);
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
  // 选中行的初值：轮到的那位（原版 `[0x49910c]`）；联机里本机只动得了自己那一座 ⇒ 用本机座位
  aiModel = openAiSettingsModel(state, net !== null ? net.seat : state.currentPlayer, aiLastSel);
  aiLastSel = aiModel.sel;
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
  const draft = aiModel?.rows ?? null;
  if (aiModel !== null) aiLastSel = aiModel.sel;
  aiModel = null;
  screen = aiReturn;

  if (commit && draft !== null) {
    // 联机：只提交本机座位那一行（别人的行本来就改不动，见 `aiCanEdit`）
    const acts = aiCommitActions(draft, state.players, aiCanEdit);
    for (const a of acts) dispatch(a);
    log(acts.length === 0 ? '託管設定：未變更' : `託管設定：已更新 ${acts.length} 位`);
  }
  requestRender();
}

/**
 * 託管AI 屏上这一行本机能不能改。
 *
 * - 单机 / 热座：每一行都能（原版一台机器、一只鼠标，谁点都算）。
 * - 联机：**只有本机座位那一行** —— 别人的行照样能点选（看他的设置），但不翻托管、不改选项，
 *   「確定」也只提交自己那一行。服务器那一道（`sequencer` 只收轮到那一座的 `setAi`）不变。
 */
function aiCanEdit(row: AiSettingRow): boolean {
  return net === null || row.player === net.seat;
}

/** 託管AI 屏的**按下**（原版 `WM_LBUTTONDOWN` / `WM_LBUTTONDBLCLK` → `loc_0041de95`）*/
function onAiSettingsDown(p: { x: number; y: number }): void {
  if (aiModel === null) return;
  const local = { x: p.x - AI_ORIGIN.x, y: p.y - AI_ORIGIN.y };
  const hit = hitAiSettings(local, aiModel.rows, aiModel.sel);
  aiModel = aiSettingsDown(aiModel, hit, aiCanEdit);
  aiLastSel = aiModel.sel;
  requestRender();
}

/** 託管AI 屏的**抬手**（原版 `WM_LBUTTONUP` → `loc_0041e0b1`：只认按下时记下的控件）*/
function onAiSettingsUp(): void {
  if (aiModel === null) return;
  const { model, close } = aiSettingsUp(aiModel, aiCanEdit);
  aiModel = model;
  if (close !== null) {
    closeAiSettings(close === 'ok');
    return;
  }
  requestRender();
}

/**
 * 只把两档音量作用到播放器上 —— 開機（`loadConfigFromStore`）与設定「確定」（`applyOptions`）共用。
 *
 * ★ 2026-09-24：先前开机不调它 ⇒ cfg 里存的音量（包括「关掉」）要等打开設定屏按一次「確定」才生效。
 *   第十一份 #8 当时不在开机跑 `applyOptions`，顾虑的是它另外那几件（`saveConfigToStore()` 写档、
 *   「音乐刚打开」时补起播 `playBoardBgm(0)` / `music.stop()`）—— 这里只取音量那三行，那几件照旧只在「確定」时做。
 * @source 原版的放音例程**每次起播都直接读 cfg**：音效 `cfg+3`（`rich4_sound_effect.asm:451/484/717`）、
 *   配乐 `cfg+2`（`rich4_media_music.asm:331/344/370`）⇒ 不存在「开机一套、設定屏另一套」。
 */
function applyVolumes(o: GameOptions): void {
  sound.setMuted(o.sound === 0);
  sound.volume = volumeOf(o.sound);
  music.setVolume(o.music === 0 ? 0 : volumeOf(o.music) * 0.25);
}

/** 把設定的取值真的作用到播放器与側欄上 */
function applyOptions(next: GameOptions): void {
  options = next;
  applyVolumes(next);
  // 設定里「視 窗」三选一（RICH4.CFG +5）：右栏每帧直接读 `options.windowView`，这里不必另存。
  // @source 設定屏「確定」VA 0x00410969..0x00410a10：整份 16 字节拷回 cfg，`cfg+5` 变了就回 0x8000
  //   让棋盘窗口整屏重画 —— 下一帧 `hud.draw` 按新版式画（组合画面见 `sidebarLayout`）。
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
// ★★ 第二十六份 panel：语音**只有一路**（原版 `[0x47e750]`，`0x45441a` 起播前 `call 0x454493`）——
//   `#NNNN`（下面的 sink）与角色台词（`speechTick`）都经这一个出口放，起一句新的就停上一句。见 `audio.ts` 的 `VoiceChannel`。
const voiceChannel = new VoiceChannel({
  play: (r) => sound.play('Speaking.mkf', r),
  stop: (r) => sound.stop('Speaking.mkf', r),
  isPlaying: (r) => sound.isPlaying('Speaking.mkf', r),
});
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
  voiceChannel.play(voice);
});
// ★ 字框的到期判据要问「语音还在响吗」（`fcn_0044ee18` → `0x4544b9`，音效档 `[0x49715b]` 关掉不问）
//   与「立刻收起时停掉语音」（`fcn_0044ee18(1)` → `0x454493`）—— 见 `voice-sink.ts`。
//   ★★ 两者问的都是**那一路**（`0x4544b9` / `0x454493` 只认 `[0x47e750]`，不分是谁起的）。
setVoiceBusyProbe(() => options.sound > 0 && voiceChannel.busy());
setVoiceStopper(() => voiceChannel.stop());

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
  const place = bailPlace();
  if (screen !== 'game' || place === null) {
    bailBgmOn = false;
    return;
  }
  if (bailBgmOn) return;
  bailBgmOn = true;
  void playTrackFile(place === 'prison' ? 'midi15.mid' : 'midi16.mid');
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
  // ★ 棕色訊息框（`0x440cac`）不是场所：原版场所的模态循环一返回就 `sub_00454bcc`，之后才弹框。
  //   例：魔法屋 `0x004338b9 call 0x454bcc`（关窗影片播完、窗口返回）在 `0x004339c6 call 0x431caa`
  //   （逐人弹「名字\n\n效果」）之前 —— 先前这里被訊息框挡着，背景曲要等四扇框全弹完才接回。
  const overlay = activeUiScreen();
  if (overlay !== null && overlay.id !== 'notice') return false;
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
/**
 * `?mute=1`：整页静音 —— 自动化测试（net-e2e / 子代理的浏览器验证）用，别在需求方前台出声。
 * 做法是**不解锁**：AudioContext 一直不建，音效 / 语音 / MIDI 全都发不出声；游戏逻辑与演出时序不受影响
 * （台词与开奖等「等语音说完」的闸在没有上下文时按最短时长走，与关掉音效时相同）。
 */
const MUTED_BY_URL = new URLSearchParams(window.location.search).get('mute') === '1';

function unlockAudio(): void {
  if (MUTED_BY_URL) return;
  // ★ 第十九份（iPhone 发烫）：音效与背景音乐**共用一个** AudioContext（先前各建一个 ⇒
  //   手机上两条音频渲染线程一直开着）。音乐先建，音效挂上去；万一没建成再退回音效自建。
  music.unlock();
  const shared = music.context;
  if (shared !== null) sound.attach(shared);
  else sound.unlock();
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
/**
 * ★ 第十九份（iPhone 发烫）：切后台 / 回前台。
 *
 * 后台：挂起音频上下文（音乐停在原处）、回合驱动与收件箱停在闸口（`holdForActorWalk`）、
 *   演出看门狗不计时、GO 鈕闪烁不要帧。浏览器自己会停 rAF。
 * 前台：恢复音频（iOS 若要求再来一次手势，就挂一次性监听）；整帧重画一次；叫醒驱动；
 *   联机收件箱若在后台攒了一大截，**静默**施加到只剩最后 `NET_INBOX_KEEP` 条再照常播
 *   （与中途进房的 `catchUpSilently` 同一口径：不补演看不见的那段；每条照样 `noteApplied` 报校验和）。
 */
function bindPageVisibility(): void {
  pageHidden = document.hidden;
  installPageVisibility(document, window, {
    onHide: () => {
      pageHidden = true;
      void music.setBackground(true);
    },
    onShow: onPageShown,
  });
}

function onPageShown(): void {
  pageHidden = false;
  presentationStallKey = '';
  void music.setBackground(false).then((running) => {
    if (running || pageHidden) return;
    const once: AddEventListenerOptions = { once: true, capture: true };
    for (const type of ['pointerdown', 'touchend', 'keydown'] as const) {
      window.addEventListener(type, () => void music.setBackground(false), once);
    }
  });
  displayList.invalidate();
  stageBlitOwed = true;
  requestRender();
  if (net !== null) catchUpNetAfterHidden();
  if (driversParked) {
    driversParked = false;
    resumeTurnDriver();
    pumpNetInbox();
  }
}

/** 回前台时收件箱积压过多 ⇒ 前面那一截静默施加（见 `bindPageVisibility`） */
function catchUpNetAfterHidden(): void {
  if (netInbox.length <= NET_INBOX_KEEP || screen === 'intro') return;
  const burst = netInbox.splice(0, netInbox.length - NET_INBOX_KEEP);
  if (netPumpTimer !== null) {
    clearTimeout(netPumpTimer);
    netPumpTimer = null;
  }
  for (const item of burst) {
    // ★ v8：演出提示不补演（与静默追上同一口径）
    if (!isNetAction(item)) continue;
    const next = reduce(state, item.action, topo);
    if (next !== state) history.push(item.action);
    state = next;
    if (item.action.type === 'rollDice') awaitingOwnRoll = false;
    net?.noteApplied(item.seq);
  }
  settleAfterSilentRebuild();
  log(`⟳ 回到前台：靜默施加 ${burst.length} 條 action（第 ${state.turnCount} 回合）`);
  pumpNetInbox();
}

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
 * ★★ W-54：**上一次照 `view_to` 落下的那一个标记**（按引用比）。
 *
 * 原版 `view_to`（VA 0x0041d476）写的是与小地图点选**同一个**标记
 * （`[0x48be18]`/`[0x48be1c]`/`[0x48be20]`），`refresh_screen`（VA 0x0041d546）
 * 再把它清 0 ⇒ 镜头回到行动者。core 把这个目标交给 `state.lastViewTarget`
 * （瞬态提示，见 `GameState.lastViewTarget`），这里记住「哪一次已经照做过了」——
 * 坐标相同但**换了一个对象**就是新的一次（用户连打两张同坐标的卡也要重切）。
 */
let shownViewTarget: { x: number; y: number } | null = null;

/**
 * 这个标记是**照 `view_to` 落的**吗（= 收屏时该由我们撤掉）。
 *
 * ⚠️ 不能靠「把 `shownViewTarget` 清成 null」来表示已收 —— 那会让**同一个**
 *   `lastViewTarget` 在下一帧又被当成新目标重新落下，镜头于是每帧在
 *   「目标 ↔ 行动者」之间来回跳（实测到过：`(400,400)` / `(1248,1368)` 逐帧交替）。
 */
let viewTargetActive = false;

/**
 * 把 core 交下来的 `view_to` 目标落成小地图标记；演出收摊后再撤掉。
 *
 * 每帧调一次（`drawGameStage` 里、`centerOnCurrentPlayer()` 之前）。
 *
 * ⚠️ **忙碌判据**用的是 W-51 的 `stageBusy()`（`stage-gate.ts`，与
 *   `holdForActorWalk` 同一份清单），再补上台词 —— 原版的 `refresh_screen`
 *   排在整段流程（影片 + 訊息框 + 台词）的**最后**，所以台词还在台上时
 *   镜头不该提前切回去。
 */
function syncViewTarget(): void {
  // ★ D-MAGIC-16：魔法屋逐人那几段读**这一段**的 `view_to`，而且要等这一段的訊息框收掉
  //   （原版 `0x440cac` 在前、`0x41d476` 在后）；整趟没演完之前不撤标记（`0x431caa` 里没有 `refresh_screen`）
  if (magicSeq !== null && noticeHoldsFilms()) return;
  // ★★ 第十四份試玩回報（协调方拍板）：**用卡亮牌期间镜头不动**（不落新目标、也不撤旧标记）。
  //   原版用卡是 `0x00441cbc`（真人）/ `0x00441def`（电脑）`call 0x441f73` —— 亮牌，**阻塞** 1500 ms ——
  //   返回之后才 `0x00441cc6` / `0x00441e00 call [0x475d5c + 卡号*4]` 进卡片函数；卡片里的 `view_to`
  //   （含它调的 `send_to_prison` 的 `0x0043d5cc` / `0x0043d6f1`）全在亮牌之后，而清标记的
  //   `refresh_screen`（`0x41d546`）在卡片函数**末尾**（例：陷害卡 `0x00444685`，排在受害者那句
  //   `0x0043d71c call 0x44ef41` 之后）。
  //   本引擎的 core 一条 action 就把卡用完，`lastViewTarget` 在亮牌起播那一拍就已经到了（电脑 / 联机旁观：
  //   `useCard` 到达时才弹亮牌；真人自己那一张的亮牌在派发之前就演完了，不受影响）⇒ 等亮牌收屏再照做。
  //   撤标记那一头沿用下面「台上不忙 + 台词说完」的判据（= 卡片函数末尾的 `refresh_screen`）。
  //   联机旁观被行动者甩下时 `followPresenter` → 事件框 `fastForward` 把亮牌直接收掉 ⇒ 这里当拍放行。
  if (cardUsePopupActive()) return;
  // ★ 第十五份：`beforeStage` 的台词（出牌 / 道具台词…）还没说完 ⇒ 新目标先不落。
  //   原版卡片 / 道具函数里的 `view_to` 全在那一句 `player_say` 之后（查稅 `0x0044526b` → 飞 `0x004452c6`；
  //   怪獸 `0x0044398f` → `0x00443a76`；拆除 `0x00443b8a` → `0x00443c04`；請神符 `0x00444e8a` → `0x00444eb6`），
  //   而 `player_say` 自己先把镜头移到说话人（`0x0044efbd call 0x41d476`，见 `viewToSpeaker`）——
  //   先前亮牌一收，镜头就被这里拉去目标，出牌台词的气泡于是指着被害人。
  if (speechAheadOfFilms(speechSnapshot()) > 0) return;
  const t = magicSeq !== null ? (magicSeq.shown?.lastViewTarget ?? null) : state.lastViewTarget;
  if (t !== null && t !== shownViewTarget) {
    shownViewTarget = t;
    viewTargetActive = true;
    minimapMarker = { x: t.x, y: t.y };
    // 立刻居中（= 原版 `view_to` 收尾那句 `fcn_00415e70`）——`followPlayer`
    //   是**本引擎**的东西，不动它；正常情形下它是 true，下一帧
    //   `centerOnCurrentPlayer()` 会因为「有标记」而继续停在标记上。
    camera = pixelCamera(t.x, t.y, camera.view);
    requestRender();
    return;
  }
  // ★ 第十四份試玩回報（协调方追加）：关押 / 消失影片前后的 `view_to`（`applyFilmView` 排进来的）——
  //   与上面同一个标记，排在 `lastViewTarget` 之后：原版卡片 / 道具自己的 `view_to` 在前，
  //   `send_to_*` 里那一次在后（例：陷害卡 `0x0044467d call 0x43d593`）。
  const q = queuedFilmView;
  if (q !== null) {
    queuedFilmView = null;
    viewTargetActive = true;
    minimapMarker = { x: q.x, y: q.y };
    camera = pixelCamera(q.x, q.y, camera.view);
    requestRender();
    return;
  }
  if (!viewTargetActive) return;
  // 演出全部收完 ⇒ 清标记（= 原版 `refresh_screen`），镜头回行动者
  if (stageBusy(stageBusyFlags()) || speechQueue.length > 0 || heldSpeech.length > 0) return;
  if (magicSeq !== null) return;
  viewTargetActive = false;
  minimapMarker = null;
  requestRender();
}
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
function retargetCameraOnTurnChange(before: GameState, action?: Action): void {
  if (minimapMarker === null && followPlayer) return;
  // ★ `view_to` 刚落下的标记（W-54 / 台词）有自己的收场（`syncViewTarget`），别在这里抢着清
  if (viewTargetActive) return;
  const changed =
    before.currentPlayer !== state.currentPlayer || before.turnCount !== state.turnCount;
  // ★★ 第七份试玩回报 #3：**一有人行动，镜头就交还给行动者** —— 不止「换人」那一条。
  //   原版清标记的是 `refresh_screen`（`fcn_0041d546`：`[0x48be18] = 0` 再重画），30 个调用点里有：
  //     · **按下 GO**：`0x00401279 call 0x419703 / 0x0040127e call 0x41d546 / 0x00401283 call 0x40dd1f`
  //       （先清标记、再起步）；棋盘窗口那一支 `0x004182e6 / 0x004182eb` 同形；
  //     · 落点例程收尾 `0x0041b062`、行动阶段开头 `0x00418d69`、每张卡 / 每件道具用完（`0x0044xxxx` 那一族）；
  //     · 换人 `0x00418ec2`、右键 `0x00418665`。
  //   居中函数 `fcn_00415e70` 是「有标记用标记、否则用当前行动者」⇒ 标记一清，下一拍就回到人身上，
  //   之后照常逐像素跟（**不是**另起一套平滑；见 `centerOnCurrentPlayer` 的文件头）。
  //   本引擎先前只在换人时交还 ⇒ 手动挪过镜头之后，自己按 GO 走子镜头也不跟（需求方所报）。
  //   `setAi` / `aiNext` 不是「有人行动」（前者是服务器的系统 action，后者是电脑决策链的内部簿记），不算。
  const acted = action !== undefined && action.type !== 'setAi' && action.type !== 'aiNext';
  if (!changed && !acted) return;
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
    // ★ 第十二份試玩回報：还在静默追「进房之前」那一段 ⇒ 本地状态是旧的，拿它做的决定一律作废
    //   （先前刷新后按旧局面替自己出手，服务器回「拒绝：notYourTurn」）。
    if (net.catchingUp) return;
    // ★ 记下「本机这一掷在等回包」——`pumpNetInbox` 据此放行，`dicePoll` 据此先滚起来。
    //   见 `awaitingOwnRoll` 的注释（第九份试玩回报「掷骰延迟」的死锁）。
    if (action.type === 'rollDice') {
      awaitingOwnRoll = true;
      // ★★ 兜底（必须有）：这一位会让队首的 `rollDice` 广播**绕过整个节拍闸**，
      //   所以绝不能让它一直挂着。回包要是永远不来（断线、被拒、服务器重启），
      //   到点自己撤掉 —— 之后回包照旧按正常节拍落地，只是不再插队。
      //   （预测的滚骰只演约 1 s，`dicePoll` 到那时就停了，靠它兜不住这一位。）
      window.setTimeout(() => {
        awaitingOwnRoll = false;
      }, ROLL_WAIT_TIMEOUT_MS);
    }
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
  // ★ 自動存檔挂在**这个漏斗**上：真人（`applyAction`）与电脑（`scheduleAi` 的直路）两条都经过这里 ——
  //   先前挂在 `applyAction` 末尾，电脑那条直路看不到（新一天第一位是电脑时就漏存，浏览器实测）。
  autosaveIfEnabled(next);
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
      net: net === null ? null : { seat: net.seat, room: net.room?.id ?? null },
      // ★ 一键回报：谁报的（门厅填的名字；单机没填就空）—— 服务器拿它起文件名
      player: (() => {
        try {
          return localStorage.getItem('rich4.name') ?? '';
        } catch {
          return '';
        }
      })(),
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
  // 自动触发的（未捕获异常 / 停摆）上传失败就算了，别往下载夹里丢文件；手动按的才退回下载
  void writeReport(reportFileName(now, reason), JSON.stringify(report), { fallbackDownload: reason === 'manual' })
    .then((where) => {
      if (where === null && reason !== 'manual') {
        log('⚠ 自動問題回報沒能上傳（開發環境沒有伺服器時屬正常）');
        return;
      }
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
  retargetCameraOnTurnChange(before, action);
  // ★ 单机：日推进那一刻由宿主重新播种（原版 `0x41D06E` 的 `srand(GetTickCount())`）——
  //   见 `rng-host.ts`；联机策略下它是空操作。
  state = reduceRecorded(action);
  if (state !== before) {
    // ★ 掷骰那一段：点数到手 → 开滚。影片没解好先挂着，解完再补。
    //   纯表现，`diceFx` 不读也不写 state（C-DET-4）。
    if (action.type === 'rollDice' && state.dice.length === 0) {
      // ★ 审计 2026-09-25（loop F5）：停留 / 龜行这一「掷」没有骰子（core 给 `dice: []`）——
      //   原版不进掷骰态、不播滚骰影片（`0x0040dd64` / `0x0040dd7e`）⇒ 不起动画、不放骰子音效。
      //   （联机旁观端也走这里：谁的回合都一样。）
      forcedRollSkipFx = false;
      diceFx.cancel();
    } else if (action.type === 'rollDice') {
      // ★ 遥控骰子（8）：点数已经由玩家选定 ⇒ **这一掷不播预动作/滚骰**（试玩回报）。
      //   原版这一段仍会播滚骰影片（`fcn_00419572` 的 `call 0x45144f`），
      //   跳过动画是需求方要求的偏离，见 `forcedRollSkipFx` 的注释。
      if (forcedRollSkipFx) {
        forcedRollSkipFx = false;
        diceFx.cancel();
      } else {
        // ★ 联机预测（`dicePoll` 的 `predictRoll`）已经让这一段滚起来了 ——
        //   记下来：既不该再 `begin()` 一段新的预动作，也不该把音效放第二遍。
        const predicted = diceFx.phase === 'tumble' || diceFx.phase === 'hold';
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
        // 预测已经起播的那一掷，音效在起播那一刻就响过了（原版音效随影片一起起）
        if (!predicted) playDiceSound();
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
}

/**
 * 当前这个 `pending` 是不是「电脑在逛店 / 进银行」—— 那样**不铺场**（原版按 `whoPlays` 分流）。
 *
 * @source `_rich4_ui_shop_entry` 的 `0x0042ea32 cmp byte [player+0x15],1 / jne 0x42ed8d`
 *   与 `_rich4_ui_bank_entry` 的 `0x004366a3` 同形：电脑那一支只跑买卖循环，不读面板、不开窗。
 *
 * ★ 2026-09-22（第十一份試玩回報 #16/#18）：抽成一处是为了让**两条**入口
 *   （`notifyApplied` 与 `requestRender` 里的每帧补呼）用**同一道闸** ——
 *   先前只有前者有，后者漏了，于是 NPC 的店会被铺起来、放 BGM 与招呼语音。
 */
function aiVenuePending(s: GameState): boolean {
  return isAiTurn(s) && (s.pending?.kind === 'shop' || s.pending?.kind === 'bank');
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
  // ★ D-MAGIC-16：魔法屋这一条带着逐人分段 ⇒ 表现改由 `tickMagicSequence` 逐段演（见那里），
  //   这里只做与演出无关的收尾 + 女巫窗口那一屏的收场（它要看到 pending 撤掉）。
  const beats = freshMagicBeats(before, state);
  if (beats !== null) {
    notifyMagicApplied(before, beats);
    return;
  }
  // ★★ 第二十六份 panel：换人那一条（惡人那一趟 / 推日期 | 下一位走一天）同样逐段演
  const turnBeats = freshTurnBeats(before, state);
  if (turnBeats !== null) {
    notifyMagicApplied(before, turnBeats, 'turn');
    return;
  }
  // ★ W-69：先认出「这笔过路费算进了哪几块地」—— 下面那一圈 `s.event?.()` 里
  //   訊息框那一屏要靠它押着不起播（闪 880 ms 之后才轮到框）。
  //   （`speech.test.ts` 数的是这个函数名带左括号的出现次数，注释里别写全。）
  noticeTollLands(performance.now());
  const said = playSoundFor(before, state);
  // ★ 状态一变，填数页指着的那个选项下标就可能已经不是同一回事了
  //   （`pending` 换了一种，甚至换了人）。一律收掉。
  amountPage = null;
  dialogHot = null;
  // ★ pt22：本机那几扇只属于这一回合的窗（ATM、选目标、点数盘、选股…）—— `pending` 在别处答掉 /
  //   回合被计时託管拿走时收掉（不论谁答的都经过这里；放在下面那道「电脑逛店」闸之外）
  dropStaleLocalModals();
  // ★ 商店的界面状态跟着 `pending` 走：进店时快照货架、铺开场；离店时清掉。
  //   放在这里是因为不管谁答的（本地点、AI、服务器广播）都会经过这一条。
  // ⚠️ 电脑自己逛店 / 进銀行时**不铺场**（保持先前的行为：那两屏是给真人点的，
  //   电脑那一手由 `decidePending` 直接答掉；原版此刻是否铺场未查证，不擅自改）。
  const aiVenue = aiVenuePending(state);
  if (!aiVenue) {
    // ★★ 第二十一份：商店窗挪到下面「台词上账 + 各屏 `event()` 登记」**之后**才同步（见 `syncShopUi` 的闸）
    // ★ 銀行貸款屏的界面状态（T-029c）同理：`pending.kind === 'bank'` 时铺场，
    //   离场时清掉。状态机自己会跨 action 活着，所以只在**首次**看见它时建。
    syncLoanUi();
    // ★ 第八份 #4：路过銀行的 ATM
    syncAtmPending();
  }
  // ★★ 第十五份：台词**先**押进 `heldSpeech`（还不上台），**再**让各整屏认这一条 action ——
  //   各框起播前要问「有没有排在我前面的台词」（`boxMayStart`），那几句此刻就得已经在账上；
  //   先前台词在 `event()` 之后才交出来，框只好一律当场起播（或一律推到下一帧）。
  holdSpeech(said);
  // ★ 登记的整屏：把「刚刚发生了什么」告诉它们（開獎 / 月結 / 魔法屋 / 事件框靠这个起播）
  const env = uiEnv();
  for (const s of SCREENS) deliverScreenEvent(s, before, state, env);
  releaseHeldSpeech(performance.now());
  // ★★ 第二十一份（`20260924-144217689`「董事长踩到商店…首先地图界面上说欢迎董事长光临送xx东西」）：
  //   商店窗**在这里**才同步 —— 董事長赠礼框（`0x0042ea14`）与那句台词（`0x0042ea23`）此刻已上账，
  //   `shopWindowMayOpen` 看得见它们 ⇒ 先框、再台词、最后开窗（每帧那一处补呼负责演完之后开窗）。
  if (!aiVenue) syncShopUi();
  if (heldSpeech.length > 0) requestRender();
}

/**
 * 把这一条 action 派生出来的台词交出去 —— **演出在演就先押着**。
 *
 * ★★ 试玩回报「盘子还没停下来 NPC 的台词都触发了」的修法。
 *   原版这一句是**同步**说的，而它所在的整段流程里轉盤 / 訊息框 / 事件框都是**阻塞**
 *   调用，顺序由**调用顺序**定死 —— 設施收費那一段：
 *   ```asm
 *   0041a458  call 0x44090e     ; ★ 轉盤（阻塞：轉完才返回盤上的數）
 *   0041a460  [esp+0xd0] = eax  ; 轉盤值（旅館天數 / 購物中心倍數）
 *   0041a579  call 0x440cac     ; 費用訊息框（0x5dc ms）
 *   0041a5c0  call 0x40df69     ; 收費（錢真的轉手）
 *   0041a71e  call 0x44f42d     ; ★ 付款人的台詞（事件 9/10/11）
 *   ```
 *   ⇒ 原版**必定**是「盤停下來 → 訊息框 → 付款人的台詞」。
 *
 *   本引擎一条 action 就把后果写完、演出是事后补的，所以这里等 `SCREENS` 的
 *   `event()` 派完，把这一条 action 的台词按**档**（`order` → `lineRank`）排进 `heldSpeech`，
 *   再由 `releaseHeldSpeech` 按 `presentation-order.ts` 的 `lineMayEnter` 一句一句放上台：
 *
 *   - `beforeStage`（道具 / 出牌台词、壞神附身、回合开始那三句）⇒ 只等 `lead` 档的框
 *     （「使用%s」、亮牌、事件框）与屏上正开着的框；影片反过来等它（`speechAheadOfFilms`）；
 *   - `afterStage`（送醫院 / 送監獄 / 設施收費…）⇒ 等 `stage` 档的框与影片那一类演完；
 *   - `afterTailBox`（土地公 / 福神）⇒ 连 `tail` 档的框（顯靈框、理賠框）也等。
 *
 *   ★★ 第十五份（「台词和棕色对话框又重叠了」）：先前 `beforeStage` 的句子「永不押后」，
 *     于是电脑用道具时「使用定時炸彈」框（`0x00448070`，在道具函数**之前**）与道具台词同时上屏。
 *     现在任何一句都不会在屏上有框时上台，框也不会在台上有气泡时起播（`boxMayStart`）。
 *
 *   ⚠️ **死锁自查**：台词只等**档更小**的框、框只等档更小的台词，影片只等 `beforeStage`；
 *     没有环（`presentation-order.test.ts` 的长局逐拍模拟验证「不重叠、不卡死」）。
 *
 * ⚠️ 押后而不是「冻结队列」：`SpeechQueue` 的时间基准是**绝对时刻**（`shownAt`），
 *   冻结再解冻会把整段演出时长算进那 1000 ms 里，那一段台词就一闪而过。
 *   押在**入队之前**没有这个问题。
 */
function queueSpeech(lines: readonly SpeechLine[]): void {
  if (lines.length === 0) return;
  holdSpeech(lines);
  releaseHeldSpeech(performance.now());
  // ★ 押着也要续帧：`speechTick()` 靠每一帧回头看「框 / 演出收摊了没有」
  //   （`requestRender` 的续帧条件里也有 `heldSpeech.length > 0`）
  requestRender();
}

/** 按档押进 `heldSpeech`（不放行）—— `notifyApplied` 在各整屏认 action **之前**调 */
function holdSpeech(lines: readonly SpeechLine[]): void {
  if (lines.length === 0) return;
  heldSpeech = insertByRank(
    heldSpeech,
    lines.map((l) => ({
      bubble: l.bubble,
      order: l.order,
      rank: lineRank(l.order),
      ...(l.cue === undefined ? {} : { cue: l.cue }),
    })),
  );
}

/**
 * ★ 第十五份：这一句前面那一段演出（`SpeechCue`）演完了没有 —— 没演完它就不算数。
 * 判据全是现取的表现状态位（与 `stageBusyFlags` 同一批变量）。
 */
function cueDone(cue: SpeechCue): boolean {
  switch (cue) {
    case 'godAscend':
      return godAscend === null;
    case 'godAttach':
      return objectFlight === null && pendingCardFlight === null && godAscend === null;
    case 'manifestBox':
      return !noticeKeyShowing(MANIFEST_NOTICE_KEY);
    case 'buildHammer':
      // 大锤排着 / 正在敲 ⇒ 没完；停在「敲完、等台词」那一拍（`buildFxSeamHeld`）或没有大锤 ⇒ 完了
      if (pendingBuildFx !== null && pendingBuildFx.first === 'hammer') return false;
      return !(buildFx !== null && buildFx.clip === 'hammer' && !clipDone(buildFx, performance.now()));
  }
}

/**
 * 押着的台词能上台的就上台（按档从小到大，只看队头：档更大的一定更受限）。
 * 每帧由 `speechTick` 调，`queueSpeech` 交进来那一拍也调一次。
 */
function releaseHeldSpeech(now: number): void {
  if (heldSpeech.length === 0) return;
  const boxes = boxSnapshot();
  const out: SpeechBubble[] = [];
  const keep: typeof heldSpeech = [];
  let blocked = false;
  for (const h of heldSpeech) {
    // ★ 第十五份：前一段还没演完的那几句（`cue`）不算数 —— 跳过它，别让它挡住后面的
    if (blocked || (h.cue !== undefined && !cueDone(h.cue))) {
      keep.push(h);
      continue;
    }
    if (lineMayEnter(h.order, boxes)) out.push(h.bubble);
    else {
      blocked = true; // 档是排好的：这一句过不了，后面档更大的也过不了
      keep.push(h);
    }
  }
  heldSpeech = keep;
  if (out.length > 0 && speechQueue.push(out, now) > 0) requestRender();
}

/**
 * ★★ 第十六份：框 / 台词两侧的判据收在 `presentation-host.ts`（单测跑的是同一份），这里只交现取的状态。
 * ⚠️ `filmsBusy` 用 `stageBusyFlags(false)`：不回头问整屏判据（断环，见那个文件的文件头）。
 */
const presentationHost = new PresentationHost({
  screens: SCREENS,
  env: () => uiEnv(),
  filmsBusy: () => stageBusy({ ...stageBusyFlags(false), godLine: false }),
  godLine: () => ({ showing: godLine !== null, pending: pendingGodLine !== null }),
  speech: () => ({ onStage: speechQueue.length, held: heldSpeech }),
  cueDone: (cue) => cueDone(cue),
  deferredScreens: () => deferredScreenEvents.length,
  magicAwaitingPick: () => magicAwaitingPick(),
  bailClosing: () => bailClosing(),
});

/** 台词那一侧此刻的样子（框的起播闸用）*/
function speechSnapshot(): SpeechSnapshot {
  return presentationHost.speechSnapshot();
}

/** 框那一侧此刻的样子（台词的上台闸用）—— 见 `PresentationHost.boxSnapshot` */
function boxSnapshot(): BoxSnapshot {
  return presentationHost.boxSnapshot();
}

/**
 * ★★ 第十五份（需求方拍板）：分紅 / 開獎 / 月结 / 魔法屋女巫窗也走同一道起播闸 ——
 *   台上还有上一条 action 的气泡时先不起（原版 `player_say` 阻塞，说完才轮到这些模态屏）。
 *   这几屏都是在 `event()` 里当场起播的，所以闸挡的是**派发**：把那一对 `before/after` 押着，
 *   闸一开（`flushDeferredScreenEvents`，每帧）再原样派。押着期间算 `lead` 档的排队框、算台上在演。
 */
const deferredScreenEvents: { screen: UiScreen; before: GameState; after: GameState }[] = [];

/** 这一对 `before/after` 会不会让这一屏**起播**（判据与各屏 `event()` 的第一道门同一条）*/
function screenStarts(id: string, before: GameState, after: GameState): boolean {
  switch (id) {
    case 'monthly':
      // ★ 第二十一份：与 `monthlyScreen.event` 同一道门 —— 跨月且 core 交下了这一次的月结现场
      return after.totalMonths > before.totalMonths && (after.lastMonthlySettle ?? null) !== null;
    case 'shares':
      return dividendDayCrossed(before, after);
    case 'lottery-draw':
      return lotteryDrawCue(before, after) !== null;
    case 'magic':
      return after.pending?.kind === 'magicHouse' && after.pending !== before.pending;
    default:
      return false;
  }
}

function deliverScreenEvent(s: UiScreen, before: GameState, after: GameState, env: UiScreenEnv): void {
  if (
    DAY_AND_MAGIC_BOXES.has(s.id) &&
    (deferredScreenEvents.some((d) => d.screen === s) ||
      (screenStarts(s.id, before, after) && presentationHost.boxBlocked(SCREEN_BOX_TIER.monthly)))
  ) {
    deferredScreenEvents.push({ screen: s, before, after });
    requestRender();
    return;
  }
  s.event?.(before, after, env);
}

/** 每帧：闸开了就把押着的那几条按原先后派出去 */
function flushDeferredScreenEvents(): void {
  if (deferredScreenEvents.length === 0) return;
  if (presentationHost.boxBlocked(SCREEN_BOX_TIER.monthly)) {
    requestRender();
    return;
  }
  const env = uiEnv();
  for (const d of deferredScreenEvents.splice(0)) d.screen.event?.(d.before, d.after, env);
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
  // ★ 第十四份試玩回報：换人前的倒数 —— 落在地産格上收尾 8 tick（0x88）、回合开头就被挡 3 tick（0x83）
  //   （判据与出处见 `landing-pause.ts`）
  const pauseTicks = turnEndPauseTicks(before, state, topo);
  if (pauseTicks > 0) landingPause = { ticks: pauseTicks, idleAt: null };
  // ★★ 第二十六份 panel：换人那一条切成两段逐段演（`tickMagicSequence`，每段各自走这里一遍）——
  //   落地影片属于下一位回合开头，归第二段
  if (freshTurnBeats(before, state) !== null) {
    magicSeqAction = action;
    return;
  }
  // ★★ 降落伞落地（需求方 2026-09-24）：轮到一个还没上盘的人 ⇒ core 在回合交接时摆人 + 落地，
  //   这里补那一段 `0x22f + 角色` 的影片（`landing-fx.ts`）。它在原版是新回合的**第一件事**
  //   （`0x418c55` 开头，掷骰 / 电脑决策之前）⇒ 排在本 action 其余演出之后也无妨：换人那条 action 没有别的片。
  const landed = landingTrigger(before, state);
  if (landed !== null) startLandingFx(landed);
  // ★ D-MAGIC-16：魔法屋逐人分段由 `tickMagicSequence` 一段一段起（每段各自走这里一遍）
  if (freshMagicBeats(before, state) !== null) {
    magicSeqAction = action;
    return;
  }
  // 放置類道具（路障/地雷/定時炸彈）真正落地 → 投掷动效 + 落地音
  if (action.type === 'useTool') startObjectFlight(before, action);
  // 機器工人（9）/ 魔法屋「就地加蓋」/ 天使卡（9）原地建屋 → 大锤影片
  // （盖到 5 级时接 `0x20b`）。判据在 core 的 `lastBuildUpgrades` 里，不看 action 种类。
  startBuildFx(before);
  // ★★ 第二十六份（「约翰乔的汽车哪里来的」）：电脑换车 ⇒ 「使用汽車」框底下还是旧图组，框收了才换
  //   （原版 `0x00448070` 框 → `0x0044807e` 道具函数里 `0x40b93b` 换图组 → 道具台词；`vehicle-hold.ts`）
  const vh = vehicleHoldOf(before, state);
  if (vh !== null) vehicleHold = vh;
  // 卡片 / 請神符的飞行动效（Q-TOOL-5）—— 是否真的播由 exe 的闸门定
  // ★★ 第十二份試玩回報：原版用卡是「亮牌 1500 ms（`fcn_00441f73`，阻塞）→ 卡片函数」，
  //   飞行在卡片函数**里面** ⇒ 先挂起，等亮牌收屏再起（`tickPendingCardFlight`）。
  //   亮牌本身由事件框那一屏认 `lastCardPlay` 起播（`event-box-screen.ts` 的 `cardUseView`）。
  if (action.type === 'useCard') pendingCardFlight = { before, action, landSfx: cardLandSfx(action.cardId, before, state) };
  // ★★ 「踩到惡犬」那一段（試玩回報：踩到狗直接進醫院、没有咬人动画/配音）——
  //   **必须排在 `startConfineFx` 之前**：原版那一支先把 0x214 播完、才走到
  //   `send_to_hospital` 里的 0x20c（VA 0x0041b837 → 0x0043ed59）。
  //   这一段不带 `options.animation` 闸（原版那一支没有 `cmp [0x497159], 0`），
  //   详见 `dog-fx.ts` / `startDogFx`。
  startDogFx(before, state);
  // ★★ 飛彈（7）/ 核彈（13）的爆炸影片 —— **必须排在 `startConfineFx` 之前**：
  //   原版是 `view_to(爆心)` → `damage_area`（`0x0044707a`，只给波及者打 `+0x15 |= 0x40`）
  //   → `0x0044708e fcn_0045144f` 播自己那一段（0x210 / 0x212）→ **之后**才逐人
  //   `send_to_hospital`（`0x004470ac test [+0x15], 0x40` 那个循环，各播 0x20c）。
  //   （2026-09-23 订正：先前这里写成「damage_area 里先播救护车、最后才播爆炸」，与 exe 相反；代码次序本来就对。）
  //   先来的排前面、后面的自动排队（`queueBoardFilm`）。
  //   ⚠️ 不加 `options.animation` 闸（原版这两支里没有 `cmp [0x497159], 0`）。
  startMissileFx(action, before);
  // ★ 新聞 4「外星人攻打地球」的飛碟影片（試玩回報：那一段被整个跳过）——
  //   判据是 `lastEvent` 刚变成 `{ news, 4 }`（`alien-news-fx.ts`）。
  //   ★★ 第十五份（2026-09-23 订正）：**排在住院影片之前**。`fcn_0044913d` pass 1 的次序是
  //   `0x0044921d view_to(建筑)` → `0x0044922d damage_area`（只打 `0x40` 标记）→
  //   `0x0044925b fcn_0045144f(0x213)` 飛碟 → `0x0044926e..0x0044928e` 逐人 `send_to_hospital`
  //   （`0x00449285`，各播一辆救护车 0x20c）。先前把它排在住院之后、又用 `startBoardFilm` 顶掉了救护车。
  //   ⚠️ 也**不**加 `options.animation` 闸：原版这一支里没有
  //   `cmp [0x497159], 0`（与住院/入獄/神明那三支不同），照 exe 走。
  startAlienNewsFx(before, state);
  // ★ 「送進監獄／醫院」那一段 FLIC（Q-ANIM-1 未接清单之一）—— 与 action 种类无关：
  //   判据是**占用表/计数变没变**（`confine-fx.ts` 的 `confineFxTrigger`），
  //   因为送去坐牢/住院的来源有十来个（卡、狗咬、踩雷、命運、新聞、罰款…），
  //   逐个 action 种类去接必漏。
  startConfineFx(before, state);
  // ★★ 第十二份试玩回报 #1：神明**离身升天**（`god_detach` 0x40e32c）—— 必须排在
  //   `startGodFx` 之前：换神那一支是 `god_activate` 里先 `0x40eb3f call 0x40e32c`
  //   把旧神送走（升天），**然后**才播新神那一段影片（`tickBoardFilm` 会等它演完）。
  startGodAscend(before, state);
  // ★ 神明降臨／發威（Q-ANIM-1）—— 判据是 `player.godInfo` 刚变（`god-fx.ts`）
  startGodFx(before, state);
  // ★ 第八份试玩回报 #5：附身影片之后那句开场白（`fcn_0040e2a2`，2400 ms）—— 写在影片钉住的最后一帧上；
  //   ★ 第十八份：「動畫過程」关掉时没有（与影片同一道闸）
  startGodLine(before, state);
  // ★ 第十二份試玩回報：新聞 5 / 15 / 20 / 21「随机挑一处建筑」那一族的整块影片
  //   （龍捲風 0x217 等，`news-place-fx.ts` 的表）。判据是 `lastEvent` 刚变成带 `place` 的
  //   那几条新聞；与新聞 4 同样**不看**「動畫過程」开关、同样等訊息框收屏（`afterOverlay`）。
  startNewsPlaceFx(before, state);
  // ★ 第二十二份（gap-audit #6）：新聞 18 地震 / 19 山洪 —— 没有整块影片，是受灾地块白闪一遍再停一下
  //   （`news-flash-fx.ts`）。同样等事件框收屏；19 的房主台词排在它之后（`stageBusy` 押着）。
  // ★ A-2：命運 0 拆屋 / 1 徵收那一块也在这条路上（同一支 `0x451985`，见 `startNewsFlash`）。
  startNewsFlash(before, state);
  // ★ 第八份试玩回报 #3：被外星人綁架的飛碟 / 出國的飛機（`disappear-fx.ts`，`fcn_0040d375` 的尾巴）——
  //   判据是 `blocking.disappearing` 刚从 0 变非 0；原版这一支同样没有「動畫過程」开关。
  startDisappearFx(before, state);
  // ★ W-55 行 4：「惡魔顯靈拆屋」那一段 110×110 的爆破片（試玩回報：客户端一段都没播）——
  //   判据是 `notices` 里**新出现** `god.demolish`（`devil-fx.ts` 的 `devilDemolishFxTrigger`）。
  //   排在神明附身影片之后：顯靈是**落点尾块**（`0x0041b077`）的事，与 `godInfo` 变没变无关。
  startDevilFx(before, state);
  // ★ 魔法屋「就地拆除房屋」（2026-09-23 补）：訊息框（`beforeFilms`）→ 0x211 影片。不看「動畫過程」。
  startMagicDemolishFx(before, state);
}

// ============================================================
//  魔法屋逐人演出（D-MAGIC-16）—— `0x431caa` 的逐人循环
// ============================================================

/**
 * 正在逐段演的魔法屋那一趟；`null` = 没在演。
 *
 * ★ 原版 `0x431caa` 是**阻塞**的逐人循环：每位中签者整支演完（闸 → `0x41906a(1)` 重画 →
 *   訊息框 → 镜头 / 影片 → 台词）才轮到下一位，「抽取命運三張」每一张也是一整段命運演出。
 *   本引擎的 core 一条 action 就写完了，于是交出 `lastMagicBeats`（每段前后的完整状态，
 *   段里当前玩家 = 那位中签者），这里**一段一段**喂给平常那条表现出口
 *   （`startActionFx` + `notifyApplied`，训练有素的那些判据 —— 框在片前、台词在片后 —— 原样复用），
 *   上一段的框 / 影片 / 台词全收了才起下一段。整趟演完之前回合驱动不往下走（`holdForActorWalk`）。
 */
let magicSeq: MagicSequence | null = null;
/** 带出这一趟的那条 action（`startActionFx` 按 action 种类分流的几处要它；魔法屋这条不命中任何一处）*/
let magicSeqAction: Action | null = null;
/** 正在逐段演的是哪一种：魔法屋逐人（`lastMagicBeats`）/ 换人那一条的两段（`lastTurnBeats`，第二十六份 panel）*/
let magicSeqKind: 'magic' | 'turn' = 'magic';

/**
 * ★★ 第二十六份 panel：换人那一条还在分界**之前**那一段（`0x41c84f` 还没轮到）——
 * 还款提醒窗（`0x436a5a` → `0x43695e`）等它演完才开。
 */
function turnHandoffPending(): boolean {
  return magicSeq !== null && magicSeqKind === 'turn' && magicSeq.next < 2;
}

/** 棋盘 / 侧栏 / 镜头此刻该按哪一份状态看（逐段演的时候是那一段的 after） */
function magicShownState(): GameState {
  return magicSeq?.shown ?? state;
}

/**
 * 魔法屋那一条 action 落地：与演出无关的收尾照做，演出交给 `tickMagicSequence`。
 * 女巫窗口要看到 `pending{magicHouse}` 撤掉才会收场（联机旁观 / 託管），所以只给它发 `event`。
 */
function notifyMagicApplied(before: GameState, beats: MagicSequence['beats'], kind: 'magic' | 'turn' = 'magic'): void {
  // 音效那一半照放（落点那一声等），台词一句不要 —— 逐段演的时候各段自己说
  playSoundFor(before, state);
  amountPage = null;
  dropStaleLocalModals();
  dialogHot = null;
  if (!aiVenuePending(state)) {
    syncShopUi();
    syncLoanUi();
    syncAtmPending();
  }
  if (kind === 'magic') magicScreen.event?.(before, state, uiEnv());
  magicSeqKind = kind;
  magicSeq = magicSequenceStart(beats);
  log(kind === 'magic' ? `魔法屋：逐人演出 ${beats.length} 段` : '換人：先演上一位 / 推日期，再換側欄');
  requestRender();
}

/** 上一段还没演完吗（框 / 影片 / 建屋 / 走子 / 台词 —— 与回合驱动同一份判据）*/
function magicSequenceBusy(): boolean {
  // ★ 第十五份：「抽取命運三張」每一张的 800 ms（命運让出框之后那一截）也算 —— 原版 `0x44db81` 整段阻塞
  return stageBusy(stageBusyFlags()) || speechQueue.length > 0 || heldSpeech.length > 0 || eventBoxTailPending();
}

/** 每帧：上一段收了就起下一段；全部演完就收摊（镜头 / 侧栏交还施法者，= 原版 `0x004324fa` 还原当前玩家）*/
function tickMagicSequence(): void {
  const seq = magicSeq;
  if (seq === null) return;
  const step = magicSequenceStep(seq, magicSequenceBusy());
  if (step.done) {
    magicSeq = null;
    log(magicSeqKind === 'magic' ? '魔法屋：逐人演出結束' : '換人：逐段演出結束');
    requestRender();
    renderPanel();
    return;
  }
  const beat = step.beat;
  if (beat === null) {
    requestRender();
    return;
  }
  magicSeq = step.seq;
  // ★ 每一支开头的 `0x41906a(1)`：把主窗口 WM_PAINT 过程（`0x417e26` 的 `0x418bb9` 那一支）当场跑一遍 ——
  //   `fcn_00415e70` 居中（有小地图标记就停在标记上，否则居中到**当前玩家** = 这位中签者）、重画侧栏。
  //   影片待播时 `centerOnCurrentPlayer` 是冻住的，所以在这里当场居中一次。
  // ★★ 第二十六份 panel：换人那一条 —— 第一段（惡人那一趟 / 推日期）没有这次重画；第二段开头只有
  //   `0x436a5a` 真的重画了（`lastPanelTurn` 已是下一位）才居中到他，侧栏由 hud 按 `magicShownState` 换。
  const recentre =
    magicSeqKind === 'magic'
      ? beat.before.currentPlayer
      : step.seq.next === 2 && beat.after.lastPanelTurn?.actor === beat.after.currentPlayer
        ? beat.after.currentPlayer
        : null;
  if (recentre !== null && minimapMarker === null && followPlayer) {
    const who = (magicSeqKind === 'magic' ? beat.before : beat.after).players[recentre];
    const at = cameraFollowTarget(null, who, (id) => map.nodes[id - 1]);
    if (at !== null) camera = pixelCamera(at.x, at.y, camera.view);
  }
  // 平常那条表现出口，按**这一段**的前后状态走一遍（出口里读的是全局 `state`，这一刻换成这一段的 after）
  const real = state;
  state = beat.after;
  try {
    startActionFx(magicSeqAction ?? { type: 'settle' }, beat.before);
    notifyApplied(beat.before);
  } finally {
    state = real;
  }
  const who = beat.after.players[beat.after.currentPlayer];
  log(`${magicSeqKind === 'magic' ? '魔法屋' : '換人'}：第 ${step.seq.next}/${step.seq.beats.length} 段（P${(who?.index ?? 0) + 1}）`);
  requestRender();
  if (magicSeqKind === 'turn') renderPanel();
}

/** 魔法屋「就地拆除房屋」那一段 0x211 —— 判据见 `magic-fx.ts` 的 `magicDemolishFxTrigger` */
function startMagicDemolishFx(before: GameState, after: GameState): void {
  if (!magicDemolishFxTrigger(before, after)) return;
  // 訊息框那 1500 ms 里房子还在（棋盘按 before 画）；起播那一刻放开（`releaseBoardOnStart`）
  deferredBoardBefore = before;
  startBoardFilm(MAGIC_DEMOLISH_FILM);
  log(`影片：魔法屋拆房 0x${MAGIC_DEMOLISH_FILM.resource.toString(16)}（${MAGIC_DEMOLISH_FILM.frames} 帧 × ${MAGIC_DEMOLISH_FILM.frameMs} ms）`);
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
  // ★ 走一格的终点 = **踏上的那一格**（用引擎自己的 `pickNextNode` 从 before 回放），不是 after 的 `nodeId`
  //   —— 踩惡犬 / 地雷时 after 已经在醫院，拿它当终点是一段 4 秒横跨地图的补间（第八份 #8）
  const landing = action.type === 'step' ? nextNodeOf(before, topo) : null;
  // ★ 审计 #17：其余 action 也问一次 —— 住进旅館那一趟（`0x40d5a5` 支 A）出在落点结算里
  const t = walkTweenFor(action.type, before, state, (id) => map.nodes[id - 1], landing);
  if (t === null) return;
  // ★★ 审计 #17：走进旅館要等落点例程**全部**收完才起步（`0x41a85e call 0x40d5a5` 是落点例程最后一件事，
  //   之前是訊息框、住宿台词 `0x0041a7e0`、理賠框 `0x0041a82d`；走路在之后的 tick 里）⇒ 先原地站着，
  //   由 `tickPendingRelocateWalk` 等台上空了再起。
  if (t.relocate?.kind === 'enter') {
    pendingRelocateWalk = t;
    renderer.parkPlayer(t.player, t.from);
    return;
  }
  beginTween(t);
}

/** 起一段玩家位移补间（`tweenStepIfMoved` 与挂起的「走进旅館」共用）*/
function beginTween(t: WalkTween): void {
  const p = state.players[t.player];
  // ★ `t.special`（不写死 false）：走回棋盘走 `dist × 0.125` 那一支 —— 见 `tween.ts`
  noteWalkGap();
  renderer.startWalk(
    t.player,
    t.from,
    t.to,
    (p?.trafficMethod ?? 0) & 3,
    t.special,
    tickMs(options.speed),
    performance.now(),
    t.relocate ?? null,
  );
}

/**
 * ★★ 审计 #17：挂起的「走进旅館」—— `tweenStepIfMoved` 记下，台上全空了（訊息框 / 台词 / 理賠框 /
 *   影片都收了）才起步。**不进** `stageBusy`（否则押后的住宿台词等它、它又等台词 ⇒ 互等），
 *   回合驱动 / 联机收件箱在 `holdForActorWalkReason` 里单独等它（与 `pendingDisappearFx` 同一种闸）。
 */
let pendingRelocateWalk: WalkTween | null = null;

function tickPendingRelocateWalk(): void {
  const t = pendingRelocateWalk;
  if (t === null) return;
  if (
    speechQueue.length > 0 ||
    heldSpeech.length > 0 ||
    deferredScreenEvents.length > 0 ||
    activeUiScreen() !== null ||
    presentationHost.boxSnapshot().pendingRanks.length > 0 ||
    stageBusy(stageBusyFlags()) ||
    pendingDisappearFx !== null ||
    eventBoxTailPending()
  ) {
    requestRender();
    return;
  }
  pendingRelocateWalk = null;
  beginTween(t);
  requestRender();
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
  // ★ W-72：**网页版是空操作**。它在进標題畫面之前就把 7 个档案（含 Speaking.mkf，
  //   57 MB）整包下完了，`loadArchivesForWeb` 里已经 `sound.addArchive` 装好；
  //   这里再拉一次就是白拉 57 MB —— 而且联机时第一句语音本来就该已经在了。
  //   桌面壳没有「整包预载」这一步，照旧按需拉（行为一行没变）。
  if (!isDesktop()) return;
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
 *
 * ★★ 2026-09-19（试玩回报「盘子还没停下来 NPC 的台词都触发了」）：台词**不再直接排进
 *   队列**，而是**返回给调用方**（`notifyApplied`）—— 因为原版那一句是**同步**说的，
 *   而它所在的整段流程里，轉盤 / 訊息框 / 事件框… 都是**阻塞**调用，顺序由**调用顺序**定死
 *   （設施收費：`0x41a458` 轉盤 → `0x41a579` 訊息框 → `0x41a5c0` 收費 → `0x41a71e` 台词）。
 *   本引擎一条 action 就把后果写完，演出是事后补的 —— 于是台词必须**等演出完**
 *   才上台，见 `heldSpeech`。
 */
function playSoundFor(before: GameState, after: GameState): SpeechLine[] {
  // ★ 有人出局**没有**音效：先前这里放的 Effect #5 出自 `0x0040d1cb push 5`，紧跟的是 `call 0x4549cf`
  //   = **播 MIDI**（id 5 = `MIDI06.MID`，拍賣配乐），而且只在释放的地产 > 3 处（`0x0040d1c6 cmp esi,3 / jle`）、
  //   接下来要随机连拍 3 处（`0x0040d1d9..0x0040d1f5`）时才放 —— 那几场拍卖开屏时 `auction-screen.ts`
  //   本来就会点 `midi06.mid`。破产那一刻原版不放 Effect.mkf 的任何音效（第十三份回报复核）。
  // ★ 落在銀行**没有**音效：先前这里放的 Effect #4 出自 `0x0043674d push 4`，但那一句紧跟的是
  //   `0x0043674f call 0x4549cf` —— 那是**播 MIDI**（`sprintf("open sequencer!%s alias mid", [0x47e793 + 4*id])`
  //   → `mciSendString`），id 4 = `MIDI05.MID`，即貸款屏的配乐（`syncLoanUi` 里 `midi05.mid` 那一句），
  //   不是 Effect.mkf 的第 4 个音效。它只在 `_rich4_ui_bank_entry` 的**真人**那一支（`0x004366a3
  //   cmp byte [+0x15],1 / jne 0x4367ab`）；电脑那一支与 ATM 入口 `fcn_004379c9` 都不放音乐。

  // ★★ 2026-09-22（第十一份試玩回報 #17「踩到卡片格子时应该有个提示音」）：
  //   原版在**落地处理**的分派器**之前**先统一放一声（種類 2..16）——
  //   @source `0x00419884 cmp ebx,2 / jb`（種類 0/1 含公園不放）、`0x00419889 cmp ebx,0x10 / ja`、
  //     `0x00419892 mov al,[ebx + 0x475299]`（種類→下標）、`0x0041989b add eax,0x48234a`、
  //     `0x004198a1 call 0x4542ce`。
  //   下標表 `0x475299 = [9,0,10,10,10,10,10,10,10,10,16,16,16,16,10,10,10]` ⇒
  //     種類 2..9 與 14..16 ⇒ Effect **43**；種類 10..13（得點×3 + **卡片**）⇒ Effect **48**。
  //
  //   判据取「**这一步真的走到了落点**」= `moving → settling`，而不是「nodeId 变了」——
  //   后者对走子途中经过的每一个特殊格都会成立（原版只在**停下**那一拍的分派器前放）。
  if (before.phase === 'moving' && after.phase === 'settling') {
    const cur = after.currentPlayer;
    const landed = after.players[cur];
    const kind = landed === undefined ? 0 : (topo.nodes[landed.nodeId - 1]?.specialKind ?? 0);
    if (kind >= 2 && kind <= 16) {
      sound.play('Effect.mkf', kind >= 10 && kind <= 13 ? SOUND_IDS.CARD_SQUARE : SOUND_IDS.SPECIAL_SQUARE);
    }
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
  //   数组换了身份就说明刚发生了一趟；槽 4 只可能是娃娃（`npcStepOnce` 走 0..3；保釋那一下不走）。看动作类型也行，但这条对
  //   「AI 用 / 服务器广播用」同样成立 —— 原版也是谁在场都听得见。
  if (
    after.lastNpcWalks !== before.lastNpcWalks &&
    after.lastNpcWalks.some((w) => w.slot === specialSlotOf(ACTOR_DOLL))
  ) {
    // ★★ 2026-09-22（第十一份試玩回報 #9「机器娃娃清扫的语音应该是持续播放」）：
    //   原版这一声是**循环播放**的 —— `0x40ded1 push 1`（arg3）→ `0x4542ce` →
    //   `0x454100 call [eax+0x30]` = `IDirectSoundBuffer::Play(..., dwFlags=DSBPLAY_LOOPING)`；
    //   走完整趟在 `0x40d8dc` 再 `call 0x4542e9`（vtable+0x48 = `Stop`）。
    //   38 号本身只有约 **0.56 秒**，所以先前「不传 loop」等于整趟只响开头一声。
    //   ⚠️ 玩家说的「语音」其实是**音效**：原版这一趟**没有**持续的角色语音
    //      （只有那一次性的「替我除掉障礙物！」，属另一条缺口）。
    // ★★ 第十四份 #5：娃娃**等用道具那句台词说完**才上路（`0x00446b2e call 0x44ef41` 同步，
    //   之后才 `fcn_0040dd1f` 起步）⇒ 这一趟先押着（`renderer.holdActorWalk`），
    //   `tickDollRelease` 在台词队列空了那一拍放开、再起这一声循环音。
    renderer.holdActorWalk(specialSlotOf(ACTOR_DOLL));
    dollWalkHeld = true;
  }

  // ★ **買地 / 買現成設施成功**那一下 —— 音效 49（见 `SOUND_IDS.BUY_PROPERTY`）。
  //
  // @source VA 0x0041a0f1（買地，`call 0x4542ce` 在 0x0041a0f6）/ VA 0x0041a939
  //   （買現成設施），两条**同形**：`push 0x4823d2 / call rich4_play_sound_effect`。
  //   同一张表 `0x48231a`（8 字节一项）的表项 23 ⇒ `Effect.mkf` 资源 49；
  //   下一项 0x4823da 就是 `SOUND_IDS.GOD_MANIFEST` 的 50（换算见 audio.ts）。
  //   全 exe 里 `push 0x4823d2` 只有这两处 ⇒ 買地与買設施**共用** 49。
  //
  // ⚠️ 判据是**归属真的变了没有**，不是「有没有点过买」：被衰神／死神拦下时
  //   `purchase` 直接返回、归属一格都不写（`rules/purchase.ts` 的 `godBlockedPurchase`），
  //   于是这里**不响** —— 与原版一致（原版那声在扣款/写归属**之后**）。
  //   `buyLand` 的 pending 是 `{ kind:'buyLand', landId, … }`、比对 `landOwner`；
  //   `buyFacility` 是 `{ kind:'buyFacility', facilityId, … }`、比对 `facilityOwner`
  //   —— 两列都拿实体号当下标（`reduce.ts` 里就是 `landOwner[landIndex]` /
  //   `facilityOwner[fac.id]` 这么写的）。
  if (before.pending?.kind === 'buyLand') {
    const id = before.pending.landId;
    if (
      after.landOwner[id] === after.currentPlayer + 1 &&
      before.landOwner[id] !== after.currentPlayer + 1
    ) {
      sound.play('Effect.mkf', SOUND_IDS.BUY_PROPERTY);
    }
  } else if (before.pending?.kind === 'buyFacility') {
    const id = before.pending.facilityId;
    if (
      after.facilityOwner[id] === after.currentPlayer + 1 &&
      before.facilityOwner[id] !== after.currentPlayer + 1
    ) {
      sound.play('Effect.mkf', SOUND_IDS.BUY_PROPERTY);
    }
  }

  // 角色語音（T-052）。`speechResourceFor` 已经把越界挡在外面 ——
  // T-051 的 `speechIndex()` 对越界**抛 RangeError**（原版无边界检查），
  // 表现层不该因此把整局打断，故这里只播合法的那几个。
  // ★★ 先出**卡牌台词**（原版那句在卡片函数体内，先于效果引发的台词），
  //   再出状态跃迁派生的台词 —— 顺序与原版一致。
  const cardSpeech = cardPlaySpeechLines(before, after);
  // ★★ 第十一份試玩回報 #3：**道具台词**（原版 `_tool_strings`，不分人机）。
  // ★★ 第十四份試玩回報 #2：次序是 `beforeStage`（`TOOL_LINE_ORDER`）—— 原版 13 件道具
  //   都是**先** `player_say`、**再**选格 / 大锤 / 投掷 / 爆炸（VA 逐件见 `speech.ts`）。
  //   先前取 `afterStage`，機器工人的大锤（`pendingBuildFx`）一起播就把台词押到了片尾。
  //   `beforeStage` 永不押后，影片 / 建屋动效 / 投掷都会等 `speechQueue` 说完
  //   （`filmWaitsForSpeech`；投掷见 `tickObjectFlight`）。
  // ★★ 第十四份 #4：本机真人选定道具时已经先说过（`sayOwnToolLine`）⇒ 这一条不再说第二遍
  const spokenOwn = ownToolLineSpoken(before, after, ownToolLine);
  if (spokenOwn) ownToolLine = null;
  const toolLines = spokenOwn ? [] : toolUseSpeechLines(before, after);
  const spoken = speechEventsFor(before, after, topo);
  // ★ W-51：台词现在带**次序**交出去（`SpeechLine.order`），由 `queueSpeech` 分流。
  //   卡牌台词**不是探测器**（它走 `lastCardPlay` 这条非状态跃迁的通道）。
  //   ★ 第十五份：逐卡裁定过了 —— 从手里出的牌，出牌台词是卡片函数里**第一个**演出
  //   （在飞行 / 影片 / 结果框之前）⇒ `beforeStage`；收費那一段的被动卡与回应台词 `afterStage`
  //   （`speech.ts` 的 `cardPlaySpeechLines`）。先前一律 `afterStage` 引的 `0x00443afb` 是怪獸卡
  //   影片**之后**的第二句（效果台词），出牌那句是 `0x0044398f`，在飞行 `0x00443a6a` 之前。
  const cardLines: SpeechLine[] = [...cardSpeech, ...toolLines];
  if (spoken.length === 0) return cardLines;
  ensureSpeakingArchive();
  // ★ 语音**不在这里放** —— 见 `speechTick()`。
  //   原版 `_rich4_player_say` 是**一句播完再返回**（同步），一次 `applyAction`
  //   里派生出的两三句是**一前一后**；先前这里循环 `sound.play` 是**同时**响
  //   （登记为 Q-SPEECH-6）。现在语音跟着**显示队列**走：一段开始显示才放它那句。
  // ★ 2026-09-16：不光出声，还把**说话人自己那一句**显示出来。
  //   原版 `_rich4_player_say` 的两步（白字字幕 + 金貝貝那种 `@DD` 表情图）
  //   由 `speech-bubble.ts` 负责；`speechLinesFor` 把 `SayEvent` 翻成排好版的段落 + 次序。
  //   金貝貝那一列**整列没有文本也没有语音**，只有一张 `Data.mkf #0x207` 的表情图
  //   （见 `@rich4/data` 的 `SPEECH_LINES` 与 `speechEmojiImage`）。
  return [...cardLines, ...speechLinesFor(after, spoken)];
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
  // ★★ 审计 #15：開局跳伞过场期间不下棋（原版过场 `fcn_00415872` 是进棋盘之前的阻塞调用）。
  //   先前这里没有屏号闸 ⇒ 全电脑对局在过场底下全速开打、第一扇框一开过场就再也收不了场。
  //   `endIntro()` 与 W-60 的 `shouldResumeDriver('intro', 'game')` 会在过场放完时叫醒它。
  if (driverParkedByScreen(screen)) return;
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
  // ★★ 首席复核（W-74）：本机座位被服务器**超时託管**（`autopilot === 'idle'`）时，这一回合由
  //   服务器的 `#driveComputers` 同步走完 —— 本机**不许**再替自己拿主意。否则镜像里那个
  //   AUTOPILOT 位会让本机 AI 也发一份意图：多数被定序器以「不是你的回合」拒掉（对方只看到报错），
  //   少数会在座位刚还给真人的那一拍被**收下**（替一个已经回到座位上的人掷了骰）。
  if (net !== null && net.room?.seats.find((x) => x.seat === net?.seat)?.autopilot === 'idle') return;
  // ★ 联机的竞价：AI 控制的那一口（电脑 / 掉线代打 / 本机开的託管）**全部**归服务器出
  //   （`server/hub.ts` 的 `#driveComputers`）；提交权此刻属于举牌者而不是回合主人
  //   （core `actingSeat`），本机再发只会被定序器拒掉（issue #9）。
  if (net !== null && state.pending?.kind === 'auction') return;
  // ★★ 第十八份（「怎么拍卖直接流标了」）：单机的竞价也**只由拍賣屏出**（`auction-screen.ts` 问同一个
  //   `auctionNextBid`，一口一段挥槌）。原版电脑那一口是拍賣窗口自己的 100 ms 定时器在出
  //   （窗口过程 `0x43a2dd`，`0x43a365 SetTimer`），窗口不开就不会有人举牌。先前回合主人是电脑时
  //   这里也照 `decidePending` 答 ⇒ 新聞框还没收、拍賣屏还没开，几口就被回合驱动抢着出完了，
  //   屏内也记不到是谁加的价 ⇒ 成交被演成「無人出價，宣佈流標。」。
  if (state.pending?.kind === 'auction') return;
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
    // ★★ FU-2（2026-09-25 审计）：`decideAction` 自己从 `state.rngState` 播种真随机流
    //   （原版电脑那一支的每次 `rand()` 都走全局序列）；掷掉的数由 `reduce` 在同一局面上
    //   复算并写回（`aiDecisionRollAdvance`）。
    const action = decideAction({ state, map });
    if (action === null) {
      // 轮到电脑却拿不出 action —— 这是**卡住**，不是「没事可做」，
      // 必须说出来。先前这里是静默 return，一个漏掉的 scheduleAi 就此藏了很久。
      // ★ 例外：拍賣 pending 期间 core 会**故意**返回 null —— 竞价循环由
      //   `auction-screen.ts` 驱动（它每次问 core 的 `auctionNextBid`），
      //   这里不是卡住，别刷屏（Q-AUC-1）。
      if (isAiTurn(state) && state.pending?.kind !== 'auction' && cardPassiveHolder(state.pending) < 0) {
        log(`⚠ 电脑在 ${state.phase} 无事可做，已停手`);
      }
      return;
    }
    if (net !== null) {
      if (net.catchingUp) return; // 同 `dispatch`：本地状态还没追上
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
    if (walker !== null && state !== before) startStepTween(walker, before);
    // ★ 「走回棋盘」那一回合也要演一段位移（与 `tweenStepIfMoved` 同源）；
    //   ★ 审计 #17：住进旅館那一趟出在落点结算里 ⇒ 除 `step`（上面 `startStepTween`）之外都问一次
    if (action.type !== 'step' && state !== before) tweenStepIfMoved(action, before);
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
/**
 * ★ 第十九份（iPhone 发烫）：三块离屏画布的绘制指令逐帧去重 —— 指令表与上一帧一样
 *   就整帧不画、不贴屏（tick / 演出计时照旧逐帧跑）。原理与安全性见 `display-list.ts`。
 *   `?dlverify=1`（仅开发构建）：一律照画，并逐像素核对「本该跳过」的帧。
 */
const displayList = new DisplayList({
  verify: import.meta.env.DEV && new URLSearchParams(window.location.search).get('dlverify') === '1',
});
installBitmapCloseGuard(displayList);
/** 舞台画过、还没贴上屏（异常中断的帧 / 提前 return 的帧留下的账） */
let stageBlitOwed = true;
const stageCtx = (() => {
  const c = stage.getContext('2d');
  if (c === null) throw new Error('无法取得舞台绘图上下文');
  return displayList.wrap(c);
})();

/** 棋盘的离屏画布 —— 439×440，正是原版棋盘区的大小 */
const boardCanvas = document.createElement('canvas');
boardCanvas.width = LAYOUT.board.w;
boardCanvas.height = LAYOUT.board.h;
const boardCtx = (() => {
  const c = boardCanvas.getContext('2d');
  if (c === null) throw new Error('无法取得棋盘绘图上下文');
  return displayList.wrap(c);
})();

/** 側欄的离屏画布 —— 200×480 */
const hudCanvasOff = document.createElement('canvas');
hudCanvasOff.width = LAYOUT.panel.w;
hudCanvasOff.height = SCREEN_H;
const hudOffCtx = (() => {
  const c = hudCanvasOff.getContext('2d');
  if (c === null) throw new Error('无法取得側欄绘图上下文');
  return displayList.wrap(c);
})();

/**
 * 高清（`hd-stage.ts` + 已验证的超分素材，W-80 §8）：开着时舞台 / 棋盘 / 側欄三块离屏画布按窗口的
 * 放大倍数开像素，文字与超分素材不再被压回 640×480。
 *
 * ★ 2026-09-24 起**默认开**；`?hd=0` 或 `localStorage['rich4.hd'] = '0'`（门厅的「高清畫面」勾选框）关。
 *   关着时 `surfaceScale` 恒为 1，三块画布一次都不碰，也不去拉超分清单 —— 与改造前逐像素一致。
 * ★ 这是**每台设备自己的显示设定**：不进存档、不上网，联机时各端各看各的（不影响同步）。
 */
let hdStage = (() => {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(HD_STORAGE_KEY);
  } catch {
    // 隐私模式等拿不到 localStorage —— 按默认（开）处理
  }
  return hdStageRequested(window.location.search, stored);
})();

/**
 * 这台设备的倍率上限（触屏封到 2，见 `TOUCH_SURFACE_SCALE_CAP`）—— 开机时判一次：
 * 手机 / 平板不会中途变成桌面。
 */
const hdDevice = {
  coarsePointer: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  maxTouchPoints: navigator.maxTouchPoints || 0,
};
const hdScaleCap = surfaceScaleCap(hdDevice);
/**
 * ★ 触屏设备（手机 / 平板）不拉超分过场帧 —— 需求方 2026-09-24 的流量预算：移动端整局高清额外下载
 *   ≤ ~5 MB（高清舞台本身不花流量，钱夫人 136 帧全拉也才 2.2 MB）；桌面 ≤ ~30 MB（过场 WebP 一局约 4 MB）。
 */
const hdFlics = hdScaleCap === MAX_SURFACE_SCALE;

/** 三块离屏画布当前的像素倍率（1 = 改造前的 640×480） */
let surfaceScale = 1;

/**
 * 按当前窗口的放大倍数调三块离屏画布。每帧绘制之前调（紧跟 `resizeCanvas`，**帧外**）。
 *
 * ⚠️ 倍率一直是 1 时**什么都不做** —— 连变换都不重挂，保证关掉高清舞台时与改造前一致。
 * ★ 改了尺寸 = 画布被清空、真上下文状态被重置 ⇒ 告诉指令表去重（`display-list.ts`）
 *   把状态对齐回来、下一帧一定真画，并补一次贴屏。
 */
function syncSurfaceScale(): void {
  const s = surfaceScaleFor(currentMetrics().scale, hdStage, hdScaleCap);
  if (s === 1 && surfaceScale === 1) return;
  surfaceScale = s;
  setCurrentSurfaceScale(s);
  const surfaces = [
    { canvas: stage, ctx: stageCtx, w: SCREEN_W, h: SCREEN_H },
    { canvas: boardCanvas, ctx: boardCtx, w: LAYOUT.board.w, h: LAYOUT.board.h },
    { canvas: hudCanvasOff, ctx: hudOffCtx, w: LAYOUT.panel.w, h: SCREEN_H },
  ];
  for (const x of surfaces) {
    if (sizeSurface(x, x.w, x.h, s)) {
      displayList.canvasResized(x.canvas);
      stageBlitOwed = true;
    }
  }
}

/**
 * 门厅的「高清畫面」勾选框走这里：记到本机、当场换倍率，并把超分素材接上 / 撤掉（原地换位图）。
 */
function setHdStage(on: boolean): void {
  if (on === hdStage) return;
  hdStage = on;
  try {
    localStorage.setItem(HD_STORAGE_KEY, on ? '1' : '0');
  } catch {
    // 存不下（隐私模式）就只管这一次
  }
  void attachHdSource();
  syncSurfaceScale();
  requestRender();
}

/** 按 `hdStage` 把超分来源接到精灵缓存上（关 = 撤掉、已换上的高清图原地换回原图） */
async function attachHdSource(): Promise<void> {
  const cache = sprites;
  if (cache === null) return;
  if (hdStage && hdSource === null) hdSource = await loadHdSource(hdBase(), hdManifestVersion);
  if (sprites !== cache) return;
  cache.setHd(hdStage ? hdSource : null);
  log(hdStage && hdSource !== null ? 'HD 素材：已接上（缺图的按图回退原图）' : 'HD 素材：未接（原图）');
}

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

/**
 * 选目标此刻那一支指针（交给 `soft-cursor.ts` 画；不在选 = `null`）。
 *
 * ★ 原版选目标的反馈**就是换指针**（`fcn_004021f8`，VA 0x004465dd / 0x00446606），
 *   棋盘上不画任何东西 —— 所以这里也不在棋盘上画标记。
 * ★ 贴边时**指针就是那支箭头**，优先于「悬停在候选上」那支
 *   @source `loc_0044609b`：贴边分支里 `[0x48c564] != 0` 会让悬停判定直接返回
 *   ⇒ 优先级 箭头 > 道具/卡片自己的指针 > 红叉。箭头是单帧（0x00446180 `push 0` / `push 1` / `push ecx`）。
 */
function pickCursorShape(): CursorShape | null {
  if (pick === null) return null;
  if (pickEdge !== PICK_EDGE.none) return cursorShape(PICK_EDGE_ARROW.get(pickEdge) ?? PICK_CURSOR_INVALID.image);
  return pickCursorFor(pick, pickHover !== null);
}

/** 拾取状态变了（悬停 / 贴边 / 结束）：指针当场换，不等下一帧 */
function refreshPickCursor(): void {
  syncCursor();
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
  refreshPickCursor();
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
// | `bought` | `[0x48c31c]` / `[0x48c2f8]` 清 0 | 本机点过、回包还没到的行（货架本身与 `sold` 在 core 的 `pending` 里）|
// | `keeper` | 后台缓冲上贴着的那两块 | 老板娘脸上此刻留着的脸 / 嘴（每帧都画）|

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
  /**
   * 本机已经点买、回包还没到的行下标 —— 联机时 `pending.cards/tools[行].sold` 要等服务器回包才变，
   * 这之间也得灰、也不能再点（原版点下去当场清 0）。真相在 core：画与判都是「core 的 sold ∪ 这里」。
   */
  bought: { cards: Set<number>; tools: Set<number> };
  blink: ShopBlink;
  /** 老板娘脸上此刻留着的那两块（换页 = 整屏重画时清掉）*/
  keeper: ShopKeeperPaint;
}

let shopUi: ShopUi | null = null;

/**
 * 光标底下的監獄／醫院槽位 —— 原版 `[0x48c4c4]`，不在那一屏时为 null。
 *
 * ★ 它只记录**光标位置**；真正按的是抬手时的坐标（`loc_0043cfdb` 现算）。
 */
let bailHot: number | null = null;

/** 保釋屏开着吗（待决交互挂着，或 core 已经答完、屏上还在演收尾）*/
function bailScreenOn(): boolean {
  return state.pending?.kind === 'bail' || bailFlow !== null;
}

/** 这一屏是監獄还是醫院 */
function bailPlace(): 'prison' | 'hospital' | null {
  if (bailFlow !== null) return bailFlow.place;
  const p = state.pending;
  return p !== null && p.kind === 'bail' ? p.place : null;
}

/**
 * 这一帧照哪一份状态画：醫院「ＯＫ！」那一拍原版**还没放人**（状态 4 收尾才放，`0x0043dbd6`）⇒ 画答复之前那一份；
 * 其余照当前。
 */
function bailShownState(): GameState {
  return bailFlow !== null && bailFlow.stage === 'ok' && bailBefore !== null ? bailBefore : state;
}

/** 当前这一屏的占用表（監獄 / 醫院各一张，见 `rules/visit.ts`）*/
function bailOccupancy(src: GameState = bailShownState()): readonly number[] {
  const place = bailPlace();
  if (place === null) return [];
  return place === 'prison' ? src.prisonOccupancy : src.hospitalOccupancy;
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
  const src = bailShownState();
  const occ = bailOccupancy(src);
  // 名字由 core 给（`bailCandidates` 已经按玩家/犯人分好了）；答完之后 pending 没了就用答之前那一份
  const named = new Map<number, string>();
  const pending = state.pending?.kind === 'bail' ? state.pending : bailBefore?.pending?.kind === 'bail' ? bailBefore.pending : null;
  if (pending !== null) for (const c of pending.candidates) named.set(c.slot, c.name);
  for (let slot = 0; slot < occ.length; slot++) {
    if ((occ[slot] ?? 0) === 0) continue;
    const p = src.players[slot];
    out.push({
      slot,
      character: p?.character ?? 0,
      name: named.get(slot) ?? (p === undefined ? `犯人${slot}` : ''),
    });
  }
  return out;
}

/** 股市那一屏（整屏；原版那扇窗口盖住棋盘）—— 详情卡 / 填数页是另开的窗，盖在上面 */
function drawStockStage(): void {
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
}

/** 監獄／醫院那一屏 —— 与商店一样是**整屏**，画它的时候棋盘不画 */
function drawBailStage(): void {
  const place = bailPlace();
  if (place === null) return;
  const src = bailShownState();
  const me = src.players[src.currentPlayer];
  if (me === undefined) return;
  const flow = bailFlow;
  stageCtx.fillStyle = '#000';
  stageCtx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  // 悬停气泡只在「等点」那一拍（原版字框挂着时 `0x200` 那一支直接返回：監獄 `0x0043cbf5` / 醫院 `0x0043e35b`）
  const hot = flow === null || flow.stage === 'idle' ? bailHot : null;
  drawBailScreen(stageCtx, place, bailViews(), me.points, hot, spriteNow, {
    // 醫院道别那一拍護士换图（`0x0043e8b3` 先把那块底图贴回去）
    hideDecor: flow?.stage === 'farewell',
  });
  if (flow !== null) {
    // 犯人获释：立绘（`Panel#64` 图 槽−4，抠黑按锚点）@source 監獄 `0x0043d1f8` / 醫院 `0x0043ddd9`
    if (flow.stage === 'thanks' && flow.slot !== null && flow.slot >= 4) {
      const at = BAIL_INMATE_AT[place];
      const img = spriteNow('Panel.mkf', BAIL_INMATE_RESOURCE, flow.slot - 4, true);
      if (img !== null) drawSprite(stageCtx, img, at.x - img.anchorX, at.y - img.anchorY);
    }
    if (flow.stage === 'farewell') {
      const img = spriteNow('Panel.mkf', BAIL_PLACES.hospital.resource, HOSPITAL_BYE_NURSE.image, true);
      if (img !== null) drawSprite(stageCtx, img, HOSPITAL_BYE_NURSE.x - img.anchorX, HOSPITAL_BYE_NURSE.y - img.anchorY);
    }
    // YES/NO（`_rich4_ui_yesno` 居中 (320,240)）：光标在哪一半就亮哪一半
    if (flow.stage === 'confirm') {
      const which = flow.yesNo === 'yes' ? YESNO_IMAGE.yes : flow.yesNo === 'no' ? YESNO_IMAGE.no : YESNO_IMAGE.none;
      const img = spriteNow('Data.mkf', YESNO_RESOURCE, which, true);
      if (img !== null) {
        drawSprite(stageCtx, img, BAIL_YESNO_CENTER.x - img.width / 2, BAIL_YESNO_CENTER.y - img.height / 2);
      }
    }
  }
  // ★ 2026-09-23：柜台人员的字框（`bail-screen.ts` 的 `BAIL_CLERK_FRAMES`）
  if (bailClerk !== null) drawBailClerk(stageCtx, spriteNow, bailClerk);
}

/** 訊息框还在弹 / 还排着（`noticeBoxScreenState` 的只读视图）*/
function noticeBoxScreenActive(): boolean {
  const n = noticeBoxScreenState();
  return n.playing || n.queued > 0;
}

/** 保釋屏的流程（`bail-screen.ts` 的 `bailFlowStep`）；`null` = 没开着 */
let bailFlow: BailFlow | null = null;
/** 保釋屏柜台人员这一刻挂着的那一句（`null` = 没挂）*/
let bailClerk: BailClerkBubble | null = null;
/** 为哪一次 `pending` 开的屏（同一次只开一次）*/
let bailOpenedFor: unknown = null;
/** 答复落地之前最后那一份状态（醫院「ＯＫ！」那一拍照它画；也用来找出保了哪一格）*/
let bailBefore: GameState | null = null;

/** 这一句说的是什么（`#NNNN` 还在串头）*/
function bailLine(key: BailClerkKey, slot?: number): string {
  switch (key) {
    case 'lowPoints':
      return BAIL_CLERK_TEXT.lowPoints.text;
    case 'hospitalHello':
      return BAIL_CLERK_TEXT.hospitalHello.text;
    case 'hospitalOk':
      return BAIL_CLERK_TEXT.hospitalOk.text;
    case 'hospitalLowPoints':
      return BAIL_CLERK_TEXT.hospitalLowPoints.text;
    case 'hospitalBye':
      return BAIL_CLERK_TEXT.hospitalBye.text;
    case 'prisonThanks':
    case 'hospitalThanks':
      return INMATE_THANKS[(slot ?? 4) - 4]?.text ?? '';
  }
}

/** 挂一句：先播 `#NNNN` 语音，再按 `fcn_0044ee18` 的口径定最早收的时刻（2000 ms / 语音更长就撑到完）*/
function bailSay(key: BailClerkKey, now: number, slot?: number): void {
  const raw = bailLine(key, slot);
  const text = playVoiceCode(raw);
  let until = now + BAIL_CLERK_MS;
  const voiceMs = voiceDurationOf(raw);
  if (voiceMs !== null) until = Math.max(until, now + voiceMs);
  bailClerk = { key, text, until };
  requestRender();
}

/** 把流程往前推一步，并把它要的事做掉（说话 / 交答复 / 关屏）*/
function bailSend(ev: BailEvent, now = performance.now()): void {
  if (bailFlow === null) return;
  const r = bailFlowStep(bailFlow, ev);
  // 答复只由**这一座**交（联机旁观的那几端只演、不答）
  if (r.effect !== null && r.effect.kind === 'answer' && !localSeatActive()) return;
  bailFlow = r.flow;
  // 字框：换阶段就收掉旧的那句（新的一句由 `say` 挂上）
  if (!bailFlowHasBubble(r.flow.stage)) bailClerk = null;
  const e = r.effect;
  if (e !== null) {
    if (e.kind === 'say') bailSay(e.key, now, e.slot);
    else if (e.kind === 'answer') {
      // ★ 真人的答复是一条 action（联机时各端同样落地，再各自从状态差里演收尾）
      if (e.slot !== null) dispatch({ type: 'bail', slot: e.slot });
      else dispatch({ type: 'declineDecision' });
    } else if (e.kind === 'close') {
      bailFlow = null;
      bailClerk = null;
      bailHot = null;
    }
  }
  requestRender();
}

/**
 * 保釋屏每一帧：开屏（醫院先招呼）、看答复落地没有、字框到点收。
 *
 * ★ 答复落地的判据是**状态差**（`pending` 从 bail 变成别的）：本机点的与联机对端点的走同一条路。
 *   保了哪一格 = 这一屏那张占用表里由 1 变 0 的那一格；没有 = 不保（关屏 / 醫院道别）。
 */
function bailTick(now: number): void {
  const pending = state.pending;
  if (pending !== null && pending.kind === 'bail') {
    bailBefore = state;
    if (bailOpenedFor !== pending && (bailFlow === null || bailFlow.stage === 'done')) {
      bailOpenedFor = pending;
      const r = bailFlowOpen(pending.place);
      bailFlow = r.flow;
      bailClerk = null;
      bailHot = null;
      if (r.effect !== null && r.effect.kind === 'say') bailSay(r.effect.key, now);
    }
  } else if (bailFlow !== null && bailFlow.stage !== 'ok' && bailFlow.stage !== 'thanks' && bailFlow.stage !== 'farewell') {
    // 答复落地了（或被别的路径收掉）
    const before = bailBefore;
    let bailed: number | null = null;
    if (before !== null) {
      const was = bailFlow.place === 'prison' ? before.prisonOccupancy : before.hospitalOccupancy;
      const now2 = bailFlow.place === 'prison' ? state.prisonOccupancy : state.hospitalOccupancy;
      const hit = was.findIndex((v, i) => v !== 0 && (now2[i] ?? 0) === 0);
      if (hit >= 0) bailed = hit;
    }
    bailSend({ kind: 'resolved', bailed }, now);
  }
  if (bailFlow === null) {
    if (pending === null || pending.kind !== 'bail') bailOpenedFor = null;
    return;
  }
  if (bailClerk !== null && now >= bailClerk.until && !voiceBusy()) {
    bailSend({ kind: 'bubbleEnd' }, now);
  }
  requestRender();
}

/** 原版面板上的两句提示都是 2 秒（`fcn_0044ee18` 的 0x7d0）*/
/**
 * 老板娘的台词气泡 —— 串头的 `#NNNN` 是**语音号**：先播语音，再把剥完的串放进气泡。
 *
 * ★ W-67-c：先前这里直接把原串塞进气泡（而 `SHOP_MSG` 里的 `#NNNN` 也被剥掉了）
 *   ⇒ 商店里**一句语音都不响**。改用 `voice-sink.ts` 的 `playVoiceCode()`
 *   （`event-box-screen.ts` 就是这么用的）。
 * ★ 气泡时长：语音比 `SHOP_BUBBLE_MS` 长时**撑到语音播完**（仿 `speechTick` 里
 *   `sound.durationOf` 那两行）。
 */
function shopSay(ui: ShopUi, text: string, now: number): void {
  const shown = playVoiceCode(text);
  let until = now + SHOP_BUBBLE_MS;
  const voiceMs = voiceDurationOf(text);
  if (voiceMs !== null) until = Math.max(until, now + voiceMs);
  ui.bubble = { text: shown, until };
}

/**
 * 这句串的语音有多长（毫秒）；没有 `#NNNN` 或拿不到时长就返回 `null`。
 *
 * @source 语音号 → `Speaking.mkf` 资源，与 `event-box-screen.ts` / `speechTick` 同一条路
 */
function voiceDurationOf(text: string): number | null {
  // ★★ 第二十六份 panel #2：音效档 = 0 时原版根本不放语音（`0x0045442c` / `0x0044ee63` 同一道闸），字框恰好 2000 ms
  if (options.sound <= 0) return null;
  const { voice } = parseVoiceCode(text);
  if (voice === null) return null;
  const ms = sound.durationOf('Speaking.mkf', voice);
  return ms === null || ms <= 0 ? null : ms;
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
  ui.blink = blinkStart(page);
  // 换页 = 整屏重画（`fcn_0042d299`）⇒ 先前贴在老板娘脸上的都没了
  ui.keeper = keeperPaintStart();
}

/**
 * 商店窗此刻开得起来吗 —— `shopWindowMayOpen` 的**宿主取值**。
 *
 * ★★ `20260925-134801926`：抽成一处是因为它有**两个**消费者 ——
 *   `syncShopUi`（建窗）与 `currentDialog`（框 / 台词还在台上时不许摆出后备壳，见 `shopShellMayAnswer`）。
 *   两处各写一套必然漂移：壳比窗早放开一拍，玩家就能在进店演出还没演完时把这一趟
 *   `declineDecision` 掉（正是那份回报）。
 */
function shopOpenGate(): boolean {
  return shopWindowMayOpen({
    blocking: blockingPresentation(),
    noticeShowing: noticeShowing(),
    noticeQueued: noticePendingRanks().length,
    speechOnStage: speechQueue.length,
    speechHeld: heldSpeech.length,
  });
}

/** 开店 / 换玩家换局时把界面状态按当前 `pending` 重铺 */
function syncShopUi(): void {
  const pending = state.pending;
  if (pending === null || pending.kind !== 'shop') {
    shopUi = null;
    return;
  }
  // ★★ W-67-a：**訊息框还在台上就先别开商店窗**。
  //   @source `_rich4_ui_shop_entry` `0x0042ea0a push 0x5dc / call 0x440cac`（董事長赠礼框，
  //   1500 ms）在 `0x0042ea28` 开窗**之前** —— 原版是模态的，框收掉才轮到商店。
  //   本引擎的訊息框在 `BLOCKING_PRESENTATIONS` 里、回合驱动会等它，
  //   但 `syncShopUi` 是每次 action 后无条件跑的 ⇒ 这里补一道闸。
  // ★ 第十五份：董事長贈禮那一句（`0x0042ea23 call 0x44f230`）也在开窗（`0x0042ea28`）之前 ——
  //   台上还有气泡 / 押着的台词就先别开（开了气泡就叠在商店窗上）
  // ★★ 第二十一份（`20260924-144217689`）：闸收成纯函数 `shopWindowMayOpen`，并把**排着没起播**的訊息框也算上 ——
  //   先前 `notifyApplied` 在訊息框 `event()` 登记之前就调了本函数，那一拍框与台词都还没上账 ⇒ 商店窗当场建起、
  //   框反而弹在商店窗上（`shop.chairmanGift` → `♪ midi07.mid` → `結束`）。现在 `notifyApplied` 也挪到登记之后才调。
  // ★★ 20260925-134801926：闸的取值抽到 `shopOpenGate()` —— 商店那份后备壳要读**同一份**
  //   （见 `currentDialog` 里的 `shopShellMayAnswer`）。
  if (shopUi === null && !shopOpenGate()) return;
  // ★ 只在**第一次**看见这个商店时铺界面状态（货架不再快照：core 的行留在原位、买过的记 `sold`）
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
      bought: { cards: new Set<number>(), tools: new Set<number>() },
      blink: blinkStart(SHOP_PAGE.cards),
      keeper: keeperPaintStart(),
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
  const sold = page === SHOP_PAGE.cards ? ui.bought.cards : ui.bought.tools;
  const item = shopRows(page, state.pending, sold)[row];
  const me = state.players[state.currentPlayer];
  // ★ 买过的那一行（core 记了 `sold`，或本机刚点、回包未到）点了没反应 @source 0x0042e197 / 0x0042e3ec `je 返回`
  if (item === undefined || item.sold || me === undefined) return;

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
      ? { type: 'shop', op: 'buyCard', id: item.id, row }
      : { type: 'shop', op: 'buyTool', id: item.id, row },
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
    sayOwnToolLine(id, () => openDicePick());
    return;
  }
  // 需要目标的那几件：进拾取模式（T-026）。参数表见 `picking.ts` 的 TOOL_SELECT_PARAM。
  const param = TOOL_SELECT_PARAM.get(id);
  if (param === undefined) {
    log(`「${TOOLS[id - 1]?.name ?? `道具${id}`}」的目标选择原版走的是另一套（还没接）`);
    return;
  }
  sayOwnToolLine(id, () => startToolPick(id, param));
}

/** ★ 第十四份 #4：本机真人先说过的那一句道具台词（见 `speech.ts` 的 `OwnToolLine`） */
let ownToolLine: OwnToolLine | null = null;
/** 那一句说完才开的选择界面（原版 `player_say` 同步，说完才进 `0x446ae8` / 点数盘） */
let pendingToolPicker: { open: () => void; at: GameState } | null = null;

/**
 * 需要选目标的道具：**先说**用道具那一句，说完再开选择界面（`OwnToolLine` 的 @source）。
 * 选择界面里取消 ⇒ 道具不消耗，那一句原版也已经说过了（不收回）。
 */
function sayOwnToolLine(toolId: number, openPicker: () => void): void {
  const player = state.currentPlayer;
  ownToolLine = { player, toolId, turnCount: state.turnCount };
  // ★ v8（gap-audit #7）：联机时同桌各端同一刻听到这一句（不必等 `useTool` 落地）
  presentToTable({ kind: 'toolLine', toolId });
  const bubble = toolLineOf(state, player, toolId);
  if (bubble !== null) {
    ensureSpeakingArchive();
    queueSpeech([{ bubble, order: TOOL_LINE_ORDER }]);
  }
  pendingToolPicker = { open: openPicker, at: state };
  requestRender();
}

function tickPendingToolPicker(): void {
  const p = pendingToolPicker;
  if (p === null) return;
  // 说话期间局面变了（换人 / 重连重建 / 换局）⇒ 这一次作废，不再开选择界面
  if (state !== p.at) {
    pendingToolPicker = null;
    return;
  }
  if (filmWaitsForSpeech(speechAheadOfFilms(speechSnapshot()))) {
    requestRender();
    return;
  }
  pendingToolPicker = null;
  p.open();
}

/**
 * 建設公司选地 —— 原版是**点地图**的拾取窗（`0x446ae8`，参数 `COMPANY_BUILD_PARAM` = `0x2090086`），不是列表。
 *
 * @source 自家 `0x0041aa46 push 0x463a4a` → `0x0041aa62 call 0x440cac`（「%s\n\n請選擇欲加蓋地點」1500 ms，模态）
 *   → `0x0041aa6a push 0x2090086 / call 0x446ae8`；别人家 `0x0041acdb` → `0x0041acf7` → `0x0041acff` 同构。
 *   ⇒ 框收掉才进拾取；只有该答的那一端（本机座位、真人回合）进，与 `currentDialog` 同一组判据。
 */
function tickBuildPick(): void {
  const pend = state.pending;
  if (pend?.kind !== 'chooseBuildTarget') {
    // 局面变了（联机重建 / 换局）⇒ 残留的选地会话作废
    if (pick?.source.kind === 'build') endPick();
    return;
  }
  if (pick !== null) return;
  if (!localSeatActive() || isAiTurn(state)) return;
  // 框 / 台词还在台上（或排着）就先别进 —— 与商店窗开窗同一道闸
  if (!shopOpenGate()) {
    requestRender();
    return;
  }
  stopPickEdgeScroll();
  pick = startPick(state, topo, { kind: 'build', choices: pend.choices }, 'none', COMPANY_BUILD_PARAM);
  pickHover = null;
  refreshPickCursor();
  requestRender();
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
  presentToTable({ kind: 'toolCancel', toolId: REMOTE_DICE_TOOL });
  dicePick = null;
  requestRender();
}

/**
 * 卡片欄选了一张卡之后 —— **先亮牌**，亮完才走卡片函数那一段（`routeCardUse`）。
 *
 * @source `_rich4_ui_use_card_entry` VA 0x441c22 起（真人那一支）：
 *   `0x00441c7e` 卡片欄拿到卡号（0 = 右键取消 → `0x441c9a je 0x441ce1` 直接收场）→
 *   `sprintf("使用%s", 卡名)` → **`0x00441cbc call 0x441f73` 亮牌（阻塞 1500 ms、可跳过）** →
 *   `0x00441cc6 call card_functions[卡号]`（**选目标在卡片函数里**，如 `0x004421cd call 0x446ae8`）；
 *   **返回 0（没用成 / 目标取消）就播失败音并重新弹一次卡片欄**（`0x441cd9` → `jmp loc_00441c22`）。
 *   亮牌只有「卡片欄右键取消」绕得过 ⇒ 被动卡、用不成的卡也照样先亮牌再失败。
 */
function applyCardPick(cardId: number): void {
  log(`使用${CARD_IMPLS[cardId - 1]?.name ?? `卡${cardId}`}`);
  startOwnCardUsePopup(cardId, state.currentPlayer, state.turnCount, uiEnv());
  // ★ v8（gap-audit #7）：联机时同桌各端**同一刻**亮同一扇牌（原版全桌看的是同一块屏）
  ownPickedCard = cardId;
  presentToTable({ kind: 'cardReveal', cardId });
  pendingCardRoute = { cardId, player: state.currentPlayer, turnCount: state.turnCount };
  requestRender();
}

/**
 * 亮牌之后等着走的那一张（`applyCardPick` 记下、亮牌收屏后 `tickPendingCardRoute` 取走）。
 * 原版亮牌是阻塞的 —— 卡片函数（选目标 / 生效）在它返回之后才跑。
 */
let pendingCardRoute: { cardId: number; player: number; turnCount: number } | null = null;

function tickPendingCardRoute(): void {
  const p = pendingCardRoute;
  if (p === null) return;
  if (cardUsePopupActive()) {
    requestRender();
    return;
  }
  pendingCardRoute = null;
  // 亮牌期间局面换了人（重连重建 / 换局）⇒ 这一张作废
  if (state.currentPlayer !== p.player || state.turnCount !== p.turnCount) {
    dropOwnCardUse();
    return;
  }
  routeCardUse(p.cardId);
}

/**
 * 「卡片函数返回 0」—— 这张卡**没用成**（目标取消 / 用不了）。
 *
 * @source `_rich4_ui_use_card_entry`：`0x00441cd9 call 0x4542ce(0x48233a)`（失败音 3）→
 *   `0x00441ce3 je loc_00441c22`（卡片欄重开；卡不消耗）。
 *   再选一张会**再亮一次牌**（`0x00441cbc` 在循环体里）。
 */
function cardUseFailed(): void {
  dropOwnCardUse();
  sound.play('Effect.mkf', SOUND_CARD_FAILED);
  presentCardFailed();
  openInventory('cards');
}

/** ★ v8：本机真人最近一次在卡片欄选定的那一张（`cardFailed` 提示要带卡号）*/
let ownPickedCard: number | null = null;

/** ★ v8：告诉同桌「刚亮的那张没用成」（失败音 3；再用一张会再亮一次）*/
function presentCardFailed(): void {
  const cardId = ownPickedCard;
  ownPickedCard = null;
  if (cardId !== null) presentToTable({ kind: 'cardFailed', cardId });
}

/**
 * ★ v8（gap-audit #7）：本机真人刚在自己的 UI 里做了一件「原版全桌都看得见」的事 —— 联机时转告同桌
 *   （纯演出，服务器校验后转发，不进日志；见 core `protocol.ts` 的 `PresentCue`）。单机什么都不做。
 */
function presentToTable(cue: PresentCue): void {
  const client = net;
  if (client === null || client.seat === null || actingSeat(state) !== client.seat) return;
  client.present(cue);
}

/**
 * ★ v8（gap-audit #7）：旁观端演出别人转来的那一件（收件箱排到它时才演 —— 与行动方同一个位置）。
 *
 * | kind | 演什么 | 原版 |
 * |---|---|---|
 * | `cardReveal` | 亮牌（卡面 +「使用X卡」+ 音效），记下「已亮过」| `0x00441cbc call 0x441f73` |
 * | `cardFailed` | 失败音 3，忘掉「已亮过」| `0x00441cd9` |
 * | `toolLine` | 那一句道具台词，记下「已说过」| 道具函数第一个 `player_say`（`speech.ts` 的 `OwnToolLine`）|
 * | `toolCancel` | 音效 4 | `0x4466b8` / `loc_00446a68` |
 */
function applyNetCue(seat: number, cue: PresentCue): void {
  if (seat === net?.seat) return;
  switch (cue.kind) {
    case 'cardReveal':
      startRemoteCardUsePopup(cue.cardId, seat, state.turnCount, uiEnv());
      break;
    case 'cardFailed':
      dropOwnCardUse();
      sound.play('Effect.mkf', SOUND_CARD_FAILED);
      log(`P${seat + 1} 的${CARD_IMPLS[cue.cardId - 1]?.name ?? `卡${cue.cardId}`}没用成（联机提示）`);
      break;
    case 'toolLine': {
      ownToolLine = { player: seat, toolId: cue.toolId, turnCount: state.turnCount };
      const bubble = toolLineOf(state, seat, cue.toolId);
      if (bubble !== null) {
        ensureSpeakingArchive();
        queueSpeech([{ bubble, order: TOOL_LINE_ORDER }]);
      }
      break;
    }
    case 'toolCancel':
      sound.play('Effect.mkf', CANCEL_SOUND);
      break;
  }
  requestRender();
}

/**
 * 亮牌之后：相当于原版的 `call card_functions[卡号]`（`0x00441cc6`）。
 *
 * 这里照同一条路走：先用 core 预演「这张牌现在出不出得了」——
 *   - 出得了且**不需要目标** → 直接发 `useCard{target: none}`；
 *   - 需要目标 → 进 T-026 拾取模式（选择参数取自卡片表）；
 *   - 出不了（被动卡、或时机不对）→ 播失败音（音效 3）并**把弹窗再开回来**。
 *
 * ★ 原版**不灰显**被动卡（`fcn_00441b0a` 只画卡名，一个颜色一张字体），
 *   所以这里也不灰显 —— 上一轮卡里写的「被动卡灰显不可点」是自己想的。
 */
function routeCardUse(cardId: number): void {
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
  //   ★★ 2026-09-25（C23-1 结案）：候选集是**这一刻画在棋盘区里的**那些 ——
  //   原版扫的是屏幕空间那张 440×440 的 id 图（`0x40a45c(-1)` → `0x409de7`），
  //   画不进去的物件根本不在清单里。这里把**当前镜头**（含玩家拖过 / 贴边推过）
  //   投到棋盘区，判据与 `0x409e99`/`0x409ea5` 那两道 `jl`/`jge` 同一条。
  if (route.kind === 'objectAuto') {
    const vp = { w: LAYOUT.board.w, h: LAYOUT.board.h };
    const handle = nearestSummonableObject(state, topo, {
      project: (x, y) => worldToScreen(x, y, camera, vp),
      width: vp.w,
      height: vp.h,
    });
    const act = summonCardAction(handle);
    if (act === null) {
      cardUseFailed();
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
        cardUseFailed();
        return;
      }
      dispatch({ type: 'useCard', cardId, target: { kind: 'none', facilityType: type } });
    });
    return;
  }
  // 用不成：失败音 + 把弹窗开回来（原版的循环）
  if (route.needsOwnList) {
    dropOwnCardUse();
    sound.play('Effect.mkf', SOUND_CARD_FAILED);
    presentCardFailed();
    log('（这张卡要选目标 —— 那类选择界面还没做）');
  } else cardUseFailed();
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

/** 过场里出场的角色（`players[].character`）—— 每位两段 FLIC，时长也按它算（`introMs`）*/
function introCast(): number[] {
  return state.players.map((p) => p.character);
}

/** 过场结束 → 进棋盘 */
function endIntro(): void {
  if (screen !== 'intro') return;
  screen = 'game';
  releaseIntroFlics();
  // ★★ 进棋盘的第一次重画就摆第 1 位（core 的 `newGame` 已摆好），随后 `0x418c55` 开头
  //   播他那一段降落伞（`landing-fx.ts`）—— 回合驱动被影片挡着，播完才掷骰 / 电脑决策。
  //   其余几位要等轮到自己才落地（换人那条 action 里补播，见 `startActionFx`）。
  const opener = openingLandingPlayer(state);
  if (opener !== null) startLandingFx(opener);
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

/**
 * 託管AI 屏：编辑草稿 + 选中行 + 按下的控件（原版也是先编一份暂存表、按確定才拷回）——不在这一屏时为 null。
 * 见 `ai-settings.ts` 的 `AiSettingsModel`。
 */
let aiModel: AiSettingsModel | null = null;
/**
 * 选中行（原版 `[0x48be4c]`）**跨开屏保留** —— 原版入口的 memset 恰好不含它，
 * 轮到的不是真人时沿用上一次的值（`aiInitialSelection`）。
 */
let aiLastSel = 0;
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

/**
 * 离开大厅：断开连接 —— 网页版回**房间列表**（需求方 2026-09-23），桌面壳回標題。
 */
function leaveLobby(): void {
  // ★ 房主交接（v6）：先告訴服務器「我是主動走的」—— 當場讓座 / 交接房主，不用等 30 秒斷線判定
  net?.leave();
  netClose?.();
  netClose = null;
  net = null;
  lobbyRoom = null;
  lobbyHot = null;
  log('已離開聯機大廳');
  if (isDesktop()) {
    enterTitleScreen();
    return;
  }
  // 门厅覆盖层整个盖住画布；底下停在標題（不点曲 —— 从列表选「單人模式」时才进標題点 MIDI01）
  screen = 'title';
  requestRender();
  void openFoyer({ view: 'rooms' });
}
/** 標題畫面上鼠标悬着的按钮 */
let titleHot: number | null = null;

let renderQueued = false;

/**
 * ★★ W-60：**上一帧**的屏号 —— 「刚从别的屏回到棋盘」那一帧要把回合驱动叫起来。
 *
 * 起因（第六份试玩回报第 10 条，**阻断**）：人物走子途中点开「遊戲設定」再关掉 ⇒
 * 棋子停在半路、GO 点不动 —— 因为两条回合驱动的排程入口都有
 * `if (screen !== 'game') return;`，关屏时没人再叫它们。判据与理由见
 * `driver-resume.ts` 的文件头（那里是纯函数、有单测）；这里只存「上一帧」。
 *
 * 初值 `'title'`：開局第一帧从標題跨进棋盘时要**叫一次**（与 `endIntro()` 那两句同效）。
 */
let lastFrameScreen: Screen = 'title';
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

/** 放掉时还在解码的那几段（解好当场关掉，不进 `uiFlics`） */
const uiFlicDropped = new Set<string>();

/** 放掉一段（关位图、下次再要就重解） */
function releaseUiFlic(archive: string, resource: number): void {
  const key = `${archive}#${resource}`;
  uiFlics.get(key)?.close();
  uiFlics.delete(key);
  if (uiFlicPending.has(key)) uiFlicDropped.add(key);
}

/**
 * ★ 片头那几段影片（开门 + 每人一段跳出去 + 一段降落伞）一局只播一次，播完 / 跳过就放掉。
 *   先前一直攥着：4 人局 8 段 × 40–50 帧 × 640×480 ≈ 440 MB 位图常驻到关页面（W-80 §8 顺手修；
 *   高清过场的超分帧也挂在这几段上，一并放掉）。
 */
function releaseIntroFlics(): void {
  releaseUiFlic(INTRO_ARCHIVE, INTRO_DOOR_RESOURCE);
  for (const c of introCast()) {
    releaseUiFlic(INTRO_ARCHIVE, introJumpResource(c));
    releaseUiFlic(INTRO_ARCHIVE, introFallResource(c));
  }
}

function uiFlicNow(archive: string, resource: number): LoadedFlic | null {
  const key = `${archive}#${resource}`;
  const hit = uiFlics.get(key);
  if (hit !== undefined) return hit;
  const cache = sprites;
  if (cache !== null && !uiFlicPending.has(key)) {
    uiFlicPending.add(key);
    void cache.getFlic(archive as ArchiveName, resource).then((f) => {
      uiFlicPending.delete(key);
      // 解码途中这一段已经被放掉（片头提前跳过）⇒ 不留
      if (uiFlicDropped.delete(key)) {
        f?.close();
        return;
      }
      uiFlics.set(key, f);
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
/**
 * ★ gap-audit #4 活体验收：整屏发出的每一声音效（时刻 + 号）—— **只在 DEV 构建里记**，`__rich4.sfxLog()` 读。
 *   `?mute=1` 时音频不出声，但「该不该放、放了几次」照样看得到（`tools/net-e2e-auction.mjs` 数 0x3f 用）。
 */
const devSfxLog: { t: number; id: number }[] = [];

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
    playEffect: (id: number, loop = false) => {
      if (import.meta.env.DEV) {
        devSfxLog.push({ t: performance.now(), id });
        if (devSfxLog.length > 500) devSfxLog.shift();
      }
      sound.play('Effect.mkf', id, loop);
    },
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
  // ★★ 第十六份（线上卡死）：**开着**的屏优先 —— 排着等起播的屏（`pendingOnly`）不抢接管位置，
  //   否则开着的那扇收不到 `tick`、永远收不掉（见 `overlay.ts` 文件头那三方互等）。
  return presentationHost.overlay();
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
 * ★ W-69：過路費那段「把算进这笔钱的每一块地一起闪一遍」—— 纯表现，不进 state。
 *
 * 原版 `fcn_00451985`：16 帧 × 30 ms + 400 ms（表 `0x476380`），**任意滑鼠鍵可跳过**。
 * 提示本身来自 `state.lastTollLands`（core 的瞬态字段，只有算进去的 > 1 块才写），
 * 与 `lastCardPlay` / `lastNpcWalks` 同一套「比引用」的判据。
 */
let tollFlash: { lands: ReadonlySet<number>; facilities?: ReadonlySet<number>; at: number } | null = null;
/** 已经认过的 `state.lastTollLands`（比引用，见上面） */
let tollLandsSeen: readonly number[] | null = null;

/**
 * 认下一条**新的**提示（`state.lastTollLands` 换了引用）。
 *
 * ★★ 必须在 `notifyApplied` 的**最前面**认 —— 訊息框那一屏的 `event()`
 *   是同一条 action 里紧接着跑的（`for (const s of SCREENS) s.event?.(…)`），
 *   而它要靠「闪在播」这道闸决定起不起播。放到每帧的 `tickTollFlash` 里认就晚了：
 *   框已经在同一次 dispatch 里起播了（浏览器实测：330 ms 时框已经盖在棋盘上）。
 *
 * @source 原版次序：标地（0x00419b9e）→ 闪 16 帧 + 静 400 ms（`fcn_00451985`）
 *   → 費用訊息框（0x00419d5a `call 0x440cac`）。
 */
function noticeTollLands(now: number): void {
  if (state.lastTollLands === null || state.lastTollLands === tollLandsSeen) return;
  tollLandsSeen = state.lastTollLands;
  tollFlash = { lands: new Set(state.lastTollLands), at: now };
}

/** 这一拍该给渲染器的那份（没在播 / 亮度 0 ⇒ null） */
function tollFlashInput(
  now: number,
): { lands: ReadonlySet<number>; facilities?: ReadonlySet<number>; level: number } | null {
  if (tollFlash === null) return null;
  const level = tollFlashLevel(now - tollFlash.at);
  if (level === null || level === 0) return null;
  return tollFlash.facilities === undefined
    ? { lands: tollFlash.lands, level }
    : { lands: tollFlash.lands, facilities: tollFlash.facilities, level };
}

// ============================================================
//  新聞 18「強烈地震」/ 19「山洪」：受灾地块白闪 → 重画 → 静置（gap-audit #6）
//  ★ A-2：命運 0「強制拆除房屋」/ 1「強制徵收土地」共用**同一条**尾巴，闪的是同一支
//    `0x451985`（`0x0044c0e3 jmp 0x44bf46` → `0x0044bf46 call 0x451985`）⇒ 同一个槽
// ============================================================

/**
 * 正在演（或排着等事件框收屏）的那一段；`null` = 没有。纯表现，不进 state。
 *
 * 时间轴（逐条 VA 见 `news-flash-fx.ts`）：事件框收屏（pass 0 → pass 1）→ **闪**（借 `tollFlash`
 * 那一套：同一支 `fcn_00451985`，16 × 30 ms + 400 ms，期间棋盘按 before 画）→ 重画成 after
 * （`view_to(0, 0, 1)`）→ **静置** 500 / 300 ms（`fcn_004528b9`）→ 收场。
 * 整段算「台上还忙」（`stageBusyFlags` 的 `tollFlash` 位）⇒ 回合驱动 / 联机收件箱 / 19 的房主台词都等它。
 *
 * ★ 名字沿用 ticket 里的 `newsFlash`：新聞 18/19 与命運 0/1 共用这一个槽（`cue.kind` 区分，
 *   只影响日志）—— 两族的静置时长也相同（19 与命運都是 `push 0x12c`）。
 */
let newsFlash: { cue: NewsFlashCue; before: GameState; at: number | null; holdSkipped: boolean } | null = null;

/**
 * 这一条 action 刚抽到新聞 18 / 19（`lastEvent.flashLots`）或命運 0 / 1（那两块地表里的差）
 * ⇒ 排上（等事件框收屏才闪）。
 *
 * ★ A-2：命運那一支补的是「徵收 / 拆屋之后看不出是哪一块」—— 原版在共用尾巴里把那一块
 *   标白再闪（`0x0044c092 call 0x456c0a` 标白 → `0x0044bf46 call 0x451985` 闪），
 *   先前复刻只改了归属色块，一声不响。
 */
function startNewsFlash(before: GameState, after: GameState): void {
  const cue = newsFlashTrigger(before, after) ?? fortuneFlashTrigger(before, after);
  if (cue === null) return;
  newsFlash = { cue, before, at: null, holdSkipped: false };
  // 事件框期间（pass 0）原版还一格没拆：棋盘按 before 画，闪完重画那一拍才放开
  deferredBoardBefore = before;
  log(
    `演出：${cue.kind === 'news' ? '新聞' : '命運'} ${cue.eventId} 标白 ${cue.lands.length} 块地 / ${cue.facilities.length} 处設施，静置 ${cue.holdMs} ms`,
  );
  requestRender();
}

/** 每帧推一次（与 `tickTollFlash` 同一处调）*/
function tickNewsFlash(now: number): void {
  const f = newsFlash;
  if (f === null) return;
  if (f.at === null) {
    // ★ pass 1 在訊息框停满之后（`fcn_0044b6df` 0x0044b862 → 0x0044b873）；只等事件框那一屏
    //   （与 `afterEventBox` 同一条理由：等「任何一屏」会与排在后面的訊息框互等）。走子补间也要先播完。
    if (eventBoxScreen.active(uiEnv()) || !renderer.walkDone(now)) {
      requestRender();
      return;
    }
    f.at = now;
    tollFlash = { lands: new Set(f.cue.lands), facilities: new Set(f.cue.facilities), at: now };
    requestRender();
    return;
  }
  let phase = f.holdSkipped ? 'done' : newsFlashPhase(now - f.at, f.cue.holdMs);
  // 闪那一截被滑鼠鍵点掉了（`skipTollFlash`）⇒ `fcn_00451985` 提前返回，照常重画、从现在起静置
  if (phase === 'flash' && tollFlash === null) {
    f.at = now - TOLL_FLASH_TOTAL_MS;
    phase = newsFlashPhase(now - f.at, f.cue.holdMs);
  }
  if (phase === 'flash') {
    requestRender();
    return;
  }
  // 闪完 ⇒ `view_to(0, 0, 1)`：只重画棋盘（bit0 ⇒ 不动标记，镜头仍停在那一处）—— 这时才露出拆过的样子
  if (deferredBoardBefore === f.before) deferredBoardBefore = null;
  if (phase === 'hold') {
    requestRender();
    return;
  }
  newsFlash = null;
  resumeTurnDriver();
  requestRender();
}

/**
 * 静置那一截被滑鼠鍵点掉（`fcn_004528b9` 收到滑鼠鍵就返回）：新聞 18 / 19 闪完之后那一段，
 * 以及 15 / 20 / 21 片后那一段（`BoardFilmSpec.holdMs`）。点掉了返回 `true`（这一下被它吃掉）。
 */
function skipPresentationHold(now: number): boolean {
  const f = newsFlash;
  if (f !== null && f.at !== null && tollFlash === null && !f.holdSkipped && newsFlashPhase(now - f.at, f.cue.holdMs) === 'hold') {
    f.holdSkipped = true;
    requestRender();
    return true;
  }
  const film = boardFilm;
  if (film !== null && boardFilmHolding(film, now)) {
    boardFilm = { ...film, holdSkipped: true };
    requestRender();
    return true;
  }
  return false;
}

/**
 * 每帧推一次：认新提示、到点收摊、没播完就续帧。
 *
 * ★ 原版这一整段是**阻塞**的（`fcn_00451985` 里那个等待循环），所以它也得算进
 *   `stageBusy()`（见 `stage-gate.ts` 的 `tollFlash` 位）—— 訊息框要等它播完。
 */
function tickTollFlash(now: number): void {
  // 兜底：没经过 `notifyApplied` 的那几条路（联机广播 / 读档）也认得出来
  noticeTollLands(now);
  if (tollFlash === null) return;
  if (tollFlashLevel(now - tollFlash.at) === null) {
    tollFlash = null;
    return;
  }
  requestRender();
}

// ============================================================
//  神明附身的开场白（`fcn_0040e2a2`）—— 规格在 `god-line.ts`（第八份试玩回报 #5）
// ============================================================

/** 正在演的那句；`null` = 没有 */
let godLine: { text: string; at: number } | null = null;
/** 已经该说、但附身影片还在播 —— 影片收屏那一拍才上（原版是影片 `0x45144f` 之后紧接着 `0x40e2a2`）*/
let pendingGodLine: string | null = null;

/** 这一拍有神明刚附身 ⇒ 排一句开场白（等附身影片播完）*/
function startGodLine(before: GameState, after: GameState): void {
  // ★ 第十八份：「動畫過程」关掉时没有开场白 —— 十二支的 `je` 连 `0x40e2a2` 一起跳过（`god-line.ts` 文件头）
  if (!godLineShown(options.animation)) return;
  const text = godLineTrigger(before, after);
  if (text === null) return;
  pendingGodLine = text;
  // ★ 第十五份：**不**当场起 —— 同一条 action 的壞神台词（`beforeStage`，`0x0040ef44` 在影片与
  //   `0x40e2a2` 之前）要等 `notifyApplied` 才交出来；交给下一帧的 `tickGodLine` 看闸
  requestRender();
}

/** 每帧：排队的等影片收屏就上台；到 2400 ms 收场 */
function tickGodLine(now: number): void {
  if (
    pendingGodLine !== null &&
    boardFilm === null &&
    pendingBoardFilm === null &&
    // ★ 第十五份：台上有气泡 / 押着排在它前面的台词 ⇒ 等（原版台词 `0x0040ef44` → 影片 → `0x40e2a2`；
    //   没有影片时（「動畫過程」关掉）先前会与那句台词同屏）；亮牌 / 事件框还开着也等（它们在更前面）
    // ★ 第十六份：屏上已经开着一扇框（訊息框 / 老虎机…）⇒ 等它收（原版同一时刻只有一扇）
    !presentationHost.boxBlocked(SCREEN_BOX_TIER.godSay) &&
    !eventBoxScreen.active(uiEnv())
  ) {
    godLine = { text: pendingGodLine, at: now };
    pendingGodLine = null;
    requestRender();
  }
  if (godLine !== null && !godLineActive(godLine.at, now)) {
    godLine = null;
    requestRender();
  }
  // ★ 第十八份：开场白收了（到点 / 点掉 / 自愈清掉）⇒ 钉着的那一帧一起收
  if (heldGodFilm !== null && godLine === null && pendingGodLine === null) releaseHeldGodFilm();
  // 演着的时候每帧都要再来一拍（到点才收得掉；`stageBusy()` 读的是这里的变量）
  if (godLine !== null || pendingGodLine !== null) requestRender();
}

/** 任意滑鼠鍵跳過（`0x4528b9` 收到滑鼠鍵就返回非 0）—— 只跳正在演的这句，排队的照常 */
function skipGodLine(): boolean {
  if (godLine === null) return false;
  godLine = null;
  requestRender();
  return true;
}

/**
 * 画在棋盘画布上：28 px 白字 + #101010 阴影，换行宽 320，文字块**底边中点**在 (220, 420)（棋盘坐标）。
 * @source `0x0040e2df call 0x44f9d8(0x1c, 0xffffff, 0x101010, 6, 0)` / `0x0040e2fd call 0x44fabc(…, 0xdc, 0x1cc, 7)`
 */
function drawGodLine(ctx: CanvasRenderingContext2D): void {
  if (godLine === null) return;
  ctx.save();
  ctx.font = font(GOD_LINE_FONT_PX);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const rows = godLineRows(godLine.text, (s) => ctx.measureText(s).width);
  const top = GOD_LINE_AT.y - rows.length * GOD_LINE_LINE_HEIGHT;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row === '') continue;
    const y = top + i * GOD_LINE_LINE_HEIGHT;
    ctx.fillStyle = GOD_LINE_SHADOW;
    ctx.fillText(row, GOD_LINE_AT.x + 2, y + 2);
    ctx.fillStyle = GOD_LINE_COLOR;
    ctx.fillText(row, GOD_LINE_AT.x, y);
  }
  ctx.restore();
}

/** 任意滑鼠鍵跳過（原版 `fcn_004528b9` 返回非 0 就 break） */
function skipTollFlash(): void {
  if (tollFlash === null) return;
  tollFlash = null;
  requestRender();
}

// ★ W-69：訊息框要**等这段闪完**再弹（原版次序：标地 → 闪 16 帧 → 静 400 ms → 才弹框）。
//   把「闪还在播」这件事从这一道闸递给 `notice-box-screen`（见那里的 `setNoticeStartGate`）。
// ★ 第八份试玩回报 #5：訊息框还要等**棋盘影片与神明开场白**收场 —— 原版这两样都是阻塞调用，排在
//   `0x440cac` 之前（小福神：影片 `0x45144f` → 开场白 `0x40e2a2` → 发卡 → 框 `0x4632fd` → 台词）。
// ★★ 第十一份試玩回報 #6（小窮神順序）：神明老虎機要**等附身影片与开场白收场**才起播 ——
//   原版次序是「抱怨台词 → 影片 0x220 → 白字文案 → 老虎機 → 付款」（`rich4_gods.asm:835-883`）。
setGodSlotStartGate(
  () =>
    boardFilm !== null ||
    pendingBoardFilm !== null ||
    godLine !== null ||
    pendingGodLine !== null ||
    // ★ 第十五份：台上有气泡 / 押着排在它前面的台词 ⇒ 等（`presentation-order.ts`）
    // ★ 第十六份：台词那一侧没放行、或屏上已经开着一扇框 ⇒ 等
    presentationHost.boxBlocked(SCREEN_BOX_TIER.godSlot),
);

setNoticeStartGate(
  () =>
    tollFlash !== null ||
    godLine !== null ||
    pendingGodLine !== null ||
    boardFilm !== null ||
    pendingBoardFilm !== null ||
    // ★★ 2026-09-22（第十一份試玩回報 #15）：转盘 / 神明老虎机在播时，訊息框**押后** ——
    //   原版是「转盘（阻塞、玩家点停）→ 費用/保費訊息框 → 台词」。
    //   光是调整 `SCREENS` 顺序还不够：押后期间訊息框的 `active()` 仍为真，
    //   照样会压住转盘、吃掉玩家的点击（见 `screens.ts` 里那一段注释）。
    wheelScreenState().playing ||
    // ★ 第十五份：转盘 / 老虎机排着等台词时也算（它们在訊息框之前）
    wheelScreenState().pending ||
    godSlotState().playing ||
    godSlotState().pending,
);

// ★★ 第十五份：**每一扇**訊息框起播前都问台词那一侧（`presentation-order.ts` 的 `boxMayStart`）——
//   台上有气泡 ⇒ 等（互斥：原版 `player_say` 阻塞）；有档更小的台词押着 ⇒ 等（先后）。
//   先前只有回合開始被挡（第十三份 #2）、保險理賠、小衰神丢卡这几扇等，其余一律与台词同屏。
// ★★ 第十六份（线上卡死）：屏上已经开着别的框（老虎机 / 事件框 / 神明台词窗…）⇒ 也不起 ——
//   原版全是阻塞调用，同一时刻只有一扇；先前「使用地雷」框在排着的老虎机之外照起，才有那三方互等。
setNoticeSpeechGate((tier) => presentationHost.boxBlocked(tier));
// ★ 第十五份：事件框 / 亮牌 / 抽卡卡面（`lead` 档）与轉盤（`stage` 档）同一道闸
setEventBoxStartGate(() => presentationHost.boxBlocked(SCREEN_BOX_TIER.eventBox));
setWheelStartGate(() => presentationHost.boxBlocked(SCREEN_BOX_TIER.wheel));
// ★ 第十四份：命運 / 新聞的施加阶段（加持框、理賠框…）排在事件提示框收掉之后
setNoticeOverlayGate(() => eventBoxScreen.active(uiEnv()));
// ★ 第十四份（D-008 收口）：嫁禍卡的选人窗 —— 与对话框同一道闸（`currentDialog`）：
//   联机只让当前座位答、电脑 / 託管不开（它们由 `decidePending` / reducer 答）
setScapegoatPickerGate(() => screen === 'game' && (cardPassiveDialogOpen() ?? (localSeatActive() && !isAiTurn(state))));
// ★ pt22：「請選擇設施類別」的待决交互那一支同一道闸（旁观端 / 电脑不开，见 `setFacilityPickerGate`）
setFacilityPickerGate(() => screen === 'game' && localSeatActive() && !isAiTurn(state));
// ★ 第十四份：訊息框队列里的亮牌那一扇（收費那一段的被动卡）交给事件提示框播
setNoticeCardPopup(
  (cardId, text) => startCardRevealPopup(cardId, text, uiEnv()),
  () => cardUsePopupActive(),
);

/**
 * 正在排队的角色台词（T-052 的屏幕那一半）。
 *
 * ★ 原版 `_rich4_player_say`（VA 0x0044ef41）是**阻塞**的一句一句演
 *   （画字 → 贴表情 → `fcn_004544f6(1000)` 等 1 秒），本引擎不能在 `dispatch`
 *   里阻塞，故改成队列：`playSoundFor` 排入，渲染循环按 `SPEECH_HOLD_MS` 逐段收。
 *   纯表现，不读也不写 `GameState`（C-DET-4）。
 */
const speechQueue = new SpeechQueue();

/**
 * 还没上台的台词（按档排好：`lineRank`，同档保持来时的先后）。
 *
 * ★★ 原版「轉盤停 → 訊息框 → 付款人的台詞」是**同步**顺序（見 `queueSpeech` 的
 *   `@source`）。本引擎一条 action 就把演出与台词一起派生出来，所以台词先押在这里，
 *   由 `releaseHeldSpeech()` 按「框 / 影片收了没有」一句一句放上台（第十五份起连
 *   `beforeStage` 的句子也会押 —— 押在 `lead` 档的框与屏上正开着的框后面）。
 */
let heldSpeech: { bubble: SpeechBubble; order: SpeechOrder; rank: number; cue?: SpeechCue }[] = [];

// ============================================================
//  神明离身升天（`god_detach` VA 0x0040e32c）—— 规格在 `god-ascend-fx.ts`（第十二份试玩回报 #1）
// ============================================================

/**
 * 正在演（或排着等前面演出收摊）的那一次升天；`null` = 没有。
 * `start === null` = 还在排队；`before` = 离身**之前**那一份（起点与棋盘都按它画）。
 */
let godAscend: { cue: GodAscendCue; before: GameState; start: number | null } | null = null;

/**
 * 月结 / 開獎 / 分紅这几屏排在回合边界里**更早**的位置（`0x41902e call 0x41cf67` 推日期
 * 在 `0x419039 call 0x41c84f` 之前）⇒ 任期届满的升天要等它们收屏。
 * ⚠️ 只等这几屏，**不**等訊息框：换神时新神的訊息框在押后等影片、影片又在等升天 ——
 *   把訊息框也算进来就是三方互等。
 */
const DAY_ROLL_PRESENTATIONS: ReadonlySet<string> = new Set(['monthly', 'lottery-draw', 'shares']);

/** 这一拍有神明经 `god_detach` 离身 ⇒ 排一次升天（一拍至多一位：任期只减当前那位）*/
function startGodAscend(before: GameState, after: GameState): void {
  const cue = godAscendTrigger(before, after)[0];
  if (cue === undefined) return;
  godAscend = { cue, before, start: null };
  requestRender();
}

/** 每帧：前面的演出收摊就起播（放音），演完收摊 */
function tickGodAscend(now: number): void {
  const a = godAscend;
  if (a === null) return;
  requestRender();
  if (a.start === null) {
    // 走子补间 / 道具·卡片飞行 / 月结那几屏还在 ⇒ 先等（原版它们都在 `god_detach` 之前、且都阻塞）
    if (!renderer.walkDone(now) || objectFlight !== null) return;
    // ★ 第十五份：送神 / 換神那一次用卡 —— 亮牌 `0x441f73` → 出牌台词 → 飞行 都在 `god_detach` 之前（请神符
    //   `0x00444e8a` → `0x00444efa` → 附身里的 `0x0040eb3f`）；先前升天与亮牌同时起播
    if (
      cardUsePopupActive() ||
      eventBoxPending() ||
      pendingCardFlight !== null ||
      filmWaitsForSpeech(speechAheadOfFilms(speechSnapshot()))
    ) {
      return;
    }
    const overlay = activeUiScreen();
    if (overlay !== null && DAY_ROLL_PRESENTATIONS.has(overlay.id)) return;
    a.start = now;
    // @source `0x0040e46f push 0 / push 0x4823e2 / call 0x4542ce` —— 升天之前响一声
    sound.play('Effect.mkf', GOD_ASCEND_SOUND);
    log(`神明升天：P${a.cue.player} 物件 #${a.cue.objectIndex + 1}（種類 ${a.cue.type}）`);
    return;
  }
  // 渲染器上一帧已经判出「演完了」（帧数到顶 / 整张图高过棋盘顶边），或兜底的时长到了
  if (renderer.godAscendEnded() || now - a.start >= GOD_ASCEND_MAX_MS) {
    godAscend = null;
  }
}

/** 这一件飞完该放哪个音效号（0 = 不放音） */
let objectFlightSound = 0;

/** ★ 第十四份 #5：機器娃娃那一趟押着等台词（见 `playSoundFor` 那一支） */
let dollWalkHeld = false;

/**
 * 台词队列空了（用道具那一句说完）就放娃娃上路，并起那一声循环音效 38。
 *
 * @source 循环：`0x40ded1 push 1` → `0x4542ce` → `IDirectSoundBuffer::Play(…, DSBPLAY_LOOPING)`；
 *   走完 `0x0040d8dc call 0x4542e9`（Stop）。`+80 ms` 是留一拍余量。
 */
function tickDollRelease(): void {
  if (!dollWalkHeld) return;
  // ★ 第十五份：电脑用娃娃时「使用機器娃娃」框（`0x00448070`）在道具函数之前 ⇒ 也等它
  if (filmWaitsForSpeech(speechAheadOfFilms(speechSnapshot())) || noticeHoldsFilms()) {
    requestRender();
    return;
  }
  dollWalkHeld = false;
  renderer.releaseActorWalks(performance.now());
  sound.play('Effect.mkf', SOUND_IDS.DOLL, true);
  const walkMs = renderer.actorWalkRemainingMs();
  window.setTimeout(() => sound.stop('Effect.mkf', SOUND_IDS.DOLL), Math.max(0, walkMs) + 80);
  requestRender();
}

/** 投掷在等台词说完才起播（见 `beginObjectFlight` 的 `awaitSpeech`） */
let objectFlightAwaitsSpeech = false;
/** 「还没起播」的 `start`：`flightPosAt` 为 null（不画）、`flightDone` 为假（不收） */
const FLIGHT_NOT_STARTED = Number.POSITIVE_INFINITY;

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
  objectFlightAwaitsSpeech = false;
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
  let f = objectFlight;
  if (f === null) return;
  // ★★ 第十四份試玩回報 #2：道具台词先说完（`filmWaitsForSpeech`，与影片 / 建屋动效同一道闸）
  if (objectFlightAwaitsSpeech) {
    // ★ 第十五份：电脑用道具那一扇「使用%s」（`0x00448070`，`lead` 档）也在投掷之前
    if (filmWaitsForSpeech(speechAheadOfFilms(speechSnapshot())) || noticeHoldsFilms()) {
      requestRender();
      return;
    }
    objectFlightAwaitsSpeech = false;
    f = { ...f, start: now };
    objectFlight = f;
  }
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
    // ★★ 第十四份試玩回報 #2：道具台词（`TOOL_LINE_ORDER = beforeStage`）先说完才投掷
    awaitSpeech: true,
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
  /**
   * ★★ 第十四份試玩回報 #2：起播前先等台上那几句（`speechQueue`）说完。
   *   原版放置類道具是 `player_say`（同步）→ 选格 → `place_object` → `animate_object`
   *   （路障 `0x00446bcc` → `0x00446be6`/`0x00446bef` …，见 `speech.ts` 的 `TOOL_LINE_ORDER`）。
   *   等的期间那一件**哪儿都不画**（`start` 取 +∞ ⇒ `flightPosAt` 为 null、静态槽照样藏着）
   *   —— 与原版一致：说话那会儿东西还没放下去。
   */
  awaitSpeech?: boolean;
}): boolean {
  const { from, to } = args;
  if (from === null || to === null) return false;
  if (from.x === to.x && from.y === to.y) return false;
  // 上一条还没播完就被顶掉（连着的两次使用）：先把它的音放掉，别吞掉
  if (objectFlight !== null) finishObjectFlight();
  const awaitSpeech = args.awaitSpeech === true;
  objectFlight = makeObjectFlight({
    objectIndex: args.objectIndex,
    type: args.type,
    facing: args.facing,
    ...(args.image === undefined ? {} : { image: args.image }),
    from,
    to,
    start: awaitSpeech ? FLIGHT_NOT_STARTED : performance.now(),
    ...(args.settleMs === undefined ? {} : { settleMs: args.settleMs }),
  });
  objectFlightAwaitsSpeech = awaitSpeech;
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
/**
 * 挂起的卡片飞行：`startActionFx` 记下、亮牌（`fcn_00441f73`）收屏之后才起播。
 *
 * @source 原版两条用卡路径都是 `call 0x441f73`（亮牌，阻塞）在前、
 *   `call [card_functions + 卡号*4]` 在后（真人 `0x00441cbc` → `0x00441cc6`、
 *   电脑 `0x00441def` → `0x00441e00`），而飞行（`animate_object`）在卡片函数体内。
 */
let pendingCardFlight: {
  before: GameState;
  action: { type: 'useCard'; cardId: number; target?: CardTarget };
  /** 卡片函数里飞完之后放的那一声（轉向卡 = 56，见 `throw-fx.ts` 的 `cardLandSfx`）；`null` = 没有 */
  landSfx: number | null;
} | null = null;

function tickPendingCardFlight(): void {
  const p = pendingCardFlight;
  if (p === null) return;
  // ★ 第十五份：出牌台词（`beforeStage`）在卡片函数里排在 `animate_object` 之前
  //   （均貧 `0x00442225` → `0x004422d6`、怪獸 `0x0044398f` → `0x00443a6a` …）⇒ 说完才飞
  if (cardUsePopupActive() || eventBoxPending() || filmWaitsForSpeech(speechAheadOfFilms(speechSnapshot()))) {
    requestRender();
    return;
  }
  pendingCardFlight = null;
  startCardFlight(p.before, p.action, p.landSfx);
  requestRender();
}

/**
 * 起卡片那一段飞行；`landSfx` 是卡片函数里**飞完之后**那一声（轉向卡 = 56）。
 * ★ 轉向卡：飞完（含 100 ms 停顿）才 `0x40c78c`（0x00443025）；真人出牌不飞（0x00442fe4）⇒ 当场响。
 */
function startCardFlight(
  before: GameState,
  action: { type: 'useCard'; cardId: number; target?: CardTarget },
  landSfx: number | null,
): void {
  const flying = beginCardFlight(before, action);
  if (landSfx === null) return;
  if (flying) objectFlightSound = landSfx;
  else sound.play('Effect.mkf', landSfx);
}

/** @returns 真的起播了一段飞行（飞完那一刻 `finishObjectFlight` 放 `objectFlightSound`）*/
function beginCardFlight(
  before: GameState,
  action: { type: 'useCard'; cardId: number; target?: CardTarget },
): boolean {
  const me = before.players[before.currentPlayer];
  if (me === undefined) return false;
  const here = map.nodes[me.nodeId - 1];
  if (here === undefined) return false;

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
  if (plan === null) return false;

  const vp = { w: LAYOUT.board.w, h: LAYOUT.board.h };
  const a = worldToScreen(plan.from.x, plan.from.y, camera, vp);
  const b = worldToScreen(plan.to.x, plan.to.y, camera, vp);
  if (plan.sprite.kind === 'card') {
    return beginObjectFlight({
      objectIndex: CARD_FLIGHT_NO_OBJECT,
      type: CARD_FLIGHT_TYPE,
      facing: 0,
      image: CARD_FLIGHT_IMAGE,
      from: a,
      to: b,
      settleMs: plan.settleMs,
    });
  }
  const started = beginObjectFlight({
    objectIndex: plan.sprite.objectIndex - 1,
    type: plan.sprite.type,
    facing: plan.sprite.facing,
    from: a,
    to: b,
    settleMs: plan.settleMs,
  });
  // ★ 卡片飞行本身**没有**收尾音效：23 个调用点后面都没有直接的 `play_sound_effect`
  //   （`xref 0x4542ce` 在这 23 个点之后一条都没有）—— 与放置類道具不同。
  //   唯一的例外是轉向卡：飞完调 `0x40c78c`，**那个函数**开头放 56（见 `cardLandSfx`）。
  return started;
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
/** ★ 第十五份：大锤敲完、正停着等台词（见 `tickBuildFx` 的接缝）*/
let buildFxSeamHeld = false;

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
 * 关押 / 消失那几段影片各自的镜头（按影片 id）—— 起播时照 ① 移、播完照 ② 移。
 * 目标全部来自 core 的 `confineViewTargets`（exe 序列见该文件头），表现层只决定「影片什么时候起播」。
 * `null` = 受害者就是行动者（原版 `view_to` 清标记 ⇒ 看行动者，冻镜头 / `confined` 支本来就是）。
 */
const filmViews = new Map<string | BoardFilmSpec, ConfineView | null>();

/** 下一帧要照做的那一次 `view_to`（排在 `lastViewTarget` 之后，见 `syncViewTarget`） */
let queuedFilmView: { x: number; y: number } | null = null;

/** 这一段影片起播（`from`）/ 收屏（`to`）时该不该移镜头 */
function applyFilmView(spec: BoardFilmSpec, at: 'from' | 'to'): void {
  // ★ 第十五份：同一条 action 里好几段同名影片（新聞 4 每人一辆救护车）各有各的镜头 ⇒ 先按规格对象找
  const t = (filmViews.get(spec) ?? filmViews.get(spec.id))?.[at] ?? null;
  if (t === null) return;
  queuedFilmView = t;
  requestRender();
}

/**
 * 片中重画之后「等级 / 物件放开、**人仍按住**」的那一份快照（换了快照 ⇒ 自动失效）。
 * 只有「这一段之后还要 `send_to_hospital`」时才用得上（狗咬 / 爆炸 → 救护车），见 `applyBoardFilmRedraw`。
 */
let boardFilmRedrawKeepsPlayersFor: GameState | null = null;

/**
 * 顯靈加蓋那一扇框还没收时，棋盘上被加蓋的那几格少画的级数（`manifest-hold.ts`）；`null` = 没在按。
 * 由 `startBuildFx` 立、`tickManifestHold` 在框收掉那一拍放。
 */
let manifestHold: ManifestHold | null = null;

/**
 * ★★ 第二十六份：电脑换车那一扇「使用%s」框还没收时，那一位按换车**之前**的交通方式画
 * （`vehicle-hold.ts`；原版 `0x00448070` 框在前、`0x40b93b` 换图组在道具函数里）；`null` = 没在按。
 */
let vehicleHold: VehicleHold | null = null;

/** 「使用%s」框收掉了（没在弹、也没排着）⇒ 放开，棋子这一拍换成车（= 原版 `0x40b93b`）*/
function tickVehicleHold(): void {
  if (vehicleHold === null || noticeKeyShowing(AI_TOOL_NOTICE_KEY)) return;
  vehicleHold = null;
  requestRender();
}

/**
 * 顯靈框收掉了 ⇒ 放开按住的等级，并补那第二声音效 50
 * （天使 `0x0040f4f8` / 福神 `0x0040f9e1`，都在框之后、重画 `0x41d476(0,0,1)` 之前）。
 */
function tickManifestHold(): void {
  const hold = manifestHold;
  if (hold === null || noticeKeyShowing(MANIFEST_NOTICE_KEY)) return;
  manifestHold = null;
  sound.play('Effect.mkf', MANIFEST_BUILD_SOUND);
  // 盖到 5 级的那一支：原版先重画出 5 级（`0x0040f506`）再播 0x20b（`0x0040f517`）⇒
  //   等 0x20b 起播的那段窗口里棋盘按**新等级**画，而不是退回整条 action 之前的 before
  if (hold.reachedMaxLevel && deferredBoardBefore !== null && (pendingBuildFx !== null || buildFx !== null)) {
    deferredBoardBefore = {
      ...deferredBoardBefore,
      landLevel: state.landLevel,
      facilityLevel: state.facilityLevel,
    };
  }
  requestRender();
}

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
/**
 * ★ 第十五份：排在 `pendingBoardFilmAfter` **后面**的那几段（先进先出）。
 *   原版同一次结算里可以串好几次阻塞的 `fcn_0045144f`：新聞 4 `fcn_0044913d` 里每位受害者一次
 *   `send_to_hospital`（各播 0x20c）、最后才是飛碟 0x213（VA 0x00449245 / 0x0044925b）。
 *   不变量：它非空 ⇒ `pendingBoardFilmAfter` 非空（所有「还有片子排着」的闸只看后者）。
 */
let boardFilmQueueRest: BoardFilmSpec[] = [];

/**
 * ★★ 第十八份（「神明动画和白字文案应该同步出现」）：附身影片播完**钉在屏上**的最后一帧。
 *   原版片尾不重画（`flags` = 1 ⇒ `fcn_0045144f` 不走 `0x409b18`），开场白 `0x40e2a2` 直接写在这一幅上
 *   ⇒ 神明立像与白字同屏 2400 ms（出处见 `god-line.ts` 文件头）。开场白收场那一拍一起收（`tickGodLine`）。
 */
let heldGodFilm: { film: BoardFilm; flic: LoadedFlic | null } | null = null;

/** 放掉钉着的那一帧；棋盘此时才按 after 画（没有别的影片窗口还开着的话）*/
function releaseHeldGodFilm(): void {
  const held = heldGodFilm;
  if (held === null) return;
  heldGodFilm = null;
  held.flic?.close();
  if (!boardFilmWindowOpen(boardFilmWindowFlags())) {
    deferredBoardBefore = null;
    boardFilmRedrawKeepsPlayersFor = null;
  }
  requestRender();
}

/** 接下一段排队的片子（`pendingBoardFilmAfter` 被取走 / 放弃之后）*/
function shiftBoardFilmQueue(): void {
  pendingBoardFilmAfter = boardFilmQueueRest.shift() ?? null;
}

/**
 * ★ 第十五份：把一段影片**排到队尾**（原版串行的那几次 `fcn_0045144f` 照 exe 次序播，谁也不顶掉谁）。
 *   台上空着 ⇒ 当场起播（与 `startBoardFilm` 一样）。
 */
function queueBoardFilm(spec: BoardFilmSpec): void {
  if (boardFilm === null && pendingBoardFilm === null && pendingBoardFilmAfter === null) {
    startBoardFilm(spec);
    return;
  }
  if (pendingBoardFilm === null && boardFilm === null) {
    // 只剩排队的：接在队尾
    boardFilmQueueRest.push(spec);
  } else if (pendingBoardFilmAfter === null) {
    pendingBoardFilmAfter = spec;
  } else {
    boardFilmQueueRest.push(spec);
  }
  boardFilmFlicNow(spec); // 先解码，轮到它时不必再等
  requestRender();
}

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
  // ★ 镜头（`view_to` ① / ②，core 的 `confineViewTargets`）—— 两次都不在「動畫過程」闸
  //   （`cmp [0x497159], 0`）里，也不在加刑那道跳转（`0x0043d5da` / `0x0043ec86 test dh,dh / jne`）里：
  //   没有影片夹在中间（動畫過程关着 / 加刑）⇒ ① 与 ② 背靠背，镜头停在 ②。
  const views = confineViewTargets(before, after).filter((v) => v.kind !== 'disappear');
  // ★ 第十五份：**每一位**首次被送进去的人各一段（新聞 4 / 飛彈那个逐人 `send_to_hospital` 循环，每人一次）
  const hits = confineFxTriggers(before, after);
  if (hits.length === 0 || !options.animation) {
    const to = views.find((v) => v.to !== null)?.to ?? null;
    if (to !== null) {
      queuedFilmView = to;
      requestRender();
    }
    return;
  }
  // 影片窗口里棋盘按 before 画（见 `deferred-board.ts`）—— 起播前先记下快照
  deferredBoardBefore = before;
  // ★★ 第十五份試玩回報：新聞 29 / 命運 33 引出的入獄（住院同理）是事件处理函数 pass 1 才调
  //   `send_to_*` 的 ⇒ 事件提示框停满（或被点掉）之后才播（`afterEventBox`，见 `board-film.ts`）
  const afterBox = confineAfterEventBox(before, after);
  for (const hit of hits) {
    const clip: BoardFilmSpec = afterBox ? { ...confineClip(hit.kind), afterEventBox: true } : { ...confineClip(hit.kind) };
    filmViews.set(clip, views.find((v) => v.player === hit.player && v.kind === hit.kind && !v.extended) ?? null);
    // ★★ 同一条 action 里已经排了一段（踩到惡犬：0x214 在前）⇒ **接在它后面**，
    //   谁也不顶掉谁（第五份回报第 3 条；第十五份起是多段队列 `queueBoardFilm`）
    queueBoardFilm(clip);
  }
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
 * 这一拍是不是**用了飛彈 / 核彈** —— 是就播那一段爆炸影片（整幅 440×440 盖住棋盘）。
 *
 * 规格与判据全在 `missile-fx.ts`（逐字节核过 `Data.mkf` 0x210 / 0x212 的 FLIC 头：
 * 19 帧 × 114 ms / 26 帧 × 114 ms、音效 81 / 83、`flags` 的 bit1 = 0 ⇒ 点不掉）。
 *
 * @source · 飛彈 `0x00446fbc`：`0x00447043 push 0x210` → `0x00447065 view_to(爆心)`
 *   → `0x0044707a damage_area` → `0x0044708e call 0x45144f`（播）；
 *   · 核彈 `0x00447ace`：`0x00447b55 push 0x212` → `0x00447b77 view_to(爆心)`
 *   → `0x00447b8c damage_area(半径 -1)` → `0x00447ba0 call 0x45144f`。
 *
 * ⚠️ 判据是**道具号**（原版两支各是一整个函数，影片写死在自己那一段里），
 *   不看「炸到了什么」；也不加 `options.animation` 闸（原版这两支里没有那一句）。
 * ⚠️ `applyAction` 只在 `state !== before` 时调 `startActionFx`，而
 *   `useToolAction` 失败时**原样返回 `state`** ⇒ 没真的打出去就不会误播。
 */
function startMissileFx(action: Action, before: GameState): void {
  if (action.type !== 'useTool') return;
  const spec = missileFilmFor(action.toolId);
  if (spec === null) return;
  // 影片整幅盖住棋盘，`before` / `after` 观感相同；与神明/惡犬/飛碟那几段统一取 `before`。
  deferredBoardBefore = before;
  startBoardFilm(spec);
  log(`影片：${spec.id}（${spec.frames} 帧 × ${spec.frameMs} ms）`);
}

/**
 * 这一拍是不是「惡魔顯靈把脚下那栋房子拆了」—— 是就播那一段 110×110 的爆破片。
 *
 * W-55 行 4。规格与判据全在 `devil-fx.ts`（逐字节核过 `Data.mkf` 0x20e 的 FLIC 头：
 * 8 帧 × 114 ms、110×110、音效 `Effect.mkf` 95、`flags = 0x30001` ⇒ 点不掉）。
 *
 * @source 原版 `fcn_0040f381` 惡魔那一支（`god_info == 10`）尾段：
 *   先 `0x0040f618` 拆一级（= core 的 `manifestGodOnLanding`），**再**
 *   `0x0040f635 call 0x40b066` 取**那一格**的屏幕坐标、`0x0040f642` 解 0x20e、
 *   `0x0040f65e/0x0040f669` 各 `sub eax, 0x37`（= 110 的一半，居中）后播放。
 *
 * ⚠️ 落点是**逐格**的（`boardFilmSpec.x/y` 是起播时定死的静态值），所以这里
 *   起播那一刻现算 —— 与其它几段 440×440「整块棋盘 @(0,40)」的片子不同类。
 *
 * ⚠️ `deferredBoardBefore` 这里填的是 **after**（不是 `before`）：原版是**先拆、
 *   重画、再播**（`0x0040f618` 在 `0x0040f642` 之前），而这一段只有 110×110，
 *   四周的棋盘照样看得见 ⇒ 必须显示拆完的样子。其它几段（神明/恶犬/飛碟）
 *   反过来（影片里「东西还在原地」），所以它们填 `before`。
 */
function startDevilFx(before: GameState, after: GameState): void {
  if (!devilDemolishFxTrigger(before, after)) return;
  // 被拆的就是行动者**脚下**那一格（`manifestGodOnLanding` 的 `estateEntityAtPlayer`）
  const me = after.players[after.currentPlayer];
  if (me === undefined) return;
  const node = map.nodes[me.nodeId - 1];
  if (node === undefined) return;
  const p = worldToScreen(node.x, node.y, camera, { w: LAYOUT.board.w, h: LAYOUT.board.h });
  if (p === null) return;
  deferredBoardBefore = after;
  // 棋盘局部 → **屏幕**坐标（`currentBoardFilmFrame` 会再减回棋盘点）
  startBoardFilm(devilDemolishFilmAt(p.x + LAYOUT.board.x, p.y + LAYOUT.board.y));
  log(
    `影片：惡魔顯靈拆屋 0x${DEVIL_FX_RESOURCE.toString(16)}` +
      `（${DEVIL_DEMOLISH_FRAMES} 帧 × ${DEVIL_DEMOLISH_FRAME_MS} ms）`,
  );
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
function startDisappearFx(before: GameState, after: GameState): void {
  const spec = disappearFxTrigger(before, after);
  if (spec === null) return;
  // ★ 镜头 ①（`0x0040d3e6 view_to(受害者)`，在播片之前；这一支没有 ②）—— core 的 `confineViewTargets`
  filmViews.set(spec.id, confineViewTargets(before, after).find((v) => v.kind === 'disappear') ?? null);
  // 影片窗口里棋盘按 before 画：人还站在那儿，被飛碟吸走 / 上飛機（`deferred-board.ts`）
  deferredBoardBefore = before;
  // ★★ 第十四份：`fcn_0040d375` 里是 台词（`0x0040d3f8`）→ 理賠框（`0x0040d425`）→ 影片（`0x0040d498`）
  //   ⇒ 影片押到同一拍的台词说完、框收完再起（`tickPendingDisappearFx`）。
  pendingDisappearFx = { spec, before };
  requestRender();
}

/** ★ 第十四份：押着等台词 / 訊息框的那一段飛機 / 飛碟 */
let pendingDisappearFx: { spec: BoardFilmSpec; before: GameState } | null = null;

function tickPendingDisappearFx(): void {
  const p = pendingDisappearFx;
  if (p === null) return;
  if (speechQueue.length > 0 || heldSpeech.length > 0 || blockingPresentation() || !renderer.walkDone()) {
    requestRender();
    return;
  }
  pendingDisappearFx = null;
  deferredBoardBefore = p.before;
  startBoardFilm(p.spec);
  log(`影片：${p.spec.id === 'abduct' ? '被外星人綁架（飛碟）' : '強迫出國觀光（飛機）'}`);
}

/**
 * 这一拍是不是剛抽到新聞 5 / 15 / 20 / 21（「随机挑一处建筑」那一族）—— 是就播那一段影片。
 *
 * 规格与判据全在 `news-place-fx.ts`（四个调用点逐条读过：资源 / 音效 / flags）。
 * 镜头不在这里：core 已把挑中那一处写进 `lastViewTarget`（`syncViewTarget()` 居中，
 * 演出收完复位）；这一段落在屏幕 (0,0x28) 整块棋盘上，正好盖住那一处。
 *
 * ★ 影片窗口里棋盘按 **before** 画（房子还在）：原版是 `mutate_land` 在前、影片在后，
 *   起播时房子还在，玩家这才看得出**是哪一栋**受了影响（第十二份回报的原话）。
 *   第十四份試玩回報起：到 `flags` 第三字节那一帧（0x80001 = 第 8 个计数，龍捲風正压在房子上；
 *   0x50001 / 0x200001 同理）原版片中重画一次棋盘 ⇒ 房子在片中当场少一级（`applyBoardFilmRedraw`）。
 * ★ 不加 `options.animation` 闸：这四个函数里都没有 `cmp byte [0x497159], 0`。
 */
function startNewsPlaceFx(before: GameState, after: GameState): void {
  const spec = newsPlaceFxTrigger(before, after);
  if (spec === null) return;
  deferredBoardBefore = before;
  startBoardFilm(spec);
  log(`影片：新聞 ${after.lastEvent?.id ?? '?'} ${spec.id}（${spec.frames} 帧 × ${spec.frameMs} ms）`);
}

function startAlienNewsFx(before: GameState, after: GameState): void {
  const spec = alienNewsFxTrigger(before, after);
  if (spec === null) return;
  // 影片窗口里棋盘按 before 画：房子还没被掀掉（`deferred-board.ts`）
  deferredBoardBefore = before;
  // ★ 第十五份：走队列（`fcn_0044913d`：`0x0044925b` 飛碟 0x213 → 之后逐人 `send_to_hospital` 各播 0x20c），
  //   谁也不顶掉谁。先前 `startBoardFilm` 把排好的救护车顶掉了。
  queueBoardFilm(spec);
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
  if (
    after !== null &&
    boardFilm === null &&
    pendingBoardFilm === null &&
    !noticeHoldsFilms() &&
    // ★ 第十五份：事件（新聞 / 命運）引出的那一段等事件提示框收掉（`afterEventBox`）
    !boardFilmWaitsForEventBox(after, eventBoxScreen.active(uiEnv()))
  ) {
    const key = `${after.archive}:${after.resource}`;
    if (boardFilmFlics.has(key)) {
      shiftBoardFilmQueue();
      boardFilm = beginBoardFilm(after, now);
      applyFilmView(after, 'from');
      log(`影片：開始 ${after.id}（${after.frames} 帧 × ${after.frameMs} ms）`);
      if (after.sound >= 0) sound.play('Effect.mkf', after.sound);
      requestRender();
      return;
    }
    // 还没解好 → 现在就解，并**保留**排队标记：`holdForActorWalk` 靠它
    // 挡住「两段之间的空档」，别让 AI 在第二段起播前先派下一步。
    // ⚠️ 这一段**必须**自己再排一帧：这一拍 `boardFilm`/`pendingBoardFilm` 都是空，
    //   谁都叫不醒我们（`.then` 只在**首次**发起解码时挂）。漏了就死等在这里，
    //   而回合驱动被上面那道闸挡着 —— 整局卡死。
    boardFilmFlicNow(after);
    requestRender();
    if (boardFilmPending.has(key)) return;
    // 真取不到（没有素材）就整段放弃，免得把回合驱动永远卡在这里
    shiftBoardFilmQueue();
  }
  const pending = pendingBoardFilm;
  if (pending !== null) {
    // ★★ W-51：**原版说完才播**。`beforeStage`（壞神附身 / 回合开始那三句）的句子
    //   已经进了 `speechQueue`，这一段影片等它说完 —— 原版那一句 `player_say` 是
    //   同步返回的，调用它的流程才走到 `read_mkf + fcn_0045144f`。
    //   ⚠️ 只等 `speechQueue` + 押着的 `beforeStage`（`speechAheadOfFilms`）；押在 `heldSpeech` 里的
    //      `afterStage` 本来就该排在影片**之后**，反过来挡影片就是死锁
    //      （见 `stage-gate.ts` 的 `filmWaitsForSpeech` 与它的单测）。
    if (filmWaitsForSpeech(speechAheadOfFilms(speechSnapshot()))) return;
    // ★ 换神：旧神先升天（`0x40eb3f` 在影片之前），演完 `tickGodAscend` 会再叫醒我们
    if (godAscend !== null) return;
    // ★ 第十五份：卡片 / 物件还在飞 ⇒ 影片等它（卡片函数里 `animate_object` 在影片之前：怪獸 `0x00443a6a` →
    //   `0x00443aaf`、陷害 `0x00444591` → 送監獄 `0x0044461c`、請神符 `0x00444efa` → 附身影片）
    if (objectFlight !== null || pendingCardFlight !== null) {
      requestRender();
      return;
    }
    // ★ 魔法屋：原版每一支先 `0x440cac` 弹框（阻塞 1500 ms）、再播影片（拆除 0x211 / 入獄・住院）
    //   ⇒ 那几扇（`NoticeHint.beforeFilms`）还没弹完就先押着；訊息框自己续帧叫醒我们
    if (noticeHoldsFilms()) return;
    // 补间没播完就先不起播；`requestRender` 那条「补间没完就再排一帧」会一直叫醒我们
    if (!renderer.walkDone(now)) return;
    // 訊息框那一段盖着整块棋盘 ⇒ 原版次序是框先、片后，等它收屏
    // ★ 第十二份試玩回報：用卡那一次亮牌（`fcn_00441f73`）在卡片函数**之前**、阻塞 1500 ms
    //   ⇒ 卡片引出的影片（入獄 / 神明附身…）一律等它收屏
    if ((pending.afterOverlay === true && activeUiScreen() !== null) || cardUsePopupActive()) {
      requestRender();
      return;
    }
    // ★★ 第十五份試玩回報（「前一个事件的弹窗还没看清楚就触发」）：新聞 / 命運引出的入獄・住院
    //   等**事件提示框**那一屏收掉（只看那一屏 —— 保險理賠框排在影片后面，等它就是死锁）
    if (boardFilmWaitsForEventBox(pending, eventBoxScreen.active(uiEnv()))) {
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
    applyFilmView(pending, 'from');
    // 魔法屋拆房：原版 `0x40ab4a`（重画地图）在 `fcn_0045144f` 之前 ⇒ 影片期间棋盘已是拆过的样子
    if (pending.releaseBoardOnStart === true) deferredBoardBefore = null;
    log(`影片：開始 ${pending.id}（${pending.frames} 帧 × ${pending.frameMs} ms）`);
    if (pending.sound >= 0) sound.play('Effect.mkf', pending.sound);
    requestRender();
    return;
  }
  const film = boardFilm;
  if (film === null) return;
  // ★ 第十四份試玩回報：片中那一次重画（`flags` 第三字节）—— 必须在「播完没」之前看，
  //   掉帧时两件事可能落在同一拍
  applyBoardFilmRedraw(film, now);
  if (!boardFilmDone(film, now)) {
    requestRender();
    return;
  }
  // ★ 第十八份：附身影片后面紧跟着开场白 ⇒ 最后一帧钉住（位图从缓存里摘出来，不随下面一起 close）
  const holdFrame = pendingBoardFilmAfter === null && godFilmFrameHeld(film.spec.id, pendingGodLine !== null || godLine !== null);
  if (holdFrame) {
    releaseHeldGodFilm();
    const key = `${film.spec.archive}:${film.spec.resource}`;
    heldGodFilm = { film, flic: boardFilmFlics.get(key) ?? null };
    boardFilmFlics.delete(key);
  }
  boardFilm = null;
  releaseBoardFilmFlics();
  applyFilmView(film.spec, 'to');
  filmViews.delete(film.spec.id);
  filmViews.delete(film.spec);
  // ★ 阻塞那一段播完了 —— 若后面还排着一段（狗咬 → 救护车），就交给上面 ⓪ 那一步；
  //   只有**两段都播完**才把回合驱动接回去（`scheduleHumanTurn` / `scheduleAi`
  //   都以它为闸，不补这一下人就永远停在原地）。
  if (pendingBoardFilmAfter === null) {
    // ★★ 2026-09-22（第十一份試玩回報 #11 順帶查出的**真隱患**）：
    //   影片收摊时把 `deferredBoardBefore` 清掉 —— 先前它**从不在收摊时清**
    //   （只在换局/读档/失步自愈时清），下一条影片起播时才被覆写。
    //   而 `holdBackPlayers` 的判据是 `before.inHospital===0 && after.inHospital!==0`
    //   ⇒ 一份**过期快照**会把「期间才被关押的人」在画面上**复活**，
    //   并因 `wreckedThisAction(staleBefore, after, i)` 为真而画成乞丐、站在很久以前的旧坐标上。
    // ★ 第十八份：钉着最后一帧时屏幕还没重画 ⇒ 快照留到开场白收场（`releaseHeldGodFilm` 清）
    if (!holdFrame) {
      deferredBoardBefore = null;
      boardFilmRedrawKeepsPlayersFor = null;
    }
    resumeTurnDriver();
  }
  requestRender();
}

/**
 * 原版 `fcn_0045144f` 的**片中重画**（`flags` 第三字节，逐条见 `board-film.ts` 的
 * `boardFilmRedrawFrame`）：到那一帧就按**当时的游戏状态**重画影片底下的棋盘。
 *
 * ★ 第十四份試玩回報两条都是它：
 *   · 「警车开过角色后角色就该消失」—— 入獄 0x21a `flags` 0x120001 ⇒ 第 18 个计数
 *     （第 17 帧，警车正盖住人）重画；此前 `0x0043d627..0x0043d652` 已把人搬进監獄 ⇒ 人没了。
 *     住院 0x20c（0x1e0001）同理，第 30 个计数（救护车停在人身上、开着门那一帧）。
 *   · 「狗咬完狗就该消失」—— 0x214 `flags` 0x30001 ⇒ 第 3 个计数重画；`remove_object`
 *     在片子之前 ⇒ 烟尘散开时狗已经没了。
 *
 * 那一刻原版的状态 = 调用 `fcn_0045144f` 之前写下的一切：
 *   · 一般情况就是整条 action 的 after ⇒ 放掉快照（`deferredBoardBefore = null`）；
 *   · 这一段之后**还要** `send_to_hospital`（狗咬 / 爆炸，或后面排着一段）⇒ 位置、住院天数、
 *     乞丐造型那几项还没发生 ⇒ 只放开等级与物件，人仍按住，等下一段自己的重画。
 * 镜头不动：`view_to(新位置)` 在片子**之后**（入獄 `0x0043d6f1`），镜头的冻结判据只看窗口开没开。
 */
function applyBoardFilmRedraw(film: BoardFilm, now: number): void {
  if (deferredBoardBefore === null || !boardFilmRedrawn(film, now)) return;
  if (pendingBoardFilmAfter !== null || filmPrecedesSendToHospital(film.spec)) {
    boardFilmRedrawKeepsPlayersFor = deferredBoardBefore;
    return;
  }
  deferredBoardBefore = null;
  requestRender();
}

/** 片中重画之后是不是「只按住人」那一档 */
function boardRedrawKeepsPlayersOnly(): boolean {
  return boardFilmRedrawKeepsPlayersFor !== null && boardFilmRedrawKeepsPlayersFor === deferredBoardBefore;
}

/** 这一刻该贴哪一帧（屏幕落点由规格给）—— 没在播或影片没到货就是 null */
function currentBoardFilmFrame(now: number): {
  bitmap: CanvasImageSource;
  x: number;
  y: number;
  w: number;
  h: number;
} | null {
  // ★ 第十八份：附身影片播完钉住的最后一帧（开场白写在它上面）
  const film = boardFilm ?? heldGodFilm?.film ?? null;
  if (film === null) return null;
  const spec = film.spec;
  const flic = boardFilm !== null ? (boardFilmFlics.get(`${spec.archive}:${spec.resource}`) ?? null) : (heldGodFilm?.flic ?? null);
  const bitmap = boardFilmBitmap(film, now, flic);
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
  const hints = buildUpgradesOf(state, before);
  const plan = buildFxPlan(hints);
  // ★★ W-55 行 3：**顯靈／自己加蓋那一声音效** —— `Effect.mkf` 50。
  //
  //   @source 三处 `push 0x4823da / call 0x4542ce`（号码与换算见 `SOUND_IDS.GOD_MANIFEST`）：
  //     · 天使顯靈  VA 0x0040f4f3（`test bh,1` 成功之后、`test bh,0x80` 之前）
  //     · 福神顯靈  VA 0x0040f9dc（同形）
  //     · 自己的地升級 VA 0x004199de（`inc byte [地块+0x1a]` 之后、`cmp …,5` 之前）
  //   ⇒ **在 `plan` 那道闸之前**响：原版这一声在 `0x40b110` 成功之后立刻播，
  //     与「有没有剛好升到 5 級、要不要接 0x20b」无关（那两段影片才是 `plan` 的事）。
  // ★★ 第十三份試玩回報 #1：弹了顯靈框的那几条顯靈加蓋（天使 `0x0040f4f8` / 福神 `0x0040f9e1`）
  //   这一声在**框收掉之后**才响，棋盘也等那时才画成新等级（`tickManifestHold`）；
  //   同一条 action 里先发生的付费首建 / 自己的地升級那一声照旧当场响。
  const hold = manifestHoldOf(before, state);
  if (hold !== null) manifestHold = hold;
  const manifestSound = manifestSoundFor(immediateManifestHints(hints, hold));
  if (manifestSound !== null) sound.play('Effect.mkf', manifestSound);
  if (!plan.hammer && !plan.maxLevel) return;
  // ★★ 第九份试玩回报（2026-09-22，需求方）：「机器工人修房子的动画还是有点问题，应该是
  //   机器工人出场时房子还没修好，他们叮叮咚咚敲完的时候同时切换成修好的模型，然后机器工人退场。」
  //
  //   ⇒ 这是**中间档**，前两版各偏一边：
  //     · issue #19 第 9 条：整段按住（房子要等两段影片全播完才出现）；
  //     · 第八份 #6：整段不按（点下去那一拍房子就修好了，工人还没出场）。
  //
  //   现在：**大锤段**把等级按回 `before`，走到第 48 帧（= 2736 ms，烟尘散尽、工人立定成排）
  //   再放开 —— 与需求方描述的次序完全一致（入场/敲打期间旧房子 → 敲完那一拍换新模型 → 退场）。
  //   放开那一拍的判定在 `boardDrawState()`，帧号与实测节拍见 `build-fx.ts` 的
  //   `BUILD_HAMMER_DONE_FRAME`。
  //
  //   ⚠️ 只在大锤族按住：天使卡 / 自己的地升級那两条**没有**大锤段（见 `HAMMER_SOURCES`），
  //      等级照旧当场放出来。
  //   ⚠️ 这一行同时修掉一个既有泄漏：`deferredBoardBefore` 先前只在换局与失步自愈时清空，
  //      影片收摊时从不清 —— 上一条影片（神明/入獄/恶犬…）留下的**过期快照**会被下一条
  //      「只用機器工人」的 action 拿去按住 `landLevel`，画出更旧的等级。7 处起播点里
  //      只有 `startBuildFx` 不写快照，现在补上。
  // ★ 2026-09-22（同 #11）：**无条件**写快照 —— 先前只在 `plan.hammer` 时写，
  //   于是「天使卡 / 魔法屋加蓋 / 自己的地升級」那几条（没有大锤段）不写，
  //   配上「收摊不清」就正好让**上一条影片的过期快照**继续生效。
  //   现在收摊会清、起播必写，这条 stale 路径就没有了。
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
    // ★ 第十三份試玩回報 #1：顯靈加蓋盖到 5 级那一段 0x20b 排在顯靈框**之后**
    //   （`0x0040f4d9 call 0x440cac` → `0x0040f517 call 0x40b0cd`）⇒ 框收掉（`tickManifestHold` 放开）才起播
    if (manifestHold !== null) return;
    // ★★ W-51：与 `tickBoardFilm` 同一条规矩 —— **原版说完才播**：`beforeStage`
    //   的句子（壞神附身 / 回合开始那三句）在 `speechQueue` 里就等它说完。
    //   ⚠️ 只等 `speechAheadOfFilms`（台上的 + 押着的 `beforeStage`），不等押着的 `afterStage`（排在演出之后，
    //      反过来挡影片就是死锁）。见 `stage-gate.ts` 的 `filmWaitsForSpeech`。
    if (filmWaitsForSpeech(speechAheadOfFilms(speechSnapshot()))) return;
    // 补间没播完就先不起播；`requestRender` 那条「补间没完就再排一帧」会一直叫醒我们
    if (!renderer.walkDone(now)) return;
    // ★ 魔法屋「就地加蓋」：原版先 `0x440cac` 弹「名字\n\n就地加蓋房屋」1500 ms（0x00432003），
    //   再 `read_mkf(0x229)` + `fcn_0045144f`（0x00432074）⇒ 等那一扇框收掉（訊息框自己续帧叫醒我们）
    if (noticeHoldsFilms()) return;
    // ★ 天使卡（9）的建屋片同理：等「使用天使卡」那一次亮牌收屏（见 `tickBoardFilm`）
    if (cardUsePopupActive()) {
      requestRender();
      return;
    }
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
  // ★★ 第十五份：大锤敲完、接 0x20b 之前先等台词 —— 自家建設公司盖到 5 级是
  //   大锤 `0x0041ab10` → 事件 15 `0x0041ab5b` → 0x20b `0x0041ab63`（那一句带 `cue: buildHammer`，
  //   敲完才算数）。停在这一拍的期间画面留在大锤最后一帧；放行时 0x20b 从**此刻**起算。
  if (fx.clip === 'hammer' && fx.thenMaxLevel && clipDone(fx, now)) {
    if (filmWaitsForSpeech(speechAheadOfFilms(speechSnapshot()))) {
      buildFxSeamHeld = true;
      requestRender();
      return;
    }
    if (buildFxSeamHeld) {
      buildFxSeamHeld = false;
      releaseBuildFlic(buildClip(fx.clip).resource);
      buildFx = { clip: 'maxLevel', startedAt: now, thenMaxLevel: false };
      playBuildFxSound('maxLevel');
      buildFlicNow('maxLevel');
      requestRender();
      return;
    }
  }
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
/**
 * 正在落地的那一位与他那一段影片（`null` = 没有）。影片待播 / 在播期间棋盘与小地图**不画他**
 * （原版 `0x00418cde` 播完才写坐标），播完 / 放弃就撤。
 */
let landingFx: { player: number; spec: BoardFilmSpec } | null = null;

/**
 * 起一段落地影片（原版 `fcn_00418c55` 开头那一段，见 `landing-fx.ts`）：
 * 镜头先对准落点（摆人那一次重画 `0x0040829d` 就居中到那一格了 —— 不落小地图标记），
 * 影片排进棋盘影片队列（点不掉、无音效、不看「動畫過程」开关）。
 */
function startLandingFx(player: number): void {
  const me = state.players[player];
  if (me === undefined) return;
  const spec = landingFilmSpec(me.character);
  landingFx = { player, spec };
  camera = pixelCamera(me.xpos, me.ypos, camera.view);
  queueBoardFilm(spec);
  log(`影片：${CHARACTERS[me.character]?.name ?? `P${player + 1}`} 降落（0x${spec.resource.toString(16)}，${spec.frames} 帧 × ${spec.frameMs} ms）`);
}

/** 落地那一段还挂在影片队列里吗（待解码 / 在播 / 排队）—— 不在了就撤掉「先别画他」 */
function landingHeld(): number | null {
  const l = landingFx;
  if (l === null) return null;
  const queued =
    boardFilm?.spec === l.spec ||
    pendingBoardFilm === l.spec ||
    pendingBoardFilmAfter === l.spec ||
    boardFilmQueueRest.includes(l.spec);
  if (!queued) {
    landingFx = null;
    return null;
  }
  return l.player;
}

/** 影片期间先别画正在落地的那一位（棋盘 / 小地图共用）*/
function withLandingHidden(s: GameState): GameState {
  const who = landingHeld();
  return who === null ? s : hideLandingPlayer(s, who);
}

function boardDrawState(): GameState {
  return withLandingHidden(boardDrawStateBase());
}

/** 棋盘那一份（影片窗口 / 顯靈框按住之后），再叠上第二十六份的换车按住（`vehicle-hold.ts`）*/
function boardDrawStateBase(): GameState {
  return applyVehicleHold(boardDrawStateHeld(), vehicleHold);
}

function boardDrawStateHeld(): GameState {
  // ★★ 機器工人那一段的**中途放出**（第九份试玩回报，见 `startBuildFx` 的注释）：
  //   大锤片走到第 48 帧（2736 ms，烟尘散尽、工人立定成排）就放开等级 ⇒ 房子在这一拍
  //   换成修好的模型，工人接着演退场段。
  //   `buildFx === null`（= 还在 `pendingBuildFx` 等解码）时 released = false ⇒ 继续按住，
  //   这正是「机器工人出场时房子还没修好」。
  //   其余影片（神明/救护车/入獄/飛碟）的 `buildFx` 恒为 null ⇒ 恒 false ⇒ 等级照旧一直按住。
  const now = performance.now();
  const released = buildFx !== null && buildHammerDone(buildFx, now);
  // ★ 第十四份試玩回報：狗咬 / 爆炸片中重画之后，狗（地雷）已撤、人还按住（`applyBoardFilmRedraw`）
  const playersOnly = boardRedrawKeepsPlayersOnly();
  // ★★ 神明升天期间（第十二份试玩回报 #1）：原版 `god_detach` 在演完之后才 `0x40e604 call 0x40e14d`
  //   真正拆下来（清 `god_info`、搭档此时才在地图上登场）⇒ 棋盘按离身**之前**那一份画，
  //   升天那一尊由渲染器藏掉、改画在动效层。
  if (godAscend !== null) {
    return applyManifestHold(visibleBoardState(state, deferredBoardBefore ?? godAscend.before, !released), state, manifestHold);
  }
  // ★ D-MAGIC-16：魔法屋逐人那几段里棋盘按「演到哪一段」画（后面几位的改动还没发生）
  if (magicSeq !== null) {
    const base = magicShownState();
    return boardStateForFilm(base, deferredBoardBefore, boardFilmWindowFlags(), !released && !playersOnly, !playersOnly);
  }
  // ★ 第十三份試玩回報 #1：顯靈框底下还是顯靈之前的等级（`manifest-hold.ts`）
  return applyManifestHold(
    boardStateForFilm(state, deferredBoardBefore, boardFilmWindowFlags(), !released && !playersOnly, !playersOnly),
    state,
    manifestHold,
  );
}

/**
 * 影片窗口的四个位 —— `boardDrawState()` 与 `centerOnCurrentPlayer()` 的
 * **冻镜头**判据共用同一份（各写一套必然漂移：一边以为在放片、一边以为没放）。
 *
 * ★ W-52：镜头那一处**不能**改用 `boardDrawState()` 的人（`holdBackPlayers` 只按住
 *   `godInfo`，见 `centerOnCurrentPlayer` 里那段注释），但「窗口开没开」必须同源。
 */
function boardFilmWindowFlags(): BoardFilmWindow {
  return {
    buildPlaying: buildFx !== null,
    buildPending: pendingBuildFx !== null,
    filmPlaying: boardFilm !== null,
    filmPending: pendingBoardFilm !== null,
    // ★ 第八份 #8：狗咬 → 救护车之间那一拍也算窗口开着（见 `BoardFilmWindow.filmQueued`）
    filmQueued: pendingBoardFilmAfter !== null,
    // ★ 第十八份：附身影片的最后一帧钉着等开场白（见 `BoardFilmWindow.filmHeld`）
    filmHeld: heldGodFilm !== null,
    // ★ 第二十二份：新聞 18 / 19 白闪、重画之前（见 `BoardFilmWindow.newsFlash`）
    newsFlash: newsFlash !== null && deferredBoardBefore === newsFlash.before,
  };
}

function requestRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    // ★ 第十九份：本帧的绘制指令从这里开始记（见 `display-list.ts`）；上一帧若异常中断没收尾，先收掉
    if (displayList.inFrame && displayList.endFrame()) stageBlitOwed = true;
    // ★ 先调尺寸、再开始记本帧：高清舞台换倍率会改离屏画布的尺寸（清空 + 重置上下文），
    //   得在**帧外**做，指令表才能把状态对齐回来（`DisplayList.canvasResized`）
    resizeCanvas();
    displayList.beginFrame();
    // ★★ W-60：**刚回到棋盘**的那一帧把回合驱动重新叫起来（阻断级 bug 的唯一闸门）。
    //
    //   两条驱动的排程入口都有 `if (screen !== 'game') return;`（别在標題屏/過場里
    //   推进回合），而所有「回棋盘」的出口都只写 `screen = …; requestRender();` ——
    //   于是「走子途中开設定再关掉」会把链条**永久**断掉（棋子停在半路、GO 点不动）。
    //   判据收在 `driver-resume.ts`（纯函数 + 单测），**一处**判掉，不逐屏补
    //   （漏一个出口就又卡一次）。`resumeTurnDriver()` 内部两条驱动入口都会先清旧
    //   定时器，重复叫无害。
    //
    //   ⚠️ 位置必须在 `resizeCanvas()` 之后、**这一帧的绘制之前**：驱动起来要排在
    //      这一帧的 rAF 尾巴上（`schedule*` 用 `setTimeout`），绘制不该等它。
    // ★★ 审计 #15：过场的收场判据放在渲染链**之前** —— 先前它只写在下面 `screen === 'intro'`
    //   那一支里，整屏接管（訊息框 / 老虎机…）一开那一支就不跑，过场便永远收不了场。
    if (screen === 'intro' && introDone(introStartedAt, performance.now(), introSkipped, introCast())) endIntro();
    if (shouldResumeDriver(lastFrameScreen, screen)) resumeTurnDriver();
    lastFrameScreen = screen;
    // ★★ W-67-a：**訊息框收掉之后商店窗才开得起来** —— `syncShopUi()` 见到
    //   `blockingPresentation()`（董事長赠礼框还在台上）会先让开，而框自己收掉那一刻
    //   不会再派 action ⇒ 在这里每帧补一次机会。幂等：`shopUi` 已建就什么都不做。
    // ★★ 2026-09-22（第十一份試玩回報 #16「NPC走到百货公司时就不用触发语音了」）：
    //   这里先前**没有**人机闸（`notifyApplied` 那一处有），于是 NPC 的 `pending.shop`
    //   会被每帧这条补呼铺起来 ⇒ `syncShopUi` 内放 `midi07.mid` +
    //   `shopSay` 播招呼语音 `#0000 有什麼我能為你服務的嗎？`。
    //   原版 `_rich4_ui_shop_entry` 的 `0x0042ea32 cmp [who_plays],1 / jne 0x42ed8d`
    //   ⇒ 只有真人才开窗（訊息框与「董事長贈禮」台词在分流**之前**，NPC 说那句是对的，别动）。
    if (screen === 'game' && !aiVenuePending(state)) syncShopUi();
    syncClockOverlay();
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
    flushDeferredScreenEvents();
    let overlay = activeUiScreen();
    // ★★ 第十六份：排着等起播的几屏每帧也问一次闸（它们的 `tick` 只做「闸开了就起播」），
    //   不必等轮到自己当第一屏 —— 否则两屏都排着时，靠后的那一屏永远起不来（`overlay.ts`）。
    for (const s of pendingScreens(SCREENS, overlay, uiEnv())) s.tick?.(uiEnv());
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
    if (screen === 'game') tickPendingCardFlight();
    // ★ 本机选定的卡：亮牌收屏之后才走卡片函数那一段（选目标 / 发 `useCard`）
    if (screen === 'game') tickPendingCardRoute();
    // ★ 第十四份 #4：道具台词说完才开选择界面
    if (screen === 'game') tickPendingToolPicker();
    // ★ 20260925-153539948：建設公司「請選擇欲加蓋地點」框收掉才进点地图选地
    if (screen === 'game') tickBuildPick();
    // ★ 第十四份：飛機 / 飛碟那一段等台词与理賠框（`0x40d375` 里台词 → 理賠 → 影片）
    if (screen === 'game') tickPendingDisappearFx();
    // ★ 审计 #17：住进旅館 —— 落点例程的框 / 台词都收了才走进去
    if (screen === 'game') tickPendingRelocateWalk();
    if (screen === 'game') tickObjectFlight(performance.now());
    // ★ 第十四份 #5：機器娃娃等台词说完才上路
    if (screen === 'game') tickDollRelease();
    // ★ 神明升天（第十二份试玩回报 #1）：等前面的演出收摊才起，演完才放行回合驱动
    if (screen === 'game') tickGodAscend(performance.now());
    // ★ 第十三份試玩回報 #1：顯靈框收掉那一拍放开按住的等级 + 第二声音效（须在 `tickBuildFx` 之前）
    tickManifestHold();
    // ★ 第二十六份：电脑换车那一扇「使用%s」框收掉那一拍换图组
    tickVehicleHold();
    // ★ 建屋动效（機器工人）同理：两段时间轴没走完就再排一帧，走完就放掉位图
    if (screen === 'game') tickBuildFx(performance.now());
    // ★ 送進監獄／醫院那段影片同理（Q-ANIM-1）：按帧时序推进，播完补一次回合驱动
    if (screen === 'game') tickBoardFilm(performance.now());
    // ★ 第十五份：命運让出框之后，pass 1 那几段（影片 / 理賠框 / 台词）收了才开始数 800 ms
    if (screen === 'game' && eventBoxTailPending()) {
      eventBoxTailTick(
        boardFilm !== null ||
          pendingBoardFilm !== null ||
          pendingBoardFilmAfter !== null ||
          pendingDisappearFx !== null ||
          noticeBoxScreenActive() ||
          speechQueue.length > 0 ||
          heldSpeech.length > 0 ||
          !renderer.walkDone(),
        performance.now(),
      );
      requestRender();
    }
    // ★ W-69：過路費閃爍（纯表现）—— 认下 `state.lastTollLands`、到点收摊、没完就续帧
    if (screen === 'game') tickTollFlash(performance.now());
    // ★ 第二十二份：新聞 18 / 19 的白闪（排着等事件框 → 闪 → 重画 → 静置）
    if (screen === 'game') tickNewsFlash(performance.now());
    // ★ 原版会替玩家把系统指针挪到按钮上（试玩3 #2）：时机刚从关变开就挪一次
    cursorWarper.update();
    if (screen === 'game') shopTick(performance.now());
    // ★ 2026-09-23：保釋屏柜台人员的字框（醫院开屏招呼 / 監獄付不起）
    if (screen === 'game') bailTick(performance.now());
    // ★ 銀行两屏的动态部分（Q-BANK-1）：貸款屏的滑入/气泡 + ATM 键盘按下码的清除
    if (screen === 'game') bankTick(performance.now());
    // ★ 角色台词（T-052）：**不限定 `game` 屏** —— 语音在任何一屏都可能派出来
    //   （开局宣言、破產、勝利宣言…），队列的收尾不能因为屏幕上盖着别的东西就停住。
    speechTick(performance.now());
    // ★ D-MAGIC-16：魔法屋逐人分段 —— 上一段的框 / 影片 / 台词都收了才起下一段
    if (screen === 'game') tickMagicSequence();
    // ★ 软件指针（`soft-cursor.ts`）：此刻谁在接管、要不要本机作答 ⇒ 要哪一支 / 藏起
    //   （女巫窗口、七彩氣球 / 企鵝挖寶的准星、选目标、各屏专用那几支都从这一处出去）
    syncCursor();

    stageCtx.imageSmoothingEnabled = false;
    stageCtx.fillStyle = '#000';
    stageCtx.fillRect(0, 0, SCREEN_W, SCREEN_H);

    // ★ 2026-09-23：浮窗（訊息框等）要画在**它底下那一屏的最上面** —— 貸款屏（下面那段「銀行落点那两屏」）
    //   与股市屏也算。先前浮窗先画、貸款屏后画 ⇒ 貸款屏进门那扇「銀行暫停放款」（0x004351f8）被整屏盖掉；
    //   股市屏开着时浮窗底下画的是棋盘 ⇒「漲停無法買進！」（0x0042af23）落在棋盘上。
    let deferredOverlay: typeof overlay = null;
    if (overlay !== null) {
      // ★ 登记的整屏接管：棋盘、侧栏、工具栏一概不画（原版这些屏也是整屏窗口）
      // ★ 例外是**浮窗**（`windowed: true`，如大地圖彈窗）：原版只把被盖住的
      //   那一块盖上去，周围的棋盘/工具栏/侧栏照旧露着 —— 故先照常画一整帧。
      if (overlay.windowed === true && (screen === 'game' || screen === 'stock')) {
        if (screen === 'stock') {
          drawStockStage();
        } else {
          drawGameStage();
          // ★ 模态 ATM 窗在浮窗**底下**：銀行暫停放款时 ATM 窗 `0x401` 铺完面板才 `PostMessage(0x408)`
          //   弹「銀行暫停放款」訊息框（`0x00437123`）⇒ 框盖在 ATM 上。下面链尾那一句只在没有整屏接管时画 ATM。
          if (atm !== null) drawBankAtm(stageCtx, spriteNow, atm, bankFrozen(), atmCode);
        }
        deferredOverlay = overlay;
      } else {
        overlay.draw(uiEnv());
      }
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
        characters: introCast(),
        soundPlayed: introSoundPlayed,
      });
      // 收场判据在帧首（见 rAF 回调开头的 ★★ 审计 #15），这里只管续帧
      requestRender();
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
        if (displayList.endFrame()) stageBlitOwed = true;
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
      const m = aiModel;
      drawAiSettings(
        stageCtx, state, m?.rows ?? [],
        (archive, resource, index) => spriteNow(archive, resource, index, true),
        m?.sel ?? 0,
      );
    } else if (screen === 'lobby') {
      drawLobby(
        stageCtx,
        // ★ 第十一份試玩回報 #1：座位数 = 房间设的**总人数**（不足由电脑补位，
        //   服务器 `#start` 负责）。画几格就按几格，别永远画四个。
        lobbySlots(lobbyRoom, net?.seat ?? null, roomOptions(lobbyRoom).seatCount),
        net?.seat ?? null,
        lobbyIsHost(lobbyRoom, net?.seat ?? null),
        lobbyRoom?.started ?? false,
        lobbyHot,
        (archive, resource, index) => spriteNow(archive, resource, index),
        (t) => stageCtx.measureText(t).width,
        // ★ Q-NET-2：房间地图也来自服务器快照（缺省 0 兼容旧快照）
        roomMapId(lobbyRoom),
        // ★★ 第十一份試玩回報 #1：開局設定六行也来自服务器快照（缺省补全，兼容旧快照）
        roomOptions(lobbyRoom),
        // ★ 聯機存檔（v6）：存檔房的鎖定與「這是我 / 離座」
        lobbyRoom,
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
      drawStockStage();
    } else {
      drawGameStage();
    }

    // 銀行落点那两屏（T-029）：貸款屏先铺（整屏 640×480），ATM 是模態的盖它上面；
    // 若填数页开着，再把棋盘那块（对话框在上面）贴回来 —— 原版的填数页也是
    // 盖在银行屏上的（`fcn_00453544` 那一声调用就在贷款屏的状态机里）。
    // ★★ 2026-09-22（第十一份試玩回報 #18「NPC踩到银行上时就不用一闪而过银行内部的页面了」）：
    //   原版 `_rich4_ui_bank_entry` 的 `0x004366a3 cmp byte [player+0x15],1 / jne 0x4367ab`
    //   ⇒ 电脑那一支**直接借款、全程不画屏**。先前这里只看 `pending.kind === 'bank'`，
    //   于是 NPC 的银行 pending 期间整张银行内页被画出来（玩家看到的就是「一闪而过」）。
    const bank = isAiTurn(state) ? null : bankPending();
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
      // Q-BANK-1：两块**滑入面板**从右边横着滑进来 —— 玩家面板 200×280 @(x,0)、
      // 日期面板 200×200 @(x,280)，x = `[0x48c3d5]`（640 → 440）@source fcn_00435062 0x435552 / 0x43557c。
      if (loanUi !== null) {
        // 店員那句话（气泡底图 = 资源 23 图 21，锚点落 (240,80)）@source fcn_00434186
        // ★ 与面板谁在上 = 原版谁后画（`LoanUi.bubbleOnTop`：换句 → 气泡在上；滑动那几拍 → 面板在上）
        const bubbleText = loanUi.bubble?.text ?? null;
        if (bubbleText !== null && !loanUi.bubbleOnTop) drawLoanBubble(stageCtx, spriteNow, bubbleText);
        drawLoanPanels(stageCtx, spriteNow, loanPanelView(loanUi));
        // EXIT 的按下图（图 19）—— 四颗钮里只有它有 @source loc_00435cca
        drawLoanPressed(stageCtx, spriteNow, loanUi.pressed, {
          x0: LOAN_BUTTONS[LOAN_EXIT]!.x0,
          y0: LOAN_BUTTONS[LOAN_EXIT]!.y0,
        });
        if (bubbleText !== null && loanUi.bubbleOnTop) drawLoanBubble(stageCtx, spriteNow, bubbleText);
      }
    }
    // ── 还款提醒窗（`0x436034`）：`0x434186(0)` 的店員室（非董事長那一支，冻结时盖章）+ 两块面板
    //   **直接贴在到位处**（`0x004360f6` (0x1b8, 0) / `0x00436115` (0x1b8, 0x118)，即 x = 440，不滑入）+ 店員的气泡 ──
    if (reminderUi !== null) {
      drawBankLoan(stageCtx, spriteNow, { chairman: false, frozen: bankFrozen(), subDialog: false, finance: null, blink: null });
      drawLoanPanels(stageCtx, spriteNow, loanPanelView({ slide: { x: LOAN_SLIDE.shown, dx: 0 } }));
      if (reminderUi.text !== null) drawLoanBubble(stageCtx, spriteNow, reminderUi.text);
    }
    if (atm !== null && overlay === null) drawBankAtm(stageCtx, spriteNow, atm, bankFrozen(), atmCode);
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
    // 浮窗压在最上面（见上面 `deferredOverlay` 那条注释）
    if (deferredOverlay !== null) deferredOverlay.draw(uiEnv());

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
        // `uiSprite` 的静态类型（`gameui.ts` 的 `SpriteFn`）只列了 Data/Panel 两个档案，
        // 而台词还要取 `map.mkf` 的头像（W-50）—— 运行时本来就是同一个 `spriteNow`。
        drawSpeechBubble(bubble, {
          ctx: stageCtx,
          sprite: uiSprite as unknown as BubbleSpriteFn,
          font,
        });
        stageCtx.restore();
      }
      watchSpeechBoxOverlap(bubble !== null);
    }

    // ── 屏幕提示条（`toast.ts`）──
    // ★ 画在**最上面**：整屏接管、模态窗、台词之后。原版没有这东西，是需求方
    //   明确要求的非叙事提示（F9 回报的落盘确认），所以不必与哪一屏对齐。
    drawToast(stageCtx, toast, performance.now(), SCREEN_W, SCREEN_H);

    // 指针图要**解码完才能画**（`Data.mkf` #0）；到货那一帧补一次（上面那次可能还没图）
    if (spriteArrived) syncCursor();

    // ★ 第十九份：指令表与上一帧相同 ⇒ 舞台一个像素都没变，不贴屏（手机上省掉一整屏的合成提交）
    if (displayList.endFrame() || stageBlitOwed) {
      stageBlitOwed = false;
      blitStage();
    }
    // 触屏「取消」钮：放在这一帧**画完之后**判 —— 本帧的 `tick` 可能刚把某一屏收掉
    syncTouchCancel();

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
      reminderUi !== null ||
      atmCode !== null ||
      speechQueue.length > 0 ||
      // ★ 押在 `heldSpeech` 里的那几句也要续帧 —— 框 / 演出收屏那一拍就靠它
      //   把台词放上台（否则要等下一次 action，台词就永远不上台了）
      heldSpeech.length > 0 ||
      // ★ 機器娃娃**打飞**的物件还在飞 ⇒ 接着要帧（它与替身补间不同寿：
      //   娃娃走完那几拍若没有别的演出，就没人再要帧了，最后几拍会冻在屏上）
      renderer.sweptFlightActive() ||
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
/** 台上换过几句（演出看门狗认「有没有进展」用）*/
let speechSerial = 0;
/** 填数页：鼠标键此刻是不是**按在金额栏上**没松（= 原版 `[0x48cac2] == 0x10`）*/
let amountBarHeld = false;

/**
 * 此刻开着的填数窗的上限（金额栏按比例算值要用）；`null` = 没开。
 * 棋盘上的填数页挂在 `currentDialog()` 那一项上；股市屏那一扇挂在 `stockAmountUi()` 上
 * （`currentDialog()` 只在 `screen === 'game'` 时有）。
 */
function amountBarMax(): number | null {
  if (amountPage === null) return null;
  const ui = screen === 'stock' ? stockAmountUi() : currentDialog();
  return ui?.choices[amountPage.choice]?.amount?.max ?? null;
}

/**
 * 按住金额栏拖动（`WM_MOUSEMOVE`）→ 改值。坐标是**舞台坐标**（`AMOUNT_WINDOW` 就是舞台坐标，
 * 画的时候才经 `boardRect` 换成棋盘坐标）。
 *
 * ★ 2026-09-24 订正：先前这里（与 `mousedown` 那一拍）传的是 `p − LAYOUT.board`（棋盘坐标）⇒
 *   命中区比画出来的栏**低 40px**（落在 MAX/↵ 与 C/0/← 两行之间的缝上），按在栏上拖**不改值**；
 *   股市屏那一扇则因为 `currentDialog()` 为 `null`、且股市分支提前 return，**完全拖不动**。
 */
function dragAmountBar(p: { x: number; y: number }): void {
  if (amountPage === null) amountBarHeld = false;
  // ★ 按在拖窗把手（id 1）上：窗跟着光标走（`0x0045320b` 的 `cmp dh,1` 那一支，先于金额栏那一支）
  if (amountPage !== null && amountPress.drag(p)) {
    requestRender();
    return;
  }
  if (amountPage === null || !amountBarHeld) return;
  const max = amountBarMax();
  if (max === null) return;
  const next = amountBarDragValue(p.x, p.y, max);
  if (next !== null) {
    amountPage = { ...amountPage, value: next };
    sound.play('Effect.mkf', AMOUNT_BAR_DRAG_SOUND);
    requestRender();
  }
}

/**
 * ★★ 第七份试玩回报 #3：角色开口说话时，镜头切到**他**身上。
 *
 * @source `_rich4_player_say`（VA 0x0044ef41）画气泡之前：
 * ```asm
 * 0044ef63  test byte [esp+0x25], 0x80 / je    ; 第 1 实参的 0x8000 位 = 「不重設視窗捲動」
 * 0044ef6a  xor edx, edx                        ;   置了 ⇒ 不切镜头（開局宣言 `0x0040794e or ah,0x80`）
 * 0044efa0  test edx, edx / je 0x44efc5
 * 0044efa8  dx = [player + 0x0a] ; ax = [player + 0x08]   ; 说话人的**像素**位置
 * 0044efbd  call 0x41d476                        ; ★ view_to(x, y, 0)
 * ```
 * 落法与 W-54 的 `syncViewTarget` 同一套：落成标记、立刻居中、`viewTargetActive` 让演出收摊后自动撤掉
 * （= 原版随后的 `refresh_screen`），镜头回到行动者。
 */
const OPENING_SPEECH_EVENT = 26;
function viewToSpeaker(bubble: SpeechBubble): void {
  if (screen !== 'game') return;
  if (bubble.cardId === undefined && bubble.event === OPENING_SPEECH_EVENT) return;
  const who = state.players[bubble.player];
  if (who === undefined) return;
  const at = playerAnchorWorld(who);
  if (at === null) return;
  minimapMarker = { x: at.x, y: at.y };
  viewTargetActive = true;
  camera = pixelCamera(at.x, at.y, camera.view);
}

/**
 * ★★ 第十六份（线上卡死 `20260923-234517253`）：**演出死锁看门狗**。
 *
 * 判据：台上有东西在排 / 押（押着的台词、排着的框 / 屏、排着的影片 / 建屋片 / 飞行…），
 * 而整条演出链的**签名**（谁开着、各段起播时刻、台上换过几句、局面进度）`PRESENTATION_STALL_MS`
 * 都没变过 —— 能自己走完的东西（訊息框 ≤ 2 s、一句台词 ≤ 语音 + 1 s、影片几秒）早该变了。
 * 等人点的屏（月结 / 開獎 / 分紅 / 魔法屋 / 轉盤 / 老虎机…开着时）不算。
 *
 * 发现就**按 exe 的先后强行放行**并记 `⚠ 演出死锁自解`、自动落一份 stall 回报（一局一次）：
 *   第一级：各演出屏落到终态（`fastForward`，与联机「跟着行动者收场」同一条路），押着的台词按档放上台；
 *   第二级（再停滞一轮）：排着的影片 / 建屋片 / 飞行 / 升天 / 神明台词窗一并作废。
 */
const PRESENTATION_STALL_MS = 15_000;
/** 开着时是在等人点一下的屏 —— 停多久都不算死锁 */
const HUMAN_PACED_SCREENS: ReadonlySet<string> = new Set([
  'shares', 'lottery-draw', 'monthly', 'magic', 'wheel', 'god-slot', 'auction', 'lottery', 'research', 'minigame',
]);
let presentationStallKey = '';
let presentationStallSince = 0;
let presentationUnwindLevel = 0;
let presentationStallReported = false;

/** 有没有东西在排 / 押着等（没有就不计时）*/
function presentationWaiting(): boolean {
  const env = uiEnv();
  return (
    heldSpeech.length > 0 ||
    deferredScreenEvents.length > 0 ||
    SCREENS.some((s) => s.active(env) && s.pendingOnly?.(env) === true) ||
    pendingBoardFilm !== null ||
    pendingBoardFilmAfter !== null ||
    pendingBuildFx !== null ||
    buildFxSeamHeld ||
    pendingGodLine !== null ||
    pendingCardFlight !== null ||
    objectFlightAwaitsSpeech ||
    dollWalkHeld ||
    pendingDisappearFx !== null ||
    pendingRelocateWalk !== null ||
    (godAscend !== null && godAscend.start === null)
  );
}

/** 演出链此刻的签名：任何一段在走，它都会变 */
function presentationSignature(): string {
  const env = uiEnv();
  const screens = SCREENS.filter((s) => s.active(env)).map((s) => `${s.id}${s.pendingOnly?.(env) === true ? '?' : ''}`);
  const n = noticeBoxScreenState();
  return [
    screens.join(','),
    `h${heldSpeech.length}`,
    `q${speechQueue.length}:${speechSerial}`,
    `n${n.queued}:${n.playback?.at ?? '-'}`,
    `f${boardFilm?.startedAt ?? '-'}:${pendingBoardFilm !== null ? 1 : 0}${pendingBoardFilmAfter !== null ? 1 : 0}`,
    `b${buildFx?.clip ?? '-'}:${buildFx?.startedAt ?? '-'}:${pendingBuildFx !== null ? 1 : 0}${buildFxSeamHeld ? 1 : 0}`,
    `a${godAscend?.start ?? (godAscend === null ? '-' : 'q')}`,
    `g${godLine?.at ?? '-'}:${pendingGodLine !== null ? 1 : 0}`,
    `o${objectFlight?.start ?? '-'}:${pendingCardFlight !== null ? 1 : 0}`,
    `d${deferredScreenEvents.length}`,
    `w${renderer.walkDone() ? 1 : 0}`,
    `${state.turnCount}:${state.phase}:${state.currentPlayer}:${history.length}`,
  ].join('|');
}

/** 每秒一次（`setInterval`，不靠渲染循环 —— 卡死时没人再要帧）*/
function watchPresentationDeadlock(now: number): void {
  // ★ 第十九份：后台时演出冻住是浏览器停了 rAF，不是死锁 —— 不计时（回前台从零数起）
  if (pageHidden || screen !== 'game' || !presentationWaiting()) {
    presentationStallKey = '';
    presentationUnwindLevel = 0;
    return;
  }
  const overlay = activeUiScreen();
  if (overlay !== null && overlay.pendingOnly?.(uiEnv()) !== true && HUMAN_PACED_SCREENS.has(overlay.id)) {
    presentationStallKey = '';
    return;
  }
  const key = presentationSignature();
  if (key !== presentationStallKey) {
    presentationStallKey = key;
    presentationStallSince = now;
    return;
  }
  if (now - presentationStallSince < PRESENTATION_STALL_MS) return;
  presentationUnwindLevel++;
  presentationStats.unwinds++;
  const message = `⚠ 演出死锁自解（第 ${presentationUnwindLevel} 级，${PRESENTATION_STALL_MS / 1000} 秒无进展）：${key}`;
  log(message);
  hostLog(`[stall] ${message}`);
  unwindPresentations(presentationUnwindLevel);
  presentationStallKey = '';
  if (!presentationStallReported) {
    presentationStallReported = true;
    recorder.error({ t: Date.now(), kind: 'stall', message, stack: null });
    fileReport('stall', message);
  }
  requestRender();
  resumeTurnDriver();
}

/** 按 exe 的先后强行放行（见 `watchPresentationDeadlock`）*/
function unwindPresentations(level: number): void {
  // 第一级：演出屏落到终态（含排着没起播的），推日期那几屏的派发作废，押着的台词按档上台
  followPresenter();
  deferredScreenEvents.length = 0;
  pendingGodLine = null;
  godLine = null;
  if (heldSpeech.length > 0) {
    const lines = heldSpeech.map((h) => h.bubble);
    heldSpeech = [];
    speechQueue.push(lines, performance.now());
  }
  if (level < 2) return;
  // 第二级：影片 / 建屋片 / 飞行 / 升天一并作废
  pendingBoardFilm = null;
  pendingBoardFilmAfter = null;
  boardFilm = null;
  releaseHeldGodFilm();
  pendingBuildFx = null;
  buildFx = null;
  buildFxSeamHeld = false;
  godAscend = null;
  pendingCardFlight = null;
  pendingDisappearFx = null;
  // 住进旅館那一段：直接起步（它不等任何人，只是排在框 / 台词后面）
  if (pendingRelocateWalk !== null) {
    const t = pendingRelocateWalk;
    pendingRelocateWalk = null;
    beginTween(t);
  }
  if (objectFlight !== null) finishObjectFlight();
  objectFlightAwaitsSpeech = false;
  if (dollWalkHeld) {
    dollWalkHeld = false;
    renderer.releaseActorWalks(performance.now());
  }
}

/**
 * ★ 第十五份：**运行时自检** —— 气泡与框同屏（原版不可能：两边都是阻塞调用）就记一行日志。
 *   每一段只记一次（进入同屏那一拍）。日志会进试玩回报的 `env.log`，下次漏网能直接定位。
 */
let speechBoxOverlap = false;
function watchSpeechBoxOverlap(bubbleUp: boolean): void {
  const both = bubbleUp && presentationHost.boxShowing();
  if (both && !speechBoxOverlap) {
    const overlay = activeUiScreen();
    log(`⚠ 台詞氣泡與框同屏（${overlay?.id ?? (godLine !== null ? 'godLine' : '?')}）`);
  }
  speechBoxOverlap = both;
}

function speechTick(now: number): void {
  // ★★ 演出还在演 → **`afterStage`** 的台词不上台；演出收摊那一刻才把押着的那几句放上来。
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
  //   ⇒ 原版**必定**是「轉盤停 → 訊息框 → 付款人的台詞」。
  //   本引擎把 consequences 一次写完、演出是事后补的，所以那几句台词先被
  //   `queueSpeech()` 押在 `heldSpeech` 里（判据见那里）——这里每帧问一次
  //   「框 / 演出收了没有」（`releaseHeldSpeech` → `lineMayEnter`），收了才放上台，
  //   等于把「同步演出」的语义补回来（试玩回报：「盘子还没停下来 NPC 的台词都触发了」；
  //   第十五份：「台词和棕色对话框又重叠了」）。
  //
  //   ★★ W-51 **死锁自查**：这里只挡**押后的那几句**的放行，**不挡队列本身**。
  //      队列里可能正躺着 `beforeStage`（壞神附身 / 回合开始那三句）的句子，而
  //      影片正等着它说完才起播（`tickBoardFilm` 的 `filmWaitsForSpeech`）——
  //      若这里连 `speechQueue.tick` 一起冻住，两边就永远互等。
  //      `stage-gate.test.ts` 有一条 2 秒内必须都走完的用例，另有一条把这条规则
  //      改坏后**必须走不完**的反例。
  //
  //   ⚠️ 押在**入队之前**而不是「冻结队列再解冻」：`SpeechQueue` 的时间基准是
  //      绝对时刻（`shownAt`），冻结再解冻会把整段演出时长算进那 1000 ms 里，
  //      那一段台词就一闪而过。
  releaseHeldSpeech(now);
  if (speechQueue.tick(now)) requestRender();
  const cur = speechQueue.current();
  if (cur === spokenBubble) return;
  // 换段了（含「从无到有」与「清空」）
  spokenBubble = cur;
  speechSerial++;
  if (cur !== null) viewToSpeaker(cur);
  if (cur === null || cur.voice === null) return;
  // ★★ 第二十六份 panel：同一路语音 —— 起这一句就停掉正在响的上一句（`0x45441a` → `0x454493`）
  voiceChannel.play(cur.voice);
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
  if (!shopBubbleExpired(ui.bubble, ui.closing, now, voiceBusy())) return;
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
    drawDiceFlic(ctx, flic, currentScreenDir(), diceFx.flicSize());
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
/**
 * 走子时那串**剩余步数**的大数字（W-66-a）—— 规格/判据全在 `steps-counter.ts`。
 *
 * @source 棋盘绘制例程 `0x00409937..0x004099fb`：值 = `[0x48baf8]`（还没走完的格数，
 *   走完一格才减 1），图 = `Data.mkf #0x205` 图 `8 + 数字`，落点（**屏幕**）
 *   第 k 位 = `(245 − 25×位数 + 50×k, 400)`，带透明（`fcn_00456418` ⇒ 减图自带锚点）。
 *
 * ⚠️ 判断「值 > 0 / 不关押 / 不是被挪」四道闸都在 `stepsCounterShown` 里；
 *   这里**只看**补间在不在跑（`renderer.walkDone()`），**不看 `phase`** ——
 *   最后一格补间期间 `phase` 已经是 `'settling'`。
 */
function drawStepsCounter(now: number): void {
  // ★ E-22：替身（四大惡人 / 機器娃娃）在走 ⇒ 画**他**的剩余步数，且**不看**玩家那两道闸
  //   @source `0x00409951 cmp eax,4 / jge 直接画`
  const actorLeft = renderer.actorStepsLeft(now);
  let value = actorLeft;
  if (actorLeft === 0) {
    const me = state.players[state.currentPlayer];
    if (me === undefined) return;
    // ⚠️ 只看**玩家自己**那条补间 —— `walkDone()` 含替身，拿它补 1 会在替身走子时凭空画出个「1」
    value = stepsCounterValue(state.stepsRemaining, !renderer.playerWalkDone(now));
    if (!stepsCounterShown(value, me)) return;
  }
  for (const d of stepsCounterPlan(value)) {
    const img = spriteNow(STEPS_COUNTER_ARCHIVE, STEPS_COUNTER_RESOURCE, d.image, true);
    if (img === null) continue;
    // 屏幕坐标 → 棋盘画布（减棋盘原点），再减图自带的锚点（数字的锚点在中心）
    drawSprite(
      boardCtx,
      img,
      d.x - img.anchorX - LAYOUT.board.x,
      d.y - img.anchorY - LAYOUT.board.y,
    );
  }
}

function drawGameStage(): void {
  // ★ 百貨公司是**整屏**的一屏，不等于在棋盘上盖个框 —— 它一开，棋盘就不画了。
  if (shopUi !== null && currentDialog() !== null) {
    drawShopStage();
    return;
  }
  // ★ 監獄／醫院保釋屏同样是整屏（T-038）—— 棋盘、侧栏全不画（答完之后的收尾也照画这一屏）
  if (screen === 'game' && bailScreenOn()) {
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
  // ★★ W-54：远处生效的卡/道具/事件把镜头切过去（`view_to` 的**移动**那一支）
  syncViewTarget();
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
    // ★ 掷骰姿画第几帧：预动作 0 → N−1，滚骰 + 定格定在 N−1（空手）—— 第十四份试玩回报 #3
    characterPoseFrame: diceFx.poseFrame(performance.now()),
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
    // ★ 神明升天（`god_detach` 0x40e32c）—— 起播之后才交给渲染器（之前那尊还画在主人身上）
    godAscend:
      godAscend !== null && godAscend.start !== null
        ? {
            state: godAscend.before,
            objectIndex: godAscend.cue.objectIndex,
            elapsed: performance.now() - godAscend.start,
          }
        : null,
    // 機器工人（9）的原地建屋影片（Q-TOOL-6）—— 两段 FLIC 合起来 440×440
    // 盖在棋盘左上角，**不进绘制槽**、也没有自己的落点（落点是常数）。
    buildFx: currentBuildFxBitmap(performance.now()),
    // ★ 「盖在棋盘上的阻塞影片」（Q-ANIM-1）—— 落点/尺寸随哪一段变
    //   （住院 440×74 @(0,210)，入獄/神明 440×440 @(0,40)），所以整份交出去。
    boardFilm: currentBoardFilmFrame(performance.now()),
    // ★ W-69：過路費閃爍 —— 把算进这笔钱的每一块地这一帧调亮（原版是 id 图上逐像素加）
    landFlash: tollFlashInput(performance.now()),
  });
  // ★★ W-66-a：走子时那串**剩余步数**（原版有、本引擎先前没有）——
  //   画在棋盘画布上、对话框/名牌之下（原版就是在棋盘绘制例程里画的）。
  drawStepsCounter(performance.now());
  // ★ 神明开场白：写在棋盘下缘（影片收屏之后、效果之前；`god-line.ts`）
  tickGodLine(performance.now());
  drawGodLine(boardCtx);
  const dlg = currentDialog();
  const me = state.players[state.currentPlayer];
  if (dlg !== null) {
    // 填数窗（`fcn_00453544`）是另开的一扇窗、**可拖到棋盘外**（工具列 / 側欄上）⇒ 不画进棋盘画布，
    //   等工具列与側欄都画完再盖到舞台上（见本函数末尾）
    if (amountPage === null) drawDialog(boardCtx, uiSprite, dlg, amountPage, dialogHot);
  } else if (diceFx.active) {
    // ★ 掷骰那一段（Q-TURN-1 §3/§4）：滚骰是 `Panel.mkf` 4/5/6 的 **FLIC**，
    //   滚完再把 `Panel.mkf` 3 的点数图盖上去定格 500 ms。
    drawDiceFx(boardCtx, performance.now());
  } else if (awaitingHumanRoll() && me !== undefined) {
    // ★ 原版的 GO 鈕 + 骰子数切换（Panel.mkf 资源 7）。
    //   位置是**可拖的**（Q-UI-6），存在 `goButton` 里（= 原版 `[0x475284]/[0x475288]`）
    drawAdvance(
      boardCtx,
      uiSprite,
      goImageOf(me),
      maxDiceOf(me),
      me.ndices,
      goButton.position(),
      me.trafficMethod & 3,
      me.blocking.stopping !== 0,
    );
  }
  // ★★ 2026-09-22（第十一份回报 #2「人物扔完骰子开始行动时骰子应该就消失了」）：
  //   这里先前还有一条 `else if (state.phase === 'moving' && state.dice.length > 0)
  //   drawDice(...)` —— **走子的每一帧都把点数图重画一遍**（`state.dice` 要到回合结束
  //   才清，见 `core/reduce.ts` 换人那两处），于是骰子在角色开始行动之后仍然留在屏上。
  //   原版全 exe 只有**一个**把点数图（`Panel.mkf` #3，指针 `[0x48be14]`）画出去的地方：
  //   `rich4.asm:12363`，就在 `fcn_00419572` 内部；走到走子状态（state 1）的那一 tick
  //   同一张后台面就被 `fcn_0040829d` 全量重画覆盖 ⇒ **骰子当場消失**，从不再画。
  //   ⇒ 删掉这条分支即可（`dice-roll.ts` 那三段与 500 ms 定格由 `drawDiceFx` 照旧负责）。
  // ── 名牌浮标（Q-HOVER-1）：原版画在棋盘面上、訊息框那类**独立窗口**之下 ──
  if (nodeTip !== null && dlg === null) {
    drawTip(boardCtx, spriteNow(TIP_ARCHIVE, TIP_RESOURCE, nodeTip.image, true), nodeTip);
  }
  drawSurface(stageCtx, boardCanvas, LAYOUT.board.x, LAYOUT.board.y, LAYOUT.board.w, LAYOUT.board.h, surfaceScale);

  // 工具栏画在棋盘上方（直接画到舞台上）
  renderer.drawToolbarTo(stageCtx, LAYOUT.toolbar.x, LAYOUT.toolbar.y, hotTool);

  // ★ D-MAGIC-16：`0x41906a(1)` 重画主窗口时侧栏跟着「当前玩家」= 那位中签者
  const hudState = magicShownState();
  // ★ 替身那一趟：小地图白框框它（补间在走的那几格，VA 0x00416f3d）
  const npcWalk = renderer.npcWalkWorld(performance.now());
  // ★★ 第二十六份 panel：侧栏画「上一次整窗重画时的行动者」—— 换人那次重画（`0x436a5a`）之前 / 距还款日 > 3 天时仍是上一位
  const panelPlayer = panelPlayerOf(hudState);
  hud.draw({
    // ★ 降落伞那一段期间小地图上也先没有他（`0x00416fc9 cmp [player+0x08], 0`，坐标播完才写）
    state: withLandingHidden(hudState),
    map,
    camera,
    minimapBg,
    windowView: options.windowView,
    calendarPage: calendarPageOf(options),
    minimapMarker,
    // ★ 替身那一趟小地图白框框替身（`hud.ts` 的 `minimapFrameCenter`，VA 0x00416f3d）
    npcFrame: npcWalk,
    // ★★ 第二十六份 panel #1：侧栏换成惡人那一版 = 行动者 `[0x49910c]` 是他的整个回合（VA 0x00415fc1 / 0x00416767；
    //   回合开头 0x00418d69 那次整窗重画起、到下一位行动者那次重画止）——
    //   含走完之后的訊息框 / 台词、停留不走的那一回合；取 core 的 `lastNpcTurn`（见 `hud.ts` 的 `panelActorSlot`）
    npcSlot: panelActorSlot(hudState),
    panelPlayer,
    pressedMinimapArrow,
    hotMinimapArrow,
    holidayArt,
    panelPage: panelPages[panelPlayer] ?? 0,
    panelRows: panelRows(hudState, topo, panelPlayer, panelPages[panelPlayer] ?? 0),
  });
  drawSurface(stageCtx, hudCanvasOff, LAYOUT.panel.x, LAYOUT.panel.y, LAYOUT.panel.w, SCREEN_H, surfaceScale);
  // 填数窗盖在最上面（它是另开的窗，拖到哪画到哪）
  if (dlg !== null && amountPage !== null) drawAmountDialogOnStage(dlg);
}

/** 把填数页画到**舞台**上（照棋盘坐标排版，整体平移过去 —— 与股市 / 銀行那两处同一个做法）*/
function drawAmountDialogOnStage(ui: InteractionUi): void {
  stageCtx.save();
  stageCtx.translate(LAYOUT.board.x, LAYOUT.board.y);
  drawDialog(stageCtx, uiSprite, ui, amountPage, dialogHot);
  stageCtx.restore();
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
  if (bg !== null) drawSprite(stageCtx, bg, 0, 0, SCREEN_W, SCREEN_H);
  else {
    stageCtx.fillStyle = '#1a1d24';
    stageCtx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  }
  boardCtx.clearRect(0, 0, LAYOUT.board.w, LAYOUT.board.h);
  if (amountPage === null) drawDialog(boardCtx, uiSprite, ui, amountPage, dialogHot);
  drawSurface(stageCtx, boardCanvas, LAYOUT.board.x, LAYOUT.board.y, LAYOUT.board.w, LAYOUT.board.h, surfaceScale);
  if (amountPage !== null) drawAmountDialogOnStage(ui);
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

  // 老板娘的动画机每 100 ms 走一拍；这一拍贴的叠进「此刻留着的」—— 画的是后者（每帧都画，不再只闪一帧）。
  // 原版用 `_libc_rand`；这一处纯装饰，不进确定性状态，所以用 `Math.random`。
  // 嘴只在说话（气泡挂着）时动 @source 0x0042dc36 `call 0x44ef3b`
  ui.keeper = keeperPaintAfter(ui.keeper, blinkStep(ui.blink, ui.page, performance.now(), Math.random, ui.bubble !== null));
  stageCtx.fillStyle = '#000';
  stageCtx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  drawShopScreen(stageCtx, spriteNow, {
    page: ui.page,
    panelX: ui.slide.panelX,
    gridX: ui.slide.gridX,
    points: me.points,
    shelf: shopRows(ui.page, pending, ui.page === SHOP_PAGE.cards ? ui.bought.cards : ui.bought.tools),
    cells:
      ui.page === SHOP_PAGE.cards
        ? cardEntries(state, state.currentPlayer)
        : toolEntries(state, state.currentPlayer),
    bubble: ui.bubble === null ? null : ui.bubble.text,
    pressed: ui.pressed,
    pressedCell: ui.pressedCell,
    keeper: ui.keeper,
  });
}

/** 舞台 → 窗口：整数倍放大、居中、不插值 */
/**
 * 画布四周的黑边铺过了（画布尺寸不变就一直在）。
 *
 * ★ 第十九份：先前每帧 `fillRect` 整块画布（手机横屏 2250×1026 ≈ 230 万像素）再贴舞台，
 *   而黑边一辈子不变 —— 改成尺寸变了才整块铺一次，平时只铺舞台那一块（向外多取一像素，
 *   小数倍放大时边缘那一列的混色与先前完全一样：都是「先黑、再贴」）。
 */
let letterboxFilled = false;

function blitStage(): void {
  const m = currentMetrics();
  // ★ 高清舞台下舞台已是 `surfaceScale`（= 窗口倍数）倍像素：这一下是 1:1 拷贝，不插值。
  //   只有触屏封了顶（`hdScaleCap`，舞台比窗口小）时是放大 —— 那一下要平滑，否则字边一格宽一格窄。
  //   关着高清（倍率 1）仍是原来的最近邻整窗放大。
  ctx.imageSmoothingEnabled = surfaceScale !== 1 && Math.abs(surfaceScale - m.scale) > 1e-6;
  ctx.fillStyle = '#000';
  const w = SCREEN_W * m.scale;
  const h = SCREEN_H * m.scale;
  if (letterboxFilled) ctx.fillRect(m.offsetX, m.offsetY, Math.ceil(w) + 1, Math.ceil(h) + 1);
  else ctx.fillRect(0, 0, canvas.width, canvas.height);
  letterboxFilled = true;
  ctx.drawImage(stage, m.offsetX, m.offsetY, w, h);
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

// ============================================================
//  软件指针（gap-audit WP-1：#5 #8 #9 #10）—— 判据与出处全在 `soft-cursor.ts`
// ============================================================
//
//  原版的指针是自己画的（`Data.mkf` #0、20 ms 一拍、热点 = 贴图锚点），开局就把系统指针藏了。
//  这里只把「此刻谁在接管、哪几扇作答窗开着」现取出来交给 `resolveCursor`，画由那一层自己画。

/** 盖在 `#board` 上的那一层（仅本机；触屏不画，小游戏准星例外）*/
const softCursor = createSoftCursorLayer({
  board: canvas,
  sprite: (image) => spriteNow(CURSOR_ARCHIVE, CURSOR_RESOURCE, image, true),
  toStage: (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    const dpr = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
    return toStage((clientX - r.left) * dpr, (clientY - r.top) * dpr, currentMetrics());
  },
  metrics: currentMetrics,
  now: () => performance.now(),
});

/** `resolveCursor` 要看的那几项（现取）*/
function cursorFrame(): CursorFrame {
  const onBoard = screen === 'game' || screen === 'stock';
  const overlay = onBoard ? activeUiScreen() : null;
  const dlg = currentDialog();
  // 棋盘上几扇整屏 / 浮窗的作答窗（商店、銀行貸款、还款提醒、監獄/醫院）：只给本机真人的回合放
  //   @source 商店 0x0042dc08、銀行 0x0043479a / 0x004356db / 0x00435e98、監獄/醫院 0x0043cb5a / 0x0043daf0
  const localHuman = screen === 'game' && localSeatActive() && !isAiTurn(state);
  return {
    screen,
    overlay: overlay === null ? undefined : (overlay.cursor?.(uiEnv()) ?? null),
    pick: screen === 'game' ? pickCursorShape() : null,
    dicePick: screen === 'game' && dicePick !== null,
    stockPick: stockPick !== null,
    // 通用填数窗（`fcn_00453544`）：棋盘 / 銀行里挂在 `currentDialog()` 上，股市屏里挂在 `stockAmount` 上
    amountWindow: amountPage !== null && (screen === 'stock' ? stockAmount !== null : dlg !== null),
    atm: screen === 'game' && atm !== null,
    localInput:
      dlg !== null ||
      (localHuman && (shopUi !== null || loanUi !== null || reminderUi !== null || bailScreenOn())) ||
      // 终局：勝利畫面放出箭头（@source 0x0041de1d `fcn_00402460(1)`）
      (screen === 'game' && state.phase === 'gameOver'),
    // 轮到本机真人、GO 鈕在场（按下去骰子一滚就收起：0x004182de）
    goPhase: awaitingHumanRoll() && !diceFx.active,
    // 联机里别的座位的回合 ⇒ 放出箭头（D-CURSOR-ONLINE-1，需求方要求的有意偏离；单机恒 false）
    spectator: !localSeatActive(),
  };
}

/** 此刻要哪一支指针（`null` = 藏起）*/
function cursorWant(): CursorWant {
  return resolveCursor(cursorFrame());
}

/** 按当前状态重算一次指针（每帧一次；拾取状态变了也当场叫一次）*/
function syncCursor(): void {
  softCursor.update(cursorWant());
}

/**
 * 把镜头对到当前行动者身上 —— **逐像素**，不是逐格。
 *
 * ★★ 第五份回报第 1 条「镜头一跳一跳」的根因：原版的镜头中心**恒是一对像素坐标**
 *   （`[0x48b2ac]` / `[0x48b2b0]`）。`fcn_00415e70`（VA 0x00415e70）取行动者的
 *   `player+0x08/+0x0a`（替身 `0x498de8 + slot*0x10`）原样喂给 `fcn_0040829d`，
 *   后者把 `>> 5` 拿去查投影表、把 `& 0x1f` 过 `fcn_00407a2c` 的矩阵换成屏幕偏移
 *   （`004083ae..004083e9`）。而走路例程每 tick 给 `+0x08/+0x0a` 加一个**浮点**步长
 *   （`0x0040c353 fadd [0x48baec]` … `0x0040c38a`）⇒ 原版镜头随棋子**每 tick 滑几像素**。
 *   本引擎先前写的是 `tileX: x >> 5` —— 把余量丢了，镜头于是每跨一块（32 世界单位）
 *   才整格跳一次。现在一律走 `pixelCamera`。没有任何平滑/逼近系数：原版没有。
 *
 * ★ **有标记点时不动** —— 原版 `fcn_00415e70`（VA 0x00415e70）是
 *   「有标记用标记、没标记才用当前玩家」。棋子走到标记上时标记自动清掉，
 *   镜头随即恢复跟随（原版 VA 0x00418656 `[0x48be18] = 0`）。
 */
function centerOnCurrentPlayer(): void {
  // ★ D-MAGIC-16：魔法屋逐人那几段里「当前玩家」= 那位中签者（`0x004320c9`），
  //   每一支开头的 `0x41906a(1)` 重画主窗口时 `fcn_00415e70` 就居中到他（有标记则停在标记上）
  const shown = magicShownState();
  const me = shown.players[shown.currentPlayer];
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
  // ★★ W-52：影片**待播 / 在播**且**没有补间**时 ⇒ **冻住镜头**（下面那一整段都不走）。
  //
  //   原版次序（狗咬那一支）：`0x0041b8cd` 狗咬片（**此时人还在原地**）→
  //   `0x0043ec78 view_to`（对人）→ 搬到医院 → `0x0043ed59` 救护车 →
  //   `0x0043eda0 view_to`（对医院）→ 台词。也就是说**影片期间**镜头一直停在
  //   补间的终点（= 人走到的那个格），直到影片收屏才改看医院。
  //   本引擎一条 action 把「走到狗那一格 + 送医院」一次写完，`after` 里人的
  //   `nodeId` / `xpos,ypos` 已经是醫院大樓的景观位，于是补间收完到影片盖满棋盘
  //   之间那几百毫秒镜头会先闪一下医院。
  //
  //   ⚠️ **这一句必须排在 `cameraFollowTarget` 之前** —— 它的 `confined` 支读的正是
  //   after 的 `xpos/ypos`。放在后面等于没冻：浏览器实测（地图 0、`humans=1`、
  //   徒步踩惡犬、`__rich4.debug.dog()` + `rollDice(forced:1)` + `step`）镜头照样在
  //   补间收完那一刻跳到 `(319,990)`（醫院大樓景观）。
  //   ⚠️ 任务书 §3.1 写的是「取玩家时用 `boardDrawState()`」，那一份也**不够**：
  //   `deferred-board.ts` 的 `holdBackPlayers` 只按住 `godInfo`（它的用途是
  //   「影片期间别把神明标记画上去」），`nodeId` / `blocking` 仍是 after ⇒ 拿它取人
  //   照样走 `confined` 支（同样实测过）。
  //   ⇒ 冻住最贴合原版：镜头停在补间终点（原版 `0x0040c3ec` 走完把目标格坐标写回
  //   `player+0x08/+0x0a`，`fcn_00415e70` 读到的正是它），影片收屏后本函数自然
  //   回到行动者 —— 与「影片 → 镜头 → 台词」那一步对得上。
  if (walkWorld === null && boardFilmWindowOpen(boardFilmWindowFlags())) return;
  const target = cameraFollowTarget(walkWorld, me, (id) => map.nodes[id - 1]);
  if (target !== null && target.reason !== 'node') {
    camera = pixelCamera(target.x, target.y, camera.view);
    return;
  }

  if (minimapMarker !== null) {
    // 走到标记上了？那就把标记收掉，镜头交还给棋子
    // ★ D-MAGIC-16：魔法屋逐人那几段里不收 —— 原版 `0x431caa` 整个循环里标记（`[0x48be18]`）一直留着，
    //   下一位的 `0x41906a(1)` 重画时 `fcn_00415e70` 仍停在上一位 `view_to` / 台词留下的标记上
    if (magicSeq === null && Math.abs(node.x - minimapMarker.x) <= 16 && Math.abs(node.y - minimapMarker.y) <= 16) {
      minimapMarker = null;
      requestRender();
    } else {
      return;
    }
  }

  // 人物视角：镜头中心 = 当前玩家的**像素**世界坐标（静止时 `+0x08/+0x0a` = 格心，
  //   `0x0040c3ec` 走完那一拍把目标格坐标原样写回）
  camera = pixelCamera(node.x, node.y, camera.view);
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
  // 没在等人掷骰就不用重画（GO 鈕那时根本不显示）；后台也不用（第十九份）
  if (screen === 'game' && !pageHidden) requestRender();
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
  camera = pixelCamera(minimapMarker.x, minimapMarker.y, camera.view);
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
function resizeCanvas(): boolean {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    // 改尺寸会把画布清空 ⇒ 下一帧无论如何都要贴一次，黑边也要重铺
    stageBlitOwed = true;
    letterboxFilled = false;
    syncSurfaceScale();
    return true;
  }
  syncSurfaceScale();
  return false;
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
        amountWindowOpened();
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
      '音色庫（.sf2）：有就用採樣還原音色，沒有就退回振盪器',
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
    initialFund: GAME_INITIAL_FUNDS[setup.money] ?? DEFAULT_INITIAL_FUND,
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
  magicSeq = null;
  buildFlicPending.clear();
  releaseBuildFlics();
  boardFilm = null;
  pendingBoardFilm = null;
  landingFx = null;
  // 「狗咬 → 救护车」那一段的排队也要一起清（同一条理由：旧局的片子不该接着放）
  pendingBoardFilmAfter = null;
  boardFilmQueueRest = [];
  boardFilmPending.clear();
  releaseBoardFilmFlics();
  releaseHeldGodFilm();
  deferredBoardBefore = null;
  resetBankruptScreen(); // ★ 第二十五份：破產影片（整屏）同属「这一刻在播」
  newsFlash = null; // 新聞 18 / 19 的白闪同属「这一刻在播」
  manifestHold = null;
  vehicleHold = null;
  godAscend = null;
  pendingCardFlight = null; // 挂起的卡片飞行（等亮牌）属于旧局
  pendingRelocateWalk = null; // 住进旅館那一段（审计 #17）同理
  renderer.clearRelocate();
  pendingCardRoute = null; // 亮牌后待走的那一张同理
  // ★ 右上角面板四位玩家的页号一起归零 @source `fcn_00417e26` 的 0x401 分支
  //   `xor edi,edi / mov dword [0x48be24], edi`（4 字节 = 四位）—— 0x401 由
  //   `_rich4_start_game_loop`（0x401981）进棋盘时 Post 一次（新局 0x401cfe、標題读档 0x401d08 都走它）
  panelPages.fill(0);
  // 自動存檔的「上一次算过的日期」清掉：开局那一天不存（`autosaveStep`）
  autosaveDateKey = null;
  // GO 鈕的位置回到静态初值（原版 `[0x475284]/[0x475288]` 不存档，重开一盘就复位）
  goButton.reset();

  const first = map.nodes[state.players[0]?.nodeId ?? 1];
  camera = pixelCamera(first?.x ?? 0, first?.y ?? 0, state.viewRotation);
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
  // ★★ 開局**不说话**（第十四份试玩回报 #1「开局从机舱里跳伞出来时不应该有台词」）。
  //   先前这里播了一句事件 26（「我要再接再勵…」）—— 那是**输了之后续局**的台词：
  //   全 exe 唯一一处 `0x00407946` 在 `fcn_00407842` 里（先开模态框 `0x00407919`、选了才说），
  //   `callers 0x407842` 只有 `0x40cff0`（破产流程「唯一真人出局」）与 `0x41da2d`
  //   （`0x41d89e` 胜负判定里电脑赢了的那一支）。新开一局的路
  //   `0x401cd0 call 0x406de7 → 0x401543 → 0x407ad2 → 0x4190cf → 0x4291d6 → 0x415872`（跳伞过场）
  //   `→ 0x401981` **一句台词都不调**。那个续局模态框本引擎还没复刻（known-deviations），
  //   故 26 这一句眼下没有落点；`openingSpeech()` 留在 `speech.ts` 等它。
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
      if (stockAmount !== null) {
        dragAmountBar(p); // 填数页开着：只认拖金额栏，不理会行的悬停
        return;
      }
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
        if (q !== null) {
          // 原版把这次移动**重发成一次按下**（`loc_00437904` → `0x201`）⇒ 每次都走金额栏那一支、放一声 9
          atmSound(4);
          atmSeekTo(q.x);
        }
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
        isHost: lobbyIsHost(lobbyRoom, net?.seat ?? null),
        me: net?.seat ?? null,
        started: lobbyRoom?.started ?? false,
        // ⚠️ 与绘制**同一个数**：不然「画了两格、却点得动第三格」这种鬼事
        seats: roomOptions(lobbyRoom).seatCount,
        room: lobbyRoom,
      });
      if (JSON.stringify(hit) !== JSON.stringify(lobbyHot)) {
        lobbyHot = hit;
        requestRender();
      }
      return;
    }
    if (screen === 'aiSettings') {
      // ★ 原版 `WM_MOUSEMOVE`（`loc_0041de2e`）只做一件事：按住滑槽时跟着改值 —— **没有悬停高亮**
      const local = { x: p.x - AI_ORIGIN.x, y: p.y - AI_ORIGIN.y };
      if (aiModel !== null) {
        const dragged = aiSettingsDrag(aiModel, local, aiCanEdit);
        if (dragged !== aiModel) {
          aiModel = dragged;
          requestRender();
        }
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
    // （小地图顶边随「視窗」三态走：縮小地圖 280、組合畫面 80 —— `hitMinimapArea`，表 `0x4752aa`）
    const mmHover = hitMinimapArea(options.windowView, p.x - LAYOUT.panel.x, p.y - LAYOUT.panel.y);
    const hotArrow = mmHover !== null ? hitMinimapArrow(mmHover.x, mmHover.y) : null;
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

    // 監獄／醫院保釋屏：整屏，只记光标在哪个槽位上（原版 0x200 那条路）；YES/NO 开着时只认那两半
    if (screen === 'game' && bailScreenOn()) {
      const place = bailPlace();
      if (bailFlow !== null && bailFlow.stage === 'confirm') {
        const half = hitBailYesNo(p.x, p.y);
        if (half !== bailFlow.yesNo) {
          bailFlow = { ...bailFlow, yesNo: half };
          requestRender();
        }
        return;
      }
      const next = place === null ? null : hitBailSlot(place, p.x, p.y, bailOccupancy());
      if (next !== bailHot) {
        bailHot = next;
        requestRender();
      }
      return;
    }

    // ── 填数页的**金额栏**：**按住栏**拖动才改值 ──
    //   @source `loc_00453394`（通用填数窗的 `WM_MOUSEMOVE`）。
    //   ★★ 第七份试玩回报 #4 订正：先前把开头那句 `cmp dh, 0x10` 读成了「光标下的像素 id 是 0x10」，
    //     于是写成「不用按下、鼠标划过栏就改值」—— 一进填数页数字就跟着鼠标乱跳（需求方所报）。
    //     实际上 `dh = [0x48cac2]`（`0x0045320b mov dh,[0x48cac2]`）是**按下那一刻**光标下的控件号：
    //     `WM_LBUTTONDOWN` 在 `0x00452d5b..0x00452d5e` 把 id 图里那一格写进去，抬手 / 键盘那几支清 0
    //     （`0x00452e4b xor dl,dl / mov [0x48cac2],dl`）；同一个字节 == 1 时是拖窗（`0x00453211 cmp dh,1`）。
    //     像素 id 是后面**另一次**查的（`0x004533f9 cmp byte [edx+eax],0x10`）。
    //   ⇒ 条件是两条都要：**在栏上按下的**、且此刻光标**还在栏上**。每换一次放一声音效 9（`[0x482352]`）。
    dragAmountBar(p);

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
    // ★ 填数窗那一下已经在 mousedown（记账 + 音）/ mouseup（动作）上办完 —— 浏览器补来的这个
    //   `click` 整个吞掉；否则「確定」刚关掉填数页，同一点又落到底下选项页的钮上（一下办两件事）。
    //   触屏手势模块派的点按也是「按下 → 抬手 → click」三连，同一条路。
    if (amountPress.click()) return;
    const p = eventToStage(e);
    if (p === null) return;
    unlockAudio();
    // ★ W-74：本机座位被超时託管时，点一下画面就收回来（这一下不再往下传）
    if (reclaimIfAutopiloted()) return;

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
    // 託管AI 屏全在 mousedown / mouseup 上处理（原版 0x201 / 0x202 两条分支）——
    //   `click` 这一路不碰它，否则同一次点会被处理两遍（行上那一下就会「选中 + 立刻翻」）。
    if (screen === 'aiSettings') return;
    if (screen === 'lobby') {
      const hit = hitLobby(p.x, p.y, {
        isHost: lobbyIsHost(lobbyRoom, net?.seat ?? null),
        me: net?.seat ?? null,
        started: lobbyRoom?.started ?? false,
        // ⚠️ 与绘制**同一个数**：不然「画了两格、却点得动第三格」这种鬼事
        seats: roomOptions(lobbyRoom).seatCount,
        room: lobbyRoom,
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
      // ★★ 第十一份試玩回報 #1：開局設定某一項的 ◀ / ▶ —— 同样只是**发请求**：
      //   本地按当前值 ±1 档折成新取值，等服务器校验后广播 `room` 回来才更新。
      //   ⚠️ 档位**夹紧不回绕**（到头那一侧的箭头本来就是压暗的，见 `drawOptionColumn`；
      //   能点却画成灰的，就是 UI 骗人）。单机那一屏是**下拉浮窗**选值、没有箭头，
      //   所以这条没有原版对照，是本项目自定的交互。
      if (hit.kind === 'option') {
        const row = LOBBY_OPTION_ROWS.find((r) => r.field === hit.field);
        if (row === undefined) return;
        const cur = optionIndexOf(roomOptions(lobbyRoom), hit.field);
        const next = Math.max(0, Math.min(row.steps - 1, cur + hit.delta));
        if (next === cur) return; // 到端点了：一个字节都不发
        net?.setOptions({ [hit.field]: optionValueOf(hit.field, next) });
        return;
      }
      if (hit.kind === 'start') {
        net?.start();
        return;
      }
      // ★ 聯機存檔（v6）：存檔房的「這是我 / 離座」—— 同樣只是發請求，等 `room` 廣播回來
      if (hit.kind === 'claim') {
        net?.claim(hit.seat);
        return;
      }
      if (hit.kind === 'unclaim') {
        net?.unclaim(hit.seat);
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
    if (screen === 'game' && bailScreenOn()) return;

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
        // 填数页上的钮归 mousedown / mouseup（原版 0x201 记账、0x202 动作），这里只管选项页
        if (h !== 'inside' && amountPage === null) onDialogHit(dlg, h);
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

  // 指针离开画布：软件指针跟着收（`soft-cursor.ts` 自己听 `mouseleave`；系统指针在画布外照常显示）

  canvas.addEventListener('mousedown', (e) => {
    unlockAudio(); // 浏览器要求在用户手势里建 AudioContext
    // 新的一次按下：上一次抬手留下的「吞掉 click」作废（那个 click 要么已经来过、要么不会来了）
    amountPress.newGesture();

    // ★ 填数页金额栏：记下「这一下是不是按在栏上」（@source `0x00452d5e mov [0x48cac2], al`）。
    //   只记账、不改值、不吞事件 —— 原版按下那一拍对 id 0x10 什么都不做，值是随后的 `WM_MOUSEMOVE` 改的。
    amountBarHeld = false;
    if (e.button === 0 && amountPage !== null) {
      const pt = eventToStage(e);
      const max = amountBarMax();
      if (pt !== null && max !== null) amountBarHeld = amountBarDragValue(pt.x, pt.y, max) !== null;
    }

    // ★ W-69：過路費那段闪在播时，任意滑鼠鍵**跳过**它，而且这一下被它吃掉
    //   （原版 `fcn_004528b9` 的等待循环把这条消息收走了，不会漏给棋盘）。
    if (tollFlash !== null) {
      skipTollFlash();
      return;
    }
    // ★ 第二十二份：片后 / 闪后那一段静置（`fcn_004528b9`）同样「任意滑鼠鍵」提前返回，这一下被它吃掉
    if (skipPresentationHold(performance.now())) return;
    // ★ 神明开场白同样「任意滑鼠鍵跳過」，这一下被它吃掉
    if (skipGodLine()) return;

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

    // ── 託管AI 屏（原版 0x201 → `loc_0041de95`）──
    // ★ 点玩家行：没选中的只**选中**，已选中的才**翻托管**（按下这一拍就办）；
    //   滑槽按下就改值；其余控件只记账，抬手才动作。见 `ai-settings.ts` 的 `aiSettingsDown`。
    if (screen === 'aiSettings') {
      if (e.button !== 0) return;
      const q = eventToStage(e);
      if (q !== null) onAiSettingsDown(q);
      return;
    }

    // ── 通用填数窗（棋盘 / 銀行 / 股市三处，原版 `fcn_00452c02` 的 0x201）──
    // ★ 按下只**记账 + 放按键音 7**（0x00452d8e..0x00452d95），数值在抬手才动（见 `mouseup`）。
    //   先前棋盘 / 銀行那两扇挂在 `click` 上（音与动作都在松手之后），股市那扇在按下就连音带动作一起办了。
    if (e.button === 0 && amountPage !== null) {
      const q = eventToStage(e);
      if (q !== null && amountWindowDown(q)) return;
    } else {
      amountPress.reset();
    }

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
      //   ★ pt26：按下 / 抬手已经在上面的通用填数窗那一支（`amountWindowDown` / `amountWindowUp`）办了 ——
      //   这里只把落在窗外的点**吞掉**（模态：别漏给股市柜台）。
      if (stockAmount !== null) {
        if (import.meta.env.DEV) {
          __devHits.push({ cx: e.clientX, cy: e.clientY, held: amountPress.held });
        }
        return;
      }
      // ★ 休市那一支原版走的是**訊息框**窗口过程：任何一下鼠标都退屏
      //   （@source `fcn_0042b2ec` 的 0x202/0x205 两路都 `Post_0402_Message(0)`）
      //   —— 所以休市日既看不到行情，也不可能交易。
      if (stockCounterClosed(state)) {
        // ★ W-63：**只认左键** —— 右键交给 `contextmenu → cancelTopPanel()` 的
        //   `'stock'` / `'stockPick'` 层（休市屏就是 `screen === 'stock'`，那两层覆盖得到）。
        //   先前这里连右键一起关，而右键还会再触发一次 `contextmenu` ⇒ 一下退两层。
        if (e.button === 0) {
          // ★ 选股模式碰上休市：原版这一支走訊息框，任何一下鼠标都 `Post(0)`
          //   抛回 0 ⇒ 卡不消耗、卡片欄被开回来（且不播取消音）
          if (stockPick !== null) cancelStockPick(false);
          else closeStock();
        }
        return;
      }
      // 详情卡开着：**左键**直接退卡 @source `loc_0042aa08`
      //   ★ W-63：右键**不在这里**关 —— 浏览器一次右键会先后发 `mousedown(button=2)`
      //   与 `contextmenu`；这里若也关掉，`stockDetail` 立刻变 null，紧接着
      //   `contextmenu → cancelTopPanel()` 的梯子就落到 `'stock'` 层把**整个股市屏**
      //   也关了（一下退两层）。梯子上本来就有 `'stockDetail'` 那一层
      //   （`panel-cancel.ts`），交给它就够。
      if (stockDetail !== null) {
        if (e.button === 0) closeStockDetail();
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

    // ── 还款提醒窗：左键（`0x201`/`0x203`）哪儿都行 —— 音效 1 + 这一句当场收掉 @source 0x00436596 ──
    if (e.button === 0 && reminderUi !== null) {
      sound.play('Effect.mkf', REMINDER_CLICK_SOUND);
      stopVoice(); // `0x004365a5 push 1 / 0x004365a7 call 0x44ee18` —— 收框连语音一起停（0x0044ee30）
      reminderUi = reminderClick(reminderUi);
      requestRender();
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
    // ★ 只认左键按下：ATM 窗 `fcn_00436ef8` 的分派只接 `0x201` / `0x203`（→ `loc_00437161`），
    //   右键在**抬手**（`0x205` → `loc_0043791e` 关窗，走 `contextmenu` 那把梯子），按下时既不认钮也不放音
    if (atm !== null) {
      if (e.button !== 0) return;
      const q = eventToStage(e);
      if (q === null) return;
      const btn = hitAtmButton(q.x, q.y);
      if (btn === null) return;
      // 按下图（`[0x48c40b]` = 钮序号 + 1）@source loc_004371f9
      atmCode = btn + 1;
      atmCodeAt = performance.now();
      // 按下那一声（模式钮 1、金额栏 9、其余 7）@source `0x00437397` 那段分发，见 `atmPressSound`
      atmSound(atmCode);
      // 金额栏（序号 3）：按住就按位置换算金额，之后再拖动由 `mousemove` 接
      // @source loc_00437413
      if (btn === 3) {
        atmSeekTo(q.x);
        return;
      }
      const next = atmPress(atm, btn, bankFrozen());
      if (next === null) {
        dismissAtm(); // EXIT
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
    // ★ 只认**左键**按下：两扇浮窗的消息回调（卡片欄 `fcn_004416f0`、道具欄 `fcn_00445c14`）
    //   只接 0x201 / 0x202 / 0x205 / 0x401 / 0xf；`WM_RBUTTONDOWN`（0x204）落在
    //   `0x441715 jb 0x44191f` / `0x445c39 jb 0x445e13` 那条缺省出口 —— 不记选中、不放音。
    //   右键的取消在**抬手**（0x205，`contextmenu` 那把梯子）。
    if (screen === 'inventory') {
      if (e.button !== 0) return;
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
      // ★ 道具欄末格的载具徽章 = 「下車」（道具表第 14 项 `0x447c00`；`0x00447e24 mov byte [0x48c556], 0xe`
      //   把末格的命中值写成 14 —— 只有骑機車 / 开汽車时才画、才点得中）
      const traffic = state.players[state.currentPlayer]?.trafficMethod ?? 0;
      if (hit === undefined && invKind === 'tools' && slot === INV_SLOTS - 1 && (traffic === 1 || traffic === 2)) {
        invPicked = TOOL_GET_OFF;
        sound.play('Effect.mkf', SOUND_IDS.TITLE_CLICK);
        return;
      }
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
        // ★★ E-21 抓到的真卡死：道别气泡还在时再点一下（连点 EXIT 很自然），先前这里把气泡
        //   直接清成 null，而 `shopTick` 的关门判据恰恰是「气泡**到期**」⇒ `closing` 恒真、
        //   气泡恒空、店永远不关（`pending = shop` 卡死，试玩 soak 连点 313 次关不掉）。
        //   原版这一拍是 `fcn_0044ee18(1)`（@source `loc_0042de09`：提前收掉限时訊息框）——
        //   框一收，后续照常推进（状态 2→3→4，`loc_0042e686`）。故道别那一句**改成立刻到期**，
        //   交给 `shopTick` 走同一条关门路；别的气泡照旧直接收。
        // ★★ 第二十六份 panel #2：`0x44ee18(1)` 收框时连语音一起停（`0x0044ee30 call 0x454493`）——
        //   否则字框按「语音放完才到期」还会挂着
        if (ui.bubble !== null) stopVoice();
        ui.bubble = shopBubbleAfterClick(ui.bubble, ui.closing);
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
    // ★ 組合畫面没有竖条（窄版面板），那一段 y 是小地图：`0x004182fa cmp [cfg+5], 2 / je` 整支跳过
    const layout = sidebarLayout(options.windowView);
    const tag = layout.panel === 'full' ? hitPanelTag(p.x - LAYOUT.panel.x, p.y - LAYOUT.panel.y) : null;
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
    // ★ 右栏下面两块按「視窗」三态分（`sidebarLayout`）：日曆那 200×200 恒在 y = 280，
    //   小地图在 280（縮小地圖）或 80（組合畫面）。原版判的顺序也是先日曆、后小地图
    //   （VA 0x0041835f → 0x00418415）。
    if (layout.calendar && hitSidebar(p.x - LAYOUT.panel.x, p.y - LAYOUT.panel.y)) {
      // 日曆那一面的两颗钮：太阳/月亮是「日曆 ↔ 月曆」的切换钮（VA 0x0041838c）。
      // **只有純小地圖那一态（cfg+5 = 1）没有这一面**（`0x0041835f cmp [cfg+5], 1 / je`）。
      const to = hitCalendarToggle(p.x - LAYOUT.panel.x, p.y - LAYOUT.panel.y - SIDEBAR.y);
      // 已经是这一面 → 什么都不做（原版连音效都不放）
      if (to !== null && to !== calendarPageOf(options)) {
        sound.play('Effect.mkf', SOUND_IDS.TITLE_CLICK);
        // @source 0x004183c6 `mov [0x497164], 0`（太阳）/ 0x0041840c `mov [0x497164], 1`（月亮）——
        //   写的是 cfg 本体；原版随下一次 `rich4_write_config()` 整份存盘（熱鍵「切換視窗組」同样当场存，
        //   见上面 `saveConfigToStore` 那一处），这里当场写回，关页 / 刷新不丢
        options = { ...options, calendar: to === 'month' ? 1 : 0 };
        saveConfigToStore();
        requestRender();
      }
      return;
    }
    const mm = hitMinimapArea(options.windowView, p.x - LAYOUT.panel.x, p.y - LAYOUT.panel.y);
    if (mm !== null) {
      const arrow = hitMinimapArrow(mm.x, mm.y);
      if (arrow !== null) {
        // 按下先记账 + 亮起来，**松开才转** —— 原版是按下/抬起两段（VA 0x00418415 / 0x004186cb）
        pressedMinimapArrow = arrow;
        requestRender();
        return;
      }
      if (hitMinimapBody(mm.x, mm.y)) {
        // 点小地图本体：把光标处的局部坐标换成世界坐标、夹紧，镜头就停在那儿（可继续拖）
        minimapMarker = minimapCenterFromLocal(mm.x, mm.y);
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
        const n = hitDiceToggle(gx, gy, maxDiceOf(me0), goButton.position(), me0.trafficMethod & 3);
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
      !bailScreenOn()
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
    // 抬手 = 松开金额栏（@source `0x00452e4d mov [0x48cac2], dl`，dl = 0）
    amountBarHeld = false;
    // ★ W-69：過路費闪在播时抬手也跳过（同样是「任意滑鼠鍵」）
    if (tollFlash !== null) {
      skipTollFlash();
      return;
    }
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
    // ── 託管AI 屏：抬手照按下时记下的控件动作（原版 0x202 → `loc_0041e0b1`）──
    // ★ 只认左键：右键抬手是 `0x205` = 关屏（走 `contextmenu` → `cancelTopPanel` 那一路）
    if (screen === 'aiSettings') {
      if (e.button === 0) onAiSettingsUp();
      return;
    }
    // ── 通用填数窗：抬手照**按下时记下的那一号**动作（原版 0x202 → `loc_00452fce`）──
    // ★ 只认左键：右键抬手是 `0x205` = 关窗（走 `contextmenu` → `cancelTopPanel` 那一路）
    if (e.button === 0 && amountWindowUp()) return;
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
    // ★ 只认**左键**抬手（`WM_LBUTTONUP` 0x202）；右键走 `contextmenu` 那把取消梯子。
    //   不加这一条：macOS 上右键是「按下 → contextmenu → 抬手」，目标拾取右键取消后
    //   `cardUseFailed` 刚把卡片欄开回来（原版 `0x00441ce3 je 0x441c22`），
    //   紧跟的右键抬手就落进这里、`invPicked === null` ⇒ 当场又把卡片欄关掉。
    if (screen === 'inventory') {
      if (e.button !== 0) return;
      // ★ 没按中任何一格（格外 / 空格）就抬手 ⇒ **什么都不做，浮窗留着**：
      //   `0x441889 cmp [0x48c544],0 / je 0x441579`（卡片欄）、`0x445d84 cmp [0x48c560],0 / je 0x445d7d`（道具欄）。
      //   两扇都是整窗的模态回调（`0x4018e7` 把所有消息交给回调栈顶），格外的点击也落在这里。
      //   先前这里一律 `closeInventory()` —— 点空白就关窗是本引擎自己加的。
      if (invPicked === null) return;
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

    // ── 監獄／醫院保釋屏：抬手（原版 0x202，監獄 `loc_0043cef6` / 醫院 `loc_0043e658`）──
    //   ★ 2026-09-23：整段走 `bail-screen.ts` 的 `bailFlowStep` —— 字框挂着时点一下只收框；
    //   付得起先弹 YES/NO（`0x453a32` 居中 (320,240)），YES 才把答复交给 core；
    //   付不起柜台人员说「抱歉！你的點數不足！」（監獄 (0xe6,0x12c) / 醫院 (8,8) 那只框）。
    if (screen === 'game' && bailScreenOn()) {
      // 只认左键抬手（0x202 = WM_LBUTTONUP）；右键那一下由面板取消（0x205）那一路处理
      if (e.button !== 0) return;
      const q = eventToStage(e);
      const place = bailPlace();
      if (q !== null && place !== null && bailFlow !== null && state.pending?.kind === 'bail' && localSeatActive()) {
        if (bailFlow.stage === 'confirm') {
          bailSend({ kind: 'yesNo', hit: hitBailYesNo(q.x, q.y) });
        } else {
          const occupancy = place === 'prison' ? state.prisonOccupancy : state.hospitalOccupancy;
          const slot = hitBailSlot(place, q.x, q.y, occupancy);
          // 够不够用这一屏自己的判据（`>= 赎金`），不是电脑那条更严的。
          const affordable = slot !== null && canPayOnScreen(state.players[state.currentPlayer]?.points ?? 0, slot);
          if (slot !== null && !affordable) log('點券不足，付不起這位的保釋金');
          bailSend({ kind: 'click', slot, affordable });
          bailHot = null;
        }
      } else if (bailFlow !== null && bailFlowHasBubble(bailFlow.stage)) {
        // 收尾那几句（答复已落地）也照样点一下就收
        bailSend({ kind: 'bubbleEnd' });
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
      if (source.kind === 'build') {
        // 建設公司：选中的实例编码交回（`0x00446691 push [0x48c584]`）；0 级設施的选种类窗由 core 挂 `buildFacility`
        if (hit.code !== undefined) dispatch({ type: 'buildTarget', entityId: hit.code });
        return;
      }
      if (source.kind === 'card') {
        // ★ 搶奪卡（13）打**人**：原版在这里换成 `fcn_0044192a` 那扇模态选牌窗
        //   （见 `steal-picker.ts`），挑完才 `consume_card` + `receive_card`；
        //   右键取消 = 返回 0 = **卡不消耗**（`rich4_card_qiangduoka.asm:87..123`）。
        const t = hit.target;
        if (t.kind === 'player' && needsStealPick(state, source.cardId, t)) {
          openStealPicker(t.index, 'steal', (pick) => {
            // 取消：什么都不派（照抄 exe）；卡片函数返回 0（`loc_00441f1b` 的 `mov eax, ebx`）
            //   ⇒ 调度器失败音 3 + 卡片欄重开（`0x00441cd9` / `0x00441ce3`）
            if (pick === null) {
              cardUseFailed();
              return;
            }
            dispatch({
              type: 'useCard',
              cardId: source.cardId,
              target: { kind: 'player', index: t.index, steal: pick },
            });
          });
          return;
        }
        // ★★ 天使卡（9）打**0 级設施**：原版在 `0x40b110` 里给真人开「請選擇設施類別」
        //   （`0x0040b1e4 call 0x440aac(0)`），种类挂在 facility 目标的 `buildType` 上
        const tgt = hit.target;
        if (source.cardId === 9 && tgt.kind === 'facility' && pickerNeededFor(state, topo, hit.nodeId)) {
          const cardId = source.cardId;
          openFacilityPicker((type) => {
            if (type === null) return;
            dispatch({ type: 'useCard', cardId, target: { ...tgt, buildType: type } });
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
      } else if (source.toolId === TOOL_TELEPORTER && source.teleportFrom === undefined) {
        // ★★ 傳送機第一段选完来源 ⇒ 马上开第二段（地块 `0x2090802` / 設施 `0x2090804` / 其余 `0x2090001`）；
        //   第二段右键取消 = 道具不消耗（`0x00447506` / `0x004475a9` / `0x00447673` / `0x004478f2 je 0x4479b3`）
        const from = hit.code ?? 0;
        pick = startPick(state, topo, { kind: 'tool', toolId: TOOL_TELEPORTER, teleportFrom: from }, 'none', teleportTargetParam(from));
        pickHover = null;
        if (pick.candidates.length === 0) log('「傳送機」这一件现在搬不到任何地方');
        refreshPickCursor();
        requestRender();
      } else if (source.toolId === TOOL_TELEPORTER && source.teleportFrom !== undefined) {
        dispatch({ type: 'useTool', toolId: TOOL_TELEPORTER, nodeId: source.teleportFrom, value: hit.code ?? hit.nodeId });
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
      // 顶边随「視窗」三态走（VA 0x0041895b：組合畫面 `lea esi, [edx - 0x50]`）
      const lx = p.x - LAYOUT.panel.x;
      const ly = p.y - LAYOUT.panel.y - (sidebarLayout(options.windowView).minimapTop ?? SIDEBAR.y);
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
    // ★ W-69：過路費闪在播时右键也跳过（「任意滑鼠鍵」，同样被它吃掉）
    if (tollFlash !== null) {
      e.preventDefault();
      skipTollFlash();
      return;
    }
    // ★ 第二十二份：静置那一截（右键也算「任意滑鼠鍵」`0x205`）
    if (skipPresentationHold(performance.now())) {
      e.preventDefault();
      return;
    }
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
  // 地址栏展开/收起、分屏、Stage Manager 改窗口 —— iPad Safari 上**不一定**发 window
  // `resize`，但一定发 `visualViewport` 的；页面矩形已由 `installViewportFit` 重钉，这里排一帧
  window.visualViewport?.addEventListener('resize', requestRender);

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
    const message = r instanceof Error ? r.message : String(r);
    const stack = r instanceof Error ? (r.stack ?? null) : null;
    // ★ 扩展 / 系统注入脚本的消息桥失败（如 iOS Safari 的「NoResponse: No response from target」）
    //   不是本程序的错：不上日志栏、不落回报，只记飞行记录仪 + 宿主日志（判据与取证见 `external-rejection.ts`）
    if (isExternalRejection(message, stack)) {
      recorder.error({ t: Date.now(), kind: 'note', message: `[外来 rejection，已忽略] ${message}`, stack: null });
      hostLog(`[unhandledrejection·external] ${message}`);
      return;
    }
    onUncaught('unhandledrejection', message, stack);
  });

  // ★★ 第十六份：演出死锁看门狗（见 `watchPresentationDeadlock`）—— 定时器驱动，卡死时渲染循环早停了
  window.setInterval(() => watchPresentationDeadlock(Date.now()), 1_000);

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
    // ★ 第十六份：回合开始 / 走子 / 落点结算这几段**不等人**（真人回合也是自动派的）⇒ 停着就是断了
    //   （线上那一次停在真人的 `turnStart`，先前这里只认电脑回合，一份回报都没落）
    const autoPhase = state.phase === 'turnStart' || state.phase === 'moving' || state.phase === 'settling';
    if (stallReported || screen !== 'game' || state.phase === 'gameOver' || (!isAiTurn(state) && !autoPhase)) return;
    if (net !== null && !localSeatActive() && !autoPhase) return; // 联机：别人的回合卡不卡不由本机判
    // 电脑的回合里也可能在**等人**：竞价轮到真人举牌（core `actingSeat`）⇒ 不算停摆
    const acting = state.players[actingSeat(state)];
    if (!autoPhase && (acting === undefined || !isAiControlled(acting))) return;
    // 整屏演出（月結、開獎…）可能在等人点一下才收 ⇒ 放宽到 3 分钟，免得误报
    const limit = activeUiScreen() === null ? 60_000 : 180_000;
    if (now - stallSince < limit) return;
    stallReported = true;
    const message = `電腦回合 ${limit / 1000} 秒無進展：${key}`;
    recorder.error({ t: now, kind: 'stall', message, stack: null });
    hostLog(`[stall] ${message}`);
    log(`⚠ ${message}（按 F9 存問題回報）`);
    // 桌面壳落成文件；网页版上传到服务器（上传不了就只记日志，见 `writeReport`）
    fileReport('stall', message);
  }, 5_000);

  window.addEventListener('keydown', (e) => {
    // ★ 浏览器自动填充（Chrome 填账号/密码时）会派发**不是 KeyboardEvent** 的 `keydown`：
    //   没有 `code` / `key`。下游一律按 `e.code.startsWith(…)` 读物理键位 ⇒ 抛
    //   「Cannot read properties of undefined (reading 'startsWith')」（2026-09-23 Ruan 的自动回报，
    //   标题画面、刚进站）。这种事件不是按键，整条丢掉。
    if (typeof e.code !== 'string' || typeof e.key !== 'string') return;
    // ★ F9 = 问题回报（原版的键名表里没有 F1..F12，不占任何原版热键）
    if (e.key === 'F9') {
      e.preventDefault();
      fileReport('manual');
      return;
    }
    // ★ 焦点在**文字输入框**里（门厅昵称、联机存档命名、回报说明…）⇒ 这是在打字，不是按熱鍵：
    //   整条交给输入框自己，游戏一概不收、不 `preventDefault`。
    //   先前这里没有这道闸，熱鍵表里的字母（S 存檔 / C / M / H …）被下面的熱鍵段吞掉，
    //   昵称里那几个字母就打不进去（需求方 2026-09-24「输入昵称时有些字母输不进去」）。
    if (isTextEntryTarget(e.target)) return;
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
function connectOnline(
  url: string,
  room: string,
  name: string,
  opts: {
    /** 房间列表（v5）：建房 / 加入已有的；不给 = 旧语义（老调试入口）*/
    mode?: JoinMode;
    /** 还没坐下就被拒（房间不在了 / 满了 / 版本不符）—— 给了就断开并交给它（回列表）*/
    onJoinFailed?: (message: string) => void;
    /** ★ 聯機存檔（v6）：建房時從這份存檔繼續 */
    fromSave?: string;
    /** ★ 聯機存檔（v6）：加入已開局的存檔房時認領這一座 */
    claimSeat?: number;
  } = {},
): void {
  let closedByUs = false;
  let firstOpen = true;
  // ★ W-73：身份令牌 —— 断线重连**认回原座位**只认它，不认名字。
  //   老的 `?ws=…&room=…&name=…` 调试入口也走这一条（从同一个 localStorage 取 / 生成）。
  const clientId = loadClientId(browserStorage());
  const open = (since: number | undefined): void => {
    const ws = new WebSocket(url);
    // 「離開」要能把这条连接断开；重连时会换成新的
    netClose = () => {
      closedByUs = true;
      ws.close();
    };
    // ★ 断线重连一律按「加入已有的」：头一次是「建房」的，重连时房间当然已经在了
    //   （照 `'create'` 再发一次只会撞上自己的房间被拒）
    const mode = opts.mode === undefined ? undefined : firstOpen ? opts.mode : 'join';
    // ★ 聯機存檔（v6）：「從存檔建」「認領座位」都只在頭一次 —— 重連時憑 clientId 認回
    const once = firstOpen
      ? {
          ...(opts.fromSave === undefined ? {} : { fromSave: opts.fromSave }),
          ...(opts.claimSeat === undefined ? {} : { claimSeat: opts.claimSeat }),
        }
      : {};
    firstOpen = false;
    let lastError: string | null = null;
    const client = new NetClient(
      { send: (text) => ws.send(text) },
      {
        room,
        name,
        clientId,
        ...(mode === undefined ? {} : { mode }),
        ...once,
        ...(since === undefined ? {} : { since }),
        onJoined: (seat, info) => {
          log(
            seat < 0
              ? `✔ 進房 ${info.id}（從存檔繼續）：還沒入座 —— 點自己那一座的「這是我」`
              : `✔ 進房 ${info.id}：我是 ${seat + 1} 號座${seat === roomHostSeat(info) ? '（房主，按 START 開局）' : ''}`,
          );
          // ★ 只有「进房时还没开局」才该播開局過場（见 `roomJoinedUnstarted` 的注释）
          roomJoinedUnstarted = !info.started;
          enterLobby(info);
          // ★ W-75：第一次拿到快照 ⇒ 屋里已经在的人按「加入了」报一遍
          //   ★ v6：同一間房裡又來一條 `joined`（「這是我」坐下、前面有人離開往前挪了座）不重報
          const sameRoom = lastToastRoom !== null && lastToastRoom.id === info.id;
          if (!sameRoom) lastToastRoom = null;
          netToasts.update(lastToastRoom, info, seat);
          lastToastRoom = info;
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
          // ★ W-75：比较前后两份快照，该弹的弹（谁进来 / 谁掉线 / 谁被超时託管）
          netToasts.update(lastToastRoom, info, net?.seat ?? null);
          lastToastRoom = info;
        },
        onStart: (start) => {
          // 重连时 start 会再来一次；局面已在，别重建（那会把 since 之前的进度清掉）
          // ★ 開局過場也算「已在這一局」—— 否则过场期间若再收到一条 `start`，会重建局面并把过场重置
          if (since !== undefined && (screen === 'game' || screen === 'intro')) return;
          lobbyRoom = null;
          lobbyHot = null;
          map = parseMap(readMapData(archives, start.globalMapId));
          topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials, landscapes: map.landscapes };
          // ★ 与服务器镜像（server/room.ts）逐字段一致，否则指纹对不上 ——
          //   新局 `newGame`，★ 聯機存檔（v6）從存檔繼續的局讀快照（`net-start.ts`，與 `onResync` 同一段）
          state = initialNetState(start, map);
          history.length = 0;
          recorder.reset();
          hoverNode = null;
          // ★ 换局：把上一局「这一刻在播」的影片全收掉 —— 与单机 `startGame()`（7602-7617）同一理由，
          //   旧局的影片时间轴还挂着会盖在新棋盘上，棋盘还会拿旧局的 before 快照当底。
          buildFx = null;
          pendingBuildFx = null;
          magicSeq = null;
          buildFlicPending.clear();
          releaseBuildFlics();
          boardFilm = null;
          pendingBoardFilm = null;
          landingFx = null;
          // 「狗咬 → 救护车」那一段的排队也要一起清（同一条理由）
          pendingBoardFilmAfter = null;
          boardFilmQueueRest = [];
          boardFilmPending.clear();
          releaseBoardFilmFlics();
          releaseHeldGodFilm();
          deferredBoardBefore = null;
          resetBankruptScreen(); // ★ 第二十五份：破產影片（整屏）同属「这一刻在播」
          newsFlash = null; // 新聞 18 / 19 的白闪同属「这一刻在播」
          manifestHold = null;
          vehicleHold = null;
          godAscend = null;
          pendingCardFlight = null; // 挂起的卡片飞行（等亮牌）属于旧局
          pendingRelocateWalk = null; // 住进旅館那一段（审计 #17）同理
          renderer.clearRelocate();
          pendingCardRoute = null; // 亮牌后待走的那一张同理
          // ★ 与单机 `startGame()` 同一条：面板页号归零（`0x48be24`）、自動存檔日期清掉
          panelPages.fill(0);
          autosaveDateKey = null;
          // GO 鈕的位置回到静态初值（原版 `[0x475284]/[0x475288]` 不存档，重开一盘就复位）
          goButton.reset();

          const first = map.nodes[state.players[state.currentPlayer]?.nodeId ?? state.players[0]?.nodeId ?? 1];
          camera = pixelCamera(first?.x ?? 0, first?.y ?? 0, state.viewRotation);
          // ★★ 第九份试玩回报（2026-09-22，Charles）：「多人模式开局没有机舱跳伞的过场动画」。
          //   过场本身一直在（`intro.ts`，单机也一直在播）—— 是**联机这条路根本没接**：
          //   先前这里直接 `screen = 'game'`，跳过了单机 7622-7626 那四行。
          //   现在与单机逐项对齐（`intro.ts` 一个字不用改）。
          //
          //   ⚠️ 只有「进房时还没开局」才播，否则刷新/重连每来一次就重看 13 秒 —— 见
          //      `roomJoinedUnstarted` 的注释。过场期间**不报** `awaiting`（`tickAwaiting`
          //      第一句就是 `screen !== 'game'` 闸），所以 60 秒不会被过场吃掉；
          //      但前提是过场时长短于服务端的兜底值（4 人局 ≤ 14.9 s ≪ `awaitingFallbackMs` 45 s）。
          // ★ 聯機存檔（v6）：從存檔繼續的局不是「開局」，不播跳傘
          if (start.snapshot !== undefined) roomJoinedUnstarted = false;
          if (roomJoinedUnstarted) {
            introStartedAt = performance.now();
            introSkipped = false;
            introSoundPlayed = false;
            screen = 'intro';
          } else {
            screen = 'game';
          }
          log(`開局（聯機）：地圖 ${start.globalMapId}　種子 ${start.seed}`);
          // ★ 背景曲从**片头过场里**就起了 @source 0x00415963 `push 1 / call sub_00454d91`
          //   —— 与单机 7629-7630 同一个点（`bgmBackground` 初值 false，这里不起就没人起）
          holidayBgmDays = 0;
          playBoardBgm(1);
          // ★ `Speaking.mkf` 进棋盘这一刻就开始拉（与单机 7637 同一理由；网页版是 no-op）
          ensureSpeakingArchive();
          // ★★ 開局**不说话** —— 与单机 `startGame()` 同一条（第十四份试玩回报 #1）：
          //   事件 26 是「输了续局」那一句（`fcn_00407842`，只在 `0x40cff0` / `0x41da2d` 调），
          //   新开一局的路（`0x406de7 → … → 0x415872` 跳伞过场）不说。
          // 换地图要重新解底图 —— `setGround(null)` 会 close 掉旧位图，
          // 先前这里只把 `ground` 置 null，旧 bitmap 就泄漏了（与单机 7650 对齐）
          // ★★ 第十六份试玩回报「以后两边模式都要同步」：先前这里漏了 `hdSource`（单机 `startGame()` 有）
          //   ⇒ 开了高清底图的人一进联机就退回原图。与单机同一个调用。
          setGround(null);
          void loadGround(archives, start.globalMapId, hdSource).then((g) => {
            ground = g;
            requestRender();
          });
          loadMinimapAssets(start.globalMapId);
          requestRender();
          renderPanel();
          scheduleAi();
          scheduleHumanTurn();
        },
        // ★★ 第七份试玩回报第 1 条：**收下**，不当场施加 —— 交给 `pumpNetInbox` 一条一条按演出节拍播。
        deferChecksum: true,
        onAction: (action, seq) => {
          netInbox.push({ action, seq });
          pumpNetInbox();
        },
        // ★ v8（gap-audit #7）：别的座位转来的纯演出提示 —— 排进收件箱同一个位置，轮到它才演
        onPresent: ({ seat, cue }) => {
          netInbox.push({ cue, seat });
          pumpNetInbox();
        },
        // ★★ 第十二份試玩回報：中途进房（刷新 / 断线重连）时「进房之前」的那一段 —— **静默**追上，
        //   不走 `pumpNetInbox` 那条会起演出的路（见 `catchUpSilently`）。
        onCatchUp: (items) => catchUpSilently(items),
        // ★ W-74：服务器广播的剩余毫秒（`-1` = 这一轮计时作废）
        onClock: (c) => {
          clockSeat = c.remainingMs < 0 ? null : c.seat;
          clockBaseMs = c.remainingMs;
          clockAt = performance.now();
          requestRender();
        },
        onError: (message) => {
          log(`⚠ 伺服器：${message}`);
          lastError = message;
          // ★ 本机那一掷被服务器拒了（`illegalAction` 等）⇒ 那条回包**不会来了**。
          //   当场把预测的滚骰收掉并松开节拍闸，别让它空转到 3 秒超时。
          //   （重复点 GO、超时被别人接管之后再发 intent，都会走到这里。）
          if (awaitingOwnRoll) {
            awaitingOwnRoll = false;
            diceFx.cancel();
            resumeTurnDriver();
          }
          // ★ 房间列表：还没坐下就被拒 ⇒ 这条连接没用了，回列表（把原因摆出来）
          if (client.seat === null && opts.onJoinFailed !== undefined) {
            closedByUs = true;
            ws.close();
            if (net === client) net = null;
            netClose = null;
            opts.onJoinFailed(message);
          }
        },
        // ★ 聯機存檔（v6）：房主存了一份檔 —— 全桌都知道
        onSaved: (name) => {
          log(`💾 房主存檔：${name}`);
          showNetNotice(`房主存了一份檔：「${name}」`);
        },
        onDesync: (d) =>
          log(`⚠ 失步！第 ${d.seq} 號後 ${d.seat + 1} 號座的校驗和 ${d.got} ≠ ${d.expected}，已請求全量重放`),
        // ★ Q-NET-1 自愈：服务器把**完整** action 日志重放回来了 → 整体重建本地状态。
        //   刻意不复用 `applyAction`：那条路会带出动画、音效、AI 排程，
        //   重放几百条等于把特效重放几百遍。这里是「静默」的 reduce，
        //   做完只催一帧并重排驱动。
        onResync: (r) => {
          map = parseMap(readMapData(archives, r.globalMapId));
          topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials, landscapes: map.landscapes };
          // ★ 同上：重放重建也必须带上开局选项 / 存檔快照（否则重建出来的不是同一局）
          state = initialNetState(r, map);
          history.length = 0;
          recorder.reset();
          // 收着没播的那些已经包含在这份重放里了（`NetClient` 把序号指针接成了 `actions.length`）
          clearNetInbox();
          for (const action of r.actions) {
            state = reduce(state, action, topo);
            history.push(action);
          }
          settleAfterSilentRebuild();
          log(`⟳ 失步自愈：重放 ${r.actions.length} 條 action，本地狀態已重建（第 ${r.actions.length} 號）`);
        },
        fingerprint: () => stateFingerprint(state),
      },
    );
    ws.onopen = () => {
      net = client;
      awaitingSentFor = Number.NaN;
      startNetTick();
      client.join();
    };
    ws.onmessage = (ev) => client.receive(String(ev.data));
    ws.onclose = () => {
      if (closedByUs) return;
      // ★ 聯機存檔（v6）：存檔房裡還沒入座的人，房主一開局就被請出去 ⇒ 回列表（那裡有「認領座位」）
      if ((client.seat ?? -1) < 0 && lastError !== null && opts.onJoinFailed !== undefined) {
        closedByUs = true;
        if (net === client) net = null;
        netClose = null;
        opts.onJoinFailed(lastError);
        return;
      }
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

// ============================================================
//  素材载入屏（W-72）
// ============================================================

/**
 * 网页版的素材载入：**7 个档案一次下完**（含 Speaking / Effect），带进度条与
 * Cache Storage；失败**不抛出去**，而是在载入屏上给一颗「重試」，点了再来一遍。
 *
 * ★ 为什么失败要能重试而不是崩到 `boot()` 的 catch：整包 ≈130 MB，
 *   中途断一次就得刷新整个页面重来，体验差得多。
 * ★ 7 个到齐之后才 `sound.addArchive` —— 这样联机时第一句语音不会丢
 *   （以前 Speaking / Effect 是后台拉的，见任务书 §1 对策②）。
 */
async function loadArchivesForWeb(): Promise<LoadedArchives> {
  for (;;) {
    try {
      showLoadingScreen();
      const loaded = await loadAllArchives(assetBase(), renderLoadProgress);
      // ★ HD 素材：清单里登记了超分清单就记下它的版本（见 `hdManifestVersion`）
      hdManifestVersion = loaded.manifest?.files.find((f) => f.name === HD_MANIFEST_NAME)?.sha256.slice(0, 8) ?? null;
      const speaking = loaded.archives.get('Speaking.mkf');
      const effect = loaded.archives.get('Effect.mkf');
      if (speaking !== undefined) {
        sound.addArchive('Speaking.mkf', speaking);
        log('語音载入：Speaking.mkf（角色語音）');
      }
      if (effect !== undefined) {
        sound.addArchive('Effect.mkf', effect);
        log('音效载入：Effect.mkf');
      }
      clearLoadingScreen();
      return archivesFromBytes(loaded.archives);
    } catch (err) {
      await showLoadFailure(err);
    }
  }
}

function showLoadingScreen(): void {
  metaEl.className = 'meta';
  metaEl.textContent = '正在载入素材… 0%';
  loadBarEl.hidden = false;
  loadFillEl.style.width = '0%';
  loadHintEl.hidden = false;
  loadRetryEl.hidden = true;
}

/**
 * 进度条。
 *
 * ⚠️ **只显示百分比**（任务书 W-72 §3）：分母是原始字节（247 MB）而实际流量是
 *   压缩后的（≈130 MB），把 MB 数放上来会让人以为下多了。
 */
function renderLoadProgress(p: LoadProgress): void {
  const pct = p.total > 0 ? Math.floor((p.loaded / p.total) * 100) : 0;
  metaEl.textContent = `正在载入素材… ${pct}%`;
  loadFillEl.style.width = `${pct}%`;
  // 已经从缓存里拿到过东西了 —— 「首次载入约 130 MB」那句就不必再挂着
  if (p.cachedHits > 0) loadHintEl.hidden = true;
}

/** 失败：亮出「重試」，返回的 Promise 在玩家**点了它**之后才 resolve */
function showLoadFailure(err: unknown): Promise<void> {
  metaEl.className = 'meta err';
  metaEl.textContent = `素材载入失敗：${err instanceof Error ? err.message : String(err)}`;
  loadBarEl.hidden = true;
  loadHintEl.hidden = true;
  loadRetryEl.hidden = false;
  return new Promise<void>((resolve) => {
    loadRetryEl.onclick = () => {
      loadRetryEl.onclick = null;
      resolve();
    };
  });
}

function clearLoadingScreen(): void {
  loadBarEl.hidden = true;
  loadHintEl.hidden = true;
  loadRetryEl.hidden = true;
  metaEl.className = 'meta';
}

/** ★ 聯機提示（右下角那一疊）—— 聯機存檔等用 */
function showNetNotice(text: string): void {
  netToasts.push(text);
}

/**
 * ★ 聯機存檔（v6）：遊戲內「儲存進度」在聯機時 —— 房主取個名字、存到伺服器。
 * 非房主只給一句提示（伺服器那邊也會拒）。
 */
async function promptNetSave(): Promise<void> {
  const client = net;
  if (client === null) return;
  if (client.seat === null || client.seat !== roomHostSeat(client.room)) {
    showNetNotice('只有房主能存檔（伺服器每過一天也會自動存一份）');
    return;
  }
  const name = await promptSaveName(defaultSaveName(state));
  if (name === null || net !== client) return;
  client.save(name);
}

/** 门厅 / 房间列表连哪台服务器：`?ws=` 给了就用它（本机调试），否则同源 `wss://<host>/ws` */
let foyerWsUrl: string | null = null;

function foyerUrl(): string {
  return foyerWsUrl ?? defaultWsUrl(window.location);
}

/**
 * ★ 门厅：**只在网页版、且地址里没有 `screen=` 调试参数时**，
 * 在素材载入完成之后、標題畫面之前出现（任务书 W-73 §1）。
 *
 * · **單人模式** ⇒ 关掉覆盖层，走现有標題畫面；
 * · **在線聯機** ⇒ 房间列表 ⇒ 「加入 / 重新連線 / 建立房間」⇒ 进大厅。
 *   进房失败（房间刚解散、人满了……）⇒ 带着那句话回到列表。
 */
async function openFoyer(opts: { view?: 'home' | 'rooms'; notice?: string; inviteRoom?: string | null } = {}): Promise<void> {
  const storage = browserStorage();
  const choice = await showFoyer({
    ...opts,
    wsUrl: foyerUrl(),
    clientId: loadClientId(storage),
    storage,
    hd: { on: hdStage, set: setHdStage },
  });
  if (choice.kind === 'solo') {
    enterTitleScreen();
    return;
  }
  joinFromFoyer(choice.room, choice.name, choice.mode, {
    ...(choice.fromSave === undefined ? {} : { fromSave: choice.fromSave }),
    ...(choice.claimSeat === undefined ? {} : { claimSeat: choice.claimSeat }),
  });
}

/** 从门厅 / 旧链接进一间房；进不去就回列表并把原因摆在最上面 */
function joinFromFoyer(
  room: string,
  name: string,
  mode: JoinMode,
  extra: { fromSave?: string; claimSeat?: number } = {},
): void {
  log(`房間 ${room}（${name}，${mode === 'create' ? '建立' : '加入'}）`);
  connectOnline(foyerUrl(), room, name, {
    mode,
    ...extra,
    onJoinFailed: (message) => void openFoyer({ view: 'rooms', notice: message }),
  });
}

/**
 * 网页版的旧邀请链接（`?room=`）：**直接进那一间**（名字存过的话连门厅都不停）。
 *
 * ★ `?room=` 用过一次就从地址里拿掉：之后从大厅退回列表、再刷新，不该又被拽回那一间
 *   （真断线了，列表上那一行会是「重新連線」）。
 */
function startFoyerInvite(invite: string): void {
  try {
    window.history.replaceState(null, '', window.location.pathname + withoutRoomParam(window.location.search));
  } catch {
    /* 拿不掉也不影响进房 */
  }
  const name = loadName(browserStorage());
  if (name !== '') joinFromFoyer(invite, name, 'join');
  else void openFoyer({ inviteRoom: invite });
}

// ============================================================
//  ★ W-74 回合计时（客户端这一半）
// ============================================================

/** 多久检查一次「本机是不是停在等输入上了」 */
const AWAITING_POLL_MS = 250;
/** `alive` 最快多久发一次（服务器那边也限了「每 10 秒最多一次」） */
const ALIVE_MIN_MS = 10_000;
/** 剩多少毫秒才把倒计时露出来（任务书 W-74 §74-e） */
const CLOCK_SHOW_MS = 20_000;
/** 轮到自己时最后这段变红 */
const CLOCK_HOT_MS = 10_000;
/** 倒计时落的舞台坐标 —— 棋盘（439×440 @ y=40）的右上角往内缩 8 px */
const CLOCK_STAGE = { x: 431, y: 48 } as const;

let netTick: number | null = null;
/** 已经为哪个 `seq` 报过 `awaiting`（`NaN` = 还没报过） */
let awaitingSentFor = Number.NaN;
let aliveSentAt = 0;
/** 服务器最近一次广播的剩余毫秒；`null` = 没在计时 */
let clockSeat: number | null = null;
let clockBaseMs = -1;
/** 收到那条广播的本地时刻 —— 倒计时靠它本地递减（服务器不会再发） */
let clockAt = 0;

// ============================================================
//  联机：广播来的 action **排队按节拍播**（第七份试玩回报第 1 条）
// ============================================================
//
// 服务器替电脑座位拿主意是**同步**的（`hub.ts` 的 `#driveComputers`）：真人一交出回合，
// 后面三家电脑的几十条 action 在同一瞬间广播过来。原先 `onAction` 收到就 `applyAction` ⇒
// 三家的回合「秒结束」，走子 / 掷骰 / 台词 / 影片全被后一条顶掉。
//
// 单机那边电脑是被 `scheduleAi` 按 `aiDelay()` + `holdForActorWalk()` 一步一步放出来的；
// 这里用**同一套闸**去放收件箱：台上有演出（补间 / 掷骰 / 影片 / 整屏 / 台词）就等，
// 演完再施加下一条，于是联机看到的节拍与单机一致。
//
// ★ 锁步不受影响：顺序不变，只是晚一点施加；校验和改在**真的施加完**那一刻取（`noteApplied`）。
// ★ `awaiting`（W-74）要等收件箱**放空**才报 —— 否则玩家还在看电脑走棋，60 秒已经开数了。

/**
 * 收件箱的一格：定序后的 action，或 ★ v8 别的座位转来的**纯演出**提示（`present`，gap-audit #7）——
 * 提示排在它到达那一刻的位置（`NetClient.onPresent` 保证在第 `after` 号之后），轮到它才演，不 reduce。
 */
type NetInboxItem = { action: Action; seq: number } | { cue: PresentCue; seat: number };

function isNetAction(item: NetInboxItem): item is { action: Action; seq: number } {
  return 'action' in item;
}

/** 收着还没播的广播 */
const netInbox: NetInboxItem[] = [];
let netPumpTimer: number | null = null;
/**
 * 积压超过这个数就不按节拍了，前面的**一口气**施加掉、只留最后这些慢慢播。
 * 什么时候会积压这么多：中途重连（服务器把整局补发过来）。三家电脑各走一回合约 30–50 条。
 */
const NET_INBOX_FAST_FORWARD = 150;
const NET_INBOX_KEEP = 40;

/**
 * ★★ 第十二份試玩回報（「断线重连后莫名其妙又进入魔法屋」「断线重连后所有文本提示又重新触发了一轮」）：
 * 中途进房时服务器补发的「进房之前」那一段 —— **只 reduce、不起任何演出**。
 *
 * 根因：先前补发与实时广播走同一条 `onAction → pumpNetInbox → applyAction` 路，
 * 而 `applyAction` 会经 `notifyApplied` 把每一条 `before → after` 派给各整屏的 `event()`。
 * 刷新页面后服务器从 0 号补发整局 ⇒ 整局的訊息框 / 命運 / 魔法屋 / 台词按节拍**重演一遍**
 * （回报里的日志：刷新后又出现第 25 回合那次「魔法屋：就地拆除房屋」、几十条「付费訊息框：…」；
 * 本地局面落后服务器十来个回合，还按旧局面替自己出手 → 「拒绝：notYourTurn」）。
 *
 * 口径：**每台只把实时发生的演出演一次**。进房之前的事，这台要么刷新前已经演过、
 * 要么断线期间根本不在 —— 都不补演；追上之后此刻还挂着的**待决交互**（自己的买地框、
 * 商店、銀行…）由 `state.pending` 照常画出来，不受影响。
 *
 * @param items `NetClient` 攒齐的补发（seq 连续、到 `start.through` 为止）
 */
function catchUpSilently(items: readonly { action: Action; seq: number }[]): void {
  // 断线前已经收下、还没轮到播的那几条排在补发**之前** —— 一并静默施加，保持顺序
  const queued = netInbox.splice(0);
  clearNetInbox();
  for (const item of [...queued, ...items]) {
    // ★ v8：排着的演出提示随追赶一并作废（那一刻已经过去了）
    if (!isNetAction(item)) continue;
    const next = reduce(state, item.action, topo);
    if (next !== state) history.push(item.action);
    state = next;
  }
  settleAfterSilentRebuild();
  log(`⟳ 聯機追上：靜默施加 ${queued.length + items.length} 條 action（第 ${state.turnCount} 回合）`);
}

/**
 * 本地状态被**静默**重建之后（失步重放 / 中途进房追上）的收尾：
 * 收掉指着旧局面的临时 UI 与「这一刻在播」的东西，按新局面重排两条回合驱动。
 */
function settleAfterSilentRebuild(): void {
  // 本屏的临时 UI 状态一律收掉：重放可能把 pending 换成了另一种，旧的指认不再成立
  amountPage = null;
  dialogHot = null;
  pick = null;
  pickHover = null;
  hoverNode = null;
  diceFx.cancel();
  // 本地状态已重建 ⇒ 那条自己在等的回包（以及它对应的预测动画）不再有意义
  awaitingOwnRoll = false;
  // ★ 建屋影片也是「这一刻在播」的东西：本地状态已经重建，旧片子不该接着放
  buildFx = null;
  pendingBuildFx = null;
  magicSeq = null;
  buildFlicPending.clear();
  releaseBuildFlics();
  // 影片窗口的 before 快照同理作废（状态已经重放重建，旧快照不再对应任何一帧）
  deferredBoardBefore = null;
  newsFlash = null; // 新聞 18 / 19 的白闪同属「这一刻在播」
  manifestHold = null;
  vehicleHold = null;
  godAscend = null;
  pendingCardFlight = null; // 挂起的卡片飞行（等亮牌）属于旧局
  pendingRelocateWalk = null; // 住进旅館那一段（审计 #17）同理
  renderer.clearRelocate();
  pendingCardRoute = null; // 亮牌后待走的那一张同理
  npcWalksDrawn = null;
  // ★ pt22：追上之后回合已不在本机 / 那一格已答掉 ⇒ 本机留着的模态窗一并收掉（同 `notifyApplied`）
  dropStaleLocalModals();
  // ★ 第十二份試玩回報：追上之后此刻仍挂着的**场所**（商店 / 銀行 / 路過銀行）照常铺起来 ——
  //   与 `notifyApplied` 同一道人机闸；它们平时只在「一条 action 落地」时同步。
  if (!aiVenuePending(state)) {
    syncShopUi();
    syncLoanUi();
    syncAtmPending();
  }
  // ★ 同理：追上之后仍挂着**真人**的魔法屋点选（`pending{magicHouse}`，重连前没点完）⇒ 把女巫窗口重新铺起来，
  //   否则这位真人只能干等回合计时替他托管。窗口只认「pending 刚挂出」，所以拿去掉 pending 的一份当 before。
  if (state.pending?.kind === 'magicHouse' && !magicScreenState().playing) {
    magicScreen.event?.({ ...state, pending: null }, state, uiEnv());
  }
  requestRender();
  renderPanel();
  scheduleAi();
  scheduleHumanTurn();
}

function clearNetInbox(): void {
  netInbox.length = 0;
  if (netPumpTimer !== null) {
    clearTimeout(netPumpTimer);
    netPumpTimer = null;
  }
}

/** 施加一条广播来的 action（原先 `onAction` 里的那三句）并按需报校验和 */
function applyNetAction(item: { action: Action; seq: number }): void {
  // ★ W-75：服务器那本「连续超时」的账是在**该座位交 intent** 那一刻清零的
  //   （`hub.ts` 的 `#submit`）。这里照抄同一条规则 —— 用**施加之前**的镜像
  //   算「这条 action 是谁派的」。
  netToasts.noteIntent(actingSeat(state));
  if (item.action.type === 'step') stepTick();
  applyAction(item.action);
  // ★ 本机那一掷的回包到了 ⇒ 撤销「在等回包」这一位（`predictRoll` 起的滚骰
  //   已在 `applyAction` 里由 `diceFx.roll()` 补上权威点数）。见 `awaitingOwnRoll`。
  if (item.action.type === 'rollDice') awaitingOwnRoll = false;
  net?.noteApplied(item.seq);
}

function pumpNetInbox(delay = 0): void {
  if (netPumpTimer !== null || netInbox.length === 0) return;
  // ★ 审计 #15：过场期间连「积压太多就静默快进」也不做（与 `catchUpNetAfterHidden` 同一条闸）——
  //   快进施加出来的框会占住整屏；过场放完再快进
  if (netInbox.length > NET_INBOX_FAST_FORWARD && screen !== 'intro') {
    while (netInbox.length > NET_INBOX_KEEP) {
      const item = netInbox.shift()!;
      // ★ v8：一口气施加的那一截里，演出提示直接丢（不演）
      if (isNetAction(item)) applyNetAction(item);
    }
  }
  netPumpTimer = window.setTimeout(() => {
    netPumpTimer = null;
    // ★★ 過場期間先別施加網絡 action（第九份试玩回报：联机接過場时一并补）。
    //   過場是**每台自己放、可各自跳過**的純表現（`intro.ts`，不派 action、不同步），
    //   先跳過的人一掷骰，伺服器就廣播；若這裡照常施加，還在看過場的人第一回合的
    //   演出（走子/買地/影片）會被靜默吞掉 —— 過場放完直接看到結果。
    //   排隊等它放完是安全的：過場有硬上限（4 人局 `introMs` ≤ 約 14.9 s），必然結束。
    if (screen === 'intro') {
      // ★ 第十九份：后台时过场不会前进（没有 rAF），别每 20 ms 空转
      if (pageHidden) driversParked = true;
      else pumpNetInbox(RENDER_MS);
      return;
    }
    // ★★ 放行「本机自己在等的那条 `rollDice` 回包」（第九份试玩回报「掷骰延迟」）。
    //
    //   改动前这里是死锁：`holdForActorWalk` 的 `diceFxActive` 这一位只能由
    //   `applyAction(rollDice)` → `diceFx.roll()` 清掉，而 `applyAction` 正被这道闸挡着
    //   ⇒ 每掷空转到 3 秒超时才松开（见 `awaitingOwnRoll` 的注释）。
    //
    //   ⚠️ 只放行**这一种**：`awaitingOwnRoll` 只在本机发出 `rollDice` 时置位，
    //   且要求队首就是 `rollDice`。电脑座位那一串 action 照旧受闸 —— 那正是
    //   第七份试玩回报第 1 条要的（别把电脑回合秒播完、别互相顶掉骰子动画）。
    const queuedHead = netInbox[0];
    // ★ v8：队首若是演出提示（`present`），`head` 为空 —— 下面那几道只认 action 的判据都不适用
    const head = queuedHead !== undefined && isNetAction(queuedHead) ? queuedHead : undefined;
    // ★★ 第十二份試玩回報续（需求方拍板：点得掉的整屏提示，旁观端跟着行动者一起关）：
    //   队首是**别的真人座位**派的下一条 ⇒ 他那台已经把此前的演出全部演完（点掉）了，
    //   本台还在演的那几屏直接落到终态，不再自己一段段放完（判据与边界见 `follow-presenter.ts`）。
    //   ⚠️ 必须在 `holdForActorWalk` 之前：那几屏正占着台，节拍闸会一直挡着。
    //   队首还没施加，此刻的 `state` 就是服务器受理它那一刻的镜像。
    if (head !== undefined && presenterMovedOn(state, head.action, net?.seat ?? null)) followPresenter();
    // ★ v8：队首是别的真人转来的演出提示（`present`）⇒ 同样说明他那台已经把此前的演出演完（点掉）了
    //   （服务器只收「轮到的那一座、不是代打」的 `present`，故发起者必是真人自己的客户端）
    else if (queuedHead !== undefined && !isNetAction(queuedHead) && queuedHead.seat !== (net?.seat ?? null)) followPresenter();
    const ownRollEcho = awaitingOwnRoll && head !== undefined && head.action.type === 'rollDice';
    if (!ownRollEcho && holdForActorWalk(() => pumpNetInbox(RENDER_MS))) return;
    const item = netInbox.shift();
    if (item === undefined) return;
    // ★ v8：演出提示过了同一道节拍闸才演（不 reduce、不报校验和）
    if (!isNetAction(item)) {
      applyNetCue(item.seat, item.cue);
      pumpNetInbox(paceDelay());
      return;
    }
    applyNetAction(item);
    // `aiNext` 只是决策链的内部簿记，不占时间（同 `aiDelay`）；其余至少一个 tick、走子等补间
    pumpNetInbox(item.action.type === 'aiNext' ? 0 : paceDelay());
  }, delay);
}

/**
 * 跟着行动者收场：演出类整屏（`BLOCKING_PRESENTATIONS`）一律落到终态（各屏的 `fastForward`）。
 *
 * ★ 顺手收掉那几屏经 `voice-sink` 起的语音（女巫 / 開獎主持人 / 事件框里的 `#NNNN`）——
 *   屏已经关了，话不该接着说。只停**文本语音**那一路（`lastVoiceCode`）；角色台词
 *   （`speechQueue`，棋盘上的气泡）不属于整屏，照常演。
 */
function followPresenter(): void {
  const closed = fastForwardPresentations(SCREENS, BLOCKING_PRESENTATIONS, uiEnv());
  // ★ 魔法屋逐人那几段（D-MAGIC-16）同样属于已施加的 action ⇒ 剩下的不演了
  if (magicSeq !== null) {
    magicSeq = null;
    closed.push('magicBeats');
  }
  if (closed.length === 0) return;
  const voice = lastVoiceCode;
  if (voice !== null && spokenBubble?.voice !== voice && sound.isPlaying('Speaking.mkf', voice)) {
    sound.stop('Speaking.mkf', voice);
  }
  log(`⏭ 跟著 P${actingSeat(state) + 1} 收場：${closed.join(' / ')}`);
  requestRender();
}

function startNetTick(): void {
  if (netTick === null) netTick = window.setInterval(tickAwaiting, AWAITING_POLL_MS);
}

/** 画面此刻是不是**停在等本机输入**上（任务书 W-74 §74-b） */
function waitingForInput(s: GameState): boolean {
  if (s.phase === 'awaitingRoll' || s.phase === 'awaitingDecision') return true;
  const kind = s.pending?.kind;
  return kind !== undefined && kind !== 'none';
}

/**
 * ★ W-74 §74-b：轮到本机座位、动画演完（`stageBusy()` 为假）、画面停在等输入
 * ⇒ 对**当前** `seq` 报一次（同一个 `seq` 不重发）。
 *
 * 服务器收到才开始数 60 秒。不报也有 45 秒兜底，但那样等于把演出时间算进了玩家的账。
 */
function tickAwaiting(): void {
  const client = net;
  if (client === null || client.seat === null || screen !== 'game') return;
  // ★ 第十二份試玩回報：还在追「进房之前」那一段 —— 本地状态是旧的，别替它报「在等输入」
  if (client.catchingUp) return;
  if (actingSeat(state) !== client.seat) return;
  // ★ 收件箱没放空 = 画面还在播别人的回合，本机状态也还没追上服务器 —— 不报
  if (netInbox.length > 0) return;
  if (stageBusy(stageBusyFlags())) return;
  if (!waitingForInput(state)) return;
  const seq = client.expectedSeq - 1;
  if (seq === awaitingSentFor) return;
  awaitingSentFor = seq;
  client.awaiting(seq);
}

/** ★ W-74 §74-c：有鼠标 / 键盘输入就报「我还在」（每 10 秒最多一次） */
function noteAlive(): void {
  const client = net;
  if (client === null || client.seat === null) return;
  if (clockSeat !== client.seat) return;
  const now = performance.now();
  if (now - aliveSentAt < ALIVE_MIN_MS) return;
  aliveSentAt = now;
  client.alive();
}

/**
 * ★ W-74 §74-d 第 3 条：本机座位被**超时**託管时，玩家点一下画面就把座位收回来。
 * @returns 真的发了 `resume` 吗（是的话这一次点击不再往下传）
 */
function reclaimIfAutopiloted(): boolean {
  const client = net;
  if (client === null || client.seat === null) return false;
  if (client.room?.seats.find((s) => s.seat === client.seat)?.autopilot !== 'idle') return false;
  awaitingSentFor = Number.NaN; // 收回来之后要能重新报 `awaiting`
  client.resume();
  return true;
}

/** 本地递减后的剩余毫秒（服务器只在开始 / 延长 / 作废时各发一次，不会逐秒推） */
function clockLeftMs(): number {
  if (clockSeat === null) return -1;
  return Math.max(0, clockBaseMs - (performance.now() - clockAt));
}

// ============================================================
//  触屏的「取消」钮（需求方 2026-09-24：触屏上没有右键，用了卡片 / 开了卡片欄就退不出来）
// ============================================================
//
//  点它 = 在画布上派**一次右键**（`contextmenu`），走的就是下面 `bindInput` 里那条右键处理，
//  不另写取消逻辑。只在触屏、且 `rightClickMeaningfulNow()` 为真时露出来；
//  放在舞台外的黑边里（竖屏手机在下、横放 iPad 在右），放不下才压在棋盘右下角。

const touchCancelEl = $<HTMLButtonElement>('touchcancel');
touchCancelEl.addEventListener('click', (e) => {
  e.preventDefault();
  // 各屏的 `contextmenu` 都不看坐标，但 `main.ts` 那条处理要求落在舞台里 ⇒ 取舞台正中
  const c = stageToClient(SCREEN_W / 2, SCREEN_H / 2);
  dispatchMouse(canvas, 'contextmenu', c.x, c.y);
  requestRender();
});

/** 舞台坐标 → 页面 CSS 像素（`eventToStage` 反过来）*/
function stageToClient(x: number, y: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const m = currentMetrics();
  const dpr = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
  return { x: rect.left + (m.offsetX + x * m.scale) / dpr, y: rect.top + (m.offsetY + y * m.scale) / dpr };
}

function syncTouchCancel(): void {
  const show = isTouchDevice(window) && rightClickMeaningfulNow();
  if (!show) {
    if (!touchCancelEl.hidden) touchCancelEl.hidden = true;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const tl = stageToClient(0, 0);
  const br = stageToClient(SCREEN_W, SCREEN_H);
  const at = cancelButtonPlacement(
    { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    { left: tl.x, top: tl.y, width: br.x - tl.x, height: br.y - tl.y },
  );
  touchCancelEl.className = at.mode;
  touchCancelEl.style.left = `${at.left}px`;
  touchCancelEl.style.top = `${at.top}px`;
  touchCancelEl.style.width = `${at.width}px`;
  touchCancelEl.style.height = `${at.height}px`;
  touchCancelEl.hidden = false;
}

/** 棋盘右上角那颗倒计时 */
function syncClockOverlay(): void {
  const left = clockLeftMs();
  const show = screen === 'game' && clockSeat !== null && left <= CLOCK_SHOW_MS;
  if (!show) {
    if (!clockEl.hidden) clockEl.hidden = true;
    return;
  }
  const seat = clockSeat as number;
  const mine = net !== null && net.seat === seat;
  clockNumEl.textContent = String(Math.ceil(left / 1000));
  // 名字在 `SeatInfo` 上（`Player` 只带角色与钱）
  clockNameEl.textContent = net?.room?.seats.find((s) => s.seat === seat)?.name ?? `${seat + 1} 號座`;
  clockEl.classList.toggle('hot', mine && left <= CLOCK_HOT_MS);
  // 舞台坐标 → CSS 像素（与 `eventToStage` 同一套 metrics，方向反过来）
  const rect = canvas.getBoundingClientRect();
  const metrics = currentMetrics();
  const dpr = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
  clockEl.style.left = `${rect.left + (metrics.offsetX + CLOCK_STAGE.x * metrics.scale) / dpr}px`;
  clockEl.style.top = `${rect.top + (metrics.offsetY + CLOCK_STAGE.y * metrics.scale) / dpr}px`;
  clockEl.style.transform = 'translateX(-100%)';
  clockEl.hidden = false;
  // 它要一格格往下走 ⇒ 自己续帧（服务器不会再发）
  requestRender();
}

async function boot(): Promise<void> {
  try {
    await ensureGameDir();
    // ★ W-72：网页版走「一次下完 7 个」那条路（带进度条 + Cache Storage）；
    //   桌面壳一行没变 —— 还是边拉边开那 5 个基础档案。
    if (isDesktop()) {
      metaEl.textContent = '正在载入素材…';
      archives = await loadArchives(assetBase());
    } else {
      archives = await loadArchivesForWeb();
    }
    // 新聞/命運 插画与 抽卡 卡面是**无头 RGB555 块**（Data.mkf #441+/#477+/#571+），
    // 走不了 `sprite()`（它要求 SPR/SMP 签名）。把档案句柄交给那一屏，照
    // `minigame-bg.ts` 的同一条路子取原图（见 `event-box-screen.ts` 头注释）。
    setEventBoxArchives(archives);

    // HD 素材可选：拿不到清单（没跑过超分管线、或整个 assets/hd/ 不存在）
    // 就整包走原图。**按图**回退在 SpriteCache 里（PRD §4.5）。
    // ★ W-72：网页版先看清单里有没有 `hd-manifest.json` —— `assets/hd/` 是空的，
    //   那份 3.8 MB 的清单白拉（任务书 §1 末条）。
    // ★ 高清关着（`?hd=0` / 门厅里取消勾选）就一次都不拉超分清单 —— 与改造前一致
    hdSource = hdStage ? await loadHdSource(hdBase(), hdManifestVersion) : null;
    sprites = new SpriteCache(archives, { hdFlics, ...(hdSource === null ? {} : { hd: hdSource }) });
    // ★ 高清图是后台拉、到了原地换位图（先原图、后高清）—— 换上来那一刻重画一帧
    sprites.addUpgradeListener(() => requestRender());
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
    // 企鵝挖寶的命中表（Panel.mkf #81，640×480 每像素 = 格号）—— 同一个已过素材闸门的 Panel.mkf，
    // 取原始字节即可（D-MINI-2 已解，原版 0x00414ae1..0x00414b2f 逐像素查）
    setPenguinHitMask(parsePenguinHitMask(readRawBytes(archives, 'Panel.mkf', PENGUIN_HIT_RES)));
    // 通用填数窗的逐像素 id 图（Panel.mkf #0x16，128×192，每像素 = 钮号）—— 同一条 raw 出口；
    //   载到了 `hitDialog` 就照 exe 取号（`amountPixelId`，0x00452d4f..0x00452d5b），没载到退回矩形表
    setAmountHitMap(parseAmountHitMap(readRawBytes(archives, 'Panel.mkf', AMOUNT_WINDOW.hitResource)));
    // 新聞/命運 插画 + 抽卡 卡面也是无头 RGB555 块 —— 同一条 raw 出口，
    // 解好一张催一帧（图异步到，画的时候可能还没有）
    onEventBoxArtReady(requestRender);
    resizeCanvas();
    // ★ 原版开局就是人物视角（等距投影、跟着棋子），全局看右下角小地图
    const first = map.nodes[state.players[0]?.nodeId ?? 1];
    camera = pixelCamera(first?.x ?? 0, first?.y ?? 0, state.viewRotation);
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
        get recorder() {
          // `devPatched` 是 W-53 的脏标志 —— 有它才能在控制台里确认「下一次 F9 报告会被拒验指纹」
          return { trail: recorder.trailLength, errors: recorder.errorCount, devPatched: recorder.devPatched };
        },
        get hoverNode() { return hoverNode; },
        get screen() { return screen; },
        /** 目标拾取会话（T-026）—— `null` = 没在拾取 */
        get pickSession() { return pick; },
        /** 拾取模式下光标底下是第几个候选（`null` = 红叉 / 没在拾取）*/
        get pickHover() { return pickHover; },
        /** 拾取候选此刻在**页面 CSS 像素**上的落点（不在视野内的不列）—— 给无头验收把鼠标真的移过去点 */
        pickTargetsOnPage: () => {
          if (pick === null) return [];
          const out: { i: number; code: number | null; nodeId: number; x: number; y: number }[] = [];
          for (const [i, c] of pick.candidates.entries()) {
            const q = worldToScreen(c.wx, c.wy, camera, { w: LAYOUT.board.w, h: LAYOUT.board.h });
            if (q === null || q.x < 0 || q.y < 0 || q.x >= LAYOUT.board.w || q.y >= LAYOUT.board.h) continue;
            const pt = stageToClient(q.x + LAYOUT.board.x, q.y + LAYOUT.board.y);
            out.push({ i, code: c.code ?? null, nodeId: c.nodeId, x: pt.x, y: pt.y });
          }
          return out;
        },
        /** 软件指针（`soft-cursor.ts`）：此刻要哪一支 + 画着的图号 / 舞台落点（没画 = `null`）+ 画布上的系统指针 */
        cursor: () => ({
          frame: cursorFrame(),
          want: cursorWant(),
          drawn: softCursor.drawn(),
          os: canvas.style.cursor,
          seat: net?.seat ?? null,
        }),
        /** 個人資產表的故事板状态 */
        get sheetUi() { return sheetUi; },
        /** 託管AI 屏：草稿 + 选中行 + 按下的控件（`null` = 没开）*/
        get aiModel() { return aiModel; },
        /** 通用填数页（`null` = 没开）+ 按下时记下的那一颗 */
        get amountPage() { return amountPage; },
        get amountHeld() { return amountPress.held; },
        /** 卡片商店／道具商店的界面状态（页号、滑入位置、气泡、货架快照）*/
        get shopUi() { return shopUi; },
        /** 还款提醒窗的演出状态（`null` = 没开）*/
        get reminderUi() { return reminderUi; },
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
        /** ★ 第十六份：驱动 / 收件箱被演出挡了多久（按原因）与演出死锁看门狗放行次数 */
        presStats: () => ({
          unwinds: presentationStats.unwinds,
          holdMs: Object.fromEntries(Object.entries(presentationStats.holdMs).map(([k, v]) => [k, Math.round(v)])),
        }),
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
        /** ★ 第十九份：绘制指令去重的计数（帧 / 真画 / 跳过 / 自检不符）—— 给 `tools/perf-mobile-pw.mjs` 用 */
        renderStats: () => ({ ...displayList.stats }),
        /**
         * ★ W-80 §8：高清舞台此刻的状态 —— 开没开、倍率 / 上限、三块离屏画布的像素、超分来源接没接。
         *   给 `tools/perf-mobile-pw.mjs`（`HD=1`）量「高清把画布像素放大了多少」用。
         */
        hdStats: () => ({
          hd: hdStage,
          scale: surfaceScale,
          cap: hdScaleCap,
          flics: hdFlics,
          hdSource: hdSource !== null,
          stage: [stage.width, stage.height],
          board: [boardCanvas.width, boardCanvas.height],
          hud: [hudCanvasOff.width, hudCanvasOff.height],
          surfacePx: stage.width * stage.height + boardCanvas.width * boardCanvas.height + hudCanvasOff.width * hudCanvasOff.height,
        }),
        /** ★ W-80 §8：门厅那个勾选框的同一条路（自动化切换高清用） */
        setHd: (on: boolean) => setHdStage(on),
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
          amountWindowOpened();
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
        lotteryDraw: (won = true) => {
          const lot = new Array<number>(36).fill(0);
          lot[6] = 1; // 1 号玩家持 07 号
          const before: GameState = {
            ...state,
            day: 14,
            totalDays: state.totalDays,
            pool: 5000,
            lottery: lot,
            lastLotteryDraw: null,
            players: state.players.map((p, i) => (i === 0 && won ? { ...p, cash: p.cash + 5000 } : p)),
          };
          // ★ 开出的号由 core 交出来（`lastLotteryDraw`）：中奖开 07（槽 6），空号开 23（槽 22）
          const after: GameState = {
            ...before,
            day: 15,
            totalDays: before.totalDays + 1,
            pool: won ? 0 : 5000,
            lottery: won ? new Array<number>(36).fill(0) : [...lot],
            lastLotteryDraw: { number: won ? 6 : 22, winner: won ? 0 : null, pool: 5000, sold: [...lot] },
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
        /**
         * ★ gap-audit #4 活体验收：拍卖屏每一口挥槌的取证（来源 / 起点 / 实际画出的帧）+ 本机回包没演第二遍的次数。
         *   `auctionTrace(true)` 开（清空）、`auctionTrace()` 读 —— 见 `tools/net-e2e-auction.mjs`。
         */
        auctionTrace: (on?: boolean) => auctionTrace(on),
        /** ★ gap-audit #4：整屏音效的发出记录（`performance.now()` + 音效号；DEV 才记）*/
        sfxLog: () => [...devSfxLog],
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
         * ★ 魔法屋那一屏的状态（`magicScreenState()`）：`playing` / `state`（原版 `[0x48c3a2]` 1..8）/
         *   `line`（字框里那一句，`null` = 收起）/ `criterion` / `chosen` / `hover` / `interactive`。
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
        /**
         * ★ W-14 / E-21：真人此刻被一块**对话框按钮答不掉**的屏拦着时，该用哪一个**真实手势**出去。
         *   `tools/soak-browser.js` 的真人路径先问它；返回 null = 没有这种屏，照旧点对话框按钮。
         *
         *   落点一律取各屏**自己的**命中框常量（`auctionButtonRect` / `SHOP_EXIT_HIT`），
         *   保釋屏走原版的通用出口 —— **右键**（`WM_RBUTTONUP 0x205`，`panel-cancel.ts` 的 `bail` 层）；
         *   填数页敲键盘。脚本只管把手势发成真实的鼠标 / 键盘事件。
         */
        humanExit: (): {
          gesture: 'click' | 'rightClick' | 'keys';
          x: number;
          y: number;
          why: string;
          keys?: readonly string[];
        } | null => {
          if (screen !== 'game') return null;
          const pass = auctionHumanPassPoint(uiEnv());
          if (pass !== null) return { gesture: 'click', x: pass.x, y: pass.y, why: 'auction:PASS' };
          // 「請選擇設施類別」浮窗：右键在免费代蓋那一支**无效**（E-20）⇒ 真实出口 = 点一格。
          //   点第 2 格（旅館）：落点取本窗自己的命中框（`PICKER_HIT` + `PICKER_STRIDE`）。
          if (activeUiScreen()?.id === 'facility-picker') {
            return {
              gesture: 'click',
              x: PICKER_HIT.x0 + PICKER_STRIDE + PICKER_STRIDE / 2,
              y: (PICKER_HIT.y0 + PICKER_HIT.y1) / 2,
              why: 'facility-picker:slot1',
            };
          }
          // 魔法屋女巫窗口：状态 7 等真人点一格（原版窗口返回值 = 效果号，`0x004338b7`）
          //   ⇒ 真实出口 = 点一圈里的一格；落点取本屏自己的图标中心表（`MAGIC_RING_AT`）
          if (activeUiScreen()?.id === 'magic') {
            const pick = magicHumanPickPoint();
            return pick === null ? null : { gesture: 'click', x: pick.x, y: pick.y, why: 'magic:pick' };
          }
          // 其余登记的整屏（轉盤 / 訊息框 / 事件框…）自己演、自己收，脚本不伸手
          if (activeUiScreen() !== null) return null;
          const mid = { x: LAYOUT.board.x + LAYOUT.board.w / 2, y: LAYOUT.board.y + LAYOUT.board.h / 2 };
          if (shopUi !== null) {
            if (shopUi.closing) return null;
            return {
              gesture: 'click',
              x: (SHOP_EXIT_HIT.x0 + SHOP_EXIT_HIT.x1) / 2,
              y: (SHOP_EXIT_HIT.y0 + SHOP_EXIT_HIT.y1) / 2,
              why: 'shop:EXIT',
            };
          }
          if (bailScreenOn()) return { gesture: 'rightClick', ...mid, why: 'bail' };
          // 建設公司选地（点地图）：真实出口 = 右键（窗交回 0，`0x004466c6`）
          if (pick?.source.kind === 'build') return { gesture: 'rightClick', ...mid, why: 'build-pick' };
          // 通用填数页：右键只是退回上一扇 YES/NO（脚本再点 YES 就成了死循环）⇒ 真人的做法是
          //   **敲数字 + Enter**（那扇窗自己认主键盘 0-9 / Enter，@source `loc_00452e4b`）。
          if (amountPage !== null) {
            return { gesture: 'keys', ...mid, why: 'amountPage', keys: ['Digit1', 'Enter'] };
          }
          return null;
        },
        /**
         * ★ W-14：台上此刻是不是在**正当演出**（影片 / 整屏回放 / 补间 / 台词）——
         *   `tools/soak-browser.js` 的停摆判据要用：魔法屋回放 + 四家各一段建屋影片这种长串，
         *   `phase|currentPlayer|pending` 会 25 秒不变，但那不是卡死。判据就是回合驱动自己用的那一套
         *   （`stageBusy(stageBusyFlags())` + 台词队列），不另写一份。
         */
        stageBusy: () => ({
          busy: stageBusy(stageBusyFlags()) || speechQueue.length > 0 || heldSpeech.length > 0,
          flags: stageBusyFlags(),
          speech: speechQueue.length,
          deferred: heldSpeech.length > 0,
        }),
        /** 查一张图的尺寸与锚点 —— 命中判定对不上时先看这个 */
        sprite: (archive: 'Data.mkf' | 'Panel.mkf', res: number, idx: number, key = false) => {
          const s2 = spriteNow(archive, res, idx, key);
          return s2 === null
            ? null
            : // bw/bh = 位图像素（超分图比逻辑 w/h 大）—— 验「先原图、后高清」用
              { w: s2.width, h: s2.height, ax: s2.anchorX, ay: s2.anchorY, bw: s2.bitmap.width, bh: s2.bitmap.height };
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
         * ★ W-66-b：每段走子补间起步时与「上一段理论结束」的缝（毫秒）。
         * 读数用法：跑 30 格，取中位数 / p95 —— 中位数 ≤ 10 ms 就说明缝可忽略。
         */
        walkGaps: () => [...walkGaps],
        /**
         * 骰子那一段现在到哪一相了 —— 长跑排错用（纯读）。
         * `active` 恒真而 `phase` 不前进 = 「掷完骰子人不走」那一类卡死。
         */
        diceState: () => ({ phase: diceFx.phase, active: diceFx.active }),
        /**
         * ★★ **开发用的状态注入口**（W-53）—— 把状态直接摆到「那一刻」，再去验收画面。
         *
         * ```js
         * __rich4.debug.patch((s) => ({ ...s, players: ... }))   // 任意改写
         * __rich4.debug.dog()                                    // 配方 ①：踩惡犬
         * __rich4.debug.god(9)                                   // 配方 ②：天使（godInfo = 9）
         * __rich4.debug.god(5)                                   // 配方 ③：小窮神（godInfo = 5，附身）
         * __rich4.debug.nextNode()                               // 当前玩家的下一个落点
         * ```
         *
         * ⚠️ **它绕过 `reduceRecorded`**：状态与记录仪里的 action 流从此对不上。
         *   故每次调用都往 `logRing` 记一行 `[dev] state patched`、并把记录仪标脏
         *   （报告带 `devPatched: true`，`tools/replay-report.ts` 见到它拒绝验指纹）。
         *   配方写法见 `docs/handoff.md` §2 与 `dev-patch.ts`。
         */
        debug: {
          patch: (fn: (s: GameState) => GameState) => {
            const next = applyPatch(
              { getState: () => state, setState: (s) => { state = s; }, log, taint: () => recorder.taint() },
              fn,
            );
            requestRender();
            return next;
          },
          /** 当前玩家的下一个落点（与引擎走一步同一个 `pickNextNode`，只算不走）*/
          nextNode: () => nextNodeOf(state, topo),
          /** 配方 ①：把一只惡犬摆到下一个落点（踩上去那一条的复现入口）*/
          dog: () => {
            const out = placeDogAhead(state, topo);
            state = out.state;
            log(dogLogLine(out));
            recorder.taint();
            requestRender();
            return out.nodeId;
          },
          /** 配方 ②③：给当前玩家一个附身神明；`godInfo` = **物件下标 + 1**（天使 9 / 小窮神 5）*/
          god: (target = 9) => {
            if (target !== 9 && target !== 5) {
              log(`[dev] god(${target})：只有 9（天使）/ 5（小窮神）两条配方，没动状态`);
              return 0;
            }
            const out = target === 5 ? giveSmallPovertyGod(state) : giveAngel(state);
            state = out.state;
            log(attachLogLine(target === 5 ? '小窮神' : '天使', out));
            recorder.taint();
            requestRender();
            return out.godInfo;
          },
        },
      };
    }

    document.body.classList.add('no-debug');
    bindInput();
    // ★ 触屏：长按 = 右键；点 / 拖照旧派成鼠标事件，由上面同一批监听收（见 `touch-input.ts`）
    //   金额条那几屏长按不算右键（`longPressAllowedNow`）
    bindTouchGestures(canvas, { longPress: longPressAllowedNow });
    // ★ 第一次交互就解锁音频 —— 画布之外的任意一点/任意一键也算（autoplay 政策）
    bindAudioUnlock();
    // ★ 第十九份：切后台 / 回前台（音频挂起、驱动停在闸口、回来静默追上）
    bindPageVisibility();
    // ★ W-74：「我还在这儿」——只要有鼠标 / 键盘输入就报一次（自己有 10 秒节流）
    for (const type of ['mousemove', 'mousedown', 'keydown', 'wheel'] as const) {
      window.addEventListener(type, noteAlive, { passive: true });
    }
    // ★ W-73：老的 `?ws=…&room=…&name=…` 调试入口**保留**（`tools/net-e2e.js` 在用），
    //   它优先级最高；其次是 `?screen=` 调试屏；两者都没有才轮到门厅。
    //   ★ 房间列表（2026-09-23）：`?ws=` **单独**出现时不再算老入口 —— 只换门厅连的服务器地址。
    const debugScreen = new URLSearchParams(window.location.search).has('screen');
    const entry = foyerEntry(window.location.search);
    const online = entry.kind === 'direct' ? netParamsFrom(window.location.search) : null;
    lastToastRoom = null;
    if (online !== null) connectOnline(online.url, online.room, online.name);
    else if (straightToGame) startGame();
    else if (isDesktop() || debugScreen) enterTitleScreen();
    else if (entry.kind === 'foyer') {
      foyerWsUrl = entry.wsUrl;
      if (entry.inviteRoom === null) void openFoyer();
      else startFoyerInvite(entry.inviteRoom);
    }
    // ★ 一进標題就点 MIDI01（原版 `ui_main.asm:187` → `fcn_004549cf(0)`）。
    //   此刻通常还没有用户手势：`MusicPlayer.play()` 会把它记成 **pending**，
    //   第一次交互时立刻补播，不用再等一次 fetch —— 这就是「打开游戏后
    //   背景音乐要能自动响」（浏览器 autoplay 政策只允许手势之后出声）。
    requestRender();
    renderPanel();
    log(`地图载入：${map.nodes.length} 个节点、${map.lands.length} 块地`);

    // 音效档案后台拉取。Speaking.mkf 有 57MB，先不装。
    // ★ W-72：**网页版不用拉** —— `loadArchivesForWeb` 已经把 Effect.mkf（和
    //   Speaking.mkf）装进 `sound` 了，再拉一次就是白拉 3.9 MB。
    //   桌面壳没有「整包预载」这一步，行为一行没变。
    if (isDesktop()) {
      void fetch(`${assetBase()}/Effect.mkf`)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((buf) => {
          if (buf === null) return;
          sound.addArchive('Effect.mkf', new Uint8Array(buf));
          log('音效载入：Effect.mkf（首次点击后开声）');
        })
        .catch(() => log('⚠ 音效载入失败'));
    }

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
