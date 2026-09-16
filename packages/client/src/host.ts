/*
 * 宿主环境 —— 浏览器 还是 Tauri 桌面壳
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 两种宿主的唯一差别是**素材从哪儿来**：
 *   - 浏览器：vite 的开发中间件把 `assets/game/` 挂在 `/assets/game/*`
 *   - 桌面壳：用户自己指的原版目录，经 `rich4://localhost/*` 协议读出来
 *
 *   把这点差别收在这一个文件里，其余代码只认一个 `assetBase()`。
 *
 * ★ 桌面版**素材随包**：mkf 与配乐都在 `.app` 的 `Resources/` 里，
 *   双击即可运行，不问任何路径。`pickGameDir` 只作**兜底**——
 *   包内素材缺失（例如从源码直接跑未打包的版本）时才用得上。
 */

/**
 * Tauri 注入的全局。没有它就是普通浏览器。
 *
 * ⚠️ 这个全局**只有在 `tauri.conf.json` 里打开 `app.withGlobalTauri`
 *   时才存在**。忘了打开的症状很有迷惑性：前端会以为自己在浏览器里，
 *   去 fetch `/assets/game/*`，拿回一份 index.html，再把 HTML 当成
 *   mkf 解析 —— 报出来的是「索引表偏移非法」，和素材损坏一模一样。
 */
interface TauriGlobal {
  core: {
    invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  };
}

function tauri(): TauriGlobal | null {
  const g = (globalThis as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
  return g !== undefined && typeof g.core?.invoke === 'function' ? g : null;
}

export function isDesktop(): boolean {
  return tauri() !== null;
}

/**
 * 素材的 URL 前缀。
 *
 * ⚠️ 桌面壳下用 `rich4://localhost` 而不是 IPC 命令：`map.mkf` 有 76MB，
 *   走 IPC 要先编码成 JSON 再解回来，内存与耗时都不可接受。
 *   自定义协议跟 HTTP 一样能流式返回，前端照常 `fetch` 即可。
 */
export function assetBase(): string {
  return isDesktop() ? 'rich4://localhost' : '/assets/game';
}

/**
 * HD 素材的 URL 前缀（REQ-11.1 / T-065）—— 与 `assetBase()` 同源，
 * 只把最后一节从 `game` 换成 `hd`。
 *
 * ⚠️ `assets/hd/` **不进版本库**（.gitignore），由超分管线产出；
 *   整个目录不存在时 `loadHdSource` 拿不到清单，缓存就整包走原图 —— 这是
 *   正常状态，不是错误。
 *
 * ★ **桌面壳那条路由已经接上了**（Q-PERF-1）：浏览器下这个前缀是
 *   `/assets/hd`，由 vite 的开发中间件挂出来；桌面下是
 *   `rich4://localhost/hd`，由 `src-tauri/src/lib.rs` 的 `is_hd_path` 分流到
 *   **HD 素材目录**（仓库/包内的 `assets/`），而不是原版安装目录。
 *   清单则拉 `${hdBase()}-manifest.json`（与 hd 目录同级，见 `cli-upscale.ts`
 *   的 `manifestPath`）—— 也就是 `rich4://localhost/hd-manifest.json`。
 *   ★ 这三条 URL 的形状是 `hdRelativePath` 之外的**第二个**要写读两侧对齐的点，
 *   故 Rust 那边的 `is_hd_path` 只放行这两条、不做任何字符串改写。
 *
 * ⚠️ 桌面端**打包**还没做：`tauri.conf.json` 的 `resources` 里没有 `assets/hd`
 *   （干净 clone 里该目录不存在，写进去会让没跑过超分管线的人构建失败）。
 *   所以 `cargo run` / dev 能拿到 HD，装好的 `.app` 还拿不到。
 */
export function hdBase(): string {
  return `${assetBase().replace(/\/game$/, '')}/hd`;
}

/** 桌面壳记着的原版目录；浏览器下恒为 null */
export async function currentGameDir(): Promise<string | null> {
  const t = tauri();
  if (t === null) return null;
  try {
    return (await t.core.invoke<string | null>('get_game_dir')) ?? null;
  } catch {
    return null;
  }
}

export interface PickResult {
  ok: boolean;
  dir: string | null;
  /** 失败原因，可直接显示给用户 */
  error: string | null;
}

/**
 * 弹一个目录选择框，让用户指出原版安装目录。
 *
 * 校验在 Rust 那边做（要求 `Data.mkf` / `map.mkf` / `Panel.mkf` / `jump.mkf`
 * 都在），缺了哪些会原样报回来 —— 比笼统的「目录不对」有用得多。
 */
export async function pickGameDir(): Promise<PickResult> {
  const t = tauri();
  if (t === null) return { ok: false, dir: null, error: '不是桌面版' };
  try {
    const chosen = await t.core.invoke<string | null>('plugin:dialog|open', {
      options: { directory: true, multiple: false, title: '请指出你的「大富翁4」安装目录' },
    });
    if (chosen === null || chosen === undefined) {
      return { ok: false, dir: null, error: null }; // 用户取消，不算错
    }
    const dir = await t.core.invoke<string>('set_game_dir', { path: chosen });
    return { ok: true, dir, error: null };
  } catch (e) {
    return { ok: false, dir: null, error: String(e) };
  }
}

/**
 * 把一行日志送到桌面壳的 stderr。
 *
 * ★ 桌面壳里没有浏览器控制台，前端报错**看不见**。有这条通道，
 *   `.app` 的 stderr 就是游戏日志。浏览器下是空操作。
 */
export function hostLog(text: string): void {
  const t = tauri();
  if (t === null) return;
  void t.core.invoke('log_line', { text }).catch(() => {
    /* 日志送不出去不该影响游戏 */
  });
}

// ============================================================
//  存档槽（T-053）
// ============================================================

/**
 * 存档槽的读写口。
 *
 * ★ 原版的存档是 `SAVE0.DAT`..`SAVE5.DAT`（6 个槽，0 号是自動存檔）。
 *   桌面版写成 `<系统应用数据目录>/saves/SAVE<n>.json`（**内容仍是 JSON**，
 *   不冒充原版二进制格式 —— 那要另一套序列化，见 Q-SAVE-1）；
 *   浏览器没有文件系统，退回 `localStorage`。
 */
export interface SaveStore {
  read(slot: number): string | null;
  /** 写不进去（配额满/只读）返回错误说明，成功返回 null */
  write(slot: number, json: string): string | null;
  /** 现在存在哪些槽 */
  slots(): number[];
}

/** 浏览器兜底：localStorage，键照原版文件名起，一眼能对上 */
function browserStore(): SaveStore {
  const key = (slot: number): string => `RICH4-REMAKE:SAVE${slot}.DAT`;
  const read = (slot: number): string | null => {
    try {
      return window.localStorage.getItem(key(slot));
    } catch {
      return null; // 隐私模式之类会直接抛
    }
  };
  return {
    read,
    write: (slot, json) => {
      try {
        window.localStorage.setItem(key(slot), json);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : '無法寫入存檔區';
      }
    },
    slots: () => {
      const out: number[] = [];
      for (let i = 0; i < 8; i++) if (read(i) !== null) out.push(i);
      return out;
    },
  };
}

/**
 * 桌面版：**启动时把所有槽读进内存**（`initSaveStore` 干这事），之后同步取用。
 *
 * 为什么不全异步：读档屏的每一行都要立刻知道「这槽是空的还是坏的」，
 * 而 Tauri 的文件 IO 是异步的 —— 于是开机预载一遍、平时读内存；
 * 写的时候回落到文件（写失败只记一条日志，不打断游戏）。
 */
interface DesktopStore extends SaveStore {
  /** 预载用：直接放进内存，不走文件写回 */
  seed(slot: number, raw: string): void;
  markLoaded(): void;
}

function desktopStore(t: NonNullable<ReturnType<typeof tauri>>): DesktopStore {
  const cache = new Map<number, string>();
  let loaded = false;
  return {
    read: (slot) => (loaded ? (cache.get(slot) ?? null) : null),
    write: (slot, json) => {
      cache.set(slot, json);
      void t.core.invoke('write_save', { slot, json }).catch((e: unknown) => {
        hostLog(`存檔寫入失敗：${String(e)}`);
      });
      return null;
    },
    slots: () => [...cache.keys()].sort((a, b) => a - b),
    seed: (slot, raw) => {
      cache.set(slot, raw);
    },
    markLoaded: () => {
      loaded = true;
    },
  };
}

let store: SaveStore | null = null;

/** 当前存档口（未初始化时退回浏览器实现） */
export function saveStore(): SaveStore {
  store ??= browserStore();
  return store;
}

/**
 * 启动时调一次。
 *
 * - 给了 `override` 就用它（测试注入用）；
 * - 浏览器下等价于初始化成 localStorage；
 * - 桌面版把槽位预载进内存；预载失败也不让读档屏整屏崩，退回浏览器实现。
 */
export async function initSaveStore(override?: SaveStore): Promise<void> {
  if (override !== undefined) {
    store = override;
    return;
  }
  const t = tauri();
  if (t === null) {
    store = browserStore();
    return;
  }
  const s = desktopStore(t);
  store = s;
  try {
    for (const slot of await t.core.invoke<number[]>('list_saves')) {
      const raw = await t.core.invoke<string | null>('read_save', { slot });
      if (raw !== null) s.seed(slot, raw);
    }
    s.markLoaded();
  } catch (e) {
    hostLog(`存檔預載失敗：${String(e)}`);
    store = browserStore();
  }
}

// ============================================================
//  音色库（Q8）
// ============================================================

/**
 * 浏览器兜底：让用户选一个 `.sf2`。
 *
 * ⚠️ 浏览器没有文件系统，**不落盘** —— 每次打开都得重选一次。这是取舍：
 *   与其偷偷塞进 IndexedDB（几十 MB 的配额风险、清了还不知道为什么没声），
 *   不如如实告诉用户「这一份只在本次有效」。
 */
function pickSoundFontInBrowser(): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.sf2,audio/x-soundfont';
    input.style.display = 'none';
    input.onchange = () => {
      const file = input.files?.[0];
      input.remove();
      if (file === undefined) {
        resolve(null);
        return;
      }
      void file
        .arrayBuffer()
        .then((buf) => resolve(new Uint8Array(buf)))
        .catch(() => resolve(null));
    };
    // 用户按取消时 `change` 不触发；`cancel` 目前只有部分浏览器有。
    // 宁可留一个不 resolve 的 Promise，也不要自作聪明地猜「他选完了」。
    document.body.append(input);
    input.click();
  });
}

/** 选音色库的结果：`data` 有值就是选到了；`error` 可直接显示给用户 */
export interface SoundFontPick {
  data: Uint8Array | null;
  name: string | null;
  error: string | null;
}

/**
 * 弹一个文件框让用户指一个 `.sf2`，拿回**字节**。
 *
 * - 桌面版：Tauri dialog 选文件 → `set_soundfont` 收进
 *   `<AppData>/soundfont/` → 再从 `rich4://localhost/soundfont/<名>` 读回来。
 *   收进应用目录是为了**下次自动用**；读回来是为了喂给播放器。
 * - 浏览器：`<input type=file>`，只在本次有效。
 *
 * ⚠️ 音色库**由用户自备**，本项目不分发任何 `.sf2`（DEVELOPMENT_PLAN §5.6）。
 */
export async function pickSoundFont(): Promise<SoundFontPick> {
  const t = tauri();
  if (t === null) {
    const data = await pickSoundFontInBrowser();
    return data === null
      ? { data: null, name: null, error: null } // 取消不算错
      : { data, name: '（本次有效，未存档）', error: null };
  }
  try {
    const chosen = await t.core.invoke<string | null>('plugin:dialog|open', {
      options: {
        directory: false,
        multiple: false,
        title: '选择音色库（.sf2）—— 本项目不附带，需自备',
        filters: [{ name: 'SoundFont 2', extensions: ['sf2'] }],
      },
    });
    if (chosen === null || chosen === undefined) return { data: null, name: null, error: null };
    const name = await t.core.invoke<string>('set_soundfont', { path: chosen });
    const data = await readSoundFont(name);
    if (data === null) return { data: null, name, error: '音色库收下了，但读不回来' };
    return { data, name, error: null };
  } catch (e) {
    return { data: null, name: null, error: String(e) };
  }
}

/**
 * 启动时把**上次装的**音色库读回来；没装返回 `null`。
 *
 * 桌面版才可能有 —— 音色库存在应用数据目录里，浏览器没有这一层。
 */
export async function loadSavedSoundFont(): Promise<{ name: string; data: Uint8Array } | null> {
  const t = tauri();
  if (t === null) return null;
  try {
    const name = await t.core.invoke<string | null>('soundfont_status');
    if (name === null || name === undefined) return null;
    const data = await readSoundFont(name);
    return data === null ? null : { name, data };
  } catch {
    return null;
  }
}

/** 从 `rich4://localhost/soundfont/<名>` 读回来（桌面版专用） */
async function readSoundFont(name: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`rich4://localhost/soundfont/${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// ============================================================
//  配置文件 `RICH4.CFG`（72 字节）
// ============================================================

/**
 * 配置文件的读写口。
 *
 * ★ 原版把**全部设定 + 28 条键位**存在游戏目录里那一个 72 字节的文件里：
 *   開機 `rich4_read_config()`（VA 0x00411e8f）读、設定屏/熱鍵頁「確定」调
 *   `rich4_write_config()`（VA 0x00411f80）整份写回。
 *   本引擎先前没有这个读写，所以熱鍵改完重开就没了（登记为 `Q-OPT-1`）。
 *
 * ⚠️ 两份实现的**落点不同**，这是有意的（浏览器没有文件系统）：
 *   - 桌面版：游戏目录 / 应用数据目录里的真文件（Rust 侧 `read_config`/`write_config`）；
 *   - 浏览器：`localStorage`（Base64），键名照原版文件名起，一眼能对上。
 */
export interface ConfigStore {
  /** 读整份；没有/读不出来返回 `null`（调用方退回默认） */
  read(): Uint8Array | null;
  /** 写整份；失败返回错误说明，成功返回 `null` */
  write(bytes: Uint8Array): string | null;
}

/** 浏览器兜底：localStorage 里存 Base64（原版那是二进制文件，浏览器只能这样） */
function browserConfigStore(): ConfigStore {
  const KEY = 'RICH4-REMAKE:RICH4.CFG';
  const toB64 = (b: Uint8Array): string => {
    let s = '';
    for (const x of b) s += String.fromCharCode(x);
    return window.btoa(s);
  };
  return {
    read: () => {
      let raw: string | null = null;
      try {
        raw = window.localStorage.getItem(KEY);
      } catch {
        return null; // 隐私模式之类会直接抛
      }
      if (raw === null) return null;
      try {
        const bin = window.atob(raw);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      } catch {
        return null; // 坏数据当没有
      }
    },
    write: (bytes) => {
      try {
        window.localStorage.setItem(KEY, toB64(bytes));
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : '無法寫入設定檔';
      }
    },
  };
}

/**
 * 桌面版：走 Rust 侧那两条命令（真文件）。
 *
 * ⚠️ 这两条命令**本仓库的 Rust 侧还没有**（见 `src-tauri/src/lib.rs` 的 TODO）——
 *   装不上时 `invoke` 会 reject，这里退回浏览器实现并记一条日志，**不让游戏崩**。
 */
function desktopConfigStore(t: NonNullable<ReturnType<typeof tauri>>): ConfigStore {
  let fallback: ConfigStore | null = null;
  const fb = (): ConfigStore => (fallback ??= browserConfigStore());
  return {
    read: () => fb().read(),
    write: (bytes) => {
      // 先在本地留一份（桌面版也保底），再试着写真文件
      const local = fb().write(bytes);
      void t.core
        .invoke('write_config', { bytes: [...bytes] })
        .catch((e: unknown) => hostLog(`設定檔寫入失敗（暫存於本機）：${String(e)}`));
      return local;
    },
  };
}

let cfgStore: ConfigStore | null = null;

/** 当前配置文件口（未初始化时退回浏览器实现） */
export function configStore(): ConfigStore {
  cfgStore ??= browserConfigStore();
  return cfgStore;
}

/** 启动时调一次（与 `initSaveStore` 同一个位置） */
export async function initConfigStore(override?: ConfigStore): Promise<void> {
  if (override !== undefined) {
    cfgStore = override;
    return;
  }
  const t = tauri();
  if (t === null) {
    cfgStore = browserConfigStore();
    return;
  }
  const s = desktopConfigStore(t);
  cfgStore = s;
  try {
    // 桌面版：先把真文件读出来塞进本机那份（读不到就保持空）
    const bytes = await t.core.invoke<number[] | null>('read_config');
    if (Array.isArray(bytes) && bytes.length > 0) {
      s.write(Uint8Array.from(bytes));
    }
  } catch (e) {
    hostLog(`設定檔預載失敗（用預設值）：${String(e)}`);
  }
}
