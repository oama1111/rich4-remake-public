/*
 * 角色数值表（12 个，完整）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source rich4-re/asm/rich4_characters.c —— const player_info rich4_character_profiles[12]
 * @source rich4-re/docs/characters.txt —— 角色编号对照
 *
 * ★ **f22 / f23 / f24 / f26 四个全解出来了**（DEVELOPMENT_PLAN.md 的 Q3 结案）。
 *   它们是 AI 的性格旋钮，开局拷进玩家结构的 +0x16..+0x1a：
 *   - f22 **能力位**：bit0 会用卡、bit1 会用道具
 *   - f23 **保釋倾向** 0/1/2
 *   - f24 **借贷激进度**：到银行时借身家的百分之几
 *   - f26 **炒股比例**：把可动用总额的百分之几放进股市
 *   详见 `@rich4/core` 的 `ai/personality.ts`（含每一条的 @source）。
 *    这四个字段在 12 个角色间取值各不相同，高度疑似 AI 性格参数。
 *    按 C-FID-2 保留原始字段名，**禁止臆测命名**。
 */

export interface CharacterDef {
  /** 角色编号 0..11 @source characters.txt */
  id: number;
  key: CharacterKey;
  /** 原版名称（繁体）。原版字符串含全角空格用于对齐，此处已去除 */
  name: string;
  /**
   * 玩家代表色。
   * ⚠️ 字节序（BGR vs RGB）**未经实测验证**（DEVELOPMENT_PLAN.md Q6）。
   *    使用前必须先验证，不得假定。
   */
  color: number;
  /** 0 = 男, 1 = 女（原版 sex 字段：1 = 男，0 = 女，此处已按直觉反转为 isFemale） */
  isFemale: boolean;
  /** 移动方式 @source rich4_characters.c traffic_method —— 12 个角色全为 0 */
  trafficMethod: number;
  /** 初始骰子数 @source rich4_characters.c ndices —— 12 个角色全为 1 */
  ndices: number;
  /**
   * ★ **AI 能力位** —— bit0 会用卡、bit1 会用道具。
   *   12 个角色全是 3（两位都开）：它是「AI 设置」对话框的开关，
   *   不是角色差异。@source `test byte [player+0x16], 1/2`（0x00441d09 / 0x00447f87）。
   */
  f22: number;
  /**
   * ★ **保釋倾向**，0/1/2 —— 落在監獄/醫院格上时电脑保釋谁。
   *   0 只救玩家、2 只放犯人、1 居中。见 `rules/visit.ts` 的 `BAIL_STYLE`。
   *   它被拷进玩家结构的 +0x17（`Player.bailStyle`）。
   */
  f23: number;
  /**
   * ★ **借贷激进度**（百分比）—— 到银行时 `loan = trunc(身家 × 该值 / 100)`。
   *   0 表示一辈子不借。@source 银行落点的 AI 分支 VA 0x004368db。
   */
  f24: number;
  /** 初始现金比例 @source rich4_characters.c init_cash_ratio —— 取值 40..80 */
  initCashRatio: number;
  /**
   * ★ **炒股比例**（百分比）—— 目标持仓 = `trunc(可动用总额 × 该值 / 100)`，
   *   上限是存款。0 表示从不碰股票。@source VA 0x0042bfff。
   */
  f26: number;
}

export type CharacterKey =
  | 'yuehanqiao' | 'shalongbasi' | 'rentailang' | 'qianfuren'
  | 'atubo' | 'shalagongzhu' | 'gongbenbaozang' | 'tangtang'
  | 'wumi' | 'sunxiaomei' | 'xiaodanni' | 'jinbeibei';

export const CHARACTERS: readonly CharacterDef[] = [
  { id: 0,  key: 'yuehanqiao',     name: '約翰喬',   color: 0x946126, isFemale: false, trafficMethod: 0, ndices: 1, f22: 3, f23: 2, f24: 60,  initCashRatio: 50, f26: 30 },
  { id: 1,  key: 'shalongbasi',    name: '沙隆巴斯', color: 0xbdc3c6, isFemale: false, trafficMethod: 0, ndices: 1, f22: 3, f23: 1, f24: 100, initCashRatio: 40, f26: 45 },
  { id: 2,  key: 'rentailang',     name: '忍太郎',   color: 0x41323b, isFemale: false, trafficMethod: 0, ndices: 1, f22: 3, f23: 2, f24: 0,   initCashRatio: 70, f26: 0  },
  { id: 3,  key: 'qianfuren',      name: '錢夫人',   color: 0xc626c3, isFemale: true,  trafficMethod: 0, ndices: 1, f22: 3, f23: 2, f24: 100, initCashRatio: 60, f26: 30 },
  { id: 4,  key: 'atubo',          name: '阿土伯',   color: 0xc5b830, isFemale: false, trafficMethod: 0, ndices: 1, f22: 3, f23: 1, f24: 50,  initCashRatio: 40, f26: 25 },
  { id: 5,  key: 'shalagongzhu',   name: '莎拉公主', color: 0xed9d9d, isFemale: true,  trafficMethod: 0, ndices: 1, f22: 3, f23: 1, f24: 75,  initCashRatio: 70, f26: 30 },
  { id: 6,  key: 'gongbenbaozang', name: '宮本寶藏', color: 0x00f038, isFemale: false, trafficMethod: 0, ndices: 1, f22: 3, f23: 1, f24: 100, initCashRatio: 50, f26: 20 },
  { id: 7,  key: 'tangtang',       name: '糖糖',     color: 0xffffa0, isFemale: true,  trafficMethod: 0, ndices: 1, f22: 3, f23: 0, f24: 0,   initCashRatio: 40, f26: 35 },
  { id: 8,  key: 'wumi',           name: '烏咪',     color: 0xe77c08, isFemale: true,  trafficMethod: 0, ndices: 1, f22: 3, f23: 0, f24: 0,   initCashRatio: 60, f26: 20 },
  { id: 9,  key: 'sunxiaomei',     name: '孫小美',   color: 0xcc1a20, isFemale: true,  trafficMethod: 0, ndices: 1, f22: 3, f23: 0, f24: 50,  initCashRatio: 50, f26: 0  },
  { id: 10, key: 'xiaodanni',      name: '小丹尼',   color: 0x2017fe, isFemale: false, trafficMethod: 0, ndices: 1, f22: 3, f23: 1, f24: 30,  initCashRatio: 55, f26: 15 },
  { id: 11, key: 'jinbeibei',      name: '金貝貝',   color: 0x0ebdbd, isFemale: true,  trafficMethod: 0, ndices: 1, f22: 3, f23: 2, f24: 80,  initCashRatio: 80, f26: 0  },
] as const;

const byKey = new Map(CHARACTERS.map((c) => [c.key, c]));
const byId = new Map(CHARACTERS.map((c) => [c.id, c]));

export function characterByKey(key: CharacterKey): CharacterDef {
  const c = byKey.get(key);
  if (c === undefined) throw new Error(`未知角色: ${key}`);
  return c;
}

export function characterById(id: number): CharacterDef | undefined {
  return byId.get(id);
}
