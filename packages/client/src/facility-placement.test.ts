/*
 * ★★ 第 24 份试玩回报（`20260924-181902557`）「公园好像没有放到地块的居中位置，别的地图也有」——
 *   **八张地图 × 每一块商業用地 × 五种設施的每一级（含等级 0 的空地 logo）× 八个视角 × 几处镜头**，
 *   逐件拿本引擎的落点（`buildingArtItems` → `worldToScreen` − 精灵锚点）对 **exe 公式**（本文件独立重写，
 *   直接读 `rich4.exe` 的投影表 / 亚格矩阵与 `map.mkf` 的原始记录头，不经本引擎的解析器）。
 *
 * @source exe 的設施那一段 `fcn_0040829d` 0x004092f4..0x004094c2：
 *   - 记录表 `[0x498e88]`（= 地图资源 + `[+0x14]`，0x00407c76），从 1 号起、每条 0x38（0x004092fc）；
 *   - 块 = `x >> 5 − 镜头块 + 0xe`（0x0040930e..0x0040932b），越出 0..0x1c 不画；
 *   - `0x407a2c(x, y)` 块内余量过矩阵 `[0x474910 + 视角*4]`（0x00407a2c..0x00407a87）；
 *   - 屏幕 X = 表`[0x46ccf2 + 视角*0xd24 + 行*0x74 + 列*4]` − 余量 + 镜头项（0x00409378..0x00409389），Y 同理用 `+0x46ccf0`；
 *     镜头项 = `0x407a2c(镜头)` + (0xdc, 0x104)（0x004083cc / 0x004083e1 / 0x004083e9）；
 *   - 等级 0：有主 → `map.mkf` #25、图号 = 主人角色（0x00409464..0x0040947e），无主不画（0x00409486）；
 *     等级 ≥ 1：图号 `(8 − (+0x1b + 视角)) & 7`（0x004093c3..0x004093d0），资源按 `+0x18` 走跳转表 0x408289
 *     （0 → 槽 0，1 → 槽 level，2 → 槽 5+level，3 → 槽 11，4 → 槽 11+level），槽 i = 资源 `基 + i`
 *     （基 = 关卡 0 ? 0x57 : 地图*17 + 0x68，0x00407e71）；
 *   - 贴图 `0x456770(面, 资源, 图, X, Y)`：左上 = (X − 记录头 +4, Y − 记录头 +6)（0x0045679b..0x004567a6），
 *     记录头在 `资源 + 0xc + 图*12`（0x00456782..0x0045678f）。**没有**按设施另加的偏移表。
 *
 * 结论：设施落点 = 记录 x/y（本身就在地块框正中，见下一例），精灵锚点照原图 —— 与 exe 逐像素相同；
 *   「偏左」是原版精灵锚点自带的（建筑图普遍锚在 `宽/2 + 4` 左右），不是本引擎摆错。
 *   扫描查出的唯一差别是整块棋盘的投影中心 x 差半像素（棋盘区 439 宽，`w / 2` = 219.5 ≠ 0xdc），已修（`boardCenter`）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { makeGameState, makePlayer, parseMap } from '@rich4/core';
import { MkfArchive, parseSpriteSheet } from '../../assets-pipeline/src/mkf.ts';
import { buildingArtItems, pixelCamera, worldToScreen } from './render.ts';
import { LAYOUT } from './stage.ts';

const WS = process.env.RICH4_WORKSPACE ?? '';
const EXE = WS + '/Rich4/rich4.exe';
const MAP_MKF = WS + '/Rich4/map.mkf';
const d = existsSync(EXE) && existsSync(MAP_MKF) ? describe : describe.skip;

/** DGROUP 映射（同 `data/src/binary-truth.test.ts`）*/
const DGROUP_VA = 0x463000;
const DGROUP_OFF = 398848;
const off = (va: number): number => DGROUP_OFF + (va - DGROUP_VA);

interface Exe {
  /** 投影表项：视角 v、行 r、列 c → 屏幕偏移 (x, y)（内存序 Y 在前）*/
  cell(v: number, r: number, c: number): { x: number; y: number };
  /** `fcn_00407a2c` */
  sub(v: number, x: number, y: number): { x: number; y: number };
}

function loadExe(): Exe {
  const exe = readFileSync(EXE);
  const table = off(0x46ccf0);
  const matrix = off(0x474910);
  return {
    cell: (v, r, c) => {
      const at = table + v * 0xd24 + r * 0x74 + c * 4;
      return { x: exe.readInt16LE(at + 2), y: exe.readInt16LE(at) };
    },
    sub: (v, x, y) => {
      const dx = x & 0x1f;
      const dy = y & 0x1f;
      const m = (k: number): number => exe.readInt8(matrix + v * 4 + k);
      return { x: ((m(0) * dx) >> 5) + ((m(2) * dy) >> 5), y: ((m(1) * dx) >> 5) + ((m(3) * dy) >> 5) };
    },
  };
}

/** 原始地图资源里的设施记录（exe 自己读的那几个字节，不经 `parseMap`）*/
function rawFacilities(data: Uint8Array): { id: number; x: number; y: number; facing: number }[] {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = v.getUint32(0x10, true);
  const base = v.getUint32(0x14, true);
  const out = [];
  for (let i = 1; i <= count; i++) {
    const o = base + i * 0x38;
    out.push({ id: i, x: v.getInt16(o, true), y: v.getInt16(o + 2, true), facing: data[o + 0x1b]! });
  }
  return out;
}

/** 精灵记录头 +4 / +6（`0x456770` 减的那一对）*/
function anchorOf(mkf: MkfArchive, res: number, img: number): { x: number; y: number } {
  const b = mkf.read(res);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const t = 0xc + img * 12;
  return { x: v.getInt16(t + 4, true), y: v.getInt16(t + 6, true) };
}

/** exe 的设施槽（跳转表 0x408289 五路）*/
function exeSlot(type: number, level: number): number {
  return [0, level, 5 + level, 11, 11 + level][type]!;
}

/** 五种设施各自走得到的等级（槽不越出 17 张）*/
const COMBOS: { type: number; level: number }[] = [
  { type: 0, level: 1 },
  ...[1, 2, 3, 4, 5].map((level) => ({ type: 1, level })),
  ...[1, 2, 3, 4, 5].map((level) => ({ type: 2, level })),
  { type: 3, level: 1 },
  ...[1, 2, 3, 4, 5].map((level) => ({ type: 4, level })),
  // 等级 0（有主空地 logo）
  { type: 0, level: 0 },
];

d('★★ 設施落点：八张地图 × 每块商業用地 × 每种每级 × 八视角，对 exe 公式逐像素', () => {
  const exe = loadExe();
  const mkf = new MkfArchive(new Uint8Array(readFileSync(MAP_MKF)));
  const vp = { w: LAYOUT.board.w, h: LAYOUT.board.h };
  const sheets = new Map<number, ReturnType<typeof parseSpriteSheet> & object>();
  const ourSheet = (res: number) => {
    let sh = sheets.get(res);
    if (sh === undefined) {
      sh = parseSpriteSheet(mkf.read(res))!;
      sheets.set(res, sh);
    }
    return sh;
  };
  const anchors = new Map<string, { x: number; y: number }>();
  const exeAnchor = (res: number, img: number) => {
    const k = `${res}/${img}`;
    let a = anchors.get(k);
    if (a === undefined) {
      a = anchorOf(mkf, res, img);
      anchors.set(k, a);
    }
    return a;
  };

  it('★ 扫描全表：落点与图完全一致（含镜头的块内余量；棋盘投影中心 = (0xdc, 0x104)）', () => {
    let checked = 0;
    const mismatches: string[] = [];
    for (let gid = 0; gid < 8; gid++) {
      const raw = mkf.read(gid * 2 + 1);
      const map = parseMap(raw);
      const facs = rawFacilities(raw);
      expect(facs.length, `地图 ${gid}`).toBe(map.facilities.length);
      const base = gid >> 2 === 0 ? 0x57 : (gid & 3) * 17 + 0x68;
      for (const f of facs) {
        for (const { type, level } of COMBOS) {
          const n = map.facilities.length + 1;
          const state = makeGameState({
            globalMapId: gid,
            players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: (i * 3 + 1) % 12 })),
            facilityType: Array.from({ length: n }, (_, i) => (i === f.id ? type : 0)),
            facilityLevel: Array.from({ length: n }, (_, i) => (i === f.id ? level : 0)),
            facilityOwner: Array.from({ length: n }, (_, i) => (i === f.id ? 2 : 0)),
          });
          for (let v = 0; v < 8; v++) {
            const item = buildingArtItems(map, state, v).find((it) => it.facilityId === f.id);
            // exe：资源 / 图号
            const res = level === 0 ? 25 : base + exeSlot(type, level);
            const img = level === 0 ? state.players[1]!.character : (8 - ((f.facing + v) & 0xff)) & 7;
            if (item === undefined || item.res !== res || item.img !== img) {
              mismatches.push(`地图${gid} 設施${f.id} type${type} lv${level} 视角${v}：图 ${item?.res}/${item?.img} ≠ ${res}/${img}`);
              continue;
            }
            const a = exeAnchor(res, img);
            for (const [cx, cy] of [[f.x, f.y], [f.x + 37, f.y - 53], [f.x - 150, f.y + 91]] as const) {
              // exe
              const camTx = cx >> 5;
              const camTy = cy >> 5;
              const cam = exe.sub(v, cx, cy);
              const col = (f.x >> 5) - camTx + 0xe;
              const row = (f.y >> 5) - camTy + 0xe;
              if (col < 0 || col > 0x1c || row < 0 || row > 0x1c) continue;
              const t = exe.cell(v, row, col);
              const p = exe.sub(v, f.x, f.y);
              const ex = 0xdc + cam.x + t.x - p.x - a.x;
              const ey = 0x104 + cam.y + t.y - p.y - a.y;
              // 本引擎
              const s = worldToScreen(item.x, item.y, pixelCamera(cx, cy, v), vp);
              if (s === null) {
                mismatches.push(`地图${gid} 設施${f.id} 视角${v}：本引擎没画`);
                continue;
              }
              // 本引擎的锚点来自自己的解析器（`parseSpriteSheet`，资源管线 / 客户端同一个）
              const g = ourSheet(item.res).images[item.img]!;
              const ours = { x: LAYOUT.board.x + s.x - g.x, y: LAYOUT.board.y + s.y - g.y };
              checked++;
              if (ours.x !== ex || ours.y !== ey) {
                mismatches.push(`地图${gid} 設施${f.id} type${type} lv${level} 视角${v} 镜头(${cx},${cy})：(${ours.x},${ours.y}) ≠ exe (${ex},${ey})`);
              }
            }
          }
        }
      }
    }
    expect(mismatches.slice(0, 20)).toEqual([]);
    expect(checked).toBeGreaterThan(10_000);
  });

  it('★ 设施记录的 x/y 就在地块框正中（底图上那圈青色虚线）—— 抽查美国图拉斯維加斯（回报现场那一块）', () => {
    // 回报现场：地图 3、設施 3 (577,1368)；底图该处青色框实测 x 531..621、y 1320..1412（中心 (576,1366)）
    const map = parseMap(mkf.read(3 * 2 + 1));
    const f = map.facilities.find((x) => x.id === 3)!;
    expect([f.x, f.y]).toEqual([577, 1368]);
    // 公園（type 0）视角 0 的图：锚点 (60,24) 在 100×67 的图里偏右上 ⇒ 画出来整体偏左下约 (−10,+10) —— 原版如此
    const img = (8 - (f.facing + 0)) & 7;
    expect(img).toBe(4);
    expect(anchorOf(mkf, 0x57, img)).toEqual({ x: 60, y: 24 });
  });
});
