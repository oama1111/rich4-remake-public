/*
 * 「不是我们的」未处理 rejection —— 浏览器扩展 / 系统注入脚本的消息桥超时
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 起因：2026-09-24 的自动回报 `20260924-021342002-error-Ch.json`（iPhone Safari，iOS 18.7，
 *   单机、第 0 回合、还停在標題屏，素材刚载完）：
 *   ```json
 *   { "kind": "unhandledrejection", "message": "NoResponse: No response from target", "stack": null }
 *   ```
 *   逐条排查后判定**不是本项目的代码**：
 *   1. 客户端源码与**全部依赖**（`node_modules/.pnpm` 整棵树）里都没有 `No response from target`
 *      / `NoResponse` 这串字 —— 打出去的包里不可能有人抛它。
 *   2. 消息里带着 `NoResponse:` 前缀、且 `stack` 为空：`main.ts` 的总闸对 `instanceof Error`
 *      取 `.message`（不带名字）与 `.stack`，走到 `String(reason)` 才会是「名字: 消息」——
 *      说明 reason **不是本页这个 realm 的 `Error`**（跨 realm 的错误对象 / 注入脚本自造的对象），
 *      正是扩展内容脚本、系统注入脚本那一类「另一个世界」里抛出来的东西。
 *   3. 本项目会产生 promise 的浏览器 API（`decodeAudioData`、`navigator.storage.persist`、
 *      `fetch`、Cache Storage）全都自带 `catch`；没有 `postMessage` / `BroadcastChannel` /
 *      Service Worker / `runtime.sendMessage`。
 *   4. 「没有回应」是扩展消息桥的典型失败（内容脚本 `sendMessage` 给后台页，后台页在 iOS 上
 *      被挂起 / 回收，另一端等不到回应）；Chrome 的同类是下表后三条。
 *
 * ⇒ 这类 rejection 不该让玩的人看到「⚠ 程式錯誤」，更不该自动落回报（一局只有 3 份名额）。
 *
 * ★ 过滤得**非常窄**：只有 ① 没有调用栈（我们自己的 `Error` 一定有栈）**且** ② 整句与下表
 *   某一条**完全吻合**才算。其余一切照旧报。被滤掉的也不是吞掉：`main.ts` 仍记进飞行记录仪
 *   （`note`）并送宿主日志，下一份真回报里看得到。
 */

/** 已知的扩展 / 注入脚本消息桥失败（整句匹配，大小写敏感）*/
export const EXTERNAL_REJECTION_PATTERNS: readonly RegExp[] = [
  // iOS Safari（2026-09-24 回报）：扩展消息桥等不到回应
  /^NoResponse: No response from target\.?$/,
  // Chrome / Chromium 系 `runtime.sendMessage`：对端不存在 / 端口先关 / 扩展被重载
  /^(Error: )?Could not establish connection\. Receiving end does not exist\.$/,
  /^(Error: )?The message port closed before a response was received\.$/,
  /^(Error: )?Extension context invalidated\.$/,
];

/**
 * 这条未处理 rejection 是不是**外来的**（扩展 / 系统注入脚本），不该当成本程序的错误。
 *
 * @param message `main.ts` 总闸算出来的那一句（`Error` 取 `.message`，否则 `String(reason)`）
 * @param stack   有栈 ⇒ 一律不算外来（本项目的错误都有栈）
 */
export function isExternalRejection(message: string, stack: string | null): boolean {
  if (stack !== null && stack.trim() !== '') return false;
  return EXTERNAL_REJECTION_PATTERNS.some((re) => re.test(message));
}
