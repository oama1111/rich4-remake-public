/*
 * 「破產」整屏動畫 —— `Data.mkf` 0x22b（10 幀 × 71 ms、440×440 @ (0,40)）+ 曲 2（MIDI03）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★★ 第二十五份試玩回報 `20260924-223238961`（「为什么忽然出现拍卖」）：
 *   現場是**單機第 149 回合**，真人（阿土伯，P0）現金 0 + 存款 91，踩到 400 元過路費；
 *   他手上有免費卡（20）與嫁禍卡（19），兩問都答「不用」
 *   ⇒ `pay_money` 兩個口袋都空 ⇒ 破產。
 *   破產清算把名下 15 處地產全部釋放、隨機連拍 3 場
 *   （`0x40d1c6 cmp esi,3 / jle` ⇒ 只有 > 3 處才拍）—— **規則本身是對的**，
 *   缺的是原版在破產那一刻那段阻塞演出，於是屏上只看到拍賣屏「忽然」冒出來。
 *
 * @source `_rich4_player_bankrupt` VA 0x0040cd87 的開頭（清玩家結構、`update_player_sprite` 之後）：
 * ```asm
 * 0040cf6d  mov ebp, [0x49910c]        ; 存下当前玩家
 * 0040cf74  mov [0x49910c], eax        ; 演出期间当前玩家 = 破产者
 * 0040cf79  push 2 / call 0x4549cf     ; ★ 曲 2 → MIDI03.MID（`SCREEN_BGM.bankrupt`）
 * 0040cf85  push 1 / call 0x41906a     ; 重画一次（view_to 破产者）
 * 0040cf8f  push 0 / push 0 / push 0x22b / push [0x48a0e4] / call 0x450441   ; read_mkf(Data.mkf, 0x22b)
 * 0040cfa4  push 0x64                  ; ★ arg5 = 随影片响的音效号（Effect.mkf）100
 * 0040cfa6  push 1                     ; arg4 = flags（bit1 = 0 ⇒ **点不掉**）
 * 0040cfa8  push 0x28                  ; arg3 = y = 40
 * 0040cfaa  push 0                     ; arg2 = x = 0
 * 0040cfac  push eax / call 0x45144f   ; fcn_0045144f（阻塞播完）
 * 0040cfb1  push ebx / call 0x456e11   ; libc_free
 * 0040cfbb  push 0x7d0 / call 0x45285e ; ★ 片后静置 2000 ms —— `fcn_0045285e` 是**纯 sleep**（点不掉）
 * ```
 * 资源头实测：`Data.mkf` 0x22b = 440×440 / 10 帧 / 71 ms，帧内容 = 碎裂的「破產」二字
 * （`tools/scratch` 里解出来目视核对过）。全 exe **只有这一处**引用 0x22b。
 * 这一段**没有**「動畫過程」开关（`0x497159`）—— 与住院 / 入獄那两段不同，照 exe 无条件播。
 *
 * ## 为什么做成一条**整屏**，而不是 `board-film` 的又一段
 *
 * 原版 `fcn_0045144f` 是**阻塞**的：破產动画（+2 s）演完才走到清算与
 * `_rich4_ui_auction_entry`。本引擎一条 action 就把 `pending = auction` 写好了，
 * 而拍賣屏的 `active()` 只看 `pending` ⇒ 它会在影片之前抢到整屏、把影片整段盖掉
 * （`main.ts` 的绘制链：有 overlay 就不画棋盘，影片跟着棋盘一起被跳过）。
 * 故这里把它做成 `screens.ts` 里**排在拍賣屏之前**的一条纯演出屏：影片期间由它接管，
 * 演完 `active()` 变假、拍賣屏才起播 —— 与 exe 同序；拍賣屏因此不必知道影片的事。
 *
 * ★ C-ARC-2：本模块不含任何规则。★ C-DET-4：动效绝不进 `GameState`。
 */

import { isAlive, type GameState } from '@rich4/core';
import {
  beginBoardFilm,
  boardFilmBitmap,
  boardFilmDone,
  type BoardFilm,
  type BoardFilmSpec,
} from './board-film.ts';
import { drawSprite } from './hd-stage.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';

/** 破產動畫 @source `Data.mkf` 0x22b（四个数逐字节核过资源头 / 调用点，见文件头） */
export const BANKRUPT_FILM: BoardFilmSpec = {
  id: 'bankrupt',
  archive: 'Data.mkf',
  resource: 0x22b,
  frames: 10,
  width: 440,
  height: 440,
  frameMs: 71,
  // @source 0x0040cfaa `push 0`（arg2）
  x: 0,
  // @source 0x0040cfa8 `push 0x28`（arg3）
  y: 0x28,
  // @source 0x0040cfa4 `push 0x64`（arg5）
  sound: 0x64,
  // @source 0x0040cfa6 `push 1`（arg4：bit1 = 0 ⇒ 点击 / 按键点不掉）
  flags: 0x1,
  // @source 0x0040cfbb `push 0x7d0 / call 0x45285e`（纯 sleep，点不掉）
  holdMs: 0x7d0,
};

/** 破產那一刻放的曲子 @source 0x0040cf79 `push 2` ⇒ `MIDI03.MID`（`SCREEN_BGM.bankrupt`）*/
export const BANKRUPT_BGM = 'midi03.mid';

/**
 * 这一条 action 里有哪些人**刚破产**（`who_plays` 从「在场」变「出局」）—— 每人演一段。
 *
 * `isAlive` 的两处非破产来源都排除了：
 *   - 开局「还没上盘」的人是 `whoPlays == 0`（本来就是 `isAlive == false`），
 *     落地时是 **false → true**，方向相反；
 *   - **勝利結算**会把其余人的 `who_plays` 全清（`rules/victory.ts`）—— 那是「达成胜利条件」，
 *     原版走的是 `fcn_0041d89e`，**不经过** `_rich4_player_bankrupt`、没有这一段动画，
 *     故 `after.victory !== null` 时整条不认。
 */
export function bankruptFxTriggers(before: GameState, after: GameState): number[] {
  if (after.victory !== null) return [];
  const out: number[] = [];
  for (let i = 0; i < after.players.length; i++) {
    const b = before.players[i];
    const a = after.players[i];
    if (b === undefined || a === undefined) continue;
    if (isAlive(b) && !isAlive(a)) out.push(i);
  }
  return out;
}

/** 影片解不开时的兜底：等这么久还没解出来就跳过这一段（宁可少演一段，不能把整局钉住）*/
const FILM_LOAD_TIMEOUT_MS = 5_000;

/** 正在播的那一段（`null` = 没在播）*/
let playing: BoardFilm | null = null;
/** 排着还没起播的破产者（一次 action 里可能不止一位）*/
let queue: number[] = [];
/** 「在等影片解码」的起点时刻（`env.now` 时基）；不在等 = `null` */
let waitingSince: number | null = null;

/** 单测用：把这一段的表现状态清干净 */
export function resetBankruptScreen(): void {
  playing = null;
  queue = [];
  waitingSince = null;
}

/** 破產影片「排着 / 在播」—— 整屏是否接管、以及台词的影片闸都看它 */
export function bankruptFilmActive(): boolean {
  return playing !== null || queue.length > 0;
}

/**
 * 「破產」整屏 —— 排在 `boardScreen` / `auctionScreen` **之前**（见文件头）。
 *
 * 时序（`tick` 每帧一次，只有接管整屏那一屏收得到）：
 *   ① 排队非空且影片已解好 ⇒ 起时间轴：点 MIDI03、放音效 100；
 *   ② `boardFilmDone` = 帧放完**且** 2000 ms 静置等满 ⇒ 收场，让位给拍賣屏。
 */
export const bankruptScreen: UiScreen = {
  id: 'bankrupt',

  /**
   * 原版的 `fcn_0045144f` 只把 440×440 那一块贴到屏幕上（棋盘 (0,40) 那一块），
   * 右栏 / 工具栏照旧露着 ⇒ 这里也是**浮窗**：先照常画一整帧棋盘，再叠影片。
   */
  windowed: true,

  active: () => bankruptFilmActive(),

  /**
   * 联机旁观被行动者甩下（`follow-presenter.ts`）/ 演出死锁自解时把这一段直接作废 ——
   * 它没有待决交互（点也点不掉），落到终态就是「不再占屏」。
   */
  fastForward(env: UiScreenEnv): boolean {
    if (!bankruptFilmActive()) return false;
    const n = queue.length + (playing === null ? 0 : 1);
    playing = null;
    queue = [];
    waitingSince = null;
    env.log(`影片：破產 跟著行動者收場（${n} 段）`);
    env.requestRender();
    return true;
  },

  event(before: GameState, after: GameState, env: UiScreenEnv): void {
    const hits = bankruptFxTriggers(before, after);
    if (hits.length === 0) return;
    queue.push(...hits);
    env.requestRender();
  },

  draw(env: UiScreenEnv): void {
    const film = playing;
    if (film === null) return;
    const spec = film.spec;
    const flic = env.flic(spec.archive, spec.resource);
    const bmp = boardFilmBitmap(film, env.now, flic);
    if (bmp === null || flic === null) return;
    // FLIC 帧按影片的**逻辑**尺寸画：超分帧位图更大，塞回同一个框（`hd-stage.ts`）
    drawSprite(env.stage, { bitmap: bmp, width: flic.width, height: flic.height }, spec.x, spec.y);
  },

  tick(env: UiScreenEnv): void {
    if (playing === null) {
      const who = queue[0];
      if (who === undefined) return;
      // 原版 `read_mkf` 是**同步**的 ⇒ 影片解好才起时间轴。
      // ⚠️ `env.flic()` 是异步的：第一次问恒为 `null`，解好后 main.ts 会自己重画一帧。
      if (env.flic(BANKRUPT_FILM.archive, BANKRUPT_FILM.resource) === null) {
        waitingSince ??= env.now;
        if (env.now - waitingSince > FILM_LOAD_TIMEOUT_MS) {
          queue.shift();
          waitingSince = null;
          env.log('影片：破產 解码超时，跳过这一段');
        }
        env.requestRender();
        return;
      }
      queue.shift();
      waitingSince = null;
      playing = beginBoardFilm(BANKRUPT_FILM, env.now);
      env.log(`影片：破產 P${who}（${BANKRUPT_FILM.frames} 帧 × ${BANKRUPT_FILM.frameMs} ms）`);
      env.music?.(BANKRUPT_BGM);
      env.playEffect(BANKRUPT_FILM.sound);
      env.requestRender();
      return;
    }
    if (boardFilmDone(playing, env.now)) {
      playing = null;
      env.requestRender();
      return;
    }
    env.requestRender();
  },
};
