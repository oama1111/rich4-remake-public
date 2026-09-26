/*
 * 页面切到后台 / 回到前台（第十九份：「iPhone 上玩手机很烫」）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 切后台时浏览器会停掉 `requestAnimationFrame`，于是所有靠逐帧 tick 推进的演出原地冻住；
 *   而先前游戏自己的东西照跑：音频上下文一直 running（背景音乐继续排音符）、回合驱动与联机
 *   收件箱被演出挡着、按一个渲染周期（20 ms）空转重排（实测后台 AI 局每秒 49 次定时器）、
 *   演出死锁看门狗以为「15 秒没进展」就开始逐级强拆演出。
 *
 *   本模块只负责把两类页面事件归一成 `onHide` / `onShow` 两个回调（去重：连着两次 hide 只报一次）：
 *     · `visibilitychange`（切标签、锁屏、切 App）；
 *     · `pagehide` / `pageshow`（Safari 的往返缓存：页面整个被冻进 bfcache 时不一定先报 visibility）。
 *   真正要停什么、回来怎么续，由 `main.ts` 决定。
 */

export interface VisibilityDoc {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', cb: () => void): void;
}

export interface VisibilityWin {
  addEventListener(type: 'pagehide' | 'pageshow', cb: () => void): void;
}

export interface VisibilityHandlers {
  onHide(): void;
  onShow(): void;
}

/**
 * 装上监听。返回「此刻算不算在后台」的查询函数（与回调同一份状态）。
 */
export function installPageVisibility(doc: VisibilityDoc, win: VisibilityWin, h: VisibilityHandlers): () => boolean {
  let hidden = doc.hidden;
  const set = (next: boolean): void => {
    if (next === hidden) return;
    hidden = next;
    if (next) h.onHide();
    else h.onShow();
  };
  doc.addEventListener('visibilitychange', () => set(doc.hidden));
  win.addEventListener('pagehide', () => set(true));
  // bfcache 回来时 `document.hidden` 已经是 false；万一还在后台（预渲染）就不报
  win.addEventListener('pageshow', () => set(doc.hidden));
  return () => hidden;
}
