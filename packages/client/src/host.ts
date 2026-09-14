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
