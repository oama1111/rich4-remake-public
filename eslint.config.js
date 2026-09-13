// @ts-check
import tseslint from 'typescript-eslint';

/**
 * 本配置把 DEVELOPMENT_PLAN.md §5 的硬约束变成机器可强制执行的规则。
 * 违反 = CI 失败，而不是靠人自觉。
 */

/** C-DET-1/2/3：core 包必须完全确定性 —— 禁止一切非确定性来源 */
const determinismRules = {
  'no-restricted-globals': [
    'error',
    { name: 'Date', message: 'C-DET-2: core 内禁止读真实时间。游戏内日期由状态机推进，真实时间由外部注入。' },
    { name: 'performance', message: 'C-DET-2: core 内禁止 performance.now()。' },
  ],
  'no-restricted-properties': [
    'error',
    { object: 'Math', property: 'random', message: 'C-DET-1: core 内禁止 Math.random()。请使用 core/rng 的可种子化 PRNG。' },
    { object: 'Date', property: 'now', message: 'C-DET-2: core 内禁止 Date.now()。' },
    { object: 'Object', property: 'keys', message: 'C-DET-5: 禁止用 Object.keys 驱动逻辑（顺序不保证）。请使用显式有序数组。' },
    { object: 'Object', property: 'values', message: 'C-DET-5: 禁止用 Object.values 驱动逻辑（顺序不保证）。请使用显式有序数组。' },
    { object: 'Object', property: 'entries', message: 'C-DET-5: 禁止用 Object.entries 驱动逻辑（顺序不保证）。请使用显式有序数组。' },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='Date']",
      message: 'C-DET-2: core 内禁止 new Date()。',
    },
    {
      // 拦截**裸除法**。直接包在 Math.trunc/floor/ceil/round 里的除法是允许的
      // —— 那正是本规则要求的写法（原版 idiv 即向零取整，对应 Math.trunc）。
      // fround 对应原版把结果存为 32 位 float 的场合（fstp dword），
      // 用它比裸除法更保真，故一并放行。
      selector:
        ":not(CallExpression[callee.object.name='Math'][callee.property.name=/^(trunc|floor|ceil|round|fround)$/]) > BinaryExpression[operator='/']",
      message:
        'C-DET-3: 金额计算必须用整数。除法必须直接包在 Math.trunc/floor 里显式取整，并注明原版的取整方式（原版 idiv = 向零取整 = Math.trunc）。',
    },
  ],
};

/** C-ARC-1：core 零依赖 —— 不得引入 DOM / Node / 第三方库 */
const zeroDepRules = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        { group: ['node:*', 'fs', 'path', 'crypto', 'os', 'http', 'https', 'child_process'], message: 'C-ARC-1: core 不得依赖 Node API（必须能跑在浏览器/Worker 里）。' },
        { group: ['pixi.js', '@pixi/*', 'react', 'vue'], message: 'C-ARC-1: core 不得依赖渲染层。' },
        { group: ['@rich4/client', '@rich4/server', '@rich4/assets-pipeline'], message: 'C-ARC-2: core 不得反向依赖上层包。' },
      ],
    },
  ],
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.tsbuildinfo', 'src-tauri/**'] },

  // 基线：全仓库
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error', // C-ENG-3
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
    },
  },

  // core 包：叠加确定性 + 零依赖硬约束
  {
    files: ['packages/core/**/*.ts'],
    rules: { ...determinismRules, ...zeroDepRules },
  },

  // rng 实现自身允许定义 PRNG（但仍禁止 Math.random）
  {
    files: ['packages/core/src/rng/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off', // PRNG 内部需要位运算与除法
    },
  },

  // data 包：数值表，允许长文件，但禁止 any
  {
    files: ['packages/data/**/*.ts'],
    rules: { ...zeroDepRules },
  },

  // 测试与工具链不受确定性约束
  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'packages/assets-pipeline/**/*.ts', 'packages/server/**/*.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },
);
