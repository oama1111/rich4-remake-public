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
 * 同一句语音在**连续重复请求**下，隔多久才允许重新起播（毫秒）。
 *
 * ⚠️ 为什么需要：复刻侧的文字绘制是**每帧**跑的，而 `#NNNN` 的语音触发
 *   （原版 `drawText_colorcode` → `play_speech`，VA 0x0044fb4e）就挂在绘制里。
 *   实测魔法屋入口台词每帧被画一次（2 秒 126 次，见 `magic-screen.ts` 的
 *   `magicBoxText`），同一句于是被 `Stop → Play` 上百次 —— 每次都从 0 起，
 *   永远只响头几十毫秒，听感就是「**没有语音**」。
 *   原版每次重画也会重放，但那边字框只在换词时重画；复刻是整屏每帧重画。
 *
 * 所以：**换了语音号立刻放；同一号连着来就按这个间隔去抖。** 台词是每句
 * 一两秒，500 ms 远小于一句，但远大于一帧（16 ms）—— 既不会漏句，
 * 也不会把一句踩成静音。画出屏幕再回来期间会有一段空档（> 500 ms），
 * 于是重新进同一屏时同一句照放。
 */
export const VOICE_RETRIGGER_GAP_MS = 500;

/**
 * 这一声语音要不要**重新起播**（纯函数，便于单测）。
 *
 * 两道闸门，缺一不可：
 *  1. `isPlaying` —— 同一句**还在响**就绝不能重起（实测：一个 4.6 s 的女巫语音
 *     若只按时间去抖，会被每 500 ms 砍掉重放，听感是结巴）；
 *  2. 时间闸 —— 换了号立刻放；同一号连着来按 `gapMs` 去抖（挡的是**解码还没
 *     回来**、以及每帧重画那一段）。
 *
 * @param lastCode 上一次真正起播的语音号（`null` = 还没放过）
 * @param lastAt 上一次真正起播的时刻（与 `now` 同一时基）
 * @param code 这一次请求的语音号
 * @param now 现在
 * @param isPlaying 这一号此刻是不是还在响（`SoundPlayer.isPlaying`）
 * @param gapMs 同一号的去抖间隔（默认 `VOICE_RETRIGGER_GAP_MS`）
 */
export function shouldRetriggerVoice(
  lastCode: number | null,
  lastAt: number,
  code: number,
  now: number,
  isPlaying: boolean,
  gapMs = VOICE_RETRIGGER_GAP_MS,
): boolean {
  if (isPlaying) return false;
  if (lastCode !== code) return true;
  return now - lastAt >= gapMs;
}

/**
 * ★★ 第二十六份 panel：**语音只有一路**（原版的单一语音缓冲 `[0x47e750]`）。
 *
 * ```asm
 * 0045442e  call 0x454493                 ; play_speech 起播前：先 Stop + Release 上一句（不管是谁放的）
 * 00454443  call 0x450441 / 0x453dcf      ; 读 Speaking.mkf 那一段、建缓冲
 * 00454456  mov  [0x47e750], eax / Play   ; 这一路现在是它
 * 004544b9  … [0x47e750] GetStatus & DSBSTATUS_PLAYING   ; 「语音还在响吗」只问这一路
 * ```
 * 文本里的 `#NNNN`（`0x44fabc` → `0x45441a`）与角色台词（`_rich4_player_say` 画字时同一条 `0x44fabc`）
 * 走的都是这一路 ⇒ 起一句新的，上一句当场停。本类就是那一个出口：`main.ts` 的 `#NNNN` sink 与台词队列
 * 都经它放，`busy()` 就是 `0x4544b9`。同一句重起（Stop → Play）交给 `SoundPlayer.play` 自己的「同一路先停」。
 */
export class VoiceChannel {
  #current: number | null = null;
  readonly #out: {
    play(resource: number): void;
    stop(resource: number): void;
    isPlaying(resource: number): boolean;
  };

  constructor(out: { play(resource: number): void; stop(resource: number): void; isPlaying(resource: number): boolean }) {
    this.#out = out;
  }

  /** 起播一句 —— 先停掉这一路上正在响的另一句（`0x0045442e call 0x454493`）*/
  play(resource: number): void {
    const prev = this.#current;
    if (prev !== null && prev !== resource && this.#out.isPlaying(prev)) this.#out.stop(prev);
    this.#current = resource;
    this.#out.play(resource);
  }

  /** 停掉这一路（`fcn_00454493`）*/
  stop(): void {
    const cur = this.#current;
    if (cur !== null && this.#out.isPlaying(cur)) this.#out.stop(cur);
  }

  /** 这一路还在响吗（`fcn_004544b9`）*/
  busy(): boolean {
    const cur = this.#current;
    return cur !== null && this.#out.isPlaying(cur);
  }

  /** 这一路最近起播的是哪一句（没放过 = null）*/
  get current(): number | null {
    return this.#current;
  }
}

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

  /**
   * ★ 第十九份（iPhone 发烫）：挂上一个**已经建好**的上下文（与背景音乐共用同一个）。
   *   先前音效、音乐各建一个 AudioContext ⇒ 手机上两条音频渲染线程 / 两路硬件输出一直开着。
   *   已经有上下文了就不换。
   */
  attach(ctx: AudioContext): void {
    if (this.#ctx !== null) return;
    this.#ctx = ctx;
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

  /**
   * 某一路**已经解码好**的时长（毫秒）；没解码好 / 空槽 / 越界都给 `null`。
   *
   * ★ 用途只有一个：原版 `_rich4_player_say` 是**先播完语音再等 1000 ms**
   *   （VA 0x004544f6 那段「还有没有声音在响」的循环），而本引擎的台词显示
   *   与语音是**并行**的 —— 长句会出现「字先没了、声音还在」。
   *   调用方拿到时长后调 `SpeechQueue.extend()` 把这一段撑到语音播完。
   *   见 `docs/deviations/T-052.md` 的 Q-SPEECH-9 / Q-SPEECH-6。
   *
   * ⚠️ **不触发加载**（纯查询）：没解码好就返回 `null`，调用方按「不知道」处理。
   *   要它尽量有值，先调一次 `play()`。
   */
  durationOf(archive: SoundArchive, resource: number): number | null {
    const buf = this.#buffers.get(`${archive}:${resource}`);
    if (buf === undefined || buf === null) return null;
    return Math.round(buf.duration * 1000);
  }

  /**
   * 某一路的某个资源**此刻是不是还在响**（纯读，用于语音去抖）。
   *
   * ★ 为什么需要：`#NNNN` 的触发挂在绘制里，每帧都会被请求一次。只按时间去抖
   *   仍然会把**一句长语音**每 500 ms 砍掉重放（实测 4.6 s 的女巫语音被砍成
   *   三截）—— 必须同时看「它还响着没有」。
   *   播完的 source 会由 `ended` 监听从表里摘掉，所以这里就是「还在响」。
   */
  isPlaying(archive: SoundArchive, resource: number): boolean {
    return this.#voices.has(`${archive}:${resource}`);
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
      // ★ 第十九份：响完就从渲染图上拆下来（见 `music.ts` 的 `#track`）
      src.disconnect();
      gain.disconnect();
    });
    this.#voices.set(key, src);
    src.start();
  }

  /** 已缓存的音频数 —— 诊断用 */
  get cached(): number {
    return this.#buffers.size;
  }
}
