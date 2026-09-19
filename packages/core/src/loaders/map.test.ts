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
import { stocksOfMap } from '@rich4/data';

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

  // ★ Q13 —— 0x22 decorIndex 的真值（见 map.ts 字段注释 / docs/map-format.md §3.4）
  describe('★ Q13：decorIndex 是 map.mkf 资源 24（58 张 SMP）的 1 基下标', () => {
    it('八张地图上取值都在 0..58，且最大值 58 与图库张数严丝合缝', () => {
      let max = 0;
      const distinct = new Set<number>();
      for (let i = 0; i < 8; i++) {
        for (const n of loadMap(i).nodes) {
          expect(Number.isInteger(n.decorIndex), `地图${i} 节点${n.id}`).toBe(true);
          expect(n.decorIndex, `地图${i} 节点${n.id}`).toBeGreaterThanOrEqual(0);
          expect(n.decorIndex, `地图${i} 节点${n.id}`).toBeLessThanOrEqual(58);
          max = Math.max(max, n.decorIndex);
          distinct.add(n.decorIndex);
        }
      }
      expect(max).toBe(58); // 资源 24 恰好 58 张图
      expect(distinct.size).toBe(56); // 0 + 55 种装饰（实测）
    });

    it('普通地图（0/1/2/3/5/6/7）只用**奇数** 1..33 —— 无光环款', () => {
      for (const i of [0, 1, 2, 3, 5, 6, 7]) {
        const nz = loadMap(i).nodes.filter((n) => n.decorIndex !== 0);
        expect(nz.length, `地图${i} 有装饰的节点数`).toBeGreaterThan(0);
        for (const n of nz) {
          expect(n.decorIndex % 2, `地图${i} 节点${n.id} 的 decorIndex=${n.decorIndex}`).toBe(1);
          expect(n.decorIndex, `地图${i} 节点${n.id}`).toBeLessThanOrEqual(33);
        }
      }
    });

    it('地图 4（十二星座／太空图）每个节点都有装饰，且用偶数 4..34 + 天体 35..58', () => {
      const m = loadMap(4);
      expect(m.nodes.every((n) => n.decorIndex !== 0)).toBe(true);
      const vals = new Set(m.nodes.map((n) => n.decorIndex));
      const small = [...vals].filter((v) => v <= 34).sort((a, b) => a - b);
      const big = [...vals].filter((v) => v >= 35).sort((a, b) => a - b);
      // 偶数是图库里「带粉红光环」的那一款
      expect(small).toEqual([4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34]);
      // 天体图里 37 / 46 两号在本图未被引用（其余 35..58 全用到）
      expect(big).toEqual(
        Array.from({ length: 24 }, (_, i) => 35 + i).filter((v) => v !== 37 && v !== 46),
      );
    });

    it('普通地图上住宅/设施的装饰一律为 0（外观走各自的表；企业/景观仍有装饰）', () => {
      for (const i of [0, 1, 2, 3, 5, 6, 7]) {
        const m = loadMap(i);
        for (const n of m.nodes) {
          if (n.ref.kind === 'land' || n.ref.kind === 'facility') {
            expect(n.decorIndex, `地图${i} 节点${n.id}(${n.name})`).toBe(0);
          }
        }
      }
    });
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

  // ★★ 通道 2 差分（`rich4-spec/tests/test_tool_roadblock_ai.py` 的边界组）：
  //   原版四段的区间**都是 2000 宽**（`0x7d0<v<0xfa0` / `0xfa0<v<0x1770` /
  //   `0x1770<v<0x1f40` / `0x1f40<v<0x2710`），本函数先前只写了一半宽
  //   （`<3000/<5000/<7000/<9000`）⇒ `type ∈ [3000,4000)` 原版判住宅、本函数判 unknown。
  it('★★ 四段上界都是「下界 + 2000」（照原版；先前只有一半宽）', () => {
    expect(resolveNodeType(3000)).toEqual({ kind: 'land', index: 1000 });
    expect(resolveNodeType(3999)).toEqual({ kind: 'land', index: 1999 });
    expect(resolveNodeType(4000)).toEqual({ kind: 'unknown', raw: 4000 }); // 下界是开的
    expect(resolveNodeType(5000)).toEqual({ kind: 'facility', index: 1000 });
    expect(resolveNodeType(5999)).toEqual({ kind: 'facility', index: 1999 });
    expect(resolveNodeType(7000)).toEqual({ kind: 'commercial', index: 1000 });
    expect(resolveNodeType(7999)).toEqual({ kind: 'commercial', index: 1999 });
    expect(resolveNodeType(9000)).toEqual({ kind: 'landscape', index: 1000 });
    expect(resolveNodeType(9999)).toEqual({ kind: 'landscape', index: 1999 });
    expect(resolveNodeType(10000)).toEqual({ kind: 'unknown', raw: 10000 }); // 上界也是开的
  });
});

describe('★ 上市企业与特殊景观', () => {
  const have = hasAssets ? it : it.skip;

  have('企业带坐标、股票下标、精灵索引与资产额', () => {
    const m = parseMap(new Uint8Array(readFileSync(`${MAP_DIR}/0001.bin`)));
    expect(m.commercials.length).toBeGreaterThan(0);
    for (const c of m.commercials) {
      expect(c.x).toBeGreaterThan(0);
      expect(c.y).toBeGreaterThan(0);
      expect(c.assetValue).toBeGreaterThan(0);
      // 精灵索引落在「索引 + 38 = 资源号」那一段
      expect(c.spriteIndex).toBeGreaterThan(100);
    }
  });

  have('★ 企业资产额 ÷ 10000 与对应股票的初始价同量级 —— 它就是均值回归的锚', () => {
    const m = parseMap(new Uint8Array(readFileSync(`${MAP_DIR}/0001.bin`)));
    const stocks = stocksOfMap(0);
    for (const c of m.commercials) {
      const s = stocks[c.stockIndex];
      if (s === undefined) continue;
      const anchor = c.assetValue / 10_000;
      // 实测两者比值在 0.8..1.0 之间（地图 1 的四家恰好都是 0.8）
      expect(anchor / s.price).toBeGreaterThan(0.5);
      expect(anchor / s.price).toBeLessThanOrEqual(1.2);
    }
  });

  have('景观带坐标与精灵索引', () => {
    const m = parseMap(new Uint8Array(readFileSync(`${MAP_DIR}/0001.bin`)));
    expect(m.landscapes.length).toBeGreaterThan(0);
    const named = m.landscapes.filter((l) => l.name.length > 0);
    expect(named.length).toBeGreaterThan(0);
    for (const l of named) {
      expect(l.spriteIndex).toBeGreaterThan(0);
    }
  });

  have('★ 地块与设施都带 0..7 的朝向', () => {
    const m = parseMap(new Uint8Array(readFileSync(`${MAP_DIR}/0001.bin`)));
    for (const l of m.lands) {
      expect(l.facing).toBeGreaterThanOrEqual(0);
      expect(l.facing).toBeLessThan(8);
    }
    for (const f of m.facilities) {
      expect(f.facing).toBeGreaterThanOrEqual(0);
      expect(f.facing).toBeLessThan(8);
    }
    // 同一区的地块朝向一致 —— 这正是先前把它误当成「风格号」的原因
    const byName = new Map<string, Set<number>>();
    for (const l of m.lands) {
      if (!byName.has(l.name)) byName.set(l.name, new Set());
      byName.get(l.name)!.add(l.facing);
    }
    for (const [name, set] of byName) expect(set.size, `${name} 的朝向不一致`).toBe(1);
  });

  // ★ 研究所那两个字节（Q-HOVER-1 残留项 ① / Q-TOOL-6）：
  //   `+0x1d` = 研發項目下标、`+0x1e` = 剩余天数。名牌浮标第三行要它们。
  //   八张地图里**恒为 0**（原版地图没有现成研究所，种类是开局后盖出来的），
  //   所以这里钉的是「解析器**一定**读那两个字节、且落在 0..255」，
  //   运行时的值在 `GameState.facilityResearchProject/Days`。
  have('★ 設施 +0x1d/+0x1e 被解析出来（研究所的項目与倒计时）', () => {
    for (let mapId = 0; mapId < 8; mapId++) {
      const m = loadMap(mapId);
      for (const f of m.facilities) {
        // 字段一定存在（真实解析路径必填），且是 0..255 的字节
        expect(f.researchProject).toBeGreaterThanOrEqual(0);
        expect(f.researchProject).toBeLessThanOrEqual(0xff);
        expect(f.researchDays).toBeGreaterThanOrEqual(0);
        expect(f.researchDays).toBeLessThanOrEqual(0xff);
        // 原版地图数据里没有研究所、也没有在研發的：恒 0
        expect(f.researchProject).toBe(0);
        expect(f.researchDays).toBe(0);
      }
    }
  });

  have('★ +0x1d/+0x1e 读的是记录里那两个字节（与手算偏移一致）', () => {
    const raw = new Uint8Array(readFileSync(`${MAP_DIR}/0001.bin`));
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const numFac = view.getUint32(0x10, true);
    const facOff = view.getUint32(0x14, true);
    const m = parseMap(raw);
    for (let i = 1; i <= numFac; i++) {
      const o = facOff + i * 0x38;
      const f = m.facilities.find((x) => x.id === i)!;
      expect(f.researchProject).toBe(raw[o + 0x1d]);
      expect(f.researchDays).toBe(raw[o + 0x1e]);
    }
    // 非空断言：地图 1 确实有設施（否则这条测试是空转）
    expect(numFac).toBeGreaterThan(0);
  });
});
