/*
 * 音效播放
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块**只读**状态，不含任何规则。
 *
 * 原版的音效与语音都是现成的 RIFF/WAVE（见 assets-pipeline 的 audio.ts），
 * 从 mkf 取出来直接喂 `decodeAudioData` 即可，不需要任何解码工作。
 */

import { isWave, MkfArchive } from '@rich4/assets-pipeline';

/** 音频档案 */
export type SoundArchive = 'Effect.mkf' | 'Speaking.mkf';

/**
 * 音效播放器。
 *
 * ⚠️ 浏览器要求 `AudioContext` 在**用户手势之后**才能出声。
 *   故这里不在构造时建 context，而是等第一次 `unlock()`（由任意点击触发）。
 *   在此之前所有播放请求都被安静地丢弃——不报错、不排队，
 *   避免解锁后突然一起炸响。
 */
export class SoundPlayer {
  readonly #archives = new Map<SoundArchive, MkfArchive>();
  readonly #buffers = new Map<string, AudioBuffer | null>();
  readonly #loading = new Set<string>();
  #ctx: AudioContext | null = null;
  #muted = false;

  /** 音量 0..1 */
  volume = 0.7;

  get muted(): boolean {
    return this.#muted;
  }

  setMuted(v: boolean): void {
    this.#muted = v;
  }

  get unlocked(): boolean {
    return this.#ctx !== null;
  }

  /** 装载一个档案。可以只装 Effect.mkf —— Speaking.mkf 有 57MB，按需再装。 */
  addArchive(name: SoundArchive, data: Uint8Array): void {
    this.#archives.set(name, new MkfArchive(data));
  }

  /** 在用户手势里调用，建立 AudioContext */
  unlock(): void {
    if (this.#ctx !== null) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor === undefined) return;
    this.#ctx = new Ctor();
    void this.#ctx.resume();
  }

  /**
   * 播一个音效。
   *
   * 尚未解锁、档案没装、资源号越界、或那一格是空槽时**安静地什么都不做**——
   * 音效缺失不该把游戏拖垮。
   */
  play(archive: SoundArchive, resource: number): void {
    if (this.#muted || this.#ctx === null) return;
    const key = `${archive}:${resource}`;

    const hit = this.#buffers.get(key);
    if (hit !== undefined) {
      if (hit !== null) this.#emit(hit);
      return;
    }
    if (this.#loading.has(key)) return;

    const arc = this.#archives.get(archive);
    if (arc === undefined) return;

    let raw: Uint8Array;
    try {
      raw = arc.read(resource);
    } catch {
      this.#buffers.set(key, null); // 越界或空槽，记下来别再试
      return;
    }
    if (!isWave(raw)) {
      this.#buffers.set(key, null);
      return;
    }

    this.#loading.add(key);
    // decodeAudioData 要一个独立的 ArrayBuffer，故复制一份
    const copy = new Uint8Array(raw.length);
    copy.set(raw);
    void this.#ctx
      .decodeAudioData(copy.buffer)
      .then((buf) => {
        this.#buffers.set(key, buf);
        this.#loading.delete(key);
        this.#emit(buf);
      })
      .catch(() => {
        this.#buffers.set(key, null);
        this.#loading.delete(key);
      });
  }

  #emit(buf: AudioBuffer): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = this.volume;
    src.connect(gain).connect(ctx.destination);
    src.start();
  }

  /** 已缓存的音频数 —— 诊断用 */
  get cached(): number {
    return this.#buffers.size;
  }
}
