/*
 * 大富翁4 地图数据解析器
 * 格式规范见 docs/map-format.md（对应 DEVELOPMENT_PLAN.md 的 Q1）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* C-ARC-1：本模块零依赖。输入是字节数组，不碰文件系统。
 * TextDecoder 是 Web 标准全局对象（浏览器与 Node 均有），不属于 Node API。 */

// ============================================================
//  常量
// ============================================================

/** 节点大小 @source rich4_node_utils.asm:19-22 (idx*5<<3 = idx*40) */
export const NODE_SIZE = 0x28;
/** 住宅地块项大小 @source rich4-re/csrc/land.h struct housing_land */
export const LAND_SIZE = 0x34;
/** 设施地块项大小 @source rich4-re/csrc/land.h struct business_land */
export const FACILITY_SIZE = 0x38;
/** 上市企业项大小 @source rich4_load_map.asm:320 (imul esi, ebx, 0x34) */
export const COMMERCIAL_SIZE = 0x34;
/** 特殊景观项大小 @source rich4_load_map.asm:211-219 (n*0x1c) */
export const LANDSCAPE_SIZE = 0x1c;

/** `type` 字段的基数 → 所属表 @source docs/map-format.md §3.2 */
export const TYPE_BASE = {
  SPECIAL: 0,
  LAND: 2000,
  FACILITY: 4000,
  COMMERCIAL: 6000,
  LANDSCAPE: 8000,
} as const;

/**
 * 特殊格子类型（flags 低字节，仅当 type === 0 时有意义）
 * @source 8 张地图原始数据统计 + 节点名称交叉验证
 */
export const SPECIAL_KIND = {
  NONE: 0,
  PARK: 1, // 公園
  NEWS: 2, // 新聞
  FORTUNE: 3, // 命運
  PRISON: 4, // 監獄
  HOSPITAL: 5, // 醫院
  PENGUIN_DIG: 6, // 企鵝挖寶
  BALLOON: 7, // 七彩氣球
  GIFT_FROM_SKY: 8, // 喜從天降
  LOTTERY: 9, // 樂透
  POINTS_50: 10, // 得５０點
  POINTS_30: 11, // 得３０點
  POINTS_10: 12, // 得１０點 / 星座 / 行星
  CARD: 13, // 卡片
  BANK: 14, // 銀行
  DEPARTMENT_STORE: 15, // 百貨公司
  MAGIC_HOUSE: 16, // 魔法屋
} as const;

/**
 * 「已被占用/不可放置道具」的判定掩码。
 * bits 8-23 为运行时占用状态，bit 31 为静态禁放标志。
 * @source rich4_node_utils.asm:26  test dword [eax+0x24], 0x80ffff00
 */

// ============================================================
//  类型
// ============================================================

/**
 * 由「剔了 0 的邻接表」补出 4 个原始槽。
 *
 * ⚠️ 只给**手工构造**的地图（测试、联机造数据）用。真地图的槽号来自
 *   文件本身，顺序有意义（封路位按槽号存），不能靠这个函数反推。
 */
export function slotsFrom(adjacent: readonly number[]): [number, number, number, number] {
  return [adjacent[0] ?? 0, adjacent[1] ?? 0, adjacent[2] ?? 0, adjacent[3] ?? 0];
}

export interface MapNode {
  /** 节点号，**从 1 开始** */
  id: number;
  x: number;
  y: number;
  /** 地块名称（BIG5 解码后）。原先被误标为 reserved 的 0x04..0x17 共 20 字节 */
  name: string;
  /** 相邻节点号，已剔除 0（0 表示无连接） */
  adjacent: number[];
  /**
   * **原样**的 4 个邻接槽（含 0 表示无连接）。
   *
   * ★ 必须留着：封路位是**按槽号**存的，`adjacent` 剔了 0 之后下标就对不上了。
   * @source 节点 +0x18 起 4 个 uint16
   */
  adjacentSlots: [number, number, number, number];
  /** 原始 type 值 @source 节点 +0x20 */
  type: number;
  /** type 解析结果 */
  ref: NodeRef;
  /**
   * 节点装饰图的 **1 基下标**（0 = 不画）。@source 节点 +0x22
   *
   * ★ **Q13 已结案（2026-09-15）**：它指向 `map.mkf` **资源 0x18（24）**
   * 里的第 `decorIndex - 1` 张图。该资源是一个 **SMP 精灵库**：
   * 12 字节头（`'SMP\0'` + u32 张数 = 58 + u32 像素数据起始偏移 = 0x2c4），
   * 随后 58 条 12 字节的 `graph_st`（width/height/x/y 各 int16 + `gsize` u32，
   * `gsize == width * height * 2`，像素为 16 位、0 = 透明）。
   *
   * 取证：
   * ```asm
   * 00407ba0  push 0x18 / push map.mkf / call read_mkf   ; 载入资源 24
   * 00407bab  mov [0x474949], eax                        ; 存为装饰图库
   * 00408580  cmp word [node + 0x22], 0 / je 跳过         ; 0 = 不画
   * 0040862e  mov ax, word [node + 0x22]                 ; Q13 的读取点
   * 00408632  dec eax                                    ; 1 基 → 0 基
   * 00408635  ... esi = (decorIndex - 1) * 12            ; 步长 12
   * 0040863d  mov eax, [0x474949]
   * 00408642  add eax, 0xc                               ; 跳过 12 字节 SMP 头
   * 00408645  add eax, esi                               ; → 第 decorIndex 条 graph_st
   * 0040864f  call fcn_004564c1                          ; 贴图
   * ```
   * `fcn_004564c1`（0x004564c1）转发到
   * `draw_non_zero_image_in_rect(640, 480, graph_st, 屏幕X, 屏幕Y, 1)`：
   * **只写非 0 像素**，并以 `graph_st` 自带的 `(x, y)`（通常是图心）为锚点
   * ——即装饰对齐到节点的投影位置中心。节点位置由 `fcn_00407a2c` 投影，
   * 且只在镜头 28×28 窗口内（`0..0x1c`）才画。绘制顺序见 Q-DRAW-1：
   * 装饰恒在地砖之上、立体物件之下。
   *
   * 取值分布（实测八张地图 987 个节点，共 56 种取值 0..58）：
   * - 地图 0/1/2/3/5/6/7：只有 0 与**奇数**（都 ≤ 33；七张图合计用到
   *   1..33 这 17 个奇数，单张图 16~17 个）。
   *   这些是**无光环**的那一款；住宅/设施一律为 0
   *   （企业/景观仍有装饰，例如銀行=27、百貨公司=29、景观小球=1/33）。
   * - 地图 4（十二星座／太空图）：**全部**节点非 0，取**偶数** 4..34
   *   （**带粉红光环**的那一款）与 35..58（行星与星座天体）。
   *
   * 库里 1..36 是 18 对「普通(奇) / 粉红光环(偶)」特殊格图，
   * 37..58 是 22 张天体图：38..45 = 8 行星（水星/金星/地球/火星/木星/土星/
   * 天王星/海王星，按地图 4 的命名节点逐一对上），47..58 = 12 星座，
   * 37（月球）与 46（另一个球体）在地图 4 上未被引用。
   *
   * ⚠️ 先前「与地图资源号同为 ×2+1 编码，真实索引 = (decorIndex-1)/2、
   * 落在 0..16」的推断是**错的**：那只是「常用取值恰好都是奇数」造成的假象，
   * 地图 4 上偶数照样在用。真实下标就是 `decorIndex - 1`，一共 58 项。
   */
  decorIndex: number;
  /** 原始 flags @source 节点 +0x24 */
  flags: number;
  /** flags 低字节：特殊格子类型（仅 type===0 时有意义） */
  specialKind: number;
  /** 静态禁止放置道具（flags bit 31） */
  noObjects: boolean;
  /** 是否为可走节点：4 个 adjacent 至少一个非 0 @source rich4_node_utils.asm:28-31 */
  walkable: boolean;
}

/** 节点的 type 指向哪张表的哪一项 */
export type NodeRef =
  | { kind: 'special' }
  | { kind: 'land'; index: number }
  | { kind: 'facility'; index: number }
  | { kind: 'commercial'; index: number }
  | { kind: 'landscape'; index: number }
  | { kind: 'unknown'; raw: number };

/** 住宅地块 @source rich4-re/csrc/land.h struct housing_land */
export interface LandInfo {
  id: number;
  x: number;
  y: number;
  name: string;
  /** @source land.h 0x17 */
  priceStatus: number;
  /** 连锁店 or 住宅 @source land.h 0x18 */
  type: number;
  /** 0 = 无主 @source land.h 0x19 */
  owner: number;
  /** @source land.h 0x1a */
  level: number;
  /**
   * 建筑朝向 0..7 @source land.h 0x1b
   *
   * @source 地块绘制代码 VA 0x004091af：
   * ```asm
   * al = byte [land + 0x1b]
   * al += byte [0x499088]      ; ★ 加上当前视角旋转
   * dl = 8 - al
   * dl &= 7                    ; → 精灵图号 0..7
   * ```
   * 这解释了建筑资源为何**每个都有 8 张图**——那是 8 个朝向。
   *
   * ⚠️ 先前把这个字节读作「建筑风格」是错的：它取值 0..7 且同区一致，
   * 看着像风格号，其实是朝向（同一区的房子朝同一个方向，很自然）。
   */
  facing: number;
  /** @source land.h 0x1c */
  landPrice: number;
  /** @source land.h 0x1e */
  housePrice: number;
  /**
   * **按等级索引的过路费表**，6 项（等级 0..5），uint16。
   *
   * ⚠️ `rich4-re/csrc/land.h` **没有**这个字段，是本项目从过路费函数
   * 反推并以真实地图数据验证得出的。
   *
   * @source rich4_player_core_actions.asm:229 `_rich4_calculate_land_toll`
   *   ```asm
   *   mov al, byte [ebx + 0x1a]        ; al = level
   *   mov ax, word [ebx + eax*2 + 0x20] ; 按等级查表
   *   ```
   * 实测（地图0）：台北市 [500,1200,3000,7500,16000,30000]，
   *   新竹市 [200,500,1200,2800,6000,10000]，第 6、7 项恒为 0。
   */
  rentByLevel: number[];
  /**
   * 地契到期日（打包日期 年<<16|月<<8|日），0 = 無限期。地图里恒为 0。
   *
   * ★ 就是 `land.h` 里那个「语义未明」的 `flast`：買地时按開局「土地權限」写入
   *   （0x0041a108），每日推进到期归无主（0x0041d12d）。运行时值住在
   *   `GameState.landTenure`，这里只是模板初值。见 rules/facility.ts。
   */
  flast: number;
}

/** 地块等级上限：`level < 5` 才可续建 @source rich4.asm fcn_0040b110 */
export const MAX_LAND_LEVEL = 5;

/** 设施地块 @source rich4-re/csrc/land.h struct business_land */
export interface FacilityInfo {
  id: number;
  /** land.h 未列出 0x00/0x02，但实测为坐标（与 housing_land 同构） */
  x: number;
  y: number;
  name: string;
  /** @source land.h 0x18 */
  type: number;
  /** @source land.h 0x19 */
  owner: number;
  /** @source land.h 0x1a */
  level: number;
  /** 建筑朝向 0..7 @source facility +0x1b，与地块同制（VA 0x004093c3） */
  facing: number;
  /** @source land.h 0x1c */
  priceStatus: number;
  /**
   * 地契到期日（打包日期 `年<<16|月<<8|日`），0 = 無限期。
   *
   * ★ **商業用地的 `flast` 在 `+0x34`，与住宅的 `+0x30` 不同**
   *   —— `@source 0x004425e9 mov dword ptr [ebx + 0x34], eax ; 商業：flast @ +0x34`
   *   （对照住宅 `@source 0x0044246c mov dword ptr [ebx + 0x30], eax`）。
   *   见 `rich4-spec/docs/systems/cards.md` 的「買地卡」一节。
   * 运行时值住在 `GameState.facilityTenure`，这里只是模板初值（静态地图恒 0）。
   */
  flast: number;
  /** @source land.h 0x22 */
  landPrice: number;
  /**
   * @source land.h 0x24
   * ⚠️ 这是 `rateByLevel[0]` 的别名，保留是为了兼容既有调用
   *（`rules/wealth.ts` 的设施估值仍按 `level × housePrice + landPrice`，
   * 那是**另一处**原版公式，与过路费无关）。
   */
  housePrice: number;
  /**
   * 按等级取过路费的**寻址窗口**，6 项 uint16，起于 `+0x24`。
   *
   * @source VA 0x0041a429（设施过路费 type 1/2 分支）：
   * ```asm
   * al  = byte [facility + 0x1a]   ; level
   * eax = eax + eax                ; ×2
   * eax = eax + edx                ; + 基址
   * bx  = word [eax + 0x24]        ; ★ word[facility + 0x24 + level*2]
   * ```
   *
   * ⚠️ **下标 0 不是租金**，而是 `housePrice` 本身（同一个 `+0x24`）。
   * 真正的租金是**等级 1..5**，即下标 1..5（`+0x26`..`+0x2e`）。
   *
   * 实证：真实地图里多处形如 `[1000, 750, 1750, 4000, 8000, 15000]`——
   * 下标 1..5 严格递增，只有下标 0 跳出序列，且恒等于 `housePrice`。
   * 设施最高等级表（VA 0x00474940）给 type 1/2 的上限正是 **5**，
   * 与「租金只有 5 档」吻合。
   *
   * 原版的寻址就是 `+0x24 + level*2`，等级 0 会读到房价；照搬该寻址，
   * 不做「修正」——等级 0 的设施本就不该收租。
   */
  rateByLevel: number[];
  /**
   * **研究所**正在研發的項目下标 `1..5`（0 = 沒在研發）—— 名字表 `0x47ff1a`
   * 的第 `n` 项，发下来的道具 = `n + 8`。
   *
   * @source 設施 `+0x1d`：
   * ```asm
   * 004411f8  mov byte [edi + 0x1d], bl   ; ★ 項目 = 研究所等级（1..5）
   * 0041cdca  mov al, byte [ebx + 0x1d]   ; 每回合推进时读它
   * 0041ce18  mov al, byte [ebx + 0x1d] / add eax, 8 / receive_tool
   * ```
   * 名牌浮标第三行就用它查表（VA 0x00417ad3 `mov al, byte [edi + 0x1d]` →
   * `mov ebx, dword [eax*8 + 0x47ff1a]`，表步长 8）。
   *
   * ⚠️ 选填：若干测试用手写的 `FacilityInfo` 字面量没有它（同
   * `CommercialInfo.facing` 的处置）。真实地图解析**一定**会填 ——
   * 但八张地图里这个字节**恒为 0**（原版地图数据里没有现成的研究所，
   * 設施种类是开局后由玩家盖出来的），运行时的值住在
   * `GameState.facilityResearchProject`。
   */
  researchProject?: number;
  /**
   * **研究所**研发的倒计时（天）；`0` = 沒在研發。
   *
   * @source 設施 `+0x1e`：`004411fb mov byte [edi + 0x1e], 5`（开工，固定 5 天）→
   *   `0041cdd6 設施.+0x1e = cl - 1`（每日推进）→ 归零那一下発道具（0x0041ce1b）。
   *
   * ★ 名牌浮标那一行**只看它非不非 0**（VA 0x00417ac2
   *   `cmp byte [edi + 0x1e], 0 / je 结束`）。
   *
   * ⚠️ 选填理由同 `researchProject`；运行时的值住在
   * `GameState.facilityResearchDays`。
   */
  researchDays?: number;
}

/** 上市企业 */
export interface CommercialInfo {
  id: number;
  /** 地图坐标 @source commercial +0x00 / +0x02，与地块同构 */
  x: number;
  y: number;
  name: string;
  /** 对应的股票索引 @source rich4_load_map.asm:325 (mov dl, byte [esi+0x19]) */
  stockIndex: number;
  /**
   * 收費基数（与地块的「地價」同一位置语义）@source commercial +0x22 (u16)。
   * 别人踩上来的旅遊費/保險費/修車費/門派費都按它乘（0x0041abda / 0x0041ac50 / 0x0041acba / 0x0041ae23）。
   */
  landPrice: number;
  /**
   * 行業別 @source commercial +0x1a
   *
   * ★ **7 就是銀行**（@source VA 0x00436b31 `cmp byte [esi+0x1a], 7`，
   *   那段是「谁是銀行董事長」的判定）。八张地图上 type 7 的企业**恰好各一家**，
   *   而且它的 `stockIndex` 恒为 0：
   *   中國信託・上海銀行・富士銀行・花旗銀行・行星銀行・聚寶銀樓・黃金銀行・假期銀行。
   *
   * 其余取值按名字一目了然（**目视归纳，非从 exe 读到**）：
   * 1 航空、2 飯店、3 電子、4 保險/人壽、5 汽車、6 石油、
   * 10 百貨、11 建設、12 門派。
   */
  type: number;
  /**
   * 精灵索引 @source commercial +0x20 (u16)
   *
   * @source 地图加载 VA 0x00407ee4：
   * ```asm
   * ax = word [commercial + 0x20]
   * test / je 跳过                    ; 0 表示没有图
   * load(map.mkf, ax + 0x26)          ; ★ 资源号 = 索引 + 38
   * ```
   */
  spriteIndex: number;
  /**
   * 企业资产额 @source commercial +0x24 (u32)
   *
   * ★ 股市的**均值回归锚点**就是它：`fcn_004291d6` 在该股有对应企业时取
   *   `commercial[idx].field_0x24 / 10000` 当参考价，没有企业才退回初始股价
   *   （见 places/stock-market.ts）。
   *
   *   实测能对上：臺灣人壽 400000 → 40，与股票表里的初始价 40 一致；
   *   地图 1 的四家企业资产额恰好都是初始股价 × 10000 × 0.8。
   */
  assetValue: number;
  /**
   * ⚠️ 地图文件里的 +0x30 **恒为 0**，不要用它。
   *
   * 该字段是**运行时**的「企业自留股数」，开局由代码算出来
   * （VA 0x00407dd1）：`10000 − 该股的流通股数`。
   * 见 `rules/new-game.ts` 的 `commercialSharesOf` 与
   * `GameState.commercialShares`。保留这个字段只为记录文件里确实是 0。
   */
  shares: number;
  /**
   * 现主：玩家下标 + 1，0 = 无主 @source commercial +0x18。
   *
   * ★ **这是运行时字段**：静态地图文件里恒为 0，只有**存档自带的地图块**
   *   （`save.mapData`，见 `state/reduce.ts` 的 `commercialOwners`）才带着真实归属。
   *   实测 Save0：4 号（ＩＢＭ）与 5 号的 `+0x18` = 2（玩家 1 是最大股东）。
   */
  owner: number;
  /**
   * 持股排名 4 位，值 = 玩家下标 + 1，0 = 空位 @source commercial +0x1c..+0x1f。
   * 重排规则见 `places/commercial.ts` 的 `updateCommercialOwner`。
   */
  ranking: number[];
  /**
   * 累積盈餘（每月 15 日分红后**清零**）@source commercial +0x28，**有符号** dword。
   * 实测 Save0：3 号 = 48000、5 号 = 1450（其余 0）。
   */
  funds: number;
  /**
   * 累計盈餘（从不清零）@source commercial +0x2c，有符号 dword。
   * 实测 Save0：1 号 = −30000、4 号 = 197800。
   */
  profit: number;
  /**
   * 建筑朝向 0..7 @source commercial +0x1b
   *
   * ★ 与地块（+0x1b）、设施（+0x1b）**同一制**。绘制企业在 VA 0x0040964d：
   * ```asm
   * al = byte [commercial + 0x1b]
   * al += byte [0x499088]        ; ★ 当前视角
   * al = (8 - al) & 7            ; → 精灵图号
   * ```
   * 企业用的图集（`spriteIndex + 38`）实测**每张恰好 8 个朝向**，所以视角一转就换图。
   *
   * ⚠️ 选填：若干测试用手写的 `CommercialInfo` 字面量（本包 places/*.test.ts）
   * 没有这个字节，渲染端按 0 处理。真实地图解析**一定**会填（实测八张地图
   * 全部落在 0..7）。
   */
  facing?: number;
}

/** 特殊景观（阿里山、佛光山等） */
export interface LandscapeInfo {
  id: number;
  /** 地图坐标 @source landscape +0x00 / +0x02 */
  x: number;
  y: number;
  name: string;
  /**
   * 精灵索引 @source landscape +0x1a (u16)
   *
   * @source 地图加载 VA 0x00407f35，与上市企业同一套：
   *   `资源号 = 索引 + 0x26`，索引 0 表示没有图。
   */
  spriteIndex: number;
  /**
   * 建筑朝向 0..7 @source landscape +0x18（记录长 0x1c，字节夹在名称之后、索引之前）
   *
   * ★ 绘制景观在 VA 0x00409793：
   * ```asm
   * al = byte [landscape + 0x18]
   * al += byte [0x499088]        ; ★ 当前视角
   * al = (8 - al) & 7            ; → 精灵图号
   * ```
   * 景观图集（`spriteIndex + 38`）同样是**每张 8 个朝向**。
   *
   * ⚠️ 选填的理由同 `CommercialInfo.facing`：测试里手写的字面量没有它。
   */
  facing?: number;
}

export interface Rich4Map {
  nodes: MapNode[];
  lands: LandInfo[];
  facilities: FacilityInfo[];
  commercials: CommercialInfo[];
  landscapes: LandscapeInfo[];
  /** 整块地图数据的字节长度（原版据此为每个玩家分配存档缓冲） */
  dataSize: number;
}

// ============================================================
//  工具
// ============================================================

const big5 = new TextDecoder('big5');

/** 读取 null 结尾的 BIG5 字符串 */
function readName(bytes: Uint8Array, offset: number, maxLen: number): string {
  let end = offset;
  const limit = Math.min(offset + maxLen, bytes.length);
  while (end < limit && bytes[end] !== 0) end++;
  if (end === offset) return '';
  return big5.decode(bytes.subarray(offset, end));
}

/** 解析 type 字段，判定它指向哪张表 @source docs/map-format.md §3.2 */
export function resolveNodeType(type: number): NodeRef {
  if (type === TYPE_BASE.SPECIAL) return { kind: 'special' };
  if (type > TYPE_BASE.LAND && type < 3000) return { kind: 'land', index: type - TYPE_BASE.LAND };
  if (type > TYPE_BASE.FACILITY && type < 5000)
    return { kind: 'facility', index: type - TYPE_BASE.FACILITY };
  if (type > TYPE_BASE.COMMERCIAL && type < 7000)
    return { kind: 'commercial', index: type - TYPE_BASE.COMMERCIAL };
  if (type > TYPE_BASE.LANDSCAPE && type < 9000)
    return { kind: 'landscape', index: type - TYPE_BASE.LANDSCAPE };
  return { kind: 'unknown', raw: type };
}

// ============================================================
//  解析主体
// ============================================================

/**
 * 解析一张地图的结构数据（map.mkf 资源号 `global_map_id * 2 + 1` 解压后的内容）。
 *
 * @source 头部布局 rich4_load_map.asm:183-210
 */
export function parseMap(data: Uint8Array): Rich4Map {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u32 = (o: number): number => view.getUint32(o, true);

  const numNodes = u32(0x00);
  const nodeOff = u32(0x04);
  const numLands = u32(0x08);
  const landOff = u32(0x0c);
  const numFacilities = u32(0x10);
  const facilityOff = u32(0x14);
  const numCommercials = u32(0x18);
  const commercialOff = u32(0x1c);
  const numLandscapes = u32(0x20);
  const landscapeOff = u32(0x24);

  // 所有表的索引均从 1 开始，故第 i 项位于 off + i*size
  const nodes: MapNode[] = [];
  for (let i = 1; i <= numNodes; i++) {
    const o = nodeOff + i * NODE_SIZE;
    const adjacent: number[] = [];
    const adjacentSlots: [number, number, number, number] = [0, 0, 0, 0];
    for (let a = 0; a < 4; a++) {
      const n = view.getUint16(o + 0x18 + a * 2, true);
      adjacentSlots[a] = n;
      if (n !== 0) adjacent.push(n);
    }
    const type = view.getUint16(o + 0x20, true);
    const flags = u32(o + 0x24);
    nodes.push({
      id: i,
      x: view.getInt16(o + 0x00, true),
      y: view.getInt16(o + 0x02, true),
      name: readName(data, o + 0x04, 20),
      adjacent,
      adjacentSlots,
      type,
      ref: resolveNodeType(type),
      decorIndex: view.getUint16(o + 0x22, true),
      flags,
      specialKind: flags & 0xff,
      noObjects: (flags & 0x80000000) !== 0,
      walkable: adjacent.length > 0,
    });
  }

  const lands: LandInfo[] = [];
  for (let i = 1; i <= numLands; i++) {
    const o = landOff + i * LAND_SIZE;
    lands.push({
      id: i,
      x: view.getInt16(o + 0x00, true),
      y: view.getInt16(o + 0x02, true),
      // 名称止于 0x17（price_status），故最长 19 字节
      name: readName(data, o + 0x04, 0x13),
      priceStatus: data[o + 0x17] ?? 0,
      type: data[o + 0x18] ?? 0,
      owner: data[o + 0x19] ?? 0,
      level: data[o + 0x1a] ?? 0,
      facing: (data[o + 0x1b] ?? 0) & 7,
      landPrice: view.getUint16(o + 0x1c, true),
      housePrice: view.getUint16(o + 0x1e, true),
      rentByLevel: Array.from({ length: MAX_LAND_LEVEL + 1 }, (_, lv) =>
        view.getUint16(o + 0x20 + lv * 2, true),
      ),
      flast: u32(o + 0x30),
    });
  }

  const facilities: FacilityInfo[] = [];
  for (let i = 1; i <= numFacilities; i++) {
    const o = facilityOff + i * FACILITY_SIZE;
    facilities.push({
      id: i,
      x: view.getInt16(o + 0x00, true),
      y: view.getInt16(o + 0x02, true),
      // 名称止于 0x18（type），故最长 20 字节
      name: readName(data, o + 0x04, 0x14),
      type: data[o + 0x18] ?? 0,
      owner: data[o + 0x19] ?? 0,
      level: data[o + 0x1a] ?? 0,
      facing: (data[o + 0x1b] ?? 0) & 7,
      priceStatus: data[o + 0x1c] ?? 0,
      // ★ +0x1d/+0x1e = 研究所的「研发項目 / 剩余天数」—— 名牌浮标第三行要它们
      //   （VA 0x00417ac2 / 0x00417ad3）。八张地图里恒为 0，运行时的值在
      //   `GameState.facilityResearchProject/Days`。
      researchProject: data[o + 0x1d] ?? 0,
      researchDays: data[o + 0x1e] ?? 0,
      // ★ 商業用地的地契到期日在 +0x34（住宅是 +0x30，两者不同，见字段注释）
      flast: u32(o + 0x34),
      landPrice: view.getUint16(o + 0x22, true),
      housePrice: view.getUint16(o + 0x24, true),
      // ★ +0x24 其实是**按等级索引的费率表**，不是单个房价。
      //   见 rules/facility.ts 对 VA 0x0041a429 的说明。
      rateByLevel: Array.from({ length: 6 }, (_, lv) =>
        view.getUint16(o + 0x24 + lv * 2, true),
      ),
    });
  }

  const commercials: CommercialInfo[] = [];
  for (let i = 1; i <= numCommercials; i++) {
    const o = commercialOff + i * COMMERCIAL_SIZE;
    commercials.push({
      id: i,
      x: view.getInt16(o + 0x00, true),
      y: view.getInt16(o + 0x02, true),
      name: readName(data, o + 0x04, 0x14),
      stockIndex: data[o + 0x19] ?? 0,
      type: data[o + 0x1a] ?? 0,
      // 朝向在 +0x1b（绘制企业 VA 0x0040964d 读的就是它）
      facing: (data[o + 0x1b] ?? 0) & 7,
      spriteIndex: view.getUint16(o + 0x20, true),
      landPrice: view.getUint16(o + 0x22, true),
      assetValue: u32(o + 0x24),
      owner: data[o + 0x18] ?? 0,
      ranking: [
        data[o + 0x1c] ?? 0,
        data[o + 0x1d] ?? 0,
        data[o + 0x1e] ?? 0,
        data[o + 0x1f] ?? 0,
      ],
      funds: view.getInt32(o + 0x28, true),
      profit: view.getInt32(o + 0x2c, true),
      shares: u32(o + 0x30),
    });
  }

  const landscapes: LandscapeInfo[] = [];
  for (let i = 1; i <= numLandscapes; i++) {
    const o = landscapeOff + i * LANDSCAPE_SIZE;
    landscapes.push({
      id: i,
      x: view.getInt16(o + 0x00, true),
      y: view.getInt16(o + 0x02, true),
      name: readName(data, o + 0x04, 0x18),
      // 朝向在 +0x18（绘制景观 VA 0x00409793 读的就是它）
      facing: (data[o + 0x18] ?? 0) & 7,
      spriteIndex: view.getUint16(o + 0x1a, true),
    });
  }

  // @source rich4_load_map.asm:211-221
  const dataSize = landscapeOff + (numLandscapes + 1) * LANDSCAPE_SIZE;

  return { nodes, lands, facilities, commercials, landscapes, dataSize };
}
