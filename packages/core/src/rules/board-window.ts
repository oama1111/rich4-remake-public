/*
 * 棋盘视口里的「方窗」—— 飛彈 / 核彈 / 外星人 / 颱風的爆炸范围，与电脑出牌的「视野」 Q-TOOL-1
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 先前这里的口径是「**节点坐标**的方窗」：`|dx| ≤ 半径 && |dy| ≤ 半径`。那是近似 ——
 * 原版取窗用的是**屏幕空间**，而且只认「锚点那一个像素」。逐条核如下。
 *
 * ## 一、取窗 `0x40a45c(size)` —— 在一张 440×440 的 id 图上挖方窗
 *
 * ```asm
 * 0040a464  cmp edi, -1 / jne 0x40a472
 * 0040a469  xor esi, esi
 * 0040a46b  mov edi, 0x1b8                     ; size = -1 ⇒ 起点 0、边长 440（整幅）
 * 0040a472  mov ebp, 0xdc                      ; 220
 * 0040a477  sub ebp, edi                       ; q = 220 − size
 * 0040a479..0040a48f  esi = 441 × q            ; ★ 窗口左上角在 id 图里的**线性**下标
 * 0040a492  add edi, edi                       ; 边长 = 2 × size
 * 0040a494  call 0x409de7                      ; 按**当前镜头**重建那张 440×440 的 id 图
 * 0040a49d..0040a4c5  逐行（步长 0x1b8）逐列取
 * 0040a4b3  mov cx, word [id图 + (esi+列)*2]
 * 0040a4b6  test cx, cx / je 下一个             ; 空格不进清单
 * 0040a4bb  mov word [ebx*2 + 0x48b8c4], cx / inc ebx   ; 摊平成一张实例清单
 * ```
 * 把 `441q = 440q + q` 展开 ⇒ 窗口正好是 id 图里 **`[q, q+2·size) × [q, q+2·size)`** 那一块，
 * 也就是**以图心 (220,220) 为中心、半宽 size 的方窗**（半开区间：上界取不到）。
 * 而 id 图的坐标就是屏幕坐标（棋盘区左上角 = 屏幕 (0,40)）：

 * ```asm
 * 00409dea  push 0x5e880 / push 0        ; memset(id图, 0, 440×440×2)
 * 00409e4a  ebx = (int16)[实例 + 0x48a854]          ; 实例的屏幕 X
 * 00409e51  edx = (int16)[实例 + 0x48a856] − 0x28   ; 屏幕 Y − 40（顶部工具条）
 * 00409e99  cmp ebx, 0x1b8 / jge 跳过               ; 画不进棋盘区的不填
 * 00409ea5  cmp edx, 0x1b8 / jge 跳过
 * 00409ec3  edx = 440×y + x                         ; ★ 每个实例**只写一粒**（点，不是精灵外框）
 * 00409ede  or  word [id图 + edx*2], ax             ; 同一像素上多个实例按位或
 * ```
 * ⇒ 判据是「这个实例的**锚点**投影到棋盘区后落在哪一格」，不是「节点坐标在不在方框里」。
 *
 * ## 二、棋盘区的基准点：屏幕 (220, 260)
 *
 * ```asm
 * 004083cc  call 0x407a2c(camX, camY, &o1, &o2)   ; 镜头自己的块内余量过亚格矩阵
 * 004083e1  add dword [esp + 0x34], 0xdc          ; oX = o1 + 220
 * 004083e9  add dword [esp + 0x20], 0x104         ; oY = o2 + 260
 * 004083f1..（实例循环）屏幕X = 表[col,row].x − o + oX
 * ```
 * 也就是 `projectWorld`（`packages/data/src/projection.ts`，逐项核过 8×29×29 表）
 * 的输出：**相对棋盘区中心的像素偏移**。于是本文件的判据只有一句：
 *
 *   `−half ≤ px < half 且 −half ≤ py < half`（`px,py` = 点在「镜头居中于 center」时的投影偏移）
 *
 * ## 三、谁把镜头挪到窗心上的
 *
 * `damage_area`（`0x0040ac7b`）**自己不动镜头** —— 四个调用点都在它之前
 * `call 0x41d476(x, y, …)`，经 `0x415e70` → `0x40829d(x, y)` 把镜头**立刻**设成那一点：
 *
 * | 调用点 | 是什么 | 窗心 (x, y) 的来源 |
 * |---|---|---|
 * | `0x00447065` → `0044707a` | 飛彈（半径 `0x64`、flags `0x26`、轻重 0）| `0x40af12(目标)` |
 * | `0x00447b77` → `00447b8c` | 核子飛彈（半径 `-1`、轻重 1）| `0x40af12(目标)` |
 * | `0x0044921d` → `0044922d` | 新聞 4 外星人（半径 `0x64`、轻重 1、攻击者 −1）| `0x40af12(rand 挑的地块/設施)` |
 * | `0x0044ac33` → `0044ac43` | 新聞 20 颱風（半径 `0x64`、flags 6、攻击者 −1）| `0x40af12(rand 挑的地块/設施)` |
 *
 * 而 `0x40a0b1(x, y, r)` 是**同一个窗**的另一份实现（自己填图、自己摊平）：中心由调用方给，
 * 只收「有主的」地块/設施与**当前玩家**（AI 用来判「这一发会不会炸到自己」，见
 * `ai/tool-policy.ts`）。`0x409ef9()` 则是同一套投影下的**节点**版清单（格子，不是实例）。
 *
 * ## 四、实体锚点用**谁**的坐标
 *
 * - **地块 / 設施 / 企業**：记录**自己的** `+0/+2`（`0x4090fc` 的地块循环：
 *   `movsx eax, word [ebp]` / `[ebp+2]`，`ebp` = 地块记录；設施 `0x40930e` 同形）。
 *   它们与所在**节点**的坐标差 ~40 像素（实测地图 0001：`Δ(0,−47)` / `Δ(±36,−35)`）
 *   —— 与本引擎 `render.ts` 的「建筑画在地块自己的 x/y 上」是同一条（Q-LAYOUT-4）。
 * - **棋子 / 四大惡人 / 地上物件**：他们的世界坐标（站在节点上时 = 节点坐标）。
 * - `0x409ef9` 的**节点**清单：节点坐标。
 *
 * ★★ 联机口径：**一律按视角 0 取值**（需求方 2026-09-25：「联机时的爆炸范围统一按视角0取值」）。
 *   原版取窗用的是当时的视角旋转（投影表 `[0x499088]`，8 份）。但视角是**每个客户端各自的镜头**
 *   （原版 `0x48c570`/`0x48c574` 一族只在客户端），刻意**不进** `stateFingerprint`
 *   （见 `docs/audit/provenance-summary.md` §八.3 与 `net/net.test.ts` 的反向钉子）。
 *   若窗口跟着 `state.viewRotation` 走，同一串 action 在两个转过视角的客户端上会算出**不同的局面**，
 *   直接违反「服务器与客户端同一条 reducer」这条底线 ⇒ 规则层恒用视角 0。
 *   代价：单机里转过视角之后爆炸范围/视野不再跟着转 —— **有意偏离**，与「原版无此口径」一起登记。
 */

import { VIEW_COUNT, projectWorld } from '@rich4/data';

/** 棋盘区边长（屏幕像素） @source 0x40a46b `mov edi, 0x1b8`；`0x5e880` = 440×440×2 字节 */
export const BOARD_VIEW_SIZE = 0x1b8;
/** 「整幅画面」那一档的半宽 @source 0x40a472 `mov ebp, 0xdc`（= 0x1b8 ÷ 2） */
export const BOARD_VIEW_HALF = 0xdc;
/**
 * 规则层取窗恒用的视角 —— ★ 见文件头第四节末尾（联机口径）。
 * 单机也不需要另一份：`state.viewRotation` 是表现态。
 */
export const RULE_VIEW_ROTATION = 0;

/** 一个世界坐标点（与世界单位同一套：节点/地块/設施记录的 `+0/+2`） */
export interface BoardPoint {
  x: number;
  y: number;
}

/**
 * 把世界坐标投影成「**相对棋盘区中心**的屏幕像素偏移」—— 镜头居中于 `center`。
 *
 * @source `0x409166..0x40918c`（地块实例那一支）与 `0x40a0b1` 的同名一段：
 *   `屏幕X = 表[col,row].x − 点自己的亚格余量 + 镜头自己的亚格余量 + 220`，
 *   减掉 220/260 的基准就是本函数的返回值。列/行 = `(坐标 >> 5) − 镜头块 + 14`。
 *
 * @param center 镜头中心（窗心）—— 原版是 `0x40829d(x, y)` 写进 `[0x48b2ac]/[0x48b2b0]` 的那一对
 * @returns 偏移；该点落在 29×29 的投影表之外（原版此时根本不画它）返回 `null`
 */
export function projectOnBoard(
  center: BoardPoint,
  x: number,
  y: number,
  view: number = RULE_VIEW_ROTATION,
): { x: number; y: number } | null {
  const cx = Math.trunc(center.x);
  const cy = Math.trunc(center.y);
  return projectWorld(view % VIEW_COUNT, x, y, cx >> 5, cy >> 5, cx & 0x1f, cy & 0x1f);
}

/**
 * 这一点在以 `center` 为中心、半宽 `half` 的方窗里吗。
 *
 * @source `0x40a472..0x40a4c5`：窗口 = id 图的 `[220−half, 220+half) × [220−half, 220+half)`，
 *   对应到相对偏移就是 `−half ≤ px < half`（**上界取不到**）—— 整数坐标下这一格之差是真差别。
 *
 * @param half 半宽：飛彈/颱風/外星人 = `0x64`、核彈与「整幅画面」= `BOARD_VIEW_HALF`
 */
export function inBoardWindow(
  center: BoardPoint,
  point: BoardPoint,
  half: number,
  view: number = RULE_VIEW_ROTATION,
): boolean {
  const p = projectOnBoard(center, point.x, point.y, view);
  return p !== null && p.x >= -half && p.x < half && p.y >= -half && p.y < half;
}

/**
 * 这一格地块/設施在 id 图里**有没有实例** —— 没有就扫不到它，任何爆炸都不该动它。
 *
 * @source 地块 `0x4091df..0x409240`、設施 `0x4093f3..0x409488`（两段同形）：
 * ```asm
 * 004091df  cmp byte [ebp + 0x1a], 0 / je 0x40920f   ; level == 0 ⇒ 走「没房子」那一支
 * 00409216  cmp byte [ebp + 0x19], 0 / je 0x40923e   ; owner == 0 ⇒
 * 0040923e  xor edi, edi / mov dword [esi + 0x48a84c], edi   ; ★ 贴图指针 +4 写 0
 * 00409e3d  cmp dword [eax + 0x48a84c], 0 / je 0x409ee1      ; 0x409de7 填图时跳过 ⇒ 图上没有它
 * ```
 * ⇒ 「既没房子又没主」的地块/設施**不进 id 图**。飛彈/核彈/外星人/颱風扫的是那张图，
 *   所以这几格根本不在候选里（0 级但有主、或有房子但无主 —— 两种都在图上）。
 */
export function boardInstancePresent(level: number, owner: number): boolean {
  return level !== 0 || owner !== 0;
}
