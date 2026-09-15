/*
 * T-085：開局設定屏（選角色／選地圖）照汇编重做
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这里钉的都是**从 exe 里读出来的常数与算式**，不是照着截图量的：
 * 表格 @ 0x46cc18 / 0x46cc88 / 0x46ccb8 / 0x46cc80 / 0x46cb58 / 0x46cb94 ，
 * 命中算式 @ 0x0040519c / 0x004052f6 / 0x0040525f 。
 */
import { describe, expect, it } from 'vitest';
import {
  CONTROL_RECTS,
  POPUP_IMAGES,
  POPUP_RECTS,
  POPUP_ROW_H,
  PANEL,
  SEAT_X,
  SETUP_NAMES,
  TICK_X,
  TICK_Y,
  characterAt,
  defaultSetup,
  fillComputerSeats,
  hitSetup,
  menuItems,
  menuValue,
  popupItemAt,
  setupDown,
  setupMove,
  setupUp,
  type SetupState,
} from './setup.ts';
import {
  SETUP_UI,
  SETUP_WALK_FRAMES,
  decodeSetupScene,
  setupWalkResource,
} from './assets.ts';

/** 选满 n 个人（按座位顺序挑第 0、1、2…个角色） */
function seated(n: number, playerCount = 4): SetupState {
  let s: SetupState = { ...defaultSetup(), playerCount };
  for (let i = 0; i < n; i++) s = setupDown(s, cellCenter(i).x, cellCenter(i).y);
  return s;
}

/** 第 i 个角色格的中心（屏幕坐标） */
function cellCenter(i: number): { x: number; y: number } {
  return {
    x: CONTROL_RECTS[0]!.x + (i % 6) * 72 + 36,
    y: CONTROL_RECTS[0]!.y + Math.floor(i / 6) * 72 + 36,
  };
}

describe('开局设定的摆位表（照抄 exe）', () => {
  it('★ 十三条控件就是 0x46cc18 那张表', () => {
    expect(CONTROL_RECTS).toHaveLength(13);
    expect(CONTROL_RECTS[0]).toEqual({ x: 8, y: 15, w: 432, h: 144 }); // 角色格
    expect(CONTROL_RECTS[1]).toEqual({ x: 456, y: 176, w: 79, h: 39 }); // OK
    expect(CONTROL_RECTS[2]).toEqual({ x: 544, y: 176, w: 79, h: 39 }); // EXIT
    // 六条下拉的蓝三角：x 固定 602、纵距 36
    expect(CONTROL_RECTS.slice(3, 9).map((r) => r.y)).toEqual([226, 262, 298, 334, 370, 406]);
    expect(CONTROL_RECTS.slice(3, 9).every((r) => r.x === 602 && r.h === 24)).toBe(true);
    // 四行地图：x 固定 457、纵距 32
    expect(CONTROL_RECTS.slice(9).map((r) => r.y)).toEqual([31, 63, 95, 127]);
    expect(CONTROL_RECTS.slice(9).every((r) => r.x === 457 && r.w === 168)).toBe(true);
  });

  it('★ 六个浮窗矩形与底图就是 0x46cc88 / 0x46ccb8 那两张表', () => {
    expect(POPUP_RECTS).toEqual([
      { x: 561, y: 251, r: 602, b: 320 }, // 遊戲人數：三行，向下弹
      { x: 536, y: 287, r: 602, b: 425 }, // 總資金：六行，向下弹
      { x: 561, y: 323, r: 602, b: 392 }, // 行進方式：三行
      { x: 536, y: 195, r: 602, b: 333 }, // 土地權限：六行，**向上弹**
      { x: 536, y: 231, r: 602, b: 369 }, // 遊戲時間：向上弹
      { x: 516, y: 267, r: 602, b: 405 }, // 勝利條件：最宽，向上弹
    ]);
    expect(POPUP_IMAGES).toEqual([5, 6, 5, 6, 6, 7]);
    expect(POPUP_ROW_H).toBe(0x17);
    // 每个浮窗的高度都要装得下它的行数
    for (let m = 0; m < 6; m++) {
      const rows = (POPUP_RECTS[m]!.b - POPUP_RECTS[m]!.y) / POPUP_ROW_H;
      expect(rows).toBe(Math.floor(rows));
      expect(menuItems(defaultSetup(), m)).toHaveLength(rows);
    }
  });

  it('★ 红勾的纵向锚点 = 各行上沿 − 1（0x46cc80），横锚 = 勾选框左沿', () => {
    expect(TICK_Y).toEqual([20, 52, 84, 116]);
    for (let i = 0; i < 4; i++) expect(TICK_Y[i]).toBe(CONTROL_RECTS[9 + i]!.y - 11);
    expect(TICK_X).toBe(0x96);
    // 竖栏在屏幕 (445,10)：红勾因此落在屏幕 (595, 30/62/94/126)，
    // 而勾选框在图里是竖栏内的 (147..176, 26..43)+32i —— 两者对得上。
    expect(PANEL.x + TICK_X).toBe(595);
  });

  it('★ 图号按「表项从 +0xc 起、每条 12 字节」算 —— 红勾是 8、三角按下图是 4', () => {
    // `a3b8 + 0x6c` → (0x6c − 0xc) / 12 = 8；`a3b8 + 0x3c` → 4；`a3b8 + 0x78` → 9
    expect(SETUP_UI.tick).toBe((0x6c - 0xc) / 12);
    expect(SETUP_UI.arrowDown).toBe((0x3c - 0xc) / 12);
    expect(SETUP_UI.characterOut).toBe((0x78 - 0xc) / 12);
  });

  it('★ 座位落点 = 0x46cb58（人数 − 2 那一档），第一个点中的在最右', () => {
    expect(SEAT_X[0]!.slice(0, 2)).toEqual([330, 110]);
    expect(SEAT_X[1]!.slice(0, 3)).toEqual([366, 220, 74]);
    expect(SEAT_X[2]!).toEqual([385, 275, 165, 55]);
    // 人数越多越往左铺开
    for (const row of SEAT_X) {
      for (let i = 1; i < row.length; i++) {
        if (row[i] !== 0) expect(row[i]!).toBeLessThan(row[i - 1]!);
      }
    }
  });

  it('角色名与 0x47e80c 那张表一致（含排版用的全角空格）', () => {
    expect(SETUP_NAMES).toHaveLength(12);
    expect(SETUP_NAMES[0]).toBe('約 翰 喬');
    expect(SETUP_NAMES[1]).toBe('沙隆巴斯');
    expect(SETUP_NAMES[10]).toBe('小 丹 尼');
  });
});

describe('命中', () => {
  it('角色格：行 = (y−15)/72、列 = (x−8)/72，下标 = 行×6 + 列', () => {
    expect(characterAt(8, 15)).toBe(0);
    expect(characterAt(8 + 71, 15 + 71)).toBe(0);
    expect(characterAt(8 + 72, 15)).toBe(1);
    expect(characterAt(8, 15 + 72)).toBe(6);
    expect(characterAt(8 + 5 * 72, 15 + 72)).toBe(11);
    // 出界
    expect(characterAt(7, 15)).toBe(-1);
    expect(characterAt(440, 15)).toBe(-1);
    expect(characterAt(8, 159)).toBe(-1);
  });

  it('十三条控件与浮窗行', () => {
    expect(hitSetup(470, 190, defaultSetup())).toEqual({ kind: 'ok' });
    expect(hitSetup(560, 190, defaultSetup())).toEqual({ kind: 'exit' });
    expect(hitSetup(610, 230, defaultSetup())).toEqual({ kind: 'config', menu: 0 });
    expect(hitSetup(610, 410, defaultSetup())).toEqual({ kind: 'config', menu: 5 });
    expect(hitSetup(460, 35, defaultSetup())).toEqual({ kind: 'map', index: 0 });
    expect(hitSetup(460, 130, defaultSetup())).toEqual({ kind: 'map', index: 3 });
    expect(hitSetup(300, 300, defaultSetup())).toBeNull();
  });

  it('浮窗弹开时优先吃点击，行号 = (y−上沿)/23', () => {
    const open: SetupState = { ...defaultSetup(), openMenu: 1 };
    expect(popupItemAt(1, 560, 288)).toBe(0);
    expect(popupItemAt(1, 560, 288 + 5 * 23)).toBe(5);
    expect(popupItemAt(1, 560, 288 + 6 * 23)).toBe(-1); // 越界
    expect(popupItemAt(1, 500, 288)).toBe(-1); // 浮窗左边
    expect(hitSetup(560, 288 + 2 * 23, open)).toEqual({ kind: 'popupItem', menu: 1, item: 2 });
  });
});

describe('点选座位', () => {
  it('点一个角色 → 占掉一个座位、记成真人；再点一次 → 退掉', () => {
    let s = setupDown(defaultSetup(), cellCenter(3).x, cellCenter(3).y);
    expect(s.characters).toEqual([3]);
    expect(s.human).toEqual([true]);
    s = setupDown(s, cellCenter(3).x, cellCenter(3).y);
    expect(s.characters).toEqual([]);
  });

  it('★ 座位按**点中的先后**排，满了就不再收（多出来的点无视）', () => {
    let s = seated(4);
    expect(s.characters).toEqual([0, 1, 2, 3]);
    s = setupDown(s, cellCenter(7).x, cellCenter(7).y);
    expect(s.characters).toEqual([0, 1, 2, 3]);
  });

  it('退掉中间一个，后面的往前挪', () => {
    let s = seated(3); // [0,1,2]
    s = setupDown(s, cellCenter(1).x, cellCenter(1).y);
    expect(s.characters).toEqual([0, 2]);
  });

  it('★ 点 OK 时剩下的座位补成電腦，角色不重复', () => {
    const s = fillComputerSeats(seated(2), () => 0);
    expect(s.characters).toHaveLength(4);
    expect(s.human).toEqual([true, true, false, false]);
    expect(new Set(s.characters).size).toBe(4);
  });

  it('人数调小 → 多出来的座位连同角色一起退掉', () => {
    let s = seated(4);
    s = setupDown(s, 610, 230); // 按开「遊戲人數」
    s = setupUp(s);
    expect(s.openMenu).toBe(0);
    s = setupDown(s, 570, 255); // 选第一行 = 二人
    expect(s.playerCount).toBe(2);
    expect(s.characters).toEqual([0, 1]);
  });
});

describe('六条下拉', () => {
  it('★ 按下只记状态，抬手才弹开', () => {
    const down = setupDown(defaultSetup(), 610, 230);
    expect(down.pressed).toBe(3);
    expect(down.openMenu).toBe(-1);
    const up = setupUp(down);
    expect(up.pressed).toBe(-1);
    expect(up.openMenu).toBe(0);
  });

  it('★ 选中一行就落值，并把浮窗收掉', () => {
    let s: SetupState = { ...defaultSetup(), openMenu: 2, hoverItem: 1 };
    s = setupDown(s, 570, 323 + 23); // 行進方式第 2 行 = 機車
    expect(s.vehicle).toBe(1);
    expect(s.openMenu).toBe(-1);
  });

  it('点到浮窗外面 = 只收浮窗、不改值', () => {
    const s: SetupState = { ...defaultSetup(), openMenu: 2, vehicle: 0 };
    const after = setupDown(s, 300, 300);
    expect(after.vehicle).toBe(0);
    expect(after.openMenu).toBe(-1);
  });

  it('六条的值就是 exe 里那六张表', () => {
    const d = defaultSetup();
    expect(menuItems(d, 0)).toEqual(['二人', '三人', '四人']);
    expect(menuItems(d, 1)).toEqual(['300000', '200000', '100000', '50000', '30000', '10000']);
    expect(menuItems(d, 2)).toEqual(['步行', '機車', '汽車']);
    expect(menuItems(d, 3)).toEqual(['無限期', '二年', '一年', '六個月', '三個月', '一個月']);
    expect(menuItems(d, 4)).toEqual(menuItems(d, 3));
    // 勝利條件 = 初始资金 × 倍率，0 那一档写「無限」
    expect(menuItems({ ...d, money: 1 }, 5)).toEqual([
      '無限',
      '20000000',
      '10000000',
      '2000000',
      '1000000',
      '600000',
    ]);
  });

  it('★ 开局默认值照原版：四人 / 20 万 / 步行 / 無限期 / 無限', () => {
    const d = defaultSetup();
    expect(d.playerCount).toBe(4);
    expect(menuValue(d, 0)).toBe(2);
    expect(menuValue(d, 1)).toBe(1); // 200000
    expect(menuItems(d, 1)[menuValue(d, 1)]).toBe('200000');
    expect(menuValue(d, 2)).toBe(0); // 步行
    expect(menuValue(d, 3)).toBe(0);
    expect(menuValue(d, 4)).toBe(0);
    expect(menuItems(d, 5)[menuValue(d, 5)]).toBe('無限');
  });
});

describe('地图与鼠标', () => {
  it('★ 点地图行只换**本舞台内**的图，不动舞台', () => {
    const s = { ...defaultSetup(), mapId: 1 };
    expect(setupDown(s, 460, 130).mapId).toBe(3); // 舞台 0 的第 4 张
    const s2 = { ...defaultSetup(), mapId: 5 }; // 舞台 1
    expect(setupDown(s2, 460, 35).mapId).toBe(4); // 舞台 1 的第 1 张
  });

  it('悬停角色格会记住格子号，移开就清掉', () => {
    const s = setupMove(defaultSetup(), cellCenter(8).x, cellCenter(8).y);
    expect(s.hover).toBe(8);
    expect(setupMove(s, 300, 300).hover).toBe(-1);
  });
});

describe('素材换算', () => {
  it('★ 场景亮度压一半：每个 5 位分量除以 2（0x485b68 那张表）', () => {
    // 一个像素：R=31 G=31 B=31 → 半亮后 R=15 G=15 B=15
    const data = new Uint8Array(640 * 480 * 2);
    data[0] = 0xff;
    data[1] = 0x7f; // 0x7fff = 全白
    const rgba = decodeSetupScene(data)!;
    expect(rgba).not.toBeNull();
    // 31 → 15（除以 2 取整），再按全项目的 expand5 展开：(15<<3)|(15>>2) = 123
    expect(rgba[0]).toBe(123);
    expect(rgba[1]).toBe(123);
    expect(rgba[2]).toBe(123);
    expect(rgba[3]).toBe(255);
    expect(decodeSetupScene(new Uint8Array(10))).toBeNull();
  });

  it('走动图号 = 9 + 角色×3 + 载具，帧数表 36 条', () => {
    expect(setupWalkResource(0, 0)).toBe(9);
    expect(setupWalkResource(0, 2)).toBe(11);
    expect(setupWalkResource(11, 2)).toBe(44);
    expect(SETUP_WALK_FRAMES).toHaveLength(36);
    expect(SETUP_WALK_FRAMES.every((n) => n > 0)).toBe(true);
  });
});
