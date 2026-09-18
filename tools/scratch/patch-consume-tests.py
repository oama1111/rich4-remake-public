#!/usr/bin/env python3
"""更新「钉住旧行为」的测试：目标已选定后的无变化路径现在是
`ok: true` + 已扣卡（`noEffect()`），不再是 `fail`。"""
from pathlib import Path

P = (Path(__file__).resolve().parents[2]
     / "packages/core/src/cards/registry.test.ts")

EDITS = [
    (
        "扣卡时机 describe 头",
        """// ★★ 把当前的一处**已知偏离显式钉住**（`docs/gaps/README.md` 第 31 条）：
//   原版「卡在**目标选定之后、效果之前**移除」（`@source 0x004441dc`）⇒
//   目标已选定后的**任何** early-exit 都扣卡。而 remake 的消耗点在函数末尾，
//   所以一切 `fail` 都不扣卡。下面这条测的就是"不扣"这一当前行为 ——
//   它**不是**期望行为，而是**给未来的修复立一个会失败的哨兵**：
//   等哪一轮把 `fail(..., consumes=true)` 翻上去，这条会红，提醒同步更新。
describe('★ 扣卡时机（第 31 条规则）：已修一处，其余待逐张核对', () => {
  it('替身已冬眠时夢遊卡**照样被扣掉**（已修）', () => {""",
        """// ★★ 第 31 条规则**已收口**：原版「卡在**目标选定之后、效果之前**移除」
//   （`@source 0x004441dc`）⇒ 目标已选定后的**任何** early-exit 都扣卡。
//   30 张卡的 `remove_card` 位置已逐张回 exe 核实
//   （`rich4-spec/tools/scratch/consume_probe.py`），结论见 `registry.ts` 里
//   `fail` / `noEffect` 的文档注释：分甲（扣）/乙（不扣）两组。
//
//   甲组那种「已选定但什么都没发生」的路径，原版收尾是 `mov eax, <选中值>`
//   ⇒ 返回**非 0 = 成功**，所以 remake 用 `noEffect()`（`ok: true` + 已扣卡），
//   而不是 `fail`。下面几条测的就是它。
describe('★ 扣卡时机（第 31 条规则）：甲组「已选定但无变化」= ok + 已扣卡', () => {
  it('替身已冬眠时夢遊卡：不动，但**卡照样被扣掉**、且判成功', () => {""",
        1,
    ),
    (
        "扣卡时机断言",
        """    const r = useCard(ctx, 16, { kind: 'actor', actor: 4 });
    // ★ 2026-09-17：本条**已修复**（第 31 条规则的首个落地）—— 卡被扣掉。
    //   原第一版哨兵断言的是"不扣卡"，正是待修的偏离；翻标志后按预期变红并已更新。
    expect(r.ok).toBe(false);
    expect(r.players[0]!.cards.includes(16)).toBe(false);""",
        """    const r = useCard(ctx, 16, { kind: 'actor', actor: 4 });
    // ★ 原版 `0x004444b3 call 0x41d546` / `0x004444b8 mov eax, esi`：
    //   `esi` = 选中的目标（非 0）⇒ 返回非 0 = **成功**，而卡在 0x00444219 已扣。
    expect(r.ok).toBe(true);
    expect(r.error).toBe(null);
    expect(r.consumed).toBe(true);
    expect(r.players[0]!.cards.includes(16)).toBe(false);""",
        1,
    ),
    (
        "停牌股",
        """  it('停牌中（f6 ≠ 0）fail(noEffect) 且不扣卡', () => {
    const market = makeMarket();
    market.stocks[3] = makeStock({ f6: 2 });
    const ctx = ctxWithCard(25, { market });
    const r = useCard(ctx, 25, { kind: 'stock', index: 3 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('noEffect');
    expect(r.players[0]!.cards).toEqual([25]);
  });""",
        """  it('停牌中（f6 ≠ 0）**卡照扣**、判成功（原版没有这道闸门）', () => {
    // ★ 订正（2026-09-17）：先前写「不扣卡」，但原版写完 `newsFlag` 就扣卡，
    //   @source 紅卡 `0x0044502a call 0x441343` / `0x00445032 mov eax, ebx`
    //   （`ebx` = 选中编号，非 0）⇒ 成功 + 已扣。
    const market = makeMarket();
    market.stocks[3] = makeStock({ f6: 2 });
    const ctx = ctxWithCard(25, { market });
    const r = useCard(ctx, 25, { kind: 'stock', index: 3 });
    expect(r.ok).toBe(true);
    expect(r.consumed).toBe(true);
    expect(r.players[0]!.cards).toEqual([]);
  });""",
        1,
    ),
    (
        "天使卡满级設施",
        """  it('天使卡：满级設施不动也不扣卡', () => {
    const ctx = facCtx(9, makeFacility({ id: 1, type: 0, level: 1 })); // 公園 max=1
    const r = useCard(ctx, 9, { kind: 'facility', facilityId: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('noEffect');
    expect(r.players[0]!.cards).toEqual([9]);
  });""",
        """  it('天使卡：满级設施不动，但**卡照扣**、判成功', () => {
    // ★ 订正（2026-09-17）：先前写「原版返回 0」——**读反了**。
    //   @source `0x004436d2 je 0x4436d9` → `0x004436d9 mov eax, ebp`，
    //   `ebp` 是 `0x004434dc call 0x446ae8` 选中的地产编号，恒非 0。
    const ctx = facCtx(9, makeFacility({ id: 1, type: 0, level: 1 })); // 公園 max=1
    const r = useCard(ctx, 9, { kind: 'facility', facilityId: 1 });
    expect(r.ok).toBe(true);
    expect(r.consumed).toBe(true);
    expect(r.facilities[0]).toMatchObject({ type: 0, level: 1 });
    expect(r.players[0]!.cards).toEqual([]);
  });""",
        1,
    ),
    (
        "T-010 不在棋盘上的 NPC",
        """  it('不在棋盘上的 NPC（place ≠ board）→ noEffect 且不扣卡', () => {
    // 初始状态：小偷(actor 4)在監獄
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [14] }), makePlayer({ index: 1 })],
    });
    const r = useCard(ctx, 14, { kind: 'actor', actor: 4 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('noEffect');
    expect(r.players[0]!.cards).toEqual([14]);
  });

  it('未出场的機器娃娃（actor 8 offBoard）→ noEffect', () => {
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [30] }), makePlayer({ index: 1 })],
    });
    expect(useCard(ctx, 30, { kind: 'actor', actor: 8 }).error).toBe('noEffect');
  });""",
        """  it('不在棋盘上的 NPC（place ≠ board）→ 状态不动，但**卡照扣**、判成功', () => {
    // ★ 订正（2026-09-17）：`remove_card`（`0x00443fca`）在掩码取位号之后、
    //   真正写 halted 之前，收尾返回非 0 ⇒ 原版算成功。
    // 初始状态：小偷(actor 4)在監獄
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [14] }), makePlayer({ index: 1 })],
    });
    const r = useCard(ctx, 14, { kind: 'actor', actor: 4 });
    expect(r.ok).toBe(true);
    expect(r.consumed).toBe(true);
    expect(r.actors[0]!.halted).toBe(0);
    expect(r.players[0]!.cards).toEqual([]);
  });

  it('未出场的機器娃娃（actor 8 offBoard）→ 同样 ok + 已扣卡', () => {
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [30] }), makePlayer({ index: 1 })],
    });
    const r = useCard(ctx, 30, { kind: 'actor', actor: 8 });
    expect(r.ok).toBe(true);
    expect(r.consumed).toBe(true);
    expect(r.actors[4]!.singleStep).toBe(0);
    expect(r.players[0]!.cards).toEqual([]);
  });""",
        1,
    ),
    (
        "T-010 夢遊卡 已冬眠",
        """    const r = useCard(ctx, 16, { kind: 'actor', actor: 4 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('noEffect');
    expect(r.actors[0]!.sleepwalkDays).toBeUndefined(); // 效果确实没施加
    expect(r.players[0]!.cards).toEqual([]); // ★ 但卡被扣掉了
  });

  it('夢遊卡(16) 对不在棋盘上的替身 → noEffect，不扣卡', () => {
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [16] }), makePlayer({ index: 1 })],
    });
    // 初始：小偷(4)在監獄、機器娃娃(8)未出场
    expect(useCard(ctx, 16, { kind: 'actor', actor: 4 }).error).toBe('noEffect');
    expect(useCard(ctx, 16, { kind: 'actor', actor: 8 }).error).toBe('noEffect');
    expect(ctx.players[0]!.cards).toEqual([16]);
  });""",
        """    const r = useCard(ctx, 16, { kind: 'actor', actor: 4 });
    expect(r.ok).toBe(true); // 原版返回 esi ≠ 0 = 成功
    expect(r.error).toBe(null);
    expect(r.actors[0]!.sleepwalkDays).toBeUndefined(); // 效果确实没施加
    expect(r.players[0]!.cards).toEqual([]); // ★ 但卡被扣掉了
  });

  it('夢遊卡(16) 对不在棋盘上的替身 → 状态不动，但**卡照扣**、判成功', () => {
    // ★ 订正（2026-09-17）：`remove_card`（`0x00444219`）在取位号之后，
    //   替身分支的 `cmp ebx,4 / jl` 只是跳过写天数，收尾 `mov eax, esi` 非 0。
    const ctx = makeCtx({
      players: [makePlayer({ index: 0, cards: [16] }), makePlayer({ index: 1 })],
    });
    // 初始：小偷(4)在監獄、機器娃娃(8)未出场
    const a = useCard(ctx, 16, { kind: 'actor', actor: 4 });
    expect(a.ok).toBe(true);
    expect(a.consumed).toBe(true);
    expect(a.players[0]!.cards).toEqual([]);
    const b = useCard(ctx, 16, { kind: 'actor', actor: 8 });
    expect(b.ok).toBe(true);
    expect(b.consumed).toBe(true);
  });""",
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
