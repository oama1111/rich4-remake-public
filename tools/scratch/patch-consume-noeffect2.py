#!/usr/bin/env python3
"""第二组：卡 10/11/12 去掉「无变化就 fail」的早退（敌意要保住），
并给成功路径补 `consumed: true`。"""
from pathlib import Path

P = Path(__file__).resolve().parents[2] / "packages/core/src/cards/registry.ts"

EDITS = [
    (
        "卡11 設施",
        """        const r = applyMonsterFacilityCard(fac, ctx.priceIndex, cur);
        if (!r.ok) return fail('noEffect');
        facilities = facilities.map((f) => (f.id === fac.id ? r.facility : f));""",
        """        // ★ 不设「无变化就早退」的闸门：原版对无主/已夷平的记录**照样**
        //   先记敌意再调 `mutate_land`（`@source 0x004439e8` 起：`cmp [rec+0x19],0`
        //   只决定跳不跳 `0x40df69`，与 `mutate_land` 的「level==0 不动」无关），
        //   且收尾 `0x00443b08 mov eax, esi` 恒非 0 ⇒ 无变化也算成功、卡照扣。
        //   `applyMonsterFacilityCard` 在无变化时原样返回设施与敌意，落地即可。
        const r = applyMonsterFacilityCard(fac, ctx.priceIndex, cur);
        facilities = facilities.map((f) => (f.id === fac.id ? r.facility : f));""",
        1,
    ),
    (
        "卡11 地块",
        """      const r = applyMonsterCard(targetLand, ctx.priceIndex, cur);
      if (!r.ok) return fail('noEffect');
      putLand(r.land);""",
        """      // ★ 同上：无变化（level==0）也照样记敌意、照样算成功
      const r = applyMonsterCard(targetLand, ctx.priceIndex, cur);
      putLand(r.land);""",
        1,
    ),
    (
        "卡10 設施",
        """        const r = applyDevilFacilityCard(fac, ctx.priceIndex, cur);
        if (!r.ok) return fail('noEffect');
        facilities = facilities.map((f) => (f.id === fac.id ? r.facility : f));""",
        """        // ★ 同怪獸卡：无变化也要落敌意、算成功（收尾 `0x0044558c mov eax, ebp`）
        const r = applyDevilFacilityCard(fac, ctx.priceIndex, cur);
        facilities = facilities.map((f) => (f.id === fac.id ? r.facility : f));""",
        1,
    ),
    (
        "卡12 設施",
        """        const r = applyDemolishFacilityCard(fac, ctx.priceIndex);
        if (!r.ok) return fail('noEffect');
        facilities = facilities.map((f) => (f.id === fac.id ? r.facility : f));""",
        """        // ★ 无变化（level==0）也照样记平坦敌意、照样算成功
        //   （收尾 `0x00443e35 mov eax, [esp]` = 选中编号，恒非 0；
        //   `0x00443d47 je` 只跳过台词，不跳过敌意）
        const r = applyDemolishFacilityCard(fac, ctx.priceIndex);
        facilities = facilities.map((f) => (f.id === fac.id ? r.facility : f));""",
        1,
    ),
    (
        "成功路径 consumed",
        """  // ★ 效果生效后才消耗卡片
  players = players.map((p, i) => (i === cur ? consumeCard(p, cardId) : p));

  return { ok: true, error: null, players,""",
        """  // ★ 效果生效后才消耗卡片
  players = players.map((p, i) => (i === cur ? consumeCard(p, cardId) : p));

  return { ok: true, error: null, consumed: true, players,""",
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
