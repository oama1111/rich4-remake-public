/*
 * 把**实时状态**合进静态地图模板 —— 得到「现在这张地图长什么样」
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ## 为什么需要它
 *
 * 原版把地皮/設施/企業的归属、等级、种类、涨价档、地契到期日**都存在地图块里**
 * （存档的「地图数据块」就是这张表的快照，见 `save-format.md`）。
 * 本引擎为了「静态地图 + 可变状态」分离，把这些字段的**实时值**放在
 * `GameState` 的几条扁平数组里（`landOwner` / `landLevel` / `facilityOwner` …），
 * `Rich4Map` 里那份只是**装载时的初值**。
 *
 * ⚠️ **踩过的坑**：`writeMapBlock` 原本直接读 `map.lands[i].owner` 等字段
 *   ⇒ 写出的是**装载时**的归属。两份真实存档「读进来再写回去」逐字节相等，
 *   是因为那一刻 state 与 map 恰好一致（实测 55 块地 / 8 处設施**零处不一致**），
 *   所以测试全绿 —— 但**只要真的玩过几步**（买地、盖房、涨价、查封、续地契、
 *   研发），写出的存档里地图块就还是旧的归属。修法就是本模块 +
 *   `writeOriginalSaveFile` 先合并再交给 `writeMapBlock`。
 *
 * ## 合并哪些字段（其余一律保留地图模板的原值）
 *
 * | 表 | 取自 `GameState` 的数组 | 字段 |
 * |---|---|---|
 * | 住宅地 | `landOwner` / `landLevel` / `landType` / `landPriceStatus` / `landTenure` / `landPrice` | `+0x19/+0x1a/+0x18/+0x17/+0x30/+0x1c` |
 * | 設施 | `facilityOwner` / `facilityLevel` / `facilityType` / `facilityPriceStatus` / `facilityTenure` / `facilityResearchProject` / `facilityResearchDays` | `+0x19/+0x1a/+0x18/+0x1c/+0x34/+0x1d/+0x1e` |
 * | 企業 | `commercialOwners[].owner` / `commercialOwners[].ranking` / `companyFunds` / `companyProfit` / `commercialShares` | `+0x18` / `+0x1c..1f` / `+0x28` / `+0x2c` / `+0x30` |
 *
 * **不合并**（都是静态地图数据，原版也不随游戏变）：
 *   · 节点表（坐标/邻接/装饰/`flags`）—— 运行时的占用与封路在本引擎里由
 *     `objects` 与 `state` 表示，**不写回 `node.flags`**（见 `ai/tool-policy.ts` 的说明）；
 *   · 各类坐标、租率表、`rentByLevel`/`rateByLevel`、`spriteIndex` 等。
 */

import type { GameState } from '../state/types.ts';
import type { FacilityInfo, LandInfo, Rich4Map } from './map.ts';

/**
 * 用 `state` 里的实时值覆盖地图模板上那些**会变**的字段，返回一张新地图。
 *
 * 不修改入参；`map` 里没有对应状态的字段原样保留。
 */
export function withLiveMapState(map: Rich4Map, state: GameState): Rich4Map {
  const lands: LandInfo[] = map.lands.map((l) => ({
    ...l,
    owner: state.landOwner[l.id] ?? l.owner,
    level: state.landLevel[l.id] ?? l.level,
    type: state.landType[l.id] ?? l.type,
    priceStatus: state.landPriceStatus?.[l.id] ?? l.priceStatus,
    // 地契到期日（`flast`）：续租/到期都会改它
    flast: state.landTenure?.[l.id] ?? l.flast,
    // 地价会被新聞 6/14 改（×1.3 / ×0.7）
    landPrice: state.landPrice?.[l.id] ?? l.landPrice,
  }));

  const facilities: FacilityInfo[] = map.facilities.map((f) => {
    const out: FacilityInfo = {
      ...f,
      owner: state.facilityOwner[f.id] ?? f.owner,
      level: state.facilityLevel[f.id] ?? f.level,
      type: state.facilityType[f.id] ?? f.type,
      priceStatus: state.facilityPriceStatus?.[f.id] ?? f.priceStatus,
      flast: state.facilityTenure?.[f.id] ?? f.flast,
    };
    // ⚠️ `exactOptionalPropertyTypes`：这两项是**选填**的，只在有值时才写，
    //   不能赋 `undefined`（否则类型不成立，且写档时会把"没有"变成"有且为 undefined"）
    const rp = state.facilityResearchProject?.[f.id] ?? f.researchProject;
    const rd = state.facilityResearchDays?.[f.id] ?? f.researchDays;
    if (rp !== undefined) out.researchProject = rp;
    if (rd !== undefined) out.researchDays = rd;
    return out;
  });

  const commercials = map.commercials.map((c) => {
    const live = state.commercialOwners?.[c.id];
    return {
      ...c,
      owner: live?.owner ?? c.owner,
      // ★ 运行时四项：先前只合并了 `owner`，其余三格（排名/盈餘/自留股数）
      //   一直是地图模板里的旧值 ⇒ 写出的存档里企业金库与可售股数是错的。
      ranking: live?.ranking ?? c.ranking,
      funds: state.companyFunds?.[c.id] ?? c.funds,
      profit: state.companyProfit?.[c.id] ?? c.profit,
      shares: state.commercialShares?.[c.id] ?? c.shares,
    };
  });

  return { ...map, lands, facilities, commercials };
}
