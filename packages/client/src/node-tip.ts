/*
 * 名板浮标 —— 点棋盘上的东西弹出来的那个文字小框 —— Q-HOVER-1
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ## 它是谁、什么时候出来（全部去 exe 核过）
 *
 * 原版棋盘窗口过程是 `fcn_00417e26`（VA 0x00417e26）。它把
 * `WM_LBUTTONDOWN` / `WM_LBUTTONDBLCLK`（0x201 / 0x203）与
 * `WM_LBUTTONUP`（0x202）、`WM_MOUSEMOVE`（0x200）分给四个地方，其中：
 *
 * ```asm
 * 00417e95  cmp eax, 0x200
 * 00417e9a  je  loc_00418910          ; 0x200 = 鼠标移动
 * ...
 * loc_00418670:                        ; ← 由 0x201 那一支落到这里
 * 00418670  cmp esi, 0x1b8              ; x < 440（棋盘那一栏）
 * 00418674  jge loc_004186a7
 * 0041867a  cmp edx, 0x28              ; y > 40（工具栏之下）
 * 0041867e  jge loc_004186a7
 * ...
 * loc_004186a7:
 * 004186a7  cmp esi, 0x1b8
 * 004186ab  jge loc_00418c30
 * 004186b1  cmp edx, 0x28
 * 004186b5  jle loc_00418c30
 * 004186bb  push edx / push esi
 * 004186bd  call fcn_00417559          ; ★ 画浮标：f(x, y)
 * ```
 *
 * 所以**触发条件是「在棋盘上按下左键」**（x < 0x1b8、y > 0x28），
 * 不是悬停 —— `0x200` 那一路（`loc_00418b63`）只做**擦掉**：
 *
 * ```asm
 * loc_00418b63:
 * 00418b63  cmp dword [0x475270], 0     ; 浮标钉住了吗
 * 00418b6a  je  loc_00418c30
 * 00418b6c  call fcn_00417c67           ; 把先前存下的底图贴回去 = 擦掉
 * ```
 *
 * `WM_LBUTTONUP` 那一支（`loc_00418878`）同样 `call fcn_00417c67`。
 * 于是这块名牌**只在按住左键期间挂在屏幕上**：按下出现、抬手（或鼠标一动）就没。
 *
 * ## 框长什么样
 *
 * `fcn_00417559` 先把光标底下的实例查出来（`_rich4_get_instance_from_position`
 * VA 0x0040a9d7，查的是 `0x474938` 那张表；传进去的 y 先减了 `0x28`），
 * 命中就：
 *
 * ```asm
 * 004175c4  play_sound_effect(0x482322, 0)     ; 音效 1（与标题的 TITLE_CLICK 同一个）
 * 004175dd  ebp = (word[0x48bad8 + 0xe] <= y) ? 1 : 0     ; 往下放 / 往上放
 * 004175f9  if (x > 0x1b8 - word[0x48bad8 + 0xc]) ebp += 2 ; 往右放 / 往左放
 * 00417722  create_font(0x10, 0xf0f0f0, 0x101010, 3, 1)   ; 16 号、白字黑边
 * 00417780  fcn_00451a97(…)                     ; 把框底下那块**底图存进 [0x48bde0]**
 * 004177ab  fcn_00456418([0x48a08c], 图, x, y)  ; 把第 ebp 张**名板图**贴到光标上
 * …
 * 00417c4d  [0x475270] = 1                      ; 钉住（供 0x200/0x202 擦除）
 * ```
 *
 * 名板图 = **`Data.mkf` 资源 0x205（517）的第 0..3 张**，四张都是 189×116，
 * 只有「小尾巴」冲哪个角不同。锚点（资源头 `chunk_tab[i].x/y`，见
 * `assets-clean/manifest.json` 的 `Data/0517_000..003`）：
 *
 * | 图 | 锚点 | 尾巴 | 框落在 |
 * |---|---|---|---|
 * | 0 | (0, 0) | 左上 | 光标右下 |
 * | 1 | (0, 116) | 左下 | 光标右上 |
 * | 2 | (189, 0) | 右上 | 光标左下 |
 * | 3 | (189, 116) | 右下 | 光标左上 |
 *
 * ★ 这四张就是 `[0x48bad8] + 0x0c + 12 × ebp` —— 精灵表从 `+0x0c` 起每张 12 字节头，
 * 所以 **ebp 直接就是图号**（与 `hud.ts` 记的箭头图 18/19 同一套算法）。
 *
 * ## 文本怎么拼（逐条照 `fcn_00417559` 的分支）
 *
 * 实例编号的分区（`loc_004177ed` / `loc_00417942` / `loc_00417ae4` / `loc_00417b4f`）：
 *
 * | 区间 | 是什么 | 依据 |
 * |---|---|---|
 * | `1 .. 0x7cf` | 节点（路面 / 特殊格）| `< 0x7d0`，且**名字非空才画** |
 * | `0x7d0 .. 0xf9f` | 地块 | `0x7d0 + 下标` |
 * | `0xfa0 .. 0x176f` | 設施 | `0xfa0 + 下标` |
 * | `0x1770 .. 0x1f3f` | 上市企业 | `0x1770 + 下标` |
 * | `0x1f40 .. 0x270f` | 特殊景觀 | `0x1f40 + 下标` |
 * | bit15 置 1 | 玩家棋子 / 附身的神明 | `test byte [esp+0x4d], 0x80` |
 *
 * **企业 = 三行**（行距 `0x1b`）：`董事長`（`)玩家名`）→ `企業名` → `餘股:%d`
 * （`commercial + 0x30`）。业主为空时第一行留白，名字仍画在 `+0x1b`。
 * **景觀 / 节点 = 一行**（`ebx += 0x1b` 后居中画名字）—— 这就是需求方说的
 * 「景物」：地圖数据里 `landscape + 0x04` 那份串（阿里山、佛光山、台中港…）。
 *
 * 三条容易看错的：
 *   - 第一行是 `player->name_ptr`（`mov ebp, dword [eax + 0x496b68]`，
 *     玩家结构 +0 = `const char *name_ptr`），本引擎没有改名功能 → 角色名。
 *   - 行**间距不是常数**：企业/景观是 `0x1b`，地块/設施是 `0x12`。
 *   - 文本块是**以蓝底中心**排的：往下的框基准 `y+0x2a`、往上的框 `y−0x60`，
 *     加上行偏移后整块正好落在名板内框中心（189×116 的内框在 (29,33)-(174,104)）。
 *
 * ## 与「查詢」按钮/熱鍵**不是一回事**
 *
 * 熱鍵 16 名叫「查詢」，但它映射的是工具栏第 6 颗
 * （`rich4_keyboard_hook.asm` 的 `cfg+48` → `push 6` →
 * `_rich4_ui_clicking_top_panel(6)`），那颗进的是
 * `_rich4_ui_player_info_view_entry`（**個人資產表屏**，T-022）。
 * 名牌浮标是棋盘窗口过程自己画的，与那颗钮、与熱鍵都没有关系。
 *
 * ⚠️ 本模块只算「该画什么」，`drawTip` 只做 IO。
 */

import { INMATE_NAMES, OBJECT_NAMES, isAlive, type GameState, type Rich4Map } from '@rich4/core';
import { CHARACTERS } from '@rich4/data';
import { FONT_FAMILY } from './font.ts';

// ============================================================
//  名板图
// ============================================================

/** 名板图所在档案 @source VA 0x0040808f `read_mkf(Data.mkf, 0x205, 0, 0)` */
export const TIP_ARCHIVE = 'Data.mkf';
/** @source 同上 `push 0x205` */
export const TIP_RESOURCE = 0x205;
/** 四张名板都是 189×116 @source 资源头 `chunk_tab[0..3]` */
export const TIP_FRAME_W = 189;
export const TIP_FRAME_H = 116;

/**
 * 四张图的锚点 —— 就是精灵表里那四张的 `x/y`
 * @source `Data/0517_000..003`（资源头，见 `assets-clean/manifest.json`）
 */
export const TIP_ANCHORS: readonly { x: number; y: number }[] = [
  { x: 0, y: 0 },
  { x: 0, y: TIP_FRAME_H },
  { x: TIP_FRAME_W, y: 0 },
  { x: TIP_FRAME_W, y: TIP_FRAME_H },
];

/** 棋盘那一栏的宽度（`x < 0x1b8` 才算棋盘）@source `loc_00418670` 的 `cmp esi, 0x1b8` */
export const TIP_BOARD_WIDTH = 0x1b8;
/** 工具栏高度：实例表查的是 `y − 0x28` @source `fcn_00417559` 开头 */
export const TIP_BOARD_TOP = 0x28;

// ============================================================
//  文字落点与样式
// ============================================================

/** 文字横向离光标 `189/2 + 9` @source VA 0x00417611..0x00417620 */
export const TIP_TEXT_DX = Math.trunc(TIP_FRAME_W / 2) + 9;
/** 框往**下**放时，文字基准 = 光标 y + 0x2a @source VA 0x00417665 */
export const TIP_TEXT_DOWN = 0x2a;
/** 框往**上**放时，文字基准 = 光标 y − 0x60 @source VA 0x004176f9 */
export const TIP_TEXT_UP = -0x60;
/** 行距（企业 / 景观 / 单行居中）@source VA 0x00417b2c `add ebx, 0x1b` */
export const TIP_LINE = 0x1b;
/** 行距（地块 / 設施）@source VA 0x00417840 `add ebx, 0x12` */
export const TIP_LINE_TIGHT = 0x12;
/** 单行（节点/景观）画在 `+0x1b` 上 —— 正好是内框中心 @source VA 0x004177d5 */
export const TIP_SINGLE_DY = 0x1b;
/** 玩家棋子那一路画在 `+0x19` @source VA 0x00417bea */
export const TIP_TOKEN_DY = 0x19;

/** @source VA 0x00417722 `create_font(0x10, 0xf0f0f0, 0x101010, 3, 1)` */
export const TIP_FONT_SIZE = 0x10;
export const TIP_FILL = '#f0f0f0';
export const TIP_STROKE = '#101010';

// ============================================================
//  实例编号
// ============================================================

/** 各类实例的编号基址 @source `fcn_00417559` 那几条 `cmp/jge` */
export const TIP_ID = {
  land: 0x7d0,
  facility: 0xfa0,
  commercial: 0x1770,
  landscape: 0x1f40,
  end: 0x2710,
  token: 0x8000,
} as const;

/** 浮标要画的是哪一类实例 */
export type TipInstance =
  | { kind: 'node'; id: number }
  | { kind: 'land'; id: number }
  | { kind: 'facility'; id: number }
  | { kind: 'commercial'; id: number }
  | { kind: 'landscape'; id: number }
  | { kind: 'player'; index: number }
  | { kind: 'object'; index: number };

/**
 * 实例编号 → 类别。**照抄原版的区间**（含 `0x7d0`、`0xfa0` 这些端点各自的
 * `jle/jge` 方向：恰好落在端点上的编号**不属于**前一段）。
 */
export function tipInstanceOf(instance: number): TipInstance | null {
  if (!Number.isInteger(instance) || instance <= 0) {
    // 原版对 ≤0 的编号会去读越界内存（`cmp byte [node_ptr + (id*5)*8 + 4], 0`）；
    // 实例表里不会出现这种编号，这里直接当「没有」。
    return null;
  }
  // ★ 端点（`0x7d0` / `0xfa0` / `0x1770` / `0x1f40`）**不属于**任何一段：原版
  //   那几处比的是 `jle/jge`，正好相等时一路落到最下面那段「棋子/神明」去。
  if (instance < TIP_ID.end) {
    if (instance < TIP_ID.land) return { kind: 'node', id: instance };
    if (instance > TIP_ID.land && instance < TIP_ID.facility) {
      return { kind: 'land', id: instance - TIP_ID.land };
    }
    if (instance > TIP_ID.facility && instance < TIP_ID.commercial) {
      return { kind: 'facility', id: instance - TIP_ID.facility };
    }
    if (instance > TIP_ID.commercial && instance < TIP_ID.landscape) {
      return { kind: 'commercial', id: instance - TIP_ID.commercial };
    }
    if (instance > TIP_ID.landscape) {
      return { kind: 'landscape', id: instance - TIP_ID.landscape };
    }
  } else {
    // @source 0x00417588：`test byte [esp+0x4d], 0x80` + `test word [esp+0x4c], 0x7fff`
    if ((instance & TIP_ID.token) === 0) return null;
    if ((instance & 0x7fff) === 0) return null;
  }
  // 走到这里 = 棋子 / 附身神明那一段（端点掉进来的那两种也照这条走）
  if ((instance & 0xff) !== 0) {
    // 玩家棋子：`0x8000 | (1 << 玩家号)`，用尾零个数取号
    const p = trailingZeros8(instance);
    if (p < 0) return null;
    // 4..7 是四个人物（`_rich4_special_player_names` 那四个名字）
    return { kind: 'player', index: p };
  }
  return { kind: 'object', index: (instance & 0x7f00) >> 8 };
}

/** 该实例的编号（节点就是节点号） */
export function tipInstanceId(inst: TipInstance): number {
  switch (inst.kind) {
    case 'node':
      return inst.id;
    case 'land':
      return TIP_ID.land + inst.id;
    case 'facility':
      return TIP_ID.facility + inst.id;
    case 'commercial':
      return TIP_ID.commercial + inst.id;
    case 'landscape':
      return TIP_ID.landscape + inst.id;
    case 'player':
      return TIP_ID.token | (1 << inst.index);
    case 'object':
      return TIP_ID.token | (inst.index << 8);
  }
}

/** `count_trailing_zero_u8`（VA 0x0040d293）：低字节的尾零个数，0 = 不是 2 的幂 */
function trailingZeros8(v: number): number {
  const b = v & 0xff;
  if (b === 0) return -1;
  let n = 0;
  let x = b;
  while ((x & 1) === 0 && n < 8) {
    x >>= 1;
    n++;
  }
  return n;
}

// ============================================================
//  命中测试
// ============================================================

/** 命中半径（棋盘格 32 世界单位一格，见 `picking.ts` 的同类做法）*/
export const TIP_HIT_RADIUS = 24;

export interface TipCandidate {
  instance: TipInstance;
  /** 世界坐标（画在哪就命中在哪 —— 地块/設施/企业/景观用它们自己的记录坐标）*/
  wx: number;
  wy: number;
}

/**
 * 原版把「画上去的东西」按**像素**戳进实例表 `0x474938`
 * （`fcn_00409b18` + `0x456a1c`：逐像素、只戳非透明像素、**后戳的盖住先戳的**）。
 * 本引擎拿不到那张表，于是照 `picking.ts` 的办法：把每个实例的**记录坐标**
 * 正向投到屏幕，比距离。
 *
 * ★ 只收**有名字的节点**：原版对节点多一道 `cmp byte [node+4], 0`（VA 0x004175b9），
 *   名字空的路面根本不弹框。景觀**没有**这道检查（名字空的照弹，框里是空的），
 *   所以这里照样收进来。
 */
export function tipCandidates(map: Rich4Map, state: GameState): TipCandidate[] {
  const out: TipCandidate[] = [];
  for (const n of map.nodes) {
    if (n.name !== '') out.push({ instance: { kind: 'node', id: n.id }, wx: n.x, wy: n.y });
  }
  for (const l of map.lands) {
    out.push({ instance: { kind: 'land', id: l.id }, wx: l.x, wy: l.y });
  }
  for (const f of map.facilities) {
    out.push({ instance: { kind: 'facility', id: f.id }, wx: f.x, wy: f.y });
  }
  for (const c of map.commercials) {
    out.push({ instance: { kind: 'commercial', id: c.id }, wx: c.x, wy: c.y });
  }
  for (const l of map.landscapes) {
    out.push({ instance: { kind: 'landscape', id: l.id }, wx: l.x, wy: l.y });
  }
  // 棋子与神明/道具：原版也戳进那张表，站在建筑上的时候后戳的盖住建筑
  for (const p of state.players) {
    if (!isAlive(p)) continue; // 出局的人不画，也就点不到
    const n = map.nodes[p.nodeId - 1];
    if (n === undefined) continue;
    out.push({ instance: { kind: 'player', index: p.index }, wx: n.x, wy: n.y });
  }
  for (let i = 0; i < state.objects.length; i++) {
    const o = state.objects[i];
    if (o === undefined || o.nodeId === 0) continue;
    const n = map.nodes[o.nodeId - 1];
    if (n === undefined) continue;
    out.push({ instance: { kind: 'object', index: i + 1 }, wx: n.x, wy: n.y });
  }
  return out;
}

/**
 * 同距时的优先级 —— 复现「后戳的盖住先戳的」：
 * 棋子/神明（最后画）> 建筑（地块/設施/企业/景观）> 路面节点（最先戳）。
 */
const TIP_PRIORITY: Record<TipInstance['kind'], number> = {
  player: 3,
  object: 3,
  commercial: 2,
  landscape: 2,
  land: 2,
  facility: 2,
  node: 1,
};

/**
 * 光标底下是哪个实例。`toScreen` 由调用方给（`render.ts` 的 `worldToScreen`），
 * 本模块不碰相机。
 */
export function hitTipInstance(
  cands: readonly TipCandidate[],
  sx: number,
  sy: number,
  toScreen: (wx: number, wy: number) => { x: number; y: number } | null,
  radius = TIP_HIT_RADIUS,
): TipInstance | null {
  let best: TipInstance | null = null;
  let bestD2 = 0;
  let bestP = 0;
  const r2 = radius * radius;
  for (const c of cands) {
    const p = toScreen(c.wx, c.wy);
    if (p === null) continue;
    const dx = p.x - sx;
    const dy = p.y - sy;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue; // 不在命中半径内
    const pr = TIP_PRIORITY[c.instance.kind];
    // 优先级高的赢；同级比距离（同距取先遇到的，与「后戳的盖住先戳的」一致）
    if (best !== null && (pr < bestP || (pr === bestP && d2 >= bestD2))) continue;
    best = c.instance;
    bestD2 = d2;
    bestP = pr;
  }
  return best;
}

// ============================================================
//  文本
// ============================================================

export interface TipLine {
  text: string;
  /** 相对文字基准的纵向偏移（原版的 `ebx + …`）*/
  dy: number;
}

/** 千分位整数串 —— 原版 `rich4_num_to_currency_string`（VA 0x00452793）**没有 `$`** */
export function tipNumber(n: number): string {
  return Math.trunc(n).toLocaleString('en-US');
}

/** 地块等级名 @source 表 0x475138（下标 = 等级） */
export const LAND_LEVEL_NAMES: readonly string[] = [
  '空  地', '平  房', '店  舖', '商  場', '商業大樓', '摩天大樓',
];

/** 设施类别名 @source 表 0x475150（下标 = `facility + 0x18`） */
export const FACILITY_TYPE_NAMES: readonly string[] = [
  '公  園', '旅  館', '購物中心', '加油站', '研究所',
];

/** 等级名 @source 表 0x475164（下标 = `facility/land + 0x1a`） */
export const LEVEL_NAMES: readonly string[] = ['０級', '一級', '二級', '三級', '四級', '五級'];

/**
 * 研究所「開發出来的東西」的名字 —— 表 **0x47ff1a**，6 项。
 *
 * ★★ 这张表**不是一个独立的名字表**，而是 `_tool_table`（0x47fee2）**从第 8 件
 *   道具起**那 6 行（每行 8 字节 = `{char *name; uint8 init; uint8 price; uint8 f6; uint8 f7}`）：
 *   ```asm
 *   00417ad3  mov al, byte [edi + 0x1d]                 ; 項目 1..5
 *   00417ad8  mov ebx, dword [eax*8 + 0x47ff1a]         ; ★ _tool_table + 56 = 8×7
 *   0041ce18  mov al, byte [ebx + 0x1d] / add eax, 8    ; 发道具 = 項目 + 8
 *   ```
 *   `0x47fee2 + 56 = 0x47ff1a` ⇒ 下标 `i` 指向的是**道具 `i + 8`**，
 *   所以这 6 个名字**恒等于** `TOOLS[7..12]`（道具 8..13）。
 *   第二列不是指针，是 `{init_amount, price, f6, f7}` 那 4 个字节
 *   （实测 遙控骰子那行 = `0x00011e0a` = `{10, 30, 1, 0}`，与 `rich4_tool_table.c` 逐字对上）。
 *
 * ⚠️ 名字与 `@rich4/data` 的 `TOOLS` 必须一致 —— `node-tip.test.ts` 有一条断言钉住，
 *   免得两边各写一份漂移。
 */
export const FACILITY_DEV_NAMES: readonly string[] = [
  '遙控骰子', '機器工人', '時光機', '傳送機', '工程車', '核子飛彈',
];

/** 玩家名 —— 原版抄的是 `player->name_ptr`（+0）；本引擎没有改名，取角色名 */
export function tipPlayerName(state: GameState, index: number): string {
  const p = state.players[index];
  if (p === undefined) return '';
  return CHARACTERS[p.character]?.name ?? `玩家${index + 1}`;
}

/**
 * 某一类实例的文本行。**纯函数**：只读 `state` 与地图，不改。
 * `dy` 是相对文字基准的偏移（见 `tipPlacement`）。
 */
export function tipLines(map: Rich4Map, state: GameState, inst: TipInstance): TipLine[] {
  const out: TipLine[] = [];
  const add = (text: string, dy: number): void => {
    out.push({ text, dy });
  };

  switch (inst.kind) {
    // ── 节点：一行名字（`ebx += 0x1b` 后画）@source VA 0x004177c2 ──
    case 'node': {
      const n = map.nodes[inst.id - 1];
      if (n === undefined || n.name === '') return [];
      add(n.name, TIP_SINGLE_DY);
      return out;
    }

    // ── 特殊景觀：一行名字（同一段代码，只是基址换成 0x498e78）@source VA 0x00417b63 ──
    case 'landscape': {
      const l = map.landscapes[inst.id - 1];
      // ★ 原版**没有**空名字检查：名字空的照弹框，框里是空的
      add(l?.name ?? '', TIP_SINGLE_DY);
      return out;
    }

    // ── 上市企业：董事長 / 企業名 / 餘股 @source VA 0x00417ae4 ──
    case 'commercial': {
      const c = map.commercials[inst.id - 1];
      if (c === undefined) return [];
      // ★ 这两张表的下标是企業 **id**（1 基，0 号空着，与 core 一致）；`map.commercials` 才是 0 基数组。
      //   先前两处都写成 `inst.id - 1`：名牌上显示的是**前一家**的董事長与餘股。
      const owner = state.commercialOwners[inst.id]?.owner ?? 0;
      if (owner !== 0) add(tipPlayerName(state, owner - 1), 0);
      add(c.name, TIP_LINE);
      add(`餘股:${state.commercialShares[inst.id] ?? 0}`, TIP_LINE * 2);
      return out;
    }

    // ── 地块 @source VA 0x004177ed ──
    case 'land': {
      const l = map.lands[inst.id - 1];
      if (l === undefined) return [];
      const owner = state.landOwner[inst.id] ?? 0;
      const level = state.landLevel[inst.id] ?? 0;
      const chain = l.type !== 0;
      if (owner !== 0) add(tipPlayerName(state, owner - 1), 0);
      if (level === 0) add('空  地', TIP_LINE_TIGHT);
      else if (chain) add('連鎖店', TIP_LINE_TIGHT);
      else add(LAND_LEVEL_NAMES[level] ?? '', TIP_LINE_TIGHT);
      add(LEVEL_NAMES[level] ?? '', TIP_LINE_TIGHT * 2);
      // 第三行是三选一（@source 0x0041789c 起）：
      //   无主   → 该等级的过路费 `rentByLevel[level]`
      //   有主+連鎖 → `2000 × 物價指數` 后面接 `×連鎖店數`
      //   有主+非連鎖 → 同名地块的过路费之和（VA 0x00419744）
      if (owner === 0) {
        add(tipNumber(l.rentByLevel[level] ?? 0), TIP_LINE_TIGHT * 3);
      } else if (chain) {
        const count = map.lands.filter((o) => o.type !== 0 && (state.landOwner[o.id] ?? 0) === owner).length;
        add(`${tipNumber(2000 * state.priceIndex)}×${count}`, TIP_LINE_TIGHT * 3);
      } else {
        add(tipNumber(sameNameRent(map, state, owner, l.name)), TIP_LINE_TIGHT * 3);
      }
      return out;
    }

    // ── 設施 @source VA 0x00417942 ──
    case 'facility': {
      const f = map.facilities[inst.id - 1];
      if (f === undefined) return [];
      // ★ 原版读的是**运行时那条設施记录**（`blands`，地图数据被就地改写）。
      //   本引擎拆成「地图模板 + `state.facility*`」，故一律以 state 为准、
      //   模板兜底（与 `board-screen.ts` 的 `state.facilityLevel[e.index] ?? f.level`
      //   同一口径）。⚠️ 这是画出研究所第三行的**前提**：設施种类是开局后盖出来的，
      //   地图模板里 `type` 恒为 0、`level` 恒为 0，照模板读永远落在「空  地」那支。
      const owner = state.facilityOwner[inst.id] ?? f.owner;
      if (owner !== 0) add(tipPlayerName(state, owner - 1), 0);
      const level = state.facilityLevel[inst.id] ?? f.level;
      if (level === 0) {
        add('空  地', TIP_LINE);
        return out;
      }
      const type = state.facilityType[inst.id] ?? f.type;
      if (type > 4) return out;
      const name = FACILITY_TYPE_NAMES[type] ?? '';
      if (type === 0) {
        add(name, TIP_LINE);
      } else if (type === 1 || type === 2) {
        add(name, TIP_LINE_TIGHT);
        add(LEVEL_NAMES[level] ?? '', TIP_LINE_TIGHT * 2);
        add(`×${tipNumber((f.rateByLevel[level] ?? 0) * state.priceIndex)}`, TIP_LINE_TIGHT * 3);
      } else if (type === 3) {
        add(name, TIP_LINE);
        add(`×${tipNumber(1000)}`, TIP_LINE * 2);
      } else {
        add(name, TIP_LINE_TIGHT);
        add(LEVEL_NAMES[level] ?? '', TIP_LINE_TIGHT * 2);
        // ★ 研究所第三行「開發出来的東西」—— 只有 `+0x1e`（还有几天）非 0 才画：
        //   ```asm
        //   00417ac2  cmp byte [edi + 0x1e], 0
        //   00417ac6  je  0x417bfe                 ; 没在研发 → 只两行
        //   00417ace  add ebx, 0x12                ; 第三行
        //   00417ad5  mov al, byte [edi + 0x1d]    ; 项目下标
        //   00417ad8  mov ebx, dword [eax*8 + 0x47ff1a]   ; ★ 名字表（步长 8）
        //   00417adf  jmp 0x4179d9                 ; 当普通字符串画（没有格式串）
        //   ```
        //   ⚠️ 原版**不检查下标范围**（表只有 6 项 0..5），越界会读表外；本引擎给空串。
        const days = state.facilityResearchDays[inst.id] ?? f.researchDays ?? 0;
        if (days !== 0) {
          const project = state.facilityResearchProject[inst.id] ?? f.researchProject ?? 0;
          add(FACILITY_DEV_NAMES[project] ?? '', TIP_LINE_TIGHT * 3);
        }
      }
      return out;
    }

    // ── 玩家棋子 / 附身神明（`0x8000 | …`）@source VA 0x00417b7e ──
    case 'player': {
      if (inst.index >= 4) {
        add(INMATE_NAMES[inst.index - 4] ?? '', TIP_TOKEN_DY);
        return out;
      }
      add(tipPlayerName(state, inst.index), TIP_TOKEN_DY);
      return out;
    }
    case 'object': {
      const o = state.objects[inst.index - 1];
      if (o === undefined) return [];
      add(OBJECT_NAMES[o.type] ?? '', TIP_TOKEN_DY);
      return out;
    }
  }
}

/** 同名（且非連鎖）地块的过路费之和 @source VA 0x00419744 */
function sameNameRent(map: Rich4Map, state: GameState, owner: number, name: string): number {
  let sum = 0;
  for (const l of map.lands) {
    if (l.type !== 0 || l.name !== name) continue;
    if ((state.landOwner[l.id] ?? 0) !== owner) continue;
    const level = state.landLevel[l.id] ?? 0;
    sum += l.rentByLevel[level] ?? 0;
  }
  return sum;
}

// ============================================================
//  落点
// ============================================================

export interface TipPlacement {
  /** 第几张名板图（= 原版的 `ebp`）*/
  image: number;
  /** 那一张的锚点 */
  anchor: { x: number; y: number };
  /** 光标（棋盘局部坐标，y 已减掉工具栏 40）*/
  cursor: { x: number; y: number };
  /** 框在棋盘局部坐标里的矩形（= 光标 − 锚点）*/
  box: { x: number; y: number; w: number; h: number };
  /** 文字横坐标（居中画）*/
  textX: number;
  /** 文字基准纵坐标（行偏移从它算）*/
  textBaseY: number;
}

/**
 * 名板落点 —— **纯函数**，`x/y` 是**棋盘局部坐标**（= 舞台坐标 − (0, 40)）。
 *
 * @source `fcn_00417559` 的 VA 0x004175dd..0x0041771e：先在「往上还是往下」
 *   和「往左还是往右」之间二选一得到 `ebp`，再取第 `ebp` 张图；文字基准
 *   `x ± (189/2+9)`、`y + {0x2a | −0x60}`。
 */
export function tipPlacement(x: number, y: number): TipPlacement {
  const upBit = y >= TIP_FRAME_H ? 1 : 0; // bit0 = 1 → 框往上放（锚点在下边）
  const leftBit = x > TIP_BOARD_WIDTH - TIP_FRAME_W ? 2 : 0; // bit1 = 1 → 框往左放
  const image = upBit + leftBit;
  const anchor = TIP_ANCHORS[image] ?? { x: 0, y: 0 };
  const up = (image & 1) !== 0;
  const toLeft = (image & 2) !== 0;
  return {
    image,
    anchor,
    cursor: { x, y },
    box: {
      x: toLeft ? x - TIP_FRAME_W : x,
      // 原版存的是**局部** y、贴的时候 +0x28；这里统一用局部坐标
      y: up ? y - TIP_FRAME_H : y,
      w: TIP_FRAME_W,
      h: TIP_FRAME_H,
    },
    textX: toLeft ? x - TIP_TEXT_DX : x + TIP_TEXT_DX,
    textBaseY: y + (up ? TIP_TEXT_UP : TIP_TEXT_DOWN),
  };
}

/** 一帧要画的东西：框 + 文本行 */
export interface TipModel extends TipPlacement {
  lines: readonly TipLine[];
}

/**
 * 光标（棋盘局部坐标）底下那个实例的名牌。
 *
 * @param toScreen 世界坐标 → **棋盘局部**屏幕坐标（`render.ts` 的 `worldToScreen`）
 * @returns 命中就返回模型，没命中（或节点名字为空）返回 `null` —— 原版此时
 *   在 `loc_00417c5f` 直接返回，连声音都不放。
 */
export function tipModel(
  map: Rich4Map,
  state: GameState,
  x: number,
  y: number,
  toScreen: (wx: number, wy: number) => { x: number; y: number } | null,
): TipModel | null {
  const inst = hitTipInstance(tipCandidates(map, state), x, y, toScreen);
  if (inst === null) return null;
  const lines = tipLines(map, state, inst);
  // 节点的空名字在原版就过不了（VA 0x004175b9）；其它类即使空串也照弹
  if (inst.kind === 'node' && lines.length === 0) return null;
  return { ...tipPlacement(x, y), lines };
}

// ============================================================
//  画（只做 IO）
// ============================================================

/** 一张能画的名板图 —— 只要 `SpriteCache` 给得出的形状 */
export interface TipSprite {
  bitmap: CanvasImageSource;
  width: number;
  height: number;
}

/** 把一帧名牌画到棋盘画布上（调用方负责在棋盘画完之后调）*/
export function drawTip(
  ctx: CanvasRenderingContext2D,
  sprite: TipSprite | null,
  model: TipModel,
): void {
  const bx = model.cursor.x - model.anchor.x;
  const by = model.cursor.y - model.anchor.y;
  if (sprite !== null) {
    ctx.drawImage(sprite.bitmap, bx, by);
  } else {
    // 图还没解出来：先垫一块同色的底，免得整帧看不见（下一帧会补上真图）
    ctx.fillStyle = '#1f5fa8';
    ctx.fillRect(model.box.x, model.box.y, model.box.w, model.box.h);
  }
  ctx.font = `${TIP_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = TIP_STROKE;
  ctx.fillStyle = TIP_FILL;
  for (const l of model.lines) {
    if (l.text === '') continue;
    const ty = model.textBaseY + l.dy;
    ctx.strokeText(l.text, model.textX, ty);
    ctx.fillText(l.text, model.textX, ty);
  }
}
