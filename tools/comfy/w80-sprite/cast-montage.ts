import { readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng } from '../../../packages/assets-pipeline/src/png.ts';
const ch = process.argv[2]; const out = process.argv[3]!;
const names = [0,1,2,3,4,5,6,7].flatMap(d => ['walk'+d, 'dice'+d]);
const cell = 480, cols = 4, W = cols*cell, H = 4*cell, px = new Uint8ClampedArray(W*H*4).fill(40);
names.forEach((n,k) => { const im = decodePng(new Uint8Array(readFileSync(`/Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/fringe-pilot/cast/${/^[0-9]+$/.test(String(ch)) ? "c" + (ch) : (ch)}/${process.env.OUT ?? 'out2'}/${n}.repaint.png`))); const f = Math.max(im.width, im.height)/(cell-8);
  const ox=(k%cols)*cell, oy=Math.floor(k/cols)*cell;
  for (let y=0;y<cell-8;y++) for (let x=0;x<cell-8;x++){ const sx=Math.floor(x*f), sy=Math.floor(y*f); if(sx>=im.width||sy>=im.height) continue; const i=(sy*im.width+sx)*4, o=((oy+y)*W+ox+x)*4; for(let q=0;q<3;q++) px[o+q]=im.rgba[i+q]; px[o+3]=255; }});
writeFileSync(out, encodePng({width:W,height:H,anchorX:0,anchorY:0,rgba:px}));
