/*
 * 地图解析器验证 —— 对 8 张原版地图的真实数据做全量校验
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 注：本测试读取本地的原版解包产物（C-LEG-3：玩家自备原版）。
 *     若未找到素材目录则自动跳过，以免在没有原版的机器上误报失败。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap, resolveNodeType, SPECIAL_KIND, NODE_SIZE } from './map.ts';

const MAP_DIR = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map';
const hasAssets = existsSync(MAP_DIR);
const d = hasAssets ? describe : describe.skip;

/** 地图 i 的结构数据 = map.mkf 资源号 i*2+1 */
function loadMap(mapId: number) {
  const idx = mapId * 2 + 1;
  const file = `${MAP_DIR}/${String(idx).padStart(4, '0')}.bin`;
  return parseMap(new Uint8Array(readFileSync(file)));
}

/** 实测基准 —— 来自对原始数据的独立统计（见 docs/map-format.md §6） */
const EXPECTED = [
  { id: 0, nodes: 103, lands: 50, facilities: 4, commercials: 3, landscapes: 21 },
  { id: 1, nodes: 144, lands: 73, facilities: 8, commercials: 4, landscapes: 26 },
  { id: 2, nodes: 110, lands: 49, facilities: 5, commercials: 6, landscapes: 16 },
  { id: 3, lands: 55, facilities: 8, commercials: 6, landscapes: 16 },
  { id: 4, lands: 47, facilities: 5, commercials: 3, landscapes: 2 },
  { id: 5, lands: 60, facilities: 3, commercials: 12, landscapes: 143 },
  { id: 6, lands: 55, facilities: 6, commercials: 3, landscapes: 154 },
  { id: 7, lands: 0, facilities: 20, commercials: 7, landscapes: 79 },
] as const;

d('地图解析器 — 8 张原版地图', () => {
  it('节点大小常量 = 40 字节', () => {
    expect(NODE_SIZE).toBe(40);
  });

  it.each(EXPECTED)('地图 $id 的表规模与实测一致', (exp) => {
    const m = loadMap(exp.id);
    if ('nodes' in exp) expect(m.nodes.length).toBe(exp.nodes);
    expect(m.lands.length).toBe(exp.lands);
    expect(m.facilities.length).toBe(exp.facilities);
    expect(m.commercials.length).toBe(exp.commercials);
    expect(m.landscapes.length).toBe(exp.landscapes);
  });

  it('8 张地图节点总数 = 987', () => {
    let total = 0;
    for (let i = 0; i < 8; i++) total += loadMap(i).nodes.length;
    expect(total).toBe(987);
  });

  it('★ Q1 验证：0x04 处 20 字节确为 BIG5 名称，全部可解码', () => {
    let named = 0;
    let garbled = 0;
    for (let i = 0; i < 8; i++) {
      for (const n of loadMap(i).nodes) {
        if (n.name === '') continue;
        named++;
        // U+FFFD 是解码失败的替换字符
        if (n.name.includes('�')) garbled++;
      }
    }
    expect(named).toBeGreaterThan(900);
    expect(garbled).toBe(0); // 零乱码
  });

  it('地图 0 的已知地标名称正确', () => {
    const m = loadMap(0);
    const names = new Set(m.nodes.map((n) => n.name));
    for (const expected of ['卡片', '命運', '魔法屋', '銀行', '醫院', '監獄', '樂透', '新聞', '公園']) {
      expect(names).toContain(expected);
    }
  });

  it('type 基数 2000 指向 lands，且名称与 lands 表对得上', () => {
    const m = loadMap(0);
    let checked = 0;
    for (const n of m.nodes) {
      if (n.ref.kind !== 'land') continue;
      const land = m.lands.find((l) => l.id === (n.ref as { index: number }).index);
      expect(land).toBeDefined();
      expect(land!.name).toBe(n.name);
      checked++;
    }
    expect(checked).toBe(50); // 地图 0 的 50 块住宅地全部对上
  });

  it('type 基数 4000 指向 facilities，索引全部有效', () => {
    let total = 0;
    let namedMatched = 0;
    let namedTotal = 0;
    let anonymous = 0;
    for (let i = 0; i < 8; i++) {
      const m = loadMap(i);
      for (const n of m.nodes) {
        if (n.ref.kind !== 'facility') continue;
        total++;
        const f = m.facilities.find((x) => x.id === (n.ref as { index: number }).index);
        expect(f).toBeDefined(); // 索引必须落在表内
        // 节点名可以为空——此时显示名从设施表取（实测地图7 有 2 个这样的节点）
        if (n.name === '') {
          anonymous++;
        } else {
          namedTotal++;
          if (f!.name === n.name) namedMatched++;
        }
      }
    }
    expect(total).toBeGreaterThan(100);
    expect(namedMatched).toBe(namedTotal); // 有名字的必须与表一致
    expect(anonymous).toBe(2); // 且无名节点恰好 2 个
  });

  it('节点名为空时，显示名回退到所引用的表项', () => {
    const m = loadMap(7);
    const anon = m.nodes.filter((n) => n.name === '' && n.ref.kind === 'facility');
    expect(anon.length).toBe(2);
    for (const n of anon) {
      const f = m.facilities.find((x) => x.id === (n.ref as { index: number }).index);
      expect(f!.name).not.toBe(''); // 表里一定有名字
    }
  });

  it('特殊格子的 flags 低字节与名称语义一致', () => {
    const m = loadMap(0);
    const kindOf = (name: string) =>
      m.nodes.find((n) => n.name === name && n.type === 0)?.specialKind;
    expect(kindOf('公園')).toBe(SPECIAL_KIND.PARK);
    expect(kindOf('新聞')).toBe(SPECIAL_KIND.NEWS);
    expect(kindOf('命運')).toBe(SPECIAL_KIND.FORTUNE);
    expect(kindOf('監獄')).toBe(SPECIAL_KIND.PRISON);
    expect(kindOf('醫院')).toBe(SPECIAL_KIND.HOSPITAL);
    expect(kindOf('樂透')).toBe(SPECIAL_KIND.LOTTERY);
    expect(kindOf('卡片')).toBe(SPECIAL_KIND.CARD);
    expect(kindOf('魔法屋')).toBe(SPECIAL_KIND.MAGIC_HOUSE);
  });

  it('邻接关系自洽：相邻节点号都在有效范围内', () => {
    for (let i = 0; i < 8; i++) {
      const m = loadMap(i);
      for (const n of m.nodes) {
        for (const a of n.adjacent) {
          expect(a).toBeGreaterThanOrEqual(1);
          expect(a).toBeLessThanOrEqual(m.nodes.length);
        }
      }
    }
  });

  it('邻接关系互为双向（棋盘连通性）', () => {
    const m = loadMap(0);
    const byId = new Map(m.nodes.map((n) => [n.id, n]));
    let asymmetric = 0;
    for (const n of m.nodes) {
      for (const a of n.adjacent) {
        if (!byId.get(a)?.adjacent.includes(n.id)) asymmetric++;
      }
    }
    // 大富翁的棋盘含单向道路，故允许少量不对称，但主体应当是双向的
    expect(asymmetric).toBeLessThan(m.nodes.length * 0.2);
  });

  it('地图 7 没有住宅地块（特殊关卡）', () => {
    expect(loadMap(7).lands.length).toBe(0);
  });

  it('dataSize 为正且不超过文件长度', () => {
    for (let i = 0; i < 8; i++) {
      const raw = readFileSync(`${MAP_DIR}/${String(i * 2 + 1).padStart(4, '0')}.bin`);
      const m = parseMap(new Uint8Array(raw));
      expect(m.dataSize).toBeGreaterThan(0);
      expect(m.dataSize).toBeLessThanOrEqual(raw.length);
    }
  });
});

describe('resolveNodeType', () => {
  it('按基数正确归类', () => {
    expect(resolveNodeType(0)).toEqual({ kind: 'special' });
    expect(resolveNodeType(2001)).toEqual({ kind: 'land', index: 1 });
    expect(resolveNodeType(2050)).toEqual({ kind: 'land', index: 50 });
    expect(resolveNodeType(4003)).toEqual({ kind: 'facility', index: 3 });
    expect(resolveNodeType(6002)).toEqual({ kind: 'commercial', index: 2 });
    expect(resolveNodeType(8001)).toEqual({ kind: 'landscape', index: 1 });
  });
});
