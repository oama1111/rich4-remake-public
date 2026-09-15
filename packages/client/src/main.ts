/*
 * 客户端入口
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2 / C-ARC-4：本文件负责**输入与呈现**，一条规则都不含。
 *   所有状态变更都表达为 action 交给 `reduce()`；
 *   这正是联机能免改造接入的前提——本地点击和远端消息产生的
 *   是同一种 action，引擎分不出也不需要分出来源。
 */

import { CHARACTERS } from '@rich4/data';
import {
  autoAction,
  VEHICLE_DICE,
  teleportPlayer,
  decideAction,
  isAiTurn,
  PANEL_PAGE_COUNT,
  holidayIndexOf,
  newGame,
  reduce,
  parseMap,
  stateFingerprint,
  type Action,
  type GameState,
  type MapTopology,
  type Rich4Map,
  type RoomInfo,
} from '@rich4/core';
import { NetClient, netParamsFrom } from './net-client.ts';
import { DiceRollAnimation } from './dice-anim.ts';
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
  type ArchiveName,
  type LoadedArchives,
  type Sprite,
} from './assets.ts';
import {
  Hud,
  SIDEBAR,
  clampCameraCenter,
  hitMinimapArrow,
  hitMinimapBody,
  hitSidebar,
  minimapToWorld,
  type MinimapArrowId,
  type SidebarView,
} from './hud.ts';
import {
  DEFAULT_OPTIONS,
  OPTIONS_RESOURCE,
  applyOptionsHit,
  drawOptions,
  hitOptions,
  volumeOf,
  HOTKEY_NAMES,
  SIDE_BUTTONS,
  type GameOptions,
  type OptionsHit,
} from './options.ts';
import { SoundPlayer } from './audio.ts';
import { MusicPlayer } from './music.ts';
import {
  assetBase,
  currentGameDir,
  hdBase,
  isDesktop,
  hostLog,
  pickGameDir,
  type PickResult,
} from './host.ts';
import { MIDI_PLAYLIST, SOUND_IDS } from '@rich4/assets-pipeline';
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
import { TOOLBAR_LABELS } from './assets.ts';
import { interactionUi, type InteractionUi } from './interactions.ts';
import {
  drawAdvance,
  drawDialog,
  drawDice,
  hitAdvance,
  hitDiceToggle,
  hitDialog,
  layoutDialog,
  type AmountPage,
  type DialogHit,
} from './dialog.ts';
import type { SpriteFn } from './gameui.ts';
import { HOTKEY, hotkeyOf } from './hotkeys.ts';
import { SCENE_ARCHIVE, sceneFor } from './scenes.ts';
import {
  AUTOSAVE_SLOT,
  LOAD_SLOTS,
  SAVE_SLOTS,
  drawSaveLoad,
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
import {
  applySetupHit,
  defaultSetup,
  drawSetup,
  hitSetup,
  type SetupHit,
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
let optionsHot: OptionsHit | null = null;

/** 对话框正在填数的那一页；`null` 表示还在选项页 */
let amountPage: AmountPage | null = null;
let dialogHot: DialogHit | null = null;
let advanceHot = false;

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
 * 走一步之间隔多久。
 *
 * ⚠️ 这三个数是**我们定的**，不是原版的。RICH4.CFG offset 0 说游戏速度
 *   有 00/01/02 三档（见 options.ts），但每一档具体多少毫秒没查证。
 */
const STEP_MS = [220, 120, 60] as const;

function humanDelay(): number {
  if (!options.animation) return 0;
  return STEP_MS[Math.max(0, Math.min(2, options.speed))] ?? 120;
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
  const next = mechanicalAction();
  if (next === null) return;
  humanTimer = window.setTimeout(() => {
    humanTimer = null;
    if (next.type === 'step') renderer.advanceWalk();
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
      if (screen === 'options') {
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
      dispatch({ type: 'rollDice' });
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
    case HOTKEY.pageUp:
    case HOTKEY.pageDown:
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
 */
function currentDialog(): InteractionUi | null {
  if (screen !== 'game') return null;
  // 联机：待决交互只由当前座位的客户端回答；旁人不弹窗，免得替别人答
  if (!localSeatActive()) return null;
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
  optionsHot = null;
  screen = 'options';
  requestRender();
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
  const trackChanged = next.track !== options.track;
  options = next;
  sound.setMuted(next.sound === 0);
  sound.volume = volumeOf(next.sound);
  music.setVolume(next.music === 0 ? 0 : volumeOf(next.music) * 0.25);
  // 設定里那三项：00 日曆 / 01 小地圖 / 02 兩者輪流（RICH4.CFG offset 5）
  // ⚠️ 「兩者輪流」怎么轮没查证，先当日曆（点一下可以手动换）
  sidebarView = next.windowView === 1 ? 'map' : 'calendar';
  // `Midi.txt` 的前 8 条正好是設定里那 8 首樂曲
  if (trackChanged || (next.music > 0 && !music.playing)) void playTrack(next.track);
  if (next.music === 0) music.stop();
  requestRender();
}
let hud: Hud;
let sprites: SpriteCache | null = null;
let archives: LoadedArchives;

/** 開局設定的当前值与悬停 */
let setup: SetupState = defaultSetup();
let setupHot: SetupHit | null = null;

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

/** 正按着的工具栏按钮，用来画按下态 */
let pressedTool: number | null = null;

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
const diceAnim = new DiceRollAnimation();

/** 只有自己座位的回合才轮到本机做决定（联机）；单机永远是 */
function localSeatActive(): boolean {
  return net === null || net.seat === state.currentPlayer;
}

function dispatch(action: Action): void {
  if (net !== null) {
    // ★ 本地预测（T-075）：掷骰这一趟要等服务器往返，先滚起来再说。
    //   动画**不读 state.dice**，此刻它还是旧的；真点数到了由 applyAction 定格。
    if (action.type === 'rollDice') {
      const me = state.players[state.currentPlayer];
      diceAnim.start(me?.ndices ?? 1, performance.now());
    }
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
    // ★ 骰子预测（T-075）**只服务于联机**：服务器答复到了就定格；走出走子
    //   阶段就收摊（否则定格的骰子会一直挂在画面上，GO 鈕再也不出现）。
    //   单机从不 start，故这里两件事都是空操作，画面完全照旧。
    if (action.type === 'rollDice' && net !== null) diceAnim.settle(state.dice);
    else if (state.phase !== 'moving') diceAnim.cancel();
  }
  if (state !== before) {
    history.push(action);
    playSoundFor(before, state);
    // ★ 状态一变，填数页指着的那个选项下标就可能已经不是同一回事了
    //   （`pending` 换了一种，甚至换了人）。一律收掉。
    amountPage = null;
    dialogHot = null;
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
    if (action.type === 'step') renderer.advanceWalk();
    const before = state;
    state = reduce(state, action, topo);
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
type Screen = 'title' | 'setup' | 'options' | 'saveload' | 'lobby' | 'aiSettings' | 'game';
let screen: Screen = 'title';

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
function requestRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    resizeCanvas();

    stageCtx.imageSmoothingEnabled = false;
    stageCtx.fillStyle = '#000';
    stageCtx.fillRect(0, 0, SCREEN_W, SCREEN_H);

    if (screen === 'title') {
      drawTitle(stageCtx, titleHot, spriteNow);
    } else if (screen === 'setup') {
      drawSetup(stageCtx, setup, setupHot, spriteNow);
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
      drawOptions(stageCtx, optionsDraft, optionsVariant, optionsHot, (i, key = false) =>
        spriteNow('Data.mkf', OPTIONS_RESOURCE, i, key));
    } else {
      drawGameStage();
    }

    blitStage();

    // 有精灵在本帧解码完成 → 再画一次，把它们补上；
    // 骰子在滚也要继续要帧，否则动画只有一格。
    if (renderer.dirty || hud.dirty || spriteArrived || diceAnim.rolling) {
      renderer.clearDirty();
      hud.clearDirty();
      spriteArrived = false;
      requestRender();
    }
  });
}

/** 把游戏画面的三块摆到舞台上 */
function drawGameStage(): void {
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
    pressedTool,
    viewport: { w: LAYOUT.board.w, h: LAYOUT.board.h },
  });
  const dlg = currentDialog();
  const me = state.players[state.currentPlayer];
  if (dlg !== null) {
    drawDialog(boardCtx, uiSprite, dlg, amountPage, dialogHot);
  } else if (diceAnim.pipsAt(performance.now()) !== null) {
    // ★ 本地预测的骰子（T-075）：点 GO 之后、服务器答复之前先滚起来。
    //   返回 null 就表示「我不参与」，落到下面画权威值。
    drawDice(boardCtx, uiSprite, diceAnim.pipsAt(performance.now())!);
  } else if (awaitingHumanRoll() && me !== undefined) {
    // ★ 原版的 GO 鈕 + 骰子数切换（Panel.mkf 资源 7）
    drawAdvance(boardCtx, uiSprite, advanceHot, maxDiceOf(me), me.ndices);
  } else if (state.phase === 'moving' && state.dice.length > 0) {
    drawDice(boardCtx, uiSprite, state.dice);
  }
  stageCtx.drawImage(boardCanvas, LAYOUT.board.x, LAYOUT.board.y);

  // 工具栏画在棋盘上方（直接画到舞台上）
  renderer.drawToolbarTo(stageCtx, LAYOUT.toolbar.x, LAYOUT.toolbar.y, pressedTool);

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
  switch (i) {
    case 1: // 遊戲設定
      openOptions('game');
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
    { label: '买地', action: { type: 'buyLand' }, enabled: state.phase === 'awaitingDecision' },
    { label: '盖房', action: { type: 'upgradeLand' }, enabled: state.phase === 'awaitingDecision' },
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
        dispatch(b.action);
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
 *   其余三个把按钮号 post 回主消息循环由外层处理。
 *
 * ⚠️ 本项目目前把 START 与 NEW STAGE 都接到**開局設定**那一屏；
 *   原版这两者的差别（关卡/剧本）尚未解开，不装作知道。
 *   LOAD 与 EXIT 也还没接。
 */
function onTitleButton(id: 'start' | 'load' | 'option' | 'exit' | 'newStage'): void {
  switch (id) {
    case 'start':
    case 'newStage':
      screen = 'setup';
      setupHot = null;
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
  state = newGame({ map, globalMapId: setup.mapId, players, seed });
  history.length = 0;

  const first = map.nodes[state.players[0]?.nodeId ?? 1];
  camera = characterCamera(first?.x ?? 0, first?.y ?? 0, camera?.view ?? 0);
  hoverNode = null;
  screen = 'game';
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

    if (screen === 'title') {
      const hit = hitTitle(p.x, p.y, (i) => spriteNow('Data.mkf', TITLE_RESOURCE, i, true));
      const next = hit === null ? null : hit.index;
      if (next !== titleHot) {
        titleHot = next;
        requestRender();
      }
      return;
    }
    if (screen === 'setup') {
      const hit = hitSetup(p.x, p.y, setup);
      if (JSON.stringify(hit) !== JSON.stringify(setupHot)) {
        setupHot = hit;
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
    if (screen === 'options') {
      const hit = hitOptions(p.x, p.y);
      if (JSON.stringify(hit) !== JSON.stringify(optionsHot)) {
        optionsHot = hit;
        requestRender();
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

    if (awaitingHumanRoll()) {
      const on = hitAdvance(p.x - LAYOUT.board.x, p.y - LAYOUT.board.y);
      if (on !== advanceHot) {
        advanceHot = on;
        requestRender();
      }
      if (on) return;
    } else if (advanceHot) {
      advanceHot = false;
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

    if (screen === 'title') {
      const hit = hitTitle(p.x, p.y, (i) => spriteNow('Data.mkf', TITLE_RESOURCE, i, true));
      if (hit !== null) onTitleButton(hit.id);
      return;
    }
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
      const row = hitSaveLoad(saveLoadMode, p.x, p.y);
      if (row !== null) onSaveLoadRow(row);
      // ★ 点在屏外就退出 —— 原版有取消钮，那颗还没认出来
      else if (outsideSaveLoad(saveLoadMode, p.x, p.y)) closeSaveLoad();
      return;
    }
    if (screen === 'options') {
      const hit = hitOptions(p.x, p.y);
      if (hit === null) return;
      if (hit.kind === 'ok') {
        applyOptions(optionsDraft);
        screen = optionsReturn;
        requestRender();
        return;
      }
      if (hit.kind === 'cancel') {
        screen = optionsReturn;
        requestRender();
        return;
      }
      if (hit.kind === 'side') {
        // ⚠️ 这三个按钮各自还有一屏（日期更改/熱鍵設定/遊戲說明 …），都没做
        log(`⚠「${SIDE_BUTTONS[optionsVariant]?.[hit.index] ?? ''}」尚未實作`);
        return;
      }
      optionsDraft = applyOptionsHit(optionsDraft, hit);
      requestRender();
      return;
    }
    if (screen === 'setup') {
      const hit = hitSetup(p.x, p.y, setup);
      if (hit === null) return;
      if (hit.kind === 'start') {
        startGame();
        return;
      }
      if (hit.kind === 'back') {
        screen = 'title';
        requestRender();
        return;
      }
      setup = applySetupHit(setup, hit);
      requestRender();
      return;
    }

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
        dispatch({ type: 'rollDice' });
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
    if (screen !== 'game') return;
    // ⚠️ 命中判定一律走**舞台坐标**：窗口是整数倍放大且居中的，
    //   直接拿 clientX/clientY 去比 439×40 的工具栏必然对不上。
    const p = eventToStage(e);
    if (p === null) return;

    const tool = hitToolbar(p.x - LAYOUT.toolbar.x, p.y - LAYOUT.toolbar.y);
    if (tool !== null) {
      pressedTool = tool;
      requestRender();
      return; // 点在工具栏上就不要同时开始拖动地图
    }
    if (hitSidebar(p.x - LAYOUT.panel.x, p.y - LAYOUT.panel.y)) {
      // ★ 右下角那 200×200 —— **只有小地图那一面**有交互（原版 `fcn_00416e6d`）。
      //   日曆那一面点上去什么都不发生（VA 0x00418415：`cfg+5 == 0` 直接返回）。
      const lx = p.x - LAYOUT.panel.x;
      const ly = p.y - LAYOUT.panel.y - SIDEBAR.y;
      if (sidebarView !== 'map') return;

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
  window.addEventListener('mouseup', () => {
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
          if (action.type === 'step') renderer.advanceWalk();
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
        get setup() { return setup; },
        get options() { return { saved: options, draft: optionsDraft, variant: optionsVariant }; },
        goto: (s: Screen) => { screen = s; requestRender(); },
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
