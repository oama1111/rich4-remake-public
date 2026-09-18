#!/usr/bin/env python3
"""第 43 条：替身（四大惡人/機器娃娃）的**四个**计时字节都要走一天
—— 复刻只走了两个（`halted`/`singleStep`），漏掉 `hibernating`/`sleepwalkDays`
⇒ 冬眠卡/夢遊卡打在替身上之后，那两个计数**永不递减**：灰化/梦游的视觉状态
永远不消失（而且 `isActorAsleep` 一直为真）。"""
from pathlib import Path

P = Path(__file__).resolve().parents[2] / "packages/core/src/rules/special-actors.ts"

old = """/**
 * 惡人的两个计数在他**轮到时**各走一天 @source 0x0041ce42 起（tick_blocking 的 actor >= 4 分支）：
 * 带 0x80 的清零（0x0041cea1 / 0x0041ceb7），否则递减、到 0 挂 0x80（0x0041cf19.. / 0x0041cf3d..）。
 * 与玩家的 `tickBlockingCounter` 同一套。
 */
export function tickNpcCounters(actor: SpecialActor): SpecialActor {
  return {
    ...actor,
    halted: tickBlockingCounter(actor.halted).value,
    singleStep: tickBlockingCounter(actor.singleStep).value,
  };
}"""
new = """/**
 * 替身的**四个**计时字节在他**轮到时**各走一天。
 *
 * @source `tick_blocking` 的 actor 分支 `0x0041ce39` 起：`sub ebx,4` → `eax = ebx*16`
 *   → 依次处理 `0x498e34` / `0x498e35` / `0x498e36` / `0x498e37` **四个字节**，
 *   每个都是同一套「`test ...,0x80` → 清零；否则 `dec`，到 0 `or 0x80`」：
 *
 * ```asm
 * 0041ce4a  test byte [eax + 0x498e34], 0x80 / je 0041ce86   ; ①
 * 0041ce8b  test byte [eax + 0x498e35], 0x80 / je 0041ce9c   ; ②
 * 0041cea1  test byte [eax + 0x498e36], 0x80 / je 0041ceb2   ; ③
 * 0041ceb7  test byte [eax + 0x498e37], 0x80 / je 0041cec8   ; ④
 * 0041cecd  ① 递减 … 0041cef3 ② 递减 … 0041cf19 ③ 递减 …     ; ④ 同形
 * ```
 *
 *   那四个字节就是替身记录的 `+12..+15`（记录基址 `0x498e28`、步长 16）：
 *   `+12` `hibernating` 冬眠 / `+13` `sleepwalkDays` 梦游 / `+14` `halted` 停留 /
 *   `+15` `singleStep` 龜行 —— 与**玩家**那四个（`+0x36..+0x39`，见
 *   `rules/blocking.ts` 的 `tickTurnCounters`）逐位对应。
 *
 * ⚠️ **先前只走 ③④**（`halted`/`singleStep`）⇒ 冬眠卡/夢遊卡打在替身上之后，
 *   `hibernating`/`sleepwalkDays` **永不递减**：`client/render.ts` 的 `isActorAsleep`
 *   会**永远**把那个替身画成灰的 —— 玩家可见。
 *
 * ⚠️ ①（`0x498e34`）的释放支还多两句表现层刷新
 *   （`0x0041ce61` `and byte [turnrec+0x498ea0],0xbf`、
 *   `0x0041ce75 call 0x40b8d8(actor, turnrec+1)`、`0x0041ce7e call 0x40b93b(actor)`），
 *   **本轮未查清其语义**，如实留着（本函数只负责四个计数）。
 *
 * ★ **`npcTurnSteps` 不读这两项**：`0x40de09` 的步数判定只读该记录的 `+2`/`+3`
 *   （= `+14`/`+15` 停留/龜行）。也就是说**原版里冬眠/梦游对替身是纯视觉的** ——
 *   替身照样按 `rand()%9+2` 步走。复刻当前「不闸门」的行为因此是**忠实的**，不要"顺手补上"。
 */
export function tickNpcCounters(actor: SpecialActor): SpecialActor {
  return {
    ...actor,
    hibernating: tickBlockingCounter(actor.hibernating ?? 0).value,
    sleepwalkDays: tickBlockingCounter(actor.sleepwalkDays ?? 0).value,
    halted: tickBlockingCounter(actor.halted).value,
    singleStep: tickBlockingCounter(actor.singleStep).value,
  };
}"""
src = P.read_text(encoding="utf-8")
assert src.count(old) == 1, src.count(old)
P.write_text(src.replace(old, new, 1), encoding="utf-8")
print("✓ special-actors.ts：四个计时字节都走一天")
