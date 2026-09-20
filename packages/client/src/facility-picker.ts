/*
 * 「請選擇設施類別」那扇窗 —— 真人盖「等级 0 的設施」时要先选种类
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块只算「画在哪、命中哪一格、返回哪个类型」，不碰任何规则。
 *   选了之后由宿主把类型交给 core（`useTool{value}` / 加蓋那一支）。
 *
 * 原版出处：`fcn_00440aac`（VA 0x00440aac）开窗 + 窗口过程 `fcn_0043fae4`
 * （VA 0x0043fae4）。三个调用点：
 *   - `fcn_0040b110`（建一级那个公共助手）VA **0x0040b1e2**：真人在等级 0 时
 *     `push 0 / call 0x440aac` → `[记录+0x18] = al`（= 类型）—— 機器工人 / 加蓋類卡片
 *     都走这里；
 *   - 落点那一支 VA **0x0041a228**（等级 0 的設施、现金够 地價×物價）：`push 0` 同上；
 *   - 加蓋卡 VA **0x004431c8**：`push 1 / call 0x440aac`，返回 **−1 = 取消这张卡**。
 *
 * ## 版面（逐条 VA）
 *
 * ```asm
 * ; ── 开窗（VA 0x00440aac）
 * 00440ad0  fcn_00451e7e(rect 0,0x28,0x1b8,0x1e0)   ; ★ 浮窗：先存下这块
 * 00440b1b  fcn_004563f5(surface, [0x48bad8]+0x3c, 0x2b, 0x117)  ; 面板 = Data#517 图 4 落 (43,279)
 * 00440b3d  draw_text(0x465289 = 請選擇設施類別, x=0xdc=220, y=0x7a=122, flag 2)
 * 00440b52  Wait_0402_Message(fcn_0043fae4)          ; 窗口过程；返回值 = 类型 / −1
 * ; ── 悬停（loc_0043fc6f）
 * 0043fc6f  fcn_0045620f(0x46caec, x, 0x11e, 0x44, 0x44, 0xffff00)   ; 外框 68×68
 *           fcn_0045620f(0x46caec, x+1, 0x11f, 0x42, 0x42, 0xffff00) ; 中框 66×66
 *           fcn_0045620f(0x46caec, x+2, 0x120, 0x40, 0x40, 0xffff00) ; 内框 64×64
 *           fcn_00456418(surface, [0x48bad8]+0x48, 0xdc, 0x8c)       ; Data#517 图 5 落 (220,140)
 *           draw_text(請選擇設施類別, 220, 122, flag 2)
 *           draw_text(名字表[槽], 220, 0x9a=154, flag 4)              ; 表 0x475150
 * ; ── 命中（loc_0043fb76，0x200 那一支）
 * 0043fb76  x ∈ [0x32,0x186) = [50,390)、y ∈ [0x11e,0x162) = [286,354)
 *           ebx = 0x44（68）→ 槽号 = (x − 0x32) / 0x44
 * ```
 *
 * 名字表 `0x475150 + 槽*4`：`公  園` / `旅  館` / `購物中心` / `加油站` / `研究所`
 * —— **正好是 `@rich4/core` 的 `FACILITY_TYPE`（park 0 / hotel 1 / mall 2 /
 * gasStation 3 / lab 4）**，所以返回值不用再映射。
 *
 * flags：右键（`0x205`）→ **−1**（VA 0x0043febb 那一支），悬停换格响 **0**
 * （`0x48231a`，VA 0x0043fbc9）。
 */

import type { GameState, MapTopology } from '@rich4/core';
import type { Sprite } from './assets.ts';
import { FONT_FAMILY } from './font.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';

/** 面板与立绘板所在的档案 @source `[0x48bad8]`（= `read_mkf(Data.mkf, 0x205)`）*/
export const PICKER_ARCHIVE = 'Data.mkf' as const;
/** 共享 UI 图集 @source VA 0x00408072 尾 */
export const PICKER_RESOURCE = 0x205;

/** 面板 = 图 **4**（`0x3c = 0xc + 12×4`）落 (0x2b,0x117) @source VA 0x00440b1b */
export const PICKER_PANEL = { chunk: 4, x: 0x2b, y: 0x117 } as const;
/** 悬停时压上去的立绘板 = 图 **5**（`0x48 = 0xc + 12×5`，249×170）落 (0xdc,0x8c) @source loc_0043fc6f */
export const PICKER_BOARD = { chunk: 5, x: 0xdc, y: 0x8c } as const;

/** 标题（串 `0x465289`）落 (220,122) flag 2（正中）@source VA 0x00440b3d / loc_0043fc6f */
export const PICKER_TITLE = '請選擇設施類別';
export const PICKER_TITLE_AT = { x: 0xdc, y: 0x7a } as const;
/** 悬停那一格的名字落 (220,0x9a=154) flag 4（正中）@source `loc_0043fc6f` 尾 */
export const PICKER_NAME_AT = { x: 0xdc, y: 0x9a } as const;

/** 字号与字色 —— `rich4_create_font(0x10, 0xf0f0f0, 0x101010, 3, 1)` @source VA 0x00440ab6 */
export const PICKER_FONT_SIZE = 0x10;
export const PICKER_FILL = '#f0f0f0';
export const PICKER_OUTLINE = '#101010';

/**
 * 五格 —— **槽号就是 `FACILITY_TYPE`**（名字表 `0x475150 + 槽*4`）。
 *
 * | 槽 | 名字 | `FACILITY_TYPE` |
 * |---|---|---|
 * | 0 | 公  園 | park = 0 |
 * | 1 | 旅  館 | hotel = 1 |
 * | 2 | 購物中心 | mall = 2 |
 * | 3 | 加油站 | gasStation = 3 |
 * | 4 | 研究所 | lab = 4 |
 */
export const PICKER_NAMES: readonly string[] = ['公  園', '旅  館', '購物中心', '加油站', '研究所'];

/** 可选类型（= 槽号 = `FACILITY_TYPE` 的 0..4）@source 名字表 `0x475150` */
export const PICKER_TYPES: readonly number[] = [0, 1, 2, 3, 4];

/** 命中带 @source `loc_0043fb76`：x∈[0x32,0x186)、y∈[0x11e,0x162) */
export const PICKER_HIT = { x0: 0x32, x1: 0x186, y0: 0x11e, y1: 0x162 } as const;
/** 每格宽 @source `mov ebx, 0x44` */
export const PICKER_STRIDE = 0x44;
export const PICKER_SLOTS = 5;

/** 悬停那三圈黄框的尺寸（外 0x44 / 中 0x42 / 内 0x40，各向内缩 1px）@source loc_0043fc6f */
export const PICKER_HOVER_FRAMES: readonly { dx: number; dy: number; size: number }[] = [
  { dx: 0, dy: 0, size: 0x44 },
  { dx: 1, dy: 1, size: 0x42 },
  { dx: 2, dy: 2, size: 0x40 },
];
export const PICKER_HOVER_COLOR = '#ffff00';

/** 悬停换格那一声（表 `0x48231a` 首字节 = 0）@source VA 0x0043fbc9 */
export const PICKER_SOUND_HOVER = 0;

/**
 * 要过这扇窗的那件道具 —— **機器工人（9）**。
 *
 * @source `fcn_0040b110`（建一级的公共助手）在**等级 0 的設施**那一支里：
 *   真人 → `push 0 / call 0x440aac`（VA **0x0040b1e2**）→ `[记录+0x18] = al`；
 *   機器工人 / 加蓋類卡片都调这个助手。
 */
export const PICKER_TOOL_ID = 9;

// ============================================================
//  純函数
// ============================================================

/**
 * 光标底下是第几格（`null` = 不在命中带里 / 超出 5 格）。
 *
 * @source `loc_0043fb76`：`cmp ebx,0x32 / jl 跳过`、`cmp ebx,0x186 / jge 跳过`、
 *   `cmp eax,0x11e / jl`、`cmp eax,0x162 / jge`，再 `(x−0x32)/0x44`。
 */
export function pickerSlotAt(x: number, y: number): number | null {
  if (x < PICKER_HIT.x0 || x >= PICKER_HIT.x1) return null;
  if (y < PICKER_HIT.y0 || y >= PICKER_HIT.y1) return null;
  const slot = Math.trunc((x - PICKER_HIT.x0) / PICKER_STRIDE);
  return slot >= 0 && slot < PICKER_SLOTS ? slot : null;
}

/** 槽号 → 那一格左边界 @source `lea ebx, [槽*0x44 + 0x32]` */
export function pickerSlotX(slot: number): number {
  return PICKER_HIT.x0 + slot * PICKER_STRIDE;
}

/** 槽号 → 那三圈黄框的矩形（`x/y` 各 +1、边长各 −2）*/
export function pickerHoverRects(
  slot: number,
): readonly { x: number; y: number; size: number }[] {
  const x0 = pickerSlotX(slot);
  return PICKER_HOVER_FRAMES.map((f) => ({ x: x0 + f.dx, y: PICKER_HIT.y0 + f.dy, size: f.size }));
}

/** 槽号 → `FACILITY_TYPE`（本屏上两者相等，见 `PICKER_NAMES`）*/
export function pickerTypeOf(slot: number): number | null {
  return PICKER_TYPES[slot] ?? null;
}

/**
 * 这扇窗要不要显示**建造费用**（W-55 行 9）。
 *
 * ★★ **结论先说：原版这扇窗一个价钱都不画，本引擎也不画。**
 *   逐条核过 `fcn_0043fae4`（窗口过程）的全部绘制调用 —— 只有四处：
 *   ① 面板 `Data#517` 图 4 落 (43,279)（`0x00440b1b`）；
 *   ② 悬停三圈黄框（`loc_0043fc6f`）；
 *   ③ 立绘板 `Data#517` 图 5 落 (220,140)（`loc_0043fc6f`）；
 *   ④ 标题「請選擇設施類別」落 (220,122) 与**悬停那一格的名字**落 (220,154)
 *      （`0x00443fd10`/`0x00443fd26` → `0x44fabc`）。
 *   —— **没有任何一处 `draw_text` 拿价钱**（也没有 `%d元` 那类格式串）。
 *
 * ⚠️ 「这扇窗要显示价钱」这个印象来自**它替掉的那块临时画面**：
 *   `git show 9664bbf~1:packages/client/src/interactions.ts` 里
 *   `case 'buildFacility'` 的 `detail: \`建築費用 ${money(pending.price)}…\`` ——
 *   那是重制版自己发明的五按钮对话框，`9664bbf` 接上本窗时**整段删掉**了。
 *   按 WORKPLAN §2 规则 5（原版没有的 UI/提示一律不加），本窗**不把它加回来**。
 *
 * ⇒ 这条谓词是那个决定的**唯一闸门**，留给「日后真要往这扇窗里放价钱」的人：
 *   它必须过这里，而**神明顯靈代蓋**那一次（`pending.free === true`，
 *   见 `rules/interaction.ts` 的 `buildFacility.free`）**永远返回 false** ——
 *   那一次原版不收一分钱，画任何一个数都是错的。
 *
 * @param pending `GameState.pending`（只需要 `free` 一个字段；`null`/别的 kind ⇒ 不显示）
 */
export function pickerShowsPrice(pending: { free?: true } | null): boolean {
  if (pending === null) return false;
  return pending.free !== true;
}

/** 类型 → 那一格显示的名字 */
export function pickerNameOf(type: number): string {
  return PICKER_NAMES[type] ?? '';
}

/**
 * 这一件道具打这个目标格，要不要先过选类別窗。
 *
 * 判据（纯查状态）：① 是这个道具（`PICKER_TOOL_ID`）；② 目标格上确实有設施；
 * ③ 那一格**等级 = 0**（等级 ≥ 1 时种类已经定死，原版走 `0x0041a2b3` 那一支、
 * 直接问「要不要花 房價×物價 加盖」）。
 *
 * ⚠️ 土地那一支（`0x7d0 < type < 0xfa0`）**不过**这扇窗 —— 原版直接 `buildOneLevel`。
 *
 * @source 0x0040b1c5 起：`[ebx+0x1a] == 0` 那一支才 `call 0x440aac`
 */
export function pickerNeededFor(state: GameState, topo: MapTopology, nodeId: number): boolean {
  const node = topo.nodes[nodeId - 1];
  if (node === undefined) return false;
  const idx = facilityIndexOf(node.type);
  if (idx === null) return false;
  const fac = effectiveFacility(state, topo, idx);
  return fac !== null && fac.level === 0;
}

/** 上面那两个助手 —— 从 `@rich4/core` 转出来，免得宿主再导一次 */
import { effectiveFacility, facilityIndexOf } from '@rich4/core';

/**
 * 改建卡（7）打**脚下的設施**时，要不要先过这扇「請選擇設施類別」窗。
 *
 * 判据（纯查状态）：① 站在設施格上；② 那栋設施**等级 ≥ 1**
 * （等级 0 = 还没盖起来，原版 `cmp byte [ebx+0x1a], 0 / je` 直接不生效，窗都不开）。
 *
 * ⚠️ 与 `pickerNeededFor` 的等级条件正好**相反**：機器工人是「空地 → 盖起来、选种类」，
 *   改建卡是「已经有房 → 改种类」。
 *
 * @source 加蓋卡 VA 0x004431c8：`push 1 / call 0x440aac`（参数 1 那一支），
 *   返回值 **−1 = 右键取消 → 这张卡不消耗**（VA 0x004431d7 的 `cmp eax, 0xffffffff`）。
 */
export function rebuildPickerNeeded(state: GameState, topo: MapTopology): boolean {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return false;
  const node = topo.nodes[me.nodeId - 1];
  if (node === undefined) return false;
  // 判据与 `pickerNeededFor` 同一口径：按**节点 type 的实例区间**认設施
  // （原版读的是脚下那一格的实例编码，不是 `ref`）
  const idx = facilityIndexOf(node.type);
  if (idx === null) return false;
  const fac = effectiveFacility(state, topo, idx);
  return fac !== null && fac.level >= 1;
}

// ============================================================
//  绘制（纯 IO）
// ============================================================

export type PickerSprite = (archive: 'Data.mkf', resource: number, index: number, keyed?: boolean) => Sprite | null;

/** 一张图要不要抠黑：面板（图 4）**不抠**（`fcn_004563f5` 不透明），立绘板（图 5）抠 @source VA 0x00440b1b / loc_0043fc6f */
export function pickerKeyedBlack(chunk: number): boolean {
  return chunk === PICKER_BOARD.chunk;
}

export interface PickerDraw {
  /** 光标底下那一格（`null` = 没有）*/
  hover: number | null;
}

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  flag: 2 | 4,
): void {
  ctx.font = `${PICKER_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = flag === 2 ? 'middle' : 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = PICKER_OUTLINE;
  ctx.strokeText(s, x, y);
  ctx.fillStyle = PICKER_FILL;
  ctx.fillText(s, x, y);
}

/** 画整扇窗（只在这一屏接管时调）*/
export function drawFacilityPicker(
  ctx: CanvasRenderingContext2D,
  sprite: PickerSprite,
  d: PickerDraw,
): void {
  const img = (chunk: number): Sprite | null =>
    sprite(PICKER_ARCHIVE, PICKER_RESOURCE, chunk, pickerKeyedBlack(chunk));

  const panel = img(PICKER_PANEL.chunk);
  if (panel !== null) {
    ctx.drawImage(panel.bitmap, PICKER_PANEL.x - panel.anchorX, PICKER_PANEL.y - panel.anchorY);
  }

  if (d.hover !== null) {
    // 三圈黄框（描边，不填）—— `fcn_0045620f` 画的就是框
    ctx.strokeStyle = PICKER_HOVER_COLOR;
    ctx.lineWidth = 1;
    for (const r of pickerHoverRects(d.hover)) {
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.size - 1, r.size - 1);
    }
    const board = img(PICKER_BOARD.chunk);
    if (board !== null) {
      ctx.drawImage(board.bitmap, PICKER_BOARD.x - board.anchorX, PICKER_BOARD.y - board.anchorY);
    }
  }

  text(ctx, PICKER_TITLE, PICKER_TITLE_AT.x, PICKER_TITLE_AT.y, 2);
  if (d.hover !== null) {
    text(ctx, pickerNameOf(pickerTypeOf(d.hover) ?? -1), PICKER_NAME_AT.x, PICKER_NAME_AT.y, 4);
  }
}

// ============================================================
//  UiScreen（浮窗）
// ============================================================

/**
 * 这一屏要服务**两种**来路：
 *   ① 道具（機器工人）路径 —— 由宿主 `openFacilityPicker()` 起，选完回调；
 *   ② **待决交互** `pending.kind === 'buildFacility'` —— 落点在等级 0 的設施上
 *      （原版 `0x0041a1f0` 那一支：现金够 地價×物價 → 真人 → 同一扇窗 → 选完收费），
 *      选完派 `{type:'buildFacility', facilityType}`、右键派 `declineDecision`。
 */
export type PickerAnswer = (type: number | null) => void;

let pending: PickerAnswer | null = null;
let hover: number | null = null;

/** 这一次开窗是不是「待决交互」那一支（决定选完派什么 action）*/
function isPendingPick(env: UiScreenEnv): boolean {
  return env.state.pending?.kind === 'buildFacility';
}

/** 调试 / 单测用：关掉这一屏 */
export function resetFacilityPicker(): void {
  pending = null;
  hover = null;
}

/** 现在开着吗（单测用）*/
export function facilityPickerOpen(): boolean {
  return pending !== null;
}

/** 开窗；选完（或取消）调一次 `answer` */
export function openFacilityPicker(answer: PickerAnswer): void {
  pending = answer;
  hover = null;
}

export const facilityPickerScreen: UiScreen = {
  id: 'facility-picker',

  /**
   * ★ **浮窗**：原版先 `fcn_00451e7e` 存下 (0,0x28)-(0x1b8,0x1e0) 那块
   *   （VA 0x00440ad0），退出时 `fcn_00451edb` 贴回去 —— 也就是「照常画棋盘 +
   *   在上面盖一扇窗」。本引擎的 `windowed: true` 正是这个语义。
   */
  windowed: true,

  /** 开窗请求还在，**或**正等着选「建哪一种」（`buildFacility` 待决交互）*/
  active: (env: UiScreenEnv) => pending !== null || isPendingPick(env),

  draw(env: UiScreenEnv): void {
    drawFacilityPicker(env.stage, env.sprite as unknown as PickerSprite, { hover });
  },

  move(x: number, y: number, env: UiScreenEnv): void {
    const next = pickerSlotAt(x, y);
    if (next === hover) return;
    hover = next;
    if (next !== null) env.playEffect(PICKER_SOUND_HOVER);
    env.requestRender();
  },

  up(x: number, y: number, env: UiScreenEnv): void {
    const slot = pickerSlotAt(x, y);
    if (slot === null) return;
    const type = pickerTypeOf(slot);
    if (type === null) return;
    // ① 道具那一路：回调交给宿主（它带 `value` 派 `useTool`）
    // ② 待决交互那一路：自己派（与其它屏同一口径）
    if (pending !== null) {
      finish(type, env);
      return;
    }
    hover = null;
    env.dispatch({ type: 'buildFacility', facilityType: type });
    env.requestRender();
  },

  /** 右键 = −1（原版 `0x205` 那一支 @source VA 0x0043febb）*/
  contextmenu(_x: number, _y: number, env: UiScreenEnv): void {
    if (pending !== null) {
      pending(null);
      pending = null;
      hover = null;
      env.requestRender();
      return;
    }
    // ★★ E-20 订正：神明顯靈**代蓋**那一次（`pending.free`）原版右键**无效** ——
    //   `0x0043febb cmp dword [0x48c528],0 / 0x0043fec2 je 0x43fd7e`（忽略），而 `[0x48c528]`
    //   就是 `0x440aac` 的实参（`0x0043fb3c` 在 `0x401` 初始化那一拍存入）；免费那一支
    //   `0x0040b1e2 push 0`。只有改建卡（`0x004431c2 push 1`）能取消。⇒ 窗留着，必须选一种。
    const p = env.state.pending;
    if (p !== null && p.kind === 'buildFacility' && p.free === true) return;
    hover = null;
    env.dispatch({ type: 'declineDecision' });
    env.requestRender();
  },

  key(): boolean {
    // 原版这扇窗的跳表只认 0xf / 0x200 / 0x202 / 0x205 / 0x401 —— 键盘落到 DefWindowProc
    return false;
  },
};

function finish(type: number | null, env: UiScreenEnv): void {
  const answer = pending;
  pending = null;
  hover = null;
  if (answer !== null) answer(type);
  env.requestRender();
}
