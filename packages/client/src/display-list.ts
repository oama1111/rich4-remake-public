/*
 * 画面没变就不重画 —— 逐帧的 2D 绘制指令表去重（第十九份：「iPhone 上玩手机很烫」）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 症状与根因（`tools/perf-mobile-pw.mjs` 实测，iPhone 13 横屏仿真 + CPU 4× 降速）：
 *   渲染循环本来就是「按需」的（`requestRender()`），但很多演出/屏是**轮询式**的 ——
 *   商店开着、台词挂着、訊息框停着、骰子/影片播着时，每个 vsync 都要一帧：tick 推进
 *   状态机（这一半**必须**逐帧跑，演出计时靠它），然后把整块 640×480 舞台重画一遍、
 *   再按设备像素（2250×1026）整块贴上屏。商店开着 = 静止画面 60 fps 地重画。
 *   手机上每一帧都是一次整屏光栅化 + 合成提交，这就是烫的来源。
 *
 * ★ 修法（通用、逐像素等价、不碰任何一处演出计时）：
 *   舞台 / 棋盘 / 側欄这三块离屏画布的 2D 上下文换成**录制代理**。每帧照旧把
 *   tick 和绘制逻辑整个跑一遍（时序一行不变），但绘制指令先记下来、边记边与**上一帧**
 *   的指令表逐条比：
 *     · 一路相同 → 指令先压着不执行；帧尾若整张表都相同 ⇒ 这一帧**什么都不画、也不贴屏**；
 *     · 从第一条不同处起 → 把压着的前缀按原顺序补放到真画布上，之后的指令直通执行
 *       （= 旧行为，逐条同序，所以画出来逐像素相同）。
 *
 * ★ 为什么「指令表相同 ⇒ 像素相同」成立：
 *   ① 三块画布每帧都从整块铺底开始（舞台 `fillRect` 全黑、棋盘铺底色、側欄 `clearRect`），
 *      同一串指令再画一次结果不变；
 *   ② 位图参数按**身份**比，而 `ImageBitmap` 不可变；可变的来源（别的画布、`ImageData`、
 *      没载完的 `<img>`、`DOMMatrix`、数组…）一律当作「每帧都变」—— 宁可多画，不会画旧；
 *      确认生成后不再改的离屏画布（剪影、灰版）由生成者 `markStaticSource()` 登记；
 *   ③ 位图 `close()`：帧内压着指令时先补放再关（顺序与旧行为相同），并强制下一帧重画；
 *   ④ 代理自带一份**纯 JS 的状态镜像**（属性、变换矩阵、虚线、save/restore 栈），所有状态
 *      同步写进去，读属性 / `getTransform` / `measureText` 都照镜像答，所以压着不执行时排版照样
 *      量得准；补放前先把真上下文的状态对齐到本帧开头镜像的状态（防某一帧漏 `restore` 的累积差）。
 *      ⚠️ 镜像**不能**用一块真的离屏画布：Chromium 会把 save/restore/clip/变换记进这块画布的
 *      绘制记录里，而一块从来不被画上屏、也不被读回的画布永远不冲刷 —— 实测三分钟左右整页崩溃
 *      （`Target crashed`）。真上下文只借来做两件不留记录的事：属性值规范化（写进去再读出来）
 *      和 `measureText`。
 *   开发期 `?dlverify=1`：一律直通执行，并在「本该跳过」的帧前后读回三块画布逐像素比对，
 *   不一致就计数 —— 用来实测上面这几条假设。
 */

type Ctx = CanvasRenderingContext2D;

/** 出像素的方法 —— 镜像上不执行 */
const DRAW = new Set([
  'drawImage',
  'fillRect',
  'strokeRect',
  'clearRect',
  'fillText',
  'strokeText',
  'fill',
  'stroke',
  'putImageData',
  'drawFocusIfNeeded',
]);

/** 纯查询 / 造对象 —— 不录、走镜像 */
const QUERY = new Set([
  'measureText',
  'getTransform',
  'getLineDash',
  'createImageData',
  'createLinearGradient',
  'createRadialGradient',
  'createConicGradient',
  'createPattern',
]);

/** 要问真画布的（像素 / 路径命中）—— 必须先把压着的补放掉，再问 */
const READBACK = new Set(['getImageData', 'isPointInPath', 'isPointInStroke']);

/** 与状态无关的只读信息 —— 直接问真上下文 */
const PASSTHRU = new Set(['getContextAttributes', 'isContextLost']);

/** 状态对齐时抄的那些属性（镜像上没有的自动跳过） */
const STATE_PROPS = [
  'globalAlpha',
  'globalCompositeOperation',
  'fillStyle',
  'strokeStyle',
  'lineWidth',
  'lineCap',
  'lineJoin',
  'miterLimit',
  'lineDashOffset',
  'shadowBlur',
  'shadowColor',
  'shadowOffsetX',
  'shadowOffsetY',
  'font',
  'textAlign',
  'textBaseline',
  'direction',
  'imageSmoothingEnabled',
  'imageSmoothingQuality',
  'letterSpacing',
  'wordSpacing',
  'fontKerning',
  'fontStretch',
  'fontVariantCaps',
  'textRendering',
] as const;

/** 确认「生成之后不再改」的离屏画布（按身份比即可） */
const staticSources = new WeakSet<object>();

/** 生成者登记一块画完就不再改的离屏画布（剪影、灰版…）；没登记的画布一律当作每帧都变 */
export function markStaticSource(source: object): void {
  staticSources.add(source);
}

/** 这个参数能不能按身份比（= 同一身份 ⇒ 同样的像素） */
function stableObject(o: object): boolean {
  if (staticSources.has(o)) return true;
  if (typeof ImageBitmap !== 'undefined' && o instanceof ImageBitmap) return true;
  if (typeof CanvasGradient !== 'undefined' && o instanceof CanvasGradient) return true;
  if (typeof CanvasPattern !== 'undefined' && o instanceof CanvasPattern) return true;
  if (typeof HTMLImageElement !== 'undefined' && o instanceof HTMLImageElement) return o.complete;
  return false;
}

function same(a: unknown, b: unknown): boolean {
  if (a !== b) return false;
  if (typeof a === 'object' && a !== null) return stableObject(a);
  if (typeof a === 'function') return false;
  return true;
}

/** 2D 仿射矩阵 [a, b, c, d, e, f]（与 `DOMMatrix` 的 2D 部分同义） */
type M6 = [number, number, number, number, number, number];

interface MirrorState {
  props: Map<string, unknown>;
  m: M6;
  dash: number[];
}

type Snapshot = MirrorState;

function cloneState(s: MirrorState): MirrorState {
  return { props: new Map(s.props), m: [...s.m] as M6, dash: [...s.dash] };
}

function mul(a: M6, b: M6): M6 {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/**
 * 一个上下文的**状态**镜像（纯 JS，不碰任何画布）。
 *
 * 只跟踪会影响「查询」与「补放前对齐」的那部分：属性、变换、虚线、save/restore 栈。
 * 路径与裁剪不跟踪（没有调用方问 `isPointInPath`；裁剪由 save/restore 成对收回）。
 */
class StateMirror {
  #s: MirrorState;
  readonly #stack: MirrorState[] = [];
  /** 借来规范化属性值、量字宽的真上下文（只写属性、只调 `measureText`，不产生绘制记录） */
  readonly #scratch: Ctx;
  readonly #initial: MirrorState;

  constructor(real: Ctx, scratch: Ctx) {
    this.#scratch = scratch;
    const props = new Map<string, unknown>();
    const r = real as unknown as Record<string, unknown>;
    for (const k of STATE_PROPS) if (k in r) props.set(k, r[k]);
    const t = typeof real.getTransform === 'function' ? real.getTransform() : null;
    const m: M6 = t === null ? [1, 0, 0, 1, 0, 0] : [t.a, t.b, t.c, t.d, t.e, t.f];
    const dash = typeof real.getLineDash === 'function' ? real.getLineDash() : [];
    this.#s = { props, m, dash };
    this.#initial = cloneState(this.#s);
  }

  has(p: string): boolean {
    return this.#s.props.has(p);
  }
  get(p: string): unknown {
    return this.#s.props.get(p);
  }
  set(p: string, v: unknown): void {
    // 与真上下文同一套规范化（非法值忽略、颜色 / 字体改写成规范串）
    const sc = this.#scratch as unknown as Record<string, unknown>;
    if (this.#s.props.has(p)) sc[p] = this.#s.props.get(p);
    sc[p] = v;
    this.#s.props.set(p, sc[p]);
  }
  snapshot(): Snapshot {
    return cloneState(this.#s);
  }

  /** 状态类方法（路径 / 裁剪类不跟踪，直接忽略） */
  call(name: string, a: readonly unknown[]): void {
    const s = this.#s;
    const n = (i: number): number => Number(a[i]);
    switch (name) {
      case 'save':
        this.#stack.push(cloneState(s));
        return;
      case 'restore': {
        const top = this.#stack.pop();
        if (top !== undefined) this.#s = top;
        return;
      }
      case 'reset':
        this.#stack.length = 0;
        this.#s = cloneState(this.#initial);
        return;
      case 'translate':
        s.m = mul(s.m, [1, 0, 0, 1, n(0), n(1)]);
        return;
      case 'scale':
        s.m = mul(s.m, [n(0), 0, 0, n(1), 0, 0]);
        return;
      case 'rotate': {
        const c = Math.cos(n(0));
        const si = Math.sin(n(0));
        s.m = mul(s.m, [c, si, -si, c, 0, 0]);
        return;
      }
      case 'transform':
        s.m = mul(s.m, [n(0), n(1), n(2), n(3), n(4), n(5)]);
        return;
      case 'setTransform':
        if (a.length >= 6) s.m = [n(0), n(1), n(2), n(3), n(4), n(5)];
        else {
          const t = (a[0] ?? {}) as { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number };
          s.m = [t.a ?? 1, t.b ?? 0, t.c ?? 0, t.d ?? 1, t.e ?? 0, t.f ?? 0];
        }
        return;
      case 'resetTransform':
        s.m = [1, 0, 0, 1, 0, 0];
        return;
      case 'setLineDash':
        s.dash = Array.isArray(a[0]) ? (a[0] as number[]).map(Number) : s.dash;
        return;
      default:
    }
  }

  /** 查询类方法 */
  query(name: string, a: readonly unknown[]): unknown {
    const sc = this.#scratch as unknown as Record<string, unknown>;
    switch (name) {
      case 'getTransform': {
        const m = this.#s.m;
        return typeof DOMMatrix === 'undefined'
          ? { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }
          : new DOMMatrix([...m]);
      }
      case 'getLineDash':
        return [...this.#s.dash];
      case 'measureText':
        // 字宽只取决于字体那几项 —— 把镜像的值抄到借来的上下文上再量
        for (const k of TEXT_PROPS) if (this.#s.props.has(k)) sc[k] = this.#s.props.get(k);
        return (sc.measureText as (t: string) => TextMetrics).call(this.#scratch, String(a[0]));
      default:
        // 造对象类（渐变 / 图案 / ImageData…）与状态无关，借来的上下文照样造得出来
        return (sc[name] as (...x: unknown[]) => unknown).apply(this.#scratch, a as unknown[]);
    }
  }
}

/** 影响 `measureText` 的那几项 */
const TEXT_PROPS = ['font', 'letterSpacing', 'wordSpacing', 'fontKerning', 'fontStretch', 'fontVariantCaps', 'textRendering', 'direction'] as const;

export interface DisplayListStats {
  /** `beginFrame` 次数 */
  frames: number;
  /** 真的画了（指令表与上一帧不同）的帧 */
  painted: number;
  /** 指令表与上一帧完全相同、整帧跳过的 */
  skipped: number;
  /** `?dlverify=1`：本该跳过、实际一画像素却变了的帧（应当恒为 0） */
  verifyMismatches: number;
}

export interface DisplayListOptions {
  /** 开发期自检：一律直通执行，并逐像素核对「本该跳过」的帧 */
  verify?: boolean;
  /** 借来规范化属性、量字宽的上下文（测试注入假的；缺省是一块 1×1 的 `<canvas>`，从不在上面画东西） */
  makeScratch?: () => Ctx;
}

const OP_CALL = 0;
const OP_SET = 1;

export class DisplayList {
  readonly #reals: Ctx[] = [];
  readonly #mirrors: StateMirror[] = [];
  readonly #verify: boolean;
  readonly #makeScratch: () => Ctx;
  #scratch: Ctx | null = null;
  /** 本帧的指令表（扁平：ctx, kind, name, argc, ...args） */
  #cur: unknown[] = [];
  /** 上一帧的 */
  #prev: unknown[] = [];
  /** 与 `#prev` 比到了哪儿 */
  #pos = 0;
  #inFrame = false;
  /** 本帧到目前为止与上一帧逐条相同 */
  #tracking = false;
  /** 指令还压着没执行（= `#tracking` 且不是自检模式） */
  #holding = false;
  /** 上一帧整帧跳过了（真上下文的状态可能落后于镜像） */
  #lastSkipped = false;
  /** 下一帧不许跳（帧外有人画过 / 有位图关掉了 / 宿主要求） */
  #forceNext = true;
  #snaps: Snapshot[] | null = null;
  #verifyPixels: (ImageData | null)[] | null = null;
  readonly stats: DisplayListStats = { frames: 0, painted: 0, skipped: 0, verifyMismatches: 0 };

  constructor(opts: DisplayListOptions = {}) {
    this.#verify = opts.verify === true;
    this.#makeScratch = opts.makeScratch ?? defaultScratch;
  }

  /** 正在帧内（`beginFrame` 之后、`endFrame` 之前） */
  get inFrame(): boolean {
    return this.#inFrame;
  }

  /** 下一帧必须真画（例如画布被外部改过） */
  invalidate(): void {
    this.#forceNext = true;
  }

  /**
   * 包一个真上下文，返回录制代理（类型照旧是 `CanvasRenderingContext2D`，调用方无感）。
   * 它的画布登记为「按身份比」—— 画布内容由同一张指令表里、排在前面的指令决定。
   */
  wrap(real: Ctx): Ctx {
    const id = this.#reals.length;
    this.#scratch ??= this.#makeScratch();
    const mirror = new StateMirror(real, this.#scratch);
    this.#reals.push(real);
    this.#mirrors.push(mirror);
    staticSources.add(real.canvas);
    const fns = new Map<string, (...args: unknown[]) => unknown>();
    const fnFor = (name: string): ((...args: unknown[]) => unknown) => {
      let f = fns.get(name);
      if (f === undefined) {
        if (DRAW.has(name)) f = (...args) => this.#op(id, OP_CALL, name, args, true);
        else if (QUERY.has(name)) f = (...args) => mirror.query(name, args);
        else if (PASSTHRU.has(name)) f = (...args) => (real as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!.apply(real, args);
        else if (READBACK.has(name)) {
          f = (...args) => {
            if (this.#inFrame) this.#diverge();
            return (real as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!.apply(real, args);
          };
        } else {
          f = (...args) => {
            mirror.call(name, args);
            this.#op(id, OP_CALL, name, args, false);
          };
        }
        fns.set(name, f);
      }
      return f;
    };
    return new Proxy(real, {
      get: (_t, p) => {
        if (p === 'canvas') return real.canvas;
        if (typeof p !== 'string') return Reflect.get(real, p);
        if (mirror.has(p)) return mirror.get(p);
        const v = (real as unknown as Record<string, unknown>)[p];
        if (typeof v === 'function') return fnFor(p);
        return v;
      },
      set: (_t, p, v) => {
        if (typeof p !== 'string') return Reflect.set(real, p, v);
        mirror.set(p, v);
        this.#op(id, OP_SET, p, [v], false);
        return true;
      },
    });
  }

  /** rAF 回调开头调 */
  beginFrame(): void {
    if (this.#inFrame) this.endFrame();
    this.#inFrame = true;
    this.stats.frames++;
    this.#cur.length = 0;
    this.#pos = 0;
    this.#snaps = this.#lastSkipped ? this.#mirrors.map((m) => m.snapshot()) : null;
    if (this.#verify) this.#verifyPixels = this.#reals.map(readAll);
    const forced = this.#forceNext;
    this.#forceNext = false;
    this.#tracking = true;
    this.#holding = !this.#verify;
    if (forced) this.#diverge();
  }

  /**
   * rAF 回调结尾调。
   * @returns 这一帧真的画了（调用方据此决定要不要把舞台贴上屏）
   */
  endFrame(): boolean {
    if (!this.#inFrame) return false;
    const skip = this.#tracking && this.#pos === this.#prev.length;
    if (!skip && this.#holding) this.#diverge();
    if (this.#verify && this.#verifyPixels !== null) {
      // 自检模式下指令一律执行过了；「本该跳过」的帧前后像素必须一样
      if (skip) {
        const before = this.#verifyPixels;
        if (this.#reals.some((r, i) => !samePixels(readAll(r), before[i] ?? null))) this.stats.verifyMismatches++;
      }
      this.#verifyPixels = null;
    }
    const t = this.#prev;
    this.#prev = this.#cur;
    this.#cur = t;
    this.#cur.length = 0;
    this.#inFrame = false;
    this.#holding = false;
    this.#lastSkipped = skip && !this.#verify;
    if (skip) this.stats.skipped++;
    else this.stats.painted++;
    return !skip;
  }

  /** 位图 `close()` 之前调（`installBitmapCloseGuard`） */
  beforeBitmapClose(): void {
    if (this.#inFrame) this.#diverge();
    this.#forceNext = true;
  }

  #op(id: number, kind: number, name: string, args: unknown[], isDraw: boolean): void {
    const real = this.#reals[id]!;
    if (!this.#inFrame) {
      exec(real, kind, name, args);
      if (isDraw) this.#forceNext = true;
      return;
    }
    if (this.#tracking) {
      const prev = this.#prev;
      const p = this.#pos;
      let ok = prev[p] === id && prev[p + 1] === kind && prev[p + 2] === name && prev[p + 3] === args.length;
      for (let i = 0; ok && i < args.length; i++) ok = same(prev[p + 4 + i], args[i]);
      if (ok) this.#pos = p + 4 + args.length;
      else this.#diverge();
    }
    this.#cur.push(id, kind, name, args.length, ...args);
    if (!this.#holding) exec(real, kind, name, args);
  }

  /** 从这里起与上一帧不同：对齐状态、补放压着的前缀，之后直通 */
  #diverge(): void {
    this.#tracking = false;
    if (!this.#holding) return;
    this.#holding = false;
    if (this.#snaps !== null) {
      this.#snaps.forEach((s, i) => restoreSnapshot(this.#reals[i]!, s));
      this.#snaps = null;
    }
    const cur = this.#cur;
    for (let i = 0; i < cur.length; ) {
      const id = cur[i] as number;
      const kind = cur[i + 1] as number;
      const name = cur[i + 2] as string;
      const argc = cur[i + 3] as number;
      exec(this.#reals[id]!, kind, name, cur.slice(i + 4, i + 4 + argc));
      i += 4 + argc;
    }
  }
}

function exec(real: Ctx, kind: number, name: string, args: unknown[]): void {
  const r = real as unknown as Record<string, unknown>;
  if (kind === OP_SET) r[name] = args[0];
  else (r[name] as (...a: unknown[]) => unknown).apply(real, args);
}

function restoreSnapshot(real: Ctx, s: Snapshot): void {
  const r = real as unknown as Record<string, unknown>;
  for (const [k, v] of s.props) if (r[k] !== v) r[k] = v;
  if (typeof real.setTransform === 'function') real.setTransform(...s.m);
  if (typeof real.setLineDash === 'function') real.setLineDash(s.dash);
}

function defaultScratch(): Ctx {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  const m = c.getContext('2d');
  if (m === null) throw new Error('无法取得量字用的绘图上下文');
  return m;
}

function readAll(real: Ctx): ImageData | null {
  try {
    return real.getImageData(0, 0, real.canvas.width, real.canvas.height);
  } catch {
    return null;
  }
}

function samePixels(a: ImageData | null, b: ImageData | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.data.length !== b.data.length) return false;
  const x = new Uint32Array(a.data.buffer, a.data.byteOffset, a.data.length >> 2);
  const y = new Uint32Array(b.data.buffer, b.data.byteOffset, b.data.length >> 2);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/**
 * 让 `ImageBitmap.prototype.close` 先知会指令表（压着的前缀先补放，再关）。
 * 只装一次；没有 `ImageBitmap` 的环境（Node 单测）什么都不做。
 */
export function installBitmapCloseGuard(list: DisplayList): void {
  if (typeof ImageBitmap === 'undefined') return;
  const proto = ImageBitmap.prototype as unknown as { close: () => void; __dlGuard?: boolean };
  if (proto.__dlGuard === true) return;
  const orig = proto.close;
  proto.close = function (this: ImageBitmap): void {
    list.beforeBitmapClose();
    orig.call(this);
  };
  proto.__dlGuard = true;
}
