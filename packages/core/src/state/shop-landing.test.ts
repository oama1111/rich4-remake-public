/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 百貨公司落点
 */

import { describe, expect, it } from 'vitest';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { toolCount } from '../rules/tools.ts';
import { CARDS, TOOLS } from '@rich4/data';
import { STORE_INDUSTRY } from '../places/shop.ts';
import { TRAFFIC_WALK } from '../rules/tool-effects.ts';
import { initialCardAmounts } from '../rules/new-game.ts';
import { initialToolStock } from '../rules/tools.ts';

const node = makeNode({ id: 1, adjacent: [1], flags: SPECIAL_KIND.DEPARTMENT_STORE, specialKind: SPECIAL_KIND.DEPARTMENT_STORE });
const topo = { nodes: [node] };

function landed(points: number): GameState {
  const s = makeGameState({
    phase: 'settling',
    // ★ 货架是从牌堆/库存里抽的（0x0042eb05 / 0x0042ec0b），空牌堆抽不出东西
    cardAmount: initialCardAmounts(),
    toolStock: initialToolStock(),
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, character: i, nodeId: 1, points, trafficMethod: TRAFFIC_WALK }),
    ),
  });
  return reduce(s, { type: 'settle' }, topo);
}

describe('★ 百貨公司落点', () => {
  it('★ 留下一个商店交互，列出卡片与道具的標價', () => {
    const s = landed(500);
    expect(s.pending?.kind).toBe('shop');
    if (s.pending?.kind !== 'shop') return;
    expect(s.pending.points).toBe(500);
    // ★ 货架 6..15 件（0x0042eb05 `rand()%10+6`），不是全部 30 张
    expect(s.pending.cards.length).toBeGreaterThanOrEqual(6);
    expect(s.pending.cards.length).toBeLessThanOrEqual(15);
    // ★ 道具只列 1..8 号（0x0042ec0b `cmp eax, 8`）—— 9..13 只能靠研究所
    expect(s.pending.tools.map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(s.pending.tools.find((t) => t.id === 6)?.stock).toBeGreaterThan(0);
  });

  it('★ 买汽車：扣點數不扣钱，道具到手', () => {
    const s = landed(500);
    const cash = s.players[0]!.cash;
    const after = reduce(s, { type: 'shop', op: 'buyTool', id: 6 }, topo);
    expect(after.players[0]!.points).toBe(350); // 500 − 150
    expect(after.players[0]!.cash).toBe(cash);
    expect(toolCount(after.tools, 0, 6)).toBe(1);
  });

  it('★ 买完商店还开着，可以接着买 —— 原版是模态窗口', () => {
    let s = landed(500);
    s = reduce(s, { type: 'shop', op: 'buyTool', id: 6 }, topo);
    expect(s.pending?.kind).toBe('shop');
    // 交互里的點數要刷新，否则界面还显示旧数
    if (s.pending?.kind === 'shop') expect(s.pending.points).toBe(350);
    // 买货架上的第一张 —— 不在货架上的卡买不到（0x0042eb15 只列货架）
    const onShelf = s.pending?.kind === 'shop' ? s.pending.cards[0]!.id : 0;
    s = reduce(s, { type: 'shop', op: 'buyCard', id: onShelf }, topo);
    expect(s.players[0]!.cards).toContain(onShelf);
  });

  it('★ 买一件少一件 —— 卡片与道具**两页都**如此', () => {
    // @source 原版两页各清自己那一格：卡片 `mov byte [edi+0x48c31c],0`、
    //   道具 `mov byte [ebx+0x48c2f8],0`（rich4_shop.asm 0x42e1eb / 0x42e466 尾）
    let s = landed(500);
    if (s.pending?.kind !== 'shop') throw new Error('商店没开');
    const shelfTool = s.pending.tools.find((t) => t.id === 6)!.id;
    const shelfCard = s.pending.cards[0]!.id;
    s = reduce(s, { type: 'shop', op: 'buyTool', id: shelfTool }, topo);
    expect(s.pending?.kind === 'shop' && s.pending.tools.some((t) => t.id === shelfTool)).toBe(false);
    s = reduce(s, { type: 'shop', op: 'buyCard', id: shelfCard }, topo);
    expect(s.pending?.kind === 'shop' && s.pending.cards.some((c) => c.id === shelfCard)).toBe(false);
    // ★ 买过的再买一次：reducer 拒绝（返回同一个 state），而不是凭空再来一件
    expect(reduce(s, { type: 'shop', op: 'buyTool', id: shelfTool }, topo)).toBe(s);
  });

  it('點數不够时什么都不发生', () => {
    const s = landed(10);
    expect(reduce(s, { type: 'shop', op: 'buyTool', id: 6 }, topo)).toBe(s);
  });

  it('★ 回合结束会关掉商店 —— 不能把柜台带给下家', () => {
    const s = landed(500);
    expect(s.pending?.kind).toBe('shop');
    const after = reduce({ ...s, phase: 'turnEnd' }, { type: 'endTurn' }, topo);
    expect(after.pending).toBeNull();
  });

  it('没落在商店上时买卖无效', () => {
    const s = makeGameState({ pending: null });
    expect(reduce(s, { type: 'shop', op: 'buyTool', id: 6 }, topo)).toBe(s);
  });
});

/*
 * ★★ W-67-a：董事長蒞臨商店的**贈禮框与台词提示**。
 *
 * @source `_rich4_ui_shop_entry` `0x0042e97d..0x0042ea28`：
 *   ① `rand() & 1` 决定送道具（`0x445ada`）还是送卡（`0x441e12`）；
 *   ② 真的送成了才 `sprintf(buf, 0x464378(=「歡迎董事長光臨\n\n送您%s！」), 名字)`
 *      → `push 0x5dc / call 0x440cac`（棕色訊息框 1500 ms，**在商店窗打开之前**）
 *      → `call 0x44f230(玩家, 那件的**點數价**)`（「好消息」台词阶梯）。
 *   ⇒ core 侧的交接口 = `notices` 新出现 `shop.chairmanGift`（`args[0]` = 名字）
 *     与瞬态 `lastShopGift`（`{kind, id, points}`）。
 */
describe('★★ W-67-a 董事長蒞臨的贈禮', () => {
  /**
   * 给 `topo` 补一家**百貨公司**（行業 `STORE_INDUSTRY = 10`），并让玩家 0 持有它。
   * `chairmanOfIndustry(state, topo.commercials, STORE_INDUSTRY)` 要两样都在。
   */
  const CHAIRMAN_TOPO = (): {
    nodes: readonly ReturnType<typeof makeNode>[];
    commercials: readonly { id: number; type: number; x: number; y: number; name: string; stockIndex: number }[];
  } => ({
    nodes: [node],
    commercials: [
      { id: 0, type: STORE_INDUSTRY, x: 0, y: 0, name: '百貨', stockIndex: 0 },
    ],
  });

  /** 玩家 0 当上董事長之后的落点状态 */
  const chairmanLanded = (over: Partial<GameState> = {}): GameState => {
    const base = landed(500);
    const owners = base.commercialOwners.map((c) => ({ ...c }));
    while (owners.length < 1) owners.push({ owner: 0, ranking: [] } as unknown as (typeof owners)[number]);
    owners[0] = { ...owners[0]!, owner: 1 }; // 1 基 ⇒ 玩家 0
    return reduce(
      { ...base, phase: 'settling', pending: null, commercialOwners: owners, ...over },
      { type: 'settle' },
      CHAIRMAN_TOPO() as unknown as typeof topo,
    );
  };

  it('★ 不是董事長 ⇒ 既不弹框也没有 `lastShopGift`', () => {
    const s = landed(500);
    // 开局的 `commercialOwners` 全 0 ⇒ `chairmanOfIndustry` 返回 null
    expect(s.notices.filter((n) => n.key === 'shop.chairmanGift')).toHaveLength(0);
    expect(s.lastShopGift ?? null).toBeNull();
  });

  it('★ 是董事長且真的送出了东西 ⇒ `notices[0].key === shop.chairmanGift` 且 `args[0]` 是那件的名字', () => {
    // 造一个「玩家 0 持有百貨公司（行業 10）」的状态再落点
    const s = chairmanLanded();

    const notice = s.notices.find((n) => n.key === 'shop.chairmanGift');
    expect(notice, '董事長赠礼框应当出现').toBeDefined();
    expect(notice!.args).toHaveLength(1);
    // ★ 这个夹具（`seed 1` + 满库存满牌堆）**一定**送得成 —— 框与瞬态必须成对出现，
    //   所以这里直接断言非 null（不是「有就查、没有就算了」那种恒真写法）。
    const gift = s.lastShopGift ?? null;
    expect(gift, '这个夹具下应当真的送出了一件').not.toBeNull();
    expect(['tool', 'card']).toContain(gift!.kind);
    expect(gift!.points).toBeGreaterThan(0);
    expect(notice!.args[0]).toBe(
      gift!.kind === 'tool'
        ? (TOOLS.find((t) => t.id === gift!.id)?.name ?? `道具${gift!.id}`)
        : (CARDS.find((c) => c.id === gift!.id)?.name ?? `卡${gift!.id}`),
    );
  });

  it('★ 库存与牌堆都空 ⇒ 不弹框、也不写 `lastShopGift`', () => {
    const s = chairmanLanded({
      cardAmount: new Array<number>(30).fill(0),
      toolStock: new Array<number>(14).fill(0),
    });
    expect(s.notices.filter((n) => n.key === 'shop.chairmanGift')).toHaveLength(0);
    expect(s.lastShopGift ?? null).toBeNull();
  });

  it('★ 瞬态：下一条 action 把它清成 null（只活一条 action）', () => {
    const s = chairmanLanded();
    const cleared = reduce(s, { type: 'rotateView', delta: 1 }, topo);
    expect(cleared.lastShopGift ?? null).toBeNull();
  });
});
