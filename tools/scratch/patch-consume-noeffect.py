#!/usr/bin/env python3
"""把 registry.ts 里「目标已选定但无变化」的站点从 fail(...) 改成 noEffect()。

依据：rich4-spec/tools/scratch/consume_probe.py 逐张卡列出的
`call 0x441343`（remove_card）与全部分支的相对次序 —— 见 registry.ts
`noEffect()` 的文档注释。每处替换都是**唯一字符串**，替换数不符即报错退出。
"""
from pathlib import Path

P = Path(__file__).resolve().parents[2] / "packages/core/src/cards/registry.ts"

# (说明, 原串, 新串, 期望出现次数)
EDITS = [
    (
        "卡14 actor 不在盘上",
        """        // REQ-05.1：停留卡对特殊棋子 —— VA 0x004440d9 写 +14 halted = 1
        const slot = specialSlotOf(target.actor);
        const a = slot >= 0 ? actors[slot] : undefined;
        if (!actorActive(a)) return fail('noEffect');""",
        """        // REQ-05.1：停留卡对特殊棋子 —— VA 0x004440d9 写 +14 halted = 1
        const slot = specialSlotOf(target.actor);
        const a = slot >= 0 ? actors[slot] : undefined;
        // 不在棋盘上不生效。★ **卡照扣、原版算成功** ——
        //   @source `0x00443fca call 0x441343`（remove_card）在 `0x00443fb5 call 0x40d293`
        //   （掩码取位号）之后；之后只剩「目标≠自己就说一句」的台词分支。
        if (!actorActive(a)) return noEffect();""",
        1,
    ),
    (
        "卡16 actor 不在盘上 + 已在冬眠",
        """        // 不在棋盘上（監獄/醫院/未出场）不生效，不扣卡 —— 与停留/轉向/烏龜同一条规矩。
        // ⚠️ 原版那一支没有 `actorActive` 这个判断（它按鼠标点得到谁就是谁），
        //   但 picker 画的就是在场的那几个，故行为一致。
        if (!actorActive(a)) return fail('noEffect');
        // ★★ 已经冬眠的替身：**不写天数，但卡已经扣掉了**。
        //   @source `0x004444a3 cmp byte [ebx + 0x498df4], 0` / `0x004444aa jne 0x4444b3`
        //   —— 这条 `jne` 只是跳过 `mov byte [ebx+0x498df5], 5`；而施卡者的
        //   `0x00444219 call 0x441343`（`remove_card`）在**那之前**就执行过了
        //   （见 `0x00444210`–`0x00444219`：目标选定后立刻扣卡）。
        //   ⇒ 故传 `consumes = true`。**这一处是第 31 条规则的首个落地**。
        const applied = applySleepwalkCardToActor(a!);
        if (!applied.applied) return fail('noEffect', true);""",
        """        // 不在棋盘上（監獄/醫院/未出场）不生效 —— 与停留/轉向/烏龜同一条规矩。
        // ⚠️ 原版那一支没有 `actorActive` 这个判断（它按鼠标点得到谁就是谁），
        //   但 picker 画的就是在场的那几个，故行为一致。
        if (!actorActive(a)) return noEffect();
        // ★★ 已经冬眠的替身：**不写天数**，但原版在 `0x004444b3` 只做
        //   `call 0x41d546` 收尾 + `mov eax, esi`（`esi` = 选中的目标，恒非 0）
        //   ⇒ 返回值非 0 = **成功**，而 `remove_card` 早在 `0x00444219` 执行过了。
        //   @source `0x004444a3 cmp byte [ebx + 0x498df4], 0` / `0x004444aa jne 0x4444b3`
        //   —— 那条 `jne` 只跳过 `mov byte [ebx+0x498df5], 5`。
        //   ⇒ 故走 `noEffect()`（`ok: true` + 已扣卡），不是 `fail`。
        const applied = applySleepwalkCardToActor(a!);
        if (!applied.applied) return noEffect();""",
        1,
    ),
    (
        "卡30 actor 不在盘上",
        """        // REQ-05.1：烏龜卡对特殊棋子 —— VA 0x00445a3e 写 +15 single_step = 3
        const slot = specialSlotOf(target.actor);
        const a = slot >= 0 ? actors[slot] : undefined;
        if (!actorActive(a)) return fail('noEffect');""",
        """        // REQ-05.1：烏龜卡对特殊棋子 —— VA 0x00445a3e 写 +15 single_step = 3
        const slot = specialSlotOf(target.actor);
        const a = slot >= 0 ? actors[slot] : undefined;
        // 不在棋盘上不生效。★ **卡照扣、原版算成功** ——
        //   @source `0x00445929 call 0x441343`（remove_card）在 `0x00445914 call 0x40d293`
        //   之后；收尾 `0x004458d8 mov eax, esi`（`esi` = 选中目标，恒非 0）。
        if (!actorActive(a)) return noEffect();""",
        1,
    ),
    (
        "卡23 attachGod 失败",
        """      const r = attachGod({ players, objects, tools, toolStock }, cur, target.objectIndex);
      if (!r.ok) return fail('noEffect');""",
        """      const r = attachGod({ players, objects, tools, toolStock }, cur, target.objectIndex);
      // ★ 走到这里说明「可请的物件」那道闸门已过；`attachGod` 的内部失败
      //   （noObject/outOfRange/notAttachable）是第二道防线。原版的扣卡在
      //   `0x00444e52 call 0x441343`（紧跟 `0x00444e37 call 0x41e6f2` 取参），
      //   之后一路到 `0x00444f20 jmp 0x444685` 无条件收尾并返回非 0
      //   ⇒ 无变化也算成功。故 `noEffect()`。
      if (!r.ok) return noEffect();""",
        1,
    ),
    (
        "卡9 設施满级不动",
        """        const r = applyAngelFacilityCard(fac, target.buildType ?? 0);
        // 满级不动 → 不生效不扣卡（原版返回 0）
        if (!r.ok) return fail('noEffect');""",
        """        const r = applyAngelFacilityCard(fac, target.buildType ?? 0);
        // ★ 满级不动 → 状态不变，**但卡照扣、原版算成功**。
        //   先前这里写着「原版返回 0」，那是**读反了**：
        //   @source `0x004436b7 je 0x4436c0` → `0x004436ce cmp dword [esp],0` →
        //   `0x004436d2 je 0x4436d9` → `0x004436d9 mov eax, ebp`，
        //   而 `ebp` 是 `0x004434dc call 0x446ae8` 选中的**地产编号**，恒非 0。
        //   ⇒ 返回非 0 = 成功（卡在 `0x00443505` 已扣）。故 `noEffect()`。
        if (!r.ok) return noEffect();""",
        1,
    ),
    (
        "卡27/28 同区无地可改",
        """      if (r.affected.length === 0) return fail('noEffect');""",
        """      // ★ 原版对「选到的编号不落在任何地产区间」的情形**照扣卡**并返回该编号
      //   （非 0 = 成功）：@source 漲價卡 `0x004454b0 jle 0x445516` /
      //   `0x0044551c jle 0x44557e` 都汇到 `0x0044558c mov eax, ebp`。
      //   查封卡同形（`0x00445612` / `0x004456a0` → `0x0044558c`）。
      if (r.affected.length === 0) return noEffect();""",
        1,
    ),
    (
        "卡24/25 停牌股",
        """      // f6 非 0 = 停牌中，当日不波动，置数无意义 @source loc_00429470
      if (stock.f6 !== 0) return fail('noEffect');""",
        """      // f6 非 0 = 停牌中，当日不波动，置数无意义 @source loc_00429470
      // ★ 原版没有这道闸门：真人在股市屏里点下去就写了 `newsFlag`（`0x00444f88`
      //   / `0x004450f6`，在「选到了没有」判定之**后**），AI 那条更是**无条件**写；
      //   两边随后都在 `0x0044502a` / `0x004451db` 扣卡并返回选中编号（非 0）。
      //   所以停牌股上也该扣卡 ⇒ `noEffect()`（本闸门只挡住无意义的写）。
      if (stock.f6 !== 0) return noEffect();""",
        1,
    ),
]

src = P.read_text(encoding="utf-8")
for name, old, new, want in EDITS:
    got = src.count(old)
    if got != want:
        raise SystemExit(f"✗ [{name}] 期望 {want} 处匹配，实际 {got} 处")
    src = src.replace(old, new, want)
    print(f"✓ {name}")
P.write_text(src, encoding="utf-8")
print("已写入", P)
