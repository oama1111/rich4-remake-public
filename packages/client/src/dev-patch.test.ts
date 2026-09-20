/*
 * W-53 开发用的状态注入口：`applyPatch` + 三个配方
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 验收口径（`docs/tasks/W-50-playtest5-stage-order.md` §4）：三个配方各附截图 / 日志。
 *   **本机没有跑浏览器**（清单里明写「可能跑不了浏览器」），故这里改成按**同一条
 *   `applyPatch` 路径**施加配方、断言**引擎自己的不变量**，并把那一行日志原文钉住。
 *   配方实现见 `dev-patch.ts`，挂在 `main.ts` 的 `__rich4.debug` 上。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MkfArchive } from '@rich4/assets-pipeline';
import {
  OBJECT_COUNT,
  deserializeGame,
  makeObjects,
  newGame,
  objectTypeOf,
  parseMap,
  serializeGame,
  stateFingerprint,
  type GameState,
  type MapObject,
  type MapTopology,
} from '@rich4/core';
import { FlightRecorder } from './flight-recorder.ts';
import {
  DEV_PATCH_LOG_LINE,
  DOG_TYPE,
  applyPatch,
  attachGodToCurrentPlayer,
  attachLogLine,
  dogLogLine,
  giveAngel,
  giveSmallPovertyGod,
  nextNodeOf,
  placeDogAhead,
  type DevPatchHost,
} from './dev-patch.ts';

/** 与 main.ts 的 `topo` 逐项一致；地图读仓库里随包的那份（与 flight-recorder.test.ts 同一做法）*/
const MAP_MKF = new URL('../../../assets/game/map.mkf', import.meta.url);
const haveMap = existsSync(MAP_MKF) && readFileSync(MAP_MKF).length > 1_000_000;

/** 一个「宿主」：把 main.ts 里那四根线（读/写/log/taint）换成可断言的探针 */
function makeHost(state: GameState): {
  host: DevPatchHost;
  get: () => GameState;
  lines: string[];
  taints: () => number;
  recorder: FlightRecorder;
} {
  let current = state;
  const lines: string[] = [];
  let taints = 0;
  const recorder = new FlightRecorder();
  return {
    host: {
      getState: () => current,
      setState: (s) => {
        current = s;
      },
      log: (line) => lines.push(line),
      taint: () => {
        taints++;
        recorder.taint();
      },
    },
    get: () => current,
    lines,
    taints: () => taints,
    recorder,
  };
}

describe('W-53 `__rich4.debug.patch` 的接线', () => {
  it('把 fn 的返回值写回、记一行 `[dev] state patched`、并把记录仪标脏', () => {
    const before = { turn: 3 } as unknown as GameState;
    const after = { turn: 4 } as unknown as GameState;
    const { host, get, lines, taints, recorder } = makeHost(before);

    const got = applyPatch(host, () => after);

    expect(got).toBe(after);
    expect(get()).toBe(after);
    expect(lines).toEqual([DEV_PATCH_LOG_LINE]);
    expect(lines[0]).toBe('[dev] state patched');
    expect(taints()).toBe(1);
    expect(recorder.devPatched).toBe(true);
  });

  it('fn 原样返回也会记一行、也会标脏（调用本身就破坏了「报告 = 纯重放」）', () => {
    const s = { turn: 3 } as unknown as GameState;
    const { host, lines, taints } = makeHost(s);
    applyPatch(host, (cur) => cur);
    expect(lines).toEqual([DEV_PATCH_LOG_LINE]);
    expect(taints()).toBe(1);
  });

  it('fn 抛错 ⇒ 不写回（让控制台看见原始异常）', () => {
    const s = { turn: 3 } as unknown as GameState;
    const { host, get, lines, taints } = makeHost(s);
    expect(() =>
      applyPatch(host, () => {
        throw new Error('配方炸了');
      }),
    ).toThrow('配方炸了');
    expect(get()).toBe(s);
    expect(lines).toEqual([]);
    expect(taints()).toBe(0);
  });
});

describe('W-53 配方的输入保护（物件表自相矛盾时不许硬写）', () => {
  /** 一格邻接都没有的自造地形 —— 只为让 `nextNodeOf` 走到「查物件表」那一步 */
  const node5 = {
    id: 5, x: 0, y: 0, name: '', adjacent: [],
    adjacentSlots: [0, 0, 0, 0], type: 0, ref: 0, decorIndex: 0,
  };
  const topo = {
    nodes: [node5, node5, node5, node5, node5],
    lands: [],
    facilities: [],
    commercials: [],
    landscapes: [],
  } as unknown as MapTopology;

  it('惡犬槽（下标 10）的种类不是 11 ⇒ 拒绝，状态原样退回', () => {
    const broken: GameState = {
      currentPlayer: 0,
      players: [{ index: 0, nodeId: 5, lastNodeId: 0 }],
      rngState: 1,
      objects: makeObjects(OBJECT_COUNT).map((o, i) => (i === 10 ? { ...o, type: 99 } : o)),
    } as unknown as GameState;
    // 无候选 ⇒ 原路返回上一格；`lastNodeId` 为 0 时原地不动（`pickNextNode`）⇒ 下一格 = 5
    expect(nextNodeOf(broken, topo)).toBe(5);
    const out = placeDogAhead(broken, topo);
    expect(out.refused).toContain('物件表已自相矛盾');
    expect(out.state).toBe(broken);
    expect(out.nodeId).toBe(0);
  });

  it('天使槽（下标 8）的种类不是 9 ⇒ 拒绝，状态原样退回', () => {
    const broken: GameState = {
      currentPlayer: 0,
      players: [{ index: 0, nodeId: 5, lastNodeId: 4, godInfo: 0 }],
      objects: makeObjects(OBJECT_COUNT).map((o, i) => (i === 8 ? { ...o, type: 99 } : o)),
    } as unknown as GameState;
    const out = attachGodToCurrentPlayer(broken, 8);
    expect(out.refused).toContain('物件表已自相矛盾');
    expect(out.state).toBe(broken);
    expect(out.godInfo).toBe(0);
  });
});

if (haveMap) {
  const map = parseMap(new MkfArchive(new Uint8Array(readFileSync(MAP_MKF))).read(1));
  const topo: MapTopology = {
    nodes: map.nodes,
    lands: map.lands,
    facilities: map.facilities,
    commercials: map.commercials,
    landscapes: map.landscapes,
  };

  /** 与 `flight-recorder.test.ts` 同一开局；seed 固定 ⇒ 配方的断言可复现 */
  const freshGame = (): GameState =>
    newGame({
      map,
      globalMapId: 0,
      seed: 7,
      players: [0, 3, 5, 7].map((character) => ({ character, kind: 'computer' as const })),
    });

  /** 引擎自己的判据：这一格上「可被踩到」的物件 handle（`reduce.ts` 的 `objectHandleAt`）*/
  const handleAt = (objects: readonly MapObject[], nodeId: number): number => {
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      if (o !== undefined && o.nodeId === nodeId && o.attached === 0) return i + 1;
    }
    return 0;
  };

  describe('★ 配方 ①：惡犬摆到当前玩家的下一个落点', () => {
    it('惡犬落在 nextNodeOf() 那一格，type 11、attached 0、那一格只有它一个', () => {
      const before = freshGame();
      const next = nextNodeOf(before, topo);
      expect(next).not.toBeNull();

      const { host, get, lines } = makeHost(before);
      applyPatch(host, (s) => placeDogAhead(s, topo).state);
      const after = get();

      const slot = 10; // 种类 11 的槽位（OBJECT_TYPE_TABLE[10] = 11）
      expect(objectTypeOf(slot)).toBe(DOG_TYPE);
      const dog = after.objects[slot]!;
      expect(dog.type).toBe(DOG_TYPE);
      expect(dog.nodeId).toBe(next);
      expect(dog.attached).toBe(0);
      expect(dog.state).toBe(0);

      // 引擎踩到时会认它（`objectHandleAt` 的条件：nodeId 相同且 attached === 0）
      expect(handleAt(after.objects, next!)).toBe(slot + 1);
      // 一个节点上不许站两个未附身物件
      expect(after.objects.filter((o) => o.nodeId === next && o.attached === 0)).toHaveLength(1);
      // 其余 45 个物件一个都没动
      const moved = before.objects.filter((o, i) => i !== slot && o.nodeId !== after.objects[i]!.nodeId);
      expect(moved).toEqual([]);

      expect(dogLogLine(placeDogAhead(before, topo))).toBe(
        `[dev] 惡犬（type 11，槽下标 10）已擺到第 ${next} 格（handle=11，attached=0）`,
      );
      expect(lines).toEqual(['[dev] state patched']);
      // 现场被改过 ⇒ 起点 + 轨迹不再是它的来源（F9 报告要靠这个标志拒验指纹）
      expect(stateFingerprint(after)).not.toBe(stateFingerprint(before));
      expect(deserializeGame(serializeGame(after)).objects[slot]!.nodeId).toBe(next);
    });
  });

  describe('★ 配方 ②③：给当前玩家一个附身神明', () => {
    it('② 天使 ⇒ godInfo = 9（槽下标 8 的 handle），物件跟到玩家脚下', () => {
      const before = freshGame();
      const me = before.players[before.currentPlayer]!;
      const { host, get, lines, taints, recorder } = makeHost(before);

      applyPatch(host, (s) => giveAngel(s).state);
      const after = get();
      const host2 = after.players[after.currentPlayer]!;

      expect(host2.godInfo).toBe(9);
      expect(objectTypeOf(8)).toBe(9); // 种类号 9 = 天使
      const obj = after.objects[8]!;
      expect(obj.type).toBe(9);
      expect(obj.nodeId).toBe(host2.nodeId);
      expect(obj.attached).toBe(after.currentPlayer + 1);
      expect(obj.state).toBe(7); // 附身后写 7（死神才写 13）
      // ★ 三项修正：天使 = 衰運 −100、財運 +60、福運 +60（GOD_MODIFIERS[9]）
      expect(host2.misfortune).toBe(me.misfortune - 100);
      expect(host2.fortune).toBe(me.fortune + 60);
      expect(host2.luck).toBe(me.luck + 60);
      // ★ 天使全局只有一个（下标 8 那个）⇒ 不会出现「身上附着一个、地上还站着一个」
      expect(after.objects.filter((o) => o.type === 9)).toHaveLength(1);

      expect(attachLogLine('天使', giveAngel(before))).toBe(
        '[dev] 天使 附身：godInfo=9（handle=9），舊神明=无',
      );
      expect(lines).toEqual(['[dev] state patched']);
      expect(taints()).toBe(1);
      expect(recorder.report({
        reason: 'manual', note: '', env: {}, finalState: 'x', finalFingerprint: 'y', finalTurn: 0,
        screenshot: null, now: new Date(0),
      }).devPatched).toBe(true);
    });

    it('③ 小窮神 ⇒ godInfo = 5（槽下标 4 的 handle）—— 附身（壞神）那一路', () => {
      const before = freshGame();
      const me = before.players[before.currentPlayer]!;
      const { host, get } = makeHost(before);

      applyPatch(host, (s) => giveSmallPovertyGod(s).state);
      const after = get();
      const host2 = after.players[after.currentPlayer]!;

      expect(host2.godInfo).toBe(5);
      expect(objectTypeOf(4)).toBe(5); // 种类号 5 = 小窮神
      const obj = after.objects[4]!;
      expect(obj.type).toBe(5);
      expect(obj.nodeId).toBe(host2.nodeId);
      expect(obj.attached).toBe(after.currentPlayer + 1);
      // ★ 三项修正：小窮神 = 衰運 +100、財運 −60（GOD_MODIFIERS[5]）
      expect(host2.misfortune).toBe(me.misfortune + 100);
      expect(host2.fortune).toBe(me.fortune - 60);
      expect(host2.luck).toBe(me.luck);
      expect(attachLogLine('小窮神', giveSmallPovertyGod(before))).toBe(
        '[dev] 小窮神 附身：godInfo=5（handle=5），舊神明=无',
      );
      // 小窮神在开局是**摆在地图上**的（INITIAL_OBJECT_TYPES 含 5）⇒ 必须被请下来
      expect(after.objects[4]!.nodeId).toBe(host2.nodeId);
    });

    it('身上已有神明时再附 ⇒ 旧的被请下地图，godInfo 只剩新的那个', () => {
      const before = freshGame();
      const withAngel = giveAngel(before).state;
      const out = giveSmallPovertyGod(withAngel);
      expect(out.refused).toBeNull();
      expect(out.displaced).toBe(9);
      const after = out.state;
      expect(after.players[after.currentPlayer]!.godInfo).toBe(5);
      // 旧天使：attached 清 0、nodeId 清 0（搭档落点未接，Q-OBJ-2）
      expect(after.objects[8]).toMatchObject({ type: 9, nodeId: 0, state: 0, attached: 0 });
      // 只有新神明跟着玩家
      expect(after.objects.filter((o) => o.attached !== 0)).toHaveLength(1);
      expect(attachLogLine('小窮神', out)).toContain('舊神明=handle 9 已请下地图');
    });
  });

  describe('★ 回报带上 `devPatched` ⇒ `tools/replay-report.ts` 拒绝验指纹', () => {
    const TOOL = fileURLToPath(new URL('../../../tools/replay-report.ts', import.meta.url));
    const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

    /**
     * 造一份**轨迹为空**的回报：起点 = 终点 ⇒ 不跑任何 action 也能得到「指纹一致」。
     * 于是「不一致」只可能来自我们插进去的那一位。
     */
    function fabricate(path: string, devPatched: boolean): void {
      const st = freshGame();
      writeFileSync(
        path,
        JSON.stringify({
          version: 1,
          createdAt: '2026-09-19T00:00:00.000Z',
          note: 'W-53 单测自造',
          reason: 'manual',
          env: { desktop: false, screen: 'game', userAgent: 'vitest' },
          base: serializeGame(st),
          baseTurn: st.turnCount,
          trail: [],
          finalState: serializeGame(st),
          finalFingerprint: stateFingerprint(st),
          errors: [],
          screenshot: null,
          ...(devPatched ? { devPatched: true } : {}),
        }),
      );
    }

    const run = (report: string): { status: number | null; out: string } => {
      const r = spawnSync(
        process.execPath,
        ['--experimental-strip-types', '--no-warnings', TOOL, report],
        { cwd: ROOT, encoding: 'utf8' },
      );
      return { status: r.status, out: `${r.stdout}${r.stderr}` };
    };

    it('干净的回报：照常验指纹（✅ 一致、退出码 0）', () => {
      const dir = mkdtempSync(join(tmpdir(), 'w53-report-'));
      const file = join(dir, 'clean.json');
      fabricate(file, false);
      const r = run(file);
      expect(r.out).toContain('✅ 重放指纹与回报一致');
      expect(r.status).toBe(0);
    });

    it('`devPatched: true`：拒绝验指纹（退出码 3，不报「不一致」）', () => {
      const dir = mkdtempSync(join(tmpdir(), 'w53-report-'));
      const file = join(dir, 'patched.json');
      fabricate(file, true);
      const r = run(file);
      expect(r.out).toContain('这份报告来自被改过的状态');
      expect(r.out).not.toContain('❌ 指纹不一致');
      expect(r.status).toBe(3);
    });
  });
}
