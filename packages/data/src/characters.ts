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
   * 玩家代表色 —— **`0x00RRGGBB`，R 在最高字节**（原 Q6，已结案）。
   *
   * ★ 值直接来自 exe 的角色表（`rich4_character_profiles` @VA 0x0047e80c，
   *   每项 0x68 字节、`color` 在 +0x04；原始字节是 little-endian 的
   *   `26 61 94 00`，即 dword `0x00946126`）——和这里写的一模一样，无需换序。
   *
   * ★ **字节序是数出来的，不是看着像**：
   *   用法一（归属圈线换色）VA 0x00409866..0x0040987d：
   *   ```asm
   *   0040986e  mov edx, [eax + 0x496b6c]   ; player[owner-1].color（32 位原值）
   *   00409875  call 0x4551f0               ; _rich4_convert_color
   *   0040987d  mov word [ebp + 0x1fe], ax  ; → 精灵表调色板 #255（255×2）
   *   ```
   *   用法二（侧栏名字下那条角色色长条）VA 0x004161f8 起：同一个原值推进
   *   `fcn_004561be`（填充矩形），里面同样先 `call 0x4551f0`（VA 0x004561c5）。
   *
   *   `_rich4_convert_color` @VA 0x004551f0 是个按显示色深分派的跳表
   *   （`[0x47637c]` = 像素格式号，由 0x004517b0 一带按 DDraw 的
   *   R/G 掩码探测；`R=0x7c00,G=0x3e0` → 号 0 = RGB555）。
   *   号 0 的实现 @VA 0x0045523e：
   *   ```asm
   *   shld ebx, eax, 0x1d / and ebx, 0x1f   ; 蓝 = 原值 bit 3..7  → 目标 bit 0..4
   *   shld edx, eax, 0x1a / and edx, 0x3e0  ; 绿 = 原值 bit 11..15→ 目标 bit 5..9
   *   shr  eax, 9        / and eax, 0x7c00  ; 红 = 原值 bit 19..23→ 目标 bit 10..14
   *   ```
   *   ⇒ **byte2 → 红、byte1 → 绿、byte0 → 蓝**，即 `0xRRGGBB`。
   *   于是約翰喬 `0x946126` 在原版屏上是 `rgb(148, 97, 38)`（土黄／棕），
   *   而不是按 BGR 读出来的 `rgb(38, 97, 148)`（蓝）。
   *
   * ★ 素材侧独立佐证（判据可判定：红↔蓝互为补色，不是「看起来像」）：
   *   | 角色 | 本值 | RGB 读法 | BGR 读法 | 棋子实测主色（`assets-clean/Data/`）|
   *   |---|---|---|---|---|
   *   | 6 宮本寶藏 | 0x00f038 | 绿 (0,240,56) | 黄绿 (56,240,0) | `0254_*` #205000 深绿 |
   *   | 9 孫小美 | 0xcc1a20 | 红 (204,26,32) | 蓝 (32,26,204) | `0317_*` #e03000 红 |
   *   | 10 小丹尼 | 0x2017fe | 蓝 (32,23,254) | 红 (254,23,32) | `0338_*` #001070 蓝 |
   *   | 0 約翰喬 | 0x946126 | 棕 (148,97,38) | 蓝 (38,97,148) | `0128_*` #503010 棕 |
   *   （棋子资源号 = `0x80 + 21×角色`，见 `client/assets.ts`。溯源测试见 `characters.test.ts`。）
   *
   * ⚠️ 唯一的量化差异：原版写进调色板的是**5 位分量**（RGB555），
   *   即屏上实际是 `rgb(148, 99, 33)`；本项目按 8 位原值画
   *   （`rgb(148,97,38)`，与 `client/hud.ts` 那条角色色长条同一口径）。
   *   差 ≤5/255，是 16bpp 显示位深的产物，不另做量化。
   */
  color: number;
  /**
   * ★ **角色表项 `+0x00`：指向该角色名字串的 4 字节指针**（Big5、NUL 结尾）。
   *
   * 这个字段**不是玩家状态，是 exe 内部的常量**：原版把整个 0x68 字节的表项
   * 当角色模板用，`+0x00` 就是名字串的地址。两条独立证据：
   *
   * ① **读档后重新推导** —— `@source 0x00402b96` 的循环（读档尾部）：
   *    ```asm
   *    00402b9a  imul eax, ebx, 0x68             ; eax = 玩家下标 × 0x68
   *    00402b9f  mov  dl, byte [eax + 0x496b7b]  ; dl = player.character (+0x13)
   *    00402ba5  imul edx, edx, 0x68
   *    00402ba8  mov  edx, [edx + 0x47e80c]      ; ★ = 角色表[character].+0x00
   *    00402bae  mov  [eax + 0x496b68], edx      ; ★ 覆盖文件里读进来的值
   *    ```
   *    ⇒ 存档里 `player+0x00` 存的是**存档那一刻的进程地址**，读档时被丢弃。
   *    因此复刻里它**不该是 `GameState` 的字段** —— 写出时按 `character` 查表即可。
   *
   * ② **两份真实存档 8/8 精确吻合** —— Save0 与 SAVE1 各 4 名玩家的
   *    `player+0x00` 都等于本表 `[character].namePointer`
   *    （见 `packages/core/src/loaders/save-writer.test.ts` 的「carry 清零」用例）。
   *
   * ⚠️ 这是**本 exe 版本（v3.11）DGROUP 内的地址**，跨版本无意义；
   *   它只影响「逐字节往返」这一条验证，不影响语义（原版自己也不读它）。
   */
  namePointer: number;
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
   * ★ **個性**，0 乖寶寶 / 1 普通人 / 2 大老奸 —— 名字取自原版「託管AI」
   *   对话框的实机截图（docs/original-screens.md 的 S3）。
   *   它被拷进玩家结构的 +0x17（`Player.personality`），是一条**通用**的
   *   AI 行为闸门；保釋（`rules/visit.ts` 的 `BAIL_STYLE`）只是其消费者之一。
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
  { id: 0,  key: 'yuehanqiao',     name: '約翰喬',   color: 0x946126, namePointer: 0x4665c4, isFemale: false, trafficMethod: 0, ndices: 1, f22: 3, f23: 2, f24: 60,  initCashRatio: 50, f26: 30 },
  { id: 1,  key: 'shalongbasi',    name: '沙隆巴斯', color: 0xbdc3c6, namePointer: 0x4665cd, isFemale: false, trafficMethod: 0, ndices: 1, f22: 3, f23: 1, f24: 100, initCashRatio: 40, f26: 45 },
  { id: 2,  key: 'rentailang',     name: '忍太郎',   color: 0x41323b, namePointer: 0x4665d6, isFemale: false, trafficMethod: 0, ndices: 1, f22: 3, f23: 2, f24: 0,   initCashRatio: 70, f26: 0  },
  { id: 3,  key: 'qianfuren',      name: '錢夫人',   color: 0xc626c3, namePointer: 0x4665df, isFemale: true,  trafficMethod: 0, ndices: 1, f22: 3, f23: 2, f24: 100, initCashRatio: 60, f26: 30 },
  { id: 4,  key: 'atubo',          name: '阿土伯',   color: 0xc5b830, namePointer: 0x4665e8, isFemale: false, trafficMethod: 0, ndices: 1, f22: 3, f23: 1, f24: 50,  initCashRatio: 40, f26: 25 },
  { id: 5,  key: 'shalagongzhu',   name: '莎拉公主', color: 0xed9d9d, namePointer: 0x4665f1, isFemale: true,  trafficMethod: 0, ndices: 1, f22: 3, f23: 1, f24: 75,  initCashRatio: 70, f26: 30 },
  { id: 6,  key: 'gongbenbaozang', name: '宮本寶藏', color: 0x00f038, namePointer: 0x4665fa, isFemale: false, trafficMethod: 0, ndices: 1, f22: 3, f23: 1, f24: 100, initCashRatio: 50, f26: 20 },
  { id: 7,  key: 'tangtang',       name: '糖糖',     color: 0xffffa0, namePointer: 0x466603, isFemale: true,  trafficMethod: 0, ndices: 1, f22: 3, f23: 0, f24: 0,   initCashRatio: 40, f26: 35 },
  { id: 8,  key: 'wumi',           name: '烏咪',     color: 0xe77c08, namePointer: 0x46660a, isFemale: true,  trafficMethod: 0, ndices: 1, f22: 3, f23: 0, f24: 0,   initCashRatio: 60, f26: 20 },
  { id: 9,  key: 'sunxiaomei',     name: '孫小美',   color: 0xcc1a20, namePointer: 0x466611, isFemale: true,  trafficMethod: 0, ndices: 1, f22: 3, f23: 0, f24: 50,  initCashRatio: 50, f26: 0  },
  { id: 10, key: 'xiaodanni',      name: '小丹尼',   color: 0x2017fe, namePointer: 0x46661a, isFemale: false, trafficMethod: 0, ndices: 1, f22: 3, f23: 1, f24: 30,  initCashRatio: 55, f26: 15 },
  { id: 11, key: 'jinbeibei',      name: '金貝貝',   color: 0x0ebdbd, namePointer: 0x466623, isFemale: true,  trafficMethod: 0, ndices: 1, f22: 3, f23: 2, f24: 80,  initCashRatio: 80, f26: 0  },
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

/**
 * `CharacterDef.color` → 屏幕 RGB 三元组。
 *
 * ★ 全项目**唯一**的 32 位角色色解码口 —— `client/render.ts` 的归属圈线、
 *   `client/hud.ts` 的名字色条都走这里，不要再各写一份移位。
 *
 * 字节序是 `0xRRGGBB`（R 在高字节）：原版把它送进
 * `_rich4_convert_color`（VA 0x004551f0 → 号 0 实现 VA 0x0045523e）
 * 取 byte2/byte1/byte0 分别当红/绿/蓝。逐条取证见 `CharacterDef.color` 的注释。
 *
 * @param color 32 位角色色 `0x00RRGGBB`
 * @returns `[r, g, b]`，各 0..255
 */
export function characterColorRgb(color: number): readonly [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}
