#!/usr/bin/env python3
"""任务卡片工具：校验 docs/tasks/cards.yaml，并生成可读的 cards.md。

用法：
  python3 tools/task-cards.py check            # id 唯一、依赖存在、无环、字段齐全
  python3 tools/task-cards.py render           # 写 docs/tasks/cards.md
  python3 tools/task-cards.py next             # 列出当前可开工（依赖已 done）的卡
  python3 tools/task-cards.py show T-003       # 打印一张卡

不依赖 PyYAML：cards.yaml 只用了 YAML 的一个小子集（映射、列表、块标量 `|`），这里自带解析器。
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
YAML_PATH = ROOT / 'docs' / 'tasks' / 'cards.yaml'
MD_PATH = ROOT / 'docs' / 'tasks' / 'cards.md'

REQUIRED = ['id', 'group', 'title', 'module', 'req', 'status', 'estimate', 'depends_on',
            'uses', 'source', 'input', 'output', 'algorithm', 'tests', 'files', 'notes']
STATUSES = {'todo', 'doing', 'done', 'blocked'}


# ----------------------------------------------------------------------------
#  极简 YAML 子集解析
# ----------------------------------------------------------------------------

def _strip_comment(line: str) -> str:
    # 只在行首或空白后出现的 # 视为注释（值里的 '#' 前面都有引号或非空白）
    out = []
    in_q = None
    for i, ch in enumerate(line):
        if in_q:
            if ch == in_q:
                in_q = None
        elif ch in ('"', "'"):
            in_q = ch
        elif ch == '#' and (i == 0 or line[i - 1] in ' \t'):
            break
        out.append(ch)
    return ''.join(out).rstrip()


def _scalar(s: str):
    s = s.strip()
    if s == '' or s == '~' or s == 'null':
        return ''
    if s == '[]':
        return []
    if s.startswith('[') and s.endswith(']'):
        inner = s[1:-1].strip()
        if not inner:
            return []
        items, cur, in_q = [], '', None
        for ch in inner:
            if in_q:
                cur += ch
                if ch == in_q:
                    in_q = None
            elif ch in ('"', "'"):
                in_q = ch
                cur += ch
            elif ch == ',':
                items.append(_scalar(cur))
                cur = ''
            else:
                cur += ch
        if cur.strip():
            items.append(_scalar(cur))
        return items
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        return s[1:-1]
    try:
        if '.' in s:
            return float(s)
        return int(s)
    except ValueError:
        return s


def parse(text: str) -> dict:
    lines = text.splitlines()
    n = len(lines)
    i = 0

    def indent(l: str) -> int:
        return len(l) - len(l.lstrip(' '))

    def parse_block(ind: int):
        nonlocal i
        # 判断是列表还是映射
        while i < n and _strip_comment(lines[i]).strip() == '':
            i += 1
        if i >= n:
            return None
        if lines[i].lstrip().startswith('- '):
            return parse_list(ind)
        return parse_map(ind)

    def parse_list(ind: int):
        nonlocal i
        out = []
        while i < n:
            raw = lines[i]
            st = _strip_comment(raw)
            if st.strip() == '':
                i += 1
                continue
            if indent(raw) < ind or not raw.lstrip().startswith('- '):
                break
            body = raw.lstrip()[2:]
            child_ind = indent(raw) + 2
            if ':' in body and not body.strip().startswith(('"', "'", '[')):
                # 列表项是映射：把第一行当作缩进 child_ind 的一行处理
                lines[i] = ' ' * child_ind + body
                out.append(parse_map(child_ind))
            else:
                out.append(_scalar(_strip_comment(body)))
                i += 1
        return out

    def parse_map(ind: int):
        nonlocal i
        out = {}
        while i < n:
            raw = lines[i]
            st = _strip_comment(raw)
            if st.strip() == '':
                i += 1
                continue
            if indent(raw) < ind:
                break
            if indent(raw) > ind:
                raise ValueError(f'line {i + 1}: unexpected indent')
            if raw.lstrip().startswith('- '):
                break
            key, _, rest = st.strip().partition(':')
            rest = rest.strip()
            i += 1
            # 跨行的双引号标量："..." 开头但本行没闭合 → 续读到以 " 结尾的那一行（YAML 折叠成空格）
            if rest.startswith('"') and not (len(rest) > 1 and rest.endswith('"') and not rest.endswith('\\"')):
                buf = [rest]
                while i < n:
                    cont = lines[i].strip()
                    i += 1
                    buf.append(cont)
                    if cont.endswith('"'):
                        break
                rest = ' '.join(buf)
            if rest == '|' or rest == '>':
                buf = []
                while i < n and (lines[i].strip() == '' or indent(lines[i]) > ind):
                    buf.append(lines[i][ind + 2:] if lines[i].strip() else '')
                    i += 1
                out[key] = '\n'.join(buf).rstrip() + '\n'
            elif rest == '':
                # 嵌套块
                j = i
                while j < n and _strip_comment(lines[j]).strip() == '':
                    j += 1
                if j < n and indent(lines[j]) > ind:
                    out[key] = parse_block(indent(lines[j]))
                elif j < n and lines[j].lstrip().startswith('- ') and indent(lines[j]) == ind:
                    out[key] = parse_list(ind)
                else:
                    out[key] = ''
            else:
                out[key] = _scalar(rest)
        return out

    return parse_map(0)


# ----------------------------------------------------------------------------
#  校验
# ----------------------------------------------------------------------------

def load() -> dict:
    return parse(YAML_PATH.read_text(encoding='utf-8'))


def check(doc: dict) -> list[str]:
    errs: list[str] = []
    cards = doc.get('cards', [])
    ids = [c.get('id') for c in cards]
    seen = set()
    for cid in ids:
        if cid in seen:
            errs.append(f'重复 id：{cid}')
        seen.add(cid)
    groups = set(doc.get('groups', {}).keys())
    for c in cards:
        cid = c.get('id', '?')
        for k in REQUIRED:
            if k not in c:
                errs.append(f'{cid}: 缺字段 {k}')
        if c.get('status') not in STATUSES:
            errs.append(f'{cid}: status 非法 {c.get("status")}')
        if c.get('group') not in groups:
            errs.append(f'{cid}: group 未登记 {c.get("group")}')
        for d in c.get('depends_on', []) or []:
            if d not in seen:
                errs.append(f'{cid}: 依赖不存在 {d}')
            if d == cid:
                errs.append(f'{cid}: 依赖自己')
    # 环检测
    graph = {c['id']: list(c.get('depends_on', []) or []) for c in cards if 'id' in c}
    state: dict[str, int] = {}

    def dfs(u: str, stack: list[str]) -> None:
        state[u] = 1
        for v in graph.get(u, []):
            if state.get(v) == 1:
                errs.append('依赖成环：' + ' → '.join(stack + [u, v]))
            elif state.get(v) is None and v in graph:
                dfs(v, stack + [u])
        state[u] = 2

    for u in graph:
        if state.get(u) is None:
            dfs(u, [])
    return errs


# ----------------------------------------------------------------------------
#  渲染
# ----------------------------------------------------------------------------

def _list_md(v) -> str:
    if isinstance(v, list):
        return '\n'.join(f'- {x}' for x in v) if v else '—'
    return str(v).strip() or '—'


def _block_md(v) -> str:
    s = str(v).strip()
    if not s:
        return '—'
    return '\n'.join('    ' + ln for ln in s.splitlines())


def render(doc: dict) -> str:
    cards = doc['cards']
    groups = doc.get('groups', {})
    by_id = {c['id']: c for c in cards}
    out = ['# 任务卡片（自动生成，勿手改；改 cards.yaml 后重跑 `python3 tools/task-cards.py render`）', '']
    # 汇总
    total = sum(float(c['estimate']) for c in cards)
    done = sum(float(c['estimate']) for c in cards if c['status'] == 'done')
    out.append(f'共 **{len(cards)}** 张卡，估算 **{total:.1f}** 单元，已完成 {done:.1f}。')
    out.append('')
    out.append('| 组 | 名称 | 卡数 | 单元 |')
    out.append('|---|---|---|---|')
    for g, name in groups.items():
        gc = [c for c in cards if c['group'] == g]
        out.append(f'| {g} | {name} | {len(gc)} | {sum(float(c["estimate"]) for c in gc):.1f} |')
    out.append('')
    out.append('## 索引')
    out.append('')
    out.append('| id | 标题 | 模块 | 需求 | 状态 | 单元 | 依赖 |')
    out.append('|---|---|---|---|---|---|---|')
    for c in cards:
        deps = ', '.join(c.get('depends_on') or []) or '—'
        out.append(f'| [{c["id"]}](#{c["id"].lower()}) | {c["title"]} | {c["module"]} | {c["req"]} | `{c["status"]}` | {c["estimate"]} | {deps} |')
    out.append('')
    # 反向依赖
    blocks: dict[str, list[str]] = {}
    for c in cards:
        for d in c.get('depends_on') or []:
            blocks.setdefault(d, []).append(c['id'])
    cur_group = None
    for c in cards:
        if c['group'] != cur_group:
            cur_group = c['group']
            out.append(f'## {cur_group} · {groups.get(cur_group, "")}')
            out.append('')
        out.append(f'### {c["id"]}')
        out.append('')
        out.append(f'**{c["title"]}**')
        out.append('')
        out.append(f'- 模块 `{c["module"]}` · 需求 `{c["req"]}` · 状态 `{c["status"]}` · 估算 {c["estimate"]} 单元')
        out.append(f'- 依赖：{", ".join(c.get("depends_on") or []) or "无（可立即开工）"}')
        if c['id'] in blocks:
            out.append(f'- 被依赖：{", ".join(blocks[c["id"]])}')
        out.append(f'- 证据：{str(c["source"]).strip() or "—"}')
        out.append('')
        out.append('**依赖的其他类 / 文件**')
        out.append('')
        out.append(_list_md(c['uses']))
        out.append('')
        out.append('**期望输入**')
        out.append('')
        out.append(_block_md(c['input']))
        out.append('')
        out.append('**期望输出**')
        out.append('')
        out.append(_block_md(c['output']))
        out.append('')
        out.append('**核心逻辑 / 算法指导**')
        out.append('')
        out.append(_block_md(c['algorithm']))
        out.append('')
        out.append('**验收测试**')
        out.append('')
        out.append(_block_md(c['tests']))
        out.append('')
        out.append('**涉及文件**')
        out.append('')
        out.append(_list_md(c['files']))
        if str(c.get('notes', '')).strip():
            out.append('')
            out.append(f'> {str(c["notes"]).strip()}')
        out.append('')
    return '\n'.join(out) + '\n'


def next_cards(doc: dict) -> list[dict]:
    by_id = {c['id']: c for c in doc['cards']}
    ready = []
    for c in doc['cards']:
        if c['status'] != 'todo':
            continue
        if all(by_id[d]['status'] == 'done' for d in (c.get('depends_on') or [])):
            ready.append(c)
    return ready


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else 'check'
    doc = load()
    errs = check(doc)
    if cmd == 'check':
        if errs:
            print('\n'.join(errs))
            return 1
        print(f'OK：{len(doc["cards"])} 张卡，依赖无环。')
        return 0
    if errs:
        print('\n'.join(errs))
        return 1
    if cmd == 'render':
        MD_PATH.write_text(render(doc), encoding='utf-8')
        print(f'写入 {MD_PATH.relative_to(ROOT)}')
        return 0
    if cmd == 'next':
        for c in next_cards(doc):
            print(f'{c["id"]}  {c["title"]}  ({c["estimate"]} 单元)')
        return 0
    if cmd == 'show':
        cid = argv[2]
        c = next((x for x in doc['cards'] if x['id'] == cid), None)
        if c is None:
            print('没有这张卡')
            return 1
        for k in REQUIRED:
            v = c.get(k)
            print(f'{k}: {v if not isinstance(v, str) else v.strip()}')
        return 0
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
