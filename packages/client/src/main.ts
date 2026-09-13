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
import { Hud } from './hud.ts';
import { BoardRenderer, fitCamera, pickNode, screenToMap, type Camera } from './render.ts';

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
 * 原版底图。
 *
 * 节点坐标与底图像素同一个原点，直接按 (0, 0) 铺即可
 * （依据见 assets-pipeline 的 ground.ts）。G 键可开关，
 * 方括号/分号/引号键微调偏移——留作核对手段。
 */
let ground: ImageBitmap | null = null;
let showGround = true;
const groundOffset = { x: 0, y: 0 };

/** 走过的 action —— 回放、联机对账、以及排错都靠它 */
const history: Action[] = [];

function dispatch(action: Action): void {
  const before = state;
  state = reduce(state, action, topo);
  if (state !== before) history.push(action);
  requestRender();
  renderPanel();
  scheduleAi();
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
    if (action === null) return;
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
    renderer.draw({
      map,
      state,
      camera,
      hoverNode,
      ground: showGround ? ground : null,
      groundOffset,
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

  renderActions();
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
  );
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
  };
  return el;
}

/** 当前阶段下「显然该做的那一步」；需要人决策时返回 null */
function nextAutoAction(): Action | null {
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
    const r = canvas.getBoundingClientRect();
    const m = screenToMap(e.clientX - r.left, e.clientY - r.top, camera);
    const hit = pickNode(map, m.x, m.y);
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
    camera = { ...camera, scale: Math.min(8, Math.max(0.2, camera.scale * k)) };
    const after = screenToMap(e.clientX - r.left, e.clientY - r.top, camera);
    // 以光标为锚点缩放：保持光标下的地图点不动
    camera = { ...camera, x: camera.x + (before.x - after.x), y: camera.y + (before.y - after.y) };
    requestRender();
  }, { passive: false });

  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('mousedown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('mouseup', () => {
    drag = null;
  });
  window.addEventListener('mousemove', (e) => {
    if (drag === null) return;
    camera = {
      ...camera,
      x: camera.x - (e.clientX - drag.x) / camera.scale,
      y: camera.y - (e.clientY - drag.y) / camera.scale,
    };
    drag = { x: e.clientX, y: e.clientY };
    requestRender();
  });

  window.addEventListener('resize', requestRender);

  // ★ 底图调试键。对齐关系解出来之前，这几个键是唯一能看到底图的途径。
  window.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 50 : 10;
    switch (e.key.toLowerCase()) {
      case 'g':
        showGround = !showGround;
        log(showGround ? '▶ 显示底图' : '⏸ 隐藏底图');
        break;
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
//  启动
// ============================================================

async function boot(): Promise<void> {
  try {
    metaEl.textContent = '正在载入原版素材…';
    const archives = await loadArchives('/assets/game');
    const sprites = new SpriteCache(archives);

    const globalMapId = 0;
    map = parseMap(readMapData(archives, globalMapId));
    topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials };

    state = newGame({
      map,
      globalMapId,
      players: [
        { character: 0, kind: 'computer' },
        { character: 1, kind: 'computer' },
        { character: 2, kind: 'computer' },
        { character: 3, kind: 'computer' },
      ],
      seed: 1,
    });

    renderer = new BoardRenderer(ctx, sprites);
    hud = new Hud(hudCtx, sprites);
    resizeCanvas();
    camera = fitCamera(map, canvas.clientWidth, canvas.clientHeight);

    // 开发期调试出口：在控制台里能直接看状态与相机，排错方便
    if (import.meta.env.DEV) {
      (globalThis as unknown as { __rich4?: unknown }).__rich4 = {
        get map() { return map; },
        get state() { return state; },
        get camera() { return camera; },
        get history() { return history; },
      };
    }

    bindInput();
    requestRender();
    renderPanel();
    log(`地图载入：${map.nodes.length} 个节点、${map.lands.length} 块地`);

    // 底图后台解码，不挡住棋盘先出来
    void loadGround(archives, globalMapId).then((g) => {
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
