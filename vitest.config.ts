// SPDX-License-Identifier: GPL-3.0-or-later
//
// 真值测试要读**仓库外**的原版目录（../Rich4、../extracted、../assets-clean、../rich4-re）。
// 这些路径一律从 RICH4_WORKSPACE 起算：默认 = 本仓库的上一级目录；
// 目录布局不同时（CI、别的机器）用同名环境变量覆盖。
// 找不到文件的真值测试会 skip —— 所以换机器后先确认它们**真的跑了**。
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const workspace =
  process.env.RICH4_WORKSPACE ?? fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');

export default defineConfig({
  test: {
    env: { RICH4_WORKSPACE: workspace },
  },
});
