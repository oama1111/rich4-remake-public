/*
 * Node 专用出口 —— `@rich4/assets-pipeline/node`
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ **前端一律不要 import 这里。** 这条出口下面挂着用了 `node:*` 的模块
 *   （目前是 `png.ts` 的 `node:zlib`），打进浏览器包会在 vite 里变成
 *   「一访问就抛」的桩 —— 症状是页面永远停在「载入中…」（Q-BUILD-1）。
 *
 * 为什么要有两条出口：包里的模块**绝大多数是两面都能跑的**（纯 Uint8Array 运算），
 * 只有编解码 PNG 这件事绕不开 zlib。如果全都堆在一个 barrel 里，前端 import
 * 任何一个函数都会把 zlib 一起拖进来 —— 这就是 b99b459 之后的实际状况。
 * 拆开之后，「能不能进前端」这件事由**出口**表达，而不是靠每个调用方自己记得。
 *
 * CLI（`cli-extract.ts` / `cli-upscale.ts`）与 `assemble.ts` 都在这条线内。
 */
export * from './png.ts';
export * from './assemble.ts';
