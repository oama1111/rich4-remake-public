/*
 * 假的 WebAudio —— 单元测试用
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ node 里没有 `AudioContext`（仓库里也没有 jsdom），所以想在 node 下测
 *   「排了哪些节点、什么参数」，只能拿一个记账用的假实现顶上。
 *   这里只实现 `music.ts` / `soundfont-voice.ts` 真正碰到的那几个成员，
 *   多余的一概不装 —— 装了反而会掩盖「代码用到了别的东西」。
 */

/** 记下来的 audio param 事件，断言用 */
export interface ParamEvent {
  kind: 'set' | 'linear' | 'target' | 'cancel';
  value: number;
  time: number;
  /** `setTargetAtTime` 的时间常数 */
  tau?: number;
}

export class FakeParam {
  readonly events: ParamEvent[] = [];
  value = 0;

  setValueAtTime(value: number, time: number): void {
    this.value = value;
    this.events.push({ kind: 'set', value, time });
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.value = value;
    this.events.push({ kind: 'linear', value, time });
  }
  setTargetAtTime(value: number, time: number, tau: number): void {
    this.value = value;
    this.events.push({ kind: 'target', value, time, tau });
  }
  cancelScheduledValues(time: number): void {
    this.events.push({ kind: 'cancel', value: this.value, time });
  }
}

export class FakeGain {
  readonly gain = new FakeParam();
  readonly kind = 'gain';
  connects: unknown[] = [];
  disconnected = false;

  connect(dest: unknown): this {
    this.connects.push(dest);
    return this;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

export class FakeSource {
  readonly kind = 'source';
  readonly playbackRate = new FakeParam();
  buffer: FakeBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  /**
   * 有没有被**立刻**停掉。
   *
   * ⚠️ 真实的 `stop(when)` 是「排一个将来的停止时刻」，调用它的当下节点还在响 ——
   *   排程时给每个音排 `stop(noteEnd)` 是**正常**的，不代表它已经停了。
   *   所以只有 `when <= 0`（= 现在停）才置这个标志；
   *   所有调用（含将来时刻）都记在 `stops` 里备查。
   */
  stopped = false;
  readonly starts: { when: number; offset: number }[] = [];
  readonly stops: number[] = [];
  connects: unknown[] = [];
  disconnected = false;
  onended: (() => void) | null = null;

  start(when = 0, offset = 0): void {
    this.starts.push({ when, offset });
  }
  stop(when = 0): void {
    if (when <= 0) this.stopped = true;
    this.stops.push(when);
  }
  connect(dest: unknown): this {
    this.connects.push(dest);
    return this;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

/** 振荡器：比 buffer source 多 `frequency` 与 `type` */
export class FakeOscillator extends FakeSource {
  readonly frequency = new FakeParam();
  type = 'sine';
}

export class FakeBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  /** 拷进来的 PCM（单声道） */
  channel: Float32Array | Int16Array | null = null;

  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
  }
  copyToChannel(data: Float32Array | Int16Array, channel: number): void {
    // 假实现只留一条通道；照规矩把它「用掉」，免得 eslint 报未用参数
    void channel;
    this.channel = data;
  }
}

export class FakeAudioContext {
  readonly sampleRate = 44100;
  readonly currentTime = 0;
  readonly destination = { kind: 'destination' };
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  readonly buffers: FakeBuffer[] = [];
  state = 'running';
  resumed = 0;

  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createOscillator(): FakeOscillator {
    const o = new FakeOscillator();
    this.sources.push(o);
    return o;
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    const b = new FakeBuffer(channels, length, sampleRate);
    this.buffers.push(b);
    return b;
  }
  resume(): Promise<void> {
    this.resumed++;
    return Promise.resolve();
  }
}
