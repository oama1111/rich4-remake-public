/*
 * 素材管线 —— **浏览器安全**出口
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这一条出口下面**不许出现 `node:*`**（Q-BUILD-1）。
 *   前端（client）与服务器都从这里取东西，它们跑在浏览器/webview/Node 里，
 *   一旦有 `node:` 被 vite externalize 成「一访问就抛」的桩，整个包加载即失败——
 *   症状是页面永远停在「载入中…」，而所有单测仍然全绿（它们跑在 Node 下）。
 *
 *   目前这一层的模块全是纯 `Uint8Array` 运算，两边都跑得：
 *   mkf 容器与解压 / SPR·SMP 解码 / GND 底图 / WAV / MIDI / 素材分类 /
 *   切片与合并 / 锚点与清单 / 接缝 / 过审页。
 *
 *   ⚠️ 用了 `node:zlib` 的 PNG 编解码**不在**这里，走 `@rich4/assets-pipeline/node`。
 *   前端要读 PNG 请交给浏览器原生解码（`createImageBitmap(new Blob([bytes]))`）。
 */
export * from './mkf.ts';
export * from './mkf-decompress.ts';
export * from './sprite.ts';
export * from './ground.ts';
export * from './audio.ts';
export * from './midi.ts';
export * from './classify.ts';
export * from './slice.ts';
export * from './merge.ts';
// ⚠️ assemble 不在这里：它引 png.ts（node:zlib）。走 @rich4/assets-pipeline/node。
export * from './seams.ts';
export * from './review.ts';
export * from './upscale.ts';
