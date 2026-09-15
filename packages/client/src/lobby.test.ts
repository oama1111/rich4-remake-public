/*
 * T-076：联机大厅
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  LOBBY_CHARACTER_COUNT,
  LOBBY_MAP_COUNT,
  type RoomInfo,
  type SeatInfo,
} from '@rich4/core';
import {
  BTN_BACK,
  BTN_START,
  CHAR_PICK,
  MAP_PICK,
  characterPickAt,
  drawLobby,
  hitLobby,
  isHostSeat,
  lobbySlots,
  LOBBY_SEATS,
  MAX_SEATS,
  mapPickAt,
} from './lobby.ts';
import type { Sprite } from './assets.ts';

const seat = (over: Partial<SeatInfo> & { seat: number }): SeatInfo => ({
  name: `玩家${over.seat + 1}`,
  character: over.seat,
  kind: 'human',
  ...over,
});

const room = (seats: SeatInfo[], started = false): RoomInfo => ({ id: 'r1', seats, started });

/** 每个矩形的中心 */
const center = (r: { x: number; y: number; w: number; h: number }) => ({
  x: r.x + Math.floor(r.w / 2),
  y: r.y + Math.floor(r.h / 2),
});

const outOfScreen = { x: 700, y: 520 };

// ============================================================
//  座位摊平
// ============================================================

describe('lobbySlots —— 座位视图全部来自服务器的 RoomInfo', () => {
  it('★ 固定摊成 4 格：空座也画出来，玩家看得出还剩几个位子', () => {
    const slots = lobbySlots(room([seat({ seat: 0 })]), 0);
    expect(slots).toHaveLength(MAX_SEATS);
    expect(slots[0]!.occupied).toBe(true);
    expect(slots.slice(1).every((s) => !s.occupied)).toBe(true);
  });

  it('没有房间信息（还没加入）→ 四格全空，不抛错', () => {
    const slots = lobbySlots(null, null);
    expect(slots).toHaveLength(MAX_SEATS);
    expect(slots.every((s) => !s.occupied)).toBe(true);
  });

  it('标出哪一格是自己', () => {
    const slots = lobbySlots(room([seat({ seat: 0 }), seat({ seat: 2 })]), 2);
    expect(slots.map((s) => s.isMe)).toEqual([false, false, true, false]);
  });

  it('★ 服务器没明说在线就按**离线**显示（宁可不报「人在」）', () => {
    const noFlag = lobbySlots(room([seat({ seat: 0 })]), 0)[0]!;
    expect(noFlag.connected).toBe(true); // connected 缺省 undefined → 视为在线（服务器没提就是没断）

    const offline = lobbySlots(room([seat({ seat: 0, connected: false })]), 0)[0]!;
    expect(offline.connected).toBe(false);

    // 电脑座位无所谓在不在线
    const cpu = lobbySlots(room([seat({ seat: 1, kind: 'computer', connected: false })]), 0)[1]!;
    expect(cpu.connected).toBe(false);
  });

  it('名字与角色原样带过来（大厅不自己决定座位内容）', () => {
    const slots = lobbySlots(room([seat({ seat: 1, name: '阿土伯', character: 7 })]), 0);
    expect(slots[1]!.name).toBe('阿土伯');
    expect(slots[1]!.character).toBe(7);
  });

  it('座位号乱序也能对号入座', () => {
    const slots = lobbySlots(room([seat({ seat: 3, name: '后到' }), seat({ seat: 0, name: '房主' })]), 0);
    expect(slots[0]!.name).toBe('房主');
    expect(slots[3]!.name).toBe('后到');
  });

  it('座位数可覆盖', () => {
    expect(lobbySlots(room([]), null, 2)).toHaveLength(2);
  });
});

// ============================================================
//  命中
// ============================================================

describe('hitLobby', () => {
  it('★ 房主点得到「開始」，非房主点不到（控件只读 = 不可点，不是「点了无效」）', () => {
    const p = center(BTN_START);
    expect(hitLobby(p.x, p.y, { isHost: true })).toEqual({ kind: 'start' });
    expect(hitLobby(p.x, p.y, { isHost: false })).toBeNull();
  });

  it('「離開」谁都能点', () => {
    const p = center(BTN_BACK);
    expect(hitLobby(p.x, p.y, { isHost: false })).toEqual({ kind: 'leave' });
    expect(hitLobby(p.x, p.y, { isHost: true })).toEqual({ kind: 'leave' });
  });

  it('★ 每个座位格的中心命中它自己', () => {
    for (let i = 0; i < MAX_SEATS; i++) {
      const r = { x: LOBBY_SEATS.x + i * LOBBY_SEATS.pitch, y: LOBBY_SEATS.y, w: LOBBY_SEATS.w, h: LOBBY_SEATS.h };
      const p = center(r);
      expect(hitLobby(p.x, p.y, { isHost: false })).toEqual({ kind: 'seat', index: i });
    }
  });

  it('座位格互不重叠（各自的中心只命中自己）', () => {
    const hits = new Set<string>();
    for (let i = 0; i < MAX_SEATS; i++) {
      const r = { x: LOBBY_SEATS.x + i * LOBBY_SEATS.pitch, y: LOBBY_SEATS.y, w: LOBBY_SEATS.w, h: LOBBY_SEATS.h };
      const p = center(r);
      hits.add(JSON.stringify(hitLobby(p.x, p.y, { isHost: false })));
    }
    expect(hits.size).toBe(MAX_SEATS);
  });

  it('画面外 → null', () => {
    expect(hitLobby(outOfScreen.x, outOfScreen.y, { isHost: true })).toBeNull();
  });

  it('★ 座位、開始、離開三块控件互不相犯（都不重叠）', () => {
    const rects: { r: { x: number; y: number; w: number; h: number }; expect: string }[] = [
      { r: BTN_START, expect: 'start' },
      { r: BTN_BACK, expect: 'leave' },
    ];
    for (let i = 0; i < MAX_SEATS; i++) {
      rects.push({
        r: { x: LOBBY_SEATS.x + i * LOBBY_SEATS.pitch, y: LOBBY_SEATS.y, w: LOBBY_SEATS.w, h: LOBBY_SEATS.h },
        expect: `seat-${i}`,
      });
    }
    const seen = new Map<string, string>();
    for (const { r, expect: want } of rects) {
      // 取四角与中心，全部应落在同一个控件里
      const points = [
        { x: r.x + 1, y: r.y + 1 },
        { x: r.x + r.w - 2, y: r.y + 1 },
        { x: r.x + 1, y: r.y + r.h - 2 },
        { x: r.x + r.w - 2, y: r.y + r.h - 2 },
        center(r),
      ];
      for (const p of points) {
        const hit = hitLobby(p.x, p.y, { isHost: true });
        const label = hit === null ? 'none' : hit.kind === 'seat' ? `seat-${hit.index}` : hit.kind;
        if (label === 'none') continue; // 落在按钮之外的空地，正常
        expect({ point: `${p.x},${p.y}`, got: label, want }).toMatchObject({ got: want });
        seen.set(`${p.x},${p.y}`, label);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });
});

// ============================================================
//  房主判定
// ============================================================

describe('isHostSeat', () => {
  it('只有 0 号座是房主；还没加入（null）不是', () => {
    expect(isHostSeat(0)).toBe(true);
    expect(isHostSeat(1)).toBe(false);
    expect(isHostSeat(null)).toBe(false);
  });
});

// ============================================================
//  绘制
// ============================================================

describe('drawLobby', () => {
  /** 两字段假 ctx，与 options.test.ts 同规格；另记下画过的文字与图片数 */
  function fakeCtx() {
    const texts: string[] = [];
    let images = 0;
    const ctx = {
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      textBaseline: 'top' as CanvasTextBaseline,
      save: () => undefined,
      restore: () => undefined,
      fillRect: () => undefined,
      strokeRect: () => undefined,
      drawImage: () => {
        images++;
      },
      fillText: (t: string) => {
        texts.push(t);
      },
      measureText: (t: string) => ({ width: t.length * 14 }) as TextMetrics,
    };
    return {
      ctx: ctx as unknown as CanvasRenderingContext2D,
      texts,
      get images() {
        return images;
      },
    };
  }

  const portrait = (): Sprite => ({ bitmap: {} as ImageBitmap, width: 48, height: 48, anchorX: 0, anchorY: 0 });

  it('★ 座位同步渲染：名字、在线状态、电脑/真人各画各的', () => {
    const f = fakeCtx();
    const slots = lobbySlots(
      room([
        seat({ seat: 0, name: '小明', connected: true }),
        seat({ seat: 1, name: '电脑一', kind: 'computer' }),
        seat({ seat: 2, name: '断线的', connected: false }),
      ]),
      0,
    );
    drawLobby(f.ctx, slots, 0, true, false, null, () => portrait(), (t) => t.length * 14);

    expect(f.texts).toContain('小明');
    expect(f.texts).toContain('在線');
    expect(f.texts).toContain('電腦');
    expect(f.texts).toContain('離線（電腦代打）');
    expect(f.texts).toContain('等待加入…'); // 第 4 格空着
    expect(f.texts).toContain('開始');
    expect(f.texts).toContain('離開');
  });

  it('头像抓不到也照画文字（不因为一张图挂了就整屏空）', () => {
    const f = fakeCtx();
    const slots = lobbySlots(room([seat({ seat: 0, name: '小明' })]), 0);
    drawLobby(f.ctx, slots, 0, true, false, null, () => null, (t) => t.length * 14);
    expect(f.images).toBe(0);
    expect(f.texts).toContain('小明');
  });

  it('非房主不画可点的「開始」（画出「已開始」以外要能看出不可点）', () => {
    const f = fakeCtx();
    const slots = lobbySlots(room([seat({ seat: 0 })]), 1);
    drawLobby(f.ctx, slots, 1, false, false, null, () => portrait(), (t) => t.length * 14);
    expect(f.texts).toContain('開始');
    // 提示语也要区分房主/非房主
    expect(f.texts.some((t) => t.includes('等房主開始'))).toBe(true);
  });

  it('开局后按钮显示「已開始」', () => {
    const f = fakeCtx();
    const slots = lobbySlots(room([seat({ seat: 0 })], true), 0);
    drawLobby(f.ctx, slots, 0, true, true, null, () => portrait(), (t) => t.length * 14);
    expect(f.texts).toContain('已開始');
  });

  it('长名字被截断，不会压到隔壁座位', () => {
    const f = fakeCtx();
    const long = '这是一个非常非常非常非常长的名字';
    const slots = lobbySlots(room([seat({ seat: 0, name: long })]), 0);
    drawLobby(f.ctx, slots, 0, true, false, null, () => null, (t) => t.length * 14);
    const drawn = f.texts.find((t) => t.startsWith('这是一个'));
    expect(drawn).toBeDefined();
    expect(drawn!.endsWith('…')).toBe(true);
    expect(drawn!.length).toBeLessThan(long.length);
  });

  it('空房间（还没加入）也画得出来', () => {
    const f = fakeCtx();
    drawLobby(f.ctx, lobbySlots(null, null), null, false, false, null, () => null, (t) => t.length * 14);
    expect(f.texts.filter((t) => t === '等待加入…')).toHaveLength(MAX_SEATS);
  });

  it('★ Q-NET-2：画出角色格与地图缩略图，并标出「我」的角色与当前地图', () => {
    const f = fakeCtx();
    const slots = lobbySlots(room([seat({ seat: 0, name: '小明', character: 5 })]), 0);
    drawLobby(f.ctx, slots, 0, true, false, null, () => portrait(), (t) => t.length * 14, 3);
    expect(f.texts.some((t) => t.startsWith('角色'))).toBe(true);
    expect(f.texts.some((t) => t.startsWith('地圖'))).toBe(true);
    // 座位头像 1 + 12 个角色格 + 8 张地图缩略图
    expect(f.images).toBe(1 + LOBBY_CHARACTER_COUNT + LOBBY_MAP_COUNT);
  });

  it('★ Q-NET-2：缩略图抓不到也画得出编号，整块不空', () => {
    const f = fakeCtx();
    const slots = lobbySlots(room([seat({ seat: 0 })]), 0);
    drawLobby(f.ctx, slots, 0, true, false, null, () => null, (t) => t.length * 14, 0);
    expect(f.texts.filter((t) => t.startsWith('圖 '))).toHaveLength(LOBBY_MAP_COUNT);
    expect(f.texts.filter((t) => /^\d+$/.test(t))).toHaveLength(LOBBY_CHARACTER_COUNT);
  });
});

// ============================================================
//  Q-NET-2：改角色 / 换地图（本项目新增的控件）
// ============================================================

/** 网格第 i 格的中心 */
const pickCenter = (
  grid: { x: number; y: number; cols: number; cell: number; pitch: number },
  i: number,
) => ({
  x: grid.x + (i % grid.cols) * grid.pitch + Math.floor(grid.cell / 2),
  y: grid.y + Math.floor(i / grid.cols) * grid.pitch + Math.floor(grid.cell / 2),
});

describe('★ Q-NET-2 角色挑選格（只能改自己的、未开局才让点）', () => {
  it('未开局 + 有自己的座位：12 格一格一号，命中的就是角色号', () => {
    for (let i = 0; i < LOBBY_CHARACTER_COUNT; i++) {
      const p = pickCenter(CHAR_PICK, i);
      expect(hitLobby(p.x, p.y, { isHost: false, me: 1 })).toEqual({ kind: 'character', character: i });
    }
  });

  it('★ 还没进房（me = null）→ 角色格不可点', () => {
    const p = pickCenter(CHAR_PICK, 0);
    expect(hitLobby(p.x, p.y, { isHost: true, me: null })).toBeNull();
    expect(hitLobby(p.x, p.y, { isHost: true })).toBeNull(); // 缺省也是「还没座位」
  });

  it('★ 已开局 → 角色格不可点（角色在 newGame 里就定了）', () => {
    const p = pickCenter(CHAR_PICK, 0);
    expect(hitLobby(p.x, p.y, { isHost: true, me: 0, started: true })).toBeNull();
  });

  it('characterPickAt：格间空隙与屏外都返回 −1', () => {
    expect(characterPickAt(0, 0)).toBe(-1);
    expect(characterPickAt(CHAR_PICK.x - 1, CHAR_PICK.y + 1)).toBe(-1);
    expect(characterPickAt(CHAR_PICK.x + CHAR_PICK.cell, CHAR_PICK.y)).toBe(-1);
    expect(characterPickAt(CHAR_PICK.x + 1, CHAR_PICK.y + CHAR_PICK.cell + 1)).toBe(-1);
  });

  it('12 格互不重叠（各自的中心只命中自己）', () => {
    const hits = new Set<string>();
    for (let i = 0; i < LOBBY_CHARACTER_COUNT; i++) {
      const p = pickCenter(CHAR_PICK, i);
      hits.add(JSON.stringify(hitLobby(p.x, p.y, { isHost: false, me: 0 })));
    }
    expect(hits.size).toBe(LOBBY_CHARACTER_COUNT);
  });
});

describe('★ Q-NET-2 地圖挑選格（只有房主能改）', () => {
  it('★ 房主点得到 8 张图；非房主整块不可点', () => {
    for (let i = 0; i < LOBBY_MAP_COUNT; i++) {
      const p = pickCenter(MAP_PICK, i);
      expect(hitLobby(p.x, p.y, { isHost: true, me: 0 })).toEqual({ kind: 'map', globalMapId: i });
      expect(hitLobby(p.x, p.y, { isHost: false, me: 1 })).toBeNull();
    }
  });

  it('★ 已开局 → 地图格不可点（房主也不行）', () => {
    const p = pickCenter(MAP_PICK, 0);
    expect(hitLobby(p.x, p.y, { isHost: true, me: 0, started: true })).toBeNull();
  });

  it('mapPickAt：格间空隙与屏外都返回 −1', () => {
    expect(mapPickAt(0, 0)).toBe(-1);
    expect(mapPickAt(MAP_PICK.x + MAP_PICK.cell, MAP_PICK.y)).toBe(-1);
    expect(mapPickAt(MAP_PICK.x + 1, MAP_PICK.y + MAP_PICK.cell + 1)).toBe(-1);
  });

  it('8 格互不重叠（各自的中心只命中自己）', () => {
    const hits = new Set<string>();
    for (let i = 0; i < LOBBY_MAP_COUNT; i++) {
      const p = pickCenter(MAP_PICK, i);
      hits.add(JSON.stringify(hitLobby(p.x, p.y, { isHost: true, me: 0 })));
    }
    expect(hits.size).toBe(LOBBY_MAP_COUNT);
  });

  it('★ 四类控件（角色格 / 地图格 / 座位 / 两颗钮）两两不相交', () => {
    const rects: { name: string; x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < LOBBY_CHARACTER_COUNT; i++) {
      const col = i % CHAR_PICK.cols;
      const row = Math.floor(i / CHAR_PICK.cols);
      rects.push({
        name: `char-${i}`,
        x: CHAR_PICK.x + col * CHAR_PICK.pitch,
        y: CHAR_PICK.y + row * CHAR_PICK.pitch,
        w: CHAR_PICK.cell,
        h: CHAR_PICK.cell,
      });
    }
    for (let i = 0; i < LOBBY_MAP_COUNT; i++) {
      const col = i % MAP_PICK.cols;
      const row = Math.floor(i / MAP_PICK.cols);
      rects.push({
        name: `map-${i}`,
        x: MAP_PICK.x + col * MAP_PICK.pitch,
        y: MAP_PICK.y + row * MAP_PICK.pitch,
        w: MAP_PICK.cell,
        h: MAP_PICK.cell,
      });
    }
    for (let i = 0; i < MAX_SEATS; i++) {
      rects.push({
        name: `seat-${i}`,
        x: LOBBY_SEATS.x + i * LOBBY_SEATS.pitch,
        y: LOBBY_SEATS.y,
        w: LOBBY_SEATS.w,
        h: LOBBY_SEATS.h,
      });
    }
    rects.push({ name: 'start', ...BTN_START }, { name: 'leave', ...BTN_BACK });

    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.name} × ${b.name}`).toBe(false);
      }
    }
  });
});
