/*
 * 樂透開獎演出 —— 原版那台十态状态机的**脚本**
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这个模块**一条规则都没有**（谁中奖、给多少钱在 `lottery.ts`）。
 *   它只把「开奖那一刻屏幕上发生什么」按原版的顺序抄下来：
 *   每一步说什么话、铺哪几张子图、起哪个动画、要等多久。
 *
 * ★ 原版（`rich4_ui_letou.asm` 的 `fcn_0043010c`）是**窗口过程 + 50 ms 定时器**：
 *   一个字节 `0x48c37b` 走 0..10 十个状态，`0x004300d0` 是那张跳表。
 *   每个状态干三件事：置下一个状态值、说一句话（开一个 2 s 的气泡）、
 *   铺图/起动画。**状态机只在气泡收掉后才往前走**
 *   （`0x004301e8`：`call fcn_0044ee18 / test eax,eax / je` 等待体）。
 *   所以「说一句 → 铺图 → 数帧 → 再下一句」这个节奏感就是原版的节奏。
 *
 * 素材：全部来自 `Panel.mkf`，子图号已按 exe 里的加载点核对过
 *   （`0x00431712` 起：资源 0x0f=15 主屏、0x10=16 摇球机、0x11=17 得主面板、
 *     0x0d=13 小数字牌）。`Panel#15` 的 47 张子图逐张导出目视核过：
 *   0 舞台底图 640×480 / 1..6 同一个女主持人的六个姿势 / 7..21 脸部贴片
 *   （眼、嘴、整脸）/ 22 对话气泡 / 23 黄色爆炸框 / 24 红色爆炸框
 *   / 25..36 十二个角色头像徽章 / 37..46 号码球 0..9（71×70，锚点居中）
 *
 * ⚠️ 已知的**不确定处**（写明了别当已知）：
 *   1. 状态 6/8 那两步的「擦除哪些矩形」我只对上了大部分，逐张核对要真机截图；
 *   2. 脸部动画「一个槽播几帧后停下」的条件是位运算推的，未实机核对。
 */

import { LOTTERY, type OriginalText } from '@rich4/data';
import type { LotteryDrawResult } from './lottery.ts';

// ============================================================
//  素材
// ============================================================

/** 这一屏的全部子图都在 `Panel.mkf` 的资源 15（@source 0x00431712 的 `push 0xf`） */
export const CEREMONY_PANEL = 0x0f; // 主屏 = Panel#15
/** 摇球机动画（@source 0x0043172f 的 `push 0x10`），用 `fcn_00450ced` 起 */
export const CEREMONY_DRUM_PANEL = 0x10; // Panel#16
/** 得主面板动画（@source 0x00431749 的 `push 0x11`） */
export const CEREMONY_WINNER_PANEL = 0x11; // Panel#17
/** 小数字牌（@source 0x00431739 的 `push 0xd`）—— 各人持号表里的号码用它 */
export const CEREMONY_DIGIT_PANEL = 0x0d; // Panel#13

/** 屏幕尺寸。原版那些矩形全是按 640×480 硬编码的 */
export const CEREMONY_W = 640;
export const CEREMONY_H = 480;

/**
 * `Panel#15` 的子图号。
 * @source 代码里的 `mov eax, [0x48c360]; add eax, 0xNN`，子图号 = (0xNN − 0xc) / 12
 *   （每项 12 字节，就是 `graph_st` 头：w,h,热点x,热点y,数据）
 */
export const ENTRY = {
  /** 640×480 的舞台：蓝幕布 + 玻璃摇奖球 + 台座 + 标题「大富翁樂透開獎」 */
  stage: 0,
  /** 女主持人的六个姿势（同一帧里她被画两次：左 (7,66)、右 (472,66)）*/
  pointing: 1, // 竖手指
  presenting: 2, // 摊手
  board: 3, // 举空白板
  oops: 4, // 捂嘴、带汗滴
  laugh: 5, // 双手举脸旁大笑
  jumpBoard: 6, // 举板过顶、单脚跳
  /** 对话气泡（187×140，锚点 (0,0)）*/
  bubble: 22,
  /** 无人中奖的黄色放射爆炸框（233×192，锚点居中）*/
  burstSorry: 23,
  /** 中奖的红色爆炸框（295×262，锚点居中）*/
  burstWin: 24,
  /** 角色头像徽章：`badge + 角色号` → 25..36（各人持号表用）*/
  badge: 25,
  /**
   * 整张苦笑脸（50×40，锚点 (0,0)）—— 开出空号时**不透明**盖在左主持人脸上。
   * @source 0x00430d85 的 `[0x48c360]+0xc + 0x15*12`（子图 21）
   */
  faceWry: 21,
  /** 号码球：`ball + 数字` → 37..46 */
  ball: 37,
} as const;

/** 左／右两个主持人各自的站立位置（`fcn_0042f6c3` 建屏时铺的）*/
export const POSE_LEFT = [7, 66] as const;
export const POSE_RIGHT = [472, 66] as const;

/** 气泡摆位（`fcn_0044ec30` 的锚点）—— 顶右上角，上边探出 10 px */
export const BUBBLE_AT = [300, -10] as const;
/** 中央爆炸框的锚点 —— 屏幕正中 */
export const BURST_AT = [320, 200] as const;

/**
 * 屏幕上的文字位置（`rich4_draw_text(字号, 串, x, y, 对齐)`；`对齐 2` = 以 (x,y) 为**中心**）。
 * @source 0x0042f6c3（累積獎金/金额）、0x00430485（得主名、上移的那一份）
 */
export const CEREMONY_TEXT = {
  /** 「累積獎金」标签，建屏时在左下 */
  poolLabel: { at: [77, 193], align: 2, size: 0x14 },
  /** 公库金额（红色），紧跟标签 */
  poolAmount: { at: [77, 228], align: 2, size: 0x14, color: 0xff0000 },
  /** 得主公布时，这两个挪到左上（0x00430485 重画的那一份）*/
  poolLabelTop: { at: [91, 19], align: 2, size: 0x14 },
  poolAmountTop: { at: [91, 56], align: 2, size: 0x14, color: 0xff0000 },
  /** 得主名字：28 px 红字，居中 */
  winnerName: { at: [320, 180], align: 2, size: 0x1c, color: 0xff0000 },
} as const;

export type CeremonyTextId = keyof typeof CEREMONY_TEXT;

/**
 * 中奖号那两颗球的锚点 —— 十位在左、个位在右。
 * @source 0x00430b7a 起：`push 0x195 / push 0x11e`（=286,405）与 `push 0x195 / push 0x166`（=358,405）
 */
export const BALL_TENS_AT = [286, 405] as const;
export const BALL_ONES_AT = [358, 405] as const;

/**
 * 各人持号表：四块铭牌 2×2 排在屏幕下半，每块 296×60。
 * @source 表 `0x0042f30c`（8 个 dword 就是四对 x,y）+ `fcn_004552e7` 的 0x128/0x3c
 */
export const TALLY_PLATES = [
  [16, 340],
  [16, 410],
  [328, 340],
  [328, 410],
] as const;
/** 铭牌里号码的起点偏移与行距（相对铭牌左上角）@source 0x0042f55b */
export const TALLY_TEXT = { dx: 0x36, dy: 0x1e, pitch: 0x28, wrapAfter: 0x0a } as const;

// ============================================================
//  节奏
// ============================================================

/** 定时器周期 —— `SetTimer(hwnd, 0x113, 0x32)`，50 ms */
export const CEREMONY_TICK_MS = 0x32;
/** 状态 3 至少数 20 帧（1 s）才开号 @source 0x0043024c 的 `cmp dh, 0x14` */
export const CEREMONY_ROLL_TICKS = 0x14;
/** 状态 5 至少数 30 帧（1.5 s）@source 0x00430f43 的 `cmp dl, 0x1e` */
export const CEREMONY_HOLD_TICKS = 0x1e;
/** 气泡最长 2 s —— `[0x4762c4]` 的 `timeGetTime` 差 ≥ 0x7d0；
 *  开了音效（`cfg+3`）则改成等语音播完（`fcn_004544b9`）*/
export const CEREMONY_VOICE_MS = 0x7d0;
/** 开出空号时的戏剧性停顿 —— `fcn_0045285e(0x1f4)` @source 0x00430d85 */
export const CEREMONY_SORRY_PAUSE_MS = 0x1f4;

// ============================================================
//  脚本
// ============================================================

/** 整张铺一张子图 */
export interface CeremonyBlit {
  entry: number;
  at: readonly [number, number];
  /**
   * `true` = 不透明（原版 `fcn_004563f5`）。
   * 脸部贴片必须用这个 —— 它是**盖**在她脸上的一块，抠黑会露出原来的眼。
   * 其余精灵用抠黑（`fcn_00456418`）。
   */
  opaque?: boolean;
}

/** 从某张子图上拷一块矩形回来 —— 原版的「擦除」手法 */
export interface CeremonyPatch {
  /** 从哪张子图拷（通常是 `ENTRY.stage`，那块是没画人的干净底）*/
  from: number;
  /** 目标左上角 */
  at: readonly [number, number];
  /** 源矩形左上角 + 尺寸 @source 参数是 (dest, sprite, dx,dy, sx,sy, w,h) */
  from4: readonly [number, number, number, number];
}

/** 起一个多帧子图动画 —— 原版 `fcn_00450ced(sprite, x, y, flags)`，每帧 `fcn_00450f04()` 推进 */
export interface CeremonyAnim {
  panel: number;
  entry: number;
  at: readonly [number, number];
  flags: number;
}

export interface CeremonyHold {
  /** 至少等这么多帧（50 ms/帧）*/
  ticks?: number;
  /** 还要等这一步起的动画放完 */
  anim?: boolean;
  /** 还要等这句话说完（2 s，或语音播完）*/
  voice?: boolean;
  /** 硬停顿这么多毫秒（原版的 `fcn_0045285e`）*/
  pauseMs?: number;
}

export interface CeremonyStep {
  /**
   * 原版 `0x48c37b` 的值。**不是给 UI 用的状态**，是让你能对着 exe 逐帧核。
   * 顺序是脚本的顺序，值可能有跳（原版的 8 是两条支路汇合处）。
   */
  state: number;
  /** 进入这一步时说的话 */
  line: OriginalText | null;
  blits: readonly CeremonyBlit[];
  patches: readonly CeremonyPatch[];
  anim: CeremonyAnim | null;
  texts: readonly CeremonyTextId[];
  /** 这一步还要画各人持号表 */
  tally?: boolean;
  hold: CeremonyHold;
}

/** 中奖号两位数 → 两颗球的贴片（十位在左、个位在右）@source 0x00430b7a 的 `"%02d"` */
export function ballBlits(number: number): readonly CeremonyBlit[] {
  const tens = Math.floor(number / 10) % 10;
  const ones = number % 10;
  return [
    { entry: ENTRY.ball + tens, at: BALL_TENS_AT, opaque: true },
    { entry: ENTRY.ball + ones, at: BALL_ONES_AT, opaque: true },
  ];
}

/** 建屏那一下（`fcn_0042f6c3`）—— 原版在 WM_CREATE 里直接画，不属于任何状态 */
export const CEREMONY_BASE: CeremonyStep = {
  state: 0,
  line: null,
  blits: [
    { entry: ENTRY.stage, at: [0, 0], opaque: true },
    { entry: ENTRY.pointing, at: POSE_RIGHT },
    { entry: ENTRY.board, at: POSE_LEFT },
    { entry: ENTRY.bubble, at: BUBBLE_AT },
  ],
  patches: [],
  anim: null,
  texts: ['poolLabel', 'poolAmount'],
  tally: true,
  hold: {},
};

/** 清铭牌那一条带（608×130，从底图上原样拷回来）@source 0x0043036c 起每步都先做 */
const CLEAR_PLATES_BAND: CeremonyPatch = {
  from: ENTRY.stage,
  at: [16, 340],
  from4: [16, 340, 608, 130],
};

/**
 * 排出一次开奖的完整演出。
 *
 * 纯函数：同样的 `draw` 得到同样的脚本；`number === null` 表示这次根本没开屏
 * （一张票都没卖出去，`0x00431720` 那个循环直接返回）。
 */
export function lotteryCeremony(draw: LotteryDrawResult): readonly CeremonyStep[] {
  if (draw.number === null) return [];

  const won = draw.winner !== null;
  const balls = ballBlits(draw.number);

  const steps: CeremonyStep[] = [
    // ── 1：主持人开场（0x004301b0 → 状态 1）──
    {
      state: 1,
      line: LOTTERY.drawIntro,
      blits: [],
      patches: [],
      anim: null,
      texts: [],
      hold: { voice: true },
    },
    // ── 2：报幕（0x00430236：置 2 时说这句）──
    {
      state: 2,
      line: LOTTERY.drawRolling,
      blits: [],
      patches: [],
      anim: null,
      texts: [],
      hold: { voice: true },
    },
    // ── 3：铺开奖画面 + 起摇球机（0x0043036c），然后数 20 帧开号 ──
    {
      state: 3,
      line: null,
      blits: [
        // ★ 右：换成摊手。落点就是 `POSE_RIGHT`（472, 66）—— 与建屏那一次同一格
        //   @source 0x0042f6fa `push 0x42 / 0x1d8 / [0x48c360]+0x18`。
        //   ⚠️ 这张图是 206 宽（`Panel#2`），472 + 206 = 678 会**越出 640 的右缘** ——
        //   那正是原版的画法（它的 blit 自带屏幕裁剪；见 0x00430418 之后那两次
        //   `fcn_00456418`，两次都压在 472）。先前写成 418 会在屏上留下**两个**
        //   右主持人（418 与 472 各一张，206 宽里重叠 152 点）。
        { entry: ENTRY.presenting, at: POSE_RIGHT },
      ],
      patches: [
        CLEAR_PLATES_BAND,
        // 清掉累积奖金那一格，好重画（从底图同位拷回来）
        { from: ENTRY.stage, at: [472, 116], from4: [472, 116, 45, 90] },
        // 用她自己的图补腿部 —— 号码球落在台座上，先擦干净
        { from: ENTRY.board, at: [7, 340], from4: [0, 274, 134, 130] },
      ],
      anim: { panel: CEREMONY_DRUM_PANEL, entry: 0, at: [183, 75], flags: 8 },
      texts: [],
      hold: { ticks: CEREMONY_ROLL_TICKS, anim: true },
    },
    // ── 开号：两颗号码球落到台座上（状态 3 的尾巴，0x00430b7a 之后）──
    {
      state: 3,
      line: null,
      blits: balls,
      patches: [],
      anim: null,
      texts: [],
      hold: {},
    },
  ];

  if (won) {
    // ── 4：得主（0x00430485）──
    steps.push(
      {
        state: 4,
        line: LOTTERY.drawWinnerIs,
        blits: [
          { entry: ENTRY.jumpBoard, at: [0, 0] }, // 左：举板过顶跳
          { entry: ENTRY.laugh, at: [505, 66] }, // 右：大笑
          { entry: ENTRY.burstWin, at: BURST_AT }, // 中央红爆炸框
          ...balls, // 号码球重画一遍
        ],
        patches: [CLEAR_PLATES_BAND],
        anim: { panel: CEREMONY_WINNER_PANEL, entry: 0, at: [205, 0], flags: 1 },
        texts: ['winnerName', 'poolLabelTop', 'poolAmountTop'],
        // 这一步只等话说完 —— 得主面板那个动画是**状态 5** 才去等的
        hold: { voice: true },
      },
      // ── 5：数 30 帧（0x00430f43 那段），完了置 6 说「恭喜」（0x0043024c 的尾巴）──
      {
        state: 5,
        line: null,
        blits: [
          { entry: ENTRY.jumpBoard, at: [0, 0] },
          { entry: ENTRY.laugh, at: [505, 66] },
          ...balls,
        ],
        patches: [],
        anim: null,
        texts: [],
        hold: { ticks: CEREMONY_HOLD_TICKS, anim: true },
      },
      {
        state: 6,
        line: LOTTERY.drawWinAll,
        blits: [
          { entry: ENTRY.jumpBoard, at: [0, 0] },
          { entry: ENTRY.laugh, at: [505, 66] },
          ...balls,
        ],
        patches: [],
        anim: null,
        texts: [],
        hold: { voice: true },
      },
    );
  } else {
    // ── 7：开出空号（0x00430d85）—— 先硬停 500 ms 才说话 ──
    steps.push({
      state: 7,
      line: LOTTERY.drawNoWinner,
      blits: [
        { entry: ENTRY.oops, at: [489, 116] }, // 右：捂嘴带汗
        { entry: ENTRY.burstSorry, at: BURST_AT }, // 中央黄爆炸框
        // ★ 左主持人**整张脸**换成苦笑那张（不透明贴片，50×40）
        { entry: ENTRY.faceWry, at: [52, 89], opaque: true },
        ...balls,
      ],
      patches: [CLEAR_PLATES_BAND],
      anim: null,
      texts: [],
      hold: { pauseMs: CEREMONY_SORRY_PAUSE_MS, voice: true },
    });
  }

  // ── 8：收尾（0x004308f3；中奖走 6→8，空号走 7→8）──
  //   把右主持人那一整片（151×364）从底图上拷回来 —— 也就是把她擦掉重画
  steps.push(
    {
      state: 8,
      line: won ? null : LOTTERY.drawCarryOver,
      blits: [{ entry: ENTRY.pointing, at: POSE_RIGHT }],
      patches: [
        { from: ENTRY.stage, at: [489, 116], from4: [489, 116, 151, 364] },
        // 左脸也还原（从她自己的图里拷回那张中性脸）
        { from: ENTRY.board, at: [52, 89], from4: [45, 23, 50, 40] },
      ],
      anim: null,
      texts: [],
      hold: { voice: true },
    },
    // ── 9、10：两句收场白，然后派彩关屏（0x00430aa3 / 0x00430ab5）──
    {
      state: 9,
      line: LOTTERY.drawHopeNext,
      blits: [],
      patches: [],
      anim: null,
      texts: [],
      hold: { voice: true },
    },
    {
      state: 10,
      line: LOTTERY.drawHurryUp,
      blits: [],
      patches: [],
      anim: null,
      texts: [],
      hold: { voice: true },
    },
  );

  return steps;
}

// ============================================================
//  脸部动画（眨眼 / 张嘴）
// ============================================================

/**
 * 两个主持人的脸是**一块块贴片拼出来的**：原版拿 `0x48c350` 一个 dword 当调色盘，
 * 低 4 位 = 当前在动的那一个槽，其余每个 4 位段 = 该槽的帧号。
 *
 * | 槽 | 贴片矩形 | 帧表（Panel#15 子图号）|
 * |---|---|---|
 * | 1 | 右眼 (512,102)-(562,118) | 8,7,8,10 |
 * | 2 | 左眼 (52,89)-(102,115)   | 16,17,16,15 |
 * | 3 | 右眼（变体）            | 9,10 |
 * | 4 | 左眼（变体）            | 14,15 |
 *
 * 另有右主持人的嘴：(512,119)-(562,141)，静止是 11、动起来在 12/13 之间跳
 * （`0x48c34c` 管停留几帧）。左主持人的嘴（子图 18..20）在同屏没找到调用点。
 *
 * @source 0x004310ff 的跳表 `0x004300f8`（5 项）与 `0x00431431` 之后的嘴
 */
export const FACE_SLOTS = [
  { rect: [512, 102, 562, 118], frames: [8, 7, 8, 10] },
  { rect: [52, 89, 102, 115], frames: [16, 17, 16, 15] },
  { rect: [512, 102, 562, 118], frames: [9, 10] },
  { rect: [52, 89, 102, 115], frames: [14, 15] },
] as const;

/** 右主持人的嘴 */
export const FACE_MOUTH = { rect: [512, 119, 562, 141], rest: 11, moving: [12, 13] } as const;

/** 贴片不透明重画 → 空档（槽做完了就回「没人动」）*/
const FACE_IDLE_TICKS = 6;

/** 32 位 hash —— 把一个帧号摊成一个看起来随机的数 */
function hash32(n: number): number {
  let x = (n + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
}

/**
 * 第 `tick` 帧该往脸上贴什么。
 *
 * ★ **原版是 `libc_rand()` 抽的**（`rand()>>9` 落 0 / 1 / 2-3 / 4-5 时分别启动
 *   槽 1/2/3/4，其余 58/64 不动 —— 平均 0.9 秒才跳一次）。这里改成**按帧号推**，
 *   不是改良：动画不该消耗游戏随机流（C-DET-1），而且原版每天
 *   `srand(GetTickCount())`，那串数本来就不可复现，抄也抄不出「一样的眨眼时刻」。
 *   每个槽按原版的**触发概率**抽：1/64、1/64、2/64、2/64。
 *
 * ★ 动画只在**状态 1/2/3/9/10** 跑：得主公布那几步（4..8）她的脸是冻住的
 *   （`0x004310eb` 的 `cmp bh,4 / jb` + `cmp bh,8 / jbe` 那道闸）。
 *
 * @param tick 从建屏起的帧号（50 ms/帧）
 */
export function facePartsAt(tick: number): readonly CeremonyBlit[] {
  const out: CeremonyBlit[] = [];
  const h = hash32(tick);

  // 每 64 帧抽一次「哪个槽起跳」，命中后连播它的帧表
  const phase = tick % 64;
  const roll = h % 64;
  const slot: 0 | 1 | 2 | 3 | null = roll === 0 ? 0 : roll === 1 ? 1 : roll < 4 ? 2 : roll < 6 ? 3 : null;
  if (slot !== null) {
    const def = FACE_SLOTS[slot];
    const frame = def.frames[Math.floor(phase / FACE_IDLE_TICKS) % def.frames.length]!;
    out.push({ entry: frame, at: [def.rect[0], def.rect[1]], opaque: true });
  }

  // 嘴：一直在一张一合（原版靠 `rand()&0xf` 决定张多久）
  const speaking = hash32(tick ^ 0x5bf03635) % 14 < 4;
  out.push({
    entry: speaking ? FACE_MOUTH.moving[hash32(tick) % 2]! : FACE_MOUTH.rest,
    at: [FACE_MOUTH.rect[0], FACE_MOUTH.rect[1]],
    opaque: true,
  });

  return out;
}
