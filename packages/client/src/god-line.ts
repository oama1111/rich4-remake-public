/*
 * 神明附身那一刻的**开场白**（原版 `fcn_0040e2a2`）—— 纯函数（第八份试玩回报 #5）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方：「npc踩到小福神时没触发文字框就直接提示获得卡片了」。缺的就是这一段：
 * 每位神明附身（`_rich4_attach_god` 的十二条分支）都先说一句开场白，**不是**訊息框、
 * 也不是台词气泡，而是一块白字直接写在棋盘下缘，停 2.4 秒。
 *
 * @source `fcn_0040e2a2(串)` @ VA 0x0040e2a2（12 个调用点见 `GOD_LINES` 各项）：
 * ```asm
 * 0040e2b5  call [vtbl+0x64]                  ; 把存下来的那份棋盘贴回去（擦上一帧）
 * 0040e2b8  eax = [0x48a078] >> 1             ; 屏宽 / 2 = 320
 * 0040e2bf  mov word [0x46caec], ax           ; ★ 换行宽 = 320
 * 0040e2cf  push 0 / push 6 / push 0x101010 / push 0xffffff / push 0x1c
 * 0040e2df  call 0x44f9d8                     ; ★ 字：28 px、白、阴影 #101010
 * 0040e2e7  push 7 / push 0x1cc / push 0xdc / push 串 / push 0x46caec
 * 0040e2fd  call 0x44fabc                     ; ★ draw_text(串, x=220, y=460, 对齐 7)
 * 0040e30f  call [vtbl+0x80]                  ; 翻页
 * 0040e315  mov word [0x46caec], 0x280        ; 换行宽还原 640
 * 0040e31e  push 0x960 / call 0x4528b9        ; ★ 等 2400 ms（任意鼠标键跳过）
 * ```
 * 对齐 7 = **水平居中、垂直靠下**（`hud.ts` 读出的 `0x44faa0` 跳表）⇒ (220, 460) 是文字块
 * **底边中点**；屏幕 y 460 = 棋盘画布 y 420（棋盘原点 y=40）。x 220 = 棋盘正中。
 *
 * 次序（以小福神 `0x0040edc0` 为例）：影片 `0x45144f`（動畫過程开着才播）→ **本开场白** →
 * `view_to` → 效果（发卡 / 收钱窗…）→ 訊息框 → 台词。即：**紧跟在附身影片之后**、效果之前。
 */

/** 停多久 @source `0x0040e31e push 0x960` */
export const GOD_LINE_MS = 0x960;
/** 文字块**底边中点**（棋盘画布坐标）@source `push 0xdc / push 0x1cc`，屏幕 y 减棋盘原点 40 */
export const GOD_LINE_AT = { x: 0xdc, y: 0x1cc - 40 } as const;
/** 换行宽 @source `0x0040e2bf`：屏宽 640 >> 1 */
export const GOD_LINE_WRAP = 320;
/** 字号 @source `push 0x1c` */
export const GOD_LINE_FONT_PX = 0x1c;
/** 行距：原版 `draw_text` 按字高 + 1 逐行（`ebx` = 字高 + 1，见 `hud.ts`）*/
export const GOD_LINE_LINE_HEIGHT = GOD_LINE_FONT_PX + 1;
export const GOD_LINE_COLOR = '#ffffff';
export const GOD_LINE_SHADOW = '#101010';

/**
 * 十二位神明的开场白 —— 键 = 物件**种类**（`objects_info[i].type`，与 `god-fx.ts` 同一套编号）。
 * 串按 Big5 原样译出，`\n\n` 是原版就有的空行。
 */
export const GOD_LINES: Readonly<Record<number, string>> = {
  /** 小財神 @source `0x0040ec51 push 0x463250` */
  1: '呦喝！～發財發財！\n\n我雖然還小，沒什麼神力\n\n但是我可以讓你損失減半。',
  /** 大財神 @source `0x0040ed2e push 0x463295` */
  2: '呵呵～恭喜發財。\n\n我保佑你財源滾滾\n\n誰也不能罰你的錢。',
  /*
   * ★★ 2026-09-22 核对裁定（需求方：「『文案与效果不符』按原版呈现即可」）：
   *   下面**小福神(3)** 与 **大福神(4)** 这两句里的承诺，**原版自己就做不到**，本引擎是 1:1 照抄：
   *   · 3「投資事半功倍」—— 代码里没有任何折扣/减半/加倍；它的發威只有「隨機得 1 張卡」，
   *     唯一的「多送一級」屬 `isLuckyGod`(3/4)，且買地的錢**照扣**（`...core_actions.asm:1069 sub`）。
   *   · 4「投資加倍順利、買地不用錢」—— 原版 `sub dword [eax+0x496b84], ebp` **無條件扣錢**，
   *     緊接 `:1079 jmp near loc_00419a48` 才是福神白送一級 ⇒ 實際是「照付錢、白送一級」。
   *   ⇒ **不要照著文案去實現效果**（那才是偏離原版）；逐神明核對表見
   *     `docs/audit-gods-text-vs-effect.md`。
   */
  /** 小福神 @source `0x0040edcc push 0x4632cc` */
  3: 'Ｙｅａｈ!!不要看我小喔\n\n我可以讓你投資事半功倍！',
  /** 大福神 @source `0x0040ee8d push 0x46330e` */
  4: '呵呵呵～天官賜福好運到\n\n我保佑你福星高照\n\n投資加倍順利、買地不用錢。',
  /** 小窮神 @source `0x0040ef89 push 0x46336c` */
  5: '噎噎噎～賠錢！賠錢！',
  /** 大窮神 @source `0x0040f052 push 0x463381` */
  6: '喔～錢掉了。',
  /** 小衰神 @source `0x0040f0f1 push 0x46338e` */
  7: '有我小小衰神，害你一事無成。',
  /** 大衰神 @source `0x0040f1c3 push 0x4633c0` */
  8: '哈哈哈！真是好衰啊！',
  /** 天使 @source `0x0040f246 push 0x4633f0`（惡魔/土地公两支 `jmp 0x40f24b` 共用同一处 call）*/
  9: '哈雷路亞～\n\n我將使您落腳的土地更加繁榮。',
  /** 惡魔 @source `0x0040f299 push 0x463419 / jmp 0x40f24b` */
  10: '哈～哈～與我同生共死。\n\n我要沿路破壞你所經過的土地。',
  /** 土地公 @source `0x0040f2e1 push 0x46344e` */
  12: '呵～呵，有土斯有財\n\n我就是土地公公。\n\n有我在，你想要多少土地就有多少。',
  /** 死神 @source `0x0040f359 push 0x463495` */
  15: '嘿嘿嘿嘿﹒﹒你慘了！\n\n被我盯上，你完蛋了。',
};

/**
 * 这一拍有没有神明**刚附身**（`godInfo` 变成一个新的非 0 值）—— 有就返回他的开场白。
 *
 * 判据与 `god-fx.ts` 的 `godFxTrigger` 同一套（换神也算：原版每次 `_rich4_attach_god` 都走一遍）；
 * 差别是**不看有没有影片**：11 / 13 / 14 没影片也没开场白（表里本来就没有），其余 12 位都有。
 */
export function godLineTrigger(
  before: { players: readonly { godInfo: number }[] },
  after: { players: readonly { godInfo: number }[]; objects: readonly { type: number }[] },
): string | null {
  for (let i = 0; i < after.players.length; i++) {
    const a = after.players[i];
    const b = before.players[i];
    if (a === undefined || b === undefined) continue;
    if (a.godInfo === 0 || a.godInfo === b.godInfo) continue;
    const type = after.objects[a.godInfo - 1]?.type ?? a.godInfo;
    const line = GOD_LINES[type];
    if (line !== undefined) return line;
  }
  return null;
}

/**
 * 把串排成行：先按原版的 `\n` 切，再按换行宽 320 折（`measure` 由调用方给，测试注入等宽）。
 * 原版 `draw_text` 的折行是逐字的（Big5 双字节一字一格），这里逐字符量宽等价。
 */
export function godLineRows(text: string, measure: (s: string) => number, wrap = GOD_LINE_WRAP): string[] {
  const rows: string[] = [];
  for (const para of text.split('\n')) {
    if (para === '') {
      rows.push('');
      continue;
    }
    let cur = '';
    for (const ch of para) {
      if (cur !== '' && measure(cur + ch) > wrap) {
        rows.push(cur);
        cur = ch;
      } else {
        cur += ch;
      }
    }
    if (cur !== '') rows.push(cur);
  }
  return rows;
}

/** 还在演吗（2400 ms 内）*/
export function godLineActive(startedAt: number, now: number): boolean {
  return now - startedAt < GOD_LINE_MS;
}
