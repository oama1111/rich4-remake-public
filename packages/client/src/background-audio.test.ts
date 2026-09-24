/*
 * 第十九份（iPhone 发烫）：音频那一半 —— 响完的节点拆下、切后台挂起上下文、音效与音乐共用一个上下文；
 * 以及页面可见性事件的归一（`page-visibility.ts`）。
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { FakeAudioContext, type FakeGain, type FakeSource } from './fake-webaudio.ts';
import { MusicPlayer, OscillatorVoice } from './music.ts';
import { SoundPlayer } from './audio.ts';
import { installPageVisibility } from './page-visibility.ts';

describe('OscillatorVoice：响完的节点从渲染图上拆下', () => {
  it('旋律音与鼓：ended 之后音源与包络增益都 disconnect', () => {
    const ctx = new FakeAudioContext();
    const dest = ctx.createGain();
    const v = new OscillatorVoice(ctx as unknown as AudioContext, dest as unknown as AudioNode);
    v.schedule({ time: 0, note: 60, velocity: 100, duration: 0.5, channel: 0, program: 0 } as never, 0);
    v.schedule({ time: 0, note: 38, velocity: 100, duration: 0.1, channel: 9, program: 0 } as never, 0);
    const sources = ctx.sources as FakeSource[];
    // 旋律 1 个 + 军鼓（噪声 + 音调）2 个
    expect(sources.length).toBe(3);
    const gains = (ctx.gains as FakeGain[]).filter((g) => g !== dest);
    expect(sources.every((s) => !s.disconnected)).toBe(true);
    for (const s of sources) s.onended?.();
    expect(sources.every((s) => s.disconnected)).toBe(true);
    expect(gains.every((g) => g.disconnected)).toBe(true);
    expect(dest.disconnected).toBe(false);
  });
});

class SuspendableCtx extends FakeAudioContext {
  suspended = 0;
  override resume(): Promise<void> {
    this.state = 'running';
    return super.resume();
  }
  suspend(): Promise<void> {
    this.suspended++;
    this.state = 'suspended';
    return Promise.resolve();
  }
}

describe('MusicPlayer.setBackground：切后台挂起、回前台恢复', () => {
  it('没解锁时什么都不做', async () => {
    const p = new MusicPlayer();
    expect(await p.setBackground(true)).toBe(true);
    expect(p.context).toBeNull();
  });

  it('后台 suspend、前台 resume，并如实报告是否恢复运行', async () => {
    const p = new MusicPlayer();
    const ctx = new SuspendableCtx();
    const master = ctx.createGain();
    p.attach(ctx as unknown as AudioContext, master as unknown as GainNode);
    expect(p.context).toBe(ctx);
    await p.setBackground(true);
    expect(ctx.state).toBe('suspended');
    expect(ctx.suspended).toBe(1);
    // 连着两次后台不重复挂起
    await p.setBackground(true);
    expect(ctx.suspended).toBe(1);
    expect(await p.setBackground(false)).toBe(true);
    expect(ctx.state).toBe('running');
  });

  it('iOS 不许无手势恢复（resume 之后仍不是 running）⇒ 报 false，让调用方挂手势监听', async () => {
    const p = new MusicPlayer();
    const ctx = new SuspendableCtx();
    ctx.resume = () => Promise.resolve();
    p.attach(ctx as unknown as AudioContext, ctx.createGain() as unknown as GainNode);
    await p.setBackground(true);
    expect(await p.setBackground(false)).toBe(false);
  });
});

describe('SoundPlayer.attach：与背景音乐共用一个上下文', () => {
  it('挂上即算解锁；已有上下文就不换', () => {
    const s = new SoundPlayer();
    expect(s.unlocked).toBe(false);
    const a = new FakeAudioContext();
    s.attach(a as unknown as AudioContext);
    expect(s.unlocked).toBe(true);
    s.attach(new FakeAudioContext() as unknown as AudioContext);
    s.unlock(); // 已有上下文 ⇒ 不再自建
    expect(s.unlocked).toBe(true);
  });
});

describe('installPageVisibility', () => {
  function host(hidden = false) {
    const doc = { hidden, cbs: [] as (() => void)[], addEventListener(_t: string, cb: () => void) { this.cbs.push(cb); } };
    const win = { cbs: new Map<string, () => void>(), addEventListener(t: string, cb: () => void) { this.cbs.set(t, cb); } };
    return { doc, win };
  }

  it('visibilitychange 与 pagehide/pageshow 归一成 onHide / onShow，重复事件只报一次', () => {
    const { doc, win } = host();
    const seen: string[] = [];
    const isHidden = installPageVisibility(doc, win, { onHide: () => seen.push('hide'), onShow: () => seen.push('show') });
    expect(isHidden()).toBe(false);
    doc.hidden = true;
    doc.cbs[0]!();
    win.cbs.get('pagehide')!();
    expect(isHidden()).toBe(true);
    doc.hidden = false;
    win.cbs.get('pageshow')!();
    doc.cbs[0]!();
    expect(seen).toEqual(['hide', 'show']);
    expect(isHidden()).toBe(false);
  });

  it('pageshow 时页面若仍在后台（预渲染）不报 show', () => {
    const { doc, win } = host(true);
    const seen: string[] = [];
    installPageVisibility(doc, win, { onHide: () => seen.push('hide'), onShow: () => seen.push('show') });
    win.cbs.get('pageshow')!();
    expect(seen).toEqual([]);
  });
});
