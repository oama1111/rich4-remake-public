// 抠像底色：green / magenta / blue 三选一 —— 按原图里「像这种底色」的像素最少挑（绿色主体不能用绿幕）
export type Key = 'green' | 'magenta' | 'blue';
export const KEY_RGB: Record<Key, [number, number, number]> = { green: [0, 255, 0], magenta: [255, 0, 255], blue: [0, 0, 255] };
export const KEY_NAME: Record<Key, string> = { green: '纯绿色', magenta: '纯洋红色（品红）', blue: '纯蓝色' };
/** 「底色度」：越大越像该底色 */
export function keyness(k: Key, r: number, g: number, b: number): number {
  if (k === 'green') return g - Math.max(r, b);
  if (k === 'magenta') return Math.min(r, b) - g;
  return b - Math.max(r, g);
}
export function keyOut(img: any, k: Key) {
  const o = new Uint8ClampedArray(img.rgba);
  for (let i = 0; i < o.length; i += 4) {
    const v = keyness(k, o[i]!, o[i + 1]!, o[i + 2]!);
    const a = v <= 30 ? 1 : v >= 90 ? 0 : 1 - (v - 30) / 60;
    if (a < 1) { // 去溢色
      if (k === 'green') o[i + 1] = Math.min(o[i + 1]!, Math.max(o[i]!, o[i + 2]!));
      else if (k === 'blue') o[i + 2] = Math.min(o[i + 2]!, Math.max(o[i]!, o[i + 1]!));
      else { const m = Math.min(o[i]!, o[i + 2]!); if (m > o[i + 1]!) { const d = m - o[i + 1]!; o[i] = o[i]! - d; o[i + 2] = o[i + 2]! - d; } }
    }
    o[i + 3] = Math.round(a * 255);
  }
  return { ...img, rgba: o };
}
