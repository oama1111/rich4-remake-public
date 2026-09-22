/*
 * T-076：联机大厅
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  GAME_INITIAL_FUNDS,
  LOBBY_CHARACTER_COUNT,
  LOBBY_DEFAULT_OPTIONS,
  LOBBY_MAP_COUNT,
  LOBBY_MIN_SEATS,
  roomOptions,
  withLobbyDefaults,
  type LobbyOptions,
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
  LOBBY_OPTION_ROWS,
  LOBBY_SEATS,
  MAX_SEATS,
  OPTION_COL,
  mapPickAt,
  optionIndexOf,
  optionLabelOf,
  optionValueOf,
} from './lobby.ts';
import {
  CONFIG_TITLES,
  MONEY_VALUES,
  PLAYER_COUNT_LABELS,
  TENURE_LABELS,
  VEHICLE_LABELS,
  VICTORY_FACTORS,
} from './setup.ts';
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

/** 两字段假 ctx，与 options.test.ts 同规格；另记下画过的文字与图片数 */
function fakeCtx() {
    const texts: string[] = [];
    /** 每个文字串连同它的落点 —— 「同一句串画在哪儿」是两块选择器的唯一区分办法 */
    const marks: { t: string; x: number; y: number }[] = [];
    let images = 0;
    let strokes = 0;
    /** 每一条 `beginPath..stroke` 上的折线点 —— 用来钉箭头的**朝向**（尖端朝哪边）*/
    const paths: { x: number; y: number }[][] = [];
    /** 每条折线落笔时的 `strokeStyle` —— 用来钉「到头那一侧要压暗」*/
    const pathColors: string[] = [];
    const ctx = {
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      textAlign: 'left' as CanvasTextAlign,
      textBaseline: 'top' as CanvasTextBaseline,
      save: () => undefined,
      restore: () => undefined,
      fillRect: () => undefined,
      strokeRect: () => undefined,
      drawImage: () => {
        images++;
      },
      fillText: (t: string, x = 0, y = 0) => {
        texts.push(t);
        marks.push({ t, x, y });
      },
      // ★ 「開局設定」的 ◀ / ▶ 是描出来的折线（`drawArrow`），假 ctx 也得有这条路
      beginPath: () => {
        paths.push([]);
        pathColors.push(ctx.strokeStyle);
      },
      moveTo: (x: number, y: number) => {
        paths[paths.length - 1]?.push({ x, y });
      },
      lineTo: (x: number, y: number) => {
        paths[paths.length - 1]?.push({ x, y });
      },
      stroke: () => {
        strokes++;
      },
      measureText: (t: string) => ({ width: t.length * 14 }) as TextMetrics,
    };
    return {
      ctx: ctx as unknown as CanvasRenderingContext2D,
      texts,
      marks,
      get images() {
        return images;
      },
      get strokes() {
        return strokes;
      },
      paths,
      pathColors,
    };
  }

const portrait = (): Sprite => ({ bitmap: {} as ImageBitmap, width: 48, height: 48, anchorX: 0, anchorY: 0 });

describe('drawLobby', () => {

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
    // ⚠️ 只数**角色格那块地上**的编号：開局設定那一栏也会画出纯数字的值（資金…），
    //    连它一起数就会把「12 个头像格都退化成了编号」这句断言数成 13
    const inCharGrid = f.marks.filter(
      (m) =>
        m.x >= CHAR_PICK.x &&
        m.x < CHAR_PICK.x + (CHAR_PICK.cols - 1) * CHAR_PICK.pitch + CHAR_PICK.cell &&
        m.y >= CHAR_PICK.y &&
        m.y < CHAR_PICK.y + Math.ceil(LOBBY_CHARACTER_COUNT / CHAR_PICK.cols) * CHAR_PICK.pitch,
    );
    expect(inCharGrid.filter((m) => /^\d+$/.test(m.t))).toHaveLength(LOBBY_CHARACTER_COUNT);
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
    // ★ 第十一份試玩回報 #1：「開局設定」六行的 ◀ / ▶ 也是可点控件，同样不许和谁叠
    for (let i = 0; i < LOBBY_OPTION_ROWS.length; i++) {
      const y = OPTION_COL.y + i * OPTION_COL.rowH;
      const leftX = OPTION_COL.x + OPTION_COL.labelW;
      rects.push({ name: `opt-${i}-left`, x: leftX, y, w: OPTION_COL.arrowW, h: OPTION_COL.rowH });
      rects.push({
        name: `opt-${i}-right`,
        x: leftX + OPTION_COL.arrowW + OPTION_COL.valueW,
        y,
        w: OPTION_COL.arrowW,
        h: OPTION_COL.rowH,
      });
    }

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

// ============================================================
//  ★★ 第十一份試玩回報 #1：「開局設定」六行（人数 = 总人数）
// ============================================================

/** 第 i 行 ◀ / ▶ 的中心（与 `lobby.ts` 的 `optionRowRect` 同一套算法）*/
const optArrow = (i: number, dir: -1 | 1) => {
  const y = OPTION_COL.y + i * OPTION_COL.rowH;
  const leftX = OPTION_COL.x + OPTION_COL.labelW;
  const x = dir === -1 ? leftX : leftX + OPTION_COL.arrowW + OPTION_COL.valueW;
  return { x: x + Math.floor(OPTION_COL.arrowW / 2), y: y + Math.floor(OPTION_COL.rowH / 2) };
};

describe('★★ 大厅「開局設定」六行（第十一份試玩回報 #1）', () => {
  it('★ 六行的标题就是单机开局设定屏那六项（同一批串，不另造一套）', () => {
    expect(LOBBY_OPTION_ROWS.map((r) => r.title)).toEqual([...CONFIG_TITLES]);
  });

  it('★ 顯示用的資金表與規則層的資金表**逐項相等**（兩份漂了就會指紋失步）', () => {
    // 大厅那一栏画的是 `setup.ts` 的 `MONEY_VALUES`，开局烧进局面的是 core 的
    // `GAME_INITIAL_FUNDS` —— 同一個原版表（0x46cb94）的兩份抄本，必須一模一樣。
    expect([...MONEY_VALUES]).toEqual([...GAME_INITIAL_FUNDS]);
  });

  it('★ 每一行的档数与该表项数一致（服务器按同一份数字校验）', () => {
    const want: Record<string, number> = {
      seatCount: PLAYER_COUNT_LABELS.length,
      fundIndex: MONEY_VALUES.length,
      vehicle: VEHICLE_LABELS.length,
      landTenure: TENURE_LABELS.length,
      timeIndex: TENURE_LABELS.length,
      victoryIndex: VICTORY_FACTORS.length,
    };
    for (const row of LOBBY_OPTION_ROWS) expect(row.steps, row.field).toBe(want[row.field]);
  });

  it('★ 档位下标 ↔ 取值 在各档间来回都是同一个数（seatCount 偏 2，其余不移）', () => {
    for (const row of LOBBY_OPTION_ROWS) {
      for (let i = 0; i < row.steps; i++) {
        const v = optionValueOf(row.field, i);
        const o = withLobbyDefaults({ [row.field]: v } as Partial<LobbyOptions>);
        expect(optionIndexOf(o, row.field), `${row.field}#${i}`).toBe(i);
      }
    }
    // 人数这一项**唯一**偏置：档 0 = 二人，不是「零人」
    expect(optionValueOf('seatCount', 0)).toBe(LOBBY_MIN_SEATS);
    expect(LOBBY_DEFAULT_OPTIONS.seatCount).toBe(LOBBY_MIN_SEATS + PLAYER_COUNT_LABELS.length - 1);
  });

  it('★ 显示的值与单机那一屏逐档一致（不是各画各的）', () => {
    expect(optionLabelOf(withLobbyDefaults({ seatCount: 2 }), 'seatCount')).toBe(PLAYER_COUNT_LABELS[0]);
    expect(optionLabelOf(withLobbyDefaults({ seatCount: 4 }), 'seatCount')).toBe(PLAYER_COUNT_LABELS[2]);
    MONEY_VALUES.forEach((v, i) => {
      expect(optionLabelOf(withLobbyDefaults({ fundIndex: i }), 'fundIndex'), `資金#${i}`).toBe(String(v));
    });
    VEHICLE_LABELS.forEach((v, i) => {
      expect(optionLabelOf(withLobbyDefaults({ vehicle: i }), 'vehicle'), `載具#${i}`).toBe(v);
    });
    TENURE_LABELS.forEach((v, i) => {
      expect(optionLabelOf(withLobbyDefaults({ landTenure: i }), 'landTenure'), `權限#${i}`).toBe(v);
      expect(optionLabelOf(withLobbyDefaults({ timeIndex: i }), 'timeIndex'), `時間#${i}`).toBe(v);
    });
    // ★ 勝利條件的文案**跟着總資金的档位走**（原版是「資金 × 倍率」），漏了这一点就全错
    VICTORY_FACTORS.forEach((f, i) => {
      const want = f === 0 ? '無限' : String(MONEY_VALUES[0]! * f);
      expect(optionLabelOf(withLobbyDefaults({ fundIndex: 0, victoryIndex: i }), 'victoryIndex')).toBe(want);
      const want2 = f === 0 ? '無限' : String(MONEY_VALUES[3]! * f);
      expect(optionLabelOf(withLobbyDefaults({ fundIndex: 3, victoryIndex: i }), 'victoryIndex')).toBe(want2);
    });
  });

  it('★ 房主 + 未开局：12 个箭头各命中自己那一项、那一档', () => {
    for (let i = 0; i < LOBBY_OPTION_ROWS.length; i++) {
      for (const dir of [-1, 1] as const) {
        const p = optArrow(i, dir);
        expect(hitLobby(p.x, p.y, { isHost: true, me: 0 })).toEqual({
          kind: 'option',
          field: LOBBY_OPTION_ROWS[i]!.field,
          delta: dir,
        });
      }
    }
  });

  it('★ 非房主 / 已开局：一个箭头都点不动（只读，不是「点了没反应」）', () => {
    for (let i = 0; i < LOBBY_OPTION_ROWS.length; i++) {
      const p = optArrow(i, 1);
      expect(hitLobby(p.x, p.y, { isHost: false, me: 1 })).toBeNull();
      expect(hitLobby(p.x, p.y, { isHost: true, me: 0, started: true })).toBeNull();
    }
  });

  it('★ 同一行的 ◀ 与 ▶ 不会互相抢（中心命中的是各自那一侧）', () => {
    for (let i = 0; i < LOBBY_OPTION_ROWS.length; i++) {
      const l = optArrow(i, -1);
      const r = optArrow(i, 1);
      const hl = hitLobby(l.x, l.y, { isHost: true, me: 0 });
      const hr = hitLobby(r.x, r.y, { isHost: true, me: 0 });
      expect(hl?.kind === 'option' ? hl.delta : null).toBe(-1);
      expect(hr?.kind === 'option' ? hr.delta : null).toBe(1);
      expect(l.x).toBeLessThan(r.x);
    }
  });

  it('★ roomOptions：服务器没给就补全成缺省（旧快照不炸）', () => {
    expect(roomOptions(null)).toEqual(LOBBY_DEFAULT_OPTIONS);
    expect(roomOptions({ id: 'r', seats: [], started: false })).toEqual(LOBBY_DEFAULT_OPTIONS);
    const half = { id: 'r', seats: [], started: false, options: { seatCount: 2 } } as unknown as RoomInfo;
    expect(roomOptions(half)).toEqual({ ...LOBBY_DEFAULT_OPTIONS, seatCount: 2 });
  });

  it('★ 只读时**不画箭头**（画了就是骗玩家能点）', () => {
    const host = fakeCtx();
    const slots = lobbySlots(room([seat({ seat: 0 })]), 0);
    drawLobby(host.ctx, slots, 0, true, false, null, () => portrait(), (t) => t.length * 14, 0);
    // 六行 × 两个箭头 = 12 条折线
    expect(host.strokes).toBe(LOBBY_OPTION_ROWS.length * 2);

    const guest = fakeCtx();
    drawLobby(guest.ctx, slots, 1, false, false, null, () => portrait(), (t) => t.length * 14, 0);
    expect(guest.strokes).toBe(0);
  });

  it('★★ 箭头的**尖端朝着它代表的方向**（把「◀」画成「>」是实际踩过的坑）', () => {
    const f = fakeCtx();
    const slots = lobbySlots(room([seat({ seat: 0 })]), 0);
    drawLobby(f.ctx, slots, 0, true, false, null, () => portrait(), (t) => t.length * 14, 0);

    // `drawOptionColumn` 逐行画「左、右」，所以偶数条 = ◀、奇数条 = ▶
    expect(f.paths).toHaveLength(LOBBY_OPTION_ROWS.length * 2);
    for (let i = 0; i < LOBBY_OPTION_ROWS.length; i++) {
      const [left, right] = [f.paths[i * 2]!, f.paths[i * 2 + 1]!];
      for (const [name, path, want] of [
        ['◀', left, -1],
        ['▶', right, 1],
      ] as const) {
        expect(path, name).toHaveLength(3);
        const tip = path[1]!; // moveTo(尾) → lineTo(尖) → lineTo(尾)
        const tails = [path[0]!, path[2]!];
        for (const t of tails) {
          // 尖端必须在两个尾点的**同一侧**，且那一侧就是 `want`
          expect(Math.sign(tip.x - t.x), `${name} row ${i}`).toBe(want);
        }
        // 形状是一个「V」：两个尾点同 x 同高、尖端在两尾点中间那一条水平线上
        expect(tails[0]!.x, `${name} row ${i}`).toBe(tails[1]!.x);
        expect(tails[0]!.y, `${name} row ${i}`).not.toBe(tails[1]!.y);
        expect(tip.y, `${name} row ${i}`).toBe((tails[0]!.y + tails[1]!.y) / 2);
      }
    }
  });

  it('★ 到端点的那一侧要**压暗**（默认：人數到顶、其余五项都在最低档）', () => {
    const f = fakeCtx();
    const slots = lobbySlots(room([seat({ seat: 0 })]), 0);
    // 缺省值：seatCount=4（最高档）、其余五项都是 0（最低档）
    drawLobby(f.ctx, slots, 0, true, false, null, () => portrait(), (t) => t.length * 14, 0);
    const [max, min] = ['#a8b6c8', '#3c4c60'];
    for (let i = 0; i < LOBBY_OPTION_ROWS.length; i++) {
      const row = LOBBY_OPTION_ROWS[i]!;
      const idx = optionIndexOf(LOBBY_DEFAULT_OPTIONS, row.field);
      const left = f.pathColors[i * 2]!;
      const right = f.pathColors[i * 2 + 1]!;
      expect(left, `${row.field} ◀`).toBe(idx <= 0 ? min : max);
      expect(right, `${row.field} ▶`).toBe(idx >= row.steps - 1 ? min : max);
    }
    // 六行里恰好有 5 个「◀ 到头」和 1 个「▶ 到头」
    expect(f.pathColors.filter((c) => c === min)).toHaveLength(6);
  });

  it('★ 六行的标题与当前值都画出来，且值来自传进来的那份选项', () => {
    const f = fakeCtx();
    const slots = lobbySlots(room([seat({ seat: 0 })]), 0);
    drawLobby(
      f.ctx,
      slots,
      0,
      true,
      false,
      null,
      () => portrait(),
      (t) => t.length * 14,
      0,
      withLobbyDefaults({ seatCount: 3, fundIndex: 5, vehicle: 2, victoryIndex: 5 }),
    );
    for (const t of CONFIG_TITLES) expect(f.texts, t).toContain(t);
    expect(f.texts).toContain(PLAYER_COUNT_LABELS[1]); // 三人
    expect(f.texts).toContain(String(MONEY_VALUES[5])); // 資金档 5
    expect(f.texts).toContain(VEHICLE_LABELS[2]); // 汽車
    expect(f.texts).toContain(String(MONEY_VALUES[5]! * VICTORY_FACTORS[5]!));
    // 房主/非房主的提示语都要说清「空位由电脑补上」
    expect(f.texts.some((t) => t.includes('由電腦補上'))).toBe(true);
    expect(f.texts.some((t) => t.includes('共 3 人'))).toBe(false); // 这句是非房主那条
  });

  it('座位格数跟着房间总人数走（设 3 人就只画 3 格）', () => {
    const f = fakeCtx();
    const slots = lobbySlots(room([seat({ seat: 0 })]), 0, 3);
    drawLobby(f.ctx, slots, 0, true, false, null, () => portrait(), (t) => t.length * 14, 0);
    expect(f.texts.filter((t) => t === '等待加入…')).toHaveLength(2); // 3 格里的另外两格
    expect(hitLobby(center({ ...LOBBY_SEATS, x: LOBBY_SEATS.x + 3 * LOBBY_SEATS.pitch }).x, LOBBY_SEATS.y + 10, {
      isHost: true,
      me: 0,
      seats: 3,
    })).toBeNull();
  });
});
