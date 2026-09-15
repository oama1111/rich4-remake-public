/*
 * 掷骰的本地预测动画（T-075 / PRD REQ-14.2）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 联机时局面由**服务器**定序：本地点 GO 之后，真正的点数要等服务器把
 * `action{rollDice}` 广播回来才知道。等这一趟往返（几十到几百毫秒）画面
 * 干等着会显得卡，所以先播一段滚动动画——这就是「本地预测」的全部内容。
 *
 * ★ 三条铁律：
 *   1. **不读 `state.dice`**。那是权威值，此刻还没到；读了就等于本地先算了一遍，
 *      与服务器不一致时会闪一下真值再跳回去。
 *   2. **不用 `Math.random`**。滚动只是表现，用不着随机性；改成
 *      「(帧号, 颗号) 的确定性散列」之后，同一帧永远同一张脸——测试能钉死，
 *      录像比对也能复现。
 *   3. **不往 state 里写任何东西**。动画是纯表现的，进了 `history`/自动存档
 *      就会破坏 C-DET-4 的同种子重放一致性。
 *
 * ⚠️ 预测只预测「看起来像在滚」，**不预测点数**——真点数到达前画面上任何一个
 *   数字都只是装饰。服务器回来就立刻定格到真值。
 */

/** 每帧换一次脸的间隔（毫秒）。约 60ms 接近原版的手感 */
export const ROLL_FRAME_MS = 60;

/**
 * 最长滚多久（毫秒）。
 *
 * 服务器没回（断线、房间没了）时不能一直转下去假装在滚——到点就交还给
 * 权威显示，哪怕它还是旧的。**假装比诚实更糟**：玩家会以为自己在等服务器，
 * 其实什么都没发生。
 */
export const ROLL_TIMEOUT_MS = 3000;

/** 32 位整数散列（MurmurHash3 的 finalizer），把 (帧, 颗) 打散成伪随机 */
function mix(a: number, b: number): number {
  let h = (Math.imul(a, 0x9e3779b1) + Math.imul(b, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * 第 `frame` 帧、第 `slot` 颗骰子该显示几点（1..6）。
 *
 * 确定性：同样的 (frame, slot) 永远同样的点数。颗号参与散列，所以几颗骰子
 * 不会整齐划一地同点。
 */
export function rollPips(frame: number, slot: number): number {
  return (mix(frame, slot) % 6) + 1;
}

/**
 * 掷骰预测动画的状态机。
 *
 * 生命周期：`start`（本地点 GO）→ 每帧 `pipsAt` 取滚动值 → 服务器返回后
 * `settle`（定格真值）→ 调用方在合适的时候 `cancel`（例如下一次掷骰前）。
 */
export class DiceRollAnimation {
  #slots = 0;
  #startedAt: number | null = null;
  #settled: readonly number[] | null = null;

  /** 本地点了 GO：开始滚。`slots` = 这一掷几颗骰子 */
  start(slots: number, nowMs: number): void {
    this.#slots = Math.max(1, Math.floor(slots));
    this.#startedAt = nowMs;
    this.#settled = null;
  }

  /**
   * 服务器的 `action{rollDice}` 到了：**立刻**定格到真实点数。
   *
   * 调用方传的新 `state.dice` —— 那是唯一权威的点数来源。
   */
  settle(dice: readonly number[]): void {
    this.#settled = [...dice];
    this.#slots = Math.max(1, dice.length);
    this.#startedAt = null;
  }

  /** 收摊：不再参与显示，调用方退回画权威值 */
  cancel(): void {
    this.#slots = 0;
    this.#startedAt = null;
    this.#settled = null;
  }

  /** 正在滚（还没定格） */
  get rolling(): boolean {
    return this.#settled === null && this.#startedAt !== null;
  }

  /** 定格在真值上还没收摊 */
  get settled(): boolean {
    return this.#settled !== null;
  }

  /**
   * 这一帧该画几点；**返回 null 表示「我不参与」，请画权威值**。
   *
   * 三种情况返回 null：没开始过、已收摊、滚超时了。
   */
  pipsAt(nowMs: number): readonly number[] | null {
    if (this.#settled !== null) return this.#settled;
    if (this.#startedAt === null) return null;

    const elapsed = nowMs - this.#startedAt;
    if (elapsed >= ROLL_TIMEOUT_MS) {
      // 服务器迟迟不回：停止假装，交还给权威显示
      this.#startedAt = null;
      this.#slots = 0;
      return null;
    }

    const frame = Math.floor(elapsed / ROLL_FRAME_MS);
    const out: number[] = [];
    for (let s = 0; s < this.#slots; s++) out.push(rollPips(frame, s));
    return out;
  }
}
