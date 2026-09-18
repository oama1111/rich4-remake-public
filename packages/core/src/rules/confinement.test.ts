/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 监狱与医院 —— 以 VA 0x0043d593 / 0x0043ec3f 为准
 */

import { describe, expect, it } from 'vitest';
import { makeNode, makePlayer } from '../testing/factories.ts';
import { makeObjects } from '../cards/summon.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { RELEASE_PENDING, tickBlockingCounter } from './blocking.ts';
import {
  CONFINEMENT_SLOTS,
  KNOWN_PRISON_DAYS,
  OBJECT_SLOT_BASE,
  anyPlayerConfined,
  anyoneConfined,
  confine,
  isReleasePending,
  release,
  sendToConfinement,
} from './confinement.ts';

const four = () => [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
const empty = () => new Array<number>(CONFINEMENT_SLOTS).fill(0);

describe('送进去', () => {
  it('监狱：写计数字段并置占用表', () => {
    const r = confine(four(), empty(), 'prison', 2, 5);
    expect(r.players[2]!.blocking.inPrison).toBe(5);
    expect(r.occupancy[2]).toBe(1);
    expect(r.extended).toBe(false);
  });

  it('医院：走同一套，只是字段不同', () => {
    const r = confine(four(), empty(), 'hospital', 1, 3);
    expect(r.players[1]!.blocking.inHospital).toBe(3);
    expect(r.players[1]!.blocking.inPrison).toBe(0);
    expect(r.occupancy[1]).toBe(1);
  });

  it('不影响其他玩家', () => {
    const r = confine(four(), empty(), 'prison', 2, 5);
    expect(r.players.map((p) => p.blocking.inPrison)).toEqual([0, 0, 5, 0]);
  });
});

describe('★ 加刑：已在里面则累加', () => {
  it('累加而非覆盖', () => {
    const ps = four();
    ps[2] = makePlayer({ index: 2, blocking: { ...ps[2]!.blocking, inPrison: 3 } });
    const r = confine(ps, empty(), 'prison', 2, 4);
    expect(r.extended).toBe(true);
    expect(r.days).toBe(7);
  });

  it('★ 累加结果与 0x7f 相与，防止进位误置「待释放」位', () => {
    const ps = four();
    ps[2] = makePlayer({ index: 2, blocking: { ...ps[2]!.blocking, inPrison: 0x7e } });
    // 0x7e + 5 = 0x83；& 0x7f = 0x03
    const r = confine(ps, empty(), 'prison', 2, 5);
    expect(r.days).toBe(0x03);
    expect(r.days & RELEASE_PENDING).toBe(0);
  });

  it('新判则直接赋值，不做掩码', () => {
    const r = confine(four(), empty(), 'prison', 2, 0x7e);
    expect(r.days).toBe(0x7e);
    expect(r.extended).toBe(false);
  });
});

describe('占用表', () => {
  it('槽位 8 个，0..3 玩家、4..7 物件', () => {
    expect(CONFINEMENT_SLOTS).toBe(8);
    expect(OBJECT_SLOT_BASE).toBe(4);
  });

  it('★ 无人在押时 anyoneConfined 为 false —— 探监机制的判据', () => {
    expect(anyoneConfined(empty())).toBe(false);
  });

  it('有人在押即为 true', () => {
    const r = confine(four(), empty(), 'prison', 2, 5);
    expect(anyoneConfined(r.occupancy)).toBe(true);
  });

  it('释放后清空该槽位', () => {
    const r = confine(four(), empty(), 'prison', 2, 5);
    const after = release(r.occupancy, 2);
    expect(after[2]).toBe(0);
    expect(anyoneConfined(after)).toBe(false);
  });

  it('物件占用也算「有人在押」', () => {
    const occ = empty();
    occ[OBJECT_SLOT_BASE] = 1;
    expect(anyoneConfined(occ)).toBe(true);
  });

  // ★ 簇 A / N-A5：落点与新闻的扫描宽度**不同**，必须用两个谓词。
  //   落点 `0x0043d30e`–`0x0043d324` 逐槽扫 **8** 个；
  //   新闻 `0x00448c99` / `0x00448cab` 是 `cmp dword [0x496b30], 0`，一次比 **4 字节**。
  describe('★ 落点扫 8 槽、新闻只扫槽 0..3（原版判据宽度不同）', () => {
    it('只有物件槽被占用时：落点=true、新闻=false', () => {
      const occ = empty();
      occ[OBJECT_SLOT_BASE] = 1;
      occ[OBJECT_SLOT_BASE + 1] = 1;
      // 落点：扫完 8 槽才发现有人 ⇒ 该给保释窗口
      expect(anyoneConfined(occ)).toBe(true);
      // 新闻：`cmp dword` 只看槽 0..3 ⇒ 认为"没人在押"，不该出越狱/逃院消息
      expect(anyPlayerConfined(occ)).toBe(false);
    });

    it('玩家槽被占用时两者都为 true', () => {
      const occ = empty();
      occ[1] = 1;
      expect(anyoneConfined(occ)).toBe(true);
      expect(anyPlayerConfined(occ)).toBe(true);
    });

    it('全空时两者都为 false', () => {
      expect(anyoneConfined(empty())).toBe(false);
      expect(anyPlayerConfined(empty())).toBe(false);
    });
  });
});

// ★ P4：首次关押必须先清掉"别的"阻碍状态。
//   原版首次分支先 `call 0x40d761`（@source 0x0043d5e7），该函数——
//     · 若 `p+0x34`(inPrison) 非 0 → 清监狱占用表并释放（`0x0040d774`）
//     · 若 `p+0x35`(inHospital) 非 0 → 清医院占用表并释放（`0x0040d793`）
//     · 最后 `mov dword ptr [ebx+0x496b9a], 0` 把 +0x32..+0x35 **四项整体清零**（`0x0040d7a9`）
//   而**加刑**路径（`0x0043d5dc jne`）**不**走这一套。
describe('★ 首次关押清掉其它阻碍状态（P4）', () => {
  it('住院中被判入狱：医院计数清零 + 医院占用表清零 + 四项整体清零', () => {
    const ps = four().map((p, i) =>
      i === 0 ? { ...p, blocking: { ...p.blocking, inHospital: 3, inHotel: 2 } } : p,
    );
    const prison = empty();
    const hospital = empty();
    hospital[0] = 1; // 0 号正在住院

    const r = confine(ps, prison, 'prison', 0, 5, hospital);

    expect(r.players[0]!.blocking.inPrison).toBe(5); // 新状态
    expect(r.players[0]!.blocking.inHospital).toBe(0); // ★ 医院计数被清
    expect(r.players[0]!.blocking.inHotel).toBe(0); // ★ 住宿也被清（四项整体清零）
    expect(r.players[0]!.blocking.disappearing).toBe(0);
    expect(r.occupancy[0]).toBe(1); // 监狱表置位
    expect(r.otherOccupancy![0]).toBe(0); // ★ 医院表被清
  });

  it('★ 加刑路径**不**清其它状态（原版 jne 跳过 0x40d761）', () => {
    const ps = four().map((p, i) =>
      i === 0 ? { ...p, blocking: { ...p.blocking, inPrison: 2, inHotel: 4 } } : p,
    );
    const prison = empty();
    prison[0] = 1;
    const hospital = empty();
    hospital[0] = 1;

    const r = confine(ps, prison, 'prison', 0, 3, hospital);

    expect(r.extended).toBe(true);
    expect(r.players[0]!.blocking.inPrison).toBe(5); // (2+3)
    expect(r.players[0]!.blocking.inHotel).toBe(4); // ★ 保持不动
    expect(r.otherOccupancy![0]).toBe(1); // ★ 另一张表也不动
  });

  it('不传 otherOccupancy 时行为与从前一致（向后兼容）', () => {
    const r = confine(four(), empty(), 'prison', 1, 4);
    expect(r.players[1]!.blocking.inPrison).toBe(4);
    expect(r.otherOccupancy).toBeUndefined();
  });
});

describe('★ 与递减流程接得上', () => {
  it('关 3 天 → 第 4 次推进才放人', () => {
    let v = confine(four(), empty(), 'prison', 0, 3).players[0]!.blocking.inPrison;
    const releases: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const out = tickBlockingCounter(v);
      v = out.value;
      releases.push(out.release);
    }
    expect(releases).toEqual([false, false, false, true]);
  });

  it('isReleasePending 认出待释放状态', () => {
    const ps = four();
    ps[1] = makePlayer({ index: 1, blocking: { ...ps[1]!.blocking, inPrison: RELEASE_PENDING } });
    expect(isReleasePending(ps[1]!, 'prison')).toBe(true);
    expect(isReleasePending(ps[1]!, 'hospital')).toBe(false);
  });
});

describe('已知刑期', () => {
  it('★ 陷害自己 4 天、害别人 5 天', () => {
    expect(KNOWN_PRISON_DAYS.self).toBe(4);
    expect(KNOWN_PRISON_DAYS.other).toBe(5);
    expect(KNOWN_PRISON_DAYS.self).toBeLessThan(KNOWN_PRISON_DAYS.other);
  });
});

// ============================================================
//  ★ 本次补（2026-09-18）：送入监狱/医院累加「本月倒楣天數」 +0x42
// ============================================================

/**
 * 原版两处公共尾部各有一句 8 位加法，**新判与加刑都走得到**：
 * ```
 * 0043d755  add byte ptr [esi + 0x496baa], al   ; 监狱（0x43d593 的尾部）
 * 0043ee04  add byte ptr [esi + 0x496baa], al   ; 医院（0x43ec3f 的尾部）
 * ```
 * 先前 remake 一处都没加 ⇒ 月结屏「本月倒楣天數」偏低、奖项评分少算
 * `天数 × 物價指數 × 2500`（VA 0x00437d55）。
 */
describe('★ 送入监狱/医院累加「本月倒楣天數」(+0x42)', () => {
  it('监狱：新判累加天数', () => {
    const ps = four();
    ps[2] = makePlayer({ index: 2, totalWinterSleepDays: 3 });
    const r = confine(ps, empty(), 'prison', 2, 5);
    expect(r.players[2]!.totalWinterSleepDays).toBe(8);
    expect(r.players[2]!.blocking.inPrison).toBe(5);
  });

  it('医院：同样累加', () => {
    const ps = four();
    ps[1] = makePlayer({ index: 1, totalWinterSleepDays: 10 });
    const r = confine(ps, empty(), 'hospital', 1, 3);
    expect(r.players[1]!.totalWinterSleepDays).toBe(13);
  });

  it('★ 加刑也累加（原版两条路径共用同一段尾部）', () => {
    const ps = four();
    ps[2] = makePlayer({
      index: 2,
      totalWinterSleepDays: 4,
      blocking: { ...ps[2]!.blocking, inPrison: 3 },
    });
    const r = confine(ps, empty(), 'prison', 2, 4);
    expect(r.extended).toBe(true);
    expect(r.days).toBe(7);
    expect(r.players[2]!.totalWinterSleepDays).toBe(8);
  });

  it('不影响其他玩家', () => {
    const ps = four();
    ps[0] = makePlayer({ index: 0, totalWinterSleepDays: 7 });
    const r = confine(ps, empty(), 'prison', 2, 5);
    expect(r.players.map((p) => p.totalWinterSleepDays)).toEqual([7, 0, 5, 0]);
  });

  it('★ 是 8 位加法：255 + 5 → 4（原版 `add byte ptr` 回绕）', () => {
    const ps = four();
    ps[1] = makePlayer({ index: 1, totalWinterSleepDays: 255 });
    const r = confine(ps, empty(), 'prison', 1, 5);
    expect(r.players[1]!.totalWinterSleepDays).toBe(4);
  });

  it('0 天也走这一句 `add …, 0`：值不变', () => {
    const ps = four();
    ps[1] = makePlayer({ index: 1, totalWinterSleepDays: 9 });
    const r = confine(ps, empty(), 'hospital', 1, 0);
    expect(r.players[1]!.totalWinterSleepDays).toBe(9);
  });
});

/**
 * `sendToConfinement` = `send_to_prison`/`send_to_hospital` 的**完整**函数体：
 * 写计数 ＋ **传送到监狱／医院格** ＋ **跟班物件搬家**。
 *
 * ★ 通道 2 差分证据：`rich4-spec/tests/test_confinement_teleport.py`（48/48，
 *   在 Unicorn 里整段跑 `0x43d593`/`0x43ec3f`，表现层调用打桩）。
 */
describe('sendToConfinement —— 首次关押的传送与跟班搬家', () => {
  /** 3 个节点：1 = 普通格、2 = 监狱、3 = 医院（坐标刻意各不相同） */
  const nodes = [
    makeNode({ id: 1, x: 100, y: 200 }),
    makeNode({ id: 2, x: 1935, y: 1039, specialKind: SPECIAL_KIND.PRISON }),
    makeNode({ id: 3, x: 777, y: 888, specialKind: SPECIAL_KIND.HOSPITAL }),
  ];
  const objs = () => makeObjects(46);
  const onNode = (i: number, nodeId: number) => makePlayer({ index: i, nodeId, xpos: 1, ypos: 2 });

  it('首次入监：nodeId/xpos/ypos 三项原子搬到监狱格，lastNodeId 归 0', () => {
    const ps = [onNode(0, 1), onNode(1, 1)];
    const r = sendToConfinement(ps, objs(), nodes, empty(), 'prison', 1, 5);
    expect(r.teleported).toBe(true);
    expect(r.players[1]!.nodeId).toBe(2);
    expect(r.players[1]!.xpos).toBe(1935);
    expect(r.players[1]!.ypos).toBe(1039);
    expect(r.players[1]!.lastNodeId).toBe(0);
    expect(r.players[0]!.nodeId).toBe(1);
    expect(r.players[1]!.blocking.inPrison).toBe(5);
  });

  it('★ whoPlays 高 4 位被清（`and byte [p+0x15], 0xf`）', () => {
    const ps = [makePlayer({ index: 0, nodeId: 1, whoPlays: 0x41 })];
    const r = sendToConfinement(ps, objs(), nodes, empty(), 'prison', 0, 5);
    expect(r.players[0]!.whoPlays).toBe(0x01);
  });

  it('入院走同一套，只是换成医院格', () => {
    const ps = [onNode(0, 1)];
    const r = sendToConfinement(ps, objs(), nodes, empty(), 'hospital', 0, 3);
    expect(r.players[0]!.nodeId).toBe(3);
    expect([r.players[0]!.xpos, r.players[0]!.ypos]).toEqual([777, 888]);
    expect(r.players[0]!.blocking.inHospital).toBe(3);
    expect(r.occupancy[0]).toBe(1);
  });

  it('★ 加刑（本来就在里面）**不传送**、不动跟班', () => {
    const ps = [
      makePlayer({
        index: 0,
        nodeId: 1,
        xpos: 100,
        ypos: 200,
        blocking: { ...makePlayer().blocking, inPrison: 2 },
      }),
    ];
    const o = objs();
    o[2]!.nodeId = 9;
    const r = sendToConfinement(ps, o, nodes, empty(), 'prison', 0, 5);
    expect(r.teleported).toBe(false);
    expect(r.extended).toBe(true);
    expect(r.players[0]!.nodeId).toBe(1);
    expect(r.players[0]!.xpos).toBe(100);
    expect(r.players[0]!.blocking.inPrison).toBe(7);
    expect(r.objects[2]!.nodeId).toBe(9);
  });

  it('★ 跟班搬家：`+0x3f` 与 `+0x40` 两个物件的所在格都改成玩家所在格', () => {
    const ps = [makePlayer({ index: 0, nodeId: 1, godInfo: 3, f64: 5 })];
    const r = sendToConfinement(ps, objs(), nodes, empty(), 'prison', 0, 5);
    expect(r.objects[2]!.nodeId).toBe(2);
    expect(r.objects[4]!.nodeId).toBe(2);
    expect(r.objects[3]!.nodeId).toBe(0);
  });

  it('★ 两支互相独立：`+0x40` 为 0 时只搬 `+0x3f` 那一个', () => {
    const ps = [makePlayer({ index: 0, nodeId: 1, godInfo: 3, f64: 0 })];
    const o = objs();
    o[4]!.nodeId = 7;
    const r = sendToConfinement(ps, o, nodes, empty(), 'prison', 0, 5);
    expect(r.objects[2]!.nodeId).toBe(2);
    expect(r.objects[4]!.nodeId).toBe(7);
  });

  it('地图上没有监狱格 ⇒ 只写计数，不传送（原版读全局格号，为 0 时不成立）', () => {
    const noJail = [makeNode({ id: 1, x: 100, y: 200 })];
    const ps = [onNode(0, 1)];
    const r = sendToConfinement(ps, objs(), noJail, empty(), 'prison', 0, 5);
    expect(r.teleported).toBe(false);
    expect(r.players[0]!.nodeId).toBe(1);
    expect(r.players[0]!.blocking.inPrison).toBe(5);
  });

  it('★ 首次关押仍会清「另一张」占用表（`0x40d761` 的职责，走 confine）', () => {
    const ps = [
      makePlayer({
        index: 0,
        nodeId: 1,
        blocking: { ...makePlayer().blocking, inHospital: 4 },
      }),
    ];
    const hospital = new Array<number>(CONFINEMENT_SLOTS).fill(0);
    hospital[0] = 1;
    const r = sendToConfinement(ps, objs(), nodes, empty(), 'prison', 0, 5, hospital);
    expect(r.players[0]!.blocking.inHospital).toBe(0);
    expect(r.otherOccupancy?.[0]).toBe(0);
    expect(r.occupancy[0]).toBe(1);
  });

  it('索引越界 ⇒ 不崩、物件表原样返回', () => {
    const o = objs();
    const r = sendToConfinement([], o, nodes, empty(), 'prison', 0, 5);
    expect(r.teleported).toBe(false);
    expect(r.objects).toHaveLength(o.length);
  });
});
