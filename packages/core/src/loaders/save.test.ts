/*
 * 存档解析验证 —— M1 的出口条件
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 判据：结构自洽性。若任一字段偏移算错，整体长度校验必然不成立，
 * 且玩家数值会落到荒谬区间。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseSave, expectedSaveLength, OFFSET, GOD, WHO_PLAYS } from './save.ts';
import { parseMap } from './map.ts';
import { CHARACTERS } from '@rich4/data';

const ROOT = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版';
const SAVES = [`${ROOT}/Rich4/Save0.dat`, `${ROOT}/Rich4/SAVE1.DAT`];
const hasSaves = SAVES.every((p) => existsSync(p));
const d = hasSaves ? describe : describe.skip;

function load(path: string) {
  return parseSave(new Uint8Array(readFileSync(path)));
}

d('存档解析 —— 两个原版存档', () => {
  it.each(SAVES)('%s 的整体长度与结构推导一致', (path) => {
    const raw = readFileSync(path);
    const save = parseSave(new Uint8Array(raw));
    const mapDataSize = save.mapData.length;

    // 这是最强的偏移正确性判据：任何一处算错，长度都对不上
    expect(expectedSaveLength(save.numPlayers, mapDataSize)).toBe(raw.length);
  });

  it.each(SAVES)('%s 的基本字段落在合理区间', (path) => {
    const s = load(path);
    expect(s.numPlayers).toBeGreaterThanOrEqual(2);
    expect(s.numPlayers).toBeLessThanOrEqual(4);
    expect(s.gameMap).toBeGreaterThanOrEqual(0);
    expect(s.gameMap).toBeLessThan(4);
    expect(s.gameStage).toBeGreaterThanOrEqual(0);
    expect(s.gameStage).toBeLessThan(2);
    expect(s.globalMapId).toBeGreaterThanOrEqual(0);
    expect(s.globalMapId).toBeLessThan(8);
    expect(s.currentPlayer).toBeGreaterThanOrEqual(0);
    expect(s.currentPlayer).toBeLessThan(4);
    // 日期
    expect(s.day).toBeGreaterThanOrEqual(1);
    expect(s.day).toBeLessThanOrEqual(31);
    expect(s.month).toBeGreaterThanOrEqual(1);
    expect(s.month).toBeLessThanOrEqual(12);
    expect(s.year).toBeGreaterThanOrEqual(1997);
    expect(s.year).toBeLessThanOrEqual(2030);
  });

  it.each(SAVES)('%s 的玩家数据自洽', (path) => {
    const s = load(path);
    const alive = s.players.filter((p) => p.isAlive);
    expect(alive.length).toBeGreaterThan(0);

    for (const p of alive) {
      // 角色编号必须落在 12 个角色内
      expect(p.character, `玩家${p.index} 角色编号`).toBeGreaterThanOrEqual(0);
      expect(p.character).toBeLessThan(CHARACTERS.length);
      // 骰子数 1..3
      expect(p.ndices).toBeGreaterThanOrEqual(1);
      expect(p.ndices).toBeLessThanOrEqual(3);
      // 金额在合理量级（原版经济为整数，不会到 20 亿）
      expect(Math.abs(p.cash)).toBeLessThan(2_000_000_000);
      expect(p.moneyInBank).toBeGreaterThanOrEqual(0);
      expect(p.loan).toBeGreaterThanOrEqual(0);
      // who_plays 低 2 比特只能是 0/1/2
      expect(p.whoPlays & 0x03).toBeLessThanOrEqual(WHO_PLAYS.COMPUTER);
      // 神明状态只能取已知值
      expect(Object.values(GOD)).toContain(p.godInfo);
      // 各种天数不会超过一年
      for (const days of [p.daysInPrison, p.daysInHospital, p.daysInHotel, p.daysSleeping]) {
        expect(days).toBeLessThan(365);
      }
      // 同盟玩家为 0 或 玩家id+1
      expect(p.alliedPlayer).toBeLessThanOrEqual(4);
      // 敌意值 6 项
      expect(p.hostility.length).toBe(6);
    }
  });

  it.each(SAVES)('%s 的玩家位置指向有效地图节点', (path) => {
    const s = load(path);
    // 存档尾部的地图数据块结构与 map.mkf 的地图资源相同
    const map = parseMap(s.mapData);
    expect(map.nodes.length).toBeGreaterThan(0);

    for (const p of s.players.filter((x) => x.isAlive)) {
      expect(p.nodeId, `玩家${p.index} 节点号`).toBeGreaterThanOrEqual(1);
      expect(p.nodeId).toBeLessThanOrEqual(map.nodes.length);
    }
  });

  it.each(SAVES)('%s 的卡片与道具数据合法', (path) => {
    const s = load(path);
    for (const p of s.players.filter((x) => x.isAlive)) {
      // 手牌编号必须是有效卡片 id（1..30）
      for (const c of p.cards) {
        expect(c, `玩家${p.index} 手牌`).toBeGreaterThanOrEqual(1);
        expect(c).toBeLessThanOrEqual(30);
      }
      expect(p.cards.length).toBeLessThanOrEqual(15);
      // 13 种道具，数量合理
      expect(p.tools.length).toBe(13);
      for (const n of p.tools) expect(n).toBeLessThanOrEqual(99);
    }
    // 牌堆剩余张数
    expect(s.cardAmount.length).toBe(30);
    for (const n of s.cardAmount) expect(n).toBeLessThanOrEqual(20);
  });

  it.each(SAVES)('%s 尾部地图数据可被地图解析器正确解析', (path) => {
    const s = load(path);
    const map = parseMap(s.mapData);
    // 与 map.mkf 中同一张地图的规模应当一致
    expect(map.nodes.length).toBeGreaterThan(50);
    expect(map.dataSize).toBe(s.mapData.length);

    // 地块名称应当能正常解码（不是乱码）
    const named = map.nodes.filter((n) => n.name !== '');
    expect(named.length).toBeGreaterThan(map.nodes.length * 0.5);
    expect(named.every((n) => !n.name.includes('�'))).toBe(true);
  });

  it('存档中的地图与 map.mkf 的同一张地图节点数一致', () => {
    const s = load(SAVES[0]!);
    const map = parseMap(s.mapData);
    // 交叉验证：存档记录的 globalMapId 对应的原版地图
    const mkfPath = `${ROOT}/extracted/map/${String(s.globalMapId * 2 + 1).padStart(4, '0')}.bin`;
    if (!existsSync(mkfPath)) return;
    const original = parseMap(new Uint8Array(readFileSync(mkfPath)));
    expect(map.nodes.length).toBe(original.nodes.length);
    expect(map.lands.length).toBe(original.lands.length);
    expect(map.facilities.length).toBe(original.facilities.length);
  });

  it('★ 打印两个存档的实际内容供人工核对', () => {
    for (const path of SAVES) {
      const s = load(path);
      const map = parseMap(s.mapData);
      console.log(`\n===== ${path.split('/').pop()} =====`);
      console.log(`  日期 ${s.year}-${s.month}-${s.day}  地图 ${s.globalMapId} (stage=${s.gameStage}, map=${s.gameMap})`);
      console.log(`  玩家数 ${s.numPlayers}  当前玩家 ${s.currentPlayer}  物价指数 ${s.priceIndex}`);
      console.log(`  地图: ${map.nodes.length} 节点, ${map.lands.length} 住宅, ${map.facilities.length} 设施`);
      for (const p of s.players) {
        if (!p.isAlive) {
          console.log(`  [${p.index}] (已出局)`);
          continue;
        }
        const ch = CHARACTERS[p.character]!;
        const owned = map.lands.filter((l) => l.owner === p.index + 1).length;
        const kind = p.isComputer ? '电脑' : '玩家';
        console.log(
          `  [${p.index}] ${ch.name}(${kind})  现金 ${p.cash}  存款 ${p.moneyInBank}  贷款 ${p.loan}  点数 ${p.points}`,
        );
        console.log(
          `       位置 节点${p.nodeId}「${map.nodes[p.nodeId - 1]?.name ?? '?'}」  地产 ${owned} 处  手牌 ${p.cards.length} 张  道具 ${p.tools.reduce((a, b) => a + b, 0)} 个`,
        );
      }
    }
  });
});

describe('偏移常量自洽', () => {
  it('关键锚点与 docs/saveload.txt 记载一致', () => {
    expect(OFFSET.numPlayers).toBe(0x0c);
    expect(OFFSET.players).toBe(0x10);
    expect(OFFSET.playerCards).toBe(0x654);
    expect(OFFSET.toolAmount).toBe(0x690);
  });
});
