/*
 * 樂透開獎动画屏
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ **不是待决交互** —— 開獎在 core 里即时结算（`reduce.ts` 的 `advanceGameDay`
 *   → `drawLottery`），本屏是**演出**：察觉開獎发生 → 按脚本播一段状态机 → 播完自己关。
 *
 * ## 出处
 *
 * 窗口过程 `fcn_0043010c` **VA 0x0043010c**（= `rich4_ui_letou.asm:1304` 起），
 * 建屏 `fcn_0042f6c3`（**VA 0x0042f6c3** —— 同一个函数在投注屏与開獎屏各用一次，
 * 靠 `[0x48c360]` 这个**资源指针**区分：投注屏载入 Panel#12、開獎屏载入 Panel#15）。
 * 定时器 `SetTimer(…, 0x32, …)` = **50 ms**（VA 0x0043016f）。
 * 状态机 `[0x48c37b]` 走 1..10，跳表在 **`0x004300d0`**（下标 = 状态 − 1）。
 *
 * ★★ **演出脚本全在 core**（`core/places/lottery-ceremony.ts` 的 `lotteryCeremony()`，
 *   文件头那张表就是原版逐拍的次序，每一条带 VA）。本模块**只按它播**：每一步
 *   「擦 → 铺 → 号码球 → 大号数字 → 写字 → 持号表」烤进一块持久表面，
 *   说话时在上面叠字框，动画在上面逐帧叠。
 *
 * ★★ 2026-09-23 第十二份試玩回報（「動畫順序和原版不一樣，也沒展現出本期開獎號碼」）的根因与订正：
 *   1. **本期号码根本没有来源**：没人中奖时号码表与公库都原样，先前从 `before → after`
 *      反推不出号码，只好「当 0 号播」（两颗球画成 00）；有人中奖时又把**槽号**当成号码
 *      贴球（07 号的票，球上是 06）。现在号码由 core 在开奖那一刻交出来
 *      （`GameState.lastLotteryDraw`），球上是 `%02d` 的**槽号 + 1**；
 *      并补上原版开号那一拍**屏幕正中的大号绿字**（`Data.mkf#517` 图 8..17，
 *      @source 0x00430c88–0x00430cf4）—— 先前整个没画。
 *   2. **开场白被分紅屏吃掉**：15 号那天分紅屏先上（原版如此），本屏却在 `event()`
 *      那一刻就起算计时 —— 分紅屏占着的那 3 秒里开场白的 2 秒早过完了，本屏一上屏
 *      就直接跳到「現在馬上為您開出…」（env.log 里从来没有 `#0017` 那句）。BGM 也在
 *      分紅屏还没收的时候就换了。现在**真正上屏那一拍**才起算（与 `shares-screen.ts`
 *      的 `shownAt` 同一个做法），开场白与 `midi09` 都从那一刻开始。
 *   3. **得主揭晓抢在「本月份的得主是．．．。」之前**：原版说这句时屏上只有开出来的号码，
 *      说完才换姿势、出红爆炸框、写得主名、起礼花（0x00430485）；先前这些与那句话同一拍出现。
 *   4. **空号那两句写错了框**：原版把字框换成**黄色爆炸框**、「SORRY！…」与
 *      「獎金將累積到下個月…」写在屏幕正中的框里（0x00430d99），先前把爆炸框当成一张
 *      永久贴图、字仍写在右上的气泡里；而且开号与「SORRY」之间那 0.5 秒停顿没了。
 *   5. **主持人换姿势的几处全抄错**：擦除矩形最后两参是**宽高**（`0x455e24` 按
 *      `[ebp+0x24]/[ebp+0x28]` 当宽高裁剪），先前当成「开区间端点」又把 `fcn_00456418`
 *      （贴图）读成了擦除 —— 摊手那张被挪到 472（身子右移 54 点、被屏幕右缘切掉），
 *      收尾那几步擦的也不是原版那几块。现在逐条照 exe 的调用（见 core 那张表）。
 *   6. 气泡落点是 **(300,47)**（`fcn_0044ec30` 的第 2/3 参），不是 (300,−10)；
 *      而且只在说话时出现（建屏只**设**字框，不画）。
 *   7. 「動畫過程」关掉时原版直接置状态 2（0x004301d4）—— 状态 1 的处理器（0x00430236）
 *      才是说「現在馬上為您開出…」的那一个，所以**两句都不说**，先前只丢了第一句。
 *   8. 两个音效：摇球 57（0x00430471）、公布得主 58（0x004306f3），先前一个都没放。
 *
 * ## 素材
 *
 * | 是什么 | 资源 | @source |
 * |---|---|---|
 * | 舞台／主持人／脸部件／爆炸框／号码球 | `Panel.mkf` **15**（47 张）| 0x00431712 `push 0xf` |
 * | 摇球机 ANM（`LOTOBALL.FLC` 42 帧 275×270）| `Panel.mkf` **16** | 0x0043172f `push 0x10` |
 * | 得主礼花 ANM（`256_S/A01.FLC` 37 帧 280×480）| `Panel.mkf` **17** | 0x00431749 `push 0x11` |
 * | 各人持号表里的小数字牌（12 张）| `Panel.mkf` **13** | 0x00431739 `push 0xd` |
 * | 开号那一拍屏幕中央的大号数字（图 8..17）| `Data.mkf` **517** | 0x0040808f `push 0x205` → `[0x48bad8]` |
 *
 * ## 各人持号表（`fcn_0042f417`，VA 0x0042f417）
 *
 * 四块铭牌 2×2，表 `0x0042f30c`（8 个 dword = 四对 x,y，**每条记录 16 字节**）。
 * 每块上画三样，逐个照 exe：
 *
 * 1. **压暗的底框** 296×60（`fcn_004552e7(…, 0x128, 0x3c, −16)`，@0x0042f482）—— 「四个蓝框」
 * 2. **角色徽章** = `Panel#15` 图 **(25 + 角色号)** → 落 **(铭牌.x+0x14, 铭牌.y+0x1e)**
 *    @source 0x42f4c5 `lea edx, [eax + 0x19]`（图号 = 角色 + 25），锚点自带居中
 * 3. **持号数字** = `Panel#13` 图 `数字`（0..9），起点 **(铭牌.x+0x36, 铭牌.y+0x1e)**、
 *    号码间距 **0x28**、`"%02d"` 的个位在 **+0x10** @source 0x42f55b 起
 *
 * ★ 铭牌上的号码用**开奖前**那一份号码表（`DrawCue.sold`）：原版到**关屏**
 *   才 `memset(0x4990b8, 0, 0x24)`（@0x00430aee，紧接派彩），演出全程都看得见号码。
 *
 * ## 有意偏离（完整版见 `docs/deviations/T-036.md`）
 *
 * 1. **脸的槽（眨眼）改成按帧号推**，不消耗游戏随机流（C-DET-1）；原版 `rand()>>9`。
 * 2. **ANM 一帧 = 定时器一拍 = 50 ms**（见 `ANM_FRAME_MS`）。
 * 3. ~~字框寿命固定 2 秒~~ —— 第十三份試玩回報起照原版 `fcn_0044ee18`：满 2 秒**且**语音不在响才收
 *    （见 `Active.bubbleDown`）；语音只在进步那一拍请求一次（见 `enterStep`）。
 * 4. **铭牌底框的压暗**改写成 **canvas 半透明黑**（`TALLY_FRAME.alpha = 16/32`）。
 * 5. **号码表的清理时机不动 core**：core 在开奖那一下就清，本模块用 `DrawCue.sold` 显示。
 */

import {
  CEREMONY_BASE,
  CEREMONY_BIG_DIGIT_RESOURCE,
  CEREMONY_FRAMES,
  CEREMONY_PANEL,
  CEREMONY_TICK_MS,
  CEREMONY_VOICE_MS,
  ENTRY,
  TALLY_PLATES,
  TALLY_TEXT,
  ballBlits,
  bigDigitBlits,
  lotteryCeremony,
  numberDigits,
  type CeremonyAnim,
  type CeremonyBlit,
  type CeremonyFrameId,
  type CeremonyStep,
} from '@rich4/core';
import { CHARACTERS, LOTTERY, stripVoiceCode } from '@rich4/data';
import { isAlive } from '@rich4/core';
import type { GameState } from '@rich4/core';
import { clerkTextStyle, drawGdiText, font } from './font.ts';
import type { ArchiveName, Sprite } from './assets.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';
import { playVoiceCode, stopVoice, voiceBusy } from './voice-sink.ts';
import { SCREEN_H, SCREEN_W } from './stage.ts';
import { currentSurfaceScale, drawSprite, drawSpriteRegion, flicFrame, type SpriteLike } from './hd-stage.ts';


/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名） */
export type DrawSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 这一屏的全部舞台图素都在 `Panel.mkf` 资源 15 @source 0x00431712 `push 0xf` */
export const DRAW_RESOURCE = CEREMONY_PANEL;
/** 摇球机 ANM @source 0x0043172f `push 0x10` */
export const DRAW_DRUM_RESOURCE = 0x10;
/** 得主礼花 ANM @source 0x00431749 `push 0x11` */
export const DRAW_FLOWER_RESOURCE = 0x11;
/** 持号表的小数字牌 @source 0x00431739 `push 0xd` */
export const DRAW_DIGIT_RESOURCE = 0x0d;
/**
 * 开号那一拍屏幕中央的**大号数字** —— `Data.mkf` 资源 **517** 的图 8..17（数字 0..9）。
 * ★ 与下面那段注释里的「对话框底板」是**同一张资源**（图 0..3 是底板、6 是气泡），
 *   这里用的是它的图 8..17；持号表仍然一次都不取它。@source 0x00430c88–0x00430cf4
 */
export const DRAW_BIG_DIGIT_RESOURCE = CEREMONY_BIG_DIGIT_RESOURCE;
// ★★ W-68-a 删掉了 `DRAW_PORTRAIT_RESOURCE = 0x205`（连同 `drawTally` 里那一步）：
//   `Data.mkf #0x205` 的图 0..3 **不是人像条**，是四块带尖角的**对话框底板**
//   （189×116，锚点分别在四个角）—— 它们属于 `player_say` 那一段（W-50 的气泡图
//   就是同一张资源的图 6），不是持号表。原版 `fcn_0042f417` 每个人只画三样：
//   ① 压暗的 296×60 底框（`fcn_004552e7(…, 0x128, 0x3c, −16)`）、
//   ② `Panel#15` 图 `25 + 角色号` 的徽章（`0x0042f4b1 mov al,[player+0x13] /
//      lea edx,[eax+0x19]`）、③ 号码数字 —— **没有第四样**。
//   先前那一步就是第六份回报里「一进去四个空白对话框」的来源。

/** 人像条与徽章相对铭牌的落点 @source 0x0042f4b0 的 `+0x14` / `+0x1e` */
export const TALLY_ART_AT = { dx: 0x14, dy: 0x1e } as const;

/**
 * 铭牌那块**压暗的底框**（296×60）—— 「四个蓝框」就是它，不是资源里的图。
 *
 * @source `fcn_0042f417` 每画一个人之前先调
 *   `fcn_004552e7(surface, 铭牌.x, 铭牌.y, 0x128, 0x3c, -16)`（@0x0042f482–0x0042f49e）：
 *   `fcn_004552e7` 是**换色表**操作（@0x004552e7 起），最后一个参数是
 *   `[0x485d68] + (−16 << 5)` —— 一张 256 色 × 2 字节 = 512 字节的表，
 *   `−16` ⟹ 5 位分量**减半**（同一族操作见 `board-screen.ts` 的 `PRESS_ALPHA`、
 *   `options-pages.ts` 的 `HOTKEY_PRESS.edgeAlpha`）。
 *
 * ⚠️ 本引擎每帧整屏重画，所以这里是**按同样的观感重画一遍**（canvas 半透明黑），
 *   不是原版那种就地改像素。登记在 `docs/deviations/T-036.md`。
 */
export const TALLY_FRAME = { w: 0x128, h: 0x3c, alpha: 16 / 32 } as const;

/** 铭牌底框的落点 —— 就是铭牌本身（`fcn_004552e7` 收的是表里那对 x,y）*/
export function tallyFrameAt(player: number): { x: number; y: number } | null {
  const at = TALLY_PLATES[player];
  return at === undefined ? null : { x: at[0], y: at[1] };
}

/**
 * 每个动画状态都把「持号表」那一整条带擦掉再重画（core 脚本的
 * `CLEAR_PLATES_BAND` 就是这一片，两处同值）。
 * @source `fcn_0042f417` 的调用点 0x43025b / 0x4304f4 / 0x4309c9 / 0x430a3a
 *   与 `fcn_0042f417` 里 `fcn_0042f6ab` 的那一片拷贝（源 = 底图 0，
 *   目标 = (0x10, 0x154)，`x1/y1 = 0x270/0x1d6` 即 608×130）
 */
export const TALLY_BAND = { x: 0x10, y: 0x154, w: 0x260, h: 0x82 } as const;


// ============================================================
//  察觉「刚开了奖」
// ============================================================

/** 一次開獎的演出内容 */
export interface DrawCue {
  /** 中奖号的**槽号** 0..35（屏上显示 `number + 1`）*/
  number: number;
  /** 得主下标；没人中奖为 `null` */
  winner: number | null;
  /** 屏上「累積獎金」那一格 = 开奖那一刻的公库（有人中奖时也就是他拿走的数）*/
  prize: number;
  /** **开奖前**的号码表（铭牌用；原版到关屏才清）*/
  sold: readonly number[];
  /** 中奖号原本是谁的（与 `winner` 同值），`null` = 没人买 */
  owner: number | null;
}

/**
 * 刚刚是不是「開獎那一下」。
 *
 * ★★ 第十二份試玩回報：判据改成读 core 交出来的 `lastLotteryDraw`（纯表现提示，只活一条
 *   action）。先前从 `before → after` 反推 —— **没人中奖那一支根本推不出号码**
 *   （号码表与公库都原样），于是「当 0 号播」，屏上从来看不到本期开的是几号。
 *
 * @source 原版在日期推进里判 `(日期 & 0xff) == 15`（VA 0x0041d08a），
 *   随后 `call 0x431712` 开屏；一张票都没卖出去时那个循环直接返回
 *   （VA 0x00431729），屏根本不建 —— core 那时也不写提示。
 *
 * @param before 这条 action 之前的状态
 * @param after  这条 action 之后的状态
 */
export function lotteryDrawCue(before: GameState, after: GameState): DrawCue | null {
  const hint = after.lastLotteryDraw ?? null;
  if (hint === null || hint === (before.lastLotteryDraw ?? null)) return null;
  return {
    number: hint.number,
    winner: hint.winner,
    prize: hint.pool,
    sold: [...hint.sold],
    owner: hint.winner,
  };
}

// ============================================================
//  纯函数：各人持号表
// ============================================================

/**
 * 把某个玩家持有的号码拼成 `"%02d"` 串。
 * @source 0x0042f4e8 起的 `sprintf(buf, "%02d", n + 1)` + `strcat`
 */
export function tallyString(lottery: readonly number[], player: number): string {
  let out = '';
  for (let n = 0; n < lottery.length; n++) {
    if ((lottery[n] ?? 0) === player + 1) out += String(n + 1).padStart(2, '0');
  }
  return out;
}

/** 一行最多放几个字符 @source 0x42f543 的 `cmp eax, 0xc / jg` */
export const TALLY_LINE_CHARS = 0x0c;
/** 折行后第二行相对第一行的 y 偏置 @source 0x42f68e 的 `add [esp+0x6c], 0x1e` */
export const TALLY_LINE_DY = 0x1e;
/** 数字牌之间的间距 @source 0x42f696 的 `add esi, 0x28` */
export const TALLY_PITCH = TALLY_TEXT.pitch;
/** 一个号码的两位数字相距 @source 0x42f64f 的 `lea eax, [esi + 0x10]` */
export const TALLY_DIGIT_DX = 0x10;

/** 一个数字牌要落的位置 */
export interface DigitAt {
  /** 是号码的哪一位（0 = 十位、1 = 个位）*/
  digit: number;
  x: number;
  y: number;
}

/**
 * 把 `"%02d"` 串摊成一张张数字牌。
 *
 * @source 0x0042f55b（一行内）与 0x0042f5e9（折行）：
 * 起点 `铭牌 + (0x36, 0x1e)`，每两位数字步进 `0x28`、第二位移 `0x10`；
 * 超过 `0xc` 个字符才折行，折行后 y 再加 `0x1e`。
 *
 * ★ `player` 与 `plate` 是**两个号**：前者决定读谁持有的号码，后者决定落在第几块
 *   铭牌上（原版出局的人不占铭牌，见 `drawTally`）。默认两者相同。
 */
export function tallyDigits(lottery: readonly number[], player: number, plate = player): DigitAt[] {
  const text = tallyString(lottery, player);
  const at = TALLY_PLATES[plate];
  if (at === undefined) return [];
  const out: DigitAt[] = [];
  const n = Math.min(text.length, TALLY_LINE_CHARS * 2);
  for (let i = 0; i < n; i += 2) {
    const row = i >= TALLY_LINE_CHARS ? 1 : 0;
    const col = i - row * TALLY_LINE_CHARS;
    const x = at[0] + TALLY_TEXT.dx + (col / 2) * TALLY_PITCH;
    const y = at[1] + TALLY_TEXT.dy + row * TALLY_LINE_DY;
    out.push({ digit: Number(text[i] ?? '0'), x, y });
    if (i + 1 < n) out.push({ digit: Number(text[i + 1] ?? '0'), x: x + TALLY_DIGIT_DX, y });
  }
  return out;
}

/** 某人的角色徽章（`Panel#15` 的图号）@source 0x42f4c5 `lea edx, [eax + 0x19]` */
export function badgeEntry(character: number): number {
  return ENTRY.badge + character;
}

/** 徽章 / 人像条落点 —— 就是铭牌坐标本身（表里存的是「舞台坐标 − 0x14/−0x1e」）*/
export function tallyArtAt(player: number): readonly [number, number] | null {
  return TALLY_PLATES[player] ?? null;
}

// ============================================================
//  ANM 的节拍
// ============================================================

/**
 * 開獎屏里 ANM **一帧多久**（毫秒）—— 就是屏的定时器周期 **50 ms**（第八份试玩回报 #7）。
 *
 * ★★ 2026-09-22 订正。先前写的是 880 ms（`0x370`），来自把 `[0x48c864]` 读成「起始延时」——
 *   那是**错的**：`0x00450ea5 mov eax,[0x48a060]`（后台面的 pitch，`0x004016b3` 从表面描述取）/
 *   `0x00450eb1 mov [0x48c864],0x500`（= 1280 = 640 × 2 字节，pitch 的缺省）→
 *   `0x00450ebb imul esi,[0x48c864] / add esi,edi*2 / mov [0x48c848],esi` 算的是**落点的字节偏移**，
 *   与时间无关。于是摇球被拖成 42 × 880 ≈ 37 秒（需求方：「彩球滚动太慢，卡了很久」）。
 *
 * 真正的每帧延时在 `[0x48c870]`（`0x00450d75` 从 FLIC 头 `+0x10` 读，`flags` 高半字节非 0 时
 * `0x00450eea` 改成 `((flags>>4)&0xf)×10`）—— 但**只有阻塞播放器** `fcn_0045144f` 的循环
 * （`0x00451513 cmp esi,[0x48c870]`）读它。開獎屏**不走那条路**：它 `0x0043038a call 0x450ced(影片, 0xb7, 0x4b, 8)`
 * 起 ANM 后，在自己的 **`WM_TIMER`（`SetTimer(…, 0x32)`，50 ms）** 里每一拍 `0x00430351 call 0x450f04`
 * 推进**一帧**（`fcn_00450f04` 本身不看时间）。⇒ 一帧 = 一拍 = 50 ms：摇球 42 帧 ≈ 2.1 秒、礼花 37 帧 ≈ 1.9 秒。
 */
export const ANM_FRAME_MS = CEREMONY_TICK_MS;

/** `tick` 这一刻该播第几帧；放完返回 `nFrames − 1` */
export function anmFrameAt(now: number, start: number, nFrames: number, loop = false): number {
  if (nFrames <= 0) return 0;
  const elapsed = now - start;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
  const n = Math.floor(elapsed / ANM_FRAME_MS);
  return loop ? n % nFrames : Math.min(n, nFrames - 1);
}

/** 这一段放完了没有 @source `fcn_00450f04` 返回 0 = 完 */
export function anmDone(now: number, start: number, nFrames: number): boolean {
  return now - start >= nFrames * ANM_FRAME_MS;
}

// ============================================================
//  纯函数：脸（眨眼 / 嘴）
// ============================================================

/**
 * 两个主持人的脸是**贴片拼的**：`0x48c350` 一个 dword 当调色盘，
 * 低 4 位 = 当前在动的那一个槽，其余每个 4 位段 = 该槽的帧号。
 *
 * | 槽 | 贴片矩形 (x0,y0)-(x1,y1) | 帧表（图号）| 抽中的概率 |
 * |---|---|---|---|
 * | 1 | 右眼 (512,**102**)-(562,**118**) | 8,7,8,10 | 1/64 @source 0x00431117 |
 * | 2 | 左眼 (52,**89**)-(102,**115**) | 16,17,16,15 | 1/64 @source 0x00431138 |
 * | 3 | 右眼变体 | 9,10 | 2/64 @source 0x00431141 |
 * | 4 | 左眼变体 | 14,15 | 2/64 @source 0x0043114a |
 *
 * 帧表本体在 `0x00475660`（dump 出来 = `3 4 3 | 8 7 8 10 | 16 17 16 15 | 31 | 0 0 0 0 0 0 0 | ff ff ff ff`）：
 * 槽 2 的表在 **+3**、槽 3 在 **+7**、槽 4 在 **+10**、槽 5 在 **+12**。
 *
 * ★ 原来的表把**前两项对调**了：槽 1（低 4 位 = 1）读的是表 +3 = `8,7,8,10`，
 *   槽 2（低 4 位 = 2）读的是表 +7 = `16,17,16,15` —— 本模块按这个来。
 *
 * ⚠️ 2026-09-18 订正：上表先前的 y 写成 `510..535` / `524..548`（那是把
 *   `0x66`/`0x59` 当十进制 %d 之类读出来的错值）。exe 逐字：
 * ```asm
 * 00431166  mov  dword ptr [esp + 0x64], 0x200   ; x0 = 512
 * 0043116e  mov  dword ptr [esp + 0x68], 0x66    ; y0 = 102
 * 00431176  mov  dword ptr [esp + 0x6c], 0x232   ; x1 = 562
 * 0043117e  mov  dword ptr [esp + 0x70], 0x76    ; y1 = 118
 * 00431231  mov  dword ptr [esp + 0x64], 0x34    ; 左眼 x0 = 52
 * 00431239  mov  dword ptr [esp + 0x68], 0x59    ; y0 = 89
 * 00431241  mov  dword ptr [esp + 0x6c], 0x66    ; x1 = 102
 * 00431249  mov  dword ptr [esp + 0x70], 0x73    ; y1 = 115
 * ```
 *   ★ 真正用到的只有**左上角**：`0043119c mov ecx,[esp+0x68] / push ecx`（=y0）
 *   与 `004311a1 mov edi,[esp+0x68]`（push 之后 = 旧 `[esp+0x64]` = x0）`/ push edi`
 *   → `call 0x4563f5(dst, src, x0, y0)`；**尺寸由 sprite 记录自带**。
 *   所以「四角是闭区间端点、宽度 = x1−x0+1」这句**不适用于这两个调用点**。
 */
export const FACE_SLOT_RECT = {
  right: [0x200, 0x66, 0x232, 0x76],
  left: [0x34, 0x59, 0x66, 0x73],
} as const;

/** 槽 1..5 的帧表 @source `0x00475660`+0 = `31,0`、+3 = 槽 2、+7 = 槽 3、+10 = 槽 4 */
export const FACE_SLOT_FRAMES: readonly (readonly number[])[] = [
  [], // 0 = 空档（表 +0 那两字节是 `0x1f`/`0`，不是帧表）
  [8, 7, 8, 10], // 槽 1 → 表 +3
  [16, 17, 16, 15], // 槽 2 → 表 +7
  [9, 10], // 槽 3 → 表 +10
  [14, 15], // 槽 4 → 表 +12
];

/** 每个槽的帧数与「该槽结束」的条件位（主 nibble 的下一位）@source 0x00431157 `/ 00431222` */
const FACE_SLOT_BIT = [0, 1, 2, 4, 8] as const;

/** 槽 1..4 各自的贴片矩形（取低 4 位的槽号）*/
function slotRect(slot: number): readonly [number, number, number, number] {
  return slot === 1 || slot === 3 ? FACE_SLOT_RECT.right : FACE_SLOT_RECT.left;
}

/** 右主持人的嘴 @source 0x00431447 的 `0x200/0x77/0x232/0x8d`；静止图 11、动图 12/13 */
export const FACE_MOUTH_RECT = [0x200, 0x77, 0x232, 0x8d] as const;
export const FACE_MOUTH_REST = 11;

export interface FaceCtl {
  /** `[0x48c350]` */
  ctl: number;
  /** `[0x48c34c]`（嘴的倒数）*/
  mouth: number;
  /** 上一帧的槽（查表用，等价于 `ctl & 0xf`）*/
  slot: number;
  /** 上一次推进的脸帧号（避免一帧内推进两次）*/
  tick: number;
}

export function faceCtlStart(): FaceCtl {
  return { ctl: 0, slot: 0, mouth: 0, tick: -1 };
}

/** 贴片：图号 + 落点（锚点 (0,0)，所以落点就是矩形左上角）*/
export interface FaceBlit {
  entry: number;
  at: readonly [number, number];
}

/**
 * 推进一帧脸。
 *
 * @param rnd 取 `[0,1)` 的随机数（原版是 `_libc_rand()`，注入进来只为单测能钉死）
 *
 * ★ **原版是 `rand()>>9` 抽的**（`0x00431117` 一带）：落 0 / 1 / 2-3 / 4-5 时
 *   分别启动槽 1/2/3/4，其余 58/64 不动 —— 平均 0.9 秒才跳一次。这里改成
 *   **按帧号推**（用同一个 `hash32`，与 `core` 的 `facePartsAt` 同源），
 *   不是改良：动画不该消耗游戏随机流（C-DET-1）。每个槽的**触发概率**照抄。
 *
 * ★ 嘴：`rand() >> 11 < 4`（= 1/512）才换一张，换完 `rand() & 0xf` 决定停几帧；
 *   因为触发率极低，屏上基本看不到它动。照抄。
 */
export function faceStep(f: FaceCtl, tick: number, rnd: () => number): readonly FaceBlit[] {
  const out: FaceBlit[] = [];
  const slot = f.ctl & 0x0f;

  if (slot >= 1 && slot <= 4) {
    const frames = FACE_SLOT_FRAMES[slot]!;
    const idx = (f.ctl & 0xf0) >> 4;
    if (idx < frames.length) {
      // 本帧的贴片
      const r = slotRect(slot);
      out.push({ entry: frames[idx]!, at: [r[0], r[1]] });
      let ctl = f.ctl + 0x10;
      const idx2 = (ctl & 0xf0) >> 4;
      if (idx2 >= frames.length) {
        // 该槽放完了 —— 立 bit（= 表里的 `31`）并等下一轮触发
        ctl |= FACE_SLOT_BIT[slot]! << 4;
        ctl &= 0xf0;
      }
      f.ctl = ctl;
      f.slot = ctl & 0x0f;
    }
  } else if (slot === 0) {
    // `rand() >> 9` 落在 0/1/2-3/4-5 才起一个槽，其余不动
    const roll = Math.floor(rnd() * 64);
    const next = roll === 0 ? 1 : roll === 1 ? 2 : roll < 4 ? 3 : roll < 6 ? 4 : 0;
    if (next !== 0) f.ctl = (f.ctl & 0xf0) | next;
  }

  // 嘴
  if (f.mouth !== 0) {
    f.mouth -= 1;
    if (f.mouth === 0) {
      const r = FACE_MOUTH_RECT;
      out.push({ entry: rnd() < 0.5 ? 12 : 13, at: [r[0], r[1]] });
    }
  } else {
    const roll = Math.floor(rnd() * 2048);
    if (roll < 4) {
      const r = FACE_MOUTH_RECT;
      out.push({ entry: rnd() < 0.5 ? 12 : 13, at: [r[0], r[1]] });
      f.mouth = Math.floor(rnd() * 16) || 1;
    }
  }

  return out;
}


// ============================================================
//  台词与字框
// ============================================================

/**
 * 气泡字框的落点与字心偏移（= core 的 `CEREMONY_FRAMES.bubble`）。
 * @source 建屏 0x0042f7b7–0x0042f7d4：`fcn_0044ec30(图22, 0x12c, 0x2f, −0xa, 0, 0x101010, 0)`
 *   —— 第 2/3 参是**落点** (300,47)，第 4/5 参才是字心偏移 (−10,0)。
 */
export const DRAW_BUBBLE_AT = CEREMONY_FRAMES.bubble.at;
export const DRAW_BUBBLE_TEXT = { dx: CEREMONY_FRAMES.bubble.text[0], dy: CEREMONY_FRAMES.bubble.text[1], size: 0x14 } as const;

/**
 * 字框里字心的位置 = 框左上 + (⌊宽/2⌋, ⌊高/2⌋) + (dx, dy)。
 * @source `fcn_0044ecb6` 0x0044ed7b–0x0044eda6：`movsx [图+2] / sar 1 / add [0x48c60c] / add [0x48c62c]`
 *   （y），x 同理；`[0x48c608]/[0x48c60c]` = 落点 − 锚点（0x0044ec61–0x0044ec7b）。
 */
export function frameTextCenter(
  frame: CeremonyFrameId,
  sprite: { width: number; height: number; anchorX: number; anchorY: number },
): { x: number; y: number } {
  const f = CEREMONY_FRAMES[frame];
  const left = f.at[0] - sprite.anchorX;
  const top = f.at[1] - sprite.anchorY;
  return { x: left + Math.floor(sprite.width / 2) + f.text[0], y: top + Math.floor(sprite.height / 2) + f.text[1] };
}

/**
 * 气泡里的字（`#NNNN` 语音前缀被吃掉）@source `_rich4_draw_text` VA 0x0044fabc 开头
 *
 * ★★ **只剥不播**（第十三份試玩回報「乐透开奖的语音重复」）。先前这里顺手 `playVoiceCode`，
 *   而 `viewOf`（绘制链）**每一帧**都调它 —— 字框挂着的 2 秒里每帧都请求一次语音；
 *   `main.ts` 的去抖只挡「还在响」与「500 ms 内」，于是**短于 2 秒**的那几句
 *   （`#0019` 1.28 s、`#0032` 1.63 s、`#0034` 1.73 s、`#0035` 1.84 s、`#0036` 0.96 s）
 *   一播完就被下一帧重新起播 —— `#0036「行動要快喔！」` 响三遍。
 *   原版 `_rich4_draw_text` 只在字框**画上去那一次**解析 `#NNNN`（`call 0x45441a`），
 *   本屏对应的是进步那一拍（`enterStep`）。
 */
export function bubbleLines(text: string | null): string[] {
  if (text === null) return [];
  return stripVoiceCode(text).split('\n').filter((l) => l !== '');
}

/** 台词串首的语音号；没有返回 `null` */
export function voiceOf(text: string): number | null {
  if (!text.startsWith('#')) return null;
  const n = Number(text.slice(1, 5));
  return Number.isFinite(n) ? n : null;
}

/**
 * 得主名字 —— 28 px 红字，居中的 (320, 180)。
 * @source 0x004306a0 起：`图号 = 角色`、表 `0x00475630`、坐标 `0x140/0xb4`、flag 2
 */
export function winnerName(character: number): string {
  return CHARACTERS[character]?.name ?? '';
}

/** 「累積獎金」标签 */
export const POOL_LABEL = LOTTERY.poolLabel.text;

// ============================================================
//  播放
// ============================================================

/** 一个正在播的 ANM（`fcn_00450ced` 起、`fcn_00450f04` 每拍推一帧）*/
interface Playing {
  resource: number;
  at: readonly [number, number];
  /** 起播那一刻 */
  start: number;
  /** 起播后先停这么多拍才开始推（`CeremonyAnim.delayTicks`）*/
  delayTicks: number;
  /** 帧数（`env.flic()` 是异步的，起播时可能还是 0，之后再补）*/
  frames: number;
  /** 等它的那一步已经放行了（放完，或影片解不出来被死锁保护放过）—— 下一步就把它落定 */
  settled: boolean;
}

/** 这一段开始逐拍推进的时刻 */
function anmRunFrom(p: Playing): number {
  return p.start + p.delayTicks * CEREMONY_TICK_MS;
}

/** 这一段放完了没有（含前面那段停顿）*/
function playingDone(p: Playing, now: number): boolean {
  return p.frames > 0 && now >= anmRunFrom(p) && anmDone(now, anmRunFrom(p), p.frames);
}

interface Active {
  cue: DrawCue;
  steps: readonly CeremonyStep[];
  step: number;
  /**
   * ★★ 真正**上屏**了没有（第十二份試玩回報）。
   *
   * 15 号那天分紅屏排在本屏前面（原版 0x0041d08f 先 `call 0x42ba97`、0x0041d094 才
   * `call 0x431712`），`event()` 却是同一条 action 里一起派的 —— 本屏**等到第一次收到
   * `tick`**（= 自己是接管整屏的那一屏）才起算计时、说第一句、换 BGM。
   */
  shown: boolean;
  /** 第一次轮到本屏（收到 `tick`）是什么时候 —— 等素材到货的兜底从这里算；−1 = 还没轮到 */
  waitSince: number;
  /** 当前这一步是什么时候进来的 */
  at: number;
  /** 当前这一步的话是什么时候说的 */
  said: number;
  /**
   * ★★ 这一步的字框**已经收掉**了没有 —— 原版 `fcn_0044ee18(0)`（VA 0x0044ee18）：
   * ```asm
   * 0044ee4e  cmp  eax, 0x7d0 / jb 0x44ee5f           ; 不满 2000 ms → 还挂着
   * 0044ee63  cmp  byte [0x49715b], 0 / je 0x44ee76    ; 音效档关着 → 到期
   * 0044ee6c  call 0x4544b9 / mov [0x4762c4], eax      ; 语音还在响 → 继续挂着
   * ```
   * ⇒ 挂 **max(2000 ms, 语音时长)**；`0x004301e8..0x00430215` 等它返回非 0 才进下一状态。
   * 由 `tick` 置位（`draw` 只读），`enterStep` 清零。「音效档关着」那道闸在 `voiceBusy()` 里。
   */
  bubbleDown: boolean;
  /** 这一步的语音已经请求过几次（进步那一次 + 至多一次兜底，见 `DRAW_VOICE_MAX_ASKS`）*/
  voiceAsks: number;
  /** 最近一次请求语音的时刻 */
  voiceAt: number;
  /** 这一步的语音**响起来过**没有（`tick` 看到 `voiceBusy()` 为真就置位）—— 响过就不再兜底 */
  voiceHeard: boolean;
  /** 现在的字框（`fcn_0044ec30` 最近一次设的那一种）*/
  frame: CeremonyFrameId;
  face: FaceCtl;
  /** 最新的脸贴片快照 —— `tick` 推进，`draw` 只读 */
  faceBlits: readonly FaceBlit[];
  drum: Playing | null;
  flower: Playing | null;
  /**
   * ★★ W-68-b：**持久的离屏表面**（640×480）。
   *
   * 原版整屏就是这么一块：建屏时画一次（底图 + 两位主持人 + 「累積獎金」+ 金额 +
   * 持号表），之后每个状态只在上面**擦一块、补一块**，前面画的都还在。
   */
  surface: CeremonySurface | null;
  /**
   * 已经**烤进表面**的最后一步。
   *
   * ★ 初值 **−2** = 「什么都还没烤」—— 第 **−1** 步是**建屏**那一步
   *   （底图 + 主持人 + 奖金 + 持号表），所以要烤的下一个下标是 `applied + 1 = −1`。
   */
  applied: number;
  /** 开场就定下的一份「谁在场 / 各人角色号」快照（持号表每次都照它重画）*/
  characters: readonly number[];
  alive: readonly boolean[];
  /** 同一步连着几帧没烤成（图没到货）—— 用来给 `CEREMONY_BAKE_RETRIES` 计数 */
  bakeTries: number;
}


/**
 * 同一步最多等几帧「图到货」（`TICK`/帧率都是 50–60，30 帧 ≈ 半秒）。
 * 超过就照烤 —— 见 `applyStep` 的 `force`。
 */
export const CEREMONY_BAKE_RETRIES = 30;

/** 离屏表面 —— 能拿到 `CanvasRenderingContext2D` 就行 */
export interface CeremonySurface {
  readonly canvas: CanvasImageSource;
  readonly ctx: CanvasRenderingContext2D;
}

/**
 * 造一块表面 —— 优先 `OffscreenCanvas`，退回 `<canvas>`；两者都没有返回 `null`
 * （Node 下的单测就是这种情形，走 `setCeremonySurfaceFactory` 注入假表面）。
 */
function defaultSurface(): CeremonySurface | null {
  // ★ 高清舞台：表面按**建它那一刻**的离屏倍率开像素、挂变换（`hd-stage.ts`）；
  //   贴回舞台时按逻辑 640×480 贴（`drawCeremonySurface`），中途倍率变了也不会错位。
  //   倍率为 1 时一行不多做 —— 与改造前相同。
  const s = currentSurfaceScale();
  const scaled = (ctx: CanvasRenderingContext2D): CanvasRenderingContext2D => {
    if (s !== 1) {
      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.imageSmoothingEnabled = false;
    }
    return ctx;
  };
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(Math.round(SCREEN_W * s), Math.round(SCREEN_H * s));
    const ctx = c.getContext('2d');
    if (ctx !== null) return { canvas: c as unknown as CanvasImageSource, ctx: scaled(ctx as unknown as CanvasRenderingContext2D) };
    return null;
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = Math.round(SCREEN_W * s);
    c.height = Math.round(SCREEN_H * s);
    const ctx = c.getContext('2d');
    if (ctx !== null) return { canvas: c, ctx: scaled(ctx) };
  }
  return null;
}

/** 把持久表面贴回舞台 —— 表面比 640×480 大（高清舞台）就按逻辑尺寸塞回去 */
function drawCeremonySurface(ctx: CanvasRenderingContext2D, surface: CeremonySurface): void {
  const w = (surface.canvas as { width?: unknown }).width;
  if (typeof w === 'number' && w !== SCREEN_W) ctx.drawImage(surface.canvas, 0, 0, SCREEN_W, SCREEN_H);
  else ctx.drawImage(surface.canvas, 0, 0);
}

let surfaceFactory: () => CeremonySurface | null = defaultSurface;

/** ★ 给单测注入假表面（生产代码不调）—— 与 `main.ts` 的 `__devHits` 同一类口子 */
export function setCeremonySurfaceFactory(f: (() => CeremonySurface | null) | null): void {
  surfaceFactory = f ?? defaultSurface;
}


let active: Active | null = null;

/** 本屏现在在不在播 */
export function lotteryDrawActive(): boolean {
  return active !== null;
}

/** 当前演到第几步 / 是哪一步（单测用）*/
export function lotteryDrawStep(): number {
  return active?.step ?? -1;
}

export function lotteryDrawPhase(): number {
  return active?.steps[active.step]?.state ?? -1;
}

export function resetLotteryDrawScreenState(): void {
  active = null;
}

/**
 * 「動畫過程」关掉时要丢掉哪几步。
 *
 * @source `loc_004301b0`（VA 0x004301b0，開獎屏 `0x405` 那一支）：
 * ```asm
 * 004301b0  cmp byte [0x497159], 0      ; ★ RICH4.CFG+1 = 「動畫過程」
 * 004301b7  je  short loc_004301d4
 * 004301b9  mov byte [0x48c37b], 1      ; 开：状态 1，说 `#0017`
 * 004301c0  mov edx, [0x475610]
 * 004301c7  call 0x44ecb6
 * 004301d4  mov byte [0x48c37b], 2      ; 关：**直接落在状态 2**，一句不说
 * ```
 * ★ 状态 1 的处理器（跳表第 0 项 `0x00430236`）才是说「現在馬上為您開出這一期的號碼」
 *   并置 2 的那一个；关掉时根本走不到它，下一拍直接进状态 2 的处理器（`0x0043036c`，起摇球）。
 *   ⇒ 关掉时**开场白与报幕两句都不说**（脚本里 `state` 为 1 与 2 的那两步）。
 */
export function ceremonyStepsFor(
  steps: readonly CeremonyStep[],
  animate: boolean,
): readonly CeremonyStep[] {
  return animate ? steps : steps.filter((s) => s.state !== 1 && s.state !== 2);
}

/** 察觉开奖：把脚本排好，**不起算**（等真正上屏的那一拍，见 `Active.shown`）*/
function begin(cue: DrawCue, env: UiScreenEnv): void {
  const all = lotteryCeremony({
    number: cue.number,
    winner: cue.winner,
    prize: cue.prize,
    lottery: [],
    pool: cue.winner === null ? cue.prize : 0,
    rigged: false,
  });
  const steps = ceremonyStepsFor(all, env.animation !== false);
  if (steps.length === 0) return;
  active = {
    cue,
    steps,
    step: 0,
    shown: false,
    waitSince: -1,
    at: env.now,
    said: env.now,
    bubbleDown: false,
    voiceAsks: 0,
    voiceAt: env.now,
    voiceHeard: false,
    frame: CEREMONY_BASE.frame ?? 'bubble',
    face: faceCtlStart(),
    faceBlits: [],
    drum: null,
    flower: null,
    surface: surfaceFactory(),
    applied: -2,
    characters: env.state.players.map((p) => p.character),
    alive: env.state.players.map((p) => isAlive(p)),
    bakeTries: 0,
  };
  // 分紅屏占着的那几秒正好用来把这一屏的素材叫起来（异步解，到货会自己请求重画）
  ceremonyAssetsReady(active, env);
}

/**
 * 等素材到货最多等多久（从第一次轮到本屏算）—— 过了就照常起播（缺哪张少哪张）。
 * 引擎自己的兜底（原版同步读档，不会等）：一张永远解不出来的图不能把整局钉死在黑屏上。
 */
export const CEREMONY_LOAD_WAIT_MS = 10_000;

/** 真正上屏的那一拍：起算计时、换 BGM、进第一步 */
function show(a: Active, env: UiScreenEnv): void {
  a.shown = true;
  // ★ 樂透開獎屏的配乐 @source `ui_letou.asm:3063` `push 8 / call fcn_004549cf`
  //   ⇒ id 8 → `MIDI09.MID` → 磁盘名 `midi09.mid`（见 `SCREEN_BGM.lotteryDraw`）。
  //   ★ 放在**上屏**这一拍：原版 `0x004317a9` 在分紅屏（`0x0041d08f`）返回之后才点这首。
  env.music?.('midi09.mid');
  enterStep(a, env);
}

/** 进入 `a.step` 这一步：起算、换字框、说话（记日志）、放音效、起 ANM */
function enterStep(a: Active, env: UiScreenEnv): void {
  const step = a.steps[a.step];
  a.at = env.now;
  a.said = env.now;
  a.bubbleDown = false;
  a.voiceAsks = 0;
  a.voiceAt = env.now;
  a.voiceHeard = false;
  if (step === undefined) return;
  if (step.frame !== undefined) a.frame = step.frame;
  if (step.line !== null) {
    // ★★ 语音**只在这里**请求一次（字框画上去那一拍，`0x0044fabc` → `0x45441a`）；
    //   绘制链只剥不播（见 `bubbleLines`）。
    playVoiceCode(step.line.text);
    a.voiceAsks = 1;
    env.log(`樂透開獎：${bubbleLines(step.line.text).join('')}`);
  }
  if (step.sound !== undefined) env.playEffect(step.sound);
  startAnim(a, step.anim, env);
}

/** 这一步要起的 ANM（摇球 / 礼花）—— 帧数靠 `env.flic` 现问，问不到先记 0、之后再补 */
function startAnim(a: Active, anim: CeremonyAnim | null, env: UiScreenEnv): void {
  if (anim === null) return;
  const film = env.flic('Panel.mkf', anim.panel);
  const playing: Playing = {
    resource: anim.panel,
    at: [anim.at[0], anim.at[1]],
    start: env.now,
    delayTicks: anim.delayTicks,
    frames: film?.frames.length ?? 0,
    settled: false,
  };
  if (anim.panel === DRAW_FLOWER_RESOURCE) a.flower = playing;
  else a.drum = playing;
}

/** 推进一帧脸 @source 每 50 ms 那一拍调一次（`0x00431431` 那一支）*/
function tickFace(a: Active, env: UiScreenEnv): void {
  const tick = Math.floor(env.now / CEREMONY_TICK_MS);
  if (tick === a.face.tick) return;
  a.face.tick = tick;
  a.faceBlits = faceStep(a.face, tick, Math.random);
}

/**
 * ★★ 单步**最多**停多久 —— 过了就无条件往前走（死锁保护）。
 *
 * 为什么必须有：`holdDone` 里「等 ANM 放完」那条判据依赖 `env.flic()` 解出帧数。
 * `main.ts` 的 `uiFlicNow` 会把**解不出来**的结果缓存成 `null`，于是
 * 帧数永远是 0 —— 屏就永远关不掉，而演出闸（`BLOCKING_PRESENTATIONS`）会把整局钉死在这里。
 *
 * 取值 **90 000 ms**：正常一步最长几秒（摇球 20 拍 + 42 帧 × 50 ms ≈ 3.1 秒），
 * 这条闸只在「影片根本解不出来」时兜底，正常演出永远碰不到。
 */
export const CEREMONY_STEP_MAX_MS = 90_000;

/**
 * 这一刻该不该往下一步走 @source 0x004301e8 的「气泡收掉才走下一步」，
 * 加上 `0x0043024c` / `0x00430f43` 那两处「数够拍」与「等 ANM 放完」。
 */
function holdDone(a: Active, env: UiScreenEnv): boolean {
  const step = a.steps[a.step];
  if (step === undefined) return true;
  // ★★ 死锁保护：影片解不出来时那条「等 ANM 放完」会永远为假（见 `CEREMONY_STEP_MAX_MS`）
  if (env.now - a.at >= CEREMONY_STEP_MAX_MS) return true;
  const h = step.hold;
  if (h.pauseMs !== undefined && env.now - a.at < h.pauseMs) return false;
  if (h.ticks !== undefined && (env.now - a.at) / CEREMONY_TICK_MS < h.ticks) return false;
  if (h.anim === true) {
    for (const p of [a.drum, a.flower]) {
      if (p === null) continue;
      // ⚠️ `env.flic()` 是**异步**的：起播那一刻多半还是 null，帧数要等它解好再补。
      //    解不出来（恒 0）就不拿它挡路 —— 否则屏再也关不掉。
      if (p.frames === 0) p.frames = env.flic('Panel.mkf', p.resource)?.frames.length ?? 0;
      if (p.frames > 0 && !playingDone(p, env.now)) return false;
    }
  }
  if (h.voice === true && step.line !== null && !a.bubbleDown) return false;
  return true;
}

/**
 * 同一句语音**兜底再请求一次**的最小间隔（ms）与总次数上限 —— 与魔法屋
 * `MAGIC_VOICE_RETRY_MS` / `MAGIC_VOICE_MAX_ASKS` 同值、同用途。
 *
 * 引擎自己的兜底（原版同步读档，不会漏）：桌面版 `Speaking.mkf`（57 MB）是按需拉的，
 * 进步那一拍若还没到货，那一次请求会被 `SoundPlayer.play` 安静丢掉。
 * 只在这一句**从没响起来过**时补一次：`tick` 每拍看 `voiceBusy()`，看到在响就记下
 * `voiceHeard`，之后永不再补 —— 否则短于 2 秒的句子念完、字框还挂着时又会被补一遍
 * （正是这份回报的毛病）。本屏最短的 `#0036` 也有 963 ms，500 ms 前必被看到在响。
 */
export const DRAW_VOICE_RETRY_MS = 500;
export const DRAW_VOICE_MAX_ASKS = 2;

/** 字框还挂着、语音却没在响、满 `DRAW_VOICE_RETRY_MS` ⇒ 再请求一次（至多一次）*/
function tickVoiceRetry(a: Active, env: UiScreenEnv): void {
  const line = a.steps[a.step]?.line ?? null;
  if (line === null || a.bubbleDown || a.voiceHeard) return;
  if (voiceBusy()) {
    a.voiceHeard = true;
    return;
  }
  if (a.voiceAsks === 0 || a.voiceAsks >= DRAW_VOICE_MAX_ASKS) return;
  if (env.now - a.voiceAt < DRAW_VOICE_RETRY_MS) return;
  a.voiceAsks += 1;
  a.voiceAt = env.now;
  playVoiceCode(line.text);
}

/**
 * 字框到期没有 —— `fcn_0044ee18(0)`：满 `CEREMONY_VOICE_MS` **且**语音不在响（见 `Active.bubbleDown`）。
 * 一旦收掉就不再挂回去（原版把 `[0x4762c4]` 清 0）。
 */
function tickBubble(a: Active, env: UiScreenEnv): void {
  if (a.bubbleDown) return;
  if (env.now - a.said < CEREMONY_VOICE_MS) return;
  if (voiceBusy()) return;
  a.bubbleDown = true;
}

/** 推进一步 */
function advance(a: Active, env: UiScreenEnv): void {
  // 刚放行的这一步若是在等 ANM，那段 ANM 就算落定了（下一步烤进表面，见 `bakeFinishedAnims`）
  if (a.steps[a.step]?.hold.anim === true) {
    if (a.drum !== null) a.drum.settled = true;
    if (a.flower !== null) a.flower.settled = true;
  }
  a.step += 1;
  if (a.steps[a.step] === undefined) {
    env.log('樂透開獎：演出结束');
    active = null;
    return;
  }
  enterStep(a, env);
}

// ============================================================
//  绘制（只做 IO）
// ============================================================

/** 抠黑画（`fcn_00456418`：索引 0 透明）/ 不透明画（`fcn_004563f5`）—— 位图已带透明，同一个调用 */
function drawWhole(ctx: CanvasRenderingContext2D, s: Sprite | null, x: number, y: number): void {
  if (s === null) return;
  drawSprite(ctx, s, x - s.anchorX, y - s.anchorY);
}

/**
 * 铺一张（整张扣锚点；一块 = `fcn_00456495` / `fcn_0045643d`，**不扣锚点**、按宽高裁）。
 * 源矩形越出子图的部分不画（原版是线性越界读，不照抄），落点越出舞台的部分由画布裁掉。
 */
function blit(ctx: CanvasRenderingContext2D, s: Sprite | null, b: CeremonyBlit): void {
  if (s === null) return;
  if (b.src === undefined) {
    drawWhole(ctx, s, b.at[0], b.at[1]);
    return;
  }
  const c = clipSrc(b.src, s.width, s.height);
  if (c === null) return;
  drawSpriteRegion(ctx, s, c.sx, c.sy, c.w, c.h, b.at[0], b.at[1], c.w, c.h);
}

/** 源矩形 `[sx, sy, w, h]` 夹到子图里（**宽高**口径，不是端点）*/
export function clipSrc(
  src: readonly [number, number, number, number],
  spriteW: number,
  spriteH: number,
): { sx: number; sy: number; w: number; h: number } | null {
  const [sx, sy, w0, h0] = src;
  const w = Math.min(w0, spriteW - sx);
  const h = Math.min(h0, spriteH - sy);
  if (sx < 0 || sy < 0 || w <= 0 || h <= 0) return null;
  return { sx, sy, w, h };
}

/** 这一段 ANM 这一刻该贴哪一帧；还在起播停顿里（或解不出来）⇒ `null`（不贴）*/
function anmFrameNow(env: UiScreenEnv, p: Playing): SpriteLike | null {
  const film = env.flic('Panel.mkf', p.resource);
  if (film === null || film.frames.length === 0) return null;
  const from = anmRunFrom(p);
  if (env.now < from) return null;
  const bitmap = flicFrame(film, anmFrameAt(env.now, from, film.frames.length, false));
  // FLIC 帧按影片的**逻辑**尺寸画：超分帧位图更大，塞回同一个框（`hd-stage.ts`）
  return bitmap === undefined ? null : { bitmap, width: film.width, height: film.height };
}

/**
 * 画这一帧的 ANM（原版是 `fcn_00450f04` 每拍把一帧贴进后台面，这里是逐帧位图叠在表面上）。
 * ★ 原版这里**不能用锚点**：`fcn_00450ced(sprite, x, y, flags)` 的 x/y 是**左上角**
 *   （帧缓冲从 (x,y) 起铺），@source 0x00450d2a 起
 */
function drawAnim(ctx: CanvasRenderingContext2D, env: UiScreenEnv, p: Playing | null): void {
  if (p === null) return;
  const frame = anmFrameNow(env, p);
  if (frame !== null) drawSprite(ctx, frame, p.at[0], p.at[1]);
}

/**
 * 各人持号表（`fcn_0042f417`）。
 *
 * 每个人的顺序照 exe：**① 压暗那块 296×60 的底框 → ② 徽章 → ③ 号码牌**。
 *
 * @param lottery 要显示的那一份号码表 —— ★ 用 **`cue.sold`（开奖前那一份）**，
 *   不是 `state.lottery`：原版到**关屏**才 `memset` 号码表
 *   （@source 0x00430aee `memset(0x4990b8, 0, 0x24)`，就在派彩之后），
 *   整场演出里铭牌上一直看得见各人的号码。见 `DrawCue.sold`。
 */
export function drawTally(
  ctx: CanvasRenderingContext2D,
  sprite: DrawSprite,
  lottery: readonly number[],
  characters: readonly number[],
  alive: readonly boolean[],
): void {
  // ★★ W-68-a：铭牌号与玩家号**分开数** —— 原版出局的人（`player+0x15 == 0`）
  //   整个跳过、**不占铭牌**（`0x0042f46b cmp byte [player+0x15],0 / je 0x42f6a2`：
  //   只 `inc [esp+0x70]` 玩家号，不 `inc [esp+0x74]` 铭牌号）。
  let plate = 0;
  for (let p = 0; p < characters.length && plate < TALLY_PLATES.length; p++) {
    if (alive[p] === false) continue;
    const art = tallyArtAt(plate);
    if (art === null) { plate += 1; continue; }
    // ① 压暗的底框（「四个蓝框」）@source 0x0042f482 的 `fcn_004552e7(…, 0x128, 0x3c, −16)`
    const frame = tallyFrameAt(plate);
    if (frame !== null) {
      ctx.fillStyle = `rgba(0,0,0,${TALLY_FRAME.alpha})`;
      ctx.fillRect(frame.x, frame.y, TALLY_FRAME.w, TALLY_FRAME.h);
    }
    // ② 角色徽章（Panel#15 图 = `ENTRY.badge + **角色号**`）
    //   ★ 先前写的是 `ENTRY.badge + p`（**玩家下标**）—— 错。
    //   @source `0x0042f4b1 mov al,[player+0x13] / lea edx,[eax+0x19]`（0x19 = 25 = badge）
    drawWhole(
      ctx,
      sprite('Panel.mkf', DRAW_RESOURCE, ENTRY.badge + (characters[p] ?? 0), true),
      art[0] + TALLY_ART_AT.dx,
      art[1] + TALLY_ART_AT.dy,
    );
    // ③ 持号数字（内容按**玩家号**读，落点按**铭牌号**）
    for (const d of tallyDigits(lottery, p, plate)) {
      drawWhole(ctx, sprite('Panel.mkf', DRAW_DIGIT_RESOURCE, d.digit, true), d.x, d.y);
    }
    plate += 1;
  }
}

/** flag 2（正中）的文字 @source 跳表 `0x44faa0` 第 2 项（VA 0x0044ff2a）*/
function centerText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  outline: string | null,
): void {
  ctx.font = font(size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (outline !== null) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = outline;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** 千分位金额 —— 原版 `_rich4_num_to_currency_string`（VA 0x00452793）*/
export function currency(n: number): string {
  return `$${Math.trunc(n).toLocaleString('en-US')}`;
}

/** 这一刻屏上是什么样 —— 纯数据，`draw` 只负责摆上去 */
export interface DrawView {
  step: number;
  state: number;
  cue: DrawCue;
  /** 这一刻的脸贴片 */
  face: readonly FaceBlit[];
  /** 字框里那几句话；空数组 = 不画字框 */
  lines: readonly string[];
  /** 现在用哪一种字框（气泡 / 黄色爆炸框）*/
  frame: CeremonyFrameId;
  /** 本期号码两颗球的图号（十位、个位）—— 屏上是 `%02d` 的**槽号 + 1** */
  balls: readonly [number, number];
  /** 本期号码的两位数字（十位、个位），与 `balls` 同一个号 */
  digits: readonly [number, number];
  /** 号码球 / 中央大号数字**已经上屏**了没有（开号那一步起）*/
  revealed: boolean;
  /**
   * 得主名（`null` = 不公布）。
   *
   * ★ 原版在**公布得主**那一步（0x00430485，状态 4→5）把它画在 (320,180)，
   *   之后到状态 5 的尾巴（0x00430fe1 擦 (150,0,330,360)）才被擦掉。
   */
  winner: string | null;
  /** 持号表用哪一份号码表 */
  lottery: readonly number[];
  players: number;
}

/** 这一步（含）之前是不是已经有一步贴过号码球 */
function revealedBy(a: Active, step: number): boolean {
  return a.steps.slice(0, step + 1).some((x) => x.balls === true);
}

/** 现在该画成什么样 —— `draw` 用（**不改任何状态**）*/
function viewOf(a: Active, env: UiScreenEnv): DrawView {
  const step = a.steps[a.step]!;
  const line = step.line;
  const showBubble = a.shown && line !== null && !a.bubbleDown;
  const [tens, ones] = numberDigits(a.cue.number);
  // 公布得主那一步起，到「恭喜」那一步把中央那块擦掉为止，名字一直在
  const named = a.steps.slice(0, a.step + 1).some((x) => x.texts.includes('winnerName'));
  return {
    step: a.step,
    state: step.state,
    cue: a.cue,
    face: a.faceBlits,
    lines: showBubble && line !== null ? bubbleLines(line.text) : [],
    frame: a.frame,
    balls: [ENTRY.ball + tens, ENTRY.ball + ones],
    digits: [tens, ones],
    revealed: revealedBy(a, a.step),
    winner: named && a.cue.winner !== null ? winnerNameFor(a, env) : null,
    // ★ 用**开奖前**那份号码表（`cue.sold`）：原版直到关屏才清它（@source 0x00430aee）
    lottery: a.cue.sold,
    players: env.state.players.length,
  };
}

/**
 * 画整屏。
 *
 * 顺序：**持久表面**（建屏 + 走过的每一步都烤在里面）→ 摇球 / 礼花 ANM 的当前帧 →
 * 脸贴片 → 字框（最后画，压在人身上；只在说话那几秒）。
 */
export function drawCeremony(ctx: CanvasRenderingContext2D, env: UiScreenEnv, v: DrawView): void {
  const a = active;
  if (a === null) return;
  const surface = a.surface;
  if (surface === null) return; // 拿不到离屏表面（无 DOM）⇒ 整屏不画，别的照常

  // ★★ W-68-b：先把**还没烤的每一步**依次烤进表面（`while` —— 一帧可能跨好几步）。
  //   有图没解好就整步不烤、下一帧再来；同一张图连等 `CEREMONY_BAKE_RETRIES` 帧还没到
  //   就照烤（缺哪张少哪张），否则一张永远解不出来的图会把整场戏钉成空白。
  //   还没上屏（分紅屏还占着）时只烤建屏那一步。
  const upTo = a.shown ? v.step : -1;
  while (a.applied < upTo) {
    const next = a.applied + 1;
    if (!applyStep(a, next, env, a.bakeTries >= CEREMONY_BAKE_RETRIES)) {
      a.bakeTries += 1;
      break;
    }
    a.bakeTries = 0;
    a.applied = next;
  }

  // ① 持久表面（底图 + 主持人 + 奖金 + 走过的每一步）
  drawCeremonySurface(ctx, surface);

  // ② 摇球 / 礼花 ANM 的**当前帧**（原版每拍把一帧贴进后台面，压在其余东西上面）
  drawAnim(ctx, env, a.drum);
  drawAnim(ctx, env, a.flower);

  // ③ 脸贴片（原版在状态 4..8 之间有闸，见 `0x004310eb`：那几步脸是冻住的）
  if (!(v.state >= 4 && v.state <= 8)) {
    for (const f of v.face) {
      blit(ctx, env.sprite('Panel.mkf', DRAW_RESOURCE, f.entry, false), { entry: f.entry, at: f.at, opaque: true });
    }
  }

  // ④ 字框（`fcn_0044ecb6` 存底 → 贴框 → 写字；`fcn_0044ee18` 说完贴回底）
  if (v.lines.length > 0) drawBubble(ctx, env.sprite as unknown as DrawSprite, v.frame, v.lines);
}

/** 一张要用的图：`[档案, 资源, 图号, 抠黑]`（与 `env.sprite` 的实参同序）*/
type SpriteKey = readonly [ArchiveName, number, number, boolean];

/** 这一步要用到的**每一张** sprite（建屏那一步 = −1）*/
function stepSprites(a: Active, stepIndex: number): SpriteKey[] {
  const step = stepIndex < 0 ? CEREMONY_BASE : a.steps[stepIndex];
  if (step === undefined) return [];
  const out: SpriteKey[] = [];
  for (const p of step.patches) out.push(['Panel.mkf', DRAW_RESOURCE, p.from, false]);
  for (const b of step.blits) out.push(['Panel.mkf', DRAW_RESOURCE, b.entry, b.opaque !== true]);
  if (step.balls === true) for (const b of ballBlits(a.cue.number)) out.push(['Panel.mkf', DRAW_RESOURCE, b.entry, true]);
  if (step.digits === true) {
    for (const b of bigDigitBlits(a.cue.number)) out.push(['Data.mkf', DRAW_BIG_DIGIT_RESOURCE, b.entry, true]);
  }
  // 持号表这一步要重画的话，它用到的徽章与数字牌也得先解好
  if (step.tally === true) {
    for (let p = 0; p < a.characters.length; p++) {
      if (a.alive[p] === false) continue;
      // ★ 徽章也要查！漏了它会让**建屏那一步**在徽章到货之前就烤完，
      //   而表面是持久的 ⇒ 徽章永远补不回来（2026-09-20 浏览器实测）。
      out.push(['Panel.mkf', DRAW_RESOURCE, ENTRY.badge + (a.characters[p] ?? 0), true]);
      for (const d of tallyDigits(a.cue.sold, p)) out.push(['Panel.mkf', DRAW_DIGIT_RESOURCE, d.digit, true]);
    }
  }
  return out;
}

/** 这些图**全部**解好了吗 —— 逐张都问一遍（没到货的顺手叫起来加载，不短路）*/
function spritesReady(keys: readonly SpriteKey[], env: UiScreenEnv): boolean {
  let ok = true;
  const get = env.sprite as (...xs: unknown[]) => Sprite | null;
  for (const k of keys) if (get(...k) === null) ok = false;
  return ok;
}

/** 这一步要用到的**每一张** sprite 都解好了吗（有一张没好就整步不烤）*/
function stepSpritesReady(a: Active, stepIndex: number, env: UiScreenEnv): boolean {
  return spritesReady(stepSprites(a, stepIndex), env);
}

/**
 * 整场演出要用的**所有**素材到货了没有（建屏 + 每一步 + 两种字框 + 脸贴片 + 两段 ANM）。
 *
 * ★ 原版在开屏之前就把四份资源同步读进来（`0x00431712` 起的 `read_mkf` ×4），窗口建起来时
 *   一张不缺。本引擎的图是**异步**解的：第一次开奖时 `Panel#15` 多半还没解 —— 先前计时照走、
 *   表面却迟迟烤不上（等不及就「缺哪张少哪张」地硬烤），屏上就是一片黑底只剩摇球机。
 *   所以**等素材齐了才上屏起算**（`CEREMONY_LOAD_WAIT_MS` 兜底）。
 */
function ceremonyAssetsReady(a: Active, env: UiScreenEnv): boolean {
  const keys: SpriteKey[] = [];
  for (let i = -1; i < a.steps.length; i++) keys.push(...stepSprites(a, i));
  for (const f of Object.values(CEREMONY_FRAMES)) keys.push(['Panel.mkf', DRAW_RESOURCE, f.entry, true]);
  for (const f of [...FACE_SLOT_FRAMES.flat(), FACE_MOUTH_REST, 12, 13]) keys.push(['Panel.mkf', DRAW_RESOURCE, f, false]);
  let ok = spritesReady(keys, env);
  for (const s of a.steps) if (s.anim !== null && env.flic('Panel.mkf', s.anim.panel) === null) ok = false;
  return ok;
}

/**
 * 放完了的 ANM 把最后一帧**烤进表面**、不再逐帧叠。
 *
 * 原版的 ANM 本来就是一帧帧贴进后台面的（`fcn_00450f04`），放完之后最后一帧就留在那里，
 * 之后的擦除会把它擦掉一块（礼花那一片正是被状态 5 尾巴的 `擦(150,0,330,360)` 抹掉的）。
 */
function bakeFinishedAnims(a: Active, ctx: CanvasRenderingContext2D, env: UiScreenEnv): void {
  for (const key of ['drum', 'flower'] as const) {
    const p = a[key];
    if (p === null) continue;
    if (!p.settled && !playingDone(p, env.now)) continue;
    const film = env.flic('Panel.mkf', p.resource);
    const last = film === null ? undefined : flicFrame(film, film.frames.length - 1);
    // FLIC 帧按影片的**逻辑**尺寸画（超分帧塞回同一个框，`hd-stage.ts`）
    if (film !== null && last !== undefined) drawSprite(ctx, { bitmap: last, width: film.width, height: film.height }, p.at[0], p.at[1]);
    a[key] = null;
  }
}

/**
 * 把**某一步**烤进持久表面（W-68-b）。
 *
 * 次序照原版每个处理器：放完的 ANM 落定 → `patches`（擦）→ `blits`（铺）→ 号码球 →
 * 中央大号数字 → 文字 → 持号表。第 **−1** 步 = 建屏（`CEREMONY_BASE`）。
 *
 * @param force 图还没解好也照烤（见 `CEREMONY_BAKE_RETRIES`）
 * @returns 真的烤进去了才 `true`；有图没解好、或拿不到表面 ⇒ `false`（下一帧再试，**不烤一半**）
 */
export function applyStep(a: Active, stepIndex: number, env: UiScreenEnv, force = false): boolean {
  const surface = a.surface;
  if (surface === null) return false;
  const step = stepIndex < 0 ? CEREMONY_BASE : a.steps[stepIndex];
  if (step === undefined) return false;
  if (!force && !stepSpritesReady(a, stepIndex, env)) return false;
  const ctx = surface.ctx;
  const sprite = env.sprite as unknown as DrawSprite;

  if (stepIndex >= 0) bakeFinishedAnims(a, ctx, env);
  for (const p of step.patches) {
    blit(ctx, sprite('Panel.mkf', DRAW_RESOURCE, p.from, false), {
      entry: p.from,
      at: p.at,
      src: p.from4,
      opaque: true,
    });
  }
  for (const b of step.blits) {
    blit(ctx, sprite('Panel.mkf', DRAW_RESOURCE, b.entry, b.opaque !== true), b);
  }
  if (step.balls === true) {
    for (const b of ballBlits(a.cue.number)) blit(ctx, sprite('Panel.mkf', DRAW_RESOURCE, b.entry, true), b);
  }
  if (step.digits === true) {
    for (const b of bigDigitBlits(a.cue.number)) blit(ctx, sprite('Data.mkf', DRAW_BIG_DIGIT_RESOURCE, b.entry, true), b);
  }
  for (const id of step.texts) drawText(ctx, id, a, env);
  if (step.tally === true) drawTally(ctx, sprite, a.cue.sold, a.characters, a.alive);
  return true;
}

/** 得主名 —— `players[winner].character` 查角色表 @source 0x004306ac–0x004306c0 */
function winnerNameFor(a: Active, env: UiScreenEnv): string {
  const idx = a.cue.winner ?? 0;
  const character = env.state.players[idx]?.character ?? a.characters[idx] ?? 0;
  return winnerName(character);
}

function drawText(ctx: CanvasRenderingContext2D, id: string, a: Active, env: UiScreenEnv): void {
  switch (id) {
    case 'poolLabel':
      centerText(ctx, POOL_LABEL, 77, 193, 0x14, '#4f35b1', null);
      break;
    case 'poolAmount':
      centerText(ctx, currency(a.cue.prize), 77, 228, 0x14, '#ff0000', null);
      break;
    case 'poolLabelTop':
      centerText(ctx, POOL_LABEL, 91, 19, 0x14, '#4f35b1', null);
      break;
    case 'poolAmountTop':
      centerText(ctx, currency(a.cue.prize), 91, 56, 0x14, '#ff0000', null);
      break;
    case 'winnerName':
      if (a.cue.winner !== null) centerText(ctx, winnerNameFor(a, env), 320, 180, 0x1c, '#ff0000', '#400000');
      break;
    default:
      break;
  }
}

/**
 * 字框 + 字（`fcn_0044ecb6`）。框按锚点贴在 `CEREMONY_FRAMES[frame].at`，
 * 字按 `frameTextCenter` 居中（20 px、`0x101010`）。
 */
function drawBubble(
  ctx: CanvasRenderingContext2D,
  sprite: DrawSprite,
  frame: CeremonyFrameId,
  lines: readonly string[],
): void {
  const def = CEREMONY_FRAMES[frame];
  const b = sprite('Panel.mkf', DRAW_RESOURCE, def.entry, true);
  drawWhole(ctx, b, def.at[0], def.at[1]);
  // 图还没到货时按素材表的尺寸/锚点算字心（`Panel#15` 图 22 = 187×140@(0,0)、图 23 = 233×192@(120,98)）
  const fallback = frame === 'burst'
    ? { width: 233, height: 192, anchorX: 120, anchorY: 98 }
    : { width: 187, height: 140, anchorX: 0, anchorY: 0 };
  const c = frameTextCenter(frame, b ?? fallback);
  // ★ 2026-09-23：字效照 `fcn_0044ecb6` 的 `create_font(0x14, 正文色, 第二色=0, 2, 1)` —— 20 号深色**粗体**（`font.ts` 的 `clerkTextStyle`）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lh = DRAW_BUBBLE_TEXT.size + 6;
  lines.forEach((line, i) => {
    drawGdiText(ctx, line, c.x, c.y + (i - (lines.length - 1) / 2) * lh, clerkTextStyle());
  });
}

// ============================================================
//  整屏（契约见 `ui-screen.ts`）
// ============================================================

export const lotteryDrawScreen: UiScreen = {
  id: 'lottery-draw',

  active(): boolean {
    return active !== null;
  },

  draw(env: UiScreenEnv): void {
    const a = active;
    if (a === null) return;
    drawCeremony(env.stage, env, viewOf(a, env));
    // 刚从分紅屏手里接过整屏（或还在等素材）：下一帧马上来，别等别人请求重画
    if (!a.shown) env.requestRender();
  },

  /**
   * 察觉「刚刚开了奖」（判据见 `lotteryDrawCue`）。
   *
   * ★ 只排好脚本，**不起算**：15 号那天分紅屏先占着整屏（原版先 `0x42ba97` 再 `0x431712`），
   *   本屏要等自己真正上屏的那一拍（第一次收到 `tick`）才开始 —— 见 `Active.shown`。
   */
  event(before: GameState, after: GameState, env: UiScreenEnv): void {
    if (active !== null) return; // 上一段还没播完
    if (before === after) return;
    const cue = lotteryDrawCue(before, after);
    if (cue === null) return;
    env.log(
      `樂透開獎：第 ${cue.number + 1} 號` + (cue.winner === null ? '（無人得獎）' : `，得主 ${cue.winner}`),
    );
    begin(cue, env);
    env.requestRender();
  },

  tick(env: UiScreenEnv): void {
    const a = active;
    if (a === null) return;
    if (!a.shown) {
      if (a.waitSince < 0) a.waitSince = env.now;
      if (ceremonyAssetsReady(a, env) || env.now - a.waitSince >= CEREMONY_LOAD_WAIT_MS) show(a, env);
      env.requestRender();
      return;
    }
    tickFace(a, env);
    tickVoiceRetry(a, env);
    tickBubble(a, env);
    if (holdDone(a, env)) advance(a, env);
    // 脸与 ANM 是逐帧的 —— 在播就一直续帧
    env.requestRender();
  },

  /**
   * 联机旁观：行动者那台已经收场（见 `ui-screen.ts` 的 `fastForward`）⇒ 直接关屏。
   *
   * ⚠️ 这一屏原版**点不掉**：窗口过程 `fcn_0043010c` 只认 `0xf`（WM_PAINT）/ `0x113`（WM_TIMER）/
   *   `0x401` / `0x405`（VA 0x00430124..0x00430145），没有 `0x202`/`0x205`/`0x101` 那几支。
   *   仍然跟着收：行动者那台要等这一屏演完才派下一条 —— 队首到了 = 他那边已经演完；
   *   本台若还剩半场（常见：同一天先上的分紅屏他点掉了、本台还在等 3 秒），
   *   留着就是整整一场开奖的落后。结果（号码 / 得主 / 奖金）早在 core 里。
   */
  fastForward(env: UiScreenEnv): boolean {
    if (active === null) return false;
    // ★ 本台正在念的那一句一并停掉（需求方拍板 2026-09-23）：整屏已经收了，
    //   字框没了、声音还拖着半句不合适。只在**已上屏**（说过话）时停 ——
    //   还没上屏就收，最近那一路语音不是本屏的，别去碰。
    if (active.shown) stopVoice();
    active = null;
    env.log('樂透開獎：跟著行動者收場');
    env.requestRender();
    return true;
  },
};

/** 给单测的只读视图 */
export function lotteryDrawView(env: UiScreenEnv): DrawView | null {
  return active === null ? null : viewOf(active, env);
}
