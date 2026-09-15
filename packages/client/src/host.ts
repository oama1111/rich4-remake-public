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
 * ⚠️ 桌面壳下 `rich4://localhost/<名>` 解析到的是**原版安装目录**，而 hd 产物
 *   在仓库/包内的 `assets/hd/`，两者不同源。桌面端要用上 HD 还得给这个协议
 *   加一条 hd 的路由（属打包范畴，见 Q-PERF-1）。今天 `assets/hd/` 是空的，
 *   所以这条差异还看不出来。
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
