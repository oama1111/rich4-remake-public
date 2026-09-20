/*
 * W-70：白名单 / 路径安全 / 缓存策略 / 预压缩选择 —— 纯函数判据
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这一份**不碰网络**：`static.ts` 里的每条判据各自钉一遍。
 *   真正的 HTTP 行为在 `http-server.test.ts`（真 `http.Server` + 随机端口）。
 *
 * ★ 这里钉的是「**哪些文件能端出去**」——`assets/game/` 里有 `rich4.exe`、
 *   `Uninst.exe`、存档、`.avi`。漏一个就是分发原版程序，故逐条写死。
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MKF_WHITELIST,
  ROBOTS_TXT,
  SECURITY_HEADERS,
  acceptsEncoding,
  cacheControlFor,
  contentTypeFor,
  findOnDisk,
  isAllowedAssetName,
  precompressedFor,
  resolveUnder,
  safeRelativePath,
} from './static.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'rich4-w70-static-'));
}

describe('★ 素材白名单', () => {
  it('7 个 .mkf 一个不多一个不少', () => {
    expect([...MKF_WHITELIST]).toEqual([
      'Data.mkf',
      'Panel.mkf',
      'map.mkf',
      'jump.mkf',
      'help.mkf',
      'Speaking.mkf',
      'Effect.mkf',
    ]);
    for (const n of MKF_WHITELIST) expect(isAllowedAssetName(n)).toBe(true);
  });

  it('大小写不敏感（main.ts 先试原名再试小写）', () => {
    expect(isAllowedAssetName('data.mkf')).toBe(true);
    expect(isAllowedAssetName('DATA.MKF')).toBe(true);
    expect(isAllowedAssetName('MIDI01.MID')).toBe(true);
    expect(isAllowedAssetName('midi01.mid')).toBe(true);
    expect(isAllowedAssetName('midi14-1.mid')).toBe(true);
    expect(isAllowedAssetName('Rich08.mid')).toBe(true);
  });

  it('白名单之外一律不放行 —— rich4.exe / 存档 / .avi / 索引 / 压缩产物', () => {
    for (const n of [
      'rich4.exe',
      'Uninst.exe',
      'Save0.dat',
      'SAVE0.DAT',
      'Start.avi',
      'Airplane.avi',
      'midi01.wav',
      'InstOK.wav',
      'earth.ico',
      'Midi.txt',
      'Data.mkf.br',
      'Data.mkf.gz',
      'Data.txt',
      'DataX.mkf',
      'Data',
      '',
      '.',
      '..',
    ]) {
      expect(isAllowedAssetName(n), n).toBe(false);
    }
  });

  it('多段路径不放行（模式里没有 "/"，"整条匹配"）', () => {
    expect(isAllowedAssetName('sub/Data.mkf')).toBe(false);
    expect(isAllowedAssetName('/Data.mkf')).toBe(false);
    expect(isAllowedAssetName('sub\\Data.mkf')).toBe(false);
  });
});

describe('★ 路径安全', () => {
  it('正常名字原样通过', () => {
    expect(safeRelativePath('Data.mkf')).toEqual({ ok: true, rel: 'Data.mkf' });
    expect(safeRelativePath('assets/index-abcd1234.js')).toEqual({ ok: true, rel: 'assets/index-abcd1234.js' });
    expect(safeRelativePath('')).toEqual({ ok: true, rel: '' });
  });

  it('坏的 % 转义 → 400', () => {
    expect(safeRelativePath('%')).toEqual({ ok: false, status: 400 });
    expect(safeRelativePath('%zz')).toEqual({ ok: false, status: 400 });
  });

  it('.. / \\ / \\0 / 开头就是 / → 400', () => {
    for (const bad of ['../package.json', '%2e%2e%2fpackage.json', 'a/../b', '..', '..%2f..', 'a\\b', 'a%00b', '/etc/passwd', '/']) {
      expect(safeRelativePath(bad), bad).toEqual({ ok: false, status: 400 });
    }
  });

  it('先解码再判 —— 编码过的 .. 也挡得住', () => {
    expect(safeRelativePath('%2E%2E/package.json')).toEqual({ ok: false, status: 400 });
    expect(safeRelativePath('.%2e/package.json')).toEqual({ ok: false, status: 400 });
  });
});

describe('★ resolveUnder —— 解析后必须还在根目录里面', () => {
  it('根目录里的路径通过', () => {
    expect(resolveUnder('/srv/rich4', 'assets/game/Data.mkf')).toBe('/srv/rich4/assets/game/Data.mkf');
  });

  it('排到根目录外面 → null（403）', () => {
    expect(resolveUnder('/srv/rich4', '../package.json')).toBeNull();
    expect(resolveUnder('/srv/rich4', 'a/../../b')).toBeNull();
  });

  it('解析结果就是根目录本身 → null（不是"根目录里面的文件"）', () => {
    expect(resolveUnder('/srv/rich4', '')).toBeNull();
    expect(resolveUnder('/srv/rich4', '.')).toBeNull();
  });

  it('★ 前缀相同时不能误认：/srv/rich4 不该认下 /srv/rich4-other', () => {
    expect(resolveUnder('/srv/rich4', '../rich4-other/x')).toBeNull();
  });
});

describe('★ findOnDisk —— 大小写不敏感地找磁盘文件', () => {
  it('原名在就直接给；不在就按小写找真实名字', () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, 'midi01.mid'), 'x');
      writeFileSync(join(dir, 'Data.mkf'), 'y');
      expect(findOnDisk(dir, 'midi01.mid')).toBe(join(dir, 'midi01.mid'));
      expect(findOnDisk(dir, 'MIDI01.MID')).toBe(join(dir, 'midi01.mid'));
      expect(findOnDisk(dir, 'data.mkf')).toBe(join(dir, 'Data.mkf'));
      expect(findOnDisk(dir, 'nope.mkf')).toBeNull();
      expect(findOnDisk(join(dir, 'no-such-dir'), 'Data.mkf')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('★ 缓存策略', () => {
  it('素材一年不可变、且是 private（整站有访问密码）', () => {
    expect(cacheControlFor('asset', 'Data.mkf')).toBe('private, max-age=31536000, immutable');
  });

  it('带哈希的构建产物不可变；其余的 no-cache', () => {
    expect(cacheControlFor('web', 'assets/index-C3t3qLJy.js')).toBe('private, max-age=31536000, immutable');
    expect(cacheControlFor('web', 'assets/index-abc12345.css')).toBe('private, max-age=31536000, immutable');
    // 没哈希的**不能**标 immutable，否则改了内容浏览器也永远拿旧的
    expect(cacheControlFor('web', 'assets/app.js')).toBe('no-cache');
    expect(cacheControlFor('web', 'assets/short-abc.css')).toBe('no-cache');
    expect(cacheControlFor('web', 'index.html')).toBe('no-cache');
    expect(cacheControlFor('web', '')).toBe('no-cache');
  });
});

describe('★ 内容类型', () => {
  it('认得站点要用的那几种，其余按二进制流', () => {
    expect(contentTypeFor('index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('assets/x.js')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('assets/x.css')).toBe('text/css; charset=utf-8');
    expect(contentTypeFor('Data.mkf')).toBe('application/octet-stream');
    expect(contentTypeFor('midi01.mid')).toBe('audio/midi');
    expect(contentTypeFor('weird.xyz')).toBe('application/octet-stream');
  });
});

describe('★ Accept-Encoding 与预压缩', () => {
  it('认 token，也认 q=0 的明确拒绝', () => {
    expect(acceptsEncoding('gzip, deflate, br', 'br')).toBe(true);
    expect(acceptsEncoding('gzip, deflate, br', 'gzip')).toBe(true);
    expect(acceptsEncoding('gzip', 'gzip')).toBe(true);
    expect(acceptsEncoding('gzip;q=0', 'gzip')).toBe(false);
    expect(acceptsEncoding('*', 'br')).toBe(true);
    expect(acceptsEncoding('*;q=0', 'br')).toBe(false);
    expect(acceptsEncoding('br;q=0.5', 'br')).toBe(true);
    expect(acceptsEncoding(undefined, 'br')).toBe(false);
    expect(acceptsEncoding('', 'br')).toBe(false);
  });

  it('同目录有 .br/.gz 时优先 br，其次 gz，都没有就 null（端原文件）', () => {
    const dir = tempDir();
    try {
      mkdirSync(dir, { recursive: true });
      const abs = join(dir, 'Data.mkf');
      writeFileSync(abs, 'raw');
      expect(precompressedFor('br, gzip', abs)).toBeNull();

      writeFileSync(abs + '.gz', 'g');
      expect(precompressedFor('br, gzip', abs)).toEqual({ file: abs + '.gz', encoding: 'gzip' });
      expect(precompressedFor('gzip', abs)).toEqual({ file: abs + '.gz', encoding: 'gzip' });
      expect(precompressedFor('br', abs)).toBeNull();

      writeFileSync(abs + '.br', 'b');
      expect(precompressedFor('br, gzip', abs)).toEqual({ file: abs + '.br', encoding: 'br' });
      expect(precompressedFor('gzip', abs)).toEqual({ file: abs + '.gz', encoding: 'gzip' });
      expect(precompressedFor('identity', abs)).toBeNull();
      expect(precompressedFor(undefined, abs)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('★ 固定响应头与 robots.txt', () => {
  it('三个安全头逐字写死', () => {
    expect(SECURITY_HEADERS).toEqual({
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
  });

  it('/robots.txt 正文逐字相等', () => {
    expect(ROBOTS_TXT).toBe('User-agent: *\nDisallow: /\n');
  });
});
