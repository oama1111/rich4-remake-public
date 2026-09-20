/*
 * 機器工人（道具 9）的**原地建屋動效** —— 全部照 exe
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块只算「那一段此刻该画第几帧、画在哪」，不碰任何规则。
 *   ★ C-DET-4：动效**绝不进 state/history** —— 丢了只是少一段动画。
 *
 * 需求方 2026-09-16 报 Q-TOOL-4「機器工人无法给自己的地块修成房子」，
 * 规则与拾取已由 `Q-TOOL-4.md` 结案；**剩下的是「用完之后什么都没播」**。
 * 这一段就是补那两段影片。判据全部来自 `rich4_use_tool_jiqigongren`
 * （**VA 0x00447295**）的调用序列：
 *
 * ```asm
 * 00447318  push 0 / push 0x229         ; ★ 大锤影片 = Data.mkf 资源 0x229（553）
 * 0044731f  mov ebp, [0x48a0e4] / push ebp / call 0x450441 ; read_mkf(Data.mkf, 0x229, 0, 0)
 * 0044733c  call 0x41d476               ; 镜头/落点：对准选中的那个实例
 * 00447345  call 0x40b110               ; ★ 效果本体（等级 +1）—— 在影片之前
 * 0044736d  test byte [esp], 0x80       ; ★ 刚盖到 5 级？
 * 00447373  call 0x40b0cd               ; ★ 是 → 再播一段（资源 0x20b）
 * 00447378  call 0x41d546               ; refresh_screen（重画棋盘）
 * ```
 * 两段的 `push` 序列（`fcn_0045144f`，VA 0x0045144f，参数自右向左）：
 *
 * ```asm
 * ; 大锤（VA 0x00447350..0x0044735c）
 * push 0x5b      ; arg5 = 音效号（Effect.mkf）
 * push 0x2c0001  ; arg4 = flags：低字节 0x01 = bit0「存背景/画进后台面」
 * push 0x28      ; arg3 = y（屏幕）
 * push 0        ; arg2 = x（屏幕）
 * push esi      ; arg1 = 已解开的影片
 * call 0x45144f
 *
 * ; 「剛滿 5 級」那一段（fcn_0040b0cd，VA 0x0040b0cd）
 * 0040b0ce  push 0 / push 0 / push 0x20b / push Data.mkf / call 0x450441
 * 0040b0e8  push 0 / push -1 / call 0x40829d     ; 镜头复位后重画棋盘
 * 0040b0f4  push 0x5a / push 1 / push 0x28 / push 0 / push ebx / call 0x45144f
 * ```
 *
 * ## 影片规格（`Data.mkf` 资源头，标准 FLIC）
 *
 * 资源 0x229 / 0x20b 都是**标准 Autodesk FLIC（FLC）**：`+4` 是魔数 `0xaf12`、
 * `+6` 帧数、`+8/+0xa` 宽高、`+0x10` **每帧毫秒**、`+0x80` 起是第一帧
 * （`cmp word [ebx + 4], 0xaf12` VA 0x00450d00；`[eax + 0x10] → [0x48c870]`
 * VA 0x00450d72；块类型认 `4/7/0xc/0xf/0x10` = FLI_COLOR256/SS2/LC/BRUN/COPY）。
 * 逐字节核过（`packages/assets-pipeline` 的 `parseFlicInfo` 同一算法）：
 *
 * | 资源 | 帧数 | 宽×高 | 每帧 | 总长 | 音效 |
 * |---|---|---|---|---|---|
 * | `0x229`（大锤）| **68** | 440×440 | **57 ms** | 3876 ms | `Effect.mkf` 0x5b（91）|
 * | `0x20b`（剛滿 5 級）| **66** | 440×440 | **42 ms** | 2772 ms | `Effect.mkf` 0x5a（90）|
 *
 * ## 落点与锚点：**整块棋盘，不是那一格**
 *
 * 两段的 arg2/arg3 = `(0, 0x28)` —— 屏幕坐标 `(0, 40)`，也就是**棋盘左上角**。
 * `fcn_00450ced` 把它们存进 `[0x48c830]/[0x48c834]`（VA 0x00450d32/0x00450d38），
 * 主循环再把 `440 × (y − 0x28) + x` 算成后台面的**字节偏移**（VA 0x00450e1f..0x00450e3c，
 * 步长 440、16bpp ⇒ 640×480 面），所以影片是**原地**盖在整块 440×440 棋盘上的。
 * 影片自己的锚点就是左上角 `(0, 0)`（帧是整幅 440×440）。
 *
 * ⇒ 被盖的那块地盘靠 `fcn_0041d476`（VA 0x0041d476）先把镜头**对准选中的实例**
 *   （它把目标屏幕坐标与当前玩家坐标比对，不同就记下目标并重画）——
 *   **影片内容固定在画面里**，随镜头走的是它下面的棋盘。
 *
 * ## 节拍：一帧等 `speed` 毫秒，**播完就停**，不循环、不重复
 *
 * `fcn_0045144f` 的主循环（VA 0x00451513）：
 *
 * ```asm
 * 00451513  cmp esi, dword [0x48c870]   ; esi = 这一帧已经等了多久
 * 00451519  jae 0x45151f                ; 等够了 → 进下一帧
 * 0045151b  test ebx, ebx / je 0x4514b7 ; 没按键 → 继续重画这一帧
 * 0045117d  edx = [0x48c874] / inc edx / mov [0x48c874], edx   ; ★ 帧号 +1
 * 0045118a  cmp edx, [0x48c86c]         ; = 帧数？
 * 00451192  jne 下一帧
 * 00451194  cmp byte [0x48c883], 0      ; flags bit2 = 循环？（这里两段都是 0）
 * 004511b1  [0x48c844] = flags>>8 & 0xff ; 重复次数（这里都是 0）
 *           ; 都不满足 ⇒ 返回 1 = 收场
 * ```
 * 两段的 flags 低字节都是 `1`（bit1/bit2/bit3 全 0，重复次数 0），
 * 故两段都**只播一遍**。
 *
 * ★ 还顺带钉住一条：bit1（`[0x48c880]`）是「按键/点击能不能打断」
 *   （VA 0x004514d6：置位时认 `0x202` 左键抬 / `0x205` 右键抬 / `0x101` 按键 → 提前收场）。
 *   两段的 bit1 **都是 0** ⇒ **原版这 3.9 秒 + 2.8 秒是强制看完的**，点不掉。
 *   本引擎照此不设「点击跳过」。
 *
 * ## 什么时候播
 *
 * 1. 先 `take_tool`（0x004472fb）→ 再 `fcn_0040b110` 把等级 +1（0x00447345）
 *    —— **状态先变、影片后播**（所以影片里那一级已经盖好了）；
 * 2. 大锤 `0x229` **恒播**（只要选到了目标）；
 * 3. 「剛滿 5 級」那一段 `0x20b` 只在 `fcn_0040b110` 返回值的 **bit7** 置位时才接
 *    （0x0044736d `test byte [esp], 0x80`）。
 *    ★★ 2026 订正：先前这里写着「bit7 **只有地块那一支置位**，設施那一支
 *    （0x0040b1f4）是 `mov eax, 1 / inc byte [ebx + 0x1a]`，**没有** `or al, 0x80`」
 *    —— **读反了**。`0x0040b1f4` 是「設施**等级 0** → 定种类首建」那一条，
 *    **只有它**不置位；等级 ≥ 1 的設施走 `0x0040b1f9` 那一支：
 *    ```asm
 *    0040b212  mov byte [ebx + 0x1a], dl   ; level++
 *    0040b215  cmp dl, 5 / jne 0x40b21f
 *    0040b21a  mov eax, 0x81               ; ★ 旅館/購物中心/研究所 4→5 照样置 bit7
 *    ```
 *    与地块支（`0x0040b169 cmp cl, 5 / jne` / `0x0040b16e or al, 0x80`）**同形**。
 *    真值见 `rich4-spec/tests/test_land_mutation_gates.py` 的 `[B]` 段
 *    （「住宅 4→5 ⇒ 0x81」「旅館 4→5 ⇒ 0x81」）。⇒ 設施盖到满级**也播** `0x20b`。
 *
 *    ★ 这条 bit 现在**不由本模块算**（C-ARC-2）：core 把它放在
 *    `GameState.lastBuildUpgrades`（瞬态、不进指纹，C-DET-4）里，
 *    本模块只按 `buildFxPlan` 排段序 —— 等级比较一行都不在这里。
 * 4. 全部播完才 `refresh_screen`（0x00447378 → `fcn_0041d546` VA 0x0041d546：
 *    `[0x48be18] = 0` + `fcn_0041906a(1)`，后者往棋盘窗口发 **WM_PAINT（0xf）**
 *    强制重画 —— 在本引擎里对应「下一帧 `requestAnimationFrame` 重绘」，
 *    因为棋盘本来就每帧整幅重画，不需要额外一拍）。
 * 5. ★ 「大锤 + 0x20b」这套序列**不是機器工人专属**：`0x40b0cd`（播 0x20b 的那一支）
 *    全 exe 有 8 个调用点，其中 7 处前面就是一条 bit7 判断。复刻接了三处：
 *    · 機器工人（`0x00447295`）→ `robotWorker`：**大锤 + 0x20b**；
 *    · 魔法屋「就地加蓋房屋」（`0x00431f67` 那一支，消费点在 `0x00432085`）
 *      → `magicHouse`：**大锤 + 0x20b**（与機器工人同构）；
 *    · 天使卡 9（`0x004434c0`，消费点在 `0x004436b5`）→ `angelCard`：
 *      **只有 0x20b**（该函数里既没有 `push 0x229`，也没有 `call 0x450441`
 *      / `call 0x45144f` —— 它不播大锤）；
 *    · 建設公司（`0x0041abde` / `0x0041a3be` 尾块）→ `companyBuild`：**大锤 + 0x20b**；
 *    · ★ **自己的地落点「升級房子」**（`0x004198b9` 自有地分支）→ `ownUpgrade`：
 *      **只有 0x20b**。判据是 `0x004199eb cmp byte [esi + 0x1a], 5` →
 *      `0x00419a21 call 0x40b0cd`；这一支**不走 `0x40b110`**
 *      （`0x004199d1 inc byte [esi + 0x1a]` 直接加 1），也**没有** `push 0x229`。
 *
 * ★★ 「谁播大锤」是一张**正面表**（`HAMMER_SOURCES`），不是「除了天使卡都播」：
 *    大锤 `0x229` 的 `push` 点全 exe 只有 **4** 处（`disasm.py find 6829020000`）——
 *    `0x0041aab8` / `0x0041ad4d`（建設公司）、`0x00432028`（魔法屋）、
 *    `0x0044731a`（機器工人）。负判据（`source !== 'angelCard'`）会让**日后任何
 *    新出口**默认拿到大锤 —— 「自己的地升級」正是被它误伤的那一类。
 *
 * ⚠️ 一处 exe 差异（登记在 `docs/deviations/Q-TOOL-6.md`）：原版在
 *   **选到目标就扣道具**（0x004472fb 在 0x00447345 之前），盖不动也照样播；
 *   本引擎只在真正生效时才收走道具，于是「没生效」时**不播**。
 */

import { SOUND_IDS } from '@rich4/assets-pipeline';
import type { BuildUpgradeHint, BuildUpgradeSource, GameState } from '@rich4/core';
import type { LoadedFlic } from './assets.ts';

/**
 * 觸發這段動效的道具号 —— 機器工人。
 * @source `packages/data/src/tools.ts`：`{ id: 9, key: 'jiqigongren' }`；
 *   调用点是 `rich4_use_tool_jiqigongren`（VA 0x00447295）
 */
export const BUILD_TOOL_ID = 9;

/** 两段影片都在 Data.mkf @source VA 0x0044731f / 0x0040b0d7 `[0x48a0e4]` */
export const BUILD_FX_ARCHIVE = 'Data.mkf';

/**
 * 大锤影片 = Data.mkf 资源 **0x229（553）**。
 * @source VA 0x0044731a `push 0x229`
 */
export const BUILD_HAMMER_RESOURCE = 0x229;

/**
 * 「剛滿 5 級」那一段 = Data.mkf 资源 **0x20b（523）**。
 * @source VA 0x0040b0d2 `push 0x20b`
 */
export const BUILD_MAX_RESOURCE = 0x20b;

/**
 * 影片落点 —— **屏幕**坐标 `(0, 0x28)` = 棋盘左上角。
 *
 * @source 大锤 VA 0x00447357（y）/ 0x00447359（x）；滿級 VA 0x0040b0f8 / 0x0040b0fa
 *   —— 都是 `push 0x28` + `push 0`。棋盘区在屏幕 (0, 40) 起，
 *   故**棋盘局部坐标就是 (0, 0)**（与 `stage.ts` 的 `LAYOUT.board` 一致）。
 */
export const BUILD_FX_X = 0;
export const BUILD_FX_Y = 0x28;

/**
 * 影片在**棋盘局部**里的落点 —— 屏幕 (0, 0x28) 减棋盘原点 (0, 40) ⇒ **(0, 0)**。
 *
 * ★ 为什么单列一个常量：`BoardRenderer` 的 ctx 是那块 **439×440 的棋盘离屏画布**
 *   （`main.ts` 的 `boardCanvas`，最后一整块 `stageCtx.drawImage(boardCanvas, 0, 40)`），
 *   而原版给的 `(0, 0x28)` 是**屏幕**坐标。先前渲染器直接把 `BUILD_FX_Y`（= 40）
 *   当棋盘局部 y 用 ⇒ 影片整体下移 40 px、底部 40 px 被裁掉。
 *   2026-09-16 订正：渲染器改用本常量。
 */
export const BUILD_FX_BOARD_Y = 0;

/** 影片尺寸 = 整块棋盘 440×440 @source 资源头 `+8/+0xa`（VA 0x00450d1c / 0x00450d28）*/
export const BUILD_FX_W = 440;
export const BUILD_FX_H = 440;

/**
 * 大锤那条音效号 —— `Effect.mkf` **0x5b（91）**。
 * @source VA 0x00447350 `push 0x5b`（= `fcn_0045144f` 的 arg5）+
 *   VA 0x00454320 `read_mkf([0x48a058] = _rich4_effect_mkf, arg5, 0, 0)`；
 *   实测 Effect.mkf 资源 91 是 RIFF/WAVE。
 */
export const BUILD_HAMMER_SOUND = 0x5b;

/**
 * 「剛滿 5 級」那条音效号 —— `Effect.mkf` **0x5a（90）**。
 * @source VA 0x0040b0f4 `push 0x5a`；实测 Effect.mkf 资源 90 是 RIFF/WAVE。
 */
export const BUILD_MAX_SOUND = 0x5a;

/** 一段影片的规格 —— 两个字面量都逐字节核过资源头 */
export interface BuildClip {
  /** `Data.mkf` 资源号 */
  resource: number;
  /** 帧数 @source 资源头 +0x06（VA 0x00450d10）*/
  frames: number;
  width: number;
  height: number;
  /** 每帧停留多少毫秒 @source 资源头 +0x10（VA 0x00450d72）*/
  frameMs: number;
  /** 随影片一起响的音效号（`Effect.mkf`）@source 调用点的 arg5 */
  sound: number;
}

/** 大锤 @source Data.mkf 0x229 头：68 帧 / 440×440 / 57 ms / 音效 91 */
export const BUILD_HAMMER: BuildClip = {
  resource: BUILD_HAMMER_RESOURCE,
  frames: 68,
  width: BUILD_FX_W,
  height: BUILD_FX_H,
  frameMs: 57,
  sound: BUILD_HAMMER_SOUND,
};

/** 剛滿 5 級 @source Data.mkf 0x20b 头：66 帧 / 440×440 / 42 ms / 音效 90 */
export const BUILD_MAX_LEVEL: BuildClip = {
  resource: BUILD_MAX_RESOURCE,
  frames: 66,
  width: BUILD_FX_W,
  height: BUILD_FX_H,
  frameMs: 42,
  sound: BUILD_MAX_SOUND,
};

/** 两段影片的名字 */
export type BuildClipName = 'hammer' | 'maxLevel';

/** 名字 → 规格 */
export function buildClip(name: BuildClipName): BuildClip {
  return name === 'hammer' ? BUILD_HAMMER : BUILD_MAX_LEVEL;
}

/** 一段影片总共播多久（毫秒）= 帧数 × 每帧毫秒（不循环、不重复）*/
export function clipTotalMs(name: BuildClipName): number {
  const c = buildClip(name);
  return c.frames * c.frameMs;
}

/**
 * 正在播的这一段。
 *
 * ★ 纯数据：`main.ts` 拿它当**表现层的状态位**，不进 `GameState`（C-DET-4）。
 */
export interface BuildFx {
  /** 现在播的是哪一段 */
  clip: BuildClipName;
  /** 这一段是什么时候开始的（`performance.now()` 时基）*/
  startedAt: number;
  /**
   * 这一段播完之后要不要接「剛滿 5 級」那一段（`0x20b`）
   * = `fcn_0040b110` 返回值的 bit7（`BuildUpgradeHint.reachedMaxLevel`）。
   */
  thenMaxLevel: boolean;
}

/**
 * **会先播大锤 `0x229` 的** `source` —— 正面表，不是「除了某几个之外都播」。
 *
 * @source 大锤的 `push 0x229` 全 exe 只有 4 处（`disasm.py find 6829020000` 命中 4 处）：
 *   · `0x0041aab8` / `0x0041ad4d` = 建設公司那一族 → `companyBuild`
 *   · `0x00432028` = 魔法屋「就地加蓋房屋」→ `magicHouse`
 *   · `0x0044731a` = 機器工人（道具 9）→ `robotWorker`
 *
 * 不在表里的两个（`angelCard` 0x004434c0 / `ownUpgrade` 0x004198b9）
 * **只**在 `reachedMaxLevel` 时播 `0x20b`。
 */
export const HAMMER_SOURCES = ['robotWorker', 'magicHouse', 'companyBuild'] as const;

/** 这个 `source` 要不要先播大锤 `0x229`（见 `HAMMER_SOURCES` 的取证）*/
export function playsHammer(source: BuildUpgradeSource): boolean {
  return (HAMMER_SOURCES as readonly string[]).includes(source);
}

/**
 * **会响「顯靈／自己加蓋」那一声（`Effect.mkf` 50）的 `source`** —— 正面表。
 *
 * @source `push 0x4823da / call 0x4542ce` 全 exe 共 **4** 处
 *   （`disasm.py find 68da234800`）：
 *   | VA | 哪一支 | 本引擎的 `source` |
 *   |---|---|---|
 *   | `0x0040f4f3` | 天使顯靈（落点尾块）| `godManifest` |
 *   | `0x0040f9dc` | 福神顯靈（自己地升級后加倍）| `godManifest` |
 *   | `0x004199de` | 自己的地落点「升級房子」| `ownUpgrade` |
 *   | `0x0041a289` | 落点首建等级 0 的設施 | **够不到**（那一条不写 `lastBuildUpgrades`）|
 *
 *   ⇒ 只有这两个 `source` 会响；`robotWorker` / `magicHouse` / `companyBuild` /
 *   `angelCard` 各有自己的大锤/滿級音效（`BUILD_HAMMER.sound` / `BUILD_MAX_LEVEL.sound`）。
 *   号码本身的取证见 `SOUND_IDS.GOD_MANIFEST`（表项 `0x4823da` = 24 × 8 + 0x48231a）。
 */
export const MANIFEST_SOUND_SOURCES: readonly BuildUpgradeSource[] = ['godManifest', 'ownUpgrade'];

/** 顯靈／自己加蓋那一声的音效号 —— `Effect.mkf` **50** @source 见 `SOUND_IDS.GOD_MANIFEST` */
export const MANIFEST_BUILD_SOUND: number = SOUND_IDS.GOD_MANIFEST;

/** 这个 `source` 要不要响那一声（见 `MANIFEST_SOUND_SOURCES`）*/
export function playsManifestSound(source: BuildUpgradeSource): boolean {
  return MANIFEST_SOUND_SOURCES.includes(source);
}

/**
 * 本 action 该响的「顯靈／自己加蓋」音效号；没有就 `null`。
 *
 * ★ 与 `buildFxPlan` **分开**：那一声在 `0x40b110` 成功之后就响（`0x0040f4f3`），
 *   **早于** 0x20b 影片，而且**盖到 5 级才有片**这件事与它无关 ——
 *   没到 5 级、一段影片都不播时，这一声照样响。
 *   ⇒ 调用方**不能**把它挂在 `plan.hammer || plan.maxLevel` 那道闸之后。
 */
export function manifestSoundFor(hints: readonly BuildUpgradeHint[]): number | null {
  return hints.some((h) => playsManifestSound(h.source)) ? MANIFEST_BUILD_SOUND : null;
}

/**
 * 本 action 该播的**段序**。
 *
 * ★ C-ARC-2：这是一张**纯查表**，一个等级都不比 —— bit7 与「谁发起的」
 *   都在 core 写好的 `GameState.lastBuildUpgrades` 里（`BuildUpgradeHint`）。
 *
 * @source · 機器工人 `0x00447295`：`0x0044731a push 0x229` +
 *   `0x00447326 call 0x450441`（read_mkf）+ `0x0044735c call 0x45144f`（播），
 *   之后 `0x0044736d test byte [esp], 0x80` → `0x00447373 call 0x40b0cd`；
 *   · 魔法屋「就地加蓋」`0x00431f67`：`0x00432028 push 0x229` +
 *   `0x00432034 call 0x450441` + `0x00432074 call 0x45144f`，之后
 *   `0x00432085 test byte [esp+0xa8], 0x80` → `0x0043208f call 0x40b0cd`；
 *   · 建設公司 `0x0041abde`：`0x0041ad4d push 0x229` + `0x0041ad99 call 0x45144f`，
 *   之后 `0x0041adaa test byte [esp+0xbc], 0x80` → `0x0041adb4 call 0x40b0cd`；
 *   · 天使卡 `0x004434c0`：整个函数里**没有** `0x229` / `call 0x450441` /
 *   `call 0x45144f`，只有 `0x004436b5 test al, 0x80` → `0x004436d4 call 0x40b0cd`；
 *   · ★ 自己的地落点升級 `0x004198b9`：函数体里同样**没有** `0x229`，
 *   只有 `0x004199eb cmp byte [esi + 0x1a], 5` → `0x00419a21 call 0x40b0cd`。
 *
 * 返回 `{ hammer: false, maxLevel: false }` = 本 action 不该起播。
 */
export function buildFxPlan(hints: readonly BuildUpgradeHint[]): { hammer: boolean; maxLevel: boolean } {
  if (hints.length === 0) return { hammer: false, maxLevel: false };
  // 一条 action 里可能有多条（魔法屋四位中签者 / 天使卡同區批量）。
  // 原版是阻塞式一段接一段播；本引擎同一时刻只播一条，故取**并集**：
  // 只要有一次是大锤族就播大锤，只要有一次剛滿 5 級就接 0x20b。
  const hammer = hints.some((h) => playsHammer(h.source));
  const maxLevel = hints.some((h) => h.reachedMaxLevel);
  return { hammer, maxLevel };
}

/** 段名常量（免得散落字面量）@source 两段的资源号见 `BUILD_HAMMER_RESOURCE` / `BUILD_MAX_RESOURCE` */
const BUILD_HAMMER_NAME: BuildClipName = 'hammer';
const BUILD_MAX_NAME: BuildClipName = 'maxLevel';

/**
 * 取**本 action**的加蓋事件；没有就返回空数组。
 *
 * ★「本 action」的判据是**引用相等**：core 只在真的发生加蓋时才换一个新数组
 *   （`state/types.ts` 的 `GameState.lastBuildUpgrades`），所以
 *   `state.lastBuildUpgrades !== before.lastBuildUpgrades` 就等价于
 *   「这一条 action 里有加蓋」—— 不需要看 action 种类，也不需要比等级。
 */
export function buildUpgradesOf(
  state: Pick<GameState, 'lastBuildUpgrades'>,
  before: Pick<GameState, 'lastBuildUpgrades'>,
): readonly BuildUpgradeHint[] {
  const now = state.lastBuildUpgrades ?? [];
  if (now === (before.lastBuildUpgrades ?? [])) return [];
  return now;
}

/**
 * 开播。
 *
 * @param reachedMaxLevel `0x40b110` 返回值的 bit7 —— **core 的
 *   `BuildUpgradeHint.reachedMaxLevel`**（先前是本模块用「地块等级 4→5」
 *   自己比的，那是把规则抄进表现层，已按 C-ARC-2 改掉）。
 * @param withHammer 要不要先播大锤 `0x229`。機器工人 / 魔法屋 / 建設公司**要**
 *   （= `playsHammer(source)`）；天使卡**不要**（它的函数体里没有 0x229），
 *   自己的地落点升級**也不要**（`0x004198b9` 里同样没有 0x229）。
 *   ⚠️ 前置条件：调用方必须先按 `buildFxPlan` 判过「至少有一段要播」——
 *   `withHammer = false && reachedMaxLevel = false` 时本函数仍会返回
 *   `maxLevel` 那一段（那是调用方违约，不是本函数的兜底）。
 */
export function beginBuildFx(now: number, reachedMaxLevel: boolean, withHammer = true): BuildFx {
  if (!withHammer) return { clip: BUILD_MAX_NAME, startedAt: now, thenMaxLevel: false };
  return { clip: BUILD_HAMMER_NAME, startedAt: now, thenMaxLevel: reachedMaxLevel };
}

/**
 * 现在该画这一段的第几帧（**0 基**，播完钉在最后一帧上）。
 *
 * @source VA 0x0045117d：帧号从 0 起、每帧等 `[0x48c870]`（= 资源头 +0x10）
 *   才 +1，到 `帧数 − 1` 为止；一帧都不循环。
 */
export function buildFxFrame(fx: BuildFx, now: number): number {
  const c = buildClip(fx.clip);
  const k = Math.floor((now - fx.startedAt) / c.frameMs);
  if (!Number.isFinite(k) || k < 0) return 0;
  return Math.min(c.frames - 1, k);
}

/** 这一段播完了吗（时间到）*/
export function clipDone(fx: BuildFx, now: number): boolean {
  return now - fx.startedAt >= clipTotalMs(fx.clip);
}

/**
 * 推进一段：到点就翻到下一段（大锤 → 滿級），否则返回 `null` = 整段收摊。
 *
 * ★ 下一段的起点取 `本段起点 + 本段总长`（不是 `now`）—— 原版是**阻塞**播放，
 *   两段之间没有缝隙；这里也照「按时间轴接」而不是「按渲染帧接」，
 *   掉帧时不会把第二段吃掉一截。
 */
export function stepBuildFx(fx: BuildFx, now: number): BuildFx | null {
  if (!clipDone(fx, now)) return fx;
  if (fx.clip === 'hammer' && fx.thenMaxLevel) {
    return { clip: 'maxLevel', startedAt: fx.startedAt + clipTotalMs('hammer'), thenMaxLevel: false };
  }
  return null;
}

/*
 * ★ 已删除：`reachedMaxLandLevel(before, after, landId)`（C-ARC-2）。
 *
 * 它先前在客户端按「加之前 4、加之后 5」自己判 bit7，还附了一句**写反了的**
 * 注释（「設施那一支不置位，故設施盖到满级不播 0x20b」，见文件头第 3 条）。
 * 现在这条 bit 由 core 算（`rules/tool-effects.ts` 的
 * `BuildResult.reachedMaxLevel` / `buildUpgradeBit7`），经
 * `GameState.lastBuildUpgrades` 的 `BuildUpgradeHint.reachedMaxLevel` 交过来，
 * 本模块只读不判 —— 于是「設施 4→5 也置 bit7」这条真值不可能再被抄错一次。
 */

/**
 * 这条动效现在该画哪张图；不在播、或影片还没解好 → `null`。
 *
 * @param flics 已解好的影片（`assets.getFlic('Data.mkf', 资源号)`）；
 *   没到货就先给 `null`，画面这一帧空着，下一帧会补上。
 */
export function buildFxBitmap(
  fx: BuildFx,
  now: number,
  flics: Partial<Record<BuildClipName, LoadedFlic | null>>,
): ImageBitmap | null {
  const flic = flics[fx.clip] ?? null;
  if (flic === null || flic.frames.length === 0) return null;
  const k = Math.min(flic.frames.length - 1, buildFxFrame(fx, now));
  return flic.frames[k] ?? null;
}
