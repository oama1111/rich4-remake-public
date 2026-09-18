#!/usr/bin/env python3
"""F 类审计（第二批结构）：SpecialActor / Listing / CommercialOwnership / EventDeck /
StockState / StockMarketState —— 每个字段有没有**非写侧**读者。"""
import re, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
FIELD = re.compile(r"^  ([a-zA-Z_][a-zA-Z0-9_]*)\??:")
WRITERS = ('packages/core/src/state/types.ts', 'packages/core/src/state/actions.ts',
           'packages/core/src/net/protocol.ts', 'packages/core/src/rules/new-game.ts',
           'packages/core/src/loaders/', 'packages/core/src/testing/factories.ts')
CASES = {
    'SpecialActor': ('packages/core/src/rules/special-actors.ts', 'export interface SpecialActor {'),
    'Listing': ('packages/core/src/places/notice-board.ts', 'export interface Listing {'),
    'CommercialOwnership': ('packages/core/src/places/commercial.ts', 'export interface CommercialOwnership {'),
    'EventDeck': ('packages/core/src/events/deck.ts', 'export interface EventDeck {'),
    'StockState': ('packages/core/src/places/stock.ts', 'export interface StockState {'),
    'StockMarketState': ('packages/core/src/places/stock-market.ts', 'export interface StockMarketState {'),
}

def fields_of(rel, marker):
    lines = (ROOT / rel).read_text(encoding='utf-8').split('\n')
    start = next(i for i, ln in enumerate(lines) if ln.strip() == marker.strip())
    out, depth = [], 0
    for ln in lines[start:]:
        depth += ln.count('{') - ln.count('}')
        if depth <= 0 and out:
            break
        m = FIELD.match(ln)
        if m:
            out.append(m.group(1))
    return out

for iface, (rel, marker) in CASES.items():
    names = fields_of(rel, marker)
    print(f"\n===== {iface}（{len(names)} 字段）")
    for f in names:
        out = subprocess.run(['grep', '-rn', '--include=*.ts', rf'\.{f}\b', 'packages'],
                             capture_output=True, text=True).stdout.splitlines()
        files = {}
        for line in out:
            p = line.split(':', 1)[0]
            ap = Path(p) if p.startswith('/') else (ROOT / p)
            try:
                r = str(ap.resolve().relative_to(ROOT))
            except ValueError:
                continue
            if '.test.' in r or '/dist/' in r:
                continue
            files[r] = files.get(r, 0) + 1
        cons = {k: v for k, v in files.items()
                if not any(k == w or k.startswith(w) for w in WRITERS)}
        if not cons:
            print(f"  ⚠️ {f:22s} 非写侧引用：（无）")
        elif len(cons) <= 2:
            print(f"     {f:22s} 只有 {sorted(cons)}")
