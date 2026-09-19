import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseSave } from '../loaders/save.ts';
import { parseMap } from '../loaders/map.ts';

const ROOT = (process.env.RICH4_WORKSPACE ?? '');
const SAVES = [`${ROOT}/Rich4/Save0.dat`, `${ROOT}/Rich4/SAVE1.DAT`];

describe('临时诊断：真实存档里 xpos/ypos 与节点坐标的关系', () => {
  for (const path of SAVES) {
    it(`${path.split('/').pop()}`, () => {
      if (!existsSync(path)) return;
      const save = parseSave(new Uint8Array(readFileSync(path)));
      const map = parseMap(save.mapData);
      for (const p of save.players) {
        const node = map.nodes[p.nodeId - 1];
        if (node === undefined) { console.log(`玩家${p.index}: nodeId=${p.nodeId} 无此节点`); continue; }
        console.log(
          `玩家${p.index}: xpos/ypos=${p.xpos}/${p.ypos}  node(${p.nodeId}).x/y=${node.x}/${node.y}  ` +
          `相等=${p.xpos === node.x && p.ypos === node.y}`,
        );
      }
      expect(true).toBe(true);
    });
  }
});
