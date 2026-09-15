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
import {
  autoAction,
  VEHICLE_DICE,
  teleportPlayer,
  decideAction,
  isAiTurn,
  PANEL_PAGE_COUNT,
  holidayIndexOf,
  DEFAULT_INITIAL_FUND,
  MAX_HAND_CARDS,
  MAX_TOOL_COUNT,
  newGame,
  reduce,
  parseMap,
  parseSave,
  importOriginalSave,
  STOCK_STATUS,
  stockStatus,
  stateFingerprint,
  toolCount,
  type Action,
  type GameState,
  type MapTopology,
  type Rich4Map,
  type RoomInfo,
  type TargetClass,
} from '@rich4/core';
import { NetClient, netParamsFrom } from './net-client.ts';
import { DiceRollFx, DICE_SOUND as DICE_ROLL_SOUND } from './dice-roll.ts';
import { tickMs } from './tick.ts';
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
  readMapData,
  SpriteCache,
  loadHolidayArt,
  loadMinimapBackground,
  screenDirection,
  type ArchiveName,
  type LoadedArchives,
  type Sprite,
} from './assets.ts';
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
import { SoundPlayer } from './audio.ts';
import { MusicPlayer } from './music.ts';
import {
  assetBase,
  currentGameDir,
  initSaveStore,
  hdBase,
  isDesktop,
  hostLog,
  pickGameDir,
  type PickResult,
} from './host.ts';
import { MIDI_PLAYLIST, MOVE_SOUND, SOUND_IDS } from '@rich4/assets-pipeline';
import {
  BoardRenderer,
  characterCamera,
  fitCamera,
  hitToolbar,
  pickNodeAt,
  screenToMap,
  worldToScreen,
  type Camera,
} from './render.ts';
import { TOOLBAR_LABELS, loadSetupScene as loadSetupSceneAsset } from './assets.ts';
import { interactionUi, type InteractionUi } from './interactions.ts';
import {
  drawAdvance,
  drawDialog,
  drawDice,
  drawDiceFlic,
  hitAdvance,
  hitDiceToggle,
  hitDialog,
  layoutDialog,
  type AmountPage,
  type DialogHit,
} from './dialog.ts';
import { DICE_FLIC_BASE, GO_IMAGE, type SpriteFn } from './gameui.ts';
import { CHARACTER_POSE, characterSetBase, type LoadedFlic } from './assets.ts';
import { HOTKEY, hotkeyOf } from './hotkeys.ts';
import { SCENE_ARCHIVE, sceneFor } from './scenes.ts';
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
  drawStockScreen,
  hitStockPlate,
  hitStockRow,
  stockCounterClosed,
  stockRowsFrom,
  type StockView,
} from './stock-screen.ts';
import {
  drawBankLoan,
  hitLoanButton,
  loanActionOf,
  type LoanOp,
} from './bank-loan.ts';
import {
  atmAmount,
  atmPress,
  drawBankAtm,
  hitAtmButton,
  type AtmState,
} from './bank-screen.ts';
import {
  INV_VEHICLE_IMAGE,
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
  SHOP_SLIDE,
  SHOP_SLIDE_MS,
  blinkStart,
  blinkStep,
  cellItemAt,
  drawShopScreen,
  hitShopCell,
  hitShopExit,
  hitShopShelf,
  hitShopSwitch,
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
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';
import {
  CURSOR_ARCHIVE,
  CURSOR_RESOURCE,
  TOOL_SELECT_PARAM,
  hitCandidate,
  pickCursorFor,
  startPick,
  type PickSession,
} from './picking.ts';
import {
  MONEY_VALUES,
  defaultSetup,
  drawSetup,
  fillComputerSeats,
  setupDown,
  setupMove,
  setupUp,
  type SetupState,
} from './setup.ts';
import { VIEW_COUNT } from '@rich4/data';

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

function log(msg: string): void {
  hostLog(msg);
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

/** 对话框正在填数的那一页；`null` 表示还在选项页 */
let amountPage: AmountPage | null = null;

/**
 * 銀行 ATM 面板（T-029a）—— 原版的「存款/提款」不是通用填数页，
 * 是 `Panel.mkf` 资源 24 那台带数字键盘的 ATM（VA 0x4379c9）。
 * `atmFill` 就是那条选项自带的 `amount.fill`（金额定了才发得出去）。
 */
let atm: AtmState | null = null;
let atmFill: ((n: number) => Action) | null = null;
let atmLabel = '';

/** 关掉 ATM 面板 */
function closeAtm(): void {
  atm = null;
  atmFill = null;
}

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
  amountPage = { choice: idx, value: c.amount.max };
  dialogHot = null;
  requestRender();
}
let dialogHot: DialogHit | null = null;

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
  requestRender();
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
    hover: stockHover,
    selected: stockSel,
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
    const afford = Math.trunc(me.moneyInBank / st.price);
    const max = Math.min(st.f10, Number.isFinite(afford) ? afford : 0);
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
  amountPage = { choice: 0, value: stockAmount.max };
  dialogHot = null;
  requestRender();
}

/** 把股市的填数页伪装成一个「对话」给通用排版用 */
function stockAmountUi(): InteractionUi | null {
  const a = stockAmount;
  if (a === null) return null;
  const name = stockNames()[a.stock] ?? '';
  const label = a.kind === 'buy' ? '買進股數' : '賣出股數';
  const fill = (n: number): Action =>
    a.kind === 'buy'
      ? { type: 'buyStock', stock: a.stock, shares: n }
      : { type: 'sellStock', stock: a.stock, shares: n };
  return {
    title: '股市',
    detail: `${name}\n${a.kind === 'buy' ? '買進' : '賣出'}（上限 ${a.max.toLocaleString('en-US')} 股）`,
    choices: [{ label, amount: { label, max: a.max, step: 1, fill }, action: fill(a.max) }],
  };
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
function loadState(next: GameState): void {
  if (net !== null) {
    log('⚠ 聯機中不能讀檔：局面由伺服器的 action 流決定');
    return;
  }
  map = parseMap(readMapData(archives, next.globalMapId));
  topo = {
    nodes: map.nodes,
    lands: map.lands,
    facilities: map.facilities,
    commercials: map.commercials,
  };
  state = next;
  history.length = 0;
  hoverNode = null;
  amountPage = null;
  const first = map.nodes[state.players[state.currentPlayer]?.nodeId ?? 1];
  camera = characterCamera(first?.x ?? 0, first?.y ?? 0, camera?.view ?? 0);
  screen = 'game';
  log(`▶ 讀檔：地圖 ${next.globalMapId}　${next.year}/${next.month}/${next.day}`);

  ground = null;
  void loadGround(archives, next.globalMapId).then((g) => {
    ground = g;
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
  return Math.max(tickMs(options.speed), renderer.lastWalkMs());
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
    if (next.type === 'step') stepTick();
    dispatch(next);
  }, humanDelay());
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
 * 一个熱鍵按下去做什么。返回 `false` 表示「这个键本引擎不管」，
 * 让调试键那一路有机会接手。
 *
 * ⚠️ 名字用 exe 里的原串（`HOTKEY_NAMES`），没实现的功能**明确说出来**。
 */
function handleHotkey(fn: number, e: KeyboardEvent): boolean {
  const name = HOTKEY_NAMES[fn] ?? `功能${fn}`;

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
      const ui = currentDialog();
      if (ui === null) return false;
      onDialogHit(ui, { kind: 'choice', index: 0 });
      return true;
    }
    case HOTKEY.no: {
      const ui = currentDialog();
      if (ui === null) return false;
      onDialogHit(ui, { kind: 'choice', index: Math.min(1, ui.choices.length - 1) });
      return true;
    }
    case HOTKEY.cancel:
      // 拾取模式里 ESC = 放弃（与右键同类）；**目标必选**的不认
      // @source VA 0x4466b8 的 `test byte [0x48c594], 8`
      if (screen === 'game' && pick !== null) {
        if (pick.cancellable) endPick();
        return true;
      }
      if (screen === 'options') {
        optionsPressed = null;
        screen = optionsReturn;
        return true;
      }
      if (screen === 'saveload') {
        closeSaveLoad();
        return true;
      }
      // 「取消」= 丢掉草稿；原版也是按取消就什么都不拷回
      if (screen === 'aiSettings') {
        closeAiSettings(false);
        return true;
      }
      return false;

    // ── 回合 ──
    case HOTKEY.advance:
      if (!awaitingHumanRoll()) return false;
      // ★ 预动作先播，数满每向帧数那一 tick 才真的掷（见 `requestRoll`）
      requestRoll();
      return true;
    case HOTKEY.chooseDiceCount: {
      // 在允许的颗数之间轮换
      const me = state.players[state.currentPlayer];
      if (me === undefined || !awaitingHumanRoll()) return false;
      const max = maxDiceOf(me);
      dispatch({ type: 'setDiceCount', count: (me.ndices % max) + 1 });
      return true;
    }

    // ── 视角 ──
    case HOTKEY.map:
      setViewMode(camera.mode === 'character' ? 'map' : 'character');
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

    // ── 镜头（原版叫「游標」，本引擎拿来平移地图视角）──
    case HOTKEY.cursorUp:
    case HOTKEY.cursorDown:
    case HOTKEY.cursorLeft:
    case HOTKEY.cursorRight: {
      if (camera.mode !== 'map') return false;
      const step = e.shiftKey ? 120 : 40;
      const dx = fn === HOTKEY.cursorLeft ? -step : fn === HOTKEY.cursorRight ? step : 0;
      const dy = fn === HOTKEY.cursorUp ? -step : fn === HOTKEY.cursorDown ? step : 0;
      followPlayer = false;
      camera = { ...camera, x: camera.x + dx, y: camera.y + dy };
      return true;
    }

    // ── 还没有对应屏幕的：说出来，不假装有反应 ──
    case HOTKEY.stockMarket:
    case HOTKEY.trade:
    case HOTKEY.cards:
    case HOTKEY.tools:
    case HOTKEY.query:
    case HOTKEY.help:
      log(`⚠「${name}」尚未實作`);
      return true;

    // ── 浏览器里做不了 / 无意义的 ──
    default:
      return false;
  }
}

/**
 * 一步棋走完后开始播补间。
 *
 * @source `fcn_0040c05c`（VA 0x0040c05c）：tick 数 = `trunc(屏幕距离 / 走子速度)`，
 *   线性等分、**一个 tick 一帧** —— 细节与出处见 `client/tween.ts`。
 *   起点用 state 里的 `lastNodeId`（core 的 step 会把它设成走之前那一格）。
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
    options.animation,
    camera,
    { w: LAYOUT.board.w, h: LAYOUT.board.h },
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
  const id = MOVE_SOUND[me.trafficMethod & 3];
  if (id !== undefined) sound.play('Effect.mkf', id);
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
function requestRoll(): void {
  if (diceFx.active) return;
  const me = state.players[state.currentPlayer];
  if (me === undefined) return;
  const count = Math.max(1, Math.min(3, me.ndices || 1));
  diceFlicNow(count);
  diceFx.begin(performance.now(), diceAnticipateTicks(me), tickMs(options.speed), count);
  anticipateFrame = 0;
  rollRequestedAt = 0;
  requestRender();
  window.setTimeout(dicePoll, 16);
}

/** 预动作已经推过几帧了 —— 原版是**每 tick 一帧**（VA 0x0040d975 `inc [0x498ea3]`）*/
let anticipateFrame = 0;
/** 催过 `rollDice` 的时刻；用来给联机兜底（服务器不回就收摊） */
let rollRequestedAt = 0;
/** 催过之后最多等这么久 —— 联机时服务器不答复不能一直空转 */
const ROLL_WAIT_TIMEOUT_MS = 3000;

/** 掷骰那一段的轮询：数满预动作就掷，掷完继续要帧直到 500 ms 定格走完 */
function dicePoll(): void {
  if (!diceFx.active) return;
  const now = performance.now();

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
    return;
  }

  if (diceFx.phase === 'tumble') diceFlicNow(diceFx.diceCount);
  requestRender();
  if (diceFx.active) window.setTimeout(dicePoll, 16);
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
function onDialogHit(ui: InteractionUi, hit: DialogHit): void {
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
      amountPage = { choice: hit.index, value: c.amount.max };
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
      requestRender();
      return;
    case 'amountOk': {
      const n = Math.trunc(page.value);
      closeAmountPage();
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

function openOptions(from: Screen): void {
  optionsReturn = from;
  optionsVariant = from === 'game' ? 1 : 0;
  optionsDraft = { ...options };
  optionsPressed = null;
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
    void playTrack(hit.value);
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

/**
 * 右上角三颗黄钮（抬手才算）。
 *
 * @source `fcn_00410838`：`[0x48bb58]`（= 入口参数）非 0 就是**遊戲中**进来，
 *   先弹一个 Yes/No 确认框（`_rich4_ui_yesno(0x140, 0xc8)` = 画在 (320,200)），
 *   答「是」才把 `[0x474d74] − 2`（1 重新遊戲 / 2 認輸投降 / 3 結束遊戲）抛回去；
 *   是 0（標題頁）则直接进那一屏，**没有确认框**。
 */
function onOptionsSide(index: number): void {
  // ⚠️ 两条去路都还没做，如实说，不假装有反应：
  //   標題頁那三颗各自还有一整屏（日期頁 = 资源 3 图 2 + `fcn_00410ac3`；
  //   熱鍵頁 = 图 1 + `fcn_00411122`；遊戲說明 = `_rich4_ui_help_entry`），
  //   遊戲中那三颗要先弹 `_rich4_ui_yesno` 再抛 1/2/3 回去。
  log(`⚠「${SIDE_BUTTONS[optionsVariant]?.[index] ?? ''}」尚未實作`);
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
  if (next.music > 0 && !music.playing) void playTrack(next.track);
  if (next.music === 0) music.stop();
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

/**
 * 背景音乐。
 *
 * ⚠️ 与音效一样，得等用户手势之后才能出声；第一次点击时连音乐一起解锁，
 *   顺手放第一首。曲目顺序照 `MIDI_PLAYLIST`（取自游戏目录的 `Midi.txt`）。
 */
const music = new MusicPlayer();
/** 当前播到清单里的第几首 */
let musicTrack = 0;
let musicStarted = false;

async function playTrack(index: number): Promise<void> {
  const name = MIDI_PLAYLIST[((index % MIDI_PLAYLIST.length) + MIDI_PLAYLIST.length) % MIDI_PLAYLIST.length];
  if (name === undefined) return;
  musicTrack = index;
  try {
    // ⚠️ 磁盘上的文件名是小写（midi01.mid），`Midi.txt` 里是大写；
    //   大小写敏感的文件系统上按实际文件名取，取不到就试另一种写法。
    let res = await fetch(`${assetBase()}/${name}`);
    if (!res.ok) res = await fetch(`${assetBase()}/${name.toLowerCase()}`);
    if (!res.ok) {
      log(`⚠ 找不到配乐 ${name}`);
      return;
    }
    music.play(name, new Uint8Array(await res.arrayBuffer()));
    log(`♪ ${name}`);
    renderPanel();
  } catch {
    log(`⚠ 配乐 ${name} 载入失败`);
  }
}

/** 第一次用户手势：把音效与音乐一起解锁 */
function unlockAudio(): void {
  sound.unlock();
  music.unlock();
  if (!musicStarted) {
    musicStarted = true;
    void playTrack(0);
  }
}

/**
 * 原版底图。
 *
 * 节点坐标与底图像素同一个原点，直接按 (0, 0) 铺即可
 * （依据见 assets-pipeline 的 ground.ts）。G 键可开关，
 * 方括号/分号/引号键微调偏移——留作核对手段。
 */
let ground: ImageBitmap | null = null;
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

/** 真正施加一条 action：单机由 dispatch 直达，联机由服务器广播到达 */
function applyAction(action: Action): void {
  const before = state;
  state = reduce(state, action, topo);
  if (state !== before) {
    // ★ 掷骰那一段：点数到手 → 开滚。影片没解好先挂着，解完再补。
    //   纯表现，`diceFx` 不读也不写 state（C-DET-4）。
    if (action.type === 'rollDice') {
      // 单机的预动作已经在 `requestRoll` 里起好了；联机时点数由服务器定序，
      // 本机这一按只负责把动画领走（不动画就自己起一段）。
      if (!diceFx.active) {
        const me = state.players[state.currentPlayer];
        if (me !== undefined) {
          diceFlicNow(Math.max(1, Math.min(3, me.ndices || 1)));
          diceFx.begin(performance.now(), diceAnticipateTicks(me), tickMs(options.speed), me.ndices || 1);
        }
      }
      diceFx.roll(performance.now(), state.dice, diceFlic.get(state.dice.length) ?? null);
      playDiceSound();
    } else if (state.phase !== 'moving' && !diceFx.active) {
      diceFx.cancel();
    }
  }
  if (state !== before) {
    history.push(action);
    playSoundFor(before, state);
    // ★ 状态一变，填数页指着的那个选项下标就可能已经不是同一回事了
    //   （`pending` 换了一种，甚至换了人）。一律收掉。
    amountPage = null;
    dialogHot = null;
    // ★ 商店的界面状态跟着 `pending` 走：进店时快照货架、铺开场；离店时清掉。
    //   放在这里是因为不管谁答的（本地点、AI、服务器广播）都会经过这一条。
    syncShopUi();
    // ★ 登记的整屏：把「刚刚发生了什么」告诉它们（開獎 / 月結 / 魔法屋靠这个起播）
    {
      const env = uiEnv();
      for (const s of SCREENS) s.event?.(before, state, env);
    }
  }
  requestRender();
  renderPanel();
  scheduleAi();
  scheduleHumanTurn();
  autosaveIfEnabled();
}

/**
 * 按状态变化放音。
 *
 * ⚠️ 只接**能从调用点反查出编号**的那几个事件（见 assets-pipeline 的
 *   `SOUND_IDS`）。其余事件的音效编号还没查，宁可不响也不乱响。
 *
 * ⚠️ 另外：编号与 `Effect.mkf` 的资源号是否直接相等**尚未验证**，
 *   中间可能还隔着一张表。听起来不对就是这个原因。
 */
function playSoundFor(before: GameState, after: GameState): void {
  // 有人出局
  const deadBefore = before.players.filter((p) => p.whoPlays === 0).length;
  const deadAfter = after.players.filter((p) => p.whoPlays === 0).length;
  if (deadAfter > deadBefore) {
    sound.play('Effect.mkf', SOUND_IDS.BANKRUPT);
    return;
  }
  // 落在银行
  if (after.pending?.kind === 'bank' && before.pending?.kind !== 'bank') {
    sound.play('Effect.mkf', SOUND_IDS.BANK);
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
  if (autoAction(state) === null && (!aiAutoPlay || !isAiTurn(state))) return;
  // 联机：电脑座位由服务器代打，别的真人座位由他们自己的客户端驱动；
  //   本机只替**自己的座位**拿主意（出局后的空转、本机开的託管），并且
  //   照样作为意图发出去，不在本地施加。
  if (!localSeatActive()) return;
  aiTimer = window.setTimeout(() => {
    aiTimer = null;
    const action = decideAction({ state, map });
    if (action === null) {
      // 轮到电脑却拿不出 action —— 这是**卡住**，不是「没事可做」，
      // 必须说出来。先前这里是静默 return，一个漏掉的 scheduleAi 就此藏了很久。
      if (isAiTurn(state)) log(`⚠ 电脑在 ${state.phase} 无事可做，已停手`);
      return;
    }
    if (net !== null) {
      net.submit(action);
      return;
    }
    if (action.type === 'step') stepTick();
    // ★ 掷骰先播预动作再掷：拦一道，等 `dicePoll` 里真的 dispatch
    if (action.type === 'rollDice') {
      requestRoll();
      return;
    }
    const before = state;
    const walker = action.type === 'step' ? state.currentPlayer : null;
    state = reduce(state, action, topo);
    if (walker !== null && state !== before) startStepTween(walker);
    if (state === before) {
      log(`⚠ AI 在 ${before.phase} 给出无效 action ${action.type}，已停手`);
      aiAutoPlay = false;
      renderPanel();
      return;
    }
    history.push(action);
    requestRender();
    renderPanel();
    scheduleAi();
    scheduleHumanTurn(); // 电脑走完，轮到人时接着推进机械步骤
  }, aiDelayMs);
}

let aiAutoPlay = true;
const aiDelayMs = 120;

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
  const shape = pickCursorFor(pick, pickHover !== null);
  const css = pickCursorSprite(shape.image, shape.hotX, shape.hotY);
  // 图还没到 → 先别把系统指针藏掉，否则会出现「没有指针」
  canvas.style.cursor = css ?? '';
}

/** 结束拾取（`cancel` = 用户放弃）*/
function endPick(): void {
  if (pick === null) return;
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

/** 换页：只在本次进店第一次看这一页时才播开场（原版 `[0x48c349 + 页]`）*/
function shopGotoPage(ui: ShopUi, page: ShopPage, now: number): void {
  ui.page = page;
  ui.pressed = null;
  if (ui.shown[page]) {
    // 已经开过场：直接摆到位，让它照样走一遍 0x40c（到位后出提示）
    ui.slide = { panelX: SHOP_SLIDE.panelTo, gridX: SHOP_SLIDE.gridTo, dx: 0, dy: 0 };
    ui.bubble = null;
  } else {
    ui.shown[page] = true;
    ui.slide = slideStart();
    shopSay(ui, shopMessage(page, 'entry'), now);
  }
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
      shown: [false, false],
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
 *   核子飛彈/遙控骰子）要**先选目标**，那一步是 **T-026**（尚未做）——
 *   这里如实说一声，**不假装能发**（免得发出去一个 nodeId=0 的无效指令）。
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
  // 需要目标的那几件：进拾取模式（T-026）。参数表见 `picking.ts` 的 TOOL_SELECT_PARAM。
  const param = TOOL_SELECT_PARAM.get(id);
  if (param === undefined) {
    log(`「${TOOLS[id - 1]?.name ?? `道具${id}`}」的目标选择原版走的是另一套（还没接）`);
    return;
  }
  startToolPick(id, param);
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
  // 用不成：失败音 + 把弹窗开回来（原版的循环）
  sound.play('Effect.mkf', SOUND_CARD_FAILED);
  if (route.needsOwnList) log('（这张卡要选股票 —— 那类选择界面还没做）');
  else openInventory('cards');
}

/**
 * 「这张牌没用成」的音效 —— 音效 **4**
 * @source `_rich4_ui_use_card_entry` VA 0x441cd2 的 `play_sound_effect(0x48233a)`；
 *   音效号表自 `0x48231a` 起，`[0x48233a] = 4`。
 */
const SOUND_CARD_FAILED = 4;

/**
 * 「选中了一个目标」的音效 —— 音效 **2**
 * @source `_rich4_select_instance_callback` VA 0x44666a 的
 *   `play_sound_effect(0x48232a)`；`[0x48232a] = 2`。
 */
const SOUND_TARGET_PICKED = 2;

/** 进「选目标」的拾取模式（卡片那一类）*/
function startCardPick(cardId: number, cls: TargetClass, param: number): void {
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

/** 过场结束 → 进棋盘 */
function endIntro(): void {
  if (screen !== 'intro') return;
  screen = 'game';
  requestRender();
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

/** 离开大厅：断开连接、回標題 */
function leaveLobby(): void {
  netClose?.();
  netClose = null;
  net = null;
  lobbyRoom = null;
  lobbyHot = null;
  screen = 'title';
  log('已離開聯機大廳');
  requestRender();
}
/** 標題畫面上鼠标悬着的按钮 */
let titleHot: number | null = null;

let renderQueued = false;
// ============================================================
//  整屏 UI 的登记表（契约见 ui-screen.ts；表本身在 screens.ts）
// ============================================================

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
    sprite: spriteNow,
    dispatch,
    requestRender,
    log,
    playEffect: (id: number) => sound.play('Effect.mkf', id),
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

function requestRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    resizeCanvas();
    // ★ 登记过的整屏每帧收一次 `tick`（不管此刻是不是它在接管）——
    //   演出类屏幕靠它察觉状态变化、推进动画。**屏幕自己要续帧就调
    //   `env.requestRender()`**，别指望这里无条件重排（会转成死循环）。
    {
      const env = uiEnv();
      for (const s of SCREENS) s.tick?.(env);
    }
    // ★ 走子补间要**逐帧**重绘（T-046）：补间没播完就再排一帧，
    //   否则棋子会停在这一步的第一帧上，直到下一次 dispatch 才动。
    if (screen === 'game' && !renderer.walkDone()) requestRender();
    if (screen === 'game') shopTick(performance.now());

    stageCtx.imageSmoothingEnabled = false;
    stageCtx.fillStyle = '#000';
    stageCtx.fillRect(0, 0, SCREEN_W, SCREEN_H);

    const overlay = activeUiScreen();
    if (overlay !== null) {
      // ★ 登记的整屏接管：棋盘、侧栏、工具栏一概不画（原版这些屏也是整屏窗口）
      overlay.draw(uiEnv());
    } else if (screen === 'title') {
      drawTitle(stageCtx, titleHot, spriteNow);
    } else if (screen === 'intro') {
      // ★ 过场要**逐帧**推进：没播完就再排一帧（与走子补间同一个道理），
      //   否则只画第一帧就冻住 —— 类型检查与单测都看不出这一条。
      // ★ 也**不能在这里 `return`** —— 见下面 assets 那条的同一条注释：
      //   `blitStage()` 在这条链末尾，提前返回就是白画（过场此前就是这样，
      //   一直没显示出来）。
      drawIntro(stageCtx, performance.now() - introStartedAt);
      if (introDone(introStartedAt, performance.now(), introSkipped)) endIntro();
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
      drawSetup(stageCtx, setup, spriteNow, performance.now(), setupScene);
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
      drawBankLoan(stageCtx, spriteNow, {
        chairman: bank.chairman,
        frozen: bankFrozen(),
        finance: [room + owed, owed, room],
      });
    }
    if (atm !== null) drawBankAtm(stageCtx, spriteNow, atm, bankFrozen());
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

    // 拾取模式的指针图要**解码完才能用**。首帧拿不到就返回 null，
    // 而光标只在 hover 变化时才刷新 —— 于是「一次都没悬停到」时指针会空着。
    // 图到货（spriteArrived）时补一次，这一条不能省。
    if (pick !== null && spriteArrived) refreshPickCursor();

    blitStage();

    // 有精灵在本帧解码完成 → 再画一次，把它们补上；
    // 骰子在滚也要继续要帧，否则动画只有一格；
    // 商店开着也要一直要帧 —— 原版那儿挂着一个 50ms 的定时器（`SetTimer(hwnd, 0x32, …)`）。
    if (renderer.dirty || hud.dirty || spriteArrived || diceFx.active || shopUi !== null) {
      renderer.clearDirty();
      hud.clearDirty();
      spriteArrived = false;
      requestRender();
    }
  });
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
    state,
    camera,
    hoverNode,
    ground: showGround ? ground : null,
    groundOffset,
    characterPose: characterPoseOf(),
    viewport: { w: LAYOUT.board.w, h: LAYOUT.board.h },
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
    // ★ 原版的 GO 鈕 + 骰子数切换（Panel.mkf 资源 7）
    drawAdvance(boardCtx, uiSprite, goImageOf(me), maxDiceOf(me), me.ndices);
  } else if (state.phase === 'moving' && state.dice.length > 0) {
    drawDice(boardCtx, uiSprite, state.dice, currentScreenDir());
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

  if (minimapMarker !== null) {
    // 走到标记上了？那就把标记收掉，镜头交还给棋子
    if (Math.abs(node.x - minimapMarker.x) <= 16 && Math.abs(node.y - minimapMarker.y) <= 16) {
      minimapMarker = null;
      requestRender();
    } else {
      return;
    }
  }

  if (camera.mode === 'character') {
    // 人物视角：摄像机就是**当前玩家所在的那一块**，原版恒在 29×29 窗口正中
    camera = { ...camera, tileX: node.x >> 5, tileY: node.y >> 5 };
    return;
  }

  const wantX = node.x - canvas.clientWidth / 2 / camera.scale;
  const wantY = node.y - canvas.clientHeight / 2 / camera.scale;
  const k = 0.18;
  camera = {
    ...camera,
    x: camera.x + (wantX - camera.x) * k,
    y: camera.y + (wantY - camera.y) * k,
  };
  // 还没到位就继续要下一帧，避免停在半路
  if (Math.abs(wantX - camera.x) > 0.5 || Math.abs(wantY - camera.y) > 0.5) requestRender();
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
    case 5: // 大地圖 —— 切换人物/地图视角
      setViewMode(camera.mode === 'character' ? 'map' : 'character');
      return;
    case 10: // 股市（T-030）
      openStock();
      return;
    default:
      log(`「${name}」尚未实现`);
  }
}

/**
 * 在人物视角与地图视角之间切换。
 *
 * ★ **不是小地图那两颗按钮**（先前这里记错了）。那两颗是**转视角**
 *   （8 个 45° 方位，见 `rotateView`）。切换这个的是「大地圖」那个动作，
 *   走 `HOTKEY.map`。
 */
function setViewMode(mode: 'character' | 'map'): void {
  if (camera.mode === mode) return;
  if (mode === 'character') {
    const me = state.players[state.currentPlayer];
    const node = me === undefined ? undefined : map.nodes[me.nodeId - 1];
    camera = characterCamera(node?.x ?? 0, node?.y ?? 0, camera.view);
    followPlayer = true;
  } else {
    // ★ 按**棋盘区**（439×440）取景，不是整个窗口 —— 地图是画进棋盘区的，
    //   用窗口尺寸算会把整图缩过头、塞进棋盘后只剩左上角一块。
    //   @source 原版大地圖：「一块近乎正方的大窗（左侧 439×440 那块），里面画整张地图」
    //   （见 docs/original-screens.md 的 S6）。
    camera = { ...fitCamera(map, LAYOUT.board.w, LAYOUT.board.h), view: camera.view };
  }
  log(mode === 'character' ? '▶ 人物视角' : '▶ 地图视角');
  requestRender();
  renderPanel();
}

/**
 * 转视角。
 *
 * ★ 原版有 **8 个视角**、每步 45°，全局 `[0x499088]`。
 *   建筑精灵各有 8 张图正是为此：图号 = `(8 − (朝向 + 视角)) & 7`。
 */
function rotateView(delta: number): void {
  camera = { ...camera, view: (camera.view + delta + VIEW_COUNT) % VIEW_COUNT };
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
  for (const c of ui.choices) {
    const el = document.createElement('button');
    el.textContent = c.label;
    el.onclick = () => {
      // 需要填数的选项：弹一个输入框，取消就当没点
      if (c.amount !== undefined) {
        const raw = window.prompt(`${c.amount.label}（上限 ${c.amount.max}）`, String(c.amount.max));
        if (raw === null) return;
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) return;
        const capped = Math.min(Math.trunc(n), c.amount.max);
        log(`▶ ${ui.title}：${c.label} ${capped}`);
        dispatch(c.amount.fill(capped));
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
        if (b.action.type === 'rollDice') requestRoll();
        else dispatch(b.action);
      };
      return el;
    }),
    autoButton(),
    aiToggleButton(),
    ...musicButtons(),
  );
}

/** 配乐控制：上一首 / 播停 / 下一首 */
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
    // 存档自带地图号：用它那份地图去还原（地块/设施的静态部分在地图数据里）
    const savedMap = parseMap(readMapData(archives, save.gameMap));
    const { state: imported, gaps } = importOriginalSave(save, savedMap);
    loadState(imported);
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

  map = parseMap(readMapData(archives, setup.mapId));
  topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials };
  state = newGame({
    map,
    globalMapId: setup.mapId,
    players,
    seed,
    // ★ 开局屏那三条直接决定规则：资金档位（`[0x46cb40]`）、
    //   自带载具（`[0x46cb44]`）、土地權限（`[0x46cb48]`）
    // @source `VA 0x00407032`（资金）、`0x00407219`（载具）、`0x00406f6b`（权限）
    initialFund: MONEY_VALUES[setup.money] ?? DEFAULT_INITIAL_FUND,
    startingVehicle: setup.vehicle,
    landTenure: setup.land,
  });
  history.length = 0;

  const first = map.nodes[state.players[0]?.nodeId ?? 1];
  camera = characterCamera(first?.x ?? 0, first?.y ?? 0, camera?.view ?? 0);
  hoverNode = null;
  // ★ 開局先播跳伞过场（T-048）：纯表现、可跳过，之后才进棋盘
  introStartedAt = performance.now();
  introSkipped = false;
  screen = 'intro';
  log(
    `開局：地圖 ${setup.mapId}　種子 ${seed}　` +
      players.map((p, i) => `P${i + 1}${p.kind === 'human' ? '人' : '電'}`).join(' '),
  );

  // 换地图要重新解底图
  ground = null;
  void loadGround(archives, setup.mapId).then((g) => {
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

    // ── 登记的整屏（契约见 ui-screen.ts）先接管鼠标 ──
    {
      const overlay = activeUiScreen();
      if (overlay !== null) {
        overlay.move?.(p.x, p.y, uiEnv());
        return;
      }
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

    // ── 銀行 ATM 开着时不理会棋盘的悬停 ──
    if (atm !== null) return;

    // ── 目标拾取（T-026）：光标底下是候选就换指针 @source VA 0x44609b ──
    if (screen === 'game' && pick !== null) {
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
      const hit = hitLobby(p.x, p.y, { isHost: isHostSeat(net?.seat ?? null) });
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
    if (screen === 'options') return;

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
      const on = hitAdvance(p.x - LAYOUT.board.x, p.y - LAYOUT.board.y);
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

    // ── 登记的整屏（契约见 ui-screen.ts）先接管鼠标 ──
    {
      const overlay = activeUiScreen();
      if (overlay !== null) {
        overlay.down?.(p.x, p.y, uiEnv());
        return;
      }
    }

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
      const hit = hitLobby(p.x, p.y, { isHost: isHostSeat(net?.seat ?? null) });
      if (hit === null) return;
      // 座位只读（座位是服务器分的，见 Q-NET-2），点它不做事
      if (hit.kind === 'seat') return;
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

    // 轮到人、还没掷骰：GO 鈕与它下面那排骰子数切换
    const meNow = state.players[state.currentPlayer];
    if (awaitingHumanRoll() && meNow !== undefined) {
      const bx = p.x - LAYOUT.board.x;
      const by = p.y - LAYOUT.board.y;
      // ★ 切换钮盖在 GO 的下缘上，必须先问它，否则永远点不到
      const n = hitDiceToggle(bx, by, maxDiceOf(meNow));
      if (n !== null) {
        dispatch({ type: 'setDiceCount', count: n });
        return;
      }
      if (hitAdvance(bx, by)) {
        requestRoll();
        return;
      }
    }

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

    if (hoverNode === null) return;
    const node = map.nodes[hoverNode - 1];
    if (node === undefined) return;
    log(
      `节点 ${node.id}「${node.name || '无名'}」 ${node.ref.kind}` +
        (node.specialKind !== 0 ? ` 特殊格 ${node.specialKind}` : ''),
    );
    // 岔路选择：只有引擎正处于等待方向时才有意义
  });

  canvas.addEventListener('wheel', (e) => {
    if (screen !== 'game') return;
    e.preventDefault();
    if (camera.mode !== 'map') return; // 人物视角的缩放由投影表定死，不可调
    const p = eventToStage(e);
    if (p === null) return;
    const bx = p.x - LAYOUT.board.x;
    const by = p.y - LAYOUT.board.y;
    const before = screenToMap(bx, by, camera);
    const k = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    followPlayer = false;
    camera = { ...camera, scale: Math.min(8, Math.max(0.2, camera.scale * k)) };
    const after = screenToMap(bx, by, camera);
    // 以光标为锚点缩放：保持光标下的地图点不动
    camera = { ...camera, x: camera.x + (before.x - after.x), y: camera.y + (before.y - after.y) };
    requestRender();
  }, { passive: false });

  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('mousedown', (e) => {
    unlockAudio(); // 浏览器要求在用户手势里建 AudioContext

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
      // ★ 休市那一支原版走的是**訊息框**窗口过程：任何一下鼠标都退屏
      //   （@source `fcn_0042b2ec` 的 0x202/0x205 两路都 `Post_0402_Message(0)`）
      //   —— 所以休市日既看不到行情，也不可能交易。
      if (stockCounterClosed(state)) {
        if (e.button === 0 || e.button === 2) closeStock();
        return;
      }
      // 详情卡开着：左键或右键都直接退卡 @source `loc_0042aa08`
      if (stockDetail !== null) {
        if (e.button === 0 || e.button === 2) closeStockDetail();
        return;
      }
      if (e.button !== 0) return; // 右键走 contextmenu（换页 / 离开）
      const q = eventToStage(e);
      if (q === null) return;
      if (stockAmount !== null) {
        // 填数页开着：全部点击先给它（排版照棋盘坐标，命中也照那边算）
        const ui = stockAmountUi();
        if (ui !== null) {
          const h = hitDialog(
            boardCtx, ui, amountPage,
            q.x - LAYOUT.board.x, q.y - LAYOUT.board.y,
          );
          if (h !== null && h !== 'inside') onDialogHit(ui, h);
          if (amountPage === null) stockAmount = null; // 確定/取消都会关掉它
          requestRender();
        }
        return;
      }
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

    // ── 銀行貸款屏（T-029b）：四颗钮在**舞台坐标**上 @source loc_00435c12 ──
    const loanNow = bankPending();
    if (e.button === 0 && loanNow !== null && atm === null && amountPage === null) {
      const q = eventToStage(e);
      if (q === null) return;
      const btn = hitLoanButton(q.x, q.y);
      const op = btn === null ? null : loanActionOf(btn, loanNow.chairman, bankFrozen(), loanNow.hasLoan);
      if (op === null) return;
      if (op === 'exit') {
        log('▶ 離開銀行');
        dispatch({ type: 'declineDecision' });
        return;
      }
      log(`▶ ${op === 'borrow' ? '申請貸款' : op === 'repay' ? '償還貸款' : op === 'financeBorrow' ? '週轉現金' : '歸還款項'}`);
      openLoanAmount(op);
      return;
    }

    // ── 銀行 ATM 面板（T-029a）──
    if (atm !== null) {
      const q = eventToStage(e);
      if (q === null) return;
      const btn = hitAtmButton(q.x, q.y);
      if (btn === null) return;
      const next = atmPress(atm, btn, bankFrozen());
      if (next === null) {
        closeAtm(); // EXIT
        requestRender();
        return;
      }
      if (btn === 17) {
        // ↵ 確認：金额定了才发得出去（0 = 没做这件事，原版也直接退回来）
        const n = Math.trunc(atmAmount(atm));
        const fill = atmFill;
        closeAtm();
        if (n > 0 && fill !== null) {
          log(`▶ ${atmLabel} ${n}`);
          dispatch(fill(n));
        }
        requestRender();
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
    // 只有棋盘区能拖
    const bx = p.x - LAYOUT.board.x;
    const by = p.y - LAYOUT.board.y;
    if (bx < 0 || by < 0 || bx >= LAYOUT.board.w || by >= LAYOUT.board.h) return;
    drag = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('mouseup', (e) => {
    // ── 登记的整屏（契约见 ui-screen.ts）先接管鼠标 ──
    {
      const overlay = activeUiScreen();
      if (overlay !== null) {
        const q = eventToStage(e);
        if (q !== null) overlay.up?.(q.x, q.y, uiEnv());
        return;
      }
    }
    // ── 開局設定屏：抬手才收尾（原版 0x202）──
    // ★ 只认按下那一刻记下的控件号，不看抬手时光标在哪（原版就是这么写的）。
    if (screen === 'setup') {
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
          startGame();
        }
        return;
      }
      if (pressed === 2) {
        screen = 'title';
        requestRender();
        return;
      }
      if (pressed >= 3) sound.play('Effect.mkf', SOUND_IDS.TITLE_CLICK);
      requestRender();
      return;
    }

    // ── 設定屏：抬手才收尾（原版 0x202）──
    if (screen === 'options') {
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
        dispatch({ type: 'useCard', cardId: source.cardId, target: hit.target });
      } else {
        dispatch({ type: 'useTool', toolId: source.toolId, nodeId: hit.nodeId });
      }
      return;
    }

    drag = null;
    draggingMinimap = false;
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
    if (drag === null) return;
    if (camera.mode !== 'map') return; // 人物视角恒以当前玩家为中心，不能拖
    followPlayer = false;
    // 窗口像素 → 舞台像素 → 地图单位：舞台是整数倍放大的，少除这一下
    // 拖动就会比手快 scale 倍
    const px = (canvas.width / canvas.clientWidth) / currentMetrics().scale;
    camera = {
      ...camera,
      x: camera.x - ((e.clientX - drag.x) * px) / camera.scale,
      y: camera.y - ((e.clientY - drag.y) * px) / camera.scale,
    };
    drag = { x: e.clientX, y: e.clientY };
    requestRender();
  });

  // 右键：**在有标记时**点小地图外任意处 → 清掉标记、镜头回到当前玩家
  // @source VA 0x00418893（WM_RBUTTONUP）：算出的位置与标记相同就 `[0x48be18] = 0`
  canvas.addEventListener('contextmenu', (e) => {
    // 資產表屏：右键关掉（原版 WM_RBUTTONUP，VA 0x424409）
    if (screen === 'assets') {
      e.preventDefault();
      closeAssets();
      return;
    }
    // 股市：右键 —— 在持股页就退回行情页，在行情页就离开 @source `loc_0042b22f`
    if (screen === 'stock') {
      e.preventDefault();
      if (stockDetail !== null) {
        closeStockDetail();
      } else if (stockAmount !== null) {
        stockAmount = null;
        closeAmountPage();
      } else if (stockPage !== 0) {
        stockPage = 0;
        stockSel = null;
        requestRender();
      } else {
        closeStock();
      }
      return;
    }
    // 道具欄浮窗：右键关掉、**什么都不用**（原版 VA 0x445dad 抛回 0）
    if (screen === 'inventory') {
      e.preventDefault();
      closeInventory();
      return;
    }
    // 設定屏：右键 = 取消（原版 `0x205` → `fcn_0041095b` → 抛回 0）
    if (screen === 'options') {
      e.preventDefault();
      optionsPressed = null;
      screen = optionsReturn;
      requestRender();
      return;
    }
    // 卡片商店／道具商店：右键 = 走人（原版 WM_RBUTTONUP 直接 `Post_0402_Message`，VA 0x42e888）
    // ★ 原版这条**不说道别语** —— 那句只在 EXIT 钮上出。
    if (screen === 'game' && shopUi !== null) {
      e.preventDefault();
      if (!shopUi.closing) dispatch({ type: 'declineDecision' });
      return;
    }
    // 目标拾取：右键放弃 —— 但**目标必选**的（选择参数 bit3）右键不认
    // @source VA 0x4466b8 `test byte [0x48c594], 8 / jne 忽略`
    if (screen === 'game' && pick !== null) {
      e.preventDefault();
      if (pick.cancellable) endPick();
      return;
    }
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
  window.addEventListener('keydown', (e) => {
    unlockAudio();
    // 开局过场：任意键跳过（原版同样可跳过）
    if (screen === 'intro') {
      introSkipped = true;
      e.preventDefault();
      requestRender();
      return;
    }
    const fn = hotkeyOf(e);
    if (fn !== null && handleHotkey(fn, e)) {
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
          topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials };
          // ★ 与服务器镜像（server/room.ts）逐字段一致，否则指纹对不上
          state = newGame({
            map,
            globalMapId: start.globalMapId,
            players: start.seats.map((s) => ({ character: s.character, kind: s.kind })),
            seed: start.seed,
            mode: 'multiplayer',
          });
          history.length = 0;
          hoverNode = null;
          const first = map.nodes[state.players[0]?.nodeId ?? 1];
          camera = characterCamera(first?.x ?? 0, first?.y ?? 0, camera?.view ?? 0);
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
        onDesync: (d) => log(`⚠ 失步！第 ${d.seq} 號後 ${d.seat + 1} 號座的校驗和 ${d.got} ≠ ${d.expected}`),
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

    // HD 素材可选：拿不到清单（没跑过超分管线、或整个 assets/hd/ 不存在）
    // 就整包走原图。**按图**回退在 SpriteCache 里（PRD §4.5）。
    const hdSource = await loadHdSource(hdBase());
    sprites = new SpriteCache(archives, hdSource === null ? {} : { hd: hdSource });
    if (hdSource !== null) log('HD 素材：已接上（缺图的按图回退原图）');

    // 先用地址栏（或默认值）建一局，好让渲染器与面板有东西可读；
    // 但**开机停在標題畫面**——真正的开局在玩家点 START 之后。
    const boot0 = readSetup();
    map = parseMap(readMapData(archives, boot0.globalMapId));
    topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials };
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

    // ★ 渲染器画进**离屏**画布：棋盘 439×440、側欄 200×480，
    //   都是原版的固定尺寸；缩放由舞台统一做（见 stage.ts）。
    renderer = new BoardRenderer(boardCtx, sprites);
    hud = new Hud(hudOffCtx, sprites);
    // 解码是异步的，绘制是同步的：图到了要有人把下一帧排上，否则画面停在缺图那一帧
    renderer.onSpriteReady = requestRender;
    // 调试辅助层：`?debug=nodes` 才画节点连线与落点菱形（原版没有）
    renderer.debugNodes = new URLSearchParams(window.location.search).get('debug') === 'nodes';
    hud.onSpriteReady = requestRender;
    resizeCanvas();
    // ★ 原版开局就是人物视角（等距投影、跟着棋子），全局看右下角小地图
    const first = map.nodes[state.players[0]?.nodeId ?? 1];
    camera = characterCamera(first?.x ?? 0, first?.y ?? 0, 0);
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
      };
    }

    document.body.classList.add('no-debug');
    bindInput();
    const online = netParamsFrom(window.location.search);
    if (online !== null) connectOnline(online.url, online.room, online.name);
    else if (straightToGame) startGame();
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
