/*
 * 日曆：数据回 exe 对，算法回真实历法对
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { lunarOf, LUNAR_DAYS } from '@rich4/data';
import {
  HOLIDAY_ART_BASE,
  HOLIDAY_ART_SIZE,
  HOLIDAY_TABLE,
  MONTH_SCENE,
  daysInMonth,
  dayNumberSince1998,
  holidayArtResource,
  holidayIndexOf,
  holidayMusicOf,
  holidayMusicWord,
  isHoliday,
  isLeapYear,
  nthWeekdayOfMonth,
  sceneOfMonth,
  weekdayOf,
} from './calendar.ts';

const EXE = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/rich4.exe';
const d = existsSync(EXE) ? describe : describe.skip;

/** @source 与 binary-truth.test.ts 同一张节表 */
const DGROUP_VA = 0x463000;
const DGROUP_OFF = 398848;

d('日曆的数据全部来自 exe', () => {
  // describe.skip 仍会执行本回调（收集用例）⇒ 缺文件时不能走到下面的 readFileSync
  if (!existsSync(EXE)) {
    it.skip('需要原版 rich4.exe', () => undefined);
    return;
  }
  const exe = readFileSync(EXE);
  const at = (va: number): number => DGROUP_OFF + (va - DGROUP_VA);

  it('月份→季节底图表就是 0x00475218 那 12 字节', () => {
    const got = Array.from({ length: 12 }, (_, i) => exe[at(0x475218) + i]);
    expect(MONTH_SCENE).toEqual(got);
    // 顺带钉住这个**反直觉**的分法：2~4 春、5~7 夏、8~10 秋、11~1 冬
    expect(sceneOfMonth(1)).toBe(3);
    expect(sceneOfMonth(2)).toBe(0);
    expect(sceneOfMonth(5)).toBe(1);
    expect(sceneOfMonth(8)).toBe(2);
    expect(sceneOfMonth(11)).toBe(3);
  });

  it('節日表逐字节对上 0x0047ff4a', () => {
    for (let m = 0; m < 8; m++) {
      for (const e of HOLIDAY_TABLE[m] ?? []) {
        const o = at(0x47ff4a) + 288 * m + 12 * e.index;
        expect([exe[o], exe[o + 1], exe[o + 2], exe[o + 3], exe[o + 4]]).toEqual([
          e.holiday,
          e.kind,
          e.month,
          e.day,
          e.weekday,
        ]);
      }
    }
  });

  it('★ 節日配乐那两格（`+5 & 4` 旗标、`+0xa` 曲号）—— 8 图 × 24 条**全部**逐字节对上', () => {
    let flagged = 0;
    for (let m = 0; m < 8; m++) {
      for (let i = 0; i < 24; i++) {
        const o = at(0x47ff4a) + 288 * m + 12 * i;
        const w = holidayMusicWord(m, i);
        expect(w.flag, `地图 ${m} 槽 ${i} 的旗标`).toBe((exe[o + 5]! & 4) !== 0);
        expect(w.id, `地图 ${m} 槽 ${i} 的曲号`).toBe(exe.readUInt16LE(o + 0xa));
        if (w.flag) flagged++;
      }
    }
    expect(flagged).toBe(6); // 聖誕 ×4 图 + 農曆初一 ×2 图
  });

  it('農曆表逐项对上 0x0047639c', () => {
    const o = at(0x47639c);
    expect(LUNAR_DAYS).toBe(8401);
    for (let i = 0; i < LUNAR_DAYS; i += 37) {
      const v = exe.readUInt32LE(o + 4 * i);
      expect(lunarOf(i)).toEqual({ month: (v >> 8) & 0xff, day: v & 0xff });
    }
  });
});

describe('日期换算', () => {
  it('纪元是 1998-01-01，那天是星期四', () => {
    expect(dayNumberSince1998(1998, 1, 1)).toBe(0);
    expect(weekdayOf(1998, 1, 1)).toBe(4);
  });

  it('与真实公历一致 —— 抽查几个已知日期', () => {
    expect(weekdayOf(1998, 12, 25)).toBe(5); // 星期五
    expect(weekdayOf(2000, 1, 1)).toBe(6); // 星期六
    expect(weekdayOf(2000, 2, 29)).toBe(2); // 星期二（2000 是闰年）
  });

  it('★ 闰年只看 %4 —— 原版没有百年例外，2100 年它会算成闰年', () => {
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1999)).toBe(false);
    // 真实公历里 2100 不是闰年；原版认为是。照抄。
    expect(isLeapYear(2100)).toBe(true);
    expect(daysInMonth(2100, 2)).toBe(29);
  });

  it('每月天数', () => {
    expect(daysInMonth(1998, 1)).toBe(31);
    expect(daysInMonth(1998, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1998, 4)).toBe(30);
  });
});

describe('★ 節日配乐（W-17）@source sub_00452444 / sub_0041cf67', () => {
  it('聖誕節：曲号 13（MIDI14-1），下一条曲号是 0 ⇒ 只放 1 天', () => {
    const idx = holidayIndexOf(0, 2010, 12, 25);
    expect(idx).toBe(15);
    expect(holidayMusicOf(0, idx)).toEqual({ id: 13, days: 1 });
    // 四张有聖誕的图各自的槽号不同，曲号一样
    expect(holidayMusicOf(1, 10)).toEqual({ id: 13, days: 1 });
    expect(holidayMusicOf(2, 18)).toEqual({ id: 13, days: 1 });
    expect(holidayMusicOf(3, 19)).toEqual({ id: 13, days: 1 });
  });

  it('農曆正月初一：曲号 14（MIDI14-2），下一条（初二）曲号非 0 ⇒ 連放 3 天', () => {
    expect(holidayMusicOf(0, 17)).toEqual({ id: 14, days: 3 });
    expect(holidayMusicOf(1, 12)).toEqual({ id: 14, days: 3 });
  });

  it('★ 初二、初三**有曲号没旗标** ⇒ 自己不触发换曲（只给初一当「連放」的判据）', () => {
    expect(holidayMusicWord(0, 18)).toEqual({ flag: false, id: 14 });
    expect(holidayMusicOf(0, 18)).toBeNull();
    expect(holidayMusicOf(0, 19)).toBeNull();
  });

  it('别的節日（元旦…）、没有節日（−1）、后四张图 ⇒ 不换曲', () => {
    expect(holidayMusicOf(0, holidayIndexOf(0, 2010, 1, 1))).toBeNull();
    expect(holidayMusicOf(0, -1)).toBeNull();
    for (let m = 4; m < 8; m++) for (let i = 0; i < 24; i++) expect(holidayMusicOf(m, i)).toBeNull();
  });
});

describe('節日', () => {
  it('台湾图：元旦、青年節、國慶都是公历固定日', () => {
    expect(holidayIndexOf(0, 1998, 1, 1)).toBeGreaterThanOrEqual(0);
    expect(holidayIndexOf(0, 1998, 3, 29)).toBeGreaterThanOrEqual(0);
    expect(holidayIndexOf(0, 1998, 10, 10)).toBeGreaterThanOrEqual(0);
    expect(holidayIndexOf(0, 1998, 6, 17)).toBe(-1); // 随便一天
  });

  it('台湾图：農曆正月初一（1998-01-28）是春節', () => {
    // 查表：1998-01-28 的農曆是正月初一
    const n = dayNumberSince1998(1998, 1, 28);
    expect(lunarOf(n)).toEqual({ month: 1, day: 1 });
    expect(holidayIndexOf(0, 1998, 1, 28)).toBeGreaterThanOrEqual(0);
    expect(isHoliday(0, 1998, 1, 28)).toBe(true);
  });

  it('★ 星期日一律算假日，哪怕不在節日表里', () => {
    // 1998-01-04 是星期日
    expect(weekdayOf(1998, 1, 4)).toBe(0);
    expect(holidayIndexOf(0, 1998, 1, 4)).toBe(-1);
    expect(isHoliday(0, 1998, 1, 4)).toBe(true);
  });

  it('★ 第 n 个星期 w：原版那个 bug 照抄了', () => {
    // 1998 年 5 月 1 日是星期五(5)；母親節 = 五月第二个星期日(w=0)
    expect(weekdayOf(1998, 5, 1)).toBe(5);
    // w=0 < w1=5 → 原版算 7−5+1 = 3，再 +7 = 10；真实答案也是 5/10，
    // 因为 w == 0 时那个 bug 不显形
    expect(nthWeekdayOfMonth(1998, 5, 2, 0)).toBe(10);

    // w > 0 且 w < w1 时就错了：1998 年 11 月 1 日是星期日(0)，
    // 第四个星期四(w=4) 真实是 11/26；w=4 >= w1=0，这一支没问题
    expect(weekdayOf(1998, 11, 1)).toBe(0);
    expect(nthWeekdayOfMonth(1998, 11, 4, 4)).toBe(26);

    // 1999 年 11 月 1 日是星期一(1)，w=... 取 w=0 < w1=1 才踩 bug
    expect(weekdayOf(1999, 11, 1)).toBe(1);
    // 第一个星期日真实是 11/7；原版算 7−1+1 = 7 —— 这次碰巧对
    expect(nthWeekdayOfMonth(1999, 11, 1, 0)).toBe(7);
    // 踩中的例子：1999 年 12 月 1 日是星期三(3)，求第一个星期二(w=2)
    expect(weekdayOf(1999, 12, 1)).toBe(3);
    // 真实答案是 12/7；原版算 7−3+1 = 5 → 12/5（星期日），差了两天
    expect(nthWeekdayOfMonth(1999, 12, 1, 2)).toBe(5);
    expect(weekdayOf(1999, 12, 7)).toBe(2); // 真正的星期二
  });
});

describe('節日插画的资源号 @source 0x00475208', () => {
  it('★ 表就是 exe 里那 8 个基号，一个不差', () => {
    expect([...HOLIDAY_ART_BASE]).toEqual([4, 28, 47, 67, 87, 108, 95, 118]);
  });

  it('★ 资源号 = 基号 + 節日序号', () => {
    expect(holidayArtResource(0, 0)).toBe(4);
    expect(holidayArtResource(0, 1)).toBe(5);
    expect(holidayArtResource(1, 0)).toBe(28);
    expect(holidayArtResource(7, 3)).toBe(121);
  });

  it('地图号或節日序号越界一律 null（不抛、不悄悄给个错资源）', () => {
    expect(holidayArtResource(8, 0)).toBeNull();
    expect(holidayArtResource(-1, 0)).toBeNull();
    expect(holidayArtResource(0, -1)).toBeNull();
  });

  it('★ 各图基号**不等距** —— 不许当成「基号 + 地图×24」去推', () => {
    const gaps = HOLIDAY_ART_BASE.slice(1).map((v, i) => v - HOLIDAY_ART_BASE[i]!);
    expect(gaps).toEqual([24, 19, 20, 20, 21, -13, 23]);
    // map6 比 map5 还小，这条断言就是防「想当然等差数列」
    expect(HOLIDAY_ART_BASE[6]!).toBeLessThan(HOLIDAY_ART_BASE[5]!);
  });

  it('★ 开局的 1998-01-01 就是節日，落在表内', () => {
    // 元旦 = 每张地图的第 1 条節日 → 资源 = 基号 + 1
    const idx = holidayIndexOf(0, 1998, 1, 1);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(holidayArtResource(0, idx)).toBe(HOLIDAY_ART_BASE[0]! + idx);
  });

  it('插画边长是 200（原版备的就是 200×200 的 frame）', () => {
    expect(HOLIDAY_ART_SIZE).toBe(200);
  });
});
