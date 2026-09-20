/*
 * 工具栏摆位
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  actorTokens,
  playerAnchorWorld,
  ASLEEP_FILTER,
  attachedObjectTokens,
  actorWalkSteps,
  BoardRenderer,
  buildingArtItems,
  RING_UNOWNED,
  SLOT_NO_RECOLOR,
  ringColor,
  actorWalkTotalMs,
  actorWalkTriggers,
  DOLL_STAND_RESOURCE,
  DOLL_WALK_RESOURCE,
  DRAW_CLASS,
  drawKey,
  hitToolbar,
  isAsleep,
  isActorAsleep,
  cameraCenter,
  characterCamera,
  pixelCamera,
  worldToScreen,
  landArt,
  objectTokens,
  SPECIAL_ACTOR_SPRITE_BASE,
  specialActorImageSet,
  TOOLBAR,
  TOOLBAR_RIGHT,
  toolbarIconAt,
} from './render.ts';
import {
  buildingResource,
  chainStoreResource,
  decorImageIndex,
  EMPTY_LAND_LOGO_RESOURCE,
  facilitySlot,
  SpriteCache,
  TOOLBAR_ICON_COUNT,
  TOOLBAR_STRIP_IMAGE,
  type Sprite,  DeferredSpriteClose,
} from './assets.ts';
import { tweenTickCount } from './tween.ts';
import { LAYOUT } from './stage.ts';
import {
  ACTOR_PLACE,
  makeFacility,
  makeGameState,
  makeLand,
  makeNode,
  makePlayer,
  type GameState,
  type LandInfo,
  type MapNode,
  type Player,
  type Rich4Map,
  type SpecialActor,
  initialSpecialActors,
  releaseNpc,
} from '@rich4/core';

/*
 * 工具栏的格 —— `x / 40`，11 格铺满 440。@source fcn_00415d31 与 loc_00418b0a
 *
 * 这里钉死的是**间距 40**。先前是 39（拿 439 宽的底条图反推「两侧各留 5」），
 * 后果是左边图标偏右、右边图标偏左 —— 越靠边歪得越多（需求方 2026-09-15 报）。
 */
describe('★ 工具栏：等距 40、从 x=0 起、11 格正好 440', () => {
  it('★ 间距是 40，不是 39；也没有左边距', () => {
    expect(TOOLBAR.pitch).toBe(40);
    expect(TOOLBAR.x).toBe(0);
    expect(TOOLBAR_RIGHT).toBe(440);
    expect(TOOLBAR_RIGHT).toBe(TOOLBAR.pitch * TOOLBAR_ICON_COUNT);
  });

  it('★ 图标锚点在每格正中：(i*40 + 20, 20)', () => {
    expect(TOOLBAR.iconX).toBe(20);
    expect(TOOLBAR.iconY).toBe(20);
    expect(toolbarIconAt(0)).toEqual({ x: 20, y: 20 });
    // 第 11 个：10*40+20 = 420，正好是 [400,440) 的中点
    expect(toolbarIconAt(10)).toEqual({ x: 420, y: 20 });
    for (let i = 0; i < TOOLBAR_ICON_COUNT; i++) {
      const at = toolbarIconAt(i);
      expect(at.x).toBe(i * TOOLBAR.pitch + TOOLBAR.pitch / 2);
    }
  });

  it('★ 每格的左右端点都归自己（40 的整数倍是这一格的开头）', () => {
    for (let i = 0; i < TOOLBAR_ICON_COUNT; i++) {
      expect(hitToolbar(i * 40, 20)).toBe(i);
      expect(hitToolbar(i * 40 + 39, 20)).toBe(i);
    }
    // 边界：399 还是第 9 格、400 是第 10 格
    expect(hitToolbar(399, 20)).toBe(9);
    expect(hitToolbar(400, 20)).toBe(10);
  });

  it('★ 440 起是側欄，不算工具栏（原版 `cmp x, 0x1b8`）', () => {
    expect(hitToolbar(440, 20)).toBeNull();
    expect(hitToolbar(LAYOUT.toolbar.w + 5, 10)).toBeNull();
  });

  it('工具栏之外：下面那一行、以及负坐标 → null', () => {
    expect(hitToolbar(20, TOOLBAR.height)).toBeNull();
    expect(hitToolbar(20, -1)).toBeNull();
    expect(hitToolbar(TOOLBAR.x - 1, 10)).toBeNull();
  });

  it('底条自身的图号是 0', () => {
    expect(TOOLBAR_STRIP_IMAGE).toBe(0);
  });
});

describe('★ 「地图视角」已删（D-086-5）', () => {
  it('★ 原版没有缩放/平移视角 —— `fitCamera` 与 `ViewMode` 都不该再存在', () => {
    const src = readFileSync(new URL('./render.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('export function fitCamera');
    // ⚠️ 不能用裸 'ViewMode' —— 注释里的 `setViewMode` 会命中这个子串
    expect(src).not.toContain('type ViewMode');
    expect(src).not.toContain('mode: ViewMode');
    expect(src).not.toContain("mode: 'character'");
  });
});

describe('★ 绘制槽的排序键（Q-DRAW-1）—— 遮挡关系全靠它', () => {
  it('主序是**屏幕 Y**：屏幕 Y 小的先画（先画 = 会被后画的盖住）', () => {
    // 屏幕 Y 小 = 靠后（远），必须先画；这正是等距视角的画家顺序
    expect(drawKey(100, DRAW_CLASS.building)).toBeLessThan(drawKey(101, DRAW_CLASS.building));
    expect(drawKey(-50, DRAW_CLASS.building)).toBeLessThan(drawKey(0, DRAW_CLASS.building));
  });

  it('★ 同屏幕 Y 时：建筑先画、人物后画 —— 这就是「建筑挡得住人物」的机制', () => {
    const y = 200;
    // 建筑类别 0x0 < 玩家 0xc/0xd ⇒ 建筑排在前面 ⇒ 后画的人物盖住建筑
    expect(drawKey(y, DRAW_CLASS.building)).toBeLessThan(drawKey(y, DRAW_CLASS.player));
    expect(drawKey(y, DRAW_CLASS.player)).toBeLessThan(drawKey(y, DRAW_CLASS.currentPlayer));
  });

  it('类别只做同 Y 的 tie-break，不会盖过屏幕 Y 的主序', () => {
    // 屏幕 Y 差 1，键差 16；类别最大 0xf < 16，故跨 Y 时类别翻不过来
    expect(drawKey(200, DRAW_CLASS.building)).toBeLessThan(drawKey(201, DRAW_CLASS.currentPlayer));
    // 反例检查：若把类别当主序，这一条会失败
    expect(drawKey(200, 0xf) - drawKey(200, 0x0)).toBe(0xf);
  });

  it('★ 关键症状：站在高大建筑**背后**的棋子必须排在建筑前面', () => {
    // 建筑底座在屏幕 Y=300；棋子站在它背后（屏幕 Y 更小 = 更远）
    const building = drawKey(300, DRAW_CLASS.building);
    const behind = drawKey(260, DRAW_CLASS.currentPlayer);
    const inFront = drawKey(340, DRAW_CLASS.currentPlayer);
    expect(behind).toBeLessThan(building); // 远处的人先画 ⇒ 被建筑盖住 ✓
    expect(building).toBeLessThan(inFront); // 近处的人后画 ⇒ 盖住建筑 ✓
  });

  it('负数屏幕 Y 按 12 位截断后仍排在正数之前（原版就是这么算的）', () => {
    expect(drawKey(-1, DRAW_CLASS.building)).toBeLessThan(drawKey(0, DRAW_CLASS.building));
    expect(drawKey(-1, DRAW_CLASS.building)).toBeLessThan(0);
  });
});

describe('★★ 棋子世界坐标：读 `xpos/ypos`，不拿 `nodeId` 现推（第 86 条）', () => {
  it('在盘上站定 ⇒ 与所在格坐标一致', () => {
    expect(playerAnchorWorld({ nodeId: 12, xpos: 1248, ypos: 1583 })).toEqual({
      x: 1248,
      y: 1583,
    });
  });

  it('★★ 关押期间 ⇒ 是**景观坐标**（綠島），不是監獄格坐标', () => {
    // 監獄格 12 = (1248,1583)、綠島（景观记录 2）= (1817,1960)
    expect(playerAnchorWorld({ nodeId: 12, xpos: 1817, ypos: 1960 })).toEqual({
      x: 1817,
      y: 1960,
    });
  });

  it('不在盘上（`nodeId == 0`）⇒ 不画', () => {
    expect(playerAnchorWorld({ nodeId: 0, xpos: 1817, ypos: 1960 })).toBeNull();
  });

  it('坐标被清空 ⇒ 不画（与 `xpos != 0` 那条原版判据同义）', () => {
    expect(playerAnchorWorld({ nodeId: 12, xpos: 0, ypos: 0 })).toBeNull();
  });
});

/*
 * ══════════════════════════════════════════════════════════════════════════
 *  T-047：四大惡人 / 機器娃娃的棋子渲染与走子
 *
 *  「state → 渲染输入」的映射全在模块顶层的纯函数里（`specialActorImageSet` /
 *  `actorTokens` / `actorWalkSteps`），这里逐条钉住，绘制那边只做 IO。
 * ══════════════════════════════════════════════════════════════════════════
 */

/** 解出来的原版素材目录（用来核对每组的图数） */
const DATA_DIR = (process.env.RICH4_WORKSPACE ?? '') + '/assets-clean/Data';

/** 造一张只有 n 个节点的直线地图，节点间隔 40 世界单位 */
function lineNodes(n: number): MapNode[] {
  return Array.from({ length: n }, (_, i) =>
    makeNode({ id: i + 1, x: i * 40, y: 0, adjacent: [i, i + 2].filter((v) => v >= 1 && v <= n) }),
  );
}

describe('★ T-047 替身的图组资源号 —— 全部照 exe，不许猜', () => {
  it('四個 NPC = 0x16c + actor×4（站姿），走姿 = +1 @source VA 0x0040bd51', () => {
    expect(SPECIAL_ACTOR_SPRITE_BASE).toBe(0x16c);
    // actor 4/5/6/7 → 380/384/388/392，与 NPC_NAMES 同序
    expect(specialActorImageSet(4, false)).toBe(380);
    expect(specialActorImageSet(5, false)).toBe(384);
    expect(specialActorImageSet(6, false)).toBe(388);
    expect(specialActorImageSet(7, false)).toBe(392);
    for (const actor of [4, 5, 6, 7]) {
      const stand = specialActorImageSet(actor, false)!;
      expect(specialActorImageSet(actor, true)).toBe(stand + 1);
      expect(stand).toBe(0x16c + actor * 4);
    }
  });

  it('★ 機器娃娃（actor 8）的两张是写死的 0x209 / 0x20a，**不与基号连号**', () => {
    expect(DOLL_STAND_RESOURCE).toBe(0x209); // 521，8 张 = 8 向各 1 帧
    expect(DOLL_WALK_RESOURCE).toBe(0x20a); // 522，40 张 = 8 向 × 5 帧
    expect(specialActorImageSet(8, false)).toBe(0x209);
    expect(specialActorImageSet(8, true)).toBe(0x20a);
    // 反例检查：若照 NPC 那套公式算，actor 8 会得到 0x18c（396），与原版不符
    expect(specialActorImageSet(8, false)).not.toBe(0x16c + 8 * 4);
  });

  it('★ 夢遊走姿 = `+3`（另一套 17 帧循环），且**優先于**載具那張 @source VA 0x0040bd5c', () => {
    // +13（days_sleep_walking）非 0 → 走姿 edi + 3；站姿仍是 edi
    for (const actor of [4, 5, 6, 7]) {
      const stand = specialActorImageSet(actor, false)!;
      expect(specialActorImageSet(actor, true, false, true), `actor ${actor}`).toBe(stand + 3);
      // 站姿不受夢遊影响（原版只换走姿槽）
      expect(specialActorImageSet(actor, false, false, true), `actor ${actor} 站姿`).toBe(stand);
    }
    // 原版两处是 `add edi, N` 后直接落走姿槽、不二次判断 ⇒ +3 优先
    expect(specialActorImageSet(4, true, true, true)).toBe(0x16c + 4 * 4 + 3);
    // 不夢遊时載具那一支照旧
    expect(specialActorImageSet(4, true, true, false)).toBe(0x16c + 4 * 4 + 2);
    // 機器娃娃资源写死，夢遊那一位对它不适用（原版 actor≥8 另起一支）
    expect(specialActorImageSet(8, true, false, true)).toBe(DOLL_WALK_RESOURCE);
  });

  it('★ 四组的图数逐条实measure：`+1` 与 `+3` 都是走姿，但帧数不同', () => {
    // 解出的图（`assets-clean/Data/<资源>_*.png` 的张数，8 向等分）：
    //   actor 4: 380=8立  381=152走(19帧/向)  382=64載具(8)   383=136夢遊(17帧/向)
    //   actor 5: 384=8立  385= 80走(10帧/向)  386=72載具(9)   387= 80夢遊(10帧/向)
    //   actor 6: 388=8立  389=120走(15帧/向)  390=64載具(8)   391=120夢遊(15帧/向)
    //   actor 7: 392=8立  393= 80走(10帧/向)  394=72載具(9)   395= 80夢遊(10帧/向)
    // ⇒ 「+3 是另一套循环」成立（帧数与 +1 不同，或帧宽不同）。
    const FRAMES: Record<number, [number, number, number, number]> = {
      4: [8, 152, 64, 136],
      5: [8, 80, 72, 80],
      6: [8, 120, 64, 120],
      7: [8, 80, 72, 80],
    };
    for (const [actor, want] of Object.entries(FRAMES)) {
      const a = Number(actor);
      const base = SPECIAL_ACTOR_SPRITE_BASE + a * 4;
      for (let k = 0; k < 4 && existsSync(DATA_DIR); k++) {
        const n = readdirSync(DATA_DIR).filter((f) =>
          new RegExp(`^0${base + k}_\\d{3}\\.png$`).test(f),
        ).length;
        expect(n, `actor ${a} 资源 ${base + k} 的图数`).toBe(want[k]);
      }
      // 资源号映射
      expect(specialActorImageSet(a, false, false, false)).toBe(base);
      expect(specialActorImageSet(a, true, false, false)).toBe(base + 1);
      expect(specialActorImageSet(a, true, true, false)).toBe(base + 2);
      expect(specialActorImageSet(a, true, false, true)).toBe(base + 3);
    }
  });

  it('玩家（0..3）与越界都不认 —— 那条路走 `characterSetBase`', () => {
    for (const actor of [0, 1, 2, 3, 9, -1]) {
      expect(specialActorImageSet(actor, false)).toBeNull();
      expect(specialActorImageSet(actor, true)).toBeNull();
    }
  });

  it('★ 夢遊走姿與冬眠變灰是**兩個不同字段**（`+13` vs `+12`）', () => {
    // @source 夢遊：`rich4.asm:0x0040bd5c` cmp byte [rec+13]（換走姿圖組 +3）
    // @source 冬眠：`rich4.asm:1533` cmp byte [rec+12]（去色）—— 0x498e34 − 0x498e28 = 12
    expect(isActorAsleep({})).toBe(false);
    expect(isActorAsleep({ hibernating: 0 })).toBe(false);
    expect(isActorAsleep({ hibernating: 5 })).toBe(true);
    // 夢遊天數**不**讓棋子變灰（它只換走姿圖）
    expect(isActorAsleep({ sleepwalkDays: 5 })).toBe(false);
    // 兩者可以同時非 0（卡先後命中）；此時既變灰也換走姿
    expect(isActorAsleep({ hibernating: 5, sleepwalkDays: 5 })).toBe(true);
  });

  it('★★ 夢遊/冬眠中的棋子画成灰的（`_rich4_convert_sprite` 的近似）', () => {
    // @source VA 0x004087d7：玩家 `+0x36`（days_sleeping）非 0 时先转换再画。
    // 本引擎的等价字段是 `blocking.sleeping`。
    expect(isAsleep({ sleeping: 0 })).toBe(false);
    expect(isAsleep({ sleeping: 5 })).toBe(true);
    expect(isAsleep({ sleeping: 1 })).toBe(true);
    // 去色 filter 必须真的去色（saturate(0)），不能只调亮度
    expect(ASLEEP_FILTER).toContain('saturate(0)');
    // ★ 结构断言：绘制那一支必须**在 drawImage 两侧**设/清 filter，
    //   否则这个 filter 会漏到后面所有绘制（棋子、建筑全变灰）
    const src = readFileSync(new URL('./render.ts', import.meta.url), 'utf8');
    const at = src.indexOf('if (asleep) ctx.filter = ASLEEP_FILTER;');
    expect(at).toBeGreaterThan(0);
    const after = src.slice(at, at + 200);
    expect(after).toContain('ctx.drawImage(token.bitmap');
    expect(after, '画完必须清掉 filter').toContain("if (asleep) ctx.filter = 'none';");
  });

  it('★★ 载具那一支：脚下节点 bit31（`noObjects`）置位时**走姿**换成 +2', () => {
    // @source `_rich4_update_player_sprite` VA 0x0040bdd6：
    //   `test byte [node + 0x27], 0x80` → 置位则 `add edi, 2` 读进**走姿**槽
    //   （`[0x498ec0]`，@0x0040be3f）。站姿仍是常规那一张。
    for (const actor of [4, 5, 6, 7]) {
      const stand = 0x16c + actor * 4;
      expect(specialActorImageSet(actor, false, true), '载具不换站姿').toBe(stand);
      expect(specialActorImageSet(actor, true, true), '载具换的是走姿').toBe(stand + 2);
      // 不置位时不受影响（默认参数 = 常规那一支）
      expect(specialActorImageSet(actor, true)).toBe(stand + 1);
      expect(specialActorImageSet(actor, true, false)).toBe(stand + 1);
    }
    // 機器娃娃（actor 8）资源写死，没有 +2 变体
    expect(specialActorImageSet(8, true, true)).toBe(DOLL_WALK_RESOURCE);
    // 玩家不是替身，载具标志也救不了
    expect(specialActorImageSet(2, true, true)).toBeNull();
  });

  it('★ 绘制槽类别：替身非当前是 0x8（排在玩家 0xc 下面），当前是 0xd', () => {
    expect(DRAW_CLASS.npc).toBe(0x8);
    const y = 200;
    expect(drawKey(y, DRAW_CLASS.npc)).toBeLessThan(drawKey(y, DRAW_CLASS.player));
    expect(drawKey(y, DRAW_CLASS.player)).toBeLessThan(drawKey(y, DRAW_CLASS.currentPlayer));
  });
});

describe('★ T-047 state → 替身棋子（`actorTokens`）', () => {
  /** 把某个替身放到棋盘上 */
  const withActor = (
    slot: number,
    over: Partial<GameState['specialActors'][number]>,
  ): GameState => {
    const s = makeGameState();
    const specialActors = [...s.specialActors];
    specialActors[slot] = {
      nodeId: 2,
      lastNodeId: 1,
      direction: 0,
      owner: 0,
      stepsRemaining: 3,
      halted: 0,
      singleStep: 0,
      place: ACTOR_PLACE.board,
      ...over,
    };
    return { ...s, specialActors };
  };

  it('只有 `place === board` 的才画 —— 監獄／醫院／未出场一律跳过 @source VA 0x00408b82', () => {
    // 开局就是「两監獄两醫院 + 娃娃未出场」
    expect(actorTokens(makeGameState(), lineNodes(4), { view: 0 })).toEqual([]);
    for (const place of [ACTOR_PLACE.prison, ACTOR_PLACE.hospital, ACTOR_PLACE.offBoard]) {
      expect(actorTokens(withActor(0, { place }), lineNodes(4), { view: 0 })).toEqual([]);
    }
    expect(actorTokens(withActor(0, {}), lineNodes(4), { view: 0 })).toHaveLength(1);
  });

  it('站姿/走姿的资源号跟着这一帧在不在播补间走，帧号站姿恒 0', () => {
    const s = withActor(0, { direction: 0 });
    const nodes = lineNodes(4);
    const stand = actorTokens(s, nodes, { view: 0 })[0]!;
    expect(stand.resource).toBe(380);
    expect(stand.walking).toBe(false);
    expect(stand.frame).toBe(0);

    const walk = actorTokens(s, nodes, { view: 0, walking: () => true, frame: () => 7 })[0]!;
    expect(walk.resource).toBe(381);
    expect(walk.walking).toBe(true);
    expect(walk.frame).toBe(7);
    // 站姿时即便给了帧号也不该用（`[0x498ea3]` 只在走的时候读）
    expect(actorTokens(s, nodes, { view: 0, frame: () => 7 })[0]!.frame).toBe(0);
  });

  it('★ 屏幕朝向 = (direction + 8 − 视角) & 7 —— 与玩家同一套 @source VA 0x0040882d', () => {
    const nodes = lineNodes(4);
    for (let dir = 0; dir < 8; dir++) {
      for (let view = 0; view < 8; view++) {
        const t = actorTokens(withActor(0, { direction: dir }), nodes, { view })[0]!;
        expect(t.screenDir).toBe((dir + 8 - view) & 7);
      }
    }
  });

  it('★ 五个槽 → actor 4..8，各自的图组不同（機器娃娃走 0x209/0x20a）', () => {
    const s = makeGameState();
    const specialActors = s.specialActors.map((_, i) => ({
      nodeId: i + 1,
      lastNodeId: 0,
      direction: 0,
      owner: 0,
      stepsRemaining: 0,
      halted: 0,
      singleStep: 0,
      place: ACTOR_PLACE.board,
    }));
    const tokens = actorTokens({ ...s, specialActors }, lineNodes(5), { view: 0 });
    expect(tokens.map((t) => t.actor)).toEqual([4, 5, 6, 7, 8]);
    expect(tokens.map((t) => t.resource)).toEqual([380, 384, 388, 392, 521]);
  });

  it('格心坐标与节点号来自 state —— exe 读的是替身记录自己的 x/y', () => {
    const nodes: MapNode[] = [
      makeNode({ id: 1, x: 100, y: 200 }),
      makeNode({ id: 2, x: 340, y: 560 }),
    ];
    const t = actorTokens(withActor(2, { nodeId: 2 }), nodes, { view: 0 })[0]!;
    expect(t.nodeId).toBe(2);
    expect(t.x).toBe(340);
    expect(t.y).toBe(560);
  });

  it('节点号 0（不在場）取不到节点 → 不画', () => {
    expect(actorTokens(withActor(0, { nodeId: 0 }), lineNodes(4), { view: 0 })).toEqual([]);
    // nodeId 越界同理
    expect(actorTokens(withActor(0, { nodeId: 99 }), lineNodes(4), { view: 0 })).toEqual([]);
  });

  it('当前行动者（`[0x49910c]`）那一个用 0xd，其余 0x8', () => {
    const s = makeGameState();
    const specialActors = s.specialActors.map((_, i) => ({
      nodeId: i + 1,
      lastNodeId: 0,
      direction: 0,
      owner: 0,
      stepsRemaining: 0,
      halted: 0,
      singleStep: 0,
      place: ACTOR_PLACE.board,
    }));
    const tokens = actorTokens({ ...s, specialActors }, lineNodes(5), { view: 0, currentActor: 6 });
    expect(tokens.map((t) => t.klass)).toEqual([
      DRAW_CLASS.npc,
      DRAW_CLASS.npc,
      DRAW_CLASS.currentPlayer,
      DRAW_CLASS.npc,
      DRAW_CLASS.npc,
    ]);
    // 不传 currentActor（core 目前不暴露「当前替身」）→ 一律 0x8
    expect(actorTokens({ ...s, specialActors }, lineNodes(5), { view: 0 }).map((t) => t.klass)).toEqual(
      [0x8, 0x8, 0x8, 0x8, 0x8],
    );
  });
});

describe('★ T-047 替身走子补间：tick 数一律走 dist × 0.125（没有交通方式那一支）', () => {
  it('★ tick 数 = trunc(世界距离 × 0.125)，且 `special` 恒为真 @source VA 0x0040c5e6', () => {
    const nodes = lineNodes(3); // 节点间隔 40
    const steps = actorWalkSteps([1, 2, 3], nodes, 40);
    expect(steps).toHaveLength(2);
    for (const s of steps) {
      // 与玩家「乘骑」那一支同一公式；**不是** dist/速度
      expect(s.ticks).toBe(tweenTickCount(40, 0, 0, true));
      expect(s.ticks).toBe(Math.trunc(40 * 0.125));
      expect(s.ticks).toBe(5);
      expect(s.ms).toBe(5 * 40);
    }
  });

  it('★ tick 数只由**节点世界坐标**定，与镜头/缩放无关 @source VA 0x0040c4ac / 0x0040c5a8', () => {
    // @source 起点 `movsx eax, word [ebx]`（节点记录 +0x00/+0x02）、
    //   终点同一条记录表 —— 整支不读 `0x407a2c`（投影），故镜头不进公式。
    //   `actorWalkSteps` 现在**根本没有镜头入口**，这里把这一点钉死：
    //   同一条边算两次（同参）必须一样，且与「坐标乘 4」的假投影无关。
    const nodes = lineNodes(3);
    const a = actorWalkSteps([1, 2], nodes, 20);
    const b = actorWalkSteps([1, 2], nodes, 20);
    expect(a[0]!.ticks).toBe(5); // trunc(40 × 0.125)，由世界的 40 定
    expect(b[0]!.ticks).toBe(a[0]!.ticks);
    // ★ 反证「不是屏幕距离」：源文件里这一支不许再出现投影调用
    const src = readFileSync(new URL('./render.ts', import.meta.url), 'utf8');
    const at = src.indexOf('export function actorWalkSteps(');
    const body = src.slice(at, src.indexOf('\n}', at));
    expect(body).not.toContain('worldToScreen');
    expect(body).not.toContain('toScreen');
  });

  it('★ 一串格子首尾相接：`at` 累加、帧号跨格连算（`tickAt` 不归零）', () => {
    const nodes = lineNodes(4);
    const steps = actorWalkSteps([1, 2, 3, 4], nodes, 20);
    expect(steps.map((s) => s.ticks)).toEqual([5, 5, 5]);
    expect(steps.map((s) => s.at)).toEqual([0, 100, 200]);
    expect(steps.map((s) => s.tickAt)).toEqual([0, 5, 10]);
    expect(actorWalkTotalMs(steps)).toBe(300);
    // 每一格的端点就是那一格的节点
    expect(steps[0]!.from).toEqual({ x: 0, y: 0 });
    expect(steps[2]!.to).toEqual({ x: 120, y: 0 });
  });

  it('空串 / 单节点 / 断链 → 没有补间（不播，直接落格心）', () => {
    const nodes = lineNodes(3);
    expect(actorWalkSteps([], nodes, 20)).toEqual([]);
    expect(actorWalkSteps([2], nodes, 20)).toEqual([]);
    expect(actorWalkTotalMs([])).toBe(0);
    // 中间缺一环：不硬凑，直接截断（宁可少播，也不要画出不存在的格子）
    expect(actorWalkSteps([1, 2, 99, 3], nodes, 20)).toHaveLength(1);
  });

  it('★ 镜头外（旧实现里投影返回 null）再也不会退化成 1 tick', () => {
    // 先前 `toScreen → null` 会把这一格的 tick 钳成 1（长边直接瞬移）。
    // 现在 tick 只由世界坐标定：远到天边的两个节点照常算出 `trunc(dist × 0.125)`。
    const far = [
      makeNode({ id: 1, x: 0, y: 0 }),
      makeNode({ id: 2, x: 900, y: 1200 }),
    ] as unknown as MapNode[];
    const steps = actorWalkSteps([1, 2], far, 20);
    expect(steps[0]!.ticks).toBe(Math.trunc(1500 * 0.125)); // 187
    expect(steps[0]!.ticks).toBeGreaterThan(1);
  });
});

/*
 * ★★ 2026-09-18：走子一格的耗时只由**世界距离**定（需求方「人物走动偏慢」那一轮的
 *   取证副产物）。原版 `fcn_0040c05c` 全程在世界坐标里算：
 *   - 起点 `0x40c1d4/0x40c1db`：节点记录 `+0x00/+0x02`；
 *   - 终点 `0x40c205/0x40c20d`：落点记录同两个偏移；
 *   - 模长 `0x40c239..0x40c252`；除速度 `0x40c29e`；截断 `0x40c308`。
 *   ⇒ `n = trunc(世界距离 / speed) × tickMs`，**镜头/视角/缩放一概不进公式**。
 *   先前复刻用 `worldToScreen` 的距离：同一条边换个视角 tick 数就变，
 *   而且落点不在 29×29 窗口里时投影返回 null、被当成 1 tick。
 */
describe('★ 走子补间：一格的 tick 数按**世界**距离算，与镜头无关', () => {
  const renderer = (): BoardRenderer =>
    new BoardRenderer({} as CanvasRenderingContext2D, {
      addEvictListener: () => {
        /* 只算时长，不画 */
      },
    } as unknown as SpriteCache);

  it('`lastWalkMs()` = trunc(世界距离 / 速度) × tickMs —— 走路/機車/汽車各一条', () => {
    // 走路 8 世界单位/tick（VA 0x4749d8）：64 → 8 tick；80 → 10 tick；100 → 12 tick
    for (const [dist, traffic, speed] of [
      [64, 0, 8],
      [80, 1, 12],
      [100, 2, 16],
      [64, 3, 8],
    ] as const) {
      const r = renderer();
      r.startWalk(0, { x: 1000, y: 1000 }, { x: 1000 + dist, y: 1000 }, traffic, false, 40, 0);
      expect(r.lastWalkMs(), `dist=${dist} traffic=${traffic}`).toBe(
        Math.trunc(dist / speed) * 40,
      );
      // 与纯函数同源（`tween.ts` 有单测）
      expect(r.lastWalkMs()).toBe(tweenTickCount(dist, 0, traffic, false) * 40);
    }
  });

  it('★★ `walkRemainingMs()`：补间**还剩**多久；播完之后是 0（`lastWalkMs()` 播完仍返回整段 —— 拿它排下一步会白等）', () => {
    const r = renderer();
    expect(r.walkRemainingMs(0)).toBe(0); // 没有补间
    r.startWalk(0, { x: 1000, y: 1000 }, { x: 1064, y: 1000 }, 0, false, 40, 1000); // 8 tick × 40 = 320 ms
    expect(r.walkRemainingMs(1000)).toBe(320);
    expect(r.walkRemainingMs(1100)).toBe(220);
    expect(r.walkRemainingMs(1320)).toBe(0);
    expect(r.walkRemainingMs(9999)).toBe(0);
    // 对照：这就是先前让「結算 / 收尾 / 下一位开局」每步都多等一整格的那个值
    expect(r.lastWalkMs()).toBe(320);
  });

  it('★ `special`（乘骑/被抬走/替身）走 `dist × 0.125` —— 不管交通方式', () => {
    const r = renderer();
    r.startWalk(0, { x: 0, y: 0 }, { x: 100, y: 0 }, 2, true, 80, 0);
    expect(r.lastWalkMs()).toBe(Math.trunc(100 * 0.125) * 80); // 12 × 80
  });

  it('★ `isWalking(player)`：只有**那一位**、且在补间播完之前为真（「走回棋盘」靠它摆走姿）', () => {
    const r = renderer();
    expect(r.isWalking(0, 0)).toBe(false); // 没有补间
    // 走回棋盘：`special = true`、8 世界单位/拍 ⇒ 100 px = 12 拍
    r.startWalk(1, { x: 0, y: 0 }, { x: 100, y: 0 }, 2, true, 40, 1000);
    expect(r.isWalking(1, 1000)).toBe(true);
    expect(r.isWalking(1, 1479)).toBe(true); // 12 × 40 = 480 ms 内的最后一刻
    expect(r.isWalking(1, 1480)).toBe(false); // 播完
    // 别的玩家不算 —— 否则会给不相干的人摆走姿
    expect(r.isWalking(0, 1100)).toBe(false);
    expect(r.isWalking(2, 1100)).toBe(false);
  });

  it('★ 同一段位移、任何相机/视角下时长都一样 —— 公开 API 里已经没有镜头入口', () => {
    // 反证「不是屏幕距离」：`startWalk` 的形参表里不许再出现 `Camera` / 视口。
    const src = readFileSync(new URL('./render.ts', import.meta.url), 'utf8');
    const at = src.indexOf('  startWalk(');
    const head = src.slice(at, src.indexOf('): void {', at));
    expect(head).not.toContain('Camera');
    expect(head).not.toContain('vp');
    // 正证：同一段位移算两次（不同渲染器实例）得到同一个时长
    const a = renderer();
    const b = renderer();
    a.startWalk(0, { x: 500, y: 700 }, { x: 563, y: 748 }, 0, false, 80, 0);
    b.startWalk(0, { x: 500, y: 700 }, { x: 563, y: 748 }, 0, false, 80, 0);
    expect(a.lastWalkMs()).toBe(b.lastWalkMs());
    expect(a.lastWalkMs()).toBe(tweenTickCount(63, 48, 0, false) * 80); // trunc(79.0/8)=9
  });

  it('★ 补间在**世界**上等分、画的时候才投影（不是在屏幕端点之间等分）', () => {
    // `#walkScreen` 必须：先 `walkFramesFor(from, to, …)`（世界）再 `worldToScreen`
    const src = readFileSync(new URL('./render.ts', import.meta.url), 'utf8');
    const at = src.indexOf('  #walkScreen(');
    const body = src.slice(at, src.indexOf('\n  }', at));
    expect(body).toContain('walkFramesFor(w.from, w.to');
    expect(body).toContain('worldToScreen(p.x, p.y');
    // 端点的投影不再进插值 —— 旧写法是 `const a = worldToScreen(w.from…`
    expect(body).not.toContain('worldToScreen(w.from');
    expect(body).not.toContain('worldToScreen(w.to');
  });
});

describe('★ T-047 何时起补间（`actorWalkTriggers`）——「被保釋出来」那一步必须能播', () => {
  const board = (nodeId: number, lastNodeId: number, direction = 0): SpecialActor => ({
    nodeId,
    lastNodeId,
    direction,
    owner: 0,
    stepsRemaining: 0,
    halted: 0,
    singleStep: 0,
    place: ACTOR_PLACE.board,
  });
  const off = (place: SpecialActor['place']): SpecialActor => ({
    nodeId: 0,
    lastNodeId: 0,
    direction: 0,
    owner: 0,
    stepsRemaining: 0,
    halted: 0,
    singleStep: 0,
    place,
  });

  it('★ 監獄里的人上路：`seen = 0`（不在場）→ 落点变节点号，退化成补最后一格', () => {
    const actors = [board(7, 3), off(ACTOR_PLACE.prison), off(ACTOR_PLACE.hospital), off(ACTOR_PLACE.prison), off(ACTOR_PLACE.offBoard)];
    const r = actorWalkTriggers(actors, new Map([[0, 0]]));
    // `lastNodeId` 是 exe 留在 state 里唯一的「来路」→ 只能补这一格
    expect(r.walks).toEqual([{ slot: 0, path: [3, 7] }]);
    expect(r.seen.get(0)).toBe(7);
    expect(r.seen.get(4)).toBe(0);
  });

  it('★ 宿主喂了整趟路径 → 原样照播（这是 1:1 那条路）', () => {
    const actors = [board(9, 8), off(1), off(1), off(1), off(3)];
    const r = actorWalkTriggers(actors, new Map([[0, 0]]), [{ slot: 0, path: [2, 3, 5, 9] }]);
    expect(r.walks).toEqual([{ slot: 0, path: [2, 3, 5, 9] }]);
  });

  it('★ 首帧（進遊戲／讀檔）只记账不播 —— 一读档不该满盘替身乱滑', () => {
    const actors = [board(7, 3), off(1), off(1), off(1), off(3)];
    const r = actorWalkTriggers(actors, new Map());
    expect(r.walks).toEqual([]);
    expect(r.seen.get(0)).toBe(7);
    // 但首帧若宿主明确给了路径（真的刚走完一趟）→ 照播
    const withPath = actorWalkTriggers(actors, new Map(), [{ slot: 0, path: [5, 6, 7] }]);
    expect(withPath.walks).toEqual([{ slot: 0, path: [5, 6, 7] }]);
  });

  it('落点没变 = 还是同一趟，不重播（每帧都调也不会重启补间）', () => {
    const actors = [board(7, 3), off(1), off(1), off(1), off(3)];
    const first = actorWalkTriggers(actors, new Map([[0, 0]]));
    const again = actorWalkTriggers(actors, first.seen);
    expect(again.walks).toEqual([]);
  });

  it('龜行只走一格 / 原地没动 / lastNodeId 为 0（刚出场）→ 没有补间可播', () => {
    // 走了一格：lastNodeId 1 → nodeId 2，仍然是「补最后一格」
    expect(actorWalkTriggers([board(2, 1)], new Map([[0, 1]])).walks).toEqual([
      { slot: 0, path: [1, 2] },
    ]);
    // 原地（停留卡：这一步不走）→ 落点没变
    expect(actorWalkTriggers([board(5, 4)], new Map([[0, 5]])).walks).toEqual([]);
    // 刚出场、还没走：lastNodeId == 0
    expect(actorWalkTriggers([board(5, 0)], new Map([[0, 0]])).walks).toEqual([]);
    // lastNodeId 与 nodeId 相同（不可能，但别画出 0 长度的补间）
    expect(actorWalkTriggers([board(5, 5)], new Map([[0, 0]])).walks).toEqual([]);
  });

  it('回監獄／醫院 = 落点归 0，下一次再上路照样算换了落点', () => {
    const inside = actorWalkTriggers([off(ACTOR_PLACE.prison)], new Map([[0, 11]]));
    expect(inside.seen.get(0)).toBe(0);
    expect(inside.walks).toEqual([]);
    const out = actorWalkTriggers([board(20, 19)], inside.seen);
    expect(out.walks).toEqual([{ slot: 0, path: [19, 20] }]);
  });

  it('★ D-T047-6：走完就收场的人（不在盘上）也要能播那一趟', () => {
    // ① 機器娃娃：`runDoll` 走完 → `idleActor()`（nodeId 0 / place offBoard），
    //    但 core 刚把整趟路径喂过来 —— 必须起补间，否则娃娃九格是瞬移。
    const doll = actorWalkTriggers([off(ACTOR_PLACE.offBoard)], new Map([[0, 0]]), [
      { slot: 0, path: [1, 2, 3, 4] },
    ]);
    expect(doll.walks).toEqual([{ slot: 0, path: [1, 2, 3, 4] }]);
    // 落点记的是**路径末格**，同一份再画一次不重播
    expect(actorWalkTriggers([off(ACTOR_PLACE.offBoard)], doll.seen, [{ slot: 0, path: [1, 2, 3, 4] }]).walks).toEqual([]);
    // ② 惡人半路踩回老家：place 是監獄，同样要播完那一趟
    const jailed = actorWalkTriggers([off(ACTOR_PLACE.prison)], new Map([[0, 0]]), [
      { slot: 0, path: [9, 10, 11, 12] },
    ]);
    expect(jailed.walks).toEqual([{ slot: 0, path: [9, 10, 11, 12] }]);
    expect(jailed.seen.get(0)).toBe(12);
  });
});

// ============================================================
//  ★ Q-PERF-1：淘汰下来的位图在**帧边界**才 close
// ============================================================

describe('★ DeferredSpriteClose —— 摘引用与 close 分成两步', () => {
  /** 一个假精灵：位图只记「被 close 过没有」 */
  const fakeSprite = (): { sprite: Sprite; closed: () => boolean } => {
    let closed = false;
    const sprite = {
      bitmap: {
        close: () => {
          closed = true;
        },
      },
      width: 2,
      height: 2,
      anchorX: 1,
      anchorY: 1,
    } as unknown as Sprite;
    return { sprite, closed: () => closed };
  };

  it('★ retire 只摘引用、**不** close —— 还在画的那一帧不能被关掉', () => {
    const { sprite, closed } = fakeSprite();
    const ready = new Map<string, Sprite | null>([['Data.mkf:1:0:k:', sprite]]);
    const q = new DeferredSpriteClose();

    expect(q.retire(ready, sprite)).toBe(1);
    expect(ready.has('Data.mkf:1:0:k:')).toBe(false);
    expect(closed()).toBe(false); // ★ 关键：这一帧还没画完
    expect(q.pending).toBe(1);
  });

  it('★ drain 才是真正的释放，且只关一次', () => {
    const { sprite, closed } = fakeSprite();
    const ready = new Map<string, Sprite | null>([['k', sprite]]);
    const q = new DeferredSpriteClose();
    q.retire(ready, sprite);

    expect(q.drain()).toBe(1);
    expect(closed()).toBe(true);
    expect(q.pending).toBe(0);
    // 幂等：没有排队的了
    expect(q.drain()).toBe(0);
  });

  it('同一个精灵挂在多个缓存键下（换色/抠黑各一份）→ 全部摘掉', () => {
    const { sprite } = fakeSprite();
    const ready = new Map<string, Sprite | null>([
      ['Data.mkf:1:0:k:', sprite],
      ['Data.mkf:1:0::', null],
      ['Data.mkf:1:0::1,2,3', sprite],
    ]);
    const q = new DeferredSpriteClose();
    expect(q.retire(ready, sprite)).toBe(2);
    expect(ready.size).toBe(1);
    expect(q.drain()).toBe(1);
  });

  it('★ 不是本渲染器持有的（hud.ts 那份）→ 不摘、不排队、不 close', () => {
    const { sprite, closed } = fakeSprite();
    const ready = new Map<string, Sprite | null>();
    const q = new DeferredSpriteClose();

    expect(q.retire(ready, sprite)).toBe(0);
    expect(q.pending).toBe(0);
    expect(q.drain()).toBe(0);
    expect(closed()).toBe(false); // 别人还在用，谁也别动它
  });

  it('★ 渲染器构造时就挂上缓存的淘汰监听（不靠 main.ts 接线）', () => {
    const cache = new SpriteCache(
      { get: () => ({ read: () => new Uint8Array(0) }) } as never,
      {},
    );
    const spy = vi.spyOn(cache, 'addEvictListener').mockImplementation(() => {
      /* 只验接线，不真的收 */
    });

    // ctx 用不上（只构造、不画）
    new BoardRenderer({} as CanvasRenderingContext2D, cache);

    // ★ 挂监听这件事发生在构造里 —— 因为 SpriteCache 是在 main.ts 里造就的，
    //   而 main.ts 不是本卡能改的文件（Q-PERF-1）。
    expect(spy).toHaveBeenCalledTimes(1);
    expect(typeof spy.mock.calls[0]![0]).toBe('function');
    spy.mockRestore();
  });
});

/*
 * ★ 棋盘上的**地图物件**（需求方 2026-09-16：「放置后目标点应该也要看到这 3 个
 *   道具的样子」）—— 先前 `render.ts` 里 `state.objects` 一处都没读，整个漏画。
 * 图集与图号全照 exe：`Data.mkf` 资源 `0x18c + 种类 − 1`（VA 0x004080b2）、
 * 图号 `8 − 视角 + 朝向`（VA 0x00408ee2）。
 */
describe('★ 物件清单（`objectTokens`）—— 放置的三件道具必须画出来', () => {
  const node = (id: number, x: number, y: number): MapNode =>
    makeNode({ id, x, y, adjacentSlots: [0, 0, 0, 0] });

  /** 一张 3 格的小地图；物件表只放我们要验的那几件 */
  const withObjects = (
    objs: { type: number; nodeId: number; attached?: number }[],
  ): GameState =>
    makeGameState({
      objects: objs.map((o) => ({
        type: o.type,
        nodeId: o.nodeId,
        state: 0,
        attached: o.attached ?? 0,
      })),
    });

  const nodes = [node(1, 10, 20), node(2, 30, 40), node(3, 50, 60)];

  it('★ 路障(16)/地雷(17)/定時炸彈(18) 各自的图集 = 411/412/413', () => {
    const tokens = objectTokens(withObjects([
      { type: 16, nodeId: 1 },
      { type: 17, nodeId: 2 },
      { type: 18, nodeId: 3 },
    ]), nodes, 0);
    expect(tokens.map((t) => t.resource)).toEqual([411, 412, 413]);
    expect(tokens.map((t) => t.type)).toEqual([16, 17, 18]);
  });

  it('用**节点坐标**当落点（物件记录存的是节点号）', () => {
    const [t] = objectTokens(withObjects([{ type: 16, nodeId: 2 }]), nodes, 0);
    expect(t).toMatchObject({ x: 30, y: 40, nodeId: 2, index: 0 });
  });

  it('nodeId = 0（已被请走/拾取）不画 —— 与初始状态一致', () => {
    expect(objectTokens(withObjects([{ type: 16, nodeId: 0 }]), nodes, 0)).toEqual([]);
    expect(objectTokens(makeGameState(), nodes, 0)).toEqual([]);
  });

  it('附身于人的（attached != 0）这一轮不画 —— 画在主人身上那一路未做', () => {
    expect(objectTokens(withObjects([{ type: 5, nodeId: 1, attached: 2 }]), nodes, 0)).toEqual([]);
  });

  it('★ 正在飞的那一件要藏起来（原版动画期间棋盘不重绘，别画两遍）', () => {
    const state = withObjects([
      { type: 16, nodeId: 1 },
      { type: 17, nodeId: 2 },
    ]);
    const all = objectTokens(state, nodes, 0);
    expect(all.map((t) => t.index)).toEqual([0, 1]);
    expect(objectTokens(state, nodes, 0, 1).map((t) => t.index)).toEqual([0]);
    expect(objectTokens(state, nodes, 0, 0).map((t) => t.index)).toEqual([1]);
  });

  it('★ 图号 = 8 − 视角 + 朝向：视角一转就换一张（8 向各 1 帧）', () => {
    const state = withObjects([{ type: 16, nodeId: 1 }]);
    // 孤立格 → 朝向 0（见 throw-fx 的 `objectFacing`）
    expect(objectTokens(state, nodes, 0)[0]!.image).toBe(0);
    expect(objectTokens(state, nodes, 2)[0]!.image).toBe(6);
    expect(objectTokens(state, nodes, 7)[0]!.image).toBe(1);
  });

  it('节点号越界 / 不在表里的种类 → 跳过，不抛', () => {
    expect(objectTokens(withObjects([{ type: 16, nodeId: 99 }]), nodes, 0)).toEqual([]);
    expect(objectTokens(withObjects([{ type: 21, nodeId: 1 }]), nodes, 0)).toEqual([]);
  });

  it('神明（种类 1..14）也在同一份清单里：资源 396..409', () => {
    // 开局 `INITIAL_PLACED_OBJECTS` 把这些摆在地图上，原版一样会画
    expect(objectTokens(withObjects([{ type: 1, nodeId: 1 }]), nodes, 0)[0]!.resource).toBe(396);
    expect(objectTokens(withObjects([{ type: 15, nodeId: 1 }]), nodes, 0)[0]!.resource).toBe(410);
  });
});

/*
 * ══════════════════════════════════════════════════════════════════════════
 *  ★ Q-TOOL-5 ②：**附身于人**的物件 —— 原版画在主人身上（`test dh,dh / je`
 *  的反面，VA 0x00408fa5 / 0x00408fad 起）：
 *    落点 = 主人的实时像素坐标（+0x8/+0xa）+ 8 向偏移表，
 *    图号 = 8 − 视角 + **主人**朝向，真正贴的帧 = 图号 + 4。
 *  「放地上」那一路仍归 `objectTokens`（上一段），两条互斥。
 * ══════════════════════════════════════════════════════════════════════════
 */
describe('★ Q-TOOL-5 ②：附身物件的清单（`attachedObjectTokens`）—— 跟着主人跑', () => {
  const obj = (type: number, nodeId: number, attached: number) => ({ type, nodeId, state: 0, attached });

  /** 两个玩家 + 一张物件表；主人 = 玩家 0 */
  const scene = (
    owner: Partial<Player>,
    objs: { type: number; nodeId: number; attached: number }[],
    other: Partial<Player> = {},
  ): GameState =>
    makeGameState({
      players: [
        makePlayer({ index: 0, ...owner }),
        makePlayer({ index: 1, ...other }),
      ],
      objects: objs.map((o) => ({ ...o, state: 0 })),
    });

  it('★ 请上身的神明（attached != 0）画在主人身上：图集与图号全照 exe', () => {
    // 小財神 = 种类 1 → 396；attached = 2 ⇒ 主人是玩家 1
    const tokens = attachedObjectTokens(scene({}, [obj(1, 1, 2)]), 0);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      index: 0, type: 1, owner: 1, resource: 396, frame: 4, offsetX: -10, offsetY: -22,
    });
  });

  it('★ 跟着主人走：落点一律取**主人的** nodeId，物件记录里的 nodeId 不参与', () => {
    // 物件记录里的 nodeId 故意写成别处（附身时 core 会写主人的节点，但不靠它定位）
    const s = scene({ nodeId: 3 }, [obj(5, 1, 1)]);
    expect(attachedObjectTokens(s, 0)[0]!.ownerNodeId).toBe(3);
    // 主人挪到 7 号格 → 附身的那件跟着挪
    const moved = { ...s, players: [{ ...s.players[0]!, nodeId: 7 }, s.players[1]!] };
    expect(attachedObjectTokens(moved, 0)[0]!.ownerNodeId).toBe(7);
    // 而「放地上」那一份清单**不看** attached 的物件（两条互斥，不会画两遍）
    expect(objectTokens(s, [makeNode({ id: 1 }), makeNode({ id: 3 }), makeNode({ id: 7 })], 0))
      .toEqual([]);
  });

  it('★ 图号 = 8 − 视角 + 主人朝向；真正贴的帧再 +4（神明背对主人）', () => {
    const s = scene({ direction: 0 }, [obj(5, 1, 1)]);
    expect(attachedObjectTokens(s, 0)[0]!.frame).toBe(4);
    expect(attachedObjectTokens(s, 1)[0]!.frame).toBe(3); // 8−1+0+4 = 11 & 7 = 3
    expect(attachedObjectTokens(s, 7)[0]!.frame).toBe(5); // 8−7+0+4 = 5
    // 主人的朝向也参与
    const east = scene({ direction: 2 }, [obj(5, 1, 1)]);
    expect(attachedObjectTokens(east, 0)[0]!.frame).toBe(6);
  });

  it('★ 偏移表随图号转：视角一转，神明换到主人另一侧', () => {
    const s = scene({ direction: 0 }, [obj(5, 1, 1)]);
    const at = (view: number) => {
      const t = attachedObjectTokens(s, view)[0]!;
      return { dx: t.offsetX, dy: t.offsetY };
    };
    // ★ 表项的内存顺序是 **(X, Y)**，token 的 `offsetX/offsetY` 照抄（试玩3 #10 订正）
    expect(at(0)).toEqual({ dx: -10, dy: -22 }); // 图号 0
    expect(at(2)).toEqual({ dx: 22, dy: -10 }); // 图号 6
    expect(at(4)).toEqual({ dx: 10, dy: 22 }); // 图号 4
  });

  it('★ 主人住店/消失/坐牢/住院 → 整个不画（@source VA 0x00408fbd 的那个 dword）', () => {
    const stall = (b: Partial<Player['blocking']>): GameState =>
      scene({ blocking: { ...makePlayer().blocking, ...b } }, [obj(5, 1, 1)]);
    expect(attachedObjectTokens(stall({}), 0)).toHaveLength(1);
    expect(attachedObjectTokens(stall({ inHotel: 1 }), 0)).toEqual([]);
    expect(attachedObjectTokens(stall({ disappearing: 2 }), 0)).toEqual([]);
    expect(attachedObjectTokens(stall({ inPrison: 3 }), 0)).toEqual([]);
    expect(attachedObjectTokens(stall({ inHospital: 4 }), 0)).toEqual([]);
    // ★ 冬眠（+0x36）**不在**那一个 dword 里 ⇒ 照样画
    expect(attachedObjectTokens(stall({ sleeping: 5 }), 0)).toHaveLength(1);
  });

  it('★ 定時炸彈(18) + 主人身上**还有**一个神 → 换外圈那张表（0x474991）', () => {
    const inner = attachedObjectTokens(scene({ godInfo: 0 }, [obj(18, 1, 1)]), 0)[0]!;
    expect({ dx: inner.offsetX, dy: inner.offsetY }).toEqual({ dx: -10, dy: -22 });
    const outer = attachedObjectTokens(scene({ godInfo: 3 }, [obj(18, 1, 1)]), 0)[0]!;
    expect({ dx: outer.offsetX, dy: outer.offsetY }).toEqual({ dx: -18, dy: -44 });
    // 不是炸弹就一直是内圈
    const god = attachedObjectTokens(scene({ godInfo: 3 }, [obj(5, 1, 1)]), 0)[0]!;
    expect({ dx: god.offsetX, dy: god.offsetY }).toEqual({ dx: -10, dy: -22 });
  });

  it('正在飞的那一件要藏起来（請神符：原版先把它从地图上摘掉，VA 0x00444ea8）', () => {
    const s = scene({}, [obj(5, 1, 1), obj(6, 2, 1)]);
    expect(attachedObjectTokens(s, 0).map((t) => t.index)).toEqual([0, 1]);
    expect(attachedObjectTokens(s, 0, 0).map((t) => t.index)).toEqual([1]);
    expect(attachedObjectTokens(s, 0, 1).map((t) => t.index)).toEqual([0]);
  });

  it('attached == 0（放地上）/ 主人下标越界 / 种类不在表里 → 跳过，不抛', () => {
    expect(attachedObjectTokens(scene({}, [obj(5, 1, 0)]), 0)).toEqual([]);
    expect(attachedObjectTokens(scene({}, [obj(5, 1, 9)]), 0)).toEqual([]);
    expect(attachedObjectTokens(scene({}, [obj(21, 1, 1)]), 0)).toEqual([]);
    // 惡犬(11)/禮物(13)/寶箱(14)/路障(16) 原版也不附身，但表里只要有类型就照画
    expect(attachedObjectTokens(scene({}, [obj(16, 1, 1)]), 0)[0]!.resource).toBe(411);
  });
});

/*
 * ══════════════════════════════════════════════════════════════════════════
 *  ★ Q-LAND-1（需求方 2026-09-16 两条）
 *
 *  ① 「游戏开局为什么默认所有大地块都被青色归属的公园占了，应该是空地才对」
 *  ② 「旋转地图视角时地图上的景物是不会跟着变化视角的吗？」
 *
 *  取证都来自 `fcn_0040829d` 的四段（住宅 `loc_004090e2` / 设施 `loc_004092f4`
 *  / 企业 `loc_0040953f` / 景观 `loc_00409689`）：
 *   - **未持有的空地（等级 0 + 无主）资源号 = 0，资源 0 的槽整条跳过 ⇒ 什么都不画**
 *     （VA 0x0040923e → VA 0x00409848）。原版没有「每格一块底色」这种东西。
 *   - 建筑/设施/企业/景观四类的图号**都吃视角**：`(8 − (朝向 + 视角)) & 7`
 *     （VA 0x004091af / 0x004093c3 / 0x0040964d / 0x00409793），
 *     因为四张图集实测**每张恰好 8 个朝向**。
 *   - **只有装饰（`decorIndex` → 资源 24）不吃视角** —— 那一段整段不读 `[0x499088]`
 *     （`loc_0040855f`，VA 0x0040862e 读 decorIndex）。
 * ══════════════════════════════════════════════════════════════════════════
 */

/** 只有一块住宅的小地图（节点挂在同一格上）*/
function oneLandMap(land: LandInfo): Rich4Map {
  return {
    nodes: [makeNode({ id: 1, x: land.x, y: land.y, ref: { kind: 'land', index: land.id } })],
    lands: [land],
    facilities: [],
    commercials: [],
    landscapes: [],
    dataSize: 0,
  } as unknown as Rich4Map;
}

describe('★ Q-LAND-1 ①：未持有的空地 —— 原版一个像素都不画（露出地砖）', () => {
  it('★ 等级 0 + 无主 → `null`（既不是色块，也不是空地 logo）', () => {
    // @source VA 0x00409216 `cmp byte [land+0x19],0` / je → @source VA 0x0040923e 资源 = 0
    // @source VA 0x00409848 `test ebp,ebp / je 0x409931` —— 资源 0 的槽整条跳过
    expect(
      landArt({ level: 0, owner: 0, character: 3, chain: false, facing: 5, globalMapId: 0, view: 0 }),
    ).toBeNull();
  });

  it('★ 钉死整条路径：开局（landOwner / landLevel 全 0）棋盘上**一件立体物都没有**', () => {
    const state = makeGameState({ landOwner: [0], landLevel: [0] });
    expect(buildingArtItems(oneLandMap(makeLand({ id: 1 })), state, 0)).toEqual([]);
    // 八个视角全试一遍 —— 不是「某个视角刚好不画」
    for (let v = 0; v < 8; v++) {
      expect(buildingArtItems(oneLandMap(makeLand({ id: 1 })), state, v)).toEqual([]);
    }
  });

  it('等级 0 + 有主 → 空地 logo（map.mkf #25），图号 = 该玩家的 character', () => {
    // @source VA 0x0040921c `mov eax,[0x48aea8]` / VA 0x00409230 `al = player[owner-1].+0x13`
    const art = landArt({ level: 0, owner: 2, character: 5, chain: false, facing: 3, globalMapId: 1, view: 4 });
    expect(art).toEqual({ resource: EMPTY_LAND_LOGO_RESOURCE, image: 5, paletteOwner: SLOT_NO_RECOLOR });
    // ★ 这一支**不读视角**：原版图号用的是角色号，不是 `8 − (朝向 + 视角)`
    for (let v = 0; v < 8; v++) {
      const a = landArt({ level: 0, owner: 2, character: 5, chain: false, facing: 3, globalMapId: 1, view: v })!;
      expect(a).toEqual({ resource: EMPTY_LAND_LOGO_RESOURCE, image: 5, paletteOwner: SLOT_NO_RECOLOR });
    }
  });

  it('走整条路径：有主空地画在**地块记录**的 x/y 上，且不换归属色', () => {
    // ⚠️ 这两张表是**按地块号（1 基）索引**的，下标 0 空着
    const state = makeGameState({ landOwner: [0, 2], landLevel: [0, 0] });
    const land = makeLand({ id: 1, x: 77, y: 88 });
    // ★ W-69：住宅那一支现在还带**自己那块地的 id**（过路费闪烁要按 id 认图）
    expect(buildingArtItems(oneLandMap(land), state, 0)).toEqual([
      { x: 77, y: 88, res: EMPTY_LAND_LOGO_RESOURCE, img: state.players[1]!.character, landId: 1 },
    ]);
  });

  it('★ 等级 ≥ 1 → 建筑图集（地图×5 + 等级−1 + 39），图号 = (8 − (朝向+视角)) & 7', () => {
    // @source VA 0x004091af（图号）与 VA 0x004091e5（按等级取图集）
    for (let v = 0; v < 8; v++) {
      const art = landArt({ level: 3, owner: 1, character: 0, chain: false, facing: 2, globalMapId: 1, view: v })!;
      expect(art.resource).toBe(buildingResource(1, 3));
      expect(art.image).toBe((8 - (2 + v)) & 7);
      // 有主 → 调色板 #255 换成该玩家的角色色（1 基玩家号原样带出去）
      expect(art.paletteOwner).toBe(1);
    }
  });

  it('连锁店（land.type != 0）走另一张图集 @source VA 0x004091ee / 0x00409208', () => {
    const art = landArt({ level: 1, owner: 1, character: 0, chain: true, facing: 0, globalMapId: 2, view: 0 })!;
    expect(art.resource).toBe(chainStoreResource(2));
    expect(art.resource).not.toBe(buildingResource(2, 1));
  });

  it('等级 > 5：原版图集表只有 5 级 → 不画', () => {
    expect(
      landArt({ level: 6, owner: 1, character: 0, chain: false, facing: 0, globalMapId: 0, view: 0 }),
    ).toBeNull();
  });
});

describe('★ Q-LAND-1 ②：旋转视角 —— 三类景物都换图，装饰不换', () => {
  /** 一件**盖好的**设施 + 一家企业 + 一处景观 */
  const sceneryMap = (): Rich4Map =>
    ({
      nodes: [],
      lands: [],
      // ★ 等级 0 的設施是**空地**、原版什么都不画（见下面 ③）—— 这里要验「图号吃视角」，
      //   所以给一件真的盖起来的（type 0 = 公園，最高 1 级）。
      facilities: [makeFacility({ id: 1, x: 10, y: 20, facing: 3, type: 0, level: 1, owner: 0 })],
      commercials: [
        {
          id: 1, x: 30, y: 40, name: '銀行', stockIndex: 0, type: 7, facing: 5,
          spriteIndex: 140, landPrice: 0, assetValue: 0, shares: 0,
        },
      ],
      landscapes: [{ id: 1, x: 50, y: 60, name: '阿里山', facing: 6, spriteIndex: 150 }],
      dataSize: 0,
    }) as unknown as Rich4Map;

  const state = makeGameState({
    commercialOwners: [{ owner: 0, ranking: [0, 0, 0, 0] }],
    // 运行时值住在 state（下标 = 設施 id）：1 号 = 公園 1 级
    facilityLevel: [0, 1],
    facilityType: [0, 0],
    facilityOwner: [0, 0],
  });

  it('★ 图号 = (8 − (朝向 + 视角)) & 7：设施/企业/景观各按自己的朝向 @source VA 0x004093c3 / 0x0040964d / 0x00409793', () => {
    for (let v = 0; v < 8; v++) {
      const items = buildingArtItems(sceneryMap(), state, v);
      // 设施 = 舞台0 基号 0x57 + 槽 0；企业/景观 = 精灵索引 + 38
      expect(items.map((i) => i.res)).toEqual([0x57, 178, 188]);
      expect(items.map((i) => i.img)).toEqual([(8 - (3 + v)) & 7, (8 - (5 + v)) & 7, (8 - (6 + v)) & 7]);
    }
  });

  it('★★ 那圈归属线：无主 = **黑**（不是素材里的占位品红）、有主 = 角色色、景观 = 不换色 @source VA 0x00409853..0x0040987d', () => {
    // 无主：設施（公園，owner 0）与企業（owner 0）都换成黑；景观那一支槽 +6 = 0xff ⇒ 不给 ring
    const [fac, com, land] = buildingArtItems(sceneryMap(), state, 0);
    expect(fac!.ring).toEqual(RING_UNOWNED);
    expect(com!.ring).toEqual(RING_UNOWNED);
    expect(land!.ring).toBeUndefined();
    expect(RING_UNOWNED).toEqual([0, 0, 0]);

    // 有主：★ 下标 = 企業 id（1 基）。0 号槽里放个别人 —— 读错下标就会拿到他的颜色
    const owned = makeGameState({
      commercialOwners: [{ owner: 2, ranking: [0, 0, 0, 0] }, { owner: 1, ranking: [1, 0, 0, 0] }],
      facilityLevel: [0, 1], facilityType: [0, 0], facilityOwner: [0, 0],
    });
    const com2 = buildingArtItems(sceneryMap(), owned, 0)[1]!;
    expect(com2.ring).toEqual(ringColor(owned, 1));
    expect(com2.ring).not.toEqual(ringColor(owned, 2));
    expect(com2.ring).not.toEqual(RING_UNOWNED);
  });

  it('ringColor：0xff 不换色 / 0 黑 / 1..4 角色色', () => {
    expect(ringColor(state, SLOT_NO_RECOLOR)).toBeUndefined();
    expect(ringColor(state, 0)).toEqual([0, 0, 0]);
    expect(ringColor(state, 1)).toBeDefined();
  });

  it('★ 视角转一圈（0..7）：每一类的图号把 0..7 各取一次（图集确实是 8 向）', () => {
    for (let slot = 0; slot < 3; slot++) {
      const seen = new Set<number>();
      for (let v = 0; v < 8; v++) seen.add(buildingArtItems(sceneryMap(), state, v)[slot]!.img);
      expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it('★ 企业/景观的朝向分别读 +0x1b / +0x18 —— 缺字段时按 0 兜底', () => {
    // 解析器一定填；手写的字面量（其它测试/工具）可能没有这个字节
    const map = sceneryMap();
    const noFacing = {
      ...map,
      commercials: [{ ...map.commercials[0]!, facing: undefined }],
      landscapes: [{ ...map.landscapes[0]!, facing: undefined }],
    } as unknown as Rich4Map;
    const items = buildingArtItems(noFacing, state, 0);
    expect(items[1]!.img).toBe(0); // (8 − (0 + 0)) & 7
    expect(items[2]!.img).toBe(0);
  });

  it('装饰的图号只由 `decorIndex` 定（1 基 → 0 基），**没有视角这一路**', () => {
    // @source `loc_0040855f`：整段不读 `[0x499088]`，就是 `decorIndex − 1` 直接贴
    expect(decorImageIndex(0)).toBeNull();
    expect(decorImageIndex(1)).toBe(0);
    expect(decorImageIndex(58)).toBe(57);
  });
});

/*
 * ★★ 2026-09-18（需求方第 6 条）：「大型空地一开局就默认被放上了青色边框的公园设施，
 *   应该是空地才对，点击时浮出的文字说明是空地」。
 *
 * 根因**两处**，都在 `buildingArtItems` 的設施那一段：
 *  ① 读的是**地图模板**的 `f.type`/`f.level`，而不是 `GameState.facilityType/Level`
 *     —— 而地图文件里这三个字节**恒为 0**（`rich4-spec/.../map-format.md` §4.6、
 *     Q-FAC-1），所以读到的永远是 `type=0, level=0`；
 *  ② 于是 `facilitySlot(0, 0)` = **槽 0 = 公園**，每一块没盖的商業用地都被画成公園。
 *
 * exe 的判据（`loc_004092f4`，设施那一段）：
 * ```asm
 * 004093f3  cmp byte [ebp + 0x1a], 0      ; ★ level == 0 ？
 * 004093f7  je  0x409457                  ;   → 空地分支（**不查 type 跳转表**）
 * 0040945e  cmp byte [ebp + 0x19], 0      ; owner == 0 ？
 * 00409462  je  0x409486
 * 00409464  mov eax, [0x48aea8]           ; map.mkf #25 = 空地 logo
 * 00409478  al = player[owner-1].+0x13    ; 图号 = 角色号
 * 00409486  mov [slot+0x48a84c], 0        ; ★ owner == 0 ⇒ 资源 0 ⇒ 整条跳过（什么都不画）
 * 00409402  al = byte [ebp + 0x18]        ; 只有 level != 0 才走到这里取 type
 * 00409412  jmp dword [eax*4 + 0x408289]  ; type 的 5 路跳转表
 * ```
 * ⇒ **公園 = `type 0 且 level ≥ 1`（盖出来的）**；空地（level 0）原版一个像素都不画。
 *   空地格自己那套地砖由地图底图负责，与設施图集无关。
 */
describe('★ 設施 level == 0 是**空地**：不画公園贴片（需求方第 6 条）', () => {
  const facMap = (fac: Partial<Parameters<typeof makeFacility>[0]>): Rich4Map =>
    ({
      nodes: [],
      lands: [],
      facilities: [makeFacility({ id: 1, x: 100, y: 200, facing: 0, ...fac })],
      commercials: [],
      landscapes: [],
      dataSize: 0,
    }) as unknown as Rich4Map;

  /** 舞台 0 的設施基号 0x57；槽 0 就是**公園**那张图 —— 这就是用户看到的「青色边框公园」 */
  it('★ 反证前提：`facilitySlot(0, 0)` 就是槽 0（= 公園），所以「无脑画」必然画出公園', () => {
    expect(facilitySlot(0, 0)).toBe(0);
    expect(facilitySlot(0, 1)).toBe(0); // 公園最高 1 级，两档同一张图
  });

  it('★★ level 0 + 无主 → **一件都不画**（没有任何公園贴片）', () => {
    // 开局：模板 f.level = 0、state.facilityLevel[1] = 0
    const state = makeGameState({ facilityLevel: [0, 0], facilityOwner: [0, 0], facilityType: [0, 0] });
    const items = buildingArtItems(facMap({ level: 0, owner: 0, type: 0 }), state, 0);
    expect(items).toEqual([]);
    // 八个视角全试一遍 —— 不是「某个视角刚好不画」
    for (let v = 0; v < 8; v++) {
      expect(buildingArtItems(facMap({ level: 0, owner: 0 }), state, v)).toEqual([]);
    }
    // ★ 就算**模板**写着「公園 1 级」，只要**运行时**等级是 0（地图数据恒 0）也不许画：
    //   判据必须取 state，不许回落到模板
    expect(buildingArtItems(facMap({ level: 1, owner: 0, type: 0 }), state, 0)).toEqual([]);
  });

  it('★ level 0 + 有主 → map.mkf #25 的空地 logo，图号 = 角色号，且**不换归属色**', () => {
    // @source VA 0x00409464 / 0x00409478 / 0x00409457（槽 +6 = 0xff）
    const state = makeGameState({
      facilityLevel: [0, 0],
      facilityOwner: [0, 2],
      facilityType: [0, 0],
      commercialOwners: [],
    });
    const items = buildingArtItems(facMap({ level: 0, owner: 2, type: 0 }), state, 3);
    expect(items).toEqual([
      { x: 100, y: 200, res: EMPTY_LAND_LOGO_RESOURCE, img: state.players[1]!.character },
    ]);
    // 这一支**不吃视角**（图号是角色号，不是 `8 − (朝向+视角)`）
    for (let v = 0; v < 8; v++) {
      expect(buildingArtItems(facMap({ level: 0, owner: 2 }), state, v)).toEqual(items);
    }
  });

  it('★★ level ≥ 1 才画設施，而且**种类/等级取 state、朝向取模板**', () => {
    // 地图模板永远是 type=0/level=0，真值全在 state：1 号 = 旅館(type 1) 3 级
    const state = makeGameState({
      facilityLevel: [0, 3],
      facilityOwner: [0, 1],
      facilityType: [0, 1],
    });
    const items = buildingArtItems(facMap({ level: 0, owner: 0, type: 0, facing: 2 }), state, 0);
    expect(items).toHaveLength(1);
    // 旅館 = 槽 5 + level → 0x57 + 8；朝向仍取模板的 +0x1b @source VA 0x004093c3
    expect(items[0]!.res).toBe(0x57 + facilitySlot(1, 3));
    expect(items[0]!.res).not.toBe(0x57); // ★ 不再是公園
    expect(items[0]!.img).toBe((8 - (2 + 0)) & 7);
    // 有主 → 换归属色
    expect(items[0]!.ring).toBeDefined();
  });

  it('★ 真的公園（type 0 + level 1）照样画得出来 —— 别把公園一起吞掉', () => {
    const state = makeGameState({
      facilityLevel: [0, 1],
      facilityOwner: [0, 1],
      facilityType: [0, 0],
    });
    const items = buildingArtItems(facMap({ level: 0, owner: 0, type: 0, facing: 0 }), state, 0);
    expect(items).toHaveLength(1);
    expect(items[0]!.res).toBe(0x57 + facilitySlot(0, 1)); // = 0x57，公園那张图
    expect(items[0]!.ring).toBeDefined();
  });
});


describe('★ T-047：替身冬眠变灰（`record + 12`）@source `rich4.asm:1533`', () => {
  it('`actorTokens` 把 `hibernating != 0` 的槽标成 `frozen`', () => {
    const nodes = lineNodes(4);
    const base = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 1 })],
      specialActors: initialSpecialActors().map((a, i) =>
        i < 4 ? { ...releaseNpc(i + 1, i, 0) } : a,
      ),
    });
    const opts = { view: 0, walking: () => false };
    const before = actorTokens(base, nodes, opts);
    expect(before.map((t) => t.frozen)).toEqual([false, false, false, false]);

    const specialActors = base.specialActors.map((a, i) => (i === 2 ? { ...a, hibernating: 5 } : a));
    const after = actorTokens({ ...base, specialActors }, nodes, opts);
    expect(after.map((t) => t.frozen)).toEqual([false, false, true, false]);
  });

  it('★ 绘制那一条必须在 `drawImage` 两侧设/清 filter（否则会漏到建筑）', () => {
    const src = readFileSync(new URL('./render.ts', import.meta.url), 'utf8');
    for (const marker of [
      'if (t.frozen) ctx.filter = ASLEEP_FILTER;',
      "if (t.frozen) ctx.filter = 'none';",
    ]) {
      expect(src, `缺标记：${marker}`).toContain(marker);
    }
    // 两个标记必须夹着那一次 `ctx.drawImage(`
    const a = src.indexOf('if (t.frozen) ctx.filter = ASLEEP_FILTER;');
    const b = src.indexOf("if (t.frozen) ctx.filter = 'none';");
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(src.slice(a, b)).toContain('ctx.drawImage(');
  });
});

describe('★ Q-PICK-1：摄像机的**亚格**余量（贴边推镜头要逐像素走）', () => {
  it('`pixelCamera` / `cameraCenter` 互为逆（含负数与边界）', () => {
    for (const c of [
      { x: 220, y: 220 },
      { x: 2084, y: 2084 },
      { x: 1023, y: 1024 },
      { x: 0, y: 0 },
    ]) {
      const cam = pixelCamera(c.x, c.y, 0);
      expect(cameraCenter(cam), `${c.x},${c.y}`).toEqual(c);
    }
  });

  it('★ 余量拆成「块 + 0..31」@source 原版镜头中心是像素坐标', () => {
    const cam = pixelCamera(220, 2084, 0);
    expect(cam.tileX).toBe(220 >> 5); // 6
    expect(cam.subX).toBe(220 & 31); // 28
    expect(cam.tileY).toBe(2084 >> 5); // 65
    expect(cam.subY).toBe(2084 & 31); // 4
  });

  it('`characterCamera` 的余量恒为 0（与加这个字段之前完全一致）', () => {
    const cam = characterCamera(320, 640, 2);
    expect(cam.subX ?? 0).toBe(0);
    expect(cam.subY ?? 0).toBe(0);
    expect(cameraCenter(cam)).toEqual({ x: 320, y: 640 });
  });

  it('★ 余量会真的改变投影结果（不是白加的字段）', () => {
    const vp = { w: 440, h: 440 };
    const a = worldToScreen(400, 400, characterCamera(400, 400, 0), vp);
    const b = worldToScreen(400, 400, pixelCamera(400 + 8, 400, 0), vp);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toEqual(b);
    // 镜头中心往右挪 8 px ⇒ 同一个世界点看起来往左移
    expect(b!.x).toBeLessThan(a!.x);
  });
});

// ============================================================
//  ★ 视角跟踪（第四份回报第 2 条）：镜头跟走子 / 跟替身
// ============================================================

describe('★ renderer.actorCenterWorld —— 镜头该跟着谁', () => {
  /** 只算位置、不画：`SpriteCache` 给一个空实现就够（与上面那条同源） */
  const rendererForCamera = (): BoardRenderer =>
    new BoardRenderer({} as CanvasRenderingContext2D, {
      addEvictListener: () => {
        /* 只算位置，不画 */
      },
    } as unknown as SpriteCache);

  it('★ 没有补间时返回 null（调用方按当前玩家的格心）', () => {
    const r = rendererForCamera();
    expect(r.actorCenterWorld(1000)).toBeNull();
  });

  it('★★ 走子补间期间返回**插值点**，不是整格的起点（镜头跟着棋子一步步走）', () => {
    const r = rendererForCamera();
    r.startWalk(0, { x: 0, y: 0 }, { x: 320, y: 0 }, 0, false, 20, 0);
    const mid = r.actorCenterWorld(20 * 10);
    expect(mid).not.toBeNull();
    expect(mid!.x).toBeGreaterThan(0);
    expect(mid!.x).toBeLessThan(320);
    // 起点那一刻在第一拍的落点（原版每 tick 累加一次，`k = floor(elapsed/tickMs) + 1`
    //   —— 见 `#actorWalkScreen` 的 `k`；所以 t=0 是**第一拍之后**的位置，不是 0）
    expect(r.actorCenterWorld(0)!.x).toBeGreaterThan(0);
  });

  it('★ 走完之后不再返回（镜头交还给当前玩家）', () => {
    const r = rendererForCamera();
    r.startWalk(0, { x: 0, y: 0 }, { x: 32, y: 0 }, 0, false, 20, 0);
    expect(r.actorCenterWorld(20 * 1000)).toBeNull();
  });
});
