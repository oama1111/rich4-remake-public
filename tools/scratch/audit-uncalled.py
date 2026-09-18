#!/usr/bin/env python3
"""「写了但没人调」审计（第二版，去掉自引用噪声）。

第一版把 `takeSnapshot` 之类混在一堆「只为测试导出」的助手里面，看不出重点。
差别在于：一个导出项如果在**它自己的模块里**被调用，那只是封装松；如果在**整个仓库里
除声明行之外一次都没出现**，那才是真的死代码 —— 对 1:1 复刻来说，死代码往往等于
「原版有、我们写了壳但没接线」的功能缺口。

统计口径：`export function NAME` / `export const NAME = (`，匹配 `\bNAME\b` 出现次数，
减掉声明那一行自身；测试文件里的引用也计入（便于区分「只有测试在调」）。
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

DECL = re.compile(r"^export (?:async )?function ([A-Za-z_][A-Za-z0-9_]*)")
DECL_CONST = re.compile(r"^export const ([A-Za-z_][A-Za-z0-9_]*)(?::[^=]+)? = \(")

texts: dict[str, str] = {}
for f in sorted(ROOT.glob("packages/**/*.ts")):
    rel = str(f.relative_to(ROOT))
    if "/dist/" in rel or "/node_modules/" in rel:
        continue
    texts[rel] = f.read_text(encoding="utf-8", errors="replace")

decls: dict[str, str] = {}
for rel, text in texts.items():
    if not rel.startswith("packages/core/src/"):
        continue
    # ★ 测试工厂（src/testing/）只当**使用者**，不当「谁定义了导出」——
    #   否则 `slotsFrom` 这类正经被工厂调用的函数会被误报成死代码
    #   （第一版就是这么错的，见 rich4-spec/docs/systems/tools.md §9.aa）。
    if "/src/testing/" in rel:
        continue
    for ln in text.split("\n"):
        m = DECL.match(ln) or DECL_CONST.match(ln)
        if m:
            decls.setdefault(m.group(1), rel)

rows = []
for name, home in decls.items():
    pat = re.compile(r"\b" + re.escape(name) + r"\b")
    prod = test = 0
    for rel, text in texts.items():
        n = len(pat.findall(text))
        if n == 0:
            continue
        if rel == home:
            n -= 1  # 声明行自身
        if n <= 0:
            continue
        if ".test." in rel:
            test += n
        else:
            prod += n
    rows.append((name, home, prod, test))

# 只测试在调、生产代码零引用 —— 最可疑的一类
suspicious = [r for r in rows if r[2] == 0 and r[3] > 0]
dead = [r for r in rows if r[2] == 0 and r[3] == 0]
internal = [r for r in rows if r[2] > 0 and r[3] > 0 and r[2] <= 2]

print(f"core 导出函数：{len(rows)} 个")
print(f"\n=== A 类：生产代码零引用、只有测试在调（{len(suspicious)}）===")
for name, home, prod, test in sorted(suspicious, key=lambda x: x[1]):
    print(f"  {name:36s} {home.replace('packages/core/src/','')}  [测试引用 {test}]")

print(f"\n=== B 类：全仓库零引用（连测试都没有，{len(dead)}）===")
for name, home, prod, test in sorted(dead, key=lambda x: x[1]):
    print(f"  {name:36s} {home.replace('packages/core/src/','')}")
