/*
 * 那两条「没有外层 catch」的入口（W-74 复核续）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * `sweepDisconnected` 挂在 `setInterval` 上、`handle.onClose` 挂在 `socket.on('close')` 上 ——
 * 两条都是**事件回调**，抛出去就是未捕获异常 ⇒ 进程退出 ⇒ 所有房间一起没。
 * `ws-server.ts` 把它们各包了一层（`sweepOnce` / `closeOnce`），这里直接钉住那一层。
 *
 * ⚠️ 为什么不拿真 ws 客户端打：`ws` 在 socket 关到一半时 `send` 是 emit `'error'`
 *   而不是抛（我们听了那个事件），所以**真客户端造不出那一下**。能钉住的是这一层壳。
 */
import { describe, expect, it, vi } from 'vitest';
import type { ClientHandle, RoomHub } from './hub.ts';
import { closeOnce, sweepOnce } from './ws-server.ts';

/** 一个「一扫就抛」的假集线器 */
const explodingHub = {
  sweepDisconnected(): never {
    throw new Error('socket is closing');
  },
} as unknown as RoomHub;

/** 一个「一收尾就抛」的假句柄 */
const explodingHandle = {
  onClose(): never {
    throw new Error('socket is closing');
  },
} as unknown as ClientHandle;

describe('★ 扫描 / 断连收尾：抛了也不许往上冒', () => {
  it('sweepOnce 吞掉（真机上这一拍抛 = 进程退出）', () => {
    expect(() => sweepOnce(explodingHub, 1_000)).not.toThrow();
  });

  it('closeOnce 吞掉（同上，它挂在 socket 的 close 事件上）', () => {
    expect(() => closeOnce(explodingHandle, 1_000)).not.toThrow();
  });
});

describe('★ 吞掉的异常要留痕，但不许刷爆日志（首席复核）', () => {
  it('同一个位置一分钟内只记一条；过了一分钟再记', async () => {
    const { reportSwallowed } = await import('./ws-server.ts');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(reportSwallowed('unit-test', new Error('x'), 1_000_000)).toBe(true);
      expect(reportSwallowed('unit-test', new Error('x'), 1_030_000)).toBe(false);
      expect(reportSwallowed('unit-test', new Error('x'), 1_060_000)).toBe(true);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
});
