#!/usr/bin/env python3
"""第 42 条：把「地图视角档位」接成**状态**（D-06 的另一半）。

现状：客户端有 8 视角渲染与 `<`/`>` 热键，但档位只存在自己的 `camera.view` 里，
**从不写回 `GameState.viewRotation`** ⇒ 旋转过的视角既不被存档带上、读档也不还原，
`viewRotation` 在审计里是「非写侧引用：（无）」。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# ── ① core：导出 + action + reducer ─────────────────────────────────
P1 = ROOT / "packages/core/src/index.ts"
s1 = P1.read_text(encoding="utf-8")
assert s1.count("export * from './rules/position.ts';") == 0
s1 = s1.replace("export * from './rules/blessing.ts';",
                "export * from './rules/blessing.ts';\nexport * from './rules/view.ts';", 1)
P1.write_text(s1, encoding="utf-8")
print("✓ index.ts 导出 rules/view.ts")

P2 = ROOT / "packages/core/src/state/actions.ts"
s2 = P2.read_text(encoding="utf-8")
old2 = "  | { type: 'setDiceCount'; count: number }"
new2 = """  | { type: 'setDiceCount'; count: number }
  /**
   * 转地图视角（`<` / `>` 热键，原版全局 `[0x499088]`）。
   * `delta` 可正可负，步数按 8 取模 —— 规则见 `rules/view.ts`。
   */
  | { type: 'rotateView'; delta: number }"""
assert s2.count(old2) == 1
P2.write_text(s2.replace(old2, new2, 1), encoding="utf-8")
print("✓ actions.ts 加 rotateView")

P3 = ROOT / "packages/core/src/state/reduce.ts"
s3 = P3.read_text(encoding="utf-8")
old3 = "import { placeOnNode } from '../rules/position.ts';"
new3 = "import { placeOnNode } from '../rules/position.ts';\nimport { rotateViewBy } from '../rules/view.ts';"
assert s3.count(old3) == 1
s3 = s3.replace(old3, new3, 1)
# 找一个合适的位置插 case：紧跟 setDiceCount 之前
i = s3.index("    case 'setDiceCount': {")
CASE = """    case 'rotateView': {
      // ★ 纯表现状态，但**必须进状态**：原版把它存进存档（`+0x2743`），
      //   读档要还原。客户端只负责把按键翻译成这条 action（D-06）。
      const viewRotation = rotateViewBy(state.viewRotation, action.delta);
      return viewRotation === state.viewRotation ? state : { ...state, viewRotation };
    }

"""
s3 = s3[:i] + CASE + s3[i:]
P3.write_text(s3, encoding="utf-8")
print("✓ reduce.ts 加 rotateView case")

# ── ② client：dispatch + 从状态取初始档位 ───────────────────────────
P4 = ROOT / "packages/client/src/main.ts"
s4 = P4.read_text(encoding="utf-8")
old4 = """function rotateView(delta: number): void {
  camera = { ...camera, view: (camera.view + delta + VIEW_COUNT) % VIEW_COUNT };
  log(`▶ 视角 ${camera.view}`);
  requestRender();
  renderPanel();
}"""
new4 = """function rotateView(delta: number): void {
  // ★★ 档位**住在状态里**（原版全局 `[0x499088]`，进存档 `+0x2743`）。
  //   先前只改 `camera.view`，于是旋转过的视角既不会被存档带上、读档也不还原（D-06）。
  //   reducer 负责取模，这里把结果同步到镜头。
  dispatch({ type: 'rotateView', delta });
  camera = { ...camera, view: state.viewRotation };
  log(`▶ 视角 ${camera.view}`);
  requestRender();
  renderPanel();
}"""
assert s4.count(old4) == 1
s4 = s4.replace(old4, new4, 1)
# 开局/读档后镜头取状态里的档位
old5 = "camera = characterCamera(first?.x ?? 0, first?.y ?? 0, camera?.view ?? 0);"
new5 = "camera = characterCamera(first?.x ?? 0, first?.y ?? 0, state.viewRotation);"
n = s4.count(old5)
s4 = s4.replace(old5, new5)
old6 = "camera = characterCamera(first?.x ?? 0, first?.y ?? 0, camera?.view ?? 0);"
print(f"✓ main.ts rotateView 走 dispatch；镜头初始化 {n} 处改为取 state.viewRotation")
old7 = "    camera = characterCamera(first?.x ?? 0, first?.y ?? 0, 0);"
if s4.count(old7) == 1:
    s4 = s4.replace(old7, "    camera = characterCamera(first?.x ?? 0, first?.y ?? 0, state.viewRotation);", 1)
    print("✓ main.ts 又一处镜头初始化")
P4.write_text(s4, encoding="utf-8")
print("已写入")
