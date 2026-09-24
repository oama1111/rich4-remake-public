/*
 * 出厂设定 / 侧栏初值 —— 单机与联机同源（第十六份试玩回报，2026-09-24）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方回报（Charles，`feedback/20260924-000111128-manual-Charles.json`）：
 * 「之前让你修复过的默认展示缩小地图、游戏速度最快是不是没部署到多人模式？以后记得两边模式都要同步更新」
 *
 * 查下来：两条开局路（单机 `startGame()` / 联机 `onStart` / 失步重建 `onResync`）**本来就读同一份**
 * `options` / `sidebarView`（开机 `loadConfigFromStore()` 定一次）。回报里单机的 `env.options` 是
 * `speed 2 / windowView 1` —— 那是浏览器里存着的 RICH4.CFG；联机若开在没有 cfg 的窗口里，
 * 吃的是 `DEFAULT_OPTIONS` —— 先前是 `speed 1 / windowView 0`，而且没有 cfg 时
 * `loadConfigFromStore()` 直接 return、侧栏停在硬编码的 `'calendar'`。
 *
 * 这里钉三件事：
 *   ① 出厂值：視窗 = 小地圖（原版 `0x00411efc`）、速度 = 最快（需求方拍板，有意偏离）；
 *   ② 没有 cfg / 有 cfg 两种开机，侧栏都从同一个换算（`sidebarViewOf`）来；
 *   ③ 两条开局路都**不改** `options` / `sidebarView`，且开机先读 cfg 再分流到单机 / 联机 ——
 *      ⇒ 同一台机器上两边一定是同一套；另附「单机开局的换局清理，联机逐行都有」的漂移检测。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, sidebarViewOf } from './options.ts';

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

const slice = (from: string, to: string): string => {
  const a = main.indexOf(from);
  const b = main.indexOf(to, a + from.length);
  return a < 0 || b < 0 ? '' : main.slice(a, b);
};

const startGame = slice('function startGame(): void {', '//  输入');
const onStart = slice('onStart: (start) => {', '// ★★ 第七份试玩回报第 1 条');
const onResync = slice('onResync: (r) => {', 'fingerprint: () => stateFingerprint(state),');
const boot = slice('async function boot(): Promise<void> {', 'void boot();');
const loadCfg = slice('function loadConfigFromStore(): void {', 'function saveConfigToStore(): void {');
const loadState = slice('function loadState(', 'log(`▶ 讀檔：');
const autosave = slice('function autosaveIfEnabled(next: GameState): void {', '/** 真人那条驱动这一次排程是不是');
const applyVolumesFn = slice('function applyVolumes(o: GameOptions): void {', '/** 把設定的取值真的作用到播放器与側欄上 */');
const applyOptionsFn = slice('function applyOptions(next: GameOptions): void {', 'requestRender();');

describe('★★ 出厂设定（没有 RICH4.CFG 时）', () => {
  it('視窗 = 01 小地圖 @source 0x00411efc `mov byte [0x49715d], ah`（ah = 1）', () => {
    expect(DEFAULT_OPTIONS.windowView).toBe(1);
    expect(sidebarViewOf(DEFAULT_OPTIONS.windowView)).toBe('map');
  });

  it('速度 = 2（3 格、最快）—— 需求方 2026-09-23 拍板；原版出厂是 1（0x00411edc）', () => {
    expect(DEFAULT_OPTIONS.speed).toBe(2);
  });

  it('音樂 4 / 音效 4 / 自動存檔 开 / 動畫 开 @source 0x00411eea / 0x00411ef0 / 0x00411ef6 / 0x00411ee2', () => {
    expect(DEFAULT_OPTIONS.music).toBe(4);
    expect(DEFAULT_OPTIONS.sound).toBe(4);
    expect(DEFAULT_OPTIONS.autoSave).toBe(true);
    expect(DEFAULT_OPTIONS.animation).toBe(true);
  });

  it('`sidebarViewOf`：01 → 小地圖；00 / 02 → 日曆（02 輪流未查证，维持暂定）', () => {
    expect(sidebarViewOf(0)).toBe('calendar');
    expect(sidebarViewOf(1)).toBe('map');
    expect(sidebarViewOf(2)).toBe('calendar');
  });

  it('没有 cfg ⇒ 就是出厂值（`options` 初值 = `DEFAULT_OPTIONS`，读 cfg 只在有文件时覆盖）', () => {
    expect(main).toContain('let options: GameOptions = { ...DEFAULT_OPTIONS };');
    expect(loadCfg).toMatch(/if \(cfg !== null\) \{\s*options = \{\s*\.\.\.options,/);
  });
});

describe('★★ 单机与联机同源：只在开机定一次，两条开局路都不改', () => {
  it('切片都取到了', () => {
    for (const [name, s] of Object.entries({ startGame, onStart, onResync, boot, loadCfg })) {
      expect(s.length, name).toBeGreaterThan(100);
    }
  });

  it('侧栏初值不再硬编码，与出厂值同源', () => {
    expect(main).toContain('let sidebarView: SidebarView = sidebarViewOf(DEFAULT_OPTIONS.windowView);');
    expect(main).not.toMatch(/let sidebarView: SidebarView = '(calendar|map|month)'/);
  });

  it('开机读 cfg：没有 cfg 也走完（不提前 return），侧栏按同一个换算定', () => {
    expect(loadCfg).toContain('sidebarView = sidebarViewOf(options.windowView);');
    expect(loadCfg).not.toMatch(/if \(cfg === null\) return/);
    // 設定屏「確定」也走同一个换算
    expect(main).toContain('sidebarView = sidebarViewOf(next.windowView);');
    // 除上面两处与侧栏自己的切换钮外，没有别处再按 windowView 自己换算
    expect(main.match(/windowView === 1 \? 'map'/g)).toBeNull();
  });

  it('★ 开机先读 cfg，再分流到联机 / 单机 / 门厅', () => {
    const cfgAt = boot.indexOf('loadConfigFromStore();');
    expect(cfgAt).toBeGreaterThan(0);
    for (const entry of ['connectOnline(online.url', 'startGame();', 'void openFoyer();']) {
      const at = boot.indexOf(entry);
      expect(at, entry).toBeGreaterThan(cfgAt);
    }
  });

  it('★ 三条开局路（单机 / 联机开局 / 失步重建）都不改 `options` / `sidebarView`', () => {
    for (const [name, s] of Object.entries({ startGame, onStart, onResync })) {
      expect(s, name).not.toMatch(/\boptions = /);
      expect(s, name).not.toMatch(/\bsidebarView = /);
      expect(s, name).not.toContain('loadConfigFromStore(');
    }
  });

  it('★ 漂移检测：单机开局的换局清理 / 进棋盘动作，联机 `onStart` 逐行都有', () => {
    // 单机 `startGame()` 从 `history.length = 0;` 到 `goButton.reset();` 那一段，每一条语句
    const a = startGame.indexOf('history.length = 0;');
    const b = startGame.indexOf('goButton.reset();', a);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    const lines = startGame
      .slice(a, b + 'goButton.reset();'.length)
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(15);
    for (const line of lines) expect(onStart, `onStart 缺 ${line}`).toContain(line);
    // 进棋盘那几件：镜头、背景曲、语音包、底图（**带 hdSource**）、小地图、驱动
    for (const line of [
      'camera = pixelCamera(first?.x ?? 0, first?.y ?? 0, state.viewRotation);',
      'holidayBgmDays = 0;',
      'playBoardBgm(1);',
      'ensureSpeakingArchive();',
      'setGround(null);',
      'hdSource).then((g) => {',
      'loadMinimapAssets(',
      'renderPanel();',
      'scheduleAi();',
      'scheduleHumanTurn();',
    ]) {
      expect(startGame, `startGame 缺 ${line}`).toContain(line);
      expect(onStart, `onStart 缺 ${line}`).toContain(line);
    }
  });
});

describe('★★ 开机音量 / 面板页号 / 自動存檔（第十六份回报续，需求方 2026-09-24）', () => {
  it('切片都取到了', () => {
    for (const [name, x] of Object.entries({ loadState, autosave, applyVolumesFn, applyOptionsFn })) {
      expect(x.length, name).toBeGreaterThan(80);
    }
  });

  it('★ 开机就按 cfg（或出厂值）作用音量 —— 只作用音量，不写档、不起停曲子', () => {
    expect(loadCfg).toContain('applyVolumes(options);');
    expect(applyOptionsFn).toContain('applyVolumes(next);');
    for (const line of ['sound.setMuted(o.sound === 0);', 'sound.volume = volumeOf(o.sound);', 'music.setVolume(']) {
      expect(applyVolumesFn, line).toContain(line);
    }
    for (const banned of ['saveConfigToStore(', 'playBoardBgm(', 'music.stop(']) {
      expect(applyVolumesFn, banned).not.toContain(banned);
      expect(loadCfg, banned).not.toContain(banned);
    }
    expect(applyVolumesFn).not.toContain('options =');
  });

  it('★ 新局（单机 / 联机）与读档都把四位的面板页号归零（`0x48be24` 由 0x401 分支清零）', () => {
    for (const [name, x] of Object.entries({ startGame, onStart, loadState })) {
      expect(x, name).toContain('panelPages.fill(0);');
      expect(x, name).toContain('autosaveDateKey = null;');
    }
    // 失步重建是同一局，不清
    expect(onResync).not.toContain('panelPages.fill(0);');
  });

  it('★ 自動存檔走 `autosaveStep`（推过日期才存、不分人机），联机不存', () => {
    expect(autosave).toContain('if (net !== null) return;');
    expect(autosave).toContain('autosaveStep(next, autosaveDateKey)');
    expect(autosave).toContain('writeSlot(AUTOSAVE_SLOT, next)');
    // ★ 挂在真人 / 电脑两条施加路共用的漏斗上（电脑走 `scheduleAi` 的直路，不经 `applyAction`）
    const funnel = slice('function reduceRecorded(action: Action): GameState {', 'return next;');
    expect(funnel).toContain('autosaveIfEnabled(next);');
    expect(main.match(/autosaveIfEnabled\(/g)?.length).toBe(2); // 定义 + 漏斗里那一处
    expect(main.match(/state = reduceRecorded\(action\)/g)?.length).toBe(2); // applyAction + scheduleAi
    // 旧判据（只在真人 awaitingRoll 存）不许回来
    expect(autosave).not.toContain('isAiTurn(');
    expect(autosave).not.toContain("'awaitingRoll'");
  });
});
