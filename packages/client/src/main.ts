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
  decideAction,
  nextCandidates,
  isAiTurn,
  newGame,
  reduce,
  parseMap,
  type Action,
  type GameState,
  type MapTopology,
  type Rich4Map,
} from '@rich4/core';
import { loadArchives, loadGround, readMapData, SpriteCache } from './assets.ts';
import { Hud, hitHudButton } from './hud.ts';
import { SoundPlayer } from './audio.ts';
import { MusicPlayer } from './music.ts';
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
import { VIEW_COUNT } from '@rich4/data';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>('board');
const hudCanvas = $<HTMLCanvasElement>('hud');
const hudCtx = (() => {
  const c = hudCanvas.getContext('2d');
  if (c === null) throw new Error('无法取得 HUD 绘图上下文');
  return c;
})();
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
let hud: Hud;

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
    let res = await fetch(`/assets/game/${name}`);
    if (!res.ok) res = await fetch(`/assets/game/${name.toLowerCase()}`);
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

function dispatch(action: Action): void {
  const before = state;
  state = reduce(state, action, topo);
  if (state !== before) {
    history.push(action);
    playSoundFor(before, state);
  }
  requestRender();
  renderPanel();
  scheduleAi();
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
  aiTimer = window.setTimeout(() => {
    aiTimer = null;
    const action = decideAction({ state, map });
    if (action === null) {
      // 轮到电脑却拿不出 action —— 这是**卡住**，不是「没事可做」，
      // 必须说出来。先前这里是静默 return，一个漏掉的 scheduleAi 就此藏了很久。
      if (isAiTurn(state)) log(`⚠ 电脑在 ${state.phase} 无事可做，已停手`);
      return;
    }
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
  }, aiDelayMs);
}

let aiAutoPlay = true;
const aiDelayMs = 120;

// ============================================================
//  渲染循环
// ============================================================

let renderQueued = false;
function requestRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    resizeCanvas();
    if (followPlayer) centerOnCurrentPlayer();
    renderer.draw({
      map,
      state,
      camera,
      hoverNode,
      ground: showGround ? ground : null,
      groundOffset,
      pressedTool,
    });
    hud.draw({
      state,
      map,
      camera,
      viewport: { w: canvas.clientWidth, h: canvas.clientHeight },
      ground,
    });
    // 有精灵在本帧解码完成 → 再画一次，把它们补上
    if (renderer.dirty || hud.dirty) {
      renderer.clearDirty();
      hud.clearDirty();
      requestRender();
    }
  });
}

/**
 * 把镜头平滑地移到当前玩家身上。
 *
 * 用逼近而非瞬移：棋子一步一步走，镜头硬跟会晃得厉害。
 * 系数 0.18 是「跟得上但不抖」的经验值，不是原版常量。
 */
function centerOnCurrentPlayer(): void {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return;
  const node = map.nodes[me.nodeId - 1];
  if (node === undefined) return;

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
 * 工具栏按钮。
 *
 * ⚠️ 大多数按钮**原版具体做什么还没查证**（名字是按图标外观叫的），
 *   故这里只接能确定的那一个，其余如实记一条「未实现」，不假装有功能。
 */
function onToolbar(i: number): void {
  const name = TOOLBAR_LABELS[i] ?? `按钮${i}`;
  if (i === 5) {
    // 地图图标 —— 切换人物/地图视角
    setViewMode(camera.mode === 'character' ? 'map' : 'character');
    return;
  }
  log(`「${name}」尚未实现`);
}

/**
 * 在人物视角与地图视角之间切换。
 *
 * ★ 原版小地图上方那两个按钮就是干这个的。
 *   人物视角是等距投影、跟着棋子；地图视角是整张底图俯瞰。
 */
function setViewMode(mode: 'character' | 'map'): void {
  if (camera.mode === mode) return;
  if (mode === 'character') {
    const me = state.players[state.currentPlayer];
    const node = me === undefined ? undefined : map.nodes[me.nodeId - 1];
    camera = characterCamera(node?.x ?? 0, node?.y ?? 0, camera.view);
    followPlayer = true;
  } else {
    camera = { ...fitCamera(map, canvas.clientWidth, canvas.clientHeight), view: camera.view };
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

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
  const ui =
    state.phase === 'awaitingDirection'
      ? directionUi()
      : pending === null
        ? null
        : interactionUi(pending, state);
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

/**
 * 岔路：把可走的下一格列成按钮。
 *
 * ★ 棋盘上点节点也能选（见输入那一节），但**只有点击**的话玩家
 *   根本看不出哪几格是可选的 —— 原版是把岔路高亮出来的。
 *   在补上高亮之前，先给一组明确的按钮，免得人卡在这一步。
 */
function directionUi(): InteractionUi | null {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return null;
  const candidates = nextCandidates(topo, me.nodeId, me.lastNodeId);
  if (candidates.length === 0) return null;
  return {
    title: '岔路',
    detail: `还剩 ${state.stepsRemaining} 步 —— 往哪边走？（也可以直接点棋盘上的格子）`,
    choices: candidates.map((n) => {
      const node = map.nodes[n - 1];
      const where = node?.name !== undefined && node.name !== '' ? `　${node.name}` : '';
      return { label: `节点 ${n}${where}`, action: { type: 'chooseDirection', nodeId: n } as Action };
    }),
  };
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
    // awaitingDecision / awaitingDirection 需要人来决定，停下
    default:
      return null;
  }
}

// ============================================================
//  输入
// ============================================================

function bindInput(): void {
  canvas.addEventListener('mousemove', (e) => {
    // ★ 人物视角现在也能拾取了。办法不是去解投影表的逆，而是把每个节点
    //   **正向投一遍**再比屏幕距离（见 render.ts 的 `pickNodeAt`）——
    //   用的就是绘制时那张表，所以「看得见的就点得到」。
    const r = canvas.getBoundingClientRect();
    const hit = pickNodeAt(
      map,
      e.clientX - r.left,
      e.clientY - r.top,
      camera,
      { w: canvas.clientWidth, h: canvas.clientHeight },
    );
    if (hit !== hoverNode) {
      hoverNode = hit;
      requestRender();
    }
  });

  canvas.addEventListener('click', () => {
    if (hoverNode === null) return;
    const node = map.nodes[hoverNode - 1];
    if (node === undefined) return;
    log(
      `节点 ${node.id}「${node.name || '无名'}」 ${node.ref.kind}` +
        (node.specialKind !== 0 ? ` 特殊格 ${node.specialKind}` : ''),
    );
    // 岔路选择：只有引擎正处于等待方向时才有意义
    if (state.phase === 'awaitingDirection') {
      dispatch({ type: 'chooseDirection', nodeId: node.id });
    }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const before = screenToMap(e.clientX - r.left, e.clientY - r.top, camera);
    const k = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    if (camera.mode !== 'map') return; // 人物视角的缩放由投影表定死，不可调
    followPlayer = false;
    camera = { ...camera, scale: Math.min(8, Math.max(0.2, camera.scale * k)) };
    const after = screenToMap(e.clientX - r.left, e.clientY - r.top, camera);
    // 以光标为锚点缩放：保持光标下的地图点不动
    camera = { ...camera, x: camera.x + (before.x - after.x), y: camera.y + (before.y - after.y) };
    requestRender();
  }, { passive: false });

  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('mousedown', (e) => {
    unlockAudio(); // 浏览器要求在用户手势里建 AudioContext
    const r = canvas.getBoundingClientRect();
    const tool = hitToolbar(e.clientX - r.left, e.clientY - r.top);
    if (tool !== null) {
      pressedTool = tool;
      requestRender();
      return; // 点在工具栏上就不要同时开始拖动地图
    }
    drag = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('mouseup', () => {
    drag = null;
    if (pressedTool !== null) {
      onToolbar(pressedTool);
      pressedTool = null;
      requestRender();
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (drag === null) return;
    if (camera.mode !== 'map') return; // 人物视角恒以当前玩家为中心，不能拖
    followPlayer = false;
    camera = {
      ...camera,
      x: camera.x - (e.clientX - drag.x) / camera.scale,
      y: camera.y - (e.clientY - drag.y) / camera.scale,
    };
    drag = { x: e.clientX, y: e.clientY };
    requestRender();
  });

  // 小地图上方那排视角按钮
  hudCanvas.addEventListener('mousedown', (e) => {
    unlockAudio();
    const r = hudCanvas.getBoundingClientRect();
    const hit = hitHudButton(e.clientX - r.left, e.clientY - r.top);
    if (hit === null) return;
    if (hit === 'toggleView') setViewMode(camera.mode === 'character' ? 'map' : 'character');
    if (hit === 'rotateLeft') rotateView(-1);
    if (hit === 'rotateRight') rotateView(1);
  });

  window.addEventListener('resize', requestRender);

  // ★ 底图调试键。对齐关系解出来之前，这几个键是唯一能看到底图的途径。
  window.addEventListener('keydown', (e) => {
    unlockAudio();
    const step = e.shiftKey ? 50 : 10;
    switch (e.key.toLowerCase()) {
      case 'g':
        showGround = !showGround;
        log(showGround ? '▶ 显示底图' : '⏸ 隐藏底图');
        break;
      case 'f':
        followPlayer = !followPlayer;
        log(followPlayer ? '▶ 镜头跟随当前玩家' : '⏸ 镜头自由');
        break;
      case 'm':
        sound.setMuted(!sound.muted);
        log(sound.muted ? '⏸ 静音' : '▶ 开声');
        break;
      case 'v':
        setViewMode(camera.mode === 'character' ? 'map' : 'character');
        return;
      case 'q':
        rotateView(-1);
        return;
      case 'e':
        rotateView(1);
        return;
      case '[':
        groundOffset.x -= step;
        break;
      case ']':
        groundOffset.x += step;
        break;
      case ';':
        groundOffset.y -= step;
        break;
      case "'":
        groundOffset.y += step;
        break;
      default:
        return;
    }
    if (e.key !== 'g' && e.key !== 'G') {
      log(`底图偏移 (${groundOffset.x}, ${groundOffset.y})`);
    }
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

async function boot(): Promise<void> {
  try {
    metaEl.textContent = '正在载入原版素材…';
    const archives = await loadArchives('/assets/game');
    const sprites = new SpriteCache(archives);

    const setup = readSetup();
    map = parseMap(readMapData(archives, setup.globalMapId));
    topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials };
    state = newGame({ map, globalMapId: setup.globalMapId, players: setup.players, seed: setup.seed });
    log(
      `开局：地图 ${setup.globalMapId}　种子 ${setup.seed}　` +
        setup.players.map((p, i) => `P${i + 1}${p.kind === 'human' ? '人' : '电'}`).join(' '),
    );

    renderer = new BoardRenderer(ctx, sprites);
    hud = new Hud(hudCtx, sprites);
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
        viewport: () => ({ w: canvas.clientWidth, h: canvas.clientHeight }),
        /** 某个节点此刻画在屏幕的哪里；不在视野内返回 null */
        project: (nodeId: number) => {
          const n = map.nodes[nodeId - 1];
          if (n === undefined) return null;
          return worldToScreen(n.x, n.y, camera, {
            w: canvas.clientWidth,
            h: canvas.clientHeight,
          });
        },
        /** 屏幕坐标落在哪个节点上 —— 与鼠标走的是同一条路径 */
        pick: (sx: number, sy: number, radius?: number) =>
          pickNodeAt(
            map,
            sx,
            sy,
            camera,
            { w: canvas.clientWidth, h: canvas.clientHeight },
            radius,
          ),
      };
    }

    bindInput();
    requestRender();
    renderPanel();
    log(`地图载入：${map.nodes.length} 个节点、${map.lands.length} 块地`);

    // 音效档案后台拉取。Speaking.mkf 有 57MB，先不装。
    void fetch('/assets/game/Effect.mkf')
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => {
        if (buf === null) return;
        sound.addArchive('Effect.mkf', new Uint8Array(buf));
        log('音效载入：Effect.mkf（首次点击后开声）');
      })
      .catch(() => log('⚠ 音效载入失败'));

    // 底图后台解码，不挡住棋盘先出来
    void loadGround(archives, setup.globalMapId).then((g) => {
      ground = g;
      if (g === null) {
        log('⚠ 底图未能解出');
        return;
      }
      log(`底图载入：${g.width}×${g.height}（G 键开关）`);
      requestRender();
    });
    scheduleAi();
  } catch (err) {
    metaEl.className = 'err';
    metaEl.textContent = `启动失败：${err instanceof Error ? err.message : String(err)}`;
    throw err;
  }
}

void boot();
