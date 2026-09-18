#!/usr/bin/env python3
"""第 40 条：企業表的**运行时四项**（自留股数 / 持股排名 / 累積盈餘 / 累計盈餘）
写档时一直是 carry —— 补上写出与合并。

`writeMapBlock` 只写了 `owner(+0x18)`，`+0x1c..0x1f` 排名、`+0x28` funds、
`+0x2c` profit、`+0x30` shares **全部靠 carry** ⇒ 玩过几步之后写出的存档里
企业金库/可售股数/股东排名都是**装载时**的旧值。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# ── ① map-writer.ts ─────────────────────────────────────────────────
P1 = ROOT / "packages/core/src/loaders/map-writer.ts"
E1 = [
    (
        "MODELED_MAP_FIELDS",
        "  'commercial: x/y/stockIndex/type/facing/spriteIndex/landPrice/assetValue/owner',",
        "  'commercial: x/y/stockIndex/type/facing/spriteIndex/landPrice/assetValue/owner/ranking/funds/profit/shares',",
        1,
    ),
    (
        "写出商业四项",
        """    u32(out, o + 0x24, c.assetValue);
    out[o + 0x18] = c.owner & 0xff;""",
        """    u32(out, o + 0x24, c.assetValue);
    out[o + 0x18] = c.owner & 0xff;
    // ★★ 运行时四项（先前一直靠 carry ⇒ 玩过之后写的还是装载时的旧值）：
    //   持股排名 `+0x1c..+0x1f`（值 = 玩家下标 + 1，0 = 空位）、
    //   累積盈餘 `+0x28`（**有符号**，每月 15 日分红后清零）、
    //   累計盈餘 `+0x2c`（**有符号**，从不清零）、
    //   自留股数 `+0x30`（`10000 − 流通股数`；静态地图文件里恒 0，存档里才是真值）。
    //   @source 解析侧 `map.ts` 的 `parseCommercials`（同一组偏移，逐字段带注释）。
    for (let r = 0; r < 4; r++) out[o + 0x1c + r] = (c.ranking[r] ?? 0) & 0xff;
    u32(out, o + 0x28, c.funds); // 负数走 `>>>` 的补码，与 getInt32 对称
    u32(out, o + 0x2c, c.profit);
    u32(out, o + 0x30, c.shares);""",
        1,
    ),
]
src = P1.read_text(encoding="utf-8")
for name, old, new, want in E1:
    got = src.count(old)
    if got != want:
        raise SystemExit(f"✗ [map-writer/{name}] 期望 {want} 实际 {got}")
    src = src.replace(old, new, want)
    print(f"✓ map-writer.ts / {name}")
P1.write_text(src, encoding="utf-8")

# ── ② map-state.ts ──────────────────────────────────────────────────
P2 = ROOT / "packages/core/src/loaders/map-state.ts"
E2 = [
    (
        "文档表",
        " * | 企業 | `commercialOwners[].owner` | `+0x18` |",
        " * | 企業 | `commercialOwners[].owner` / `commercialOwners[].ranking` / `companyFunds` / `companyProfit` / `commercialShares` | `+0x18` / `+0x1c..1f` / `+0x28` / `+0x2c` / `+0x30` |",
        1,
    ),
    (
        "合并商业五项",
        """  const commercials = map.commercials.map((c) => {
    const live = state.commercialOwners?.[c.id];
    return live === undefined ? c : { ...c, owner: live.owner };
  });""",
        """  const commercials = map.commercials.map((c) => {
    const live = state.commercialOwners?.[c.id];
    return {
      ...c,
      owner: live?.owner ?? c.owner,
      // ★ 运行时四项：先前只合并了 `owner`，其余三格（排名/盈餘/自留股数）
      //   一直是地图模板里的旧值 ⇒ 写出的存档里企业金库与可售股数是错的。
      ranking: live?.ranking ?? c.ranking,
      funds: state.companyFunds?.[c.id] ?? c.funds,
      profit: state.companyProfit?.[c.id] ?? c.profit,
      shares: state.commercialShares?.[c.id] ?? c.shares,
    };
  });""",
        1,
    ),
]
src2 = P2.read_text(encoding="utf-8")
for name, old, new, want in E2:
    got = src2.count(old)
    if got != want:
        raise SystemExit(f"✗ [map-state/{name}] 期望 {want} 实际 {got}")
    src2 = src2.replace(old, new, want)
    print(f"✓ map-state.ts / {name}")
P2.write_text(src2, encoding="utf-8")
print("已写入")
