/*
 * 出口守卫：浏览器安全的那条 barrel 不许够得着 `node:*`
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这条测试的存在理由就是 Q-BUILD-1：`sprite.ts` 里一行 `import 'node:zlib'`
 *   让整个前端包在浏览器里**加载即失败**，而所有测试仍然全绿 —— 因为它们跑在
 *   Node 下，`node:zlib` 在那儿是真的。类型检查与 lint 也看不出。
 *
 *   只有「沿着 import 走一遍、看够不够得着 node:」这件事能在 Node 里发现它。
 *   所以这条守卫放在这里，而不是靠谁记得别在前端模块里写 `node:`。
 *
 * 走的是**真实源码的 import 语句**（正则抓 `from '...'`），不是运行时行为 ——
 * 因为要抓的正是「vite 打包时会不会把它 static import 进来」。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));

/** 抓出文件里的相对 import（`from './x.ts'`）与包 import（`from 'node:xxx'`）*/
function importsOf(file: string): { rel: string[]; bare: string[] } {
  const text = readFileSync(file, 'utf8');
  const rel: string[] = [];
  const bare: string[] = [];
  for (const m of text.matchAll(/from\s+'([^']+)'/g)) {
    const spec = m[1]!;
    if (spec.startsWith('.')) rel.push(resolve(dirname(file), spec));
    else bare.push(spec);
  }
  return { rel, bare };
}

/** 从入口出发，收集所有能到达的文件与所有能到达的裸模块名 */
function reachable(entry: string): { files: Set<string>; bare: Set<string> } {
  const files = new Set<string>();
  const bare = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const f = queue.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    const { rel, bare: b } = importsOf(f);
    for (const x of b) bare.add(x);
    for (const r of rel) queue.push(r);
  }
  return { files, bare };
}

const entryOf = (name: string): string => resolve(SRC, name);

describe('★ index.ts（前端用的那条 barrel）不许够得着 node:*', () => {
  const graph = reachable(entryOf('index.ts'));

  it('★ 没有任何 node: 模块', () => {
    const nodeModules = [...graph.bare].filter((b) => b.startsWith('node:'));
    expect(nodeModules).toEqual([]);
  });

  it('★ 也够不着 png.ts —— 它是唯一用 zlib 的模块', () => {
    // 间接路径也算：`index → assemble → png → node:zlib` 曾经就是这么漏的
    const png = entryOf('png.ts');
    expect([...graph.files]).not.toContain(png);
  });

  it('确实走进了不少模块（不是入口没抓对导致空跑）', () => {
    // 防的是「正则没匹配上、测试其实什么都没检查」——所以指名道姓列几个应当可达的
    for (const name of ['mkf.ts', 'sprite.ts', 'ground.ts', 'upscale.ts', 'seams.ts']) {
      expect([...graph.files]).toContain(entryOf(name));
    }
    expect(graph.files.size).toBeGreaterThan(8);
  });
});

describe('node.ts（Node 专用出口）够得着 png.ts', () => {
  it('★ 那条出口本来就该带 zlib —— 它是给 CLI 与 assemble 用的', () => {
    const graph = reachable(entryOf('node.ts'));
    expect([...graph.files]).toContain(entryOf('png.ts'));
    expect([...graph.bare]).toContain('node:zlib');
  });
});
