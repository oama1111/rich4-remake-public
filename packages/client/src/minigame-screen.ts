/*
 * 三个小游戏整屏：企鵝挖寶 / 七彩氣球 / 財神接金幣（T-042 / T-043 / T-044）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ## 出处
 *
 * 全部来自 `rich4-re/asm/rich4_small_games.asm`（全量反汇编）。三个入口：
 *
 * | specialKind | 落点跳表 | 处理 | 入口 VA | 名字 |
 * |---|---|---|---|---|
 * | 6 | `[0x4197e9 + 24]` = 0x41b146 | `call 0x415215` | **0x00415215** | `_rich4_ui_game_penguin_treasure` 企鵝挖寶 |
 * | 7 | `[0x4197e9 + 28]` = 0x41b15e | `call 0x4154dc` | **0x004154dc** | `_rich4_ui_game_balloon` 七彩氣球 |
 * | 8 | `[0x4197e9 + 32]` = 0x41b16c | `call 0x4155fc` | **0x004155fc** | `_rich4_ui_game_xicongtianjiang` **喜從天降 = 財神接金幣** |
 *
 * ★ 调度点 `0x004198b2 jmp dword [ebx*4 + 0x4197e9]`（`ebx` = 落点记录 `+0x24` 的 specialKind）。
 *   三个入口尾巴形状一致：`add word [player + 0x496b98], ax` —— **點券 += 得分**。
 *   即 **8 = `SPECIAL_KIND.GIFT_FROM_SKY`** 是**读出来的**，不是排除法推的：
 *   第 8 项调的函数名就叫「喜從天降」。卡片里「mkf 22」那一句是**错的**（见 D-MINI-1）。
 *
 * ★ 三屏共用的两个资源（三个入口的头几句都一样）：
 *   `read_mkf(panel_mkf, 0x4e=78, 0, 0)` → 入场 FLIC（D-MINI-3 未接）；
 *   `read_mkf(panel_mkf, 0x4f=79, 0, 0)` → 数字表（0..9 小号 15×28、10..19 大号 43..60×75..80）。
 *
 * ## 三屏的资源与玩法（逐条带 VA）
 *
 * ### 一、企鵝挖寶（VA 0x00415215，载入 0x4e..0x5a）
 * - 底板/图标 = **80**（图 0 底图、1/2 光标、3 冰屋、4..8 = 寶物图标 `类型+3` @0x0041466f）；
 *   走行 = **82**（`方向*4 + 子帧`，8 向 × 4 帧 @0x004126c2）；
 *   挖掘 = **83**（同索引 @0x00412851）；结算高/低 = **84 / 85**；
 *   五种寶物的「挖到」动画 = **86..90**（表 `0x48bd14`，`[0x48bd10 + 类型*4]`）。
 * - **命中表 = 81**：640×480 的 8bpp，**每个像素的值就是格号**（0..80，0 = 不在棋盘上）。
 *   鼠标分支 0x00414abe 直接 `row = 值/9、col = 值%9` 送 `fcn_0041211c`。
 *   本模块拿不到这张 `.bin`（D-MINI-2），改用格坐标表 `0x474d7c` + 菱形几何重建，
 *   与 #81 逐像素比对过：64 个有效格的格心像素**全中**。
 * - 棋盘：9×9 索引表，其中 **17 格 `x=0` = 不在棋盘上**（原版就是拿 `word[+0] == 0` 判无效），
 *   连正中的冰屋那格共 64 个可走格（菱形，半宽 48 / 半高 24，格心 = 表里的 x/y）。
 * - 埋寶 @0x00412014：按 `0x411fc8` 的 `[3,12,3,9,1]` 共 **28 个**，逐个在**剩余空格里**抽
 *   （`rand()*ebp>>15`，`ebp` 从 0x40=64 每埋一个减 1），类型 1..5。
 * - 计分（**分数由 HUD 反推**：`fcn_00413a4a` 每次重算 `[0x48bcec]` @0x00413d6a）：
 *   `分数 = 类型5×20 + 类型3×12 + 类型4×8 + 类型2×5`；**类型 1 不计分**（0x004129ab 只播个音）。
 *   （计数器在 `[0x48bbac + 类型*4]` @0x004129fc，所以类型 2..5 正好落在 HUD 读的
 *   `0x48bbb4/8/c/0` 四个格上。）
 * - 时限：定时器 **100ms**（`SetTimer(…, 0x64, …)` @0x004148b9）、`[0x48bd2c]` 从 **150** 递减
 *   （= 15 秒）；前面还有 `[0x48bd7c] = 10` 的 1 秒入场（这一段里**土堆是画出来的**
 *   —— `fcn_0041461b(1)` @0x004148b9；入场结束的 0x405 里改传 0，土堆就没了）。
 * - 结算姿势按分数 @0x00414986：`< 40` → 动画 5（资源 85）、`> 55` → 动画 4（资源 84）、
 *   中间 → 动画 6（只是把光标图重画 16 次）；动画走完后 `[0x48bd58] = 1 → 2`，
 *   画大号分数 `fcn_00414789`，等 **2000ms**（`fcn_0045285e(0x7d0)`），关屏。
 *
 * ### 二、七彩氣球（VA 0x004154dc，载入 0x4e/0x4f/0x5b）
 * - 底图 + 气球 + 爆开 = **91**（图 0 底、图 `类型+1` 气球、图 13 爆开）；计时/计分 = 79。
 * - 16 个槽 `0x48bc44`（`{x, y, 类型字, 速度}`）。`x = 0` 即空槽。
 * - 生成 @0x00413189（每 tick **每个空槽**一次）：`r = rand() % 1000`
 *   `r < 20` → 类型 `r>>2`（0..4）；`r < 28` → `((27-r)>>1)+5`（5..8）；`r < 30` →
 *   `0x475039[rand()%10]` = `{9,9,10,10,10,10,10,11,11,11}`；`>= 30` → 不生成。
 *   落点：在 7 条道 `x = 0x28 + 0x50k (< 0x280)` 里挑一条**没有气球 y > 0x12c** 的，
 *   `rand() % 条数` 选一条，`y = 0x1a4`（420）。
 * - 上升 @0x004130de：`y -= 速度表[类型]`（`0x475004` = `[15,15,15,15,18,18,18,24,24,24,24,18]`），
 *   受 `[0x48bcc8]` 缩放（`-1` → 速度 ×2、`1` → 速度 ÷2）；
 *   `[0x48bd59] != 0` 时**整屏气球定住**（@0x004130de `jne`）。
 * - 点爆 @0x00414d9f：类型 `>= 6` 的命中框 ±18×±26、`< 6` 的 ±22×±30（跟着两张图的尺寸走）；
 *   点空放音效 20。计分 @0x00414dd2：`9` → 分数 ×2；`10` → 分数 ÷2；
 *   `11` → `rand()%6` 抽一个效果（见 `BALLOON_RANDOM`）；其余 → `分数 += 类型+1`，
 *   `>= 1000` 夹到 **999**。爆掉的那一格类型字写成 `0x3c`（画 2 帧爆开图后消失）。
 * - 时限：定时器 100ms、`[0x48bd2c]` 从 **150**（15 秒）；入场 `[0x48bd84] = 5`（首帧后
 *   从 0x63 改成 5，@0x00414f6b）＝0.5 秒。时间到后等**屏上气球全清**才进结算
 *   （@0x00413229），画大号分数、等 2000ms 关屏。
 *
 * ### 三、財神接金幣（VA 0x004155fc，载入 0x4e/0x4f/0x5c/0x64+角色/0x5d/0x5e/0x5f..0x63）
 * - 底图 = **92**（`push 0x5c` @0x0041566b，无头 RGB555 640×480，`assets-clean` 只落了 `.bin`
 *   → 走 `assets.ts` 的 `loadMinigameBackground` + `minigame-bg.ts` 交接，见 D-MINI-1）。
 * - **財神** = **93**（19 图）在 `(0x48bd4c, 0x7e=126)`，沿楼梯**自动**来回走
 *   （状态机 `0x48bd44`，@0x0041386a 的 5 路跳表 `0x413234`；每帧 ±12px，
 *   `x ∈ [0x6e=110, 0x212=530]`），走到某一帧（`0x48bd40 = rand()%5`）就**撒一个金幣**。
 * - **玩家自己** = **100 + 角色号**（`player+0x13`，@0x00415705）在 `(0x48bd4e, 0x17c=380)`，
 *   **跟着鼠标左右走**（差 > 8 才追，每 tick 追 10px @0x0041364d）。
 * - 掉落物 = **95..99**（`0x48bd14[类型]`，各 8 帧）；**类型 4 = 炸彈**，接到立刻结束
 *   （@0x004133fe → `[0x48bd5a]=1`、`[0x48bd58]=1`）。
 * - 掉落 @0x00412445：`y = 0x64`（100，高处）起，**速度从 −16 每 tick +2**、
 *   到 `y >= 130` 后改用 `0x475010` = `[24,18,15,12,15]`；`y > 0x17c` 判miss。
 *   画的时候按 `scale = 0.5 + (y−130)/250` 缩放（`fcn_004568c2` 的第 6 个参数是**缩放**，
 *   @0x004132bc）—— 远处小、近处大。
 * - 生成 @0x004123d7：`rand()%20` → `<9` 类型 3、`<15` 类型 2、`<18` 类型 1、否则类型 0；
 *   炸彈走另一条（`fcn_004123d7(x, 1)`）。
 * - 炸彈预警 @0x0041378d：財神在**右半**（`x > 320`）时预警落在**左半**
 *   （`warnX = 160 + rand()%140`），反之落在右半（`360 + rand()%140`）；
 *   70% 概率起（`fcn_004123ba` = `rand()%10 < 7`）；警示图 **94** 放 12 帧，
 *   第 8 帧真正生成炸彈。
 * - 计分（`fcn_0041417e` @0x0041449e）：`分数 = 类型1×5 + 类型0×10 + 类型2×3 + 类型3×1`
 *   （计数在 `[0x48bbb4 + 类型*4]`，四个 2 位数字按 0/1/2/3 的顺序摆在 HUD 上）。
 * - 时限：定时器 **50ms**（`SetTimer(…, 0x32, …)` @0x0041500f）、`[0x48bd2c]` 从 **0x168=360**
 *   （= 18 秒）；HUD 显示的是 `[0x48bd2c] >> 1`（@0x0041419b `sar eax,1`）。
 *   入场 `[0x48bd8c] = 10`（@0x004151c1）= 0.5 秒。
 * - 结束后按分数给財神换姿势 @0x0041510e：`<40`→1、`<50`→2、`<60`→0、否则 3；
 *   接到炸彈（`[0x48bd56] == 4`）就跳过姿势。再画大号分数、等 2000ms 关屏。
 *
 * ## 本模块的规矩
 * - 玩法状态机与计分是**模块顶层的纯函数**（`penguinStep` / `balloonStep` / `giftStep` …），
 *   `draw()` 只做 IO —— 单测不碰 canvas（契约见 `ui-screen.ts`）。
 * - 随机数用**本屏自己的** `WatcomRng`（算法与原版 `_libc_rand` 位级一致，见 `core/rng/watcom.ts`），
 *   种子由「对局状态 + 本次开局序号」推出来（见 `minigameSeed`）：**只有分数进 core 才是确定性边界**。
 * - **音效也是「纯函数登记、屏幕放」**：事件点（挖到 / 点爆 / 点空 / 生成 / 落炸彈 …）只往状态的
 *   `sfx: MiniSound[]` 里 `push`，屏幕的 `tick` / `down` 用 `playMiniSounds()` 倒给
 *   `env.playEffect` / `env.stopEffect`。编号 dump 自 exe 的 sound-info 结构（见各常量）。
 * - HUD 数字按**原版的固定位数**画（`drawNumber(..., width)`），分数在所有加/倍分支后统一夹 999。
 * - 有意偏离与解不出的地方见 `docs/deviations/T-042-044.md`（本轮新增的 D-MINI-11/12
 *   另见 `docs/known-deviations.md` 的 2026-09-16 一节）。
 */

import { SPECIAL_KIND, WatcomRng } from '@rich4/core';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';
import type { ArchiveName, Sprite } from './assets.ts';
import { getMinigameBackground } from './minigame-bg.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同签名） */
export type MiniSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 小游戏用的档案 —— 三个屏全在 `Panel.mkf` 里 */
export const MINI_ARCHIVE: ArchiveName = 'Panel.mkf';
/** 数字表 @source 三个入口的 `read_mkf(panel_mkf, 0x4f, 0, 0)` */
export const MINI_FONT_RES = 0x4f;
/**
 * 入场 FLIC @source `read_mkf(panel_mkf, 0x4e, 0, 0)`（D-MINI-3：已接 2026-09-16）。
 *
 * 该资源是**标准 FLIC**（`0078.bin`：`+4` 小端 u16 = `0xaf12`、20 帧、640×480、
 * 每帧 114µs），`env.flic` 直接解得开 —— 不需要任何「剥壳」。
 */
export const MINI_INTRO_FLIC_RES = 0x4e;

/**
 * 等入场影片最多等多久 —— 超过就认命不播（`env.flic` 一直 null 说明资源确实没有）。
 * 异步解码通常几十毫秒就够，2 秒是给慢机器留的余量。
 */
export const MINI_INTRO_GIVE_UP_MS = 2000;
/** 数字的落点 y @source `push 0x1a5`（三个 HUD 函数都一样） */
export const MINI_HUD_Y = 0x1a5;
/** 小号数字的字距 @source `push 0x31 / 0x45 / 0x5e …`，步长 0x14 */
export const MINI_DIGIT_PITCH = 0x14;
/** 大号数字：图号 = 字符 − 0x26（'0' → 图 10）、字距 0x42、居中在 x = 0x161、y = 0x96
 *  @source `fcn_00414789` VA 0x00414789 */
export const MINI_BIG_DIGIT_FIRST = 10;
export const MINI_BIG_PITCH = 0x42;
export const MINI_BIG_CENTER_X = 0x161;
export const MINI_BIG_Y = 0x96;
/** 结算演出停留 @source `fcn_0045285e(0x7d0)`（三屏都是 2000ms） */
export const MINI_END_MS = 2000;
/** 得分上限 @source `cmp edx, 0x3e8 / mov dword [0x48bcec], 0x3e7`（0x00414ece） */
export const MINI_SCORE_CAP = 999;

// ============================================================
//  共用小工具
// ============================================================

/**
 * `[0, n)` 的整数随机 —— 原版写法是 `rand() * n >> 15`
 * （`call _libc_rand / imul eax, ebp / sar eax, 0xf`，@0x00412082、@0x0041301c 等）。
 *
 * 注意与原版 `rand() % n`（`WatcomRng.below`）**不是一回事**：埋寶与选道用前者、
 * 生成类型用后者，两条都照抄，别合并。
 */
function randScale(r: number, n: number): number {
  if (n <= 1) return 0;
  return (r * n) >> 15;
}

/** 从一段状态里推进一次 `rand()`，返回 0..32767 */
function takeRand(holder: { rngState: number }): number {
  const rng = new WatcomRng(holder.rngState);
  const r = rng.next();
  holder.rngState = rng.getState();
  return r;
}

/** `rand() % n`（保留模偏差，照抄原版） */
function randMod(holder: { rngState: number }, n: number): number {
  return takeRand(holder) % n;
}

/** 数字补零成固定宽度（原版 `sprintf("%02d" / "%03d" / "%04d")`） */
function pad(value: number, width: number): string {
  return String(Math.max(0, Math.trunc(value))).padStart(width, '0');
}

// ============================================================
//  音效（纯函数只登记，屏幕的 tick/down 才真的放）
// ============================================================

/**
 * 一条**待播**的音效。
 *
 * ★ 玩法状态机是**纯函数**（不碰 IO），所以事件点只把音效**登记**进状态的
 *   `sfx` 列表；屏幕的 `tick` / `down` 收集完再倒给 `env.playEffect` /
 *   `env.stopEffect`（`playMiniSounds`）。原版是在事件点直接
 *   `_rich4_play_sound_effect(flags, &info)`，编号取 sound-info 结构的
 *   第一个 dword（dump 自 exe）。
 */
export interface MiniSound {
  /** `Effect.mkf` 资源号 */
  id: number;
  /** true = 循环（原版 `flags = 1` = `DSBPLAY_LOOPING`）*/
  loop?: boolean;
  /** true = 停掉这一路（原版 `fcn_004542e9`）*/
  stop?: boolean;
}

/** 企鵝：挖掘中的**循环**音 @source sound-info `0x475057` = **11**（起 0x00414b51 flags=1）*/
export const PENGUIN_DIG_SOUND = 11;
/** 企鵝：走到定点那一下 @source `0x47505f` = **12**，0x004127ed（先 `fcn_004542e9(11)`）*/
export const PENGUIN_ARRIVE_SOUND = 12;
/** 企鵝：结算姿势（分数 > 0x37）@source `0x475067` = **13**，0x004149e8 flags=1 */
export const PENGUIN_END_HI_SOUND = 13;
/** 企鵝：结算姿势（分数 < 0x28）@source `0x47506f` = **14**，0x004149de flags=1 */
export const PENGUIN_END_LO_SOUND = 14;
/**
 * 企鵝：挖到寶物的音（按**类型**）。
 *
 * @source 类型 1 走 `loc_004129ab` → `0x47508f` = **15**；
 *   类型 2..5 走 `loc_004129c4` 的查表 `0x475051[类型]`：
 *   `[00,00,04,05,05,06]` × 8 + `0x475057` → `0x475057/77/7f/7f/87`
 *   = **16 / 17 / 17 / 18**。类型 0（空地）不放音。
 */
export const PENGUIN_LOOT_SOUND: readonly number[] = [11, 15, 16, 17, 17, 18];
/** 七彩氣球：生成 @source `0x47509f` = **19**，0x00413077 */
export const BALLOON_SPAWN_SOUND = 19;
/** 七彩氣球：点空 @source `0x4750a7` = **20**，0x00414f0d */
export const BALLOON_MISS_SOUND = 20;
/** 七彩氣球：点爆 @source `0x4750af` = **21**，0x00414dd2 那一段前面 */
export const BALLOON_POP_SOUND = 21;
/** 財神：炸彈落下的那一声 @source `0x4750bf` = **22**，0x00413809 flags=0 */
export const GIFT_BOMB_SOUND = 22;
/** 財神：炸彈下落的**循环**哨音 @source `0x4750cf` = **24**，0x00413809 flags=1；接到/落地停 */
export const GIFT_BOMB_LOOP_SOUND = 24;
/** 財神：炸彈爆炸 @source `0x4750d7` = **15**，0x00413436（接到的分支，紧接在停 24 之后）*/
export const GIFT_BOOM_SOUND = 15;

/**
 * 把攒下的待播音效倒给屏幕出口，倒完清空（同一批不会重播）。
 *
 * ★ 屏幕的 `tick` 一帧可能推好几个 tick，事件点也就在纯函数里 —— 所以
 *   纯函数只 `push`，这里统一 `playEffect` / `stopEffect`。
 */
export function playMiniSounds(
  env: Pick<UiScreenEnv, 'playEffect' | 'stopEffect'>,
  sfx: MiniSound[],
): void {
  for (const ev of sfx) {
    if (ev.stop === true) env.stopEffect(ev.id);
    else env.playEffect(ev.id, ev.loop === true);
  }
  sfx.length = 0;
}

/** 通用命中框 */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function inBox(x: number, y: number, b: Box): boolean {
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

// ============================================================
//  一、企鵝挖寶（specialKind 6）—— 状态机与计分
// ============================================================

/** 底板 / 光标 / 冰屋 / 寶物图标 @source `read_mkf(panel_mkf, 0x50, 0, 0)` @0x00415253 */
export const PENGUIN_RES = 0x50;
/** 走行（8 向 × 4 帧）@source `push 0x52` @0x0041526f */
export const PENGUIN_WALK_RES = 0x52;
/** 挖掘（8 向 × 4 帧）@source `push 0x53` @0x0041527e */
export const PENGUIN_DIG_RES = 0x53;
/** 结算动画（分数 > 55）@source `push 0x54` @0x004152a4 */
export const PENGUIN_END_HI_RES = 0x54;
/** 结算动画（分数 < 40）@source `push 0x55` @0x00415295 */
export const PENGUIN_END_LO_RES = 0x55;
/** 五种寶物各自的「挖到」动画（6 帧）@source `read_mkf(panel_mkf, ebx + 0x56, …)` @0x0041531e */
export const PENGUIN_LOOT_RES: readonly number[] = [0x56, 0x57, 0x58, 0x59, 0x5a];
/** 寶物图标 = 图 `类型 + 3` @source `lea edx, [eax + 3]` @0x0041467f */
export const PENGUIN_ICON_FIRST = 3;
/** 冰屋图 = 图 3，落点固定 @source `push 0xe1 / push 0x140` @0x00412cbf（见 D-MINI-8）*/
export const PENGUIN_IGLOO = { x: 0x140, y: 0xe1, image: 3 } as const;
/** 格子是菱形：半宽 48、半高 24（量自命中表 #81，格心 = 表里的 x/y） */
export const PENGUIN_TILE = { halfW: 48, halfH: 24 } as const;
/**
 * 9×9 格心坐标 `(x, y)` @source VA 0x00474d7c（每格 8 字节 `{int16 x, int16 y, uint16, uint16}`，
 * 这里只要前两个字段；`(0,0)` = 不在棋盘上 —— 原版判据就是 `word[+0] == 0` @0x0041211c）。
 */
export const PENGUIN_CELL_XY: readonly number[] = [
  0, 0, 0, 0, 0, 0, 80, 153, 128, 129, 176, 105, 224, 81, 0, 0, 0, 0,
  0, 0, 32, 225, 80, 201, 128, 177, 176, 153, 224, 129, 272, 105, 320, 81, 0, 0,
  0, 0, 80, 249, 128, 225, 176, 201, 224, 177, 272, 153, 320, 129, 368, 105, 416, 81,
  80, 297, 128, 273, 176, 249, 224, 225, 272, 201, 320, 177, 368, 153, 416, 129, 464, 105,
  128, 321, 176, 297, 224, 273, 272, 249, 0, 0, 368, 201, 416, 177, 464, 153, 512, 129,
  176, 345, 224, 321, 272, 297, 320, 273, 368, 249, 416, 225, 464, 201, 512, 177, 560, 153,
  224, 369, 272, 345, 320, 321, 368, 297, 416, 273, 464, 249, 512, 225, 560, 201, 0, 0,
  0, 0, 320, 369, 368, 345, 416, 321, 464, 297, 512, 273, 560, 249, 608, 225, 0, 0,
  0, 0, 0, 0, 416, 369, 464, 345, 512, 321, 560, 297, 0, 0, 0, 0, 0, 0,
];
/** 棋盘格数（索引上限） */
export const PENGUIN_CELLS = 81;
/** 每个类型的埋藏个数 @source `ref_00411fc8` VA 0x00411fc8 = `[3, 12, 3, 9, 1]` */
export const PENGUIN_TREASURE_COUNT: readonly number[] = [3, 12, 3, 9, 1];
/** 有效格数（`x != 0` 的格）—— 也是原版埋寶时 `ebp` 的初值 0x40 @0x0041530f */
export const PENGUIN_VALID_CELLS = 64;
/**
 * 计分权重（**按类型**）：`分数 = c[5]×20 + c[3]×12 + c[4]×8 + c[2]×5`
 * @source `fcn_00413a4a` VA 0x00413d6a：`bb c0×20 + bb b8×12 + bb bc×8 + bb b4×5`
 *   —— HUD 读的四个计数器正好是类型 5 / 3 / 4 / 2（计数在 `[0x48bbac + 类型*4]` @0x004129fc）。
 *   类型 1 的权重是 0（0x004129ab 只播一个音）。
 */
export const PENGUIN_VALUE: readonly number[] = [0, 0, 5, 12, 8, 20];
/** 定时器 100ms @source `push 0x64` 的 `SetTimer` @0x004148b9 */
export const PENGUIN_TICK_MS = 100;
/** 入场 tick 数 @source `mov dword [0x48bd7c], 0xa` @0x004148b1 */
export const PENGUIN_INTRO_TICKS = 10;
/** 游戏 tick 数 @source `mov dword [0x48bd2c], 0x96` @0x004148ab */
export const PENGUIN_PLAY_TICKS = 0x96;
/** 结算姿势的分数线 @source `cmp ecx, 0x28 / 0x37` @0x00414986 */
export const PENGUIN_END_LO_SCORE = 0x28;
export const PENGUIN_END_HI_SCORE = 0x37;
/** 单格走行/挖掘的子帧数 @source `test byte [0x48bcc4], 3` @0x00412651 */
export const PENGUIN_SUB_FRAMES = 4;
/** 开局时企鵝在哪一格 @source `[0x48bd04] = 0x20000 (列 2)`、`[0x48bd08] = 0x60000 (行 6)` @0x004148a2 */
export const PENGUIN_START_COL = 2;
export const PENGUIN_START_ROW = 6;

/** 第 `i` 格的格心 x（无效格返回 0） */
export function penguinCellX(i: number): number {
  return PENGUIN_CELL_XY[i * 2] ?? 0;
}

/** 第 `i` 格的格心 y（无效格返回 0） */
export function penguinCellY(i: number): number {
  return PENGUIN_CELL_XY[i * 2 + 1] ?? 0;
}

/** 这一格在不在棋盘上 @source `word[+0x474d7c] != 0` @0x0041211c */
export function penguinCellValid(i: number): boolean {
  return i >= 0 && i < PENGUIN_CELLS && penguinCellX(i) !== 0;
}

/**
 * 命中：这一下点在哪一格上；不在棋盘上返回 `null`。
 *
 * 原版是拿 **命中表 #81** 的像素值当格号（@0x00414abe `mov cl, byte [ecx + ebx]; idiv 9`）。
 * 本模块拿不到那张 `.bin`（D-MINI-2），改用格心 + 菱形几何反推：
 * 每格是以格心为中心、半宽 48 / 半高 24 的菱形，拼起来正好铺满棋盘
 * （相邻格心相距 `(48, ±24)`，两张 96×48 的菱形严丝合缝）。与 #81 逐像素比对：
 * **64 个有效格的格心像素值都等于它的格号**，菱形尺寸也是从同一张图量出来的。
 */
export function penguinHitCell(mx: number, my: number): number | null {
  const { halfW, halfH } = PENGUIN_TILE;
  for (let i = 0; i < PENGUIN_CELLS; i++) {
    if (!penguinCellValid(i)) continue;
    const dx = Math.abs(mx - penguinCellX(i));
    const dy = Math.abs(my - penguinCellY(i));
    if (dx * halfH + dy * halfW <= halfW * halfH) return i;
  }
  return null;
}

/**
 * 埋寶 @source `fcn_00412014` VA 0x00412014：五轮（每轮 `PENGUIN_TREASURE_COUNT[轮]` 个），
 * 每次在**剩余空格**里抽第 `rand()*ebp>>15` 个（`ebp` 从 64 每埋一个减 1）。
 *
 * @returns 81 字节：0 = 空，1..5 = 寶物类型
 */
export function penguinPlaceTreasures(rngState: number): { board: Uint8Array; rngState: number } {
  const holder = { rngState: rngState >>> 0 };
  const board = new Uint8Array(PENGUIN_CELLS);
  let free = PENGUIN_VALID_CELLS;
  for (let level = 0; level < PENGUIN_TREASURE_COUNT.length; level++) {
    const count = PENGUIN_TREASURE_COUNT[level] ?? 0;
    for (let k = 0; k < count; k++) {
      const pick = randScale(takeRand(holder), free);
      let seen = 0;
      for (let i = 0; i < PENGUIN_CELLS; i++) {
        if (!penguinCellValid(i) || board[i] !== 0) continue;
        if (seen === pick) {
          board[i] = level + 1;
          break;
        }
        seen++;
      }
      free = Math.max(0, free - 1);
    }
  }
  return { board, rngState: holder.rngState };
}

/** 计分 @source `fcn_00413a4a` @0x00413d6a —— `counts` 按类型下标（1..5） */
export function penguinScore(counts: readonly number[]): number {
  let sum = 0;
  for (let t = 1; t < PENGUIN_VALUE.length; t++) sum += (counts[t] ?? 0) * (PENGUIN_VALUE[t] ?? 0);
  return sum;
}

/** 走行的朝向（0..7）@source `loc_00412651` VA 0x00412651 的四条分支 */
export function penguinDir(dcol: number, drow: number): number {
  if (dcol > 0) return (3 - drow) & 7;
  if (dcol === 0) return drow > 0 ? 1 : 5;
  return (drow + 7) & 7;
}

export type PenguinPhase = 'intro' | 'play' | 'end' | 'score';

export interface PenguinGame {
  rngState: number;
  /** 81 字节：0 = 空，1..5 = 类型 */
  board: Uint8Array;
  /** 土堆还画不画（原版靠「背景重贴脏矩形」把走过的格擦掉，见 D-MINI-6） */
  mound: Uint8Array;
  /** 已经挖过的格 */
  dug: Uint8Array;
  /** 各类型的挖到个数（下标 = 类型） */
  counts: number[];
  /** 企鵝当前所在格 */
  cell: number;
  /** 正走向的下一格；`null` = 站住 */
  to: number | null;
  /** 玩家点的最终目标格；`null` = 没有 */
  target: number | null;
  /** 子帧 0..3（`[0x48bcc4] & 3`）*/
  sub: number;
  /** 朝向 0..7（`[0x48bcc4] >> 4`）*/
  dir: number;
  /** 挖掘剩余 tick（>0 表示正在挖）*/
  dig: number;
  /** 刚挖到的动画 */
  loot: { cell: number; type: number; frame: number } | null;
  /** 结算姿势：`hi` = 资源 84、`lo` = 资源 85、`mid` = 只重画光标 */
  endPose: 'hi' | 'lo' | 'mid';
  /** 结算动画帧 */
  endFrame: number;
  phase: PenguinPhase;
  /** 剩余游戏 tick @0x48bd2c */
  ticks: number;
  /** 剩余入场 tick @0x48bd7c */
  intro: number;
  /** 大号分数显示的截止时刻（`env.now` 基准）*/
  scoreUntil: number;
  /** 待播音效（纯函数登记、屏幕的 `playMiniSounds` 倒出去）*/
  sfx: MiniSound[];
}

/** 结算动画每轮几帧（84 = 8、85 = 6、`mid` 只重画 1 张）*/
export const PENGUIN_END_FRAMES = { hi: 8, lo: 6, mid: 1 } as const;
/** 结算动画跑几轮 @source 高位到 4 就收 @0x00412a87 / @0x00412b2c */
export const PENGUIN_END_LOOPS = 4;

/** 开局 @param seed 本屏自己的 PRNG 种子 */
export function penguinStart(seed: number): PenguinGame {
  const placed = penguinPlaceTreasures(seed >>> 0);
  const board = placed.board;
  const mound = new Uint8Array(PENGUIN_CELLS);
  for (let i = 0; i < PENGUIN_CELLS; i++) mound[i] = board[i] === 0 ? 0 : 1;
  return {
    rngState: placed.rngState,
    board,
    mound,
    dug: new Uint8Array(PENGUIN_CELLS),
    counts: [0, 0, 0, 0, 0, 0],
    cell: PENGUIN_START_ROW * 9 + PENGUIN_START_COL,
    to: null,
    target: null,
    sub: 0,
    dir: 0,
    dig: 0,
    loot: null,
    endPose: 'mid',
    endFrame: 0,
    phase: 'intro',
    ticks: PENGUIN_PLAY_TICKS,
    intro: PENGUIN_INTRO_TICKS,
    scoreUntil: 0,
    sfx: [],
  };
}

/** 点一下：把目标格交给企鵝走 @source 鼠标分支 0x00414abe → `fcn_0041211c` */
export function penguinClick(st: PenguinGame, mx: number, my: number): PenguinGame {
  if (st.phase !== 'play') return st;
  const cell = penguinHitCell(mx, my);
  if (cell === null || cell === st.cell) return st;
  if (st.to !== null || st.dig > 0) return st; // 正在走/正在挖，原版也不会改目标
  return { ...st, target: cell, to: nextCellToward(st.cell, cell), sub: 0 };
}

/**
 * 从 `from` 朝 `to` 走**一格**。
 *
 * 原版走的是 (列, 行) 上的**直线**：主轴每帧 1 格、副轴按 `drow<<16 / |dcol|` 的定点步进
 * （@0x0041211c / @0x00412287），下一格若不是有效格就把那一条轴停住。这里直接按整数格推，
 * 结论一致（D-MINI-6）。
 */
export function nextCellToward(from: number, to: number): number | null {
  const fc = from % 9;
  const fr = Math.floor(from / 9);
  const dc = Math.sign((to % 9) - fc);
  const dr = Math.sign(Math.floor(to / 9) - fr);
  const tryStep = (sc: number, sr: number): number | null => {
    const c = fc + sc;
    const r = fr + sr;
    if (c < 0 || c > 8 || r < 0 || r > 8) return null;
    const cell = r * 9 + c;
    return penguinCellValid(cell) ? cell : null;
  };
  const both = tryStep(dc, dr);
  if (both !== null && both !== from) return both;
  const onlyC = tryStep(dc, 0);
  if (onlyC !== null && onlyC !== from) return onlyC;
  const onlyR = tryStep(0, dr);
  if (onlyR !== null && onlyR !== from) return onlyR;
  return null;
}

/** 挖开一格 @source `loc_00412851` 的尾巴 0x00412925：读数 → 计数 → 播「挖到」动画 */
function penguinReveal(st: PenguinGame, cell: number): PenguinGame {
  const type = st.board[cell] ?? 0;
  const dug = st.dug.slice();
  dug[cell] = 1;
  // ★ 挖完了：停掉「挖掘中」的循环音 11（@source 0x004127ed `fcn_004542e9(0x475057)`）
  st.sfx.push({ id: PENGUIN_DIG_SOUND, stop: true });
  if (type === 0) return { ...st, dug, dig: 0 };
  // ★ 挖到寶物：按类型放音 @source 0x004129ab（类型 1 → 15）/ 0x004129c4 的查表
  st.sfx.push({ id: PENGUIN_LOOT_SOUND[type] ?? PENGUIN_LOOT_SOUND[1] ?? 15 });
  const counts = st.counts.slice();
  counts[type] = (counts[type] ?? 0) + 1;
  return { ...st, dug, counts, dig: 0, loot: { cell, type, frame: 0 } };
}

/** 结算姿势的循环音：`hi` → 13、`lo` → 14、`mid` → 没有 @source 0x004149de / 0x004149e8 */
function penguinPoseSound(pose: PenguinGame['endPose']): number | null {
  return pose === 'hi' ? PENGUIN_END_HI_SOUND : pose === 'lo' ? PENGUIN_END_LO_SOUND : null;
}

/** 停掉还没放完的姿势循环音 @source 0x00412a87 / 0x00412b2c */
function stopPoseSound(st: PenguinGame): void {
  const id = penguinPoseSound(st.endPose);
  if (id !== null) st.sfx.push({ id, stop: true });
}

/**
 * 推进一个 tick（100ms）。
 * @param now `env.now`，只有「结算演出」用得到
 */
export function penguinStep(st: PenguinGame, now: number): PenguinGame {
  if (st.phase === 'intro') {
    const intro = st.intro - 1;
    return intro > 0 ? { ...st, intro } : { ...st, intro: 0, phase: 'play' };
  }
  if (st.phase === 'end') {
    const frame = st.endFrame + 1;
    if (frame >= PENGUIN_END_FRAMES[st.endPose] * PENGUIN_END_LOOPS) {
      // ★ 姿势动画放完 → 停掉循环的姿势音 @source 0x00412a87 / 0x00412b2c
      stopPoseSound(st);
      return { ...st, phase: 'score', scoreUntil: now + MINI_END_MS };
    }
    return { ...st, endFrame: frame };
  }
  if (st.phase === 'score') return st;

  const ticks = st.ticks - 1;
  if (ticks <= 0) {
    // 时间到 @0x00414986：按分数挑结算动画（`and [0x48bcc4], 0xf00` 也在这里）
    const score = penguinScore(st.counts);
    const endPose: PenguinGame['endPose'] =
      score < PENGUIN_END_LO_SCORE ? 'lo' : score > PENGUIN_END_HI_SCORE ? 'hi' : 'mid';
    // ★ 收尾音：先停挖掘循环（@0x004149c4 `fcn_004542e9(0x475057)`），
    //   再按姿势放循环的 14（< 40，@0x004149de）/ 13（> 55，@0x004149e8），
    //   中间那一档（40..55）不放音（@0x00414a00 只写状态 6）。
    st.sfx.push({ id: PENGUIN_DIG_SOUND, stop: true });
    if (endPose === 'hi') st.sfx.push({ id: PENGUIN_END_HI_SOUND, loop: true });
    else if (endPose === 'lo') st.sfx.push({ id: PENGUIN_END_LO_SOUND, loop: true });
    return { ...st, ticks: 0, phase: 'end', endPose, endFrame: 0, to: null, target: null, dig: 0 };
  }

  const next: PenguinGame = { ...st, ticks };
  // ── 挖到动画（86..90，各 6 帧）──
  if (next.loot !== null) {
    const lootFrame = next.loot.frame + 1;
    next.loot = lootFrame >= 6 ? null : { ...next.loot, frame: lootFrame };
  }
  // ── 正在挖 ──
  if (next.dig > 0) {
    next.dig -= 1;
    if (next.dig === 0) return penguinReveal(next, next.cell);
    return next;
  }
  // ── 走向下一格 ──
  if (next.to !== null) {
    const sub = next.sub + 1;
    if (sub < PENGUIN_SUB_FRAMES) return { ...next, sub };
    const arrived = next.to;
    const fc = arrived % 9;
    const fr = Math.floor(arrived / 9);
    const mound = next.mound.slice();
    mound[arrived] = 0; // 走过就把土堆擦掉（原版重贴脏矩形 = D-MINI-6）
    const target = next.target;
    const step = target === null || target === arrived ? null : nextCellToward(arrived, target);
    if (step === null) {
      // ★ 到定点了：放「走到定点」的 12（@source 0x004127ed），再起挖掘循环音 11
      //   （@source 0x00414b51 `play_sound_effect(flags=1, 0x475057)`）。
      //   两条都在同一拍 —— 本引擎把「走到」与「开挖」合成了一步（见 D-MINI-6）。
      next.sfx.push({ id: PENGUIN_ARRIVE_SOUND });
      next.sfx.push({ id: PENGUIN_DIG_SOUND, loop: true });
      return { ...next, cell: arrived, to: null, target: null, sub: 0, mound, dig: PENGUIN_SUB_FRAMES };
    }
    const sc = step % 9;
    const sr = Math.floor(step / 9);
    return {
      ...next,
      cell: arrived,
      to: step,
      sub: 0,
      mound,
      dir: penguinDir(sc - fc, sr - fr),
    };
  }
  return next;
}

// ============================================================
//  二、七彩氣球（specialKind 7）—— 状态机与计分
// ============================================================

/** 底图 / 气球 / 爆开 @source `read_mkf(panel_mkf, 0x5b, 0, 0)` @0x004155b3 */
export const BALLOON_RES = 0x5b;
/** 气球图 = 图 `类型 + 1` @source `loc_0041311b` 的 `lea edx, [eax + 1]` */
export const BALLOON_IMAGE_FIRST = 1;
/** 爆开图 = 图 13（类型字被改写成 0x3c → `(0x3c & 0xf) + 1`）@source `mov word […], 0x3c` @0x00414ef7 */
export const BALLOON_POP_IMAGE = 13;
/** 16 个槽 @source `cmp ebx, 0x10` @0x00414f1d */
export const BALLOON_SLOTS = 16;
/** 生成高度 @source `mov word [… + 0x48bbc6], 0x1a4` @0x0041310f */
export const BALLOON_SPAWN_Y = 0x1a4;
/** 道 x：`0x28 + 0x50k`，`< 0x280` @0x0041301c */
export const BALLOON_LANES: readonly number[] = [0x28, 0x78, 0xc8, 0x118, 0x168, 0x1b8, 0x208];
/** 判定「这条道有气球」的高度 @source `cmp word [… + 0x48bc46], 0x12c` @0x00413036 */
export const BALLOON_LANE_BUSY_Y = 0x12c;
/** 上升速度表（按类型）@source `ref_00475004` VA 0x00475004 */
export const BALLOON_SPEED: readonly number[] = [15, 15, 15, 15, 18, 18, 18, 24, 24, 24, 24, 18];
/** 稀有类型的取值表 @source `ref_00475039` VA 0x00475039 */
export const BALLOON_RARE_TYPES: readonly number[] = [9, 9, 10, 10, 10, 10, 10, 11, 11, 11];
/**
 * 命中框（半宽 / 半高）@source `loc_00414f26`：
 * 类型 `< 6` 用 `(0x16, 0x1e)`、`>= 6` 用 `(0x12, 0x1a)`。
 */
export const BALLOON_HIT_HALF = { tall: { x: 0x16, y: 0x1e }, short: { x: 0x12, y: 0x1a } } as const;
/**
 * 出屏判据用的图高与锚点（原版是「`fcn_004562a5` 一点都没画出来」@0x00413170 → 置空）。
 * 数据来自 `Panel.mkf` #91：图 1..6 = 44×141 锚点 (22,30)、图 7..12 = 36×116 锚点 (18,26)、
 * 图 13（爆开）= 60×122 锚点 (28,40)。
 */
export const BALLOON_SPRITE = {
  tall: { h: 141, ay: 30 },
  short: { h: 116, ay: 26 },
  pop: { h: 122, ay: 40 },
} as const;
/** 定时器 100ms @source `push 0x64` 的 `SetTimer` @0x00414c1d */
export const BALLOON_TICK_MS = 100;
/** 入场 tick 数 @source `[0x48bd84] = 0x63`，首帧改成 5 @0x00414f6b */
export const BALLOON_INTRO_TICKS = 5;
/** 游戏 tick 数 @source `mov dword [0x48bd2c], 0x96` @0x00414c11 */
export const BALLOON_PLAY_TICKS = 0x96;
/** 类型 11 的六个效果 @source 跳表 `ref_00414ba4` VA 0x00414ba4 + `rand()%6` */
export const BALLOON_RANDOM = {
  endSoon: 0,
  freeze: 1,
  speedUp: 2,
  speedDown: 3,
  zero: 4,
  double: 5,
} as const;
/** 冻结 tick 数 @source `mov byte [0x48bd59], 0x14` @0x00414e99 */
export const BALLOON_FREEZE_TICKS = 0x14;
/** 爆开图停留几帧 @source 类型字 0x3c 每 tick 减 0x10，高位归零就置空 @0x004130b6 */
export const BALLOON_POP_TICKS = 2;

export interface Balloon {
  /** 0 = 空槽 */
  x: number;
  y: number;
  /** 类型 0..11 */
  type: number;
  /** 剩余爆开帧（>0 表示已爆，画 `BALLOON_POP_IMAGE`）*/
  popped: number;
}

export type BalloonPhase = 'intro' | 'play' | 'ending' | 'score';

export interface BalloonGame {
  rngState: number;
  balloons: Balloon[];
  score: number;
  /** 剩余游戏 tick @0x48bd2c */
  ticks: number;
  /** 剩余入场 tick @0x48bd84 */
  intro: number;
  /** 定住计数 @0x48bd59（>0 气球全不动）*/
  freeze: number;
  /** 速度倍率 @0x48bcc8：`-1` = ×2、`0` = ×1、`1` = ÷2 */
  speed: number;
  phase: BalloonPhase;
  scoreUntil: number;
  /** 待播音效（纯函数登记、屏幕的 `playMiniSounds` 倒出去）*/
  sfx: MiniSound[];
}

export function balloonStart(seed: number): BalloonGame {
  const balloons: Balloon[] = [];
  for (let i = 0; i < BALLOON_SLOTS; i++) balloons.push({ x: 0, y: 0, type: 0, popped: 0 });
  return {
    rngState: seed >>> 0,
    balloons,
    score: 0,
    ticks: BALLOON_PLAY_TICKS,
    intro: BALLOON_INTRO_TICKS,
    freeze: 0,
    speed: 0,
    phase: 'intro',
    scoreUntil: 0,
    sfx: [],
  };
}

/** 点爆命中框 @source `loc_00414dec`：`x ± 半宽`、`y ± 半高`（含端点）*/
export function balloonHit(balloon: Balloon, mx: number, my: number): boolean {
  if (balloon.x === 0 || balloon.popped > 0) return false;
  const half = balloon.type >= 6 ? BALLOON_HIT_HALF.short : BALLOON_HIT_HALF.tall;
  return inBox(mx, my, {
    x0: balloon.x - half.x,
    y0: balloon.y - half.y,
    x1: balloon.x + half.x,
    y1: balloon.y + half.y,
  });
}

/** 这一类型的气球出屏了没有（原版是「贴图一点都没画出来」@0x00413170）*/
export function balloonOffscreen(b: Balloon): boolean {
  const s =
    b.popped > 0 ? BALLOON_SPRITE.pop : b.type >= 6 ? BALLOON_SPRITE.short : BALLOON_SPRITE.tall;
  return b.y - s.ay + s.h <= 0;
}

/** 点一下：把所有被点到的气球爆掉并计分 @source `loc_00414d9f` / `loc_00414dd2` */
export function balloonClick(st: BalloonGame, mx: number, my: number): BalloonGame {
  if (st.phase !== 'play') return st;
  const holder = { rngState: st.rngState };
  let score = st.score;
  const balloons = st.balloons.map((b) => ({ ...b }));
  let freeze = st.freeze;
  let speed = st.speed;
  let ticks = st.ticks;
  for (const b of balloons) {
    if (b.x === 0) continue; // 空槽不参与（原版 `cmp word […], 0 / je` @0x00414f26）
    if (!balloonHit(b, mx, my)) {
      // 点空 → 20 @source `loc_00414f0d`（原版对**每一个没被打中的气球**都放一次）
      st.sfx.push({ id: BALLOON_MISS_SOUND });
      continue;
    }
    // 打中 → 21 @source `loc_00414dd2` 那一段前面（命中框通过就放）
    st.sfx.push({ id: BALLOON_POP_SOUND });
    // @0x00414dd2：类型 → 分数
    if (b.type === 9) {
      score *= 2;
    } else if (b.type === 10) {
      score = Math.trunc(score / 2);
    } else if (b.type === 11) {
      const roll = randMod(holder, 6);
      if (roll === BALLOON_RANDOM.endSoon) {
        ticks = 1;
      } else if (roll === BALLOON_RANDOM.freeze) {
        freeze = BALLOON_FREEZE_TICKS;
      } else if (roll === BALLOON_RANDOM.speedUp) {
        speed = -1;
      } else if (roll === BALLOON_RANDOM.speedDown) {
        speed = 1;
      } else if (roll === BALLOON_RANDOM.zero) {
        score = 0;
      } else {
        score *= 2;
      }
    } else {
      score += b.type + 1;
    }
    b.popped = BALLOON_POP_TICKS; // 类型字 0x3c @0x00414ef7
  }
  // ★ 上限 999 在**所有**加/倍分支之后统一夹一次 —— 原版只在普通那支
  //   （`loc_00414ece`：`cmp edx,0x3e8 / jl` → `0x3e7`）夹，×2 那一支
  //   （`loc_00414ebe`）不夹；但原版 HUD `fcn_00413f07` 只画 4 个字符，多出来的位
  //   根本画不到框外。本引擎按固定宽度画，所以把同一道夹子搬到这里 ——
  //   见 `docs/known-deviations.md` 的 D-MINI-12。
  if (score >= 1000) score = MINI_SCORE_CAP;
  return { ...st, balloons, score, freeze, speed, ticks, rngState: holder.rngState };
}

/** 推进一个 tick @source `loc_00414c69`（定时器）+ `fcn_00412f6f`（气球更新） */
export function balloonStep(st: BalloonGame, now: number): BalloonGame {
  if (st.phase === 'intro') {
    const intro = st.intro - 1;
    return intro > 0 ? { ...st, intro } : { ...st, intro: 0, phase: 'play' };
  }
  if (st.phase === 'score') return st;

  const holder = { rngState: st.rngState };
  let freeze = st.freeze;
  if (freeze > 0) freeze -= 1;
  let ticks = st.ticks;
  if (st.phase === 'play') ticks = Math.max(0, ticks - 1);
  const playing = st.phase === 'play' && ticks > 0;
  const balloons = st.balloons.map((b) => ({ ...b }));
  let anyActive = false;

  for (const b of balloons) {
    if (b.x === 0) {
      // 空槽：还在玩就掷一次生成 @0x00413189
      if (!playing) continue;
      const roll = randMod(holder, 1000);
      let type: number;
      if (roll < 20) type = roll >> 2;
      else if (roll < 28) type = ((27 - roll) >> 1) + 5;
      else if (roll < 30) type = BALLOON_RARE_TYPES[randMod(holder, 10)] ?? 9;
      else continue;
      // 挑一条没有气球挡着的道（`y > 0x12c` 才算挡）
      const free: number[] = [];
      for (const lane of BALLOON_LANES) {
        const busy = balloons.some((o) => o.x === lane && o.y > BALLOON_LANE_BUSY_Y);
        if (!busy) free.push(lane);
      }
      if (free.length === 0) continue;
      const lane = free[randMod(holder, free.length)];
      if (lane === undefined) continue;
      b.x = lane;
      b.y = BALLOON_SPAWN_Y;
      b.type = type;
      b.popped = 0;
      // ★ 生成一个气球 → 19 @source 0x00413077（`push 0 / push 0x47509f`）
      st.sfx.push({ id: BALLOON_SPAWN_SOUND });
      anyActive = true;
      continue;
    }
    if (b.popped > 0) {
      b.popped -= 1;
      if (b.popped > 0) anyActive = true;
      else b.x = 0;
      continue;
    }
    if (freeze === 0) {
      // @0x004130de：冻住时整屏不升
      const base = BALLOON_SPEED[b.type] ?? 15;
      const step = st.speed === -1 ? base * 2 : st.speed === 1 ? Math.trunc(base / 2) : base;
      b.y -= step;
    }
    if (balloonOffscreen(b)) {
      b.x = 0;
      continue;
    }
    anyActive = true;
  }

  let phase: BalloonPhase = st.phase === 'play' && ticks === 0 ? 'ending' : st.phase;
  // @0x00413229：时间到 + 屏上没气球了 → 结算
  if (phase === 'ending' && !anyActive) phase = 'score';
  // 刚进结算那一刻才起算「大号分数停留 2000ms」（`fcn_0045285e(0x7d0)`）
  const justScored = st.phase !== 'ending' && phase === 'score';

  return {
    rngState: holder.rngState,
    balloons,
    score: st.score,
    ticks,
    intro: 0,
    freeze,
    speed: st.speed,
    phase,
    scoreUntil: justScored ? now + MINI_END_MS : st.scoreUntil,
    sfx: st.sfx,
  };
}

// ============================================================
//  三、財神接金幣 / 喜從天降（specialKind 8）—— 状态机与计分
// ============================================================

/** 底图 @source `read_mkf(panel_mkf, 0x5c, 0, 0)` @0x0041566b（存入 `[0x48bd38]`）
 *  ★ 它是**无头 640×480 RGB555**，`sprite()` 取不到 —— 由 `minigame-bg.ts` 交接
 *    （`assets.ts` 的 `loadMinigameBackground`），见 D-MINI-1 */
export const GIFT_RES = 0x5c;
/** 財神 @source `read_mkf(panel_mkf, 0x5d, 0, 0)` @0x0041573c */
export const GIFT_GOD_RES = 0x5d;
/** 炸彈预警 @source `read_mkf(panel_mkf, 0x5e, 0, 0)` @0x00415761 */
export const GIFT_WARN_RES = 0x5e;
/** 掉落物（0..3 = 金幣…元寶、4 = 炸彈）@source `read_mkf(panel_mkf, ebx + 0x5f, …)` @0x004156e5 */
export const GIFT_ITEM_RES: readonly number[] = [0x5f, 0x60, 0x61, 0x62, 0x63];
/** 玩家自己 = `100 + 角色号` @source `add eax, 0x64` @0x00415705 */
export const GIFT_CATCHER_RES_FIRST = 0x64;
/** 財神的落点 y @source `push 0x7e` @0x0041359b */
export const GIFT_GOD_Y = 0x7e;
/** 预警的落点 y @source `push 0x7d` @0x0041357a */
export const GIFT_WARN_Y = 0x7d;
/** 玩家的落点 y @source `push 0x17c` @0x004136f0 */
export const GIFT_CATCHER_Y = 0x17c;
/** 財神左右端点 @source `0x6e` / `0x212` @0x004139e4 / @0x004138e7 */
export const GIFT_GOD_X_MIN = 0x6e;
export const GIFT_GOD_X_MAX = 0x212;
/** 转折中线 @source `0x140` @0x004138c7 */
export const GIFT_MID_X = 0x140;
/** 每 tick 走的像素 @source `add word [0x48bd4c], 0xc` @0x004138b3 */
export const GIFT_GOD_STEP = 0xc;
/** 玩家追鼠标：差 > 8 才动、每 tick 10px @source `cmp esi, 8` / `0xa` @0x00413610 */
export const GIFT_CATCH_DEADZONE = 8;
export const GIFT_CATCH_STEP = 0xa;
/** 角色走行每方向 10 帧 @source `(图数 − 5) / 2` @0x0041578b */
export const GIFT_CATCHER_FRAMES = 10;
/** 財神的图号表（每行 10 个，行 = `[0x48bd44]`、列 = `[0x48bd46]`）@source `ref_00475015` VA 0x00475015 */
export const GIFT_GOD_SPRITE: readonly number[] = [
  0x00, 0x01, 0x02, 0x03, 0x05, 0x06, 0x00, 0x01, 0x02, 0x04,
  0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x00, 0x0b, 0x0a,
  0x09, 0x08, 0x07, 0x00, 0x0c, 0x0d, 0x0e, 0x0f, 0x11, 0x12,
  0x0c, 0x0d, 0x0e, 0x10, 0x11, 0x12,
];
/** 掉落物速度表（按类型，`y >= 130` 之后用）@source `ref_00475010` VA 0x00475010 */
export const GIFT_ITEM_SPEED: readonly number[] = [0x18, 0x12, 0x0f, 0x0c, 0x0f];
/** 计分权重（按类型 0..3）@source `fcn_0041417e` @0x0041449e */
export const GIFT_VALUE: readonly number[] = [10, 5, 3, 1];
/** 生成类型时的模数 @source `fcn_004123d7` @0x004123e5：`rand()%20` */
export const GIFT_TYPE_ROLL = 20;
/** 掉落物起始高度与初速 @source `0x64` / `0xfff0` @0x00412451 */
export const GIFT_ITEM_Y0 = 0x64;
export const GIFT_ITEM_SPEED0 = -16;
/** 加速段的分界与上限 @source `cmp dx, 0x82` / `cmp ax, 0x10` @0x0041349e */
export const GIFT_ACCEL_UNTIL_Y = 0x82;
export const GIFT_ACCEL_STEP = 2;
export const GIFT_SPEED_MAX = 0x10;
/** miss 判据 @source `cmp word [… + 0x48bbc6], 0x17c` @0x004134f3 */
export const GIFT_ITEM_END_Y = 0x17c;
/** 远近缩放：`scale = 0.5 + (y − 130)/250` @source 0x004132bc（`fcn_004568c2` 第 6 参是缩放）*/
export const GIFT_SCALE_Y0 = 0x82;
export const GIFT_SCALE_SPAN = 0xfa;
/** 预警：共 12 帧、第 8 帧生成炸彈 @source `cmp word […], 0xc` / `cmp di, 8` @0x004137e8 */
export const GIFT_WARN_FRAMES = 12;
export const GIFT_WARN_SPAWN_FRAME = 8;
/** 预警落点的两段区间 @source `add edx, 0xa0` / `add edx, 0x168`，`rand()%0x8c` @0x0041378d */
export const GIFT_WARN_SPAN = 0x8c;
export const GIFT_WARN_LEFT0 = 0xa0;
export const GIFT_WARN_RIGHT0 = 0x168;
/** 预警起手概率 @source `fcn_004123ba` VA 0x004123ba = `rand()%10 < 7` */
export const GIFT_WARN_ODDS = 7;
/** 定时器 50ms @source `push 0x32` 的 `SetTimer` @0x0041500f */
export const GIFT_TICK_MS = 50;
/** 入场 tick 数 @source `mov dword [0x48bd8c], 0xa`（首帧从 0x63 改过来）@0x004151c1 */
export const GIFT_INTRO_TICKS = 10;
/** 游戏 tick 数 @source `mov dword [0x48bd2c], 0x168` @0x0041500f */
export const GIFT_PLAY_TICKS = 0x168;
/** 结束姿势分数线 @source `cmp ebp, 0x28 / 0x32 / 0x3c` @0x0041510e */
export const GIFT_POSE_1 = 0x28;
export const GIFT_POSE_2 = 0x32;
export const GIFT_POSE_3 = 0x3c;

export interface GiftItem {
  /** 0 = 空槽 */
  x: number;
  y: number;
  type: number;
  /** 动画帧 0..7（类型字的高半字节，`add word […], 0x10` @0x0041348f）*/
  frame: number;
  speed: number;
}

export type GiftPhase = 'intro' | 'play' | 'ending' | 'score';

export interface GiftGame {
  rngState: number;
  items: GiftItem[];
  /** 各类型接到的个数 @0x48bbb4 / b8 / bc / c0 */
  counts: number[];
  /** 財神的 x @0x48bd4c */
  godX: number;
  /** 財神的状态 0..4 @0x48bd44 */
  godState: number;
  /** 財神这一趟走到第几帧 @0x48bd46 */
  godFrame: number;
  /** 这一趟在第几帧撒幣 @0x48bd40 */
  godSpawnFrame: number;
  /** 玩家自己的 x @0x48bd4e */
  catcherX: number;
  /** 玩家的朝向 0 = 站住、1 = 右、2 = 左 @0x48bd48 */
  catcherDir: number;
  /** 玩家的走行帧 @0x48bd50 */
  catcherFrame: number;
  /** 炸彈预警帧（−1 = 没有）@0x48bd42 */
  warnFrame: number;
  /** 炸彈落点 x @0x48bd4a */
  warnX: number;
  /** 已生成、还没落完的炸彈数 @0x48bd54 */
  bombs: number;
  /** 结束姿势 @0x48bd56（4 = 被炸彈砸中）*/
  endPose: number;
  phase: GiftPhase;
  /** 剩余游戏 tick @0x48bd2c */
  ticks: number;
  /** 剩余入场 tick @0x48bd8c */
  intro: number;
  scoreUntil: number;
  /** 待播音效（纯函数登记、屏幕的 `playMiniSounds` 倒出去）*/
  sfx: MiniSound[];
}

/** 掉落物槽数 @source `cmp esi, 0x10` @0x00413541 */
export const GIFT_SLOTS = 16;

export function giftStart(seed: number): GiftGame {
  const items: GiftItem[] = [];
  for (let i = 0; i < GIFT_SLOTS; i++) items.push({ x: 0, y: 0, type: 0, frame: 0, speed: 0 });
  return {
    rngState: seed >>> 0,
    items,
    counts: [0, 0, 0, 0],
    godX: GIFT_GOD_X_MIN,
    // @source `[0x48bd44] = 3`、`[0x48bd46] = 4` @0x00415805 / @0x0041580b
    godState: 3,
    godFrame: 4,
    godSpawnFrame: 0,
    // @source `[0x48bd4e] = 0x140` @0x00415825
    catcherX: GIFT_MID_X,
    catcherDir: 0,
    catcherFrame: 0,
    // @source `[0x48bd42] = 0xffff`（= 没有预警）@0x00415826
    warnFrame: -1,
    warnX: 0,
    bombs: 0,
    endPose: 0,
    phase: 'intro',
    ticks: GIFT_PLAY_TICKS,
    intro: GIFT_INTRO_TICKS,
    scoreUntil: 0,
    sfx: [],
  };
}

/** 计分 @source `fcn_0041417e` @0x0041449e */
export function giftScore(counts: readonly number[]): number {
  let sum = 0;
  for (let t = 0; t < GIFT_VALUE.length; t++) sum += (counts[t] ?? 0) * (GIFT_VALUE[t] ?? 0);
  return sum;
}

/** 財神当前该画哪张图 @source `0x475015[状态*10 + 帧]` @0x0041359b */
export function giftGodImage(st: GiftGame): number {
  return GIFT_GOD_SPRITE[st.godState * 10 + st.godFrame] ?? GIFT_GOD_SPRITE[0] ?? 0;
}

/**
 * 玩家自己当前该画哪张图 @source `loc_004136f0`：
 * 站住时 = `[0x48bd56]`（结束姿势 0..4）；走行时 = `(朝向−1)*10 + 5 + 帧`。
 */
export function giftCatcherImage(st: GiftGame): number {
  if (st.catcherDir === 0) return st.endPose;
  return (st.catcherDir - 1) * GIFT_CATCHER_FRAMES + 5 + st.catcherFrame;
}

/**
 * 掉落物的远近缩放 @source 0x004132bc：
 * `arg = (y >= 130) ? y − 130 : 0`；`scale = 32768 + round(arg / 250 × 32768)`（16.16 定点）。
 * 刚出来时 0.5、到 `y = 380` 正好 1.0。
 */
export function giftScale(y: number): number {
  const arg = y >= GIFT_SCALE_Y0 ? y - GIFT_SCALE_Y0 : 0;
  return (32768 + Math.round((arg / GIFT_SCALE_SPAN) * 32768)) / 65536;
}

/**
 * 掉落物的横向摆动 @source 0x004132bc：`trunc(帧 × (y−130)/250)`。
 * （同一段里 `[esp+0x24]` 先被赋成类型字高字节、随即被这个值覆盖 —— 高位那一段是死代码。）
 */
export function giftDrift(frame: number, y: number): number {
  const arg = y >= GIFT_SCALE_Y0 ? y - GIFT_SCALE_Y0 : 0;
  return Math.trunc((frame * arg) / GIFT_SCALE_SPAN);
}

/** 生成一个掉落物 @source `fcn_004123d7` VA 0x004123d7 */
function giftSpawn(st: GiftGame, x: number, bomb: boolean): void {
  const holder = { rngState: st.rngState };
  let type: number;
  if (bomb) {
    type = 4;
    st.bombs += 1;
  } else {
    const roll = randMod(holder, GIFT_TYPE_ROLL);
    type = roll < 9 ? 3 : roll < 15 ? 2 : roll < 18 ? 1 : 0;
  }
  st.rngState = holder.rngState;
  const free = st.items.findIndex((it) => it.x === 0);
  if (free < 0) return;
  const it = st.items[free];
  if (it === undefined) return;
  it.x = x;
  it.y = GIFT_ITEM_Y0;
  it.type = type;
  it.frame = 0;
  it.speed = GIFT_ITEM_SPEED0;
}

/** 財神的走行状态机 @source `loc_0041386a` 的 5 路跳表 `ref_00413234` VA 0x00413234 */
function giftWalkGod(st: GiftGame): void {
  const holder = { rngState: st.rngState };
  if (st.godState === 0) {
    // 往右走：帧 0..4，其中第 `godSpawnFrame` 帧撒一个幣
    if (st.godFrame < 5) {
      if (st.godFrame === st.godSpawnFrame) giftSpawn(st, st.godX, false);
      st.godFrame += 1;
      st.godX += GIFT_GOD_STEP;
    } else if (st.godX <= GIFT_MID_X || st.godX === GIFT_GOD_X_MAX || randMod(holder, 4) === 0) {
      st.godState = 2;
      st.godFrame = 0;
    } else {
      st.godSpawnFrame = randMod(holder, 5);
      st.godX += GIFT_GOD_STEP;
    }
  } else if (st.godState === 2) {
    st.godFrame += 1;
    if (st.godFrame >= 5) {
      st.godState = 4;
      st.godFrame = 0;
    }
  } else if (st.godState === 3) {
    st.godFrame += 1;
    if (st.godFrame >= 5) {
      st.godState = 0;
      st.godFrame = 0;
    }
  } else {
    // 状态 4：往左走
    if (st.godFrame < 5) {
      if (st.godFrame === st.godSpawnFrame) giftSpawn(st, st.godX, false);
      st.godFrame += 1;
      st.godX -= GIFT_GOD_STEP;
    } else if (st.godX >= GIFT_MID_X || st.godX === GIFT_GOD_X_MIN || randMod(holder, 4) === 0) {
      st.godState = 3;
      st.godFrame = 0;
    } else {
      st.godSpawnFrame = randMod(holder, 5);
      st.godX -= GIFT_GOD_STEP;
    }
  }
  st.rngState = holder.rngState;
}

/** 炸彈预警 @source `loc_0041370..`；起手条件见 `loc_00413770` / `loc_0041378d` */
function giftWarn(st: GiftGame): void {
  const holder = { rngState: st.rngState };
  if (st.warnFrame >= 0) {
    st.warnFrame += 1;
    if (st.warnFrame === GIFT_WARN_SPAWN_FRAME) {
      giftSpawn(st, st.warnX, true);
      // ★ 第 8 帧真正落炸彈：22（一次性）+ 24（循环哨音）@source 0x00413809
      st.sfx.push({ id: GIFT_BOMB_SOUND });
      st.sfx.push({ id: GIFT_BOMB_LOOP_SOUND, loop: true });
    }
    if (st.warnFrame >= GIFT_WARN_FRAMES) st.warnFrame = -1;
  } else if (st.phase === 'play') {
    // 起手条件 @0x00413770 / @0x0041378d：状态 0/1（往右走）要 `godX > 320`；
    // 状态 4（往左走）要 `godX < 320`；**状态 2/3（转身过渡）一次都不起**。
    const start =
      st.godState <= 1
        ? st.godX > GIFT_MID_X
        : st.godState === 4
          ? st.godX < GIFT_MID_X
          : false;
    if (start && randMod(holder, 10) < GIFT_WARN_ODDS) {
      const r = randMod(holder, GIFT_WARN_SPAN);
      st.warnFrame = 0;
      // 財神在右半 → 炸彈落左半；在左半 → 落右半 @0x0041378d
      st.warnX = st.godX > GIFT_MID_X ? GIFT_WARN_LEFT0 + r : GIFT_WARN_RIGHT0 + r;
    }
  }
  st.rngState = holder.rngState;
}

/**
 * 玩家追鼠标 @source `loc_0041364d` / `loc_0041369b`：
 * `|自己 − 鼠标| > 8` 才动、每 tick 10px，同时推进走行帧；进入 8px 内就站住。
 */
function giftMoveCatcher(st: GiftGame, mx: number): void {
  const dx = st.catcherX - mx;
  if (Math.abs(dx) <= GIFT_CATCH_DEADZONE) {
    st.catcherDir = 0;
    return;
  }
  if (dx > 0) {
    st.catcherDir = 1;
    st.catcherX -= GIFT_CATCH_STEP;
  } else {
    st.catcherDir = 2;
    st.catcherX += GIFT_CATCH_STEP;
  }
  st.catcherFrame = (st.catcherFrame + 1) % GIFT_CATCHER_FRAMES;
}

/**
 * 推进一个 tick（50ms）。
 *
 * @param mx 鼠标舞台 x（原版每帧 `GetCursorPos` 读，`[0x48bd4e]` 追它 @0x00413606）
 * @param box 玩家自己**当前这一帧**贴图占的矩形（原版直接读图记录 @0x00413743 起）；
 *   取不到图时给 `GIFT_CATCH_BOX_DEFAULT`
 */
export function giftStep(st: GiftGame, mx: number, box: Box, now: number): GiftGame {
  if (st.phase === 'intro') {
    const intro = st.intro - 1;
    return intro > 0 ? { ...st, intro } : { ...st, intro: 0, phase: 'play' };
  }
  if (st.phase === 'score') return st;

  const next: GiftGame = {
    ...st,
    items: st.items.map((it) => ({ ...it })),
    counts: st.counts.slice(),
  };

  let ticks = next.ticks;
  if (next.phase === 'play') {
    ticks = Math.max(0, ticks - 1);
    // 时间到 @0x0041509c → `[0x48bd58] = 1`（姿势要等屏上清空、进 bd58 = 2 时才定
    // @0x0041510e，因为结算里还可能接到几个）
    if (ticks === 0) next.phase = 'ending';
  }
  next.ticks = ticks;

  // 结算中就不追鼠标了 @0x004135e0 `cmp byte [0x48bd58], 2 / je`
  if (next.phase === 'play') giftMoveCatcher(next, mx);

  let anyActive = false;
  for (const it of next.items) {
    if (it.x === 0) continue;
    it.frame = (it.frame + 1) & 7;
    if (it.y < GIFT_ACCEL_UNTIL_Y) {
      it.speed += GIFT_ACCEL_STEP;
      if (it.speed > GIFT_SPEED_MAX) it.speed = GIFT_SPEED_MAX;
      it.y += it.speed;
    } else {
      it.y += GIFT_ITEM_SPEED[it.type] ?? 0x0f;
    }
    const px = it.x + giftDrift(it.frame, it.y);
    const caught =
      next.catcherDir !== 0 && px > box.x0 && px < box.x1 && it.y > box.y0 && it.y < box.y1;
    if (caught) {
      if (it.type === 4) {
        // 炸彈：立刻结束 @0x004133fe
        // ★ 音：先停哨音 24、再放爆炸 15 @source 0x00413436（`fcn_004542e9(0x4750cf)`
        //   紧接 `play_sound_effect(0, 0x4750d7)`）
        next.sfx.push({ id: GIFT_BOMB_LOOP_SOUND, stop: true });
        next.sfx.push({ id: GIFT_BOOM_SOUND });
        next.endPose = 4;
        next.phase = 'ending';
        next.warnFrame = -1;
        it.x = 0;
        continue;
      }
      next.counts[it.type] = (next.counts[it.type] ?? 0) + 1;
      it.x = 0;
      continue;
    }
    if (it.y > GIFT_ITEM_END_Y) {
      if (it.type === 4) {
        next.bombs = Math.max(0, next.bombs - 1);
        // ★ 最后一颗炸彈落地 → 停哨音 @source 0x0041351d（`dec [0x48bd54]` 归零才停）
        if (next.bombs === 0) next.sfx.push({ id: GIFT_BOMB_LOOP_SOUND, stop: true });
      }
      it.x = 0;
      continue;
    }
    anyActive = true;
  }

  giftWarn(next);
  if (next.phase === 'play') {
    giftWalkGod(next);
  } else {
    // ★ 时间到 / 被炸彈砸中之后**財神不再走、也不再撒幣**：
    //   `loc_00413849` 的 `cmp byte [0x48bd58], 1 / je` 把走行状态机整段跳过，
    //   并把姿势定成 `状态 2 / 帧 2`。不这样做的话币会一直掉，「等屏上清空」永远等不到。
    next.godState = 2;
    next.godFrame = 2;
  }

  // @0x00413a2b：结算中 + 屏上没掉落物了 → 进大号分数
  if (next.phase === 'ending' && !anyActive) {
    // @0x0041510e：这一刻才按**最终**分数定姿势（`endPose === 4` = 被炸彈砸中，跳过），
    // 并把朝向清零 —— 玩家这一格就从走行帧换成站住的姿势图（`loc_004136f0` 的 `dir == 0` 分支）。
    if (next.endPose !== 4) {
      const score = giftScore(next.counts);
      next.endPose =
        score < GIFT_POSE_1 ? 1 : score < GIFT_POSE_2 ? 2 : score < GIFT_POSE_3 ? 0 : 3;
    }
    next.catcherDir = 0;
    next.phase = 'score';
    next.scoreUntil = now + MINI_END_MS;
  }
  return next;
}

/**
 * 玩家自己那一帧的包围盒（取不到图时的兜底）——
 * 用 `Panel.mkf` #100 图 0 的 `66×72`、锚点 `(33,71)`（`assets-clean/manifest.json`）。
 * 走行那几帧比这个宽 20px 上下，所以 `tick` 会把当前帧的图量出来传进来（D-MINI-7）。
 */
export const GIFT_CATCH_BOX_DEFAULT: Box = {
  x0: GIFT_MID_X - 33,
  y0: GIFT_CATCHER_Y - 71,
  x1: GIFT_MID_X - 33 + 66,
  y1: GIFT_CATCHER_Y - 71 + 72,
};

/** 把一张贴图 + 落点折成矩形（和 `fcn_0045663e` 的 `x − 锚点` 同义）*/
export function catchBoxOf(sprite: Sprite | null, x: number, y: number): Box {
  if (sprite === null) {
    const b = GIFT_CATCH_BOX_DEFAULT;
    const dx = x - GIFT_MID_X;
    return { x0: b.x0 + dx, y0: b.y0, x1: b.x1 + dx, y1: b.y1 };
  }
  return {
    x0: x - sprite.anchorX,
    y0: y - sprite.anchorY,
    x1: x - sprite.anchorX + sprite.width,
    y1: y - sprite.anchorY + sprite.height,
  };
}

// ============================================================
//  绘制（只做 IO）
// ============================================================
// ⚠️ 三屏的数字**全是图**（`Panel.mkf` #79 的 0..9 / 10..19），没有一处画字 ——
//   所以这里不引 `font.ts`（原版也确实是贴图，不是 GDI 文本）。

/** 锚点贴图：`to_left = x − 图自带原点`（`fcn_00456418` / `fcn_0045663e` 都是这条）*/
function drawAnchored(
  ctx: CanvasRenderingContext2D,
  s: Sprite | null,
  x: number,
  y: number,
  scale = 1,
): void {
  if (s === null) return;
  if (scale === 1) {
    ctx.drawImage(s.bitmap, x - s.anchorX, y - s.anchorY);
    return;
  }
  // `fcn_004568c2`：锚点**不跟着缩放**、只有宽高乘 scale（@0x004568c2 的 `sub [ebp+0x14], eax` 在前）
  ctx.drawImage(s.bitmap, x - s.anchorX, y - s.anchorY, s.width * scale, s.height * scale);
}

/** 整块不透明贴图（`fcn_004563f5`）*/
function drawPlain(ctx: CanvasRenderingContext2D, s: Sprite | null, x: number, y: number): void {
  if (s === null) return;
  ctx.drawImage(s.bitmap, x, y);
}

/**
 * 数字串。原版一个字符贴一次 `fcn_004563f5`（不透明），
 * 图号 = `字符 − 0x30 + first`（小号 `first = 0` @0x00413fe3…，大号 `first = 10` @0x004147e5 的 `sub edx, 0x26`）。
 *
 * ★ **只画前 `width` 个字符**：原版画的是**固定位数** —— 氣球 HUD 是 `%04d`
 *   （`fcn_00413f07`，4 个字符、落点 `0x211 + i*0x14`，第 5 位会画到
 *   `0x211 + 4*0x14 = 0x261` 的框外），企鵝 / 財神是 `%03d`、计数是 `%02d`。
 *   分数万一超了（見 D-MINI-12），原版只是把多出来的位**不画**，本引擎照抄。
 */
export function drawNumber(
  ctx: CanvasRenderingContext2D,
  sprite: MiniSprite,
  text: string,
  x0: number,
  y: number,
  pitch: number,
  first: number,
  width: number,
): void {
  const chars = text.slice(0, Math.max(0, width));
  for (let i = 0; i < chars.length; i++) {
    const code = chars.charCodeAt(i);
    if (code < 0x30 || code > 0x39) continue;
    drawPlain(ctx, sprite(MINI_ARCHIVE, MINI_FONT_RES, code - 0x30 + first, false), x0 + i * pitch, y);
  }
}

/** 小号数字行（`y = 0x1a5`、字距 0x14）；`width` = 原版的 `%0Nd` 位数 */
function drawDigitRow(
  ctx: CanvasRenderingContext2D,
  sprite: MiniSprite,
  text: string,
  x0: number,
  width: number,
  y = MINI_HUD_Y,
): void {
  drawNumber(ctx, sprite, text, x0, y, MINI_DIGIT_PITCH, 0, width);
}

/** 结算时的大号分数 @source `fcn_00414789` VA 0x00414789（居中在 x = 0x161、y = 0x96）*/
function drawBigScore(ctx: CanvasRenderingContext2D, sprite: MiniSprite, score: number): void {
  const text = String(Math.min(MINI_SCORE_CAP, Math.max(0, score)));
  const x0 = MINI_BIG_CENTER_X - Math.trunc((text.length * MINI_BIG_PITCH) / 2);
  // 原版 `fcn_00414789` 先 `sprintf` 再按 `strlen` 一个字符一个字符画 —— 位数是变长的
  drawNumber(ctx, sprite, text, x0, MINI_BIG_Y, MINI_BIG_PITCH, MINI_BIG_DIGIT_FIRST, text.length);
}

// ── 一、企鵝挖寶 ──

/** HUD：时间 `%03d` @0x31、分隔图 0 @0x72、四个 2 位计数、分数 `%03d` @0x225 @source `fcn_00413a4a` */
export const PENGUIN_HUD = {
  timeX: 0x31,
  sepX: 0x72,
  counterX: [0xb9, 0x114, 0x16f, 0x1ca],
  /** 四个计数器按 HUD 顺序对应的**类型** @source `fcn_00413a4a` 的 `bb c0 / bb b8 / bb bc / bb b4` */
  counterType: [5, 3, 4, 2],
  scoreX: 0x225,
} as const;

function drawPenguin(ctx: CanvasRenderingContext2D, sprite: MiniSprite, st: PenguinGame): void {
  drawPlain(ctx, sprite(MINI_ARCHIVE, PENGUIN_RES, 0, false), 0, 0);
  // 土堆（入场画出来；走过就被背景重贴擦掉 —— 见 D-MINI-6）
  if (st.phase === 'intro' || st.phase === 'play') {
    for (let i = 0; i < PENGUIN_CELLS; i++) {
      if ((st.mound[i] ?? 0) === 0) continue;
      const type = st.board[i] ?? 0;
      if (type === 0) continue;
      drawAnchored(
        ctx,
        sprite(MINI_ARCHIVE, PENGUIN_RES, type + PENGUIN_ICON_FIRST, true),
        penguinCellX(i),
        penguinCellY(i),
      );
    }
  }
  // 刚挖到的动画（86..90，各 6 帧）
  if (st.loot !== null) {
    const res = PENGUIN_LOOT_RES[st.loot.type - 1] ?? PENGUIN_LOOT_RES[0] ?? 0x56;
    drawAnchored(
      ctx,
      sprite(MINI_ARCHIVE, res, st.loot.frame, true),
      penguinCellX(st.loot.cell),
      penguinCellY(st.loot.cell),
    );
  }
  // 企鵝自己：走 / 挖 用 8 向帧表，站住用光标图（@0x004125a3 状态 0）
  const curX = penguinCellX(st.cell);
  const curY = penguinCellY(st.cell);
  const nx = st.to === null ? curX : penguinCellX(st.to);
  const ny = st.to === null ? curY : penguinCellY(st.to);
  const px = curX + Math.trunc(((nx - curX) * st.sub) / PENGUIN_SUB_FRAMES);
  const py = curY + Math.trunc(((ny - curY) * st.sub) / PENGUIN_SUB_FRAMES);
  if (st.dig > 0) {
    drawAnchored(ctx, sprite(MINI_ARCHIVE, PENGUIN_DIG_RES, st.dir * 4 + (st.sub & 3), true), px, py);
  } else if (st.to !== null) {
    drawAnchored(ctx, sprite(MINI_ARCHIVE, PENGUIN_WALK_RES, st.dir * 4 + (st.sub & 3), true), px, py);
  } else if (st.phase === 'end' && st.endPose !== 'mid') {
    const res = st.endPose === 'hi' ? PENGUIN_END_HI_RES : PENGUIN_END_LO_RES;
    const per = PENGUIN_END_FRAMES[st.endPose];
    drawAnchored(ctx, sprite(MINI_ARCHIVE, res, st.endFrame % per, true), px, py);
  } else {
    drawAnchored(ctx, sprite(MINI_ARCHIVE, PENGUIN_RES, 1, true), px, py);
  }
  const score = penguinScore(st.counts);
  if (st.phase === 'score') drawBigScore(ctx, sprite, score);
  // HUD（位数照原版的 `%03d` / `%02d` 固定宽 —— 见 `drawNumber`）
  drawDigitRow(ctx, sprite, pad(st.ticks, 3), PENGUIN_HUD.timeX, 3);
  drawPlain(ctx, sprite(MINI_ARCHIVE, MINI_FONT_RES, 0, false), PENGUIN_HUD.sepX, MINI_HUD_Y);
  for (let i = 0; i < PENGUIN_HUD.counterX.length; i++) {
    const type = PENGUIN_HUD.counterType[i] ?? 0;
    drawDigitRow(ctx, sprite, pad(st.counts[type] ?? 0, 2), PENGUIN_HUD.counterX[i] ?? 0, 2);
  }
  drawDigitRow(ctx, sprite, pad(score, 3), PENGUIN_HUD.scoreX, 3);
}

// ── 二、七彩氣球 ──

/**
 * HUD @source `fcn_00413f07` VA 0x00413f07：
 * 时间 `%03d` @0x31（0x45 / 0x5e 是第 2、3 位）、分隔图 0 @0x72、
 * 分数 `%04d` @0x211（0x225 / 0x239 / 0x24d 是后面三位）。
 */
export const BALLOON_HUD = { timeX: 0x31, sepX: 0x72, scoreX: 0x211 } as const;

function drawBalloon(ctx: CanvasRenderingContext2D, sprite: MiniSprite, st: BalloonGame): void {
  drawPlain(ctx, sprite(MINI_ARCHIVE, BALLOON_RES, 0, false), 0, 0);
  for (const b of st.balloons) {
    if (b.x === 0) continue;
    const img = b.popped > 0 ? BALLOON_POP_IMAGE : b.type + BALLOON_IMAGE_FIRST;
    drawAnchored(ctx, sprite(MINI_ARCHIVE, BALLOON_RES, img, true), b.x, b.y);
  }
  if (st.phase === 'score') drawBigScore(ctx, sprite, st.score);
  drawDigitRow(ctx, sprite, pad(st.ticks, 3), BALLOON_HUD.timeX, 3);
  drawPlain(ctx, sprite(MINI_ARCHIVE, MINI_FONT_RES, 0, false), BALLOON_HUD.sepX, MINI_HUD_Y);
  // ★ 分数固定 **4** 位（`%04d`）—— 多出来的位一个也不画（否则画到 0x261 框外）
  drawDigitRow(ctx, sprite, pad(st.score, 4), BALLOON_HUD.scoreX, 4);
}

// ── 三、財神接金幣 ──

/** HUD：时间 = `tick >> 1` 的 `%03d`、四个 2 位计数、分数 `%03d` @source `fcn_0041417e` */
export const GIFT_HUD = {
  timeX: 0x31,
  sepX: 0x72,
  counterX: [0xb9, 0x114, 0x16f, 0x1ca],
  /** 计数器顺序就是类型 0/1/2/3 @source `fcn_0041417e` 的四次 sprintf */
  counterType: [0, 1, 2, 3],
  scoreX: 0x225,
} as const;

function drawGift(
  ctx: CanvasRenderingContext2D,
  sprite: MiniSprite,
  st: GiftGame,
  catcherArchiveRes: number,
): void {
  // 底图 #92：无头 640×480 RGB555，不在 manifest 里 → `sprite()` 取不到。
  // ★ 两条路都留：`minigame-bg.ts` 里有位图就画它（`loadMinigameBackground` 载的），
  //   否则退回 `sprite()`（万一哪天管线把 #92 接进去了，这一条就自动生效）。
  //   两个都没有就只画部件 —— **不能因为底图缺席整屏不画**。
  const bg = getMinigameBackground();
  if (bg !== null) {
    ctx.drawImage(bg, 0, 0);
  } else {
    drawPlain(ctx, sprite(MINI_ARCHIVE, GIFT_RES, 0, false), 0, 0);
  }
  // 掉落物（按远近缩放 @0x004132bc）
  for (const it of st.items) {
    if (it.x === 0) continue;
    const res = GIFT_ITEM_RES[it.type] ?? GIFT_ITEM_RES[0] ?? 0x5f;
    const s = sprite(MINI_ARCHIVE, res, it.frame, true);
    drawAnchored(ctx, s, it.x + giftDrift(it.frame, it.y), it.y, giftScale(it.y));
  }
  // 炸彈预警 @0x0041356e
  if (st.warnFrame >= 0) {
    drawAnchored(
      ctx,
      sprite(MINI_ARCHIVE, GIFT_WARN_RES, Math.min(st.warnFrame, GIFT_WARN_FRAMES - 1), true),
      st.warnX,
      GIFT_WARN_Y,
    );
  }
  // 財神 @0x0041359b
  drawAnchored(ctx, sprite(MINI_ARCHIVE, GIFT_GOD_RES, giftGodImage(st), true), st.godX, GIFT_GOD_Y);
  // 玩家自己 @0x004136f0
  drawAnchored(
    ctx,
    sprite(MINI_ARCHIVE, catcherArchiveRes, giftCatcherImage(st), true),
    st.catcherX,
    GIFT_CATCHER_Y,
  );
  const score = giftScore(st.counts);
  if (st.phase === 'score') drawBigScore(ctx, sprite, score);
  // HUD：时间是 `[0x48bd2c] >> 1` @0x0041419b
  drawDigitRow(ctx, sprite, pad(st.ticks >> 1, 3), GIFT_HUD.timeX, 3);
  drawPlain(ctx, sprite(MINI_ARCHIVE, MINI_FONT_RES, 0, false), GIFT_HUD.sepX, MINI_HUD_Y);
  for (let i = 0; i < GIFT_HUD.counterX.length; i++) {
    const type = GIFT_HUD.counterType[i] ?? 0;
    drawDigitRow(ctx, sprite, pad(st.counts[type] ?? 0, 2), GIFT_HUD.counterX[i] ?? 0, 2);
  }
  drawDigitRow(ctx, sprite, pad(score, 3), GIFT_HUD.scoreX, 3);
}

// ============================================================
//  屏幕本体
// ============================================================

/** 本屏在跑的那一局 */
interface MiniRun {
  /** `pending.game`（specialKind）*/
  game: number;
  /** 本局自己的 PRNG 种子 */
  seed: number;
  /** 上一次推进到的时刻 */
  at: number;
  /** 毫秒累加器 → 固定 tick */
  acc: number;
  /** 已收分（等 core 把 pending 清掉，期间不要再开一局）*/
  sent: boolean;
  penguin: PenguinGame | null;
  balloon: BalloonGame | null;
  gift: GiftGame | null;
  /** 最后一次看到的鼠标舞台 x（財神那屏每帧读鼠标 @0x00413606）*/
  mx: number;
  /**
   * 入场 FLIC（`Panel.mkf` #0x4e）播到第几帧；`null` = 不播/已播完。
   *
   * ★ 2026-09-16 接线（外部审查 D-MINI-3）：原版三个小游戏入口都是
   *   `read_mkf(panel_mkf, 0x4e)` 之后**阻塞**调 `fcn_0045144f` 播它
   *   （@source `rich4_small_games.asm:4239/4445/4531`，播放在
   *   VA 0x00414a60 / 0x00414d60 / 0x00415199）。
   *   闸门是 `whoPlays == 1 && RICH4.CFG+1`（`rich4_small_games.asm:4230-4233`）
   *   —— 即**只对真人、且「動畫過程」开着**才播。
   */
  intro: { at: number; until: number } | null;
  /**
   * 入场 FLIC 已经**决定过**了（播了、或确实不该播/拿不到）。
   *
   * ★ 为什么需要它：`env.flic()` 是**异步**的，第一帧一定返回 null
   *   （在后台解，解完 main.ts 会重画一帧）。若只在 `ensureRun` 那一次判，
   *   第一帧的 null 会把整段入场演出永久丢掉 —— 实测就是这样。
   *   于是每帧重试，直到「影片到手」或「确实不归它播」为止。
   */
  introTried: boolean;
  /** 从什么时候起在等这段影片（用来判「确实没有这个资源」，见 `MINI_INTRO_GIVE_UP_MS`）*/
  introWaitSince: number;
}

let run: MiniRun | null = null;
/** 每次开局的序号 —— 混进种子，让同一回合里反复玩不会抽到同一副牌 */
let playNonce = 0;

/**
 * 本屏自己的 PRNG 种子。
 *
 * ★ 原版三个小游戏用的是**全局** `_libc_rand`（与骰子、AI 共用一条序列）。
 *   本引擎的规矩是「随机数用屏幕自己的 PRNG」：算法与原版 `_libc_rand` 位级一致
 *   （`core/rng/watcom.ts`），但序列独立、由「对局状态 + 开局序号」推出来，
 *   于是同一局里可复现、又不与规则侧的 `state.rngState` 纠缠（C-DET：只有分数进 core）。
 */
export function minigameSeed(
  state: { day: number; month: number; year: number; currentPlayer: number },
  game: number,
  nonce: number,
): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h = (Math.imul(h ^ (v & 0xffff), 0x01000193) ^ (v >>> 16)) >>> 0;
  };
  mix(state.day);
  mix(state.month);
  mix(state.year);
  mix(state.currentPlayer);
  mix(game);
  mix(nonce);
  return h >>> 0;
}

function ensureRun(env: UiScreenEnv): MiniRun | null {
  const pending = env.state.pending;
  if (pending === null || pending.kind !== 'minigame') {
    run = null;
    return null;
  }
  if (run !== null && run.game === pending.game) {
    // ★ 入场 FLIC 是**异步**的：`env.flic` 第一次一定返回 null（后台在解）。
    //   所以「还没决定过」时每帧再判一次，别把整段演出丢掉（实测第一版就是
    //   被第一帧的 null 吞了）。判到「影片到手」或「等够久还是拿不到」为止。
    if (!run.introTried) {
      const started = startIntro(env, run.game);
      if (started !== null) {
        run.intro = started;
        run.introTried = true;
        run.at = env.now;
      } else if (env.now - run.introWaitSince > MINI_INTRO_GIVE_UP_MS) {
        run.introTried = true;
      } else {
        env.requestRender();
      }
    }
    return run;
  }
  playNonce += 1;
  const seed = minigameSeed(env.state, pending.game, playNonce);
  run = {
    game: pending.game,
    seed,
    at: env.now,
    acc: 0,
    sent: false,
    penguin: pending.game === SPECIAL_KIND.PENGUIN_DIG ? penguinStart(seed) : null,
    balloon: pending.game === SPECIAL_KIND.BALLOON ? balloonStart(seed) : null,
    gift: pending.game === SPECIAL_KIND.GIFT_FROM_SKY ? giftStart(seed) : null,
    mx: GIFT_MID_X,
    intro: null,
    introTried: false,
    introWaitSince: env.now,
  };
  // ★ 定曲（`push 0xc/0xb/0xa; call fcn_004549cf` @source `rich4_small_games.asm:4335/4481/4638`）：
  //   与入场 FLIC **同一道闸门**（真人 + 「動畫過程」开着），见 `introGateOpen`。
  //   ⚠️ 点在这里而不是 startIntro：startIntro 在影片没解好之前会**每帧重试**，
  //   放那儿会把曲子每帧重头点一遍。
  const me = env.state.players[env.state.currentPlayer];
  if (me !== undefined && introGateOpen(me.whoPlays, env.animation)) {
    const bgm = minigameBgmFile(pending.game);
    if (bgm !== null) env.music?.(bgm);
  }
  env.requestRender();
  return run;
}

/**
 * 入场 FLIC 该不该播、播多久 —— 纯函数。
 *
 * @source `rich4_small_games.asm:4230-4233` 的闸门：
 * ```asm
 * cmp byte [player + 0x15], 1     ; ★ whoPlays == 1（只有真人）
 * jne 跳过
 * cmp byte [0x46caf9(CFG+1)], 0   ; ★ 「動畫過程」关着也跳过
 * je 跳过
 * read_mkf(panel_mkf, 0x4e) … fcn_0045144f   ; 才播
 * ```
 *
 * @param whoPlays  当前玩家的 `whoPlays`（1 = 真人）
 * @param animation 遊戲設定的「動畫過程」（`UiScreenEnv.animation`；省略 = 开）
 * @param frameMs   FLIC 每帧毫秒（`env.flic` 给不出时就按 `minigameTickMs(game)`）
 * @returns 要播就返回 `{frame: 0, until: now + 总时长}`，否则 `null`
 */
export function introPlayback(
  whoPlays: number,
  animation: boolean | undefined,
  frameCount: number,
  frameMs: number,
  now: number,
  game: number,
): { at: number; until: number } | null {
  if (!introGateOpen(whoPlays, animation)) return null;
  if (frameCount <= 0) return null;
  const ms = frameMs > 0 ? frameMs : minigameTickMs(game);
  return { at: now, until: now + frameCount * ms };
}

/**
 * 小游戏入口那道闸门（真人在玩 且 「動畫過程」开着）—— 纯函数。
 *
 * ★ 这道闸门管的不只是入场 FLIC：**定曲也在同一个 `jne/je` 的里面**
 *   （`push 0xc/0xb/0xa; call fcn_004549cf` @source `rich4_small_games.asm:4335/4481/4638`，
 *   三处都在这两个比较之后）。所以「AI 玩」或「動畫過程关掉」时，
 *   小游戏**连配乐都没有** —— 照抄，不补。
 */
export function introGateOpen(whoPlays: number, animation: boolean | undefined): boolean {
  return whoPlays === 1 && animation !== false;
}

/**
 * 这一局该点哪一首 —— `fcn_004549cf` 的实参 → **磁盘文件名**（不认识就 `null`）。
 *
 * @source 三个入口里各一处 `push id; call fcn_004549cf`
 *   （`rich4_small_games.asm:4335` 企鵝 `push 0xc` / `4481` 氣球 `push 0xb` /
 *    `4638` 財神 `push 0xa`）；曲号 → 文件名走表 `0x47e793`
 *   （`MIDI{id+1}.MID`，见 `@rich4/assets-pipeline` 的 `SCREEN_BGM.minigame*`
 *   与 `bgmAssetFileFor`；磁盘上是小写）。
 */
export function minigameBgmFile(game: number): string | null {
  switch (game) {
    case SPECIAL_KIND.PENGUIN_DIG:
      // 0xc → MIDI13.MID
      return 'midi13.mid';
    case SPECIAL_KIND.BALLOON:
      // 0xb → MIDI12.MID
      return 'midi12.mid';
    case SPECIAL_KIND.GIFT_FROM_SKY:
      // 0xa → MIDI11.MID
      return 'midi11.mid';
    default:
      return null;
  }
}

/** 这一局要不要起入场 FLIC（真人了没有 / 动画开着没有 / 影片解好了没有）*/
function startIntro(
  env: UiScreenEnv,
  pendingGame: number,
): { at: number; until: number } | null {
  const me = env.state.players[env.state.currentPlayer];
  if (me === undefined) return null;
  const flic = env.flic(MINI_ARCHIVE, MINI_INTRO_FLIC_RES);
  return introPlayback(
    me.whoPlays,
    env.animation,
    flic?.frames.length ?? 0,
    flic?.frameMs ?? minigameTickMs(pendingGame),
    env.now,
    pendingGame,
  );
}

/** 一帧多少毫秒（企鵝/氣球 100ms、財神 50ms）*/
export function minigameTickMs(game: number): number {
  return game === SPECIAL_KIND.GIFT_FROM_SKY ? GIFT_TICK_MS : PENGUIN_TICK_MS;
}

/** 本局的分数（`null` = 这个 specialKind 不认识）*/
function runScore(st: MiniRun): number | null {
  if (st.penguin !== null) return penguinScore(st.penguin.counts);
  if (st.balloon !== null) return st.balloon.score;
  if (st.gift !== null) return giftScore(st.gift.counts);
  return null;
}

/** 这一局演完了没有 */
function runDone(st: MiniRun, now: number): boolean {
  if (st.penguin !== null) return st.penguin.phase === 'score' && now >= st.penguin.scoreUntil;
  if (st.balloon !== null) return st.balloon.phase === 'score' && now >= st.balloon.scoreUntil;
  if (st.gift !== null) return st.gift.phase === 'score' && now >= st.gift.scoreUntil;
  return true;
}

/** 收下这一局的分 —— **这是玩法进 core 的唯一边界** */
function finish(env: UiScreenEnv, score: number | null): void {
  if (run !== null) run.sent = true;
  // ★ 卡面写的是 `minigameScore`，实际 action 是 `{ type: 'minigame', score }`
  //   @source `core/state/actions.ts:204` / `core/rules/interaction.ts:270`（见 D-MINI-4）
  env.dispatch({ type: 'minigame', score });
  env.requestRender();
}

/** 玩家自己那一屏的角色资源号 = `100 + 角色号` @source `player + 0x13` @0x00415705 */
export function catcherResource(env: UiScreenEnv): number {
  const ch = env.state.players[env.state.currentPlayer]?.character ?? 0;
  return GIFT_CATCHER_RES_FIRST + ch;
}

/** 財神那屏：玩家当前这一帧贴图占的矩形（用来判「接住」@0x00413743）*/
function giftBox(env: UiScreenEnv, st: GiftGame): Box {
  return catchBoxOf(env.sprite(MINI_ARCHIVE, catcherResource(env), giftCatcherImage(st), true), st.catcherX, GIFT_CATCHER_Y);
}

/** 把本局三条状态机攒下的待播音效倒给屏幕出口 */
function flushSounds(env: UiScreenEnv, st: MiniRun): void {
  if (st.penguin !== null) playMiniSounds(env, st.penguin.sfx);
  if (st.balloon !== null) playMiniSounds(env, st.balloon.sfx);
  if (st.gift !== null) playMiniSounds(env, st.gift.sfx);
}

export const minigameScreen: UiScreen = {
  id: 'minigame',

  active(env: UiScreenEnv): boolean {
    return env.state.pending?.kind === 'minigame';
  },

  tick(env: UiScreenEnv): void {
    const st = ensureRun(env);
    if (st === null) return;
    // 已经送过分，等 core 把 pending 清掉（这中间别再开一局）
    if (st.sent) return;

    // ★ 入场 FLIC 还在播：这一段是**阻塞**的（原版 `fcn_0045144f`），
    //   期间游戏逻辑一步都不走 @source `rich4_small_games.asm:4239/4445/4531`
    if (st.intro !== null) {
      if (env.now < st.intro.until) {
        env.requestRender();
        return;
      }
      st.intro = null;
      st.at = env.now;
      env.requestRender();
    }

    const dt = Math.max(0, env.now - st.at);
    st.at = env.now;
    // 掉帧太久就不补帧了（原版是定时器，也不会补）
    st.acc += Math.min(dt, 1000);
    const step = minigameTickMs(st.game);
    while (st.acc >= step) {
      st.acc -= step;
      if (st.penguin !== null) st.penguin = penguinStep(st.penguin, env.now);
      else if (st.balloon !== null) st.balloon = balloonStep(st.balloon, env.now);
      else if (st.gift !== null) {
        st.gift = giftStep(st.gift, st.mx, giftBox(env, st.gift), env.now);
      }
    }
    // ★ 本帧推过的 tick 里登记的（挖到 / 点爆 / 点空 / 生成 / 炸彈）一次倒出去
    flushSounds(env, st);
    if (runDone(st, env.now)) {
      finish(env, runScore(st));
      return;
    }
    env.requestRender();
  },

  draw(env: UiScreenEnv): void {
    const st = ensureRun(env);
    if (st === null) return;
    const sprite: MiniSprite = (archive, resource, index, keyed) =>
      env.sprite(archive, resource, index, keyed);
    // ★ 入场 FLIC 压在整个小游戏画面之上（原版就是先播完它才铺 HUD）
    if (st.intro !== null) {
      const flic = env.flic(MINI_ARCHIVE, MINI_INTRO_FLIC_RES);
      if (flic !== null && flic.frames.length > 0) {
        const ms = flic.frameMs > 0 ? flic.frameMs : minigameTickMs(st.game);
        const i = Math.min(
          flic.frames.length - 1,
          Math.max(0, Math.floor((env.now - st.intro.at) / ms)),
        );
        const bmp = flic.frames[i];
        if (bmp !== undefined) env.stage.drawImage(bmp, 0, 0);
      }
      return;
    }
    if (st.penguin !== null) drawPenguin(env.stage, sprite, st.penguin);
    else if (st.balloon !== null) drawBalloon(env.stage, sprite, st.balloon);
    else if (st.gift !== null) drawGift(env.stage, sprite, st.gift, catcherResource(env));
  },

  move(x: number, _y: number, env: UiScreenEnv): void {
    const st = ensureRun(env);
    if (st === null) return;
    st.mx = x;
    env.requestRender();
  },

  down(x: number, y: number, env: UiScreenEnv): void {
    const st = ensureRun(env);
    if (st === null) return;
    st.mx = x;
    if (st.penguin !== null) st.penguin = penguinClick(st.penguin, x, y);
    else if (st.balloon !== null) st.balloon = balloonClick(st.balloon, x, y);
    // ★ 点这一下登记的（点爆 21 / 点空 20）当场倒出去
    flushSounds(env, st);
    env.requestRender();
  },
};
