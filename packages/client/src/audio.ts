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
  /**
   * 每一路音效**当前在响的那一个** source。
   *
   * @source 原版的移动音效是**单路**的：索引存在 `[0x4749d4]`，
   *   掷骰段尾 `rich4_play_sound_effect`（VA 0x0040d9f2）之前会先把同一路
   *   `Stop` 掉（`fcn_004542e9` = `IDirectSoundBuffer::Stop`，VA 0x0040d8dc 是
   *   「整趟走完」那一次）—— 所以原版**永远只有一路在响**。
   *   浏览器里每个 `BufferSource` 都是独立的一路，不自己停就会叠：
   *   汽車 2.72 s / 機車 1.50 s 那种循环引擎声走一格叠一路，听感完全不对。
   *   见 `docs/deviations/Q-SOUND-1.md` §4。
   */
  readonly #voices = new Map<string, AudioBufferSourceNode>();
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
   *
   * @param loop 循环播（原版 `_rich4_play_sound_effect(flags=1, …)` 的
   *   `DSBPLAY_LOOPING`）；默认 `false` = 一次性，现有调用者照旧。
   *   ⚠️ 循环的那一路**照样登记在 `#voices` 里**，所以 `stop()` 停得掉它
   *   （转盘 52 号只有 0.089 s，不循环就只是一声「嗒」——见 `wheel-screen.ts`）。
   */
  play(archive: SoundArchive, resource: number, loop = false): void {
    if (this.#muted || this.#ctx === null) return;
    const key = `${archive}:${resource}`;
    // ★ 一路一个实例：**新的一声起播之前，先把同一路还在响的那一个停掉**。
    //   原版就是 Stop→Play（@source VA 0x0040d9f2 / 0x0040d8dc），
    //   不停就是浏览器里才有的「叠加」——见 `#voices` 的注释。
    this.#stopKey(key);

    const hit = this.#buffers.get(key);
    if (hit !== undefined) {
      if (hit !== null) this.#emit(key, hit, loop);
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
        this.#emit(key, buf, loop);
      })
      .catch(() => {
        this.#buffers.set(key, null);
        this.#loading.delete(key);
      });
  }

  /**
   * 停掉某一路正在响的音效。
   *
   * @source `fcn_004542e9`（VA 0x004542e9）= `IDirectSoundBuffer::Stop`。
   *   原版三处会停移动音效：换精灵组（`_rich4_update_player_sprite`，
   *   VA 0x0040b9de / 0x0040bb99）、**整趟走完**（VA 0x0040d8dc）、
   *   落地（VA 0x0041b44e）。本引擎目前只在 `play()` 里自动收上一路；
   *   谁要显式停（例如走子被中途打断），调这个。
   */
  stop(archive: SoundArchive, resource: number): void {
    this.#stopKey(`${archive}:${resource}`);
  }

  /** 停掉**所有**在响的（关机/切屏/静音那类总收） */
  stopAll(): void {
    for (const key of [...this.#voices.keys()]) this.#stopKey(key);
  }

  /** 停掉 `key` 这一路 —— 已经响完的自己会从表里摘掉 */
  #stopKey(key: string): void {
    const src = this.#voices.get(key);
    if (src === undefined) return;
    this.#voices.delete(key);
    try {
      src.stop();
    } catch {
      // 已经自然播完的 source 再 stop() 会抛 InvalidStateError；
      // 那不是错误（我们要的结果已经达到了），安静收下。
    }
  }

  #emit(key: string, buf: AudioBuffer, loop: boolean): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // ★ 循环音就靠这一个标志 —— 原版 `_rich4_play_sound_effect` 的 flags bit0
    //   （`DSBPLAY_LOOPING`，见 `docs/deviations/Q-SOUND-1.md`）。
    src.loop = loop;
    const gain = ctx.createGain();
    gain.gain.value = this.volume;
    src.connect(gain).connect(ctx.destination);
    // 播完就摘牌（免得表里越积越多）；**只摘自己**，
    // 别把后来接棒的那一个从表里误删。
    // ★ 循环的那一路永远不触发 `ended`，只能靠 `stop()` / `stopAll()` 收——
    //   所以它**必须**留在 `#voices` 里。
    src.addEventListener('ended', () => {
      if (this.#voices.get(key) === src) this.#voices.delete(key);
    });
    this.#voices.set(key, src);
    src.start();
  }

  /** 已缓存的音频数 —— 诊断用 */
  get cached(): number {
    return this.#buffers.size;
  }
}
