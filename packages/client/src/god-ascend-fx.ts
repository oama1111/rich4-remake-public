/*
 * 神明**离身升天**那一段 —— 全部照 exe（第十二份试玩回报 #1）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块只算「该不该起、此刻画第几帧、画在哪」，不碰任何规则。
 *   ★ C-DET-4：动效**绝不进 state/history**。
 *
 * 需求方：「神明附身时间到期时，最后一个回合结束会触发神明升天特效和效果音」。
 * 先前本引擎只把 `godInfo` 清掉（core `tickGod` → `releaseObject`），神明就**当场消失**，
 * 既没有升天那一段，也没有那一声。
 *
 * ── 出处：`god_detach`（VA 0x0040e32c，`callers` 共 3 处）────────────────────
 *
 * 三个调用点：`0x0040eb3f`（`god_activate` 里「已有神明 → 先送走旧的」= **换神**）、
 * `0x0041cc9b`（回合边界 `0x41c84f` 里任期减到 0 = **任期届满**）、
 * `0x00444cc4`（**送神符**，卡 22）。破产那一条（`0x40ce40`/`0x40ce62`）走的是
 * 裸 `0x40e14d`，**不经**这里 ⇒ 没有这一段。
 *
 * ```asm
 * 0040e33a  al = player.god_info / dec → [esp+0x2c] = 物件下标
 * 0040e34f  ebp = objects_info[下标].type
 * 0040e356  cmp dword [player + 0x32], 0        ; ★ 住宿/消失/坐牢/住院 一个 dword
 * 0040e35d  je  0x40e36e                        ;   全 0 才演
 * 0040e361  call 0x40e14d / jmp 结尾            ;   否则只拆、不演、不响、不说
 * 0040e384  call 0x41d476(player.x, player.y, 4)        ; 镜头对准主人
 * 0040e38c  esi = [type*4 + 0x49692c]                   ; ★ 物件自己那套图（= objectSpriteResource）
 * 0040e3b0  call 0x40b066(0x8100 + 下标<<8, &x, &y, &img)  ; ★ 取这尊神**此刻画在哪、画的第几张**
 *                                                       ;   （绘制槽 +8/+0xa/+7，即附身那一张）
 * 0040e3ba  objects[下标].+2 = 0 / call 0x40829d(-1,0) / 再写回   ; 重画一次棋盘：主人身上**不再画它**
 * 0040e46f  push 0 / push 0x4823e2 / call 0x4542ce      ; ★ 音效：表项 0x4823e2 = Effect.mkf **54**
 * 0040e47e  ebx = 0 / jmp 0x40e539
 * 0040e539  y −= 10                                     ; ★ 每帧上升 10 px
 * 0040e542  img = (img + 1) & 7                         ; ★ 8 张图轮着转（原地打转）
 * 0040e57c  call 0x456770(surface, 图, x, img, y)       ; 贴这一帧
 * 0040e59f  rect = (x − hotX, y − hotY, +w, +h)
 * 0040e5db  top < 0x28 → top = 0x28                     ;   （只是裁剪矩形）
 * 0040e5ea  cmp bottom, 0x28 / jge 0x40e485              ; ★ 整张图已经高过棋盘顶边 ⇒ 这一帧**不上屏**，收
 * 0040e4f9  …blit…
 * 0040e525  push 0x3c / call 0x45285e                   ; ★ 每帧停 60 ms（`timeGetTime` 忙等）
 * 0040e52f  inc ebx / cmp ebx, 0x18 / jge 收            ; ★ 至多 24 帧
 * 0040e604  call 0x40e14d                               ; 演完才真正拆下来（搭档此时才登场）
 * 0040e610  call 0x40829d(-1, 0)                        ; 重画
 * 0040e618  ebp ∈ {5,6,7,8,15} → player_say(事件 23)    ; 「一場惡夢～」（`speech.ts` 的 detectGodLeft）
 * ```
 *
 * ⚠️ 这一支**没有**「動畫過程」闸（`[0x497159]` 全函数一处都没读）⇒ 恒演。
 */

import { isAlive, type GameState } from '@rich4/core';

/**
 * 升天那一声 —— `Effect.mkf` **54**。
 *
 * @source `0x0040e471 push 0x4823e2` → `rich4_play_sound_effect`（`0x4542ce`）取 `[表项]` 当资源号；
 *   表基址 `0x48231a`、8 字节一项，`0x4823e2` 是第 25 项，`disasm.py dump 0x4823e2 1 4` = **54**
 *   （`assets-pipeline/src/audio.ts` 的 `GOD_MANIFEST` 注释里已记下「下一项 0x4823e2 = 54」）。
 */
export const GOD_ASCEND_SOUND = 54;

/** 每帧停多少毫秒 @source `0x0040e525 push 0x3c / call 0x45285e` */
export const GOD_ASCEND_FRAME_MS = 0x3c; // 60

/** 至多几帧 @source `0x0040e530 cmp ebx, 0x18 / jge` */
export const GOD_ASCEND_MAX_FRAMES = 0x18; // 24

/** 每帧上升多少屏幕像素 @source `0x0040e539 sub dword [esp+0x28], 0xa` */
export const GOD_ASCEND_RISE = 0xa; // 10

/**
 * 棋盘顶边 —— 屏幕 y = `0x28`，即**棋盘局部** y = 0（`LAYOUT.board.y` = 40）。
 * @source `0x0040e5ea cmp dword [esp+0x1c], 0x28 / jge`
 */
export const GOD_ASCEND_TOP_LOCAL = 0;

/** 一次升天：哪位玩家身上的哪一尊 */
export interface GodAscendCue {
  /** 主人（玩家下标）*/
  player: number;
  /** 这尊神在 `state.objects` 里的下标（= `godInfo − 1`）*/
  objectIndex: number;
  /** 物件种类 → 图集（`objectSpriteResource`）*/
  type: number;
}

/**
 * 这一拍有没有神明**经 `god_detach` 离身**（且走的是演出那一支）。
 *
 * 判据：`before.godInfo ≠ 0` 且 `after.godInfo ≠ before.godInfo`（任期届满 / 送神符 → 0；
 * 换神 → 另一个非 0 值 —— 三个调用点全覆盖），并且：
 * - **人还活着**：破产那一条走裸 `0x40e14d`，不经 `0x40e32c`（同 `speech.ts` 的 `detectGodLeft`）；
 * - **`+0x32..+0x35` 全 0**（住宿/消失/坐牢/住院）：`0x0040e356` 那一道闸，否则只拆不演。
 *   取 **after** 的值：任期那一支在 `0x41c84f` 里排在阻碍计数递减**之后**（`0x41cc6c`），
 *   换神 / 送神符那两支这一拍不动这四个字节。
 */
export function godAscendTrigger(before: GameState, after: GameState): GodAscendCue[] {
  const out: GodAscendCue[] = [];
  for (let i = 0; i < after.players.length; i++) {
    const b = before.players[i];
    const a = after.players[i];
    if (b === undefined || a === undefined) continue;
    if (b.godInfo === 0 || a.godInfo === b.godInfo) continue;
    if (!isAlive(a)) continue;
    const bl = a.blocking;
    if (bl.inHotel !== 0 || bl.disappearing !== 0 || bl.inPrison !== 0 || bl.inHospital !== 0) continue;
    const obj = before.objects[b.godInfo - 1];
    if (obj === undefined) continue;
    out.push({ player: i, objectIndex: b.godInfo - 1, type: obj.type });
  }
  return out;
}

/** 精灵的纵向尺寸（只用到这两项：底边 = y − anchorY + height）*/
export interface SpriteBox {
  anchorY: number;
  height: number;
}

/** 这一帧画什么 */
export interface GodAscendPose {
  /** 第几帧（0 起）*/
  frame: number;
  /** 相对起点的纵向位移（屏幕像素，负 = 向上）*/
  dy: number;
  /** 贴哪一张图 */
  image: number;
}

/**
 * 升天到了第几帧、画哪一张；`null` = **已经演完**（该收摊）。
 *
 * @param elapsed 起播以来的毫秒数
 * @param baseY   起点（附身那一张的锚点）的**棋盘局部** y
 * @param image0  起点那一张的图号（`attachedFrameIndex`，即绘制槽 +7）
 * @param boxOf   图号 → 尺寸；还没解好就给 `null`（此时只按帧数上限判）
 *
 * 第 k 帧（k = 0..23）：`y = baseY − 10·(k+1)`、`图号 = (image0 + k + 1) & 7`
 * —— 原版先减、先转、再贴（`0x0040e539` 在 `0x0040e57c` 之前）。
 * 底边 `y − anchorY + height` 高过棋盘顶边的那一帧**不上屏**，就此收摊。
 */
export function godAscendPoseAt(
  elapsed: number,
  baseY: number,
  image0: number,
  boxOf: (image: number) => SpriteBox | null,
): GodAscendPose | null {
  const frame = Math.max(0, Math.floor(elapsed / GOD_ASCEND_FRAME_MS));
  if (frame >= GOD_ASCEND_MAX_FRAMES) return null;
  const dy = -GOD_ASCEND_RISE * (frame + 1);
  const image = (image0 + frame + 1) & 7;
  const box = boxOf(image);
  if (box !== null && baseY + dy - box.anchorY + box.height < GOD_ASCEND_TOP_LOCAL) return null;
  return { frame, dy, image };
}

/** 帧数上限对应的总时长（图没解好时兜底用，免得卡住回合驱动）*/
export const GOD_ASCEND_MAX_MS = GOD_ASCEND_MAX_FRAMES * GOD_ASCEND_FRAME_MS;
