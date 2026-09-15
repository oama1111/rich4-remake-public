/*
 * 魔法屋屏（外圈 12 功能悬停高亮 + 中央文字 + 音）—— T-037 / U-9 / MOD-12
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这一屏在 core 里**没有待决交互**：`runMagicHouse()`（VA 0x0043390b）两个转盘
 *   都是自己 `rand()` 转的，玩家一次也插不上手（`reduce.ts` 的 `settle` 分支）。
 *   所以本模块是**回放这次结果**的演出：`event(before, after, env)` 察觉
 *   「刚刚落了一次魔法屋」，反推出转盘落点，播完自己关。
 *
 * ## 出处（窗口过程 VA 0x004325c2；入口 `magic_house` VA 0x0043380a）
 *
 * | 是什么 | @source |
 * |---|---|
 * | 底图 = `Panel.mkf` **#18** 图 0（640×480），传 (0,0) | 0x00432511（`+0xc` = 图 0） |
 * | 女巫抬手的姿势 = 图 2，锚点落 **(317,238)** | 0x00432aec `add eax, 0x18`（18/12 = 图 2） |
 * | 女巫常态 / 眨眼 = 图 6，锚点落 **(324,238)** | 0x00432b0f `add eax, 0x48`（72/12 = 图 6） |
 * | 中央字框 = 图 1 ▶ 图 7（284×210），落 (241,140) | 0x00432511 `+0x18` / 0x00432aec |
 * | 十二个功能图标 = 图 11..34（**每个功能两张**） | 0x00432cfd `[0x48c398+0xc+(k+0x16)*12]` |
 * | 悬停的另一个框 = 图 4（60×18），落 (241,140) | 0x00432951 `+0x30` |
 *
 * ⚠️ **图 11..34 的读数有冲突**：悬停那两处都写作 `imageIndex = k + 0x16` 与
 *   `imageIndex + 1`（k 从 0 起），但资源里只有 0..34 共 35 张 —— 那意味着
 *   十二个功能只画得到 k = 0..12 里的前几个。本模块按**成对**读
 *   （第 k 个功能 = 图 `11+2k` / `12+2k`，正好吃满 11..34 共 24 张），
 *   并在 `docs/deviations/T-037.md` 记了这条近似。原版真正怎么摆位要等
 *   十二个功能的图标顺序确认后再定。
 *
 * ## 命中：原版是**逐像素的命中图**，不是算角度
 *
 * 原版把 `Panel.mkf` **#19**（307200 字节 = 640×480 每像素一字节）读进 `[0x48c394]`，
 * 鼠标一动就查（VA 0x00432b50）：
 * ```asm
 * ; edx = lParam = (y << 16) | x        ← ★ 没有减掉窗口客户区原点
 * mov edx, eax ; shl eax, 2 ; add eax, edx ; shl eax, 7 ; add eax, ecx
 * mov al, byte [ [0x48c394] + eax ]
 * ```
 * 即 `表[x + 5y]`，步长 `0x80`。表里 **1..12 = 十二个功能**、**13 = 中间的对话框区**、
 * 0 = 不认。滚一遍 #19 量出来的几何（这才是权威）：
 *
 * - 圆心 **(320, 238)**（顺时针 30° 一条的六条分界线两两求交，全部交在这一点附近）；
 * - 十二个扇区是 **以 0°/30°/…/330° 为中线的 ±15° 楔形**，外侧到 **r ≈ 241**；
 * - 中间那块（13）是 **r < 118** 的圆；118..220 一定是某个楔形；
 * - 数据里每条楔形外缘长短不一（216..241），那是原版**手绘**的掩膜，
 *   本模块用**一个外半径**近似（见 deviations）。
 *
 * 扇区号 → 功能号：`[0x4756e4 + 扇区*4]` 取的就是该扇区的**中线**坐标，
 * 而那两条 `dw` 正是 `MAGIC_HOUSE_OPTIONS` 里第 `扇区-1` 项的位置
 * （扇区 1 → (70,322) = 第 8 项「得一張卡片」…），所以**扇区号 = 功能号 + 1**。
 * 本模块按这个对应关系摆图标（`MAGIC_ICON_ANGLE`）。
 *
 * ## 音效
 *
 * 悬停与按下那一支确实播了音效（`push ref_004757e7` + `rich4_play_sound_effect`，
 * VA 0x00432e40 / 0x00433531），表 `0x4757e7` 里是 **dword 16**。但
 * `SOUND_IDS` 里没有这一条（只有 0/1/4/5/8/10/44..47/53），按卡片要求
 * **宁可不响也不乱响** —— 本模块一个音都不放，见 deviations。
 */

import { MAGIC_HOUSE_OPTIONS } from '@rich4/data';
import {
  LAND_TYPE_HOUSE,
  MAGIC_TARGET_NAMES,
  SPECIAL_KIND,
  allEffectiveFacilities,
  allEffectiveLands,
  type GameState,
  type MapTopology,
  type Player,
} from '@rich4/core';
import { FONT_FAMILY } from './font.ts';
import { tickMs } from './tick.ts';
import type { ArchiveName, Sprite } from './assets.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名） */
export type MagicSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 本屏的全部素材都在 `Panel.mkf` #18 @source 0x0043385c `push 0x12` */
export const MAGIC_RESOURCE = 18;

/**
 * 图号 —— **逐张看过** `assets-clean/Panel/0018_*.png` 之后落的表。
 *
 * | 图 | 是什么 | 用在哪 | @source |
 * |---|---|---|---|
 * | 0 | 640×480 整屏底图（五芒星 + 十二个图标 + 女巫剪影） | 铺场 | 0x00432511 |
 * | 1 | 165×213 女巫抱水晶球（抬手姿势） | 铺场 | 0x00432511 `+0x18` |
 * | 2 | 284×210 女巫抬手（含水晶球） | 常态/眨眼 | 0x00432aec `+0x24` |
 * | 3 | 60×35 长条文字框 | 开场白 | 0x00432894 起 |
 * | 4 | 60×18 长条文字框 | 提示 | 0x00432951 `+0x30` |
 * | 5 | 60×21 长条文字框 | 文本 | 0x004329ef |
 * | 6 / 7 | 142×120 锦缎框（红 / 绿） | 中央字框 | 0x00432511 起 |
 * | 8 | 280×173 长条锦缎框 | 结果条 | 0x00432a85 |
 * | 9 / 10 | 142×120 女巫头部特写（两张脸） | 眨眼 | 0x00432ad5 |
 * | 11..34 | **十二个功能的图标**（相邻两个功能**共用一张**，见下） | 悬停/结果 | 0x00432cfd |
 *
 * ★ 每个功能的图标索引是 **`功能号 + 0x16`**（`lea edx, [ecx + 0x16]`，VA 0x00432cee），
 *   即第 0 个功能在图 22、第 11 个功能在图 33 —— 相邻两个功能因此**共用**一张。
 *   原版的悬停还要再画一张 `+1`（那会索引进图 35..45，**包里没有**），
 *   本模块只画得到 22..34 这 13 张，见 deviations。
 */
export const MAGIC_CHUNK = {
  /** 底图（整屏） */
  bg: 0,
  /** 铺场时那张女巫（抱水晶球） */
  witchIntro: 1,
  /** 常态 / 眨眼的另一张女巫 */
  witchIdle: 2,
  /** 三张长条文字框（开场白 / 提示 / 文本） */
  barIntro: 3,
  barHint: 4,
  barText: 5,
  /** 两个锦缎框：中央字框（红）/ 悬停提示框（绿） */
  frame: 6,
  frameAlt: 7,
  /** 长条结果框 */
  resultBar: 8,
  /** 女巫头部特写（两张脸） */
  face: 9,
  faceAlt: 10,
  /** 十二个功能图标的第一张 = 图 22（第 0 个功能的图标） */
  ringFirst: 22,
} as const;

/**
 * 「功能号 → 图标槽」的基数 @source `lea edx, [ecx + 0x16]`（VA 0x00432cee）
 *   —— `ecx` 是功能号 0..11，故第 0 个功能对应图 22。
 */
export const MAGIC_ICON_SLOT_BASE = 0x16;

/** 每个功能最多两张图 @source 0x00432cf1 的 `shl eax,2 / sub / shl edx,2` = ×12，即索引 +1 */
export const MAGIC_ICON_STRIDE = 2;

// ============================================================
//  版面（屏幕坐标 640×480）
// ============================================================

/** 底图落点 @source 0x00432511 的两处 `push 0` */
export const MAGIC_BG_AT = { x: 0, y: 0 } as const;
/**
 * 铺场时那张女巫的落点。
 * @source 0x00432511：`push 0x8c / push 0xf1` 配 `[0x48c398]+0x18`（图 2）
 *   ★ 那两个数在栈上、且 `push` 顺序与 `fcn_00456418(表面, 图, x, y)` 相反，
 *   故取 (0x8c, 0xf1) = (140, 241)。图 2 的裁切原点 (0,0)，直接落在这里。
 */
export const MAGIC_WITCH_INTRO_AT = { x: 0x8c, y: 0xf1 } as const;
/** 中央字框（红锦缎）落点 @source 0x00432511 尾：`push 0x8c / push 0xf1`（同上那两个数）*/
export const MAGIC_FRAME_AT = { x: 0x8c, y: 0xf1 } as const;
/** 悬停时那个绿锦缎框的落点 @source 0x00432951 `push 0xdf` / `push 0xbc` */
export const MAGIC_FRAME_ALT_AT = { x: 0xbc, y: 0xdf } as const;
/**
 * 常态女巫（图 2，锚点 (0,0)）落点 @source 0x00432a85 起：
 *   `mov [esp+0x40], 0x11e` / `mov [esp+0x44], 0xd9` → (0x11e, 0xd9)。
 */
export const MAGIC_WITCH_AT = { x: 0x11e, y: 0xd9 } as const;
/** 女巫头部特写（图 9/10，锚点约 (70,56)）落点 —— 与常态同一处 @source 0x00432ae7 */
export const MAGIC_FACE_AT = { x: 0x11e, y: 0xd9 } as const;
/** 女巫眨眼的随机概率：`call rand / test al,1 / je` @source 0x00432ad3 */
export const MAGIC_WITCH_BLINK_P = 1 / 2;
/** 长条结果框落点 @source 0x00432894 尾：`0x11e / 0xdc` */
export const MAGIC_RESULT_AT = { x: 0x11e, y: 0xdc } as const;

// ============================================================
//  命中几何（从 Panel.mkf #19 的掩膜量出来，见文件头）
// ============================================================

/**
 * 十二个扇区的圆心。
 *
 * @source 由 #19 的楔形分界线两两相交求得：相邻两条边的交点集中在
 *   (321..322, 237..240)，取 **(320, 238)**。
 *   ★ 表里那十二个中线坐标是按 **(320, 240)** 摆的（相邻两项的中点恰是 (320,240)），
 *   与掩膜的圆心差 2px —— 原版自己也差这 2px，本模块两边各按各的来。
 */
export const MAGIC_CENTER = { x: 320, y: 238 } as const;

/** 一个扇区中线两侧各占多少度 @source #19 的楔形边界落在 0°/30°/…/330° */
export const MAGIC_SECTOR_HALF_DEG = 15;

/**
 * 扇区的**外半径** —— 命中区最远到这里 @source 量自 #19（最长的一条到 r = 241）。
 *
 * ⚠️ #19 是**手绘掩膜**，十二条楔形外缘长短不一（216..241，那是原版按五芒星
 *   外框描出来的），这里用一个外半径近似，见 deviations。
 */
export const MAGIC_OUTER_RADIUS = 241;

/**
 * 中间那块（命中值 13）的半径 @source 量自 #19：最大的 r = 136/137，
 *   而 r = 118 起就已经可能落在楔形里 —— 取 **118**，让「中心是中心、
 *   外圈是外圈」分得干净（原版是手绘掩膜，两圈之间有一段谁都不认的缝）。
 */
export const MAGIC_INNER_RADIUS = 118;

/** 中间那块的命中值 @source #19 里 1..12 是功能、13 是对话框区 */
export const MAGIC_HIT_CENTER = 13;

/** 第 `option` 个功能这一帧用哪张图 @source `lea edx, [option + 0x16]`（VA 0x00432cee）*/
export function magicIconChunk(option: number, frame = 0): number {
  return MAGIC_CHUNK.ringFirst + option + (frame % MAGIC_ICON_STRIDE);
}

/**
 * 第 `option` 个功能图标画在哪。
 *
 * @source `MAGIC_HOUSE_OPTIONS[option].x/y` —— 那就是原版
 *   `_rich4_magic_house_function_info`（VA 0x00475724，每项 16 字节）的 +8/+12，
 *   悬停时画图标、写字都用它（VA 0x00432c7e / 0x00432dbd 的 `shl edx, 4`）。
 */
export function magicIconAt(option: number): { x: number; y: number } {
  const o = MAGIC_HOUSE_OPTIONS[option];
  return o === undefined ? { x: 0, y: 0 } : { x: o.x, y: o.y };
}

/**
 * 十二个功能中线相对圆心的角度（**屏幕坐标系**：y 向下，atan2 用 −dy）。
 *
 * 扇区号 = 功能号 + 1 @source `[0x4756e4 + 扇区*4]` 取到的中线
 *   与 `MAGIC_HOUSE_OPTIONS[扇区−1]` 的 (x,y) 一致。
 */
export function magicIconAngle(option: number): number {
  const at = magicIconAt(option);
  const deg = (Math.atan2(-(at.y - MAGIC_CENTER.y), at.x - MAGIC_CENTER.x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

// ============================================================
//  角度 → 扇区（纯函数，单测钉住）
// ============================================================

/**
 * 舞台坐标落在哪个扇区。
 *
 * @returns 1..12 = 第 `n−1` 个功能；`MAGIC_HIT_CENTER`(=13) = 中间那块；
 *   `0` = 都不认。
 *
 * 判据照 #19 的掩膜：先看半径（> `MAGIC_OUTER_RADIUS` 或 < `MAGIC_INNER_RADIUS` 分开），
 * 再按 `(angle + 15) / 30` 落到十二个楔形里（0° 那一格是 1 号）。
 */
export function sectorAt(x: number, y: number): number {
  const dx = x - MAGIC_CENTER.x;
  const dy = MAGIC_CENTER.y - y; // 屏幕 y 向下
  const r = Math.hypot(dx, dy);
  if (r > MAGIC_OUTER_RADIUS) return 0;
  if (r < MAGIC_INNER_RADIUS) return MAGIC_HIT_CENTER;
  const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  return Math.floor(((angle + MAGIC_SECTOR_HALF_DEG) % 360) / 30) + 1;
}

/** 这个点认不认（原版：命中值为 0 就什么都不做）@source 0x00432b8b */
export function hitsMagicSector(x: number, y: number): boolean {
  return sectorAt(x, y) !== 0;
}

/** 扇区 → 功能号（`扇区号 = 功能号 + 1`）；不是功能扇区返回 `null` */
export function optionOfSector(sector: number): number | null {
  if (sector < 1 || sector > 12) return null;
  return sector - 1;
}

// ============================================================
//  图标帧序
// ============================================================

/** 图标两帧之间多久 —— 取一次游戏 tick（`game speed` 默认档）*/
export const MAGIC_AIR_MS = tickMs(1);

/**
 * 十二个功能图标各自有几张图。
 *
 * @source `_rich4_magic_house_function_info` 的 +4 字段（`@rich4/data` 的 `frames`）：
 *   十二项读出来是 `10 7 7 7 7 7 6 6 6 6 9 0`。
 *
 * ⚠️ **这个字段的语义没有解出来**：原文写的是「动画帧数」，但 6..10 与
 *   实图对不上 —— 图 22..34 一共只有 13 张，十二个功能是**相邻共用**一张
 *   （见 `magicIconChunk`）。这里只取它「是不是那两张大的」这一件事：
 *   `frames == 10` 的第 0 个功能（寶箱）确实是两张，其余按一张读。
 *   见 `docs/deviations/T-037.md` 的 D-MAGIC-3。
 */
export function magicIconFrameCount(option: number): number {
  return MAGIC_HOUSE_OPTIONS[option]?.frames === 10 ? MAGIC_ICON_STRIDE : 1;
}

/**
 * 第 `option` 个功能这一刻画第几张。
 *
 * ★ 原版悬停时是**换图**：把该功能的图标换成同一对里的第二张
 *   （`fcn_00456418`，VA 0x00432d0e）—— 帧序本身原版没有。
 *   本引擎给一个两帧循环把它们用起来，见 deviations。
 *
 * @param option 功能号 0..11（相位错开，免得十二个图标同时翻帧）
 * @param frame 帧计数器 —— 由调用方按 `MAGIC_AIR_MS` 推进（`draw()` 不读时钟）
 */
export function magicIconFrame(option: number, frame: number): number {
  return (frame + option) % magicIconFrameCount(option);
}

/** `now` → 帧计数器 */
export function magicAnimationFrame(now: number): number {
  return Math.floor(now / MAGIC_AIR_MS);
}

// ============================================================
//  回放脚本（纯函数）
// ============================================================

/** 转盘最高速 @source 原版挂 100ms 定时器、隔一次动一下 = 约 200ms 一位 */
export const MAGIC_SPIN_MS = 200;
/** 越转越慢：每一位比上一位多停这么多 */
export const MAGIC_SPIN_SLOW = 45;
/** 转到结果后停多久再关屏 —— 原版点中之后 1.5 秒就走（`push 0x5dc`，VA 0x004339b3） */
export const MAGIC_HOLD_MS = 1500;

/** 转盘数（十二个功能）*/
export const MAGIC_SECTOR_COUNT = 12;

export interface MagicSpin {
  /** 已经转过的位数 */
  step: number;
  /** 上一位换掉的时刻 */
  at: number;
  /** 这一位要停多久 */
  wait: number;
  /** 正指着的功能 */
  option: number;
}

export function magicSpinStart(option: number, now: number): MagicSpin {
  return { step: 0, at: now, wait: MAGIC_SPIN_MS, option };
}

/** 转盘结束前总共转多少位：把最后一圈走满，保证「从哪起转都看得见落点」 */
export function magicSpinSteps(): number {
  return MAGIC_SECTOR_COUNT * 2;
}

/**
 * 转盘往前走。走满 `magicSpinSteps()` 位就停在 `target` 上。
 *
 * 帧序：第 `n` 位指到 `(n + 1) % 12`，最后一位指到 `target` ——
 * 即「先自己转两圈、再停在结果上」。
 */
export function magicSpinTick(s: MagicSpin, target: number, now: number): MagicSpin {
  const total = magicSpinSteps();
  if (s.step >= total) return { ...s, option: target };
  const dt = now - s.at;
  if (dt < s.wait) return s;
  const step = s.step + 1;
  // ★ 位数**直接由 `target` 往前数**：第 `step` 位指到 `target + step − total`。
  //   先前写成 `target + total − over`（over 从 0 起）在 `target === over` 时
  //   会算成同一个数 —— 转盘会卡在落点上不转。
  const option =
    step >= total
      ? target
      : (((target + step - total) % MAGIC_SECTOR_COUNT) + MAGIC_SECTOR_COUNT) %
        MAGIC_SECTOR_COUNT;
  return {
    step,
    at: now,
    wait: s.wait + MAGIC_SPIN_SLOW,
    option,
  };
}

export function magicSpinDone(s: MagicSpin): boolean {
  return s.step >= magicSpinSteps() && s.option >= 0;
}

/** 一次回放的三个阶段 */
export type MagicPhase = 'spin' | 'hold';

export interface MagicPlayback {
  phase: MagicPhase;
  spin: MagicSpin;
  /** 转盘最后停下的功能（回放的目标）*/
  target: number;
  /** 停在结果上的时刻 */
  holdAt: number;
}

export function magicPlaybackStart(target: number, now: number): MagicPlayback {
  return { phase: 'spin', spin: magicSpinStart(target, now), target, holdAt: 0 };
}

/** 推进一步；转盘走完就进 `hold`，`hold` 满 `MAGIC_HOLD_MS` 就返回 `null`（该关屏了）*/
export function magicPlaybackTick(p: MagicPlayback, now: number): MagicPlayback | null {
  if (p.phase === 'spin') {
    const spin = magicSpinTick(p.spin, p.target, now);
    if (spin.step >= magicSpinSteps()) return { ...p, phase: 'hold', spin, holdAt: now };
    return spin === p.spin ? p : { ...p, spin };
  }
  if (now - p.holdAt >= MAGIC_HOLD_MS) return null;
  return p;
}

// ============================================================
//  从状态 diff 反推这次魔法屋
// ============================================================

/** 这次回放要显示什么 */
export interface MagicView {
  /** 触发者（`state.currentPlayer`）*/
  caster: number;
  /** 效果转盘落点 0..11 */
  option: number;
  /** 功能名（`MAGIC_HOUSE_OPTIONS[option].name`）*/
  name: string;
  /** 被点到的人（玩家下标），可能不止一个 */
  targets: number[];
  /** 目标转盘落点 0..11 */
  criterion: number;
  /** 目标条件的名字（`MAGIC_TARGET_NAMES[criterion]`）*/
  criterionName: string;
}

/** 判断某个玩家这一刻是不是站在魔法屋上 @source `node.type == SPECIAL_KIND.MAGIC_HOUSE` */
export function onMagicHouse(state: GameState, topo: MapTopology): boolean {
  const p = state.players[state.currentPlayer];
  if (p === undefined) return false;
  const node = topo.nodes[p.nodeId - 1];
  return node !== undefined && node.specialKind === SPECIAL_KIND.MAGIC_HOUSE;
}

/**
 * 本引擎里可能出现的落点。
 *
 * @source VA 0x0043396d：效果转盘 `mov ecx, 0xb`（取模 **11**）＋
 *   `cmp edx, 6 / lea esi, [edx+1]`（抽到 6 改成 7）—— 所以**随机**能转到的
 *   只有 `{0,1,2,3,4,5,7,8,9,10}` 十个；第 11 条（拍賣當格土地）在零售版里
 *   **永远转不到**。
 *
 * ★ 但「得一張卡片」(6) **确实会出现**：名单里有当前玩家时
 *   `mov esi, 6`（VA 0x0043395a）直接定死，不再抽 —— 所以反推时要把它算进来。
 */
export const MAGIC_REACHABLE_OPTIONS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** 随机转盘真正能抽到的十个（不含「得一張卡片」）@source `mov ecx, 0xb` */
export const MAGIC_SPIN_OPTIONS: readonly number[] = [0, 1, 2, 3, 4, 5, 7, 8, 9, 10];

/**
 * 把玩家身上**确定**会被某个效果改掉的字段摘出来比 —— 效果之外的东西
 * （位置、朝向、神明…）一律不看，那些是 `settle` 之前就动过的。
 *
 * ⚠️ 这是**近似**：原版存的是转盘落点，本引擎存的是「转完之后的状态」，
 *   只能反推。见 `docs/deviations/T-037.md`。
 */
function effectSig(p: Player): string {
  return [
    p.cash,
    p.moneyInBank,
    p.points,
    p.direction,
    p.trafficMethod,
    p.ndices,
    p.godInfo,
    p.blocking.stopping,
    p.blocking.inPrison,
    p.blocking.inHospital,
    p.blocking.inHotel,
    p.blocking.disappearing,
    p.cards.join(','),
  ].join('|');
}

/** 这次 diff 里，除 `who` 外**谁都没动**？（魔法屋只动名单里的人）*/
function untouchedExcept(before: GameState, after: GameState, who: readonly number[]): boolean {
  const set = new Set(who);
  for (let i = 0; i < before.players.length; i++) {
    if (set.has(i)) continue;
    const b = before.players[i];
    const a = after.players[i];
    if (b === undefined || a === undefined) continue;
    if (effectSig(b) !== effectSig(a)) return false;
  }
  return true;
}

/** `誰` 在手牌 / 現金 / 存款 / 點券 上有没有变 */
function fieldsChanged(b: Player, a: Player): Set<'cards' | 'cash' | 'bank' | 'points'> {
  const out = new Set<'cards' | 'cash' | 'bank' | 'points'>();
  if (b.cards.join(',') !== a.cards.join(',')) out.add('cards');
  if (b.cash !== a.cash) out.add('cash');
  if (b.moneyInBank !== a.moneyInBank) out.add('bank');
  if (b.points !== a.points) out.add('points');
  return out;
}

/** 效果只动**名单里的人**，而且名单里的人各自的变化要对得上 */
function matchesEffect(
  option: number,
  targets: readonly number[],
  before: GameState,
  after: GameState,
): boolean {
  if (!untouchedExcept(before, after, targets)) return false;
  for (const who of targets) {
    const b = before.players[who];
    const a = after.players[who];
    if (b === undefined || a === undefined) return false;
    if (effectSig(b) === effectSig(a)) return false; // 被点到的人必须真的变了
    const ch = fieldsChanged(b, a);
    if (option !== 0 && option !== 4 && option !== 8 && ch.has('points')) return false;
    if (option !== 4 && ch.has('bank')) return false;
    if (option !== 0 && option !== 4 && option !== 8 && ch.has('cash')) return false;
    // 「得一張卡片」是**唯一**会往手里加牌的 @source `p.cards = [...p.cards, id]`
    if (option !== 6 && a.cards.length > b.cards.length) return false;
    // 「變賣所有卡片」把牌**清空**、點券按標價全额入账
    if (option === 0) {
      if (a.cards.length !== 0) return false;
      if (b.cards.length > 0 && a.points <= b.points) return false;
      if (b.cards.length === 0 && a.points !== b.points) return false;
    }
    if (option === 8 && a.points < b.points) return false;
    if (option === 4 && (a.moneyInBank < b.moneyInBank || a.cash !== 0)) return false;
  }
  return true;
}

/**
 * 这一组（option, targets）能不能解释这次 diff；能解释的话，
 * 它的「动作强度」有多大 —— 强度 0 表示**什么都没动**（例如手里没牌时的
 * 「變賣所有卡片」，那一条谁都能匹配上，不能当证据）。
 */
function matchStrength(
  option: number,
  targets: readonly number[],
  before: GameState,
  after: GameState,
): number {
  if (!matchesEffect(option, targets, before, after)) return 0;
  let strength = 0;
  for (const who of targets) {
    const b = before.players[who];
    const a = after.players[who];
    if (b === undefined || a === undefined) continue;
    if (b.cards.join(',') !== a.cards.join(',')) strength += 8;
    if (b.cash !== a.cash) strength += 4;
    if (b.moneyInBank !== a.moneyInBank) strength += 4;
    if (b.points !== a.points) strength += 4;
    if (b.direction !== a.direction) strength += 2;
    if (b.trafficMethod !== a.trafficMethod) strength += 2;
    if (b.blocking.stopping !== a.blocking.stopping) strength += 2;
    if (b.blocking.inPrison !== a.blocking.inPrison) strength += 2;
    if (b.blocking.inHospital !== a.blocking.inHospital) strength += 2;
    if (b.godInfo !== a.godInfo) strength += 2;
  }
  return strength;
}

/**
 * 反推这次魔法屋：先确认「落点就在魔法屋上」，再把
 * `before → after` 与 `magicTargets` / 十个效果一一对上。
 *
 * ⚠️ **取证据最强的那一组**，不是第一个对上的：
 *   「變賣所有卡片」在手里没牌时**什么都不改**，`matchesEffect` 会让它
 *   匹配任何 diff。所以强度为 0 的组合只能当兜底。
 *
 * @returns 解不出来（不是魔法屋）返回 `null`；是魔法屋但 diff 对不上任何
 *   组合时返回 `option: -1` 的一份空结果（照样起播）。见 deviations。
 */
export function magicView(before: GameState, after: GameState, topo: MapTopology): MagicView | null {
  if (!onMagicHouse(before, topo)) return null;
  const caster = before.currentPlayer;
  const players = before.players.length;

  let best: MagicView | null = null;
  let bestStrength = 0;

  for (let criterion = 0; criterion < MAGIC_TARGET_NAMES.length; criterion++) {
    const targets = magicTargetsFor(criterion, before, topo);
    if (targets.length === 0) continue;
    const kept = targets.filter((t) => t >= 0 && t < players);
    for (const option of MAGIC_REACHABLE_OPTIONS) {
      const strength = matchStrength(option, targets, before, after);
      if (strength <= bestStrength) continue;
      bestStrength = strength;
      best = {
        caster,
        option,
        name: MAGIC_HOUSE_OPTIONS[option]?.name ?? '',
        criterion,
        criterionName: MAGIC_TARGET_NAMES[criterion] ?? '',
        targets: kept,
      };
      if (strength >= 8) return best; // 已经抓到「手牌变了 / 实体变了」这一档
    }
  }
  if (best !== null) return best;

  // 兜底：diff 解释不通（例如随机抽卡那几步）——仍然起播，只不知道落点
  return {
    caster,
    option: -1,
    name: '',
    criterion: -1,
    criterionName: '',
    targets: [],
  };
}

// ============================================================
//  目标筛选（与 core 的 `magicTargets` 同一套判据，这里要「先算再比」）
// ============================================================

function landCounts(state: GameState, topo: MapTopology): { land: number[]; house: number[] } {
  const land = new Array<number>(state.players.length).fill(0);
  const house = new Array<number>(state.players.length).fill(0);
  for (const l of allEffectiveLands(state, topo)) {
    if (l.owner === 0) continue;
    const i = l.owner - 1;
    if (i < 0 || i >= land.length) continue;
    land[i] = (land[i] ?? 0) + 1;
    if (l.level !== 0) house[i] = (house[i] ?? 0) + 1;
  }
  for (const f of allEffectiveFacilities(state, topo)) {
    if (f.owner === 0) continue;
    const i = f.owner - 1;
    if (i < 0 || i >= land.length) continue;
    land[i] = (land[i] ?? 0) + 1;
    if (f.level !== 0) house[i] = (house[i] ?? 0) + 1;
  }
  return { land, house };
}

/** @source `places/magic-house.ts` 的 `magicTargets`（另见 doc 表）*/
function magicTargetsFor(criterion: number, state: GameState, topo: MapTopology): number[] {
  const ps = state.players;
  const alive = (p: Player): boolean => p.whoPlays !== 0;
  const counts = criterion === 1 || criterion === 2 ? landCounts(state, topo) : null;

  const maxBy = (metric: (p: Player) => number, skipZero: boolean): number[] => {
    let best = 0;
    let out: number[] = [];
    for (const p of ps) {
      if (!alive(p)) continue;
      const v = metric(p);
      if (skipZero && v === 0) continue;
      if (out.length === 0 || v > best) {
        best = v;
        out = [p.index];
      } else if (v === best) {
        out.push(p.index);
      }
    }
    return out;
  };
  const allWhere = (pred: (p: Player) => boolean): number[] =>
    ps.filter((p) => alive(p) && pred(p)).map((p) => p.index);

  let pick: number[];
  switch (criterion) {
    case 0:
      pick = maxBy((p) => wealthOf(state, topo, p.index), false);
      break;
    case 1:
      pick = maxBy((p) => counts?.land[p.index] ?? 0, true);
      break;
    case 2:
      pick = maxBy((p) => counts?.house[p.index] ?? 0, true);
      break;
    case 3:
      pick = maxBy((p) => p.cash, true);
      break;
    case 4:
      pick = maxBy((p) => p.moneyInBank, true);
      break;
    case 5:
      pick = maxBy((p) => p.points, true);
      break;
    case 6:
      pick = allWhere((p) => (p.trafficMethod & 3) === 0);
      break;
    case 7:
      pick = allWhere((p) => (p.trafficMethod & 3) === 1);
      break;
    case 8:
      pick = allWhere((p) => (p.trafficMethod & 3) === 2);
      break;
    case 9:
      pick = allWhere((p) => p.godInfo !== 0);
      break;
    case 10:
      pick = allWhere((p) => p.isMale);
      break;
    case 11:
      pick = allWhere((p) => !p.isMale);
      break;
    default:
      pick = [];
      break;
  }
  return pick.slice(0, 4);
}

/**
 * 身家的**近似**（criterion 0 用）。
 *
 * 地产那部分是照 `rules/wealth.ts` 的 `calculatePlayerWealth` 抄的
 * （住宅 `landPrice + level×housePrice`、連鎖店 `landPrice + housePrice`、
 * 設施 `level×housePrice + landPrice`）。
 *
 * ⚠️ 少了**股票**那一项：core 的 `runMagicHouse` 会调 `valuationsOf(...)`
 *   拿当天行情算持股，UI 这层拿不到行情，故只有在「財產最多的人」这一条上
 *   可能与 core 分歧。见 `docs/deviations/T-037.md`。
 */
function wealthOf(state: GameState, topo: MapTopology, playerIndex: number): number {
  const p = state.players[playerIndex];
  if (p === undefined) return 0;
  const ownerId = playerIndex + 1;
  let total = p.cash + p.moneyInBank - p.loan;

  for (const l of allEffectiveLands(state, topo)) {
    if (l.owner !== ownerId) continue;
    total += l.landPrice;
    // @source loc_00423a2d：連鎖店固定加一份房价、不乘等级
    if (l.type !== LAND_TYPE_HOUSE) total += l.housePrice;
    else if (l.level !== 0) total += l.level * l.housePrice;
  }
  // @source loc_00423a96
  for (const f of allEffectiveFacilities(state, topo)) {
    if (f.owner !== ownerId) continue;
    total += f.level * f.housePrice + f.landPrice;
  }
  return total;
}

// ============================================================
//  绘制
// ============================================================

/** 这一帧要画成什么样 */
export interface MagicDraw {
  view: MagicView;
  /** 这一刻正指着哪个功能（转盘过程中会变）*/
  pointer: number;
  /** 女巫这一帧用常态那张还是抬手那张（原版 `rand()&1`）*/
  witchBlink: boolean;
  /** 鼠标正指着的扇区（原版 `[0x48c3a1]`），0 = 不在任何扇区上 */
  hover: number;
  /** 图标动画的帧计数器（`magicAnimationFrame(now)`）*/
  frame: number;
}

/** 悬停那个高亮圈的颜色（原版画的是另一张图，本引擎没有，见 deviations）*/
export const MAGIC_HOVER = { color: '#ffe080', width: 2, radius: 34 } as const;

/** 字框里那行字的字号 @source 0x00432dfc `push 0xe` */
export const MAGIC_FONT_SIZE = 0x0e;
/** 字色 / 描边 @source 0x00432df7 `push 0xe0e0e0` / `push 0x202020` */
export const MAGIC_TEXT = { fill: '#e0e0e0', stroke: '#202020' } as const;

const MAGIC_FONT = FONT_FAMILY;

/**
 * 结果那两行字画在哪。
 *
 * 原版的提示字也是画在这个点上：`draw_text(字, 图标x, 图标y, flag 2)`，
 * flag 2 = **正中**（VA 0x00432e06 起）。悬停时那个点是**鼠标指着的图标位置**；
 * 本引擎这一步是**回放**（没有鼠标），所以固定用五芒星的中心 `MAGIC_CENTER`
 * —— 与女巫（图 2 落点 (0x11e,0xd9) 也在屏幕中心附近）重叠，但字压在女巫上面。
 */
export const MAGIC_TEXT_AT = { x: MAGIC_CENTER.x, y: MAGIC_CENTER.y } as const;

/** 两行字之间的行距 */
export const MAGIC_TEXT_LINE_H = 22;

/** 锚点落点绘制 @source `fcn_00456418`（`to_left = x − src->x`）*/
function drawAnchored(ctx: CanvasRenderingContext2D, s: Sprite | null, x: number, y: number): void {
  if (s === null) return;
  ctx.drawImage(s.bitmap, x - s.anchorX, y - s.anchorY);
}

/**
 * 哪几张图要**抠掉纯黑**。
 *
 * ★ 原版有两支贴图函数，**逐图挑**，判定只能照调用点抄，不能靠「看黑多不多」：
 *
 * | 函数 | 行为 | @source |
 * |---|---|---|
 * | `fcn_004563f5` | **不透明**拷贝（`rep movsd`，无判断）→ 0x455b3a | 0x004563f5 |
 * | `fcn_00456418` | **抠黑**：源像素 `or ax,ax / je` 为 0 就跳过 → 0x455c52 | 0x00456418 |
 * | `fcn_0045643d` | 带一个矩形参数的拷贝 | 0x0045643d |
 *
 * | 图 | 原版走哪支 | 抠黑 | 出处 |
 * |---|---|---|---|
 * | 0 底图 | `fcn_004563f5` | ✗ | 0x0043256d |
 * | 1 女巫（水晶球） | `fcn_00456418` | ✓ | 0x00432588 |
 * | **2 女巫（抬手）** | **`fcn_00456418`** | **✓** | 0x0043259c |
 * | 3/4/5 长条框 | `fcn_0045643d`（矩形） | ✗ | 0x00432894 起 |
 * | 6/7 锦缎框 | `fcn_00456418` | ✓ | 0x00432cc4 / 0x00432de6 |
 * | 8 长条结果框 | `fcn_004563f5` | ✗ | 0x00432a85 起 |
 * | 9/10 女巫头特写 | `fcn_00456418` | ✓ | 0x00432ae7 |
 * | 22..34 功能图标 | `fcn_00456418` | ✓ | 0x00432d0e / 0x00432dd4 |
 *
 * ⚠️ **图 2 必须抠黑**：它是 284×210、43% 纯黑背景的精灵，画在 (317,238)。
 *   不抠就是一块**盖住右下半个五芒星的黑矩形**（浏览器里已复现）。
 *   本模块第一版那张表漏了 2/9/10 与十二个图标 —— 那是按「哪些像框」猜的，
 *   不是照调用点抄的，现按上表订正。
 *
 * ⚠️ 图 8（长条结果框）走的是**不透明**那支：它只有 2% 黑、且黑都在边角，
 *   抠不抠都看不出差别 —— 这里跟原版一样**不抠**。
 */
export const MAGIC_KEYED = new Set<number>([
  MAGIC_CHUNK.witchIntro,
  MAGIC_CHUNK.witchIdle,
  MAGIC_CHUNK.frame,
  MAGIC_CHUNK.frameAlt,
  MAGIC_CHUNK.face,
  MAGIC_CHUNK.faceAlt,
  MAGIC_CHUNK.barIntro,
  MAGIC_CHUNK.barHint,
  MAGIC_CHUNK.barText,
  // 十二个功能图标：图 22..34（`magicIconChunk` 就是这个区间）
  ...Array.from({ length: 13 }, (_, i) => MAGIC_CHUNK.ringFirst + i),
]);

/** 一张图要不要抠黑由 `MAGIC_KEYED` 说了算，别在各处手写 */
function magicSprite(sprite: MagicSprite, chunk: number): Sprite | null {
  return sprite('Panel.mkf', MAGIC_RESOURCE, chunk, MAGIC_KEYED.has(chunk));
}

/** 图标一律带透明 @source 0x00432d0e 就是 `fcn_00456418` */
function magicIconSprite(sprite: MagicSprite, option: number, frame: number): Sprite | null {
  const chunk = magicIconChunk(option, frame);
  // 图不够时退回这一组的第一张
  return magicSprite(sprite, chunk) ?? magicSprite(sprite, magicIconChunk(option));
}

function magicText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
): void {
  ctx.font = `${size}px ${MAGIC_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = MAGIC_TEXT.stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = MAGIC_TEXT.fill;
  ctx.fillText(text, x, y);
}

/**
 * 画整屏。
 *
 * 顺序照原版 `fcn_00432511`：底图(0) → 红色中央字框(6) → 女巫(1 水晶球 + 2 抬手)，
 * 随后悬停那一段再画十二个功能图标（在女巫**之后**，压在她身上）+ 提示框(7)。
 *
 * ★ 女巫只画**一处**：`fcn_00432511` 画的是图 2（284×210 抬手姿势）在 (0x11e,0xd9)，
 *   之后悬停那一段**不再动她**；`0x00432a85` 那支的「眨眼」是把图 2 换成
 *   图 9/10（头部特写，锚点约 (70,56)、落点同为 (0x11e,0xd9)）。
 *   ⚠️ 图 1（165×213 抱水晶球）在**渲染路径里没有被画到** —— 别把她当底层叠上去，
 *   否则屏上会出现**三个女巫**（浏览器里已复现，见 deviations D-MAGIC-10）。
 *
 * @source 0x00432511（铺场）+ 0x00432ca3 起（悬停那段）
 */
export function drawMagicScreen(
  ctx: CanvasRenderingContext2D,
  sprite: MagicSprite,
  d: MagicDraw,
): void {
  drawAnchored(ctx, magicSprite(sprite, MAGIC_CHUNK.bg), MAGIC_BG_AT.x, MAGIC_BG_AT.y);

  // ── 中央字框 → 字 → 女巫（女巫压在字框上，与她压住五芒星同一个道理）──
  drawAnchored(ctx, magicSprite(sprite, MAGIC_CHUNK.frame), MAGIC_FRAME_AT.x, MAGIC_FRAME_AT.y);

  const pointerOption = d.pointer >= 0 && d.pointer < MAGIC_SECTOR_COUNT ? d.pointer : -1;

  if (d.view.option >= 0) {
    // 回放：结果那行和「对谁做」
    const who = d.view.targets.map((i) => `P${i + 1}`).join(' ');
    const line = `${d.view.name}${who === '' ? '' : ` → ${who}`}`;
    magicText(ctx, line, MAGIC_TEXT_AT.x, MAGIC_TEXT_AT.y, MAGIC_FONT_SIZE + 3);
    magicText(
      ctx,
      d.view.criterionName,
      MAGIC_TEXT_AT.x,
      MAGIC_TEXT_AT.y + MAGIC_TEXT_LINE_H,
      MAGIC_FONT_SIZE,
    );
  } else {
    // 悬停（回放解不出落点时的兜底也走这条）
    const label = pointerOption >= 0 ? (MAGIC_HOUSE_OPTIONS[pointerOption]?.name ?? '') : '';
    if (label !== '') magicText(ctx, label, MAGIC_TEXT_AT.x, MAGIC_TEXT_AT.y, MAGIC_FONT_SIZE + 4);
  }

  drawAnchored(
    ctx,
    magicSprite(sprite, d.witchBlink ? MAGIC_CHUNK.face : MAGIC_CHUNK.witchIdle),
    MAGIC_WITCH_AT.x,
    MAGIC_WITCH_AT.y,
  );

  // ── 十二个功能图标（在女巫身上，压着她画）──
  for (let option = 0; option < MAGIC_SECTOR_COUNT; option++) {
    const at = magicIconAt(option);
    drawAnchored(ctx, magicIconSprite(sprite, option, magicIconFrame(option, d.frame)), at.x, at.y);
  }

  // ── 指到谁就给谁描一圈 ──
  //
  // ⚠️ 原版这里是**换图**（把该功能的图标换成同一对里的第二张），
  //   本引擎拿同一对的两张轮着翻（见 `magicIconFrame`）；多描一圈是为了
  //   在「手牌里只有一张图」的功能上也看得出指到哪 —— 见 deviations。
  const hoveredOption = optionOfSector(d.hover);
  if (hoveredOption !== null) {
    const at = magicIconAt(hoveredOption);
    ctx.save();
    ctx.lineWidth = MAGIC_HOVER.width;
    ctx.strokeStyle = MAGIC_HOVER.color;
    ctx.beginPath();
    ctx.arc(at.x, at.y, MAGIC_HOVER.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ============================================================
//  屏幕本体
// ============================================================

/** 现在正在播的那一段；`null` = 没在播 */
let playback: MagicPlayback | null = null;
/** 这一次回放的落点（解不出时 = -1）*/
let view: MagicView | null = null;
/** 鼠标现在指着的扇区（原版 `[0x48c3a1]`）*/
let hover = 0;

/** 调试 / 单测用：把整屏关掉 */
export function resetMagicScreen(): void {
  playback = null;
  view = null;
  hover = 0;
}

export const magicScreen: UiScreen = {
  id: 'magic',

  /** 演出期间接管整屏；播完自己关 @source 原版是 `[0x48c3a2] == 8` 就退出 */
  active: () => playback !== null,

  draw(env: UiScreenEnv): void {
    const v = view;
    if (v === null) return;
    const pointer = playback?.spin.option ?? v.option;
    const witchBlink = Math.random() < MAGIC_WITCH_BLINK_P;
    const frame = magicAnimationFrame(env.now);
    drawMagicScreen(env.stage, env.sprite, { view: v, pointer, witchBlink, hover, frame });
  },

  move(x: number, y: number): void {
    hover = sectorAt(x, y);
  },

  down(x: number, y: number, env: UiScreenEnv): void {
    // 回放期间不接受输入（原版这一屏的点击只是「自己按下去」，本引擎没有那一步）
    if (playback !== null) return;
    const sector = sectorAt(x, y);
    const option = optionOfSector(sector);
    env.log(
      `魔法屋：扇区 ${sector}${option === null ? '' : `（${MAGIC_HOUSE_OPTIONS[option]?.name ?? ''}）`}`,
    );
  },

  tick(env: UiScreenEnv): void {
    if (playback === null) return;
    const next = magicPlaybackTick(playback, env.now);
    if (next === null) {
      playback = null;
      view = null;
      hover = 0;
      env.log('魔法屋：回放结束');
      env.requestRender();
      return;
    }
    const prevOption = playback.spin.option;
    const prevPhase = playback.phase;
    playback = next;
    // ★ 换了一位、或刚进 `hold`：画面变了要重画。
    //   转盘「还在等下一位」的那几帧没有变化，不续帧；`hold` 期间要续帧，
    //   否则 `tick` 不再被调用，屏就永远关不掉了。
    if (next.spin.option !== prevOption || next.phase !== prevPhase) {
      env.requestRender();
    } else if (next.phase === 'hold') {
      env.requestRender();
    }
  },

  /**
   * 察觉「刚刚落了一次魔法屋」。
   *
   * ★ 触发判据分两步（都纯查状态）：① `before` 里触发者正站在魔法屋上；
   *   ② `before → after` 的玩家字段能被某一组（目标条件 × 效果）解释。
   *   第 ② 步解不出也照样起播 —— 只显示转盘、不显示落点文字，
   *   免得漏掉一次演出。这条近似记在 `docs/deviations/T-037.md`。
   */
  event(before: GameState, after: GameState, env: UiScreenEnv): void {
    if (playback !== null) return; // 上一段还没播完
    if (before === after) return;
    const v = magicView(before, after, env.topo);
    if (v === null) return;
    view = v;
    const target = v.option >= 0 ? v.option : 0;
    playback = magicPlaybackStart(target, env.now);
    env.log(`魔法屋：${v.name === '' ? '（落点未解出）' : v.name}`);
    env.requestRender();
  },
};

/** 给单测的只读视图（`active()` 之外的状态）*/
export function magicScreenState(): { playing: boolean; view: MagicView | null; hover: number } {
  return { playing: playback !== null, view, hover };
}
