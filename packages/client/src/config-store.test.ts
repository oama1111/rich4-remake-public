/*
 * `RICH4.CFG` 的读写口 —— 浏览器（localStorage）那一份
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版把全部设定 + 28 条键位存在游戏目录里那一个 72 字节文件里
 * （`rich4_read_config` VA 0x00411e8f / `rich4_write_config` VA 0x00411f80）。
 * 浏览器没有文件系统 ⇒ 落 `localStorage`（Base64），桌面版走 Rust 侧那两条命令。
 *
 * 这一条钉的是**浏览器那一份**的行为：往返无损、坏数据当没有、写不进去不炸，
 * 以及「main.ts 真的在开机读、在三个『確定』写」。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CONFIG_FILE_SIZE, decodeConfig, encodeConfig } from './config-file.ts';
import { configStore, initConfigStore } from './host.ts';

/** 够用的 localStorage 替身（含「写就抛」的配额满模式） */
function stubLocalStorage(opts: { throwOnWrite?: boolean } = {}): void {
  const map = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (opts.throwOnWrite === true) throw new Error('QuotaExceededError');
        map.set(k, v);
      },
      removeItem: (k: string) => void map.delete(k),
    },
    btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
    // ⚠️ 真浏览器的 `atob` 对**非法字符**会抛 `InvalidCharacterError`
    //   （`Buffer.from(..., 'base64')` 是**静默丢弃**，不是一回事）
    atob: (s: string) => {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error('InvalidCharacterError');
      return Buffer.from(s, 'base64').toString('binary');
    },
  };
}

/**
 * 拿当前这个配置口。
 *
 * ⚠️ `configStore()` 是**模块级单例**，这里靠 `initConfigStore()` 在
 * `beforeEach` 里把它重新指到一份浏览器实现上（`initConfigStore` 就是
 * 为测试注入留的口子，见 `host.ts`）；缓存的那一份读的也是**此刻**的
 * `window.localStorage`，所以每个用例换一个替身即可。
 */
async function freshStore(): Promise<{
  read(): Uint8Array | null;
  write(b: Uint8Array): string | null;
}> {
  return configStore();
}

beforeEach(async () => {
  stubLocalStorage();
  await initConfigStore();
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('★ 浏览器那一份：localStorage + Base64', () => {
  it('没存过 ⇒ 读回 null（调用方退回默认）', async () => {
    expect((await freshStore()).read()).toBeNull();
  });

  it('★ 往返无损：写 72 字节、读回来逐字节相同', async () => {
    const store = await freshStore();
    const bytes = new Uint8Array(CONFIG_FILE_SIZE);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 3) & 0xff;
    expect(store.write(bytes)).toBeNull();
    expect([...(store.read() ?? [])]).toEqual([...bytes]);
  });

  it('★ 拿原版那份 `RICH4.CFG` 走一遍往返 ⇒ 解出来的设定一致', async () => {
    const store = await freshStore();
    const raw = new Uint8Array(
      readFileSync(new URL('../../../assets/game/RICH4.CFG', import.meta.url)),
    );
    store.write(raw);
    const back = store.read()!;
    expect([...back]).toEqual([...raw]);
    expect(decodeConfig(back)).toEqual(decodeConfig(raw));
    // 再编回去也一样（证明这一路没丢字节）
    expect([...encodeConfig(decodeConfig(back)!)]).toEqual([...raw]);
  });

  it('★ 坏数据（不是 Base64）当「没有」，不抛', async () => {
    const store = await freshStore();
    (globalThis as { window: { localStorage: { setItem(k: string, v: string): void } } }).window.localStorage.setItem(
      'RICH4-REMAKE:RICH4.CFG',
      '这显然不是 base64!!',
    );
    expect(store.read()).toBeNull();
  });

  it('★ 配额满（写抛）⇒ 返回错误说明，**不抛**', async () => {
    stubLocalStorage({ throwOnWrite: true });
    const store = await freshStore();
    const err = store.write(new Uint8Array(CONFIG_FILE_SIZE));
    expect(err).not.toBeNull();
    expect(typeof err).toBe('string');
  });
});

describe('★ 接线：main.ts 开机读、三处「確定」写', () => {
  const src = (): string => readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('开机 `await initConfigStore()` + `loadConfigFromStore()`', () => {
    const s = src();
    expect(s).toContain('await initConfigStore();');
    expect(s).toContain('loadConfigFromStore();');
  });

  it('★ 三处「確定」都写回：設定屏主 OK / 日期頁 / 熱鍵頁', () => {
    const s = src();
    const at = [...s.matchAll(/saveConfigToStore\(\);/g)].map((m) => m.index!);
    // 定义处一次 `function saveConfigToStore()`
    const calls = at.filter((i) => !s.slice(Math.max(0, i - 40), i).includes('function '));
    expect(calls.length, '「確定」三处 + 可能更多').toBeGreaterThanOrEqual(3);
    // 主 OK：紧跟在 applyOptions 里那句 `music.stop()` 之后
    expect(s).toMatch(/if \(next\.music === 0\) music\.stop\(\);[\s\S]{0,600}?saveConfigToStore\(\);/);
    // 日期頁与熱鍵頁：都在 `optionsDate = {...}` / `optionsKeys = [...]` 之后
    expect(s).toMatch(/optionsDate = \{ \.\.\.sub\.draft \};[\s\S]{0,600}?saveConfigToStore\(\);/);
    expect(s).toMatch(/optionsKeys = \[\.\.\.sub\.keys\];[\s\S]{0,600}?saveConfigToStore\(\);/);
  });

  it('★ 日期那三个字节写的是**当前这一局的日期**（不在对局里才退回 optionsDate）', () => {
    const s = src();
    const at = s.indexOf('function saveConfigToStore()');
    expect(at).toBeGreaterThan(0);
    const body = s.slice(at, at + 900);
    expect(body).toContain("screen === 'game' ? { year: state.year, month: state.month, day: state.day }");
    expect(body).toContain('optionsKeys.map');
    expect(body).toContain('vk: w & 0xff');
    expect(body).toContain('mod: (w >> 8) & 0xff');
  });

  it('★ 开局日期**不**从 cfg 里取（原版紧接着用系统日期覆盖它）', () => {
    const s = src();
    const at = s.indexOf('function loadConfigFromStore()');
    const body = s.slice(at, at + 900);
    // 只应用那六个设定与键位，不碰日期
    expect(body).toContain('speed: cfg.speed');
    expect(body).toContain('optionsKeys = configHotkeyKeys(cfg);');
    expect(body).not.toContain('optionsDate =');
    expect(body).not.toContain('startDate');
  });
});
