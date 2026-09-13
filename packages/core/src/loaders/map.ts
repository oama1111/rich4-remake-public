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
export const OCCUPIED_MASK = 0x80ffff00;

// ============================================================
//  类型
// ============================================================

export interface MapNode {
  /** 节点号，**从 1 开始** */
  id: number;
  x: number;
  y: number;
  /** 地块名称（BIG5 解码后）。原先被误标为 reserved 的 0x04..0x17 共 20 字节 */
  name: string;
  /** 相邻节点号，已剔除 0（0 表示无连接） */
  adjacent: number[];
  /** 原始 type 值 @source 节点 +0x20 */
  type: number;
  /** type 解析结果 */
  ref: NodeRef;
  /** 装饰/图素索引。**语义待确认**（见 docs/map-format.md §7a） @source 节点 +0x22 */
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
  /** TODO: semantics unknown @source land.h 0x30 名为 flast */
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
  /** @source land.h 0x1c */
  priceStatus: number;
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
   * **按等级索引的费率表**，6 项 uint16，起于 `+0x24`。
   *
   * @source VA 0x0041a429（设施过路费 type 1/2 分支）：
   * ```asm
   * al  = byte [facility + 0x1a]   ; level
   * eax = eax + eax                ; ×2
   * eax = eax + edx                ; + 基址
   * bx  = word [eax + 0x24]        ; ★ word[facility + 0x24 + level*2]
   * ```
   *
   * ⚠️ `rich4-re/csrc/land.h` 只记了单个 `house_price`，
   * 与住宅 `+0x20` 的 `rentByLevel` 是同一类遗漏。
   */
  rateByLevel: number[];
}

/** 上市企业 */
export interface CommercialInfo {
  id: number;
  name: string;
  /** 对应的股票索引 @source rich4_load_map.asm:325 (mov dl, byte [esi+0x19]) */
  stockIndex: number;
}

/** 特殊景观（阿里山、佛光山等） */
export interface LandscapeInfo {
  id: number;
  name: string;
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
    for (let a = 0; a < 4; a++) {
      const n = view.getUint16(o + 0x18 + a * 2, true);
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
      priceStatus: data[o + 0x1c] ?? 0,
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
      name: readName(data, o + 0x04, 0x14),
      stockIndex: data[o + 0x19] ?? 0,
    });
  }

  const landscapes: LandscapeInfo[] = [];
  for (let i = 1; i <= numLandscapes; i++) {
    const o = landscapeOff + i * LANDSCAPE_SIZE;
    landscapes.push({
      id: i,
      name: readName(data, o + 0x04, 0x18),
    });
  }

  // @source rich4_load_map.asm:211-221
  const dataSize = landscapeOff + (numLandscapes + 1) * LANDSCAPE_SIZE;

  return { nodes, lands, facilities, commercials, landscapes, dataSize };
}

/**
 * 原版的「该节点可否放置道具」判定。
 * @source rich4_node_utils.asm:26-31
 */
export function isNodeAvailableForObject(node: MapNode): boolean {
  return (node.flags & OCCUPIED_MASK) === 0 && node.walkable;
}
