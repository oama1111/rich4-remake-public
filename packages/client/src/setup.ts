/*
 * 開局設定 —— 選角色、選地圖、六條設定
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 本屏**逐条照 `rich4_new_game.asm` 重做**，摆位全部来自汇编里的表，
 * 不是照截图猜的。三块各有出处：
 *
 * 1. **右侧竖栏**（192×461 @ (445,10)）= `jump.mkf` 资源 8 的**整图**，
 *    地图名、`OK`/`EXIT`、六条数值框、蓝三角全都**烧在图里**；
 *    代码只往上面补**六条标签与数值**、被选中地图行那个**红勾**、
 *    以及按下时的按钮／三角按下图。@source `_rich4_draw_game_config_menu`
 *    VA 0x00404504、`VA 0x00406ff6`（`图号 = 舞台×20 + 1`）。
 * 2. **角色格**（440×155 @ (4,10)）= 资源 8 图 0（蓝黄交替的 12 格底图）
 *    ＋ `Data.mkf` 资源 2 的 12 张 72×72 头像。@source `fcn_0040423c`。
 * 3. **整屏背景** = `jump.mkf` 资源 `globalMapId`（舞台×4 + 地图）的
 *    640×480 场景，**横向循环滚动**（每 100ms 移 2px，绕回）。
 *    @source `fcn_00456180`（逐行循环移位）、`VA 0x00404feb` 的定时器。
 *
 * ── 十三条控件 ────────────────────────────────────────
 * 点击命中表 @ 0x46cc18（8 字节一条：左、上、右、下）：
 *
 * | # | 区域 | 行为 |
 * |---|---|---|
 * | 0 | 角色格 (8,15,440,159) | **按下**即选／取消 |
 * | 1 | `OK` (456,176,535,215) | 按下贴按下图，**抬手**才成立 |
 * | 2 | `EXIT` (544,176,623,215) | 同上 |
 * | 3..8 | 六条下拉的蓝三角 (602,226+36i,625,250+36i) | 抬手弹开浮窗 |
 * | 9..12 | 四行地图 (457,31+32i,625,62+32i) | **按下**即换图，并在那一行的勾选框里画红勾 |
 *
 * ── 六条下拉 ─────────────────────────────────────────
 * 浮窗命中表 @ 0x46cc88，浮窗底图 @ 0x46ccb8 = `[5,6,5,6,6,7]`，
 * 行高 0x17 = 23，选中行填 0xaa0000。第 4~6 条**向上弹**（表里就是向上的矩形）。
 *
 * ── 点 `OK` 之后 ─────────────────────────────────────
 * 已点的座位算**真人**，剩下的座位由定时器随机挑角色补成**電腦**
 * （`_rich4_select_nth_player` 之后 `or byte [seat+3], 0x80` 就是「電腦」这一位），
 * 补满才真的开局。@source `VA 0x00405d0d` 起。
 */

import type { Sprite } from './assets.ts';
import {
  SETUP_PORTRAIT_RESOURCE,
  SETUP_UI,
  SETUP_UI_RESOURCE,
  setupPanelImage,
  setupWalkFrames,
  setupWalkResource,
} from './assets.ts';
import { FONT_FAMILY } from './font.ts';

/** 画面尺寸 —— 与原版一致 */
const SCREEN_W = 640;
const SCREEN_H = 480;

/** 原版最多四人 */
export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 2;

/** 两个舞台 × 四张地图 */
export const MAP_COUNT = 8;

/** 角色张数 */
export const CHARACTER_COUNT = 12;

// ── 摆位（全部来自汇编表，勿手改）──────────────────────

/** 角色格那一块：表面 440×155，画在屏幕 (4,10) @source VA 0x00404eb0 的 `fcn_00451a5a(0x1b8, 0x9b)` */
export const BOARD = { w: 440, h: 155, x: 4, y: 10 } as const;
/** 右侧竖栏：192×461 @ (445,10) @source 同上 `fcn_00451a5a(0xc0, 0x1cd)`、VA 0x00405d8f 贴图 */
export const PANEL = { w: 192, h: 461, x: 0x1bd, y: 0x0a } as const;

/** 头像 72×72，格距 72（表面内原点 = 列×72+4、行×72+5）@source `fcn_0040423c` */
export const PORTRAIT = 72;
export const GRID = { cols: 6, dx: 4, dy: 5 } as const;

/**
 * 十三条控件 @ 0x46cc18。
 *
 * ★ 命中用的是**屏幕坐标**；画竖栏里的东西时要减掉 `PANEL.x/y`。
 */
export const CONTROL_RECTS: readonly { x: number; y: number; w: number; h: number }[] = [
  { x: 8, y: 15, w: 432, h: 144 }, // 0 角色格
  { x: 456, y: 176, w: 79, h: 39 }, // 1 OK
  { x: 544, y: 176, w: 79, h: 39 }, // 2 EXIT
  { x: 602, y: 226, w: 23, h: 24 }, // 3 遊戲人數
  { x: 602, y: 262, w: 23, h: 24 }, // 4 總資金
  { x: 602, y: 298, w: 23, h: 24 }, // 5 行進方式
  { x: 602, y: 334, w: 23, h: 24 }, // 6 土地權限
  { x: 602, y: 370, w: 23, h: 24 }, // 7 遊戲時間
  { x: 602, y: 406, w: 23, h: 24 }, // 8 勝利條件
  { x: 457, y: 31, w: 168, h: 31 }, // 9 地圖 0
  { x: 457, y: 63, w: 168, h: 31 }, // 10 地圖 1
  { x: 457, y: 95, w: 168, h: 31 }, // 11 地圖 2
  { x: 457, y: 127, w: 168, h: 31 }, // 12 地圖 3
];

/** 六条下拉浮窗的命中矩形 @ 0x46cc88（左、上、右、下） */
export const POPUP_RECTS: readonly { x: number; y: number; r: number; b: number }[] = [
  { x: 561, y: 251, r: 602, b: 320 },
  { x: 536, y: 287, r: 602, b: 425 },
  { x: 561, y: 323, r: 602, b: 392 },
  { x: 536, y: 195, r: 602, b: 333 },
  { x: 536, y: 231, r: 602, b: 369 },
  { x: 516, y: 267, r: 602, b: 405 },
];

/** 每条下拉的浮窗底图（资源 8 里的图号）@ 0x46ccb8 */
export const POPUP_IMAGES: readonly number[] = [
  SETUP_UI.popup3,
  SETUP_UI.popup6,
  SETUP_UI.popup3,
  SETUP_UI.popup6,
  SETUP_UI.popup6,
  SETUP_UI.popup6w,
];

/** 浮窗行高 @source `VA 0x0040524a` 的 `mov ebx, 0x17` */
export const POPUP_ROW_H = 0x17;

/** 六条下拉的标题与数值锚点（竖栏内坐标）@source `_rich4_draw_game_config_menu` */
export const CONFIG_LABEL_X = 8;
export const CONFIG_VALUE_X = 0x9b;
export const CONFIG_ROW_Y: readonly number[] = [0xe4, 0x108, 0x12c, 0x150, 0x174, 0x198];
export const CONFIG_FONT = 0xf;
export const LABEL_COLOR = '#ffffff';
export const VALUE_COLOR = '#101010';

/** 地图行上那个红勾的纵向锚点 @ 0x46cc80 —— **竖栏内**坐标（第 i 行 = 行上沿 − 1） */
export const TICK_Y: readonly number[] = [20, 52, 84, 116];
/** 红勾画在竖栏内的横向锚点 @source `VA 0x00405608` 的 `push 0x96`（= 勾选框左沿） */
export const TICK_X = 0x96;

/**
 * 座位（底部走动小人）的横向落点 @ 0x46cb58。
 * 下标 = 人数 − 2，每档 4 个；`y` 固定 0x1b8 = 440。
 * ★ 第一个点中的角色落在**最右**（座位 0 = 表里的第一项）。
 */
export const SEAT_X: readonly (readonly number[])[] = [
  [330, 110, 0, 0],
  [366, 220, 74, 0],
  [385, 275, 165, 55],
];
export const SEAT_Y = 0x1b8;

/** 角色名 —— 原版字符串里那些全角空格是**排版用的**，照抄 @ 0x47e80c 起 12 条 */
export const SETUP_NAMES: readonly string[] = [
  '約 翰 喬',
  '沙隆巴斯',
  '忍 太 郎',
  '錢 夫 人',
  '阿 土 伯',
  '莎拉公主',
  '宮本寶藏',
  '糖  糖',
  '烏  咪',
  '孫 小 美',
  '小 丹 尼',
  '金 貝 貝',
];

/** 姓名牌：70×20，摆在两行头像之间的那条带子上 @source `fcn_0040423c` 的 `0x46 / 0x14` */
export const PLATE = { w: 0x46, h: 0x14, dx: 5 } as const;
/** 姓名牌底色 = 底图乘 0x485ae8 那张表（5 位分量 31→11，约 0.355） */
export const PLATE_MULTIPLY = 11 / 31;
/** 「已被别人选走」的头像乘 0x485b68 那张表（31→15，正好一半） */
export const TAKEN_MULTIPLY = 15 / 31;

/** 六条下拉的可选值 —— 全部照抄原版表 */
export const PLAYER_COUNT_LABELS: readonly string[] = ['二人', '三人', '四人']; // 0x46cb88
export const MONEY_VALUES: readonly number[] = [300_000, 200_000, 100_000, 50_000, 30_000, 10_000]; // 0x46cb94
export const VEHICLE_LABELS: readonly string[] = ['步行', '機車', '汽車']; // 0x46cbac
export const TENURE_LABELS: readonly string[] = ['無限期', '二年', '一年', '六個月', '三個月', '一個月']; // 0x46cbb8 / 0x46cbd0
export const VICTORY_FACTORS: readonly number[] = [0, 100, 50, 10, 5, 3]; // 0x46cc00，0 = 無限

/** 一条下拉的可选项（按菜单号） */
export function menuItems(s: SetupState, menu: number): string[] {
  switch (menu) {
    case 0:
      return [...PLAYER_COUNT_LABELS];
    case 1:
      return MONEY_VALUES.map((v) => String(v));
    case 2:
      return [...VEHICLE_LABELS];
    case 3:
    case 4:
      return [...TENURE_LABELS];
    default:
      return VICTORY_FACTORS.map((f) => (f === 0 ? '無限' : String(MONEY_VALUES[s.money]! * f)));
  }
}

/** 当前值在表里的下标（菜单号 → 状态字段） */
export function menuValue(s: SetupState, menu: number): number {
  return [s.playerCount - MIN_PLAYERS, s.money, s.vehicle, s.land, s.time, s.victory][menu] ?? 0;
}

// ── 状态 ──────────────────────────────────────────────

export interface SetupState {
  /** 2..4 @source `[0x46cb3c] + 2` */
  playerCount: number;
  /** 座位 → 角色编号，长度 = playerCount，按**点中的先后**排 */
  characters: number[];
  /** 座位 → 是不是真人（点中 = 真人；开局时补进来的 = 電腦） */
  human: boolean[];
  /** 地图 `舞台×4 + 地图`，0..7 @source `[0x46cb54] + [0x4991b6]` */
  mapId: number;
  /** 行進方式 0..2 @source `[0x46cb44]` */
  vehicle: number;
  /** 總資金档 0..5 @source `[0x46cb40]` */
  money: number;
  /** 土地權限档 0..5 @source `[0x46cb48]` */
  land: number;
  /** 遊戲時間档 0..5 @source `[0x46cb4c]` */
  time: number;
  /** 勝利條件档 0..5 @source `[0x46cb50]` */
  victory: number;
  /** 鼠标底下的角色格，−1 = 没有 @source `[0x48a410]` */
  hover: number;
  /** 按下未抬手的控件号，−1 = 没有 @source `[0x48a40e]` */
  pressed: number;
  /** 弹开着哪条下拉，−1 = 没有 @source `[0x48a40f]` */
  openMenu: number;
  /** 下拉里鼠标底下的那一行，−1 = 没有 @source `[0x48a40c]` */
  hoverItem: number;
}

/**
 * 原版开局默认：四人、走路、20 万、無限期、無限 @source `loc_00406ff6` 的初值
 *
 * @param stage **舞台**：0 = 台灣/中國/日本/U.S.A，1 = 星際/古代/恐龍/海島。
 *
 * ★ 这一屏的舞台**不是玩家在屏上选的**，是**从標題那两颗钮带进来的**：
 *   進來的入口先把 `[0x4991b6] = 舞台`、`[0x4991b8] = 地图`，然后
 *   `loc_00406ff6` 里 `[0x46cb54] = [0x4991b8]`、竖栏整图取 `舞台×20 + 1`。
 *   即 `mapId = 舞台×4 + 地图`（`[0x46cb54]` 就是「地图」那半截）。
 *
 * @source 標題的分派表 `ref_00401b78`：按钮 0（START）→ `init_new_game`，
 *   按钮 4（**NEW STAGE**）→ **先 `[0x4991b6] = 1` 再走同一条 init_new_game**
 *   （`loc_00401cbf` 只多一句 `mov word [0x4991b6], 1` 就落到 `loc_00401cc8`）。
 *   所以「NEW STAGE」= 新開一局、但用第二个舞台的四张新地图。
 */
export function defaultSetup(stage = 0): SetupState {
  return {
    playerCount: 4,
    characters: [],
    human: [],
    // 舞台×4 + 地图；地图那半截从 0 起（原版 `[0x46cb54] = [0x4991b8]`，標題进来时是 0）
    mapId: (stage & 1) * 4,
    vehicle: 0,
    money: 1,
    land: 0,
    time: 0,
    victory: 0,
    hover: -1,
    pressed: -1,
    openMenu: -1,
    hoverItem: -1,
  };
}

export type SetupHit =
  | { kind: 'character'; index: number }
  | { kind: 'map'; index: number }
  | { kind: 'config'; menu: number }
  | { kind: 'popupItem'; menu: number; item: number }
  | { kind: 'ok' }
  | { kind: 'exit' };

const inRect = (
  x: number,
  y: number,
  r: { x: number; y: number; w: number; h: number },
): boolean => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/** 某人底下是哪个角色格（不在格子里返回 −1）@source `VA 0x0040519c` 的 `(y-15)/72*6 + (x-8)/72` */
export function characterAt(x: number, y: number): number {
  const r = CONTROL_RECTS[0]!;
  if (!inRect(x, y, r)) return -1;
  const row = Math.floor((y - r.y) / PORTRAIT);
  const col = Math.floor((x - r.x) / PORTRAIT);
  const index = row * GRID.cols + col;
  return index >= 0 && index < CHARACTER_COUNT ? index : -1;
}

/** 弹开的下拉里，鼠标在第几行（不在浮窗里返回 −1）@source `VA 0x0040525f` */
export function popupItemAt(menu: number, x: number, y: number): number {
  const r = POPUP_RECTS[menu];
  if (r === undefined) return -1;
  if (x < r.x || x >= r.r || y < r.y || y >= r.b) return -1;
  const item = Math.floor((y - r.y) / POPUP_ROW_H);
  return item;
}

/** 十三条控件里，某点落在哪一条（都不落返回 −1）@source `VA 0x004052f6` */
export function controlAt(x: number, y: number): number {
  for (let i = 0; i < CONTROL_RECTS.length; i++) {
    if (inRect(x, y, CONTROL_RECTS[i]!)) return i;
  }
  return -1;
}

export function hitSetup(x: number, y: number, s: SetupState): SetupHit | null {
  // 下拉弹开着的时候，整块浮窗优先吃掉点击（原版也是先看 `[0x48a40f]`）
  if (s.openMenu >= 0) {
    const item = popupItemAt(s.openMenu, x, y);
    if (item >= 0) return { kind: 'popupItem', menu: s.openMenu, item };
  }
  const c = controlAt(x, y);
  if (c < 0) return null;
  if (c === 0) return { kind: 'character', index: characterAt(x, y) };
  if (c === 1) return { kind: 'ok' };
  if (c === 2) return { kind: 'exit' };
  if (c <= 8) return { kind: 'config', menu: c - 3 };
  return { kind: 'map', index: c - 9 };
}

// ── 动作 ──────────────────────────────────────────────

/** 按角色编号找座位，找不到返回 −1 */
export function seatOf(s: SetupState, character: number): number {
  return s.characters.indexOf(character);
}

function withoutSeat(s: SetupState, seat: number): SetupState {
  const characters = s.characters.filter((_, i) => i !== seat);
  const human = s.human.filter((_, i) => i !== seat);
  return { ...s, characters, human };
}

/**
 * 按下。
 *
 * ★ 角色格与地图行是**按下即生效**（原版 0x201 那条分支）；
 *   两颗按钮与六条下拉只**记下按下状态**（贴按下图 / 抬手才弹浮窗）。
 * @source `VA 0x00405339`（角色）、`VA 0x004055b9`（地图）、`VA 0x004053d9`／`0x004054d8`（按钮与下拉）
 */
export function setupDown(s: SetupState, x: number, y: number): SetupState {
  // 浮窗开着：点哪儿都先把它收掉，点到行上才算选中
  if (s.openMenu >= 0) {
    const item = popupItemAt(s.openMenu, x, y);
    const menu = s.openMenu;
    let next: SetupState = { ...s, openMenu: -1, hoverItem: -1, pressed: -1 };
    if (item < 0) return next;
    if (item >= menuItems(next, menu).length) return next;
    if (item === menuValue(next, menu)) return next;
    switch (menu) {
      case 0: {
        next = { ...next, playerCount: item + MIN_PLAYERS };
        // 人数调小：多出来的座位要连同角色一起退掉 @source `loc_004056a6`
        while (next.characters.length > next.playerCount) {
          next = withoutSeat(next, next.characters.length - 1);
        }
        break;
      }
      case 1:
        next = { ...next, money: item };
        break;
      case 2:
        next = { ...next, vehicle: item };
        break;
      case 3:
        next = { ...next, land: item };
        break;
      case 4:
        next = { ...next, time: item };
        break;
      default:
        next = { ...next, victory: item };
        break;
    }
    return next;
  }

  const hit = hitSetup(x, y, s);
  if (hit === null) return s;
  switch (hit.kind) {
    case 'character': {
      if (hit.index < 0) return s;
      const seated = seatOf(s, hit.index);
      if (seated >= 0) {
        // 再点一次 = 取消这个座位（后面的座位往前挪）@source `loc_0040539e`
        return withoutSeat(s, seated);
      }
      if (s.characters.length >= s.playerCount) return s;
      return {
        ...s,
        characters: [...s.characters, hit.index],
        human: [...s.human, true],
        hover: -1,
      };
    }
    case 'map':
      return { ...s, mapId: (s.mapId & ~3) | hit.index };
    case 'ok':
    case 'exit':
    case 'config':
      return { ...s, pressed: hit.kind === 'ok' ? 1 : hit.kind === 'exit' ? 2 : hit.menu + 3 };
    default:
      return s;
  }
}

/**
 * 抬手。
 *
 * ★ 两颗按钮与下拉**只认按下那一刻记下的控件号**，不再看光标在哪（原版照抄）。
 * @source `VA 0x00405745` 那条分支
 */
export function setupUp(s: SetupState): SetupState {
  const pressed = s.pressed;
  if (pressed < 0) return s;
  const next: SetupState = { ...s, pressed: -1 };
  // `OK` 与 `EXIT` 都只是把按下状态清掉 —— 真的开局／退出由调用方决定
  //（`OK` 之前还要 `fillComputerSeats` 把空座位补成電腦）
  if (pressed <= 2) return next;
  // 六条下拉：抬手才弹开 @source `loc_00405a49`
  return { ...next, openMenu: pressed - 3, hoverItem: -1 };
}

/**
 * 鼠标移动。
 *
 * ★ 只有三件事会重画：角色格的悬停格变了、下拉里悬停行变了、
 *   或者要从「有悬停」退回「没悬停」。
 * @source `VA 0x00405163`
 */
export function setupMove(s: SetupState, x: number, y: number): SetupState {
  const hover = characterAt(x, y);
  let next = s;
  if (hover !== s.hover) next = { ...next, hover };

  if (next.openMenu >= 0) {
    const raw = popupItemAt(next.openMenu, x, y);
    const item = raw >= 0 && raw < menuItems(next, next.openMenu).length ? raw : -1;
    if (item !== next.hoverItem) next = { ...next, hoverItem: item };
  } else if (next.hoverItem >= 0) {
    next = { ...next, hoverItem: -1 };
  }
  return next;
}

/**
 * 点 `OK` 之后，把还空着的座位随机补成電腦。
 *
 * ★ 「電腦」这一位就是座位记录的最高位 —— 原版 `or byte [座位+3], 0x80`
 *   （座位记录的第一个 dword 低字节是角色号，最高字节的最高位就是电脑位，
 *   开局时 `sar eax, 31` 取出它来决定发钱：真人全额、電腦一半）。
 * @source `VA 0x00405d0d`
 */
export function fillComputerSeats(s: SetupState, rand: () => number): SetupState {
  const characters = [...s.characters];
  const human = s.human.map((h, i) => (i < s.characters.length ? h : false));
  const free: number[] = [];
  for (let i = 0; i < CHARACTER_COUNT; i++) if (!characters.includes(i)) free.push(i);
  while (characters.length < s.playerCount && free.length > 0) {
    const pick = Math.min(free.length - 1, Math.floor(rand() * free.length));
    const [ch] = free.splice(pick, 1);
    characters.push(ch!);
    human.push(false);
  }
  return { ...s, characters, human };
}

// ── 绘制 ──────────────────────────────────────────────

/**
 * 取图：`(资源号, 图号, 黑色是否抠透明) => Sprite | null`，资源一律在 `jump.mkf`／`Data.mkf`。
 *
 * ★ 原版两个贴图函数是有区别的，这一位不能省：
 *   · `fcn_00456280` = `draw_image_in_rect` —— **原样拷**，黑就是黑；
 *   · `fcn_004562a5` = `draw_non_zero_image_in_rect` —— **跳过值为 0 的像素**，
 *     也就是把黑当透明。红勾（图 8）走的是后者，所以它得抠黑；
 *     底图／竖栏／头像／按钮／浮窗底图走的都是前者，**不抠**。
 */
type Need = (
  archive: 'Data.mkf' | 'jump.mkf',
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 原地不动地画一张图（原版是以图自己的锚点对齐的 `graph_st`） */
function sprite(ctx: CanvasRenderingContext2D, s: Sprite | null, x: number, y: number): void {
  if (s === null) return;
  ctx.drawImage(s.bitmap, Math.round(x - s.anchorX), Math.round(y - s.anchorY));
}

/** 逐分量乘一个系数（原版的「调色表换算」就是干这个） */
function multiply(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  f: number,
): void {
  const v = Math.round(255 * f);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgb(${v}, ${v}, ${v})`;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.restore();
}

const FONT = FONT_FAMILY;

/**
 * 写一行字。
 *
 * @source 原版的 `create_font(字号, 前景, 背景/描边, 字重位, ?)`：
 * `[0x4762d8] & 2` 决定字形高度取 700（粗）还是 400（常规）。
 * 本屏这四种字的字重都不一样，别一律当粗体：
 * 六条**标签**粗体白字描黑（flags 3）、**数值**常规黑字（flags 2）、
 * 姓名牌粗体、下拉行常规。
 */
const text = (
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  size: number,
  align: CanvasTextAlign,
  color: string,
  outline: string | null = null,
  bold = false,
): void => {
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (outline !== null) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = outline;
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
};

/** 一屏的动画相位 —— 原版的定时器是 100ms 一跳，每跳把场景左移 2px、把小人推进一帧 */
export function setupPhase(now: number): { tick: number; scroll: number } {
  const tick = Math.floor(now / 100);
  return { tick, scroll: (tick * 2) % SCREEN_W };
}

export function drawSetup(
  ctx: CanvasRenderingContext2D,
  s: SetupState,
  need: Need,
  now: number,
  scene: ImageBitmap | null,
): void {
  const { tick, scroll } = setupPhase(now);

  // ① 整屏场景：横向循环滚动。原版是逐行**循环移位**（`fcn_00456180`），
  //    等价于把同一张图贴两遍、一起左移。
  if (scene !== null) {
    ctx.drawImage(scene, -scroll, 0);
    ctx.drawImage(scene, SCREEN_W - scroll, 0);
  } else {
    ctx.fillStyle = '#123049';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  }

  // ② 底部往前走的四个人
  drawWalkers(ctx, s, need, tick);

  drawBoard(ctx, s, need);
  drawPanel(ctx, s, need);
}

function drawWalkers(ctx: CanvasRenderingContext2D, s: SetupState, need: Need, tick: number): void {
  for (let seat = 0; seat < s.characters.length && seat < s.playerCount; seat++) {
    const character = s.characters[seat]!;
    const resource = setupWalkResource(character, s.vehicle);
    // ★ 原版每跳把帧号 +1 绕回（`mov eax,[座位+8]` 的图数取自资源头），
    //   所以第 i 跳就是第 i 帧，各人的图数不同、各自取模。
    const frames = setupWalkFrames(character, s.vehicle);
    const frame = tick % frames;
    // ★ 本仓库的图是**异步解**的，而走子每 100ms 换一帧 ——
    //   换到的那一帧还没解出来时若直接 `continue`，人物就会**闪一下**，
    //   这正是需求方 2026-09-15 报的「选完人物后闪烁一会儿才正常」。
    //   对策：这一帧没有就退回**同组里已经解出来的**那一帧顶着；
    //   顺便把整组都 `need` 一遍，等于顺手预热（`spriteNow` 会去重请求）。
    let img = need('jump.mkf', resource, frame);
    if (img === null) {
      for (let k = 0; k < frames; k++) {
        const alt = need('jump.mkf', resource, k);
        if (alt !== null) {
          img = alt;
          break;
        }
      }
    }
    if (img === null) continue;
    const x = SEAT_X[s.playerCount - MIN_PLAYERS]?.[seat] ?? 0;
    sprite(ctx, img, x, SEAT_Y);
  }
}

function drawBoard(ctx: CanvasRenderingContext2D, s: SetupState, need: Need): void {
  const board = need('jump.mkf', SETUP_UI_RESOURCE, SETUP_UI.board);
  if (board !== null) ctx.drawImage(board.bitmap, BOARD.x, BOARD.y);

  for (let i = 0; i < CHARACTER_COUNT; i++) {
    const col = i % GRID.cols;
    const row = Math.floor(i / GRID.cols);
    const x = BOARD.x + col * PORTRAIT + GRID.dx;
    const y = BOARD.y + row * PORTRAIT + GRID.dy;
    const seated = seatOf(s, i);

    // ★ 鼠标压着的那一格**把头像抹掉**、只留底图那个金边空格
    //   （原版 `loc_00404266`：`cmp ebx, 悬停号 / je` 直接跳过画头像）
    if (seated < 0 && i === s.hover) continue;
    const portrait = need('Data.mkf', SETUP_PORTRAIT_RESOURCE, i);
    if (portrait === null) continue;
    // 头像的锚点是 (0,0)，按左上角贴
    ctx.drawImage(portrait.bitmap, x, y);
    // 已被选走的压暗一半（原版查 0x485b68 那张表，正好是 ×0.5）
    if (seated >= 0) multiply(ctx, { x, y, w: PORTRAIT, h: PORTRAIT }, TAKEN_MULTIPLY);
  }

  if (s.hover < 0 || seatOf(s, s.hover) >= 0) return;
  const col = s.hover % GRID.cols;
  const row = Math.floor(s.hover / GRID.cols);
  const px = BOARD.x + col * PORTRAIT + PLATE.dx;
  // 第 0 行往下挪、第 1 行往上挪 —— 两块牌子都落在两行头像中间那条带子上
  const py = BOARD.y + row * PORTRAIT + GRID.dy + (row === 0 ? 0x44 : -0x18);
  multiply(ctx, { x: px, y: py, w: PLATE.w, h: PLATE.h }, PLATE_MULTIPLY);
  text(
    ctx,
    SETUP_NAMES[s.hover] ?? '',
    px + PLATE.w / 2,
    py + PLATE.h / 2,
    0x10,
    'center',
    '#f0f0f0',
    '#101010',
    true,
  );
}

function drawPanel(ctx: CanvasRenderingContext2D, s: SetupState, need: Need): void {
  const stage = s.mapId >> 2;
  const mapInStage = s.mapId & 3;
  const panel = need('jump.mkf', SETUP_UI_RESOURCE, setupPanelImage(stage));
  if (panel !== null) ctx.drawImage(panel.bitmap, PANEL.x, PANEL.y);

  // ① 地图行上的红勾。★ 画进竖栏缓冲、锚点 (0,0)：
  //    竖栏内 (150, 20/52/84/116) —— 后者正是 0x46cc80 那张表，也就是各行上沿。
  //    竖栏缓冲贴到屏幕 (445,10)，所以屏幕坐标要**加上竖栏原点**。
  const mark = need('jump.mkf', SETUP_UI_RESOURCE, SETUP_UI.tick, true);
  if (mark !== null) {
    ctx.drawImage(
      mark.bitmap,
      PANEL.x + TICK_X - mark.anchorX,
      PANEL.y + TICK_Y[mapInStage]! - mark.anchorY,
    );
  }

  // ② 六条：左标签（描边白字）+ 右值（黑字、右对齐、垂直居中）
  for (let menu = 0; menu < 6; menu++) {
    const y = PANEL.y + CONFIG_ROW_Y[menu]!;
    text(ctx, CONFIG_TITLES[menu]!, PANEL.x + CONFIG_LABEL_X, y, CONFIG_FONT, 'left', LABEL_COLOR, '#101010', true);
    text(ctx, menuItems(s, menu)[menuValue(s, menu)] ?? '', PANEL.x + CONFIG_VALUE_X, y, CONFIG_FONT, 'right', VALUE_COLOR);
  }

  // ③ 按下不放：两颗按钮换按下图，六条下拉的蓝三角换成黄三角
  //    @source `VA 0x004053d9`（按钮）、`VA 0x004054b5`（三角）
  let downImg = -1;
  if (s.pressed === 1) downImg = SETUP_UI.okDown;
  else if (s.pressed === 2) downImg = SETUP_UI.exitDown;
  else if (s.pressed >= 3) downImg = SETUP_UI.arrowDown;
  if (downImg >= 0) {
    const rect = CONTROL_RECTS[s.pressed]!;
    const down = need('jump.mkf', SETUP_UI_RESOURCE, downImg);
    if (down !== null) ctx.drawImage(down.bitmap, rect.x, rect.y);
  }

  // ④ 弹开的下拉
  if (s.openMenu >= 0) drawPopup(ctx, s, need);
}

/**
 * 弹开的下拉。
 *
 * 全部按屏幕坐标摆 —— 浮窗底图贴在 `(rect.x, rect.y)`，
 * 选中行填 `0xaa0000`（左上角再进 2px、高 20、右端留 3px），
 * 行文字右对齐到 `rect.r − 2`、垂直中心 `rect.y + 12 + i×23`。
 * @source `fcn_0040482c`
 */
function drawPopup(ctx: CanvasRenderingContext2D, s: SetupState, need: Need): void {
  const menu = s.openMenu;
  const rect = POPUP_RECTS[menu]!;
  const bg = need('jump.mkf', SETUP_UI_RESOURCE, POPUP_IMAGES[menu]!);
  if (bg !== null) ctx.drawImage(bg.bitmap, rect.x, rect.y);

  const items = menuItems(s, menu);
  const barW = rect.r - rect.x - 3;
  for (let i = 0; i < items.length; i++) {
    const top = rect.y + 2 + i * POPUP_ROW_H;
    const on = i === s.hoverItem;
    if (on) {
      ctx.fillStyle = '#aa0000';
      ctx.fillRect(rect.x + 2, top, barW, 20);
    }
    text(ctx, items[i]!, rect.r - 2, top + 10, CONFIG_FONT, 'right', on ? '#ffffff' : '#101010', on ? '#101010' : null);
  }
}

/** 六条下拉的标题 @ 0x463138..0x463165 */
const CONFIG_TITLES: readonly string[] = [
  '遊戲人數',
  '總 資 金',
  '行進方式',
  '土地權限',
  '遊戲時間',
  '勝利條件',
];
