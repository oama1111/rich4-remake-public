/*
 * AI 性格参数 —— 角色表里那四个「语义未确认」的字段
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ `@rich4/data` 的 `characters.ts` 长期标着「f22 / f23 / f24 / f26 语义
 *   尚未确认」（DEVELOPMENT_PLAN 的 Q3）。四个全解出来了，都是
 *   **AI 的性格旋钮**，开局从角色表拷进玩家结构：
 *
 * | 字段 | 玩家偏移 | 含义 |
 * |---|---|---|
 * | f22 | +0x16 | **能力位**：bit0 会用卡、bit1 会用道具 |
 * | f23 | +0x17 | **個性** 0 乖寶寶 / 1 普通人 / 2 大老奸（通用闸门，见下） |
 * | f24 | +0x18 | **借贷激进度**：到银行时借身家的百分之几 |
 * | f26 | +0x1a | **炒股比例**：把可动用总额的百分之几放进股市 |
 *
 *   另有 `initCashRatio`(+0x19) 早已解出（开局现金占比，见 rules/setup.ts）。
 *
 * ⚠️ 这四个都能在「**託管AI**」对话框里改（VA 0x0041e259 起一口气从
 *   `[0x48be35..0x48be39]` 拷进 `+0x15..+0x1a`），角色表只是默认值。
 *   本引擎目前只用默认值——设置界面属 M4。
 *
 * ★ 那一屏长什么样、每个控件改哪个字节，已由**原版实机截图**逐项对定，
 *   见 `docs/original-screens.md` 的 S3（资源 `Data.mkf #77`，入口 VA 0x0041e345）。
 *   它只列 `who_plays` bit0 = 人類 的座位 —— **托管 = 把自己的座位交给 AI**，
 *   不是调对手的 AI。
 *
 * ★ **f23 是一条通用闸门**，不只管保釋（这是截图纠正的一处旧错）：
 * ```asm
 * 0041e69e  ; gate(action) —— 每个 AI 行为进来先过这一关
 * 0041e6a4  edx = [0x47fdf1 + action*8]              ; 该行为「所需个性」
 * 0041e6b2  eax = 當前玩家.+0x17                      ; 自己的个性
 * 0041e6bd  edx -= eax
 * 0041e6c1  if (edx >= 2) return 0                    ; 差两档以上：从不做
 * 0041e6c9  if (edx == 1 && rand() % 3 != 0) return 0  ; 差一档：1/3 概率做
 * 0041e6e6  return [0x475324 + action*4]()            ; 够格：照做
 * ```
 *   行为表 `0x47fdf1`（步长 8）与跳表 `0x475324`（步长 4）**尚未翻译**，
 *   记在 known-deviations 的 Q-AI-2。
 */

import { CHARACTERS } from '@rich4/data';

// ============================================================
//  f22：能力位
// ============================================================

/**
 * @source 两处 `test byte [player + 0x16], n`：
 * ```asm
 * 0x00441d09  test byte [+0x16], 1 / je 跳过   ; 在 AI 出牌入口前
 * 0x00447f87  test byte [+0x16], 2 / je 跳过   ; 在 AI 用道具入口前
 * ```
 * 两处之前都是 `test dl, 6 / je 跳过`（dl = who_plays，6 = 电脑|托管），
 * 所以这两位只对 AI 生效。
 *
 * ⚠️ 12 个角色的 f22 **全是 3** —— 两位都开。它存在的意义是让
 *   「AI 设置」能把某个对手调成不出牌/不用道具，不是角色差异。
 */
export const AI_USES_CARDS = 0x01;
export const AI_USES_TOOLS = 0x02;

export function aiCanUseCards(aiFlags: number): boolean {
  return (aiFlags & AI_USES_CARDS) !== 0;
}
export function aiCanUseTools(aiFlags: number): boolean {
  return (aiFlags & AI_USES_TOOLS) !== 0;
}

// ============================================================
//  f24：借贷激进度
// ============================================================

/**
 * 到银行时自动借多少。
 *
 * @source 银行落点 VA 0x00436668：
 * ```asm
 * if (player.days_rejected_by_bank != 0) return
 * [0x48c3b0] = calculate_player_wealth(player)     ; ★ 基数是**身家**
 * if (player.who_plays != 1) …AI 分支…
 *   bh = player.f24
 *   if (bh == 0) 跳过                              ; ★ 0 = 从不借
 *   loan = trunc(f24 × 身家 / 100)
 *   if (loan == 0) 跳过
 *   player.loan (+0x24) = loan                     ; ★ 是**赋值**不是累加
 *   player.moneyInBank (+0x20) += loan
 * ```
 *
 * 12 个角色的取值：
 * 約翰喬 60、沙隆巴斯 100、忍太郎 0、錢夫人 100、阿土伯 50、莎拉公主 75、
 * 宮本寶藏 100、糖糖 0、烏咪 0、孫小美 50、小丹尼 30、金貝貝 80。
 * 三个 0 的角色**一辈子不借钱**，三个 100 的一进银行就把身家押满。
 */
export function autoLoanAmount(wealth: number, loanRatio: number): number {
  if (loanRatio === 0 || wealth <= 0) return 0;
  // @source imul edx, [0x48c3b0] / mov ebx, 100 / idiv ebx —— 向零取整
  return Math.trunc((wealth * loanRatio) / 100);
}

// ============================================================
//  f26：炒股比例
// ============================================================

/**
 * AI 想把多少钱放在股市里。
 *
 * @source VA 0x0042bfff：
 * ```asm
 * 持仓市值 = Σ(持股数 × 股价)                ; 浮点累加后取整
 * edx = 持仓市值 + (存款 + 现金)             ; ★ 可动用总额
 * target = trunc(edx × f26 / 100)
 * if (持仓市值 >= target) 不买
 * 可投 = target − 持仓市值
 * if (可投 > 存款) 可投 = 存款               ; ★ 上限是存款 —— 股票从存款付
 * ```
 * 更前面还有一道闸：`if (player.f26 == 0) 跳过`（VA 0x0042bf30），
 * 即 **0 表示这个角色从不碰股票**（忍太郎、孫小美、金貝貝）。
 */
export function stockBudget(
  holdingsValue: number,
  cash: number,
  moneyInBank: number,
  stockRatio: number,
): number {
  // @source cmp byte [+0x1a], 0 / je 跳过
  if (stockRatio === 0) return 0;
  const pool = holdingsValue + moneyInBank + cash;
  const target = Math.trunc((pool * stockRatio) / 100);
  // @source cmp eax, ebp / jge 不买
  if (holdingsValue >= target) return 0;
  const want = target - holdingsValue;
  // @source cmp edx, ebx / jle … / mov …, ebx —— 封顶在存款
  return want > moneyInBank ? Math.max(0, moneyInBank) : want;
}

// ============================================================
//  从角色表取默认值
// ============================================================

export interface CharacterTraits {
  /** f22 能力位 */
  aiFlags: number;
  /** f23 個性：0 乖寶寶 / 1 普通人 / 2 大老奸 */
  personality: number;
  /** f24 借贷激进度（百分比） */
  loanRatio: number;
  /** f26 炒股比例（百分比） */
  stockRatio: number;
}

export const DEFAULT_TRAITS: CharacterTraits = {
  aiFlags: AI_USES_CARDS | AI_USES_TOOLS,
  personality: 0,
  loanRatio: 0,
  stockRatio: 0,
};

/** 角色的默认性格 —— 开局拷进玩家结构 */
export function traitsOf(character: number): CharacterTraits {
  const c = CHARACTERS[character];
  if (c === undefined) return { ...DEFAULT_TRAITS };
  return { aiFlags: c.f22, personality: c.f23, loanRatio: c.f24, stockRatio: c.f26 };
}

// ============================================================
//  f23 個性 × f7 凶狠度：AI 出牌/用道具的闸门
// ============================================================

/**
 * ★ 每张卡、每件道具都有个 **f7 = 凶狠度 0..2**（§7.1 / §7.2 最后一列）。
 *   AI 用它之前先过一道闸（VA 0x0041e69e，`ai_use_card` 的调度入口）：
 * ```asm
 * 0041e6a4  edx = card_table[action].f7           ; [0x47fdf1 + action×8]（道具在 31..43，表紧接）
 * 0041e6b2  eax = 當前玩家.個性 (+0x17)
 * 0041e6bd  edx -= eax
 * 0041e6c1  if (edx >= 2) 不用                     ; 差两档：从不
 * 0041e6c9  if (edx == 1 && rand() % 3 != 0) 不用  ; 差一档：1/3
 * 0041e6e6  照做
 * ```
 *   乖寶寶（0）只随手用 f7=0 的，f7=1 的三次里用一次，f7=2 的（均富/均貧/惡魔/冬眠/
 *   陷害/嫁禍…）从不；大老奸（2）什么都用。
 *
 * @param roll  那次 `rand() % 3` 的结果（0..2）。策略层拿不到随机源，由调用方给一个
 *              **确定性的替身**（见 policy.ts 的 `gateRoll`），记 D-004。
 */
export function personalityAllows(f7: number, personality: number, roll: number): boolean {
  const gap = f7 - personality;
  if (gap >= 2) return false;
  if (gap === 1) return roll === 0;
  return true;
}
