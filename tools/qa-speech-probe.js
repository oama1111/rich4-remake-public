/*
 * 台词（T-052）在浏览器里的实测探针。
 *
 * 做法：在 `CanvasRenderingContext2D.prototype.fillText` 上挂一层记录器 ——
 * `drawSpeechBubble()` 走的就是 `fillText`（字幕）与 `drawImage`（金貝貝表情）。
 * 任何别的屏都不会往 (200±, 130±) 那一带写字，所以按坐标筛就能把台词挑出来。
 *
 * 用法：
 *   1) browse goto "http://localhost:5174/?screen=game&humans=1&ai=3&map=0&seed=7&chars=0,3,5,7"
 *   2) browse eval tools/qa-speech-probe.js   （必要时跑两遍：第一遍=装探针，第二遍=读结果）
 */
(() => {
  const g = globalThis;
  if (g.__speechProbeInstalled !== true) {
    g.__speechProbeInstalled = true;
    g.__speechHits = [];
    g.__speechEmoji = [];
    const proto = CanvasRenderingContext2D.prototype;
    const origFill = proto.fillText;
    const origDraw = proto.drawImage;
    proto.fillText = function (text, x, y, ...rest) {
      // 台词字幕：x == 200（0xc8）、y 从 130（0x82）起、每行 +18
      if (x === 200 && y >= 130 && y <= 130 + 18 * 4 && typeof text === 'string') {
        g.__speechHits.push({ t: text, x, y, at: Math.round(performance.now()) });
      }
      return origFill.call(this, text, x, y, ...rest);
    };
    proto.drawImage = function (img, x, y, ...rest) {
      // 金貝貝的表情：落点 (240, 130) = (0xf0, 0x82)
      if (x === 240 && y === 130) {
        g.__speechEmoji.push({
          w: img && img.width,
          h: img && img.height,
          at: Math.round(performance.now()),
        });
      }
      return origDraw.call(this, img, x, y, ...rest);
    };
    return JSON.stringify({ installed: true });
  }
  const hits = g.__speechHits ?? [];
  const emoji = g.__speechEmoji ?? [];
  // 按「同一帧同一批」粗分段落：相邻间隔 > 900ms 就算新的一段
  const groups = [];
  for (const h of hits) {
    const last = groups[groups.length - 1];
    if (last === undefined || h.at - last.at > 900) groups.push({ at: h.at, lines: [h.t] });
    else {
      last.lines.push(h.t);
      last.at = h.at;
    }
  }
  return JSON.stringify(
    {
      installed: true,
      fillTextHits: hits.length,
      emojiHits: emoji.length,
      speeches: groups.map((x) => ({ at: x.at, lines: x.lines })),
      emojiSizes: emoji.slice(0, 5),
    },
    null,
    1,
  );
})()
