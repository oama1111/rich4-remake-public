import { readFileSync, writeFileSync } from 'node:fs';
import { MkfArchive, parseSpriteSheet } from './mkf.ts';
import { decodeImage } from './sprite.ts';
import { encodePng } from './png.ts';

const data = new Uint8Array(readFileSync(new URL('../../../../Rich4/Data.mkf', import.meta.url)));
const a = new MkfArchive(data);
console.log('count', a.count);
for (const [res, idxs] of [[3, [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]], [440, [0,1,2]]] as const) {
  const raw = a.read(res);
  const sheet = parseSpriteSheet(raw);
  if (!sheet) { console.log('res', res, 'not sprite, len', raw.length, 'sig', String.fromCharCode(raw[0]!,raw[1]!,raw[2]!)); continue; }
  console.log('res', res, sheet.signature, 'images', sheet.images.length,
    sheet.images.map((i) => `${i.width}x${i.height}@${i.x},${i.y}`).join(' '));
  for (const i of idxs) {
    if (!sheet.images[i]) continue;
    for (const keyed of [false, true]) {
      const img = decodeImage(sheet, raw, i, { colorKeyBlack: keyed });
      writeFileSync(`/tmp/rich4-probe/r${res}_i${i}${keyed ? '_key' : ''}.png`, encodePng(img));
    }
  }
}
