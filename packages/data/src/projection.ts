/*
 * 等距投影表 —— 原版的「视角」就靠它
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ **由脚本直接从 `Rich4/rich4.exe` 提取**，常驻校验见 binary-truth.test.ts。
 *
 * ## 原版是怎么把地图画到屏幕上的
 *
 * 不是把底图整张贴上去，而是**逐块查表定位**。地块绘制代码
 * （VA 0x004090fc 起）的做法是：
 *
 * ```asm
 * esi = (land.x >> 5) - 摄像机块X + 14      ; ← 世界 X 方向的索引
 * edi = (land.y >> 5) - 摄像机块Y + 14      ; ← 世界 Y 方向的索引
 * call 0x407a2c(land.x, land.y, &o1, &o2)   ; 块内偏移
 * eax = [0x499088] * 0xd24                  ; ★ 视角 × 每视角 3364 字节
 * edi = edi * 0x74                          ; 世界 Y 索引 × 116 字节
 * esi = esi * 4                             ; 世界 X 索引 × 4 字节
 * 屏幕X = (short)[0x46ccf2 + eax+edi+esi] - o1 + 基准X   ; ★ 表项的第 2 个 int16
 * 屏幕Y = (short)[0x46ccf0 + eax+edi+esi] - o2 + 基准Y   ; ★ 表项的第 1 个 int16
 * ```
 *
 * 即：**一张 8 视角 × 29 行 × 29 列的查找表**，每项是一对 int16，
 * **存储顺序是 `(Y, X)`**；摄像机恒在正中那一格（14, 14），该格表项为 (0, 0)。
 *
 * ### ★★ 表项是 `(Y偏移, X偏移)`，不是 `(X, Y)` —— 2026-09-15 订正
 *
 * 先前这里写反了（把 `0x46ccf0` 当 X），落地后整张棋盘被**沿主对角线镜射**：
 * 一格本该是 **49 宽 × 36 高**（视角 0，四角包围盒；横长），却画成 36×49（竖长），
 * 于是「比例失调」；而建筑精灵的锚点是**屏幕轴**上的量、图素本身没有跟着镜像，
 * 故 `锚点X ≠ 锚点Y` 的建筑会**沿对角线整体错位**（错位量 = |锚点X − 锚点Y|，
 * 大房子才看得出来）——正是需求方说的「大地块上的建筑物不在格子里的正确位置和方向」。
 *
 * 钉死这一条的**三段独立机器码**（都在绘制路径上，与表的字节值无关）：
 *
 * 1. `fcn_004557a1`（地块四边形光栅化器）把地块四角的第 1 个 int16 拿去与
 *    `draw_area.top/bottom` 比较（见 `fcn_0045596a` 的 `mov bp, di` /
 *    `cmp di, [0x4861bc]` / `cmp si, [0x4861c4]`）→ 第 1 个 int16 是 **Y**。
 * 2. `fcn_004564c1`（特殊格装饰）转调 `draw_non_zero_image_in_rect(640,480,sf,src,x,y,1)`，
 *    其中 `x` 取的是 `0x46ccf2` 那一路（`movsx eax,[esi+0x46ccf2]`）→ 第 2 个 int16 是 **X**。
 * 3. `fcn_00456770`（棋盘精灵 blitter）把形参 4 当**列**用
 *    （`imul edi, edi, 0x280; add edi, [ebp+0x14]`），而调用点传的正是 `0x46ccf2` 那一路。
 *
 * ⚠️ **`binary-truth.test.ts` 的逐字节比对区分不了这两种标注**（表的值本身两种读法
 * 都自洽），所以那条测试通过**不能**证明轴向对；轴向只由上面三段绘制代码钉死。
 *
 * 块内的亚像素偏移另由一个 **2×2 整数矩阵**给出（`0x474910`，每视角 4 个
 * int8，结果右移 5 位即除以 32）。它与表的步长严丝合缝，且**配对方式唯一**：
 * `o1` 只喂 X、`o2` 只喂 Y（换过来就对不上表的梯度）。视角 0 的行步（ΔX, ΔY）
 * 是 (14, 25)、列步是 (34, -11)：
 * `-o1 = (34·dx + 14·dy)/32` = 列步/行步的 X 分量，
 * `-o2 = (-11·dx + 25·dy)/32` = 列步/行步的 Y 分量。
 *
 * ## ⚠️ 表是**透视**的，不能用两个基向量算出来
 *
 * 试过用「中心 + 行步×Δ行 + 列步×Δ列」去拟合，八个视角的最大误差
 * 在 15~44 像素之间（都出在四角），说明原版这张表带**透视畸变**，
 * 不是线性的等距投影。故只能原样带上，不能现算。
 *
 * ## 8 个视角
 *
 * 视角编号 0..7，每步转 45°，这也正是建筑精灵为何各有 8 张图
 * （`(8 - (朝向 + 视角)) & 7` 见 loaders/map.ts 的 `LandInfo.facing`）。
 */

/** 视角数 */
export const VIEW_COUNT = 8;
/** 可见窗口的格数（行与列都是 29），摄像机在正中 */
export const VIEW_SPAN = 29;
/** 摄像机所在的格 —— 该格的表项恒为 (0, 0) */
export const VIEW_CENTER = 14;

/**
 * 块内亚像素偏移矩阵，每视角 4 个 int8。
 * @source rich4.exe VA 0x00474910
 *
 * 用法（与 `fcn_00407a2c` 一致，`>> 5` 即除以 32）：
 * ```
 * o1 = (m[0]*dx + m[2]*dy) >> 5
 * o2 = (m[1]*dx + m[3]*dy) >> 5
 * 屏幕X -= o1 ; 屏幕Y -= o2
 * ```
 *
 * ★ 配对是**单向**的：`o1` 喂 X、`o2` 喂 Y。`fcn_00407a2c` 把 `o1` 写进它的
 *   第 3 个出参、`o2` 写进第 4 个；而 `fcn_0040829d` 里那条
 *   `movsx eax,[esi+0x46ccf2]; sub eax,[esp+0x24]` 减的正是第 3 个出参 ——
 *   即第 2 个 int16（X）配 `o1`。反过来配就对不上表的梯度。
 */
export const SUBTILE_MATRIX: readonly (readonly [number, number, number, number])[] = [
  [-34, 11, -14, -25],
  [-34, -9, 16, -25],
  [-13, -25, 37, -9],
  [16, -25, 36, 11],
  [37, -9, 16, 26],
  [36, 11, -14, 26],
  [16, 26, -35, 11],
  [-14, 26, -35, -9],
];

/**
 * 投影表本体，base64 编码的小端 int16 序列。
 *
 * 布局：`[视角][行][列]` → `(x, y)`，共 8 × 29 × 29 × 2 = 13456 个 int16。
 * @source rich4.exe VA 0x0046ccf0，每视角 0xd24 字节、每行 0x74 字节
 */
const PROJECTION_B64 =
  'Lf82/SP/Wv0Y/3/9Df+i/QP/x/34/ur97/4P/uT+Mv7Z/lf+z/57/sT+n/65/sP+r/7m/qT+C/+a/jD/j/5T/4T+eP96/pv/cP6/' +
  '/2X+4/9b/gYAUP4rAEb+TgA7/nMAMP6WACb+uwAb/t4AEP4DAQb+JwFG/0T9PP9p/TH/jf0m/7H9Hf/V/RL/+f0I/x3+/f5B/vL+' +
  'Zf7o/or+3f6t/tL+0v7I/vX+vf4a/7P+Pv+o/mL/nv6G/5T+qv+J/s7/fv7x/3T+FQBp/joAX/5dAFT+ggBJ/qUAP/7JADT+7QAp' +
  '/hEBIP42AV//U/1W/3j9S/+c/UD/v/02/+T9K/8H/iH/LP4W/0/+C/90/gH/mP72/rz+6/7g/uH+BP/W/ij/zf5N/8L+cP+3/pX/' +
  'rf64/6L+3f+X/gAAjf4kAIL+SAB4/mwAbf6QAGL+swBZ/tgATv77AEP+IAE5/kUBev9i/XD/hv1l/6v9Wv/O/VD/8/1F/xb+O/87' +
  '/jD/Xv4l/4L+G/+n/hH/yv4G/+/+/P4S//H+N//n/lv/3P5//9H+o//H/sf/vP7r/7H+DgCn/jIAnP5XAJP+egCI/p8Aff7CAHP+' +
  '5wBo/goBXf4vAVP+UwGT/3D9if+V/X7/uf1z/939af8B/l7/Jf5U/0n+Sf9t/j//kf41/7b+Kv/Z/h///v4V/yH/Cv9G/wD/av/1' +
  '/o3/6v6y/+D+1f/V/vr/yv4cAMH+QQC2/mUArP6JAKH+rQCW/tEAjP71AIH+GQF2/j0BbP5iAaz/gP2i/6X9l//J/Yz/7f2C/xH+' +
  'd/80/m7/Wf5j/3z+WP+h/k7/xv5D/+n+OP8N/y7/Mf8j/1X/Gf96/w7/nf8D/8L/+v7l/+/+CQDk/iwA2v5RAM/+dQDF/pkAuv69' +
  'AK/+4QCl/gUBmv4pAY/+TQGF/nIBxv+P/bz/s/2y/9j9p//7/Z3/IP6S/0P+iP9o/n3/i/5y/7D+aP/U/l3/+P5S/xz/SP8//z3/' +
  'ZP80/4n/Kf+s/x7/0f8U//T/Cf8XAP7+OwD0/l8A6f6EAN/+pwDU/swAyf7vAL/+FAG1/jcBqv5cAaD+gAHg/5391v/C/cv/5v3A' +
  '/wr+tv8u/qv/Uv6h/3b+lv+a/ov/vv6B/+P+dv8G/2v/K/9i/07/V/9z/03/l/9C/7v/N//f/y3/AgAi/yYAF/9JAA3/bgAC/5MA' +
  '+P62AO3+2gDj/v4A2f4iAc7+RgHD/moBuf6PAfn/rP3v/9H95P/1/dn/GP7P/z3+xP9g/rr/hf6v/6j+pP/N/pv/8f6Q/xX/hf85' +
  '/3v/Xf9w/4H/Zv+m/1v/yf9Q/+7/Rv8QADv/NQAw/1gAJv99ABv/oQAS/8UAB//pAPz+DAHy/jEB5/5UAdz+eQHS/p4BEgC7/QgA' +
  '3/3+/wT+8/8n/un/TP7e/2/+1f+U/sr/t/6//9v+tf8A/6r/I/+f/0j/lf9r/4r/kP+A/7T/df/Y/2r//P9g/x8AVv9DAEv/ZwBB' +
  '/4sANv+wACz/0wAh//gAFv8bAQz/QAEB/2MB9v6IAez+rAErAMr9IQDv/RYAFP4LADf+AgBb/vj/f/7u/6P+4//H/tj/6/7O/xD/' +
  'w/8z/7j/WP+u/3v/o/+g/5n/xP+O/+j/hP8LAHr/LwBv/1MAZP93AFr/mwBP/8AARf/jADr/CAEv/ysBJf9QARr/cwEP/5cBBv+8' +
  'AUQA2f07AP79MAAi/iUARv4bAGr+EACN/gYAsv78/9X+8f/6/uf/H//c/0L/0f9m/8f/iv+8/67/s//T/6j/9v+d/xoAk/89AIj/' +
  'YgB9/4UAc/+qAGj/zgBe//IAU/8WAUj/OgE//14BNP+CASn/pgEf/8sBXwDo/VUADP5KADH+PwBU/jUAef4qAJz+IADB/hUA5P4K' +
  'AAn/AQAt//f/Uf/s/3X/4v+Y/9f/vf/N/+L/wv8EALf/KQCt/0wAov9wAJf/lACN/7gAgv/dAHn/AAFu/yUBY/9IAVn/bQFO/5AB' +
  'Q/+1ATn/2QF4APb9bgAb/mMAP/5YAGP+TgCH/kMAq/45AM/+LwDz/iQAF/8aADz/DwBf/wQAhP/7/6f/8P/M/+b/8P/b/xMA0P83' +
  'AMb/WgC7/38AsP+iAKf/xwCc/+wAkv8PAYf/MwF8/1cBcv97AWf/nwFc/8MBUv/oAZIABv6IACv+fQBP/nIAc/5pAJf+XgC7/lQA' +
  '3/5JAAL/PgAn/zQATP8pAG//HgCU/xQAt/8JANv/AAAAAPX/IgDq/0cA4f9qANb/jwDL/7IAwf/XALb/+wCs/x8Bof9DAZb/ZwGM' +
  '/4sBgf+vAXb/0wFt//gBqwAV/qIAOf6XAF7+jACB/oIApv53AMn+bQDu/mIAEf9XADb/TQBa/0IAfv83AKL/LQDG/yIA6v8ZAA4A' +
  'DgAxAAMAVgD6/3kA7/+eAOT/wQDa/+UAz/8KAcX/LQG6/1IBr/91AaX/mgGb/70BkP/iAYb/BgLFACP+uwBI/rAAbf6lAJD+mwC0' +
  '/pAA2P6GAPz+ewAg/3AARP9mAGn/WwCM/1AAsf9HANT/PAD5/zIAHAAnAEAAHABkABIAiAAHAKwA/f/QAPP/9ADo/xkB3v88AdP/' +
  'YQHJ/4QBv/+pAbT/zAGp//ABn/8VAt8AMv7VAFf+ygB7/r8An/61AMP+qgDm/qAAC/+VAC7/iwBT/4EAeP92AJv/awC//2EA4/9W' +
  'AAYATAArAEEATgA2AHMALACWACEAuwAWAN4ADQADAQIAJwH5/0sB7v9vAeP/kwHZ/7cBzv/aAcP//wG5/yQC+ABB/u4AZf7jAIr+' +
  '2ACt/s4A0v7DAPX+ugAa/68APf+kAGL/mgCG/48Aqv+EAM7/egDx/28AFQBlADoAWgBdAE8AggBGAKUAOwDJADAA7QAmABEBGwA2' +
  'AREAWQEGAH4B/P+hAfL/xgHn/+kB3P8OAtL/MgIRAVH+BwF1/vwAmv7xAL3+6ADi/t0ABf/TACr/yABN/70Acf+zAJb/qAC5/50A' +
  '3v+TAAEAiAAlAH4ASQB0AG0AaQCRAF8AtQBUANkASQD9AD8AIQE0AEYBKgBpAR8AjgEUALEBCgDWAQAA+QH1/x4C7P9CAiwBX/4i' +
  'AYT+FwGo/gwBzP4CAfD+9wAU/+0AOP/iAFv/1wCA/80Apf/CAMj/twDt/64ADwCjADMAmQBYAI4AewCDAKAAeQDDAG4A6ABjAAsB' +
  'WQAwAU4AVAFEAHgBOQCcAS8AwAElAOQBGgAIAg8ALAIFAFECRQFu/jsBkv4wAbf+JQHa/hsB//4QASL/BgFH//sAav/wAI//5wCz' +
  '/9wA1//RAPv/xwAeALwAQgCyAGcApwCKAJwArwCSANIAhwD3AHwAGgFyAD4BZwBjAV4AhgFTAKsBSADOAT4A8wEzABYCKAA7Ah4A' +
  'XwJeAXz+VAGh/kkBxv4+Aen+NAEN/ykBMf8fAVX/FQF5/woBnf8AAcL/9QDl/+oACQDgACwA1QBRAMsAdQDAAJkAtQC9AKsA4QCg' +
  'AAUBlQApAYwATQGBAHIBdwCVAWwAugFhAN0BVwACAkwAJQJBAEkCNwBuAngBi/5uAbD+YwHU/lgB+P5PARz/RAE//zoBZP8vAYf/' +
  'JAGs/xoB0f8PAfT/BAEXAPoAOwDvAF8A5QCEANoApwDQAMwAxgDvALsAFAGwADcBpgBcAZsAgAGRAKQBhgDIAXsA7AFxABACZgAz' +
  'AlsAWAJSAH0CkQGb/ogBv/59AeT+cgEH/2gBLP9dAU//UwF0/0gBl/89Abz/MwHg/ygBAwAdAScAEwFLAAgBbwD/AJQA9AC3AOkA' +
  '3ADfAP8A1AAkAckARwG/AGwBtACQAaoAswGfANgBlAD7AYsAIAKAAEMCdQBoAmsAjAKrAar+oQHO/pYB8/6LARb/gQE7/3YBXv9s' +
  'AYL/YQGm/1YByv9MAe//QQERADYBNgAtAVkAIgF+ABgBogANAcYAAgHqAPgADgHtADIB4gBWAdgAegHNAJ8BwwDCAbkA5wGuAAoC' +
  'pAAvApkAUgKOAHcChACbAsUBuP67Ad3+sAEB/6UBJf+bAUn/kAFt/4YBkf97AbT/cQHZ/2cB/v9cASAAUQFFAEcBaAA8AYwAMgGx' +
  'ACcB1AAcAfkAEgEcAQcBQQH8AGQB8wCJAegArQHeANEB0wD1AcgAGQK+AD0CswBhAqgAhQKeAKoC3gHH/tQB6/7JARD/vgEz/7QB' +
  'WP+pAXv/oAGg/5UBw/+KAej/gAELAHUBLwBqAVMAYAF3AFUBmwBLAcAAQAHjADUBCAEsASsBIQFQARYBcwEMAZcBAQG8AfcA3wHs' +
  'AAQC4QAnAtcATALMAG8CwQCUArcAuAL3AdX+7QH6/uIBH//XAUL/zgFm/8MBiv+5Aa7/rgHS/6MB9v+ZARoAjgE9AIMBYgB5AYUA' +
  'bgGqAGQBzgBaAfIATwEWAUUBOgE6AV4BLwGCASUBpgEaAcsBEAHuAQUBEwL6ADYC8ABaAuUAfgLaAKIC0QDHAgX+2P4Q/vv+G/4g' +
  '/yX+Q/8w/mf/O/6L/0X+r/9Q/tT/W/73/2X+GwBw/j4Aev5jAIT+hgCP/qsAmv7PAKT+8wCv/hcBuf47AcT+XwHP/oMB2f6nAeT+' +
  'ygHv/u8B+P4UAgP/NwIO/1sCGP9/AiP/owIu/8cCHv7I/in+6/40/hD/Pv4z/0n+WP9U/nv/Xv6g/2n+xP90/uf/fv4LAIn+LgCU' +
  '/lMAnv52AKj+mwCz/r8Avf7jAMj+BwHS/isB3f5PAej+cwHy/pcB/f67AQj/3wES/wQCHf8nAij/TAIx/28CPP+UAkf/twI5/rn+' +
  'RP7c/k/+Af9Z/iT/Y/5J/27+bP94/pH/g/61/47+2f+Y/v3/o/4gAK7+RAC4/mgAw/6MAM7+sQDY/tQA4/75AOz+HAH3/kEBAv9k' +
  'AQz/iQEX/6wBIv/RASz/9QE3/xgCQv89Akz/YAJX/4UCYv+oAlL+q/5d/s7+aP7y/nL+Fv99/jr/iP5e/5H+gv+c/qf/p/7K/7H+' +
  '7/+8/hEAx/42ANH+WQDc/n4A5/6iAPH+xgD8/uoABv8NARH/MgEb/1UBJf96ATD/nQE7/8IBRf/mAVD/CgJb/y4CZf9SAnD/dgJ7' +
  '/5oCa/6c/nb+v/6B/uT+i/4H/5b+LP+h/k//q/50/7b+mP/B/rz/yv7g/9X+AwDg/icA6v5KAPX+bwAA/5QACv+3ABX/2wAf//8A' +
  'Kv8jATX/RwE//2sBSf+PAVT/swFe/9gBaf/7AXT/IAJ+/0MCif9oApT/iwKF/o3+kP6x/pv+1f6l/vn+sP4d/7v+QP/F/mX/0P6K' +
  '/9v+rf/l/tL/8P71//v+GAAE/zwAD/9gABr/hQAk/6gAL//NADn/8ABE/xUBT/84AVn/XQFk/4ABb/+lAXn/yQGE/+0Bjv8RApj/' +
  'NAKj/1kCrv98Ap/+ff6q/qH+tf7F/r7+6f7J/g3/1P4x/97+Vf/p/nr/9P6d//7+wv8J/+X/FP8JAB7/LAAp/1EANP91AD3/mABI' +
  '/70AUv/gAF3/BQFo/ygBcv9NAX3/cAGI/5UBkv+5AZ3/3QGo/wECsv8lArz/SQLH/20CuP5v/sP+kv7O/rf+2P7a/uP+//7t/iL/' +
  '9/5H/wL/a/8N/47/F/+z/yL/1v8t//v/N/8dAEL/QgBN/2YAV/+KAGL/rgBr/9IAdv/2AIH/GgGL/z4Blv9iAaH/hgGr/6sBtv/O' +
  'AcH/8wHL/xYC1v87AuH/XgLS/mD+3f6D/uj+qP7y/sv+/f7w/gj/E/8S/zj/Hf9c/yj/gP8x/6T/PP/I/0f/7P9R/w8AXP8zAGf/' +
  'WABx/3sAfP+gAIb/wwCR/+gAnP8LAaX/MAGw/1MBu/94AcX/nAHQ/78B2//kAeX/BwLw/ywC+/9PAuv+Uv72/nX+Af+Z/gv/vf4W' +
  '/+H+If8F/yv/Kf82/07/Qf9x/0v/lv9W/7n/YP/e/2r/AQB1/yUAgP9JAIr/bQCV/5EAn/+0AKr/2QC1//wAv/8hAcr/RAHV/2kB' +
  '3v+NAen/sQH0/9UB/v/5AQgAHQITAEECBP9C/g//Zf4a/4r+JP+t/i//0v46//X+RP8Z/0//Pv9a/2H/ZP+G/2//qf96/87/hP/x' +
  '/47/FQCZ/zkAo/9dAK7/gQC4/6UAw//JAM7/7QDY/xEB4/80Ae7/WQH4/34BAgChAQ0AxgEWAOkBIQANAiwAMQIf/zP+Kv9W/jX/' +
  'e/4//57+Sf/D/lT/5v5e/wv/af8v/3T/U/9+/3f/if+b/5T/v/+e/+P/qf8GALT/KwC+/04Ayf9zANL/lgDd/7sA6P/eAPL/AwH9' +
  '/yYBBwBKAREAbwEcAJIBJwC3ATEA2gE8AP8BRwAiAjj/JP5D/0j+Tv9s/lj/kP5j/7T+bv/Y/nf//P6C/yH/jf9E/5f/af+i/4z/' +
  'rf+x/7f/1P/C//n/zf8cANf/PwDi/2QA7P+HAPf/rAABAM8ACgD0ABUAFwEgADwBKgBgATUAhAFAAKgBSgDMAVUA8AFgABQCUf8W' +
  '/lz/Of5n/17+cf+B/nz/pv6H/8n+kf/u/pz/Ev+n/zX/sP9a/7v/ff/G/6L/0P/F/9v/6v/m/w0A8P8xAPv/VQAEAHkADwCdABoA' +
  'wQAkAOUALwAJATkALQFDAFIBTgB1AVkAmgFjAL0BbgDiAXkABQJr/wf+dv8r/oH/T/6L/3L+lv+X/qH/uv6r/9/+tv8D/8H/J//L' +
  '/0v/1v9v/+H/k//q/7f/9f/b/wAAAAAJACIAFABHAB4AagApAI8ANACyAD4A1wBJAPoAVAAfAV4AQwFpAGYBdACLAX0ArgGIANMB' +
  'kwD2AYX/9/2Q/xv+m/8//qT/Y/6v/4f+uv+r/sT/z/7P//T+2v8X/+T/PP/v/1//+v+D/wMAp/8OAMv/GQDw/yIAEgAtADcANwBa' +
  'AEIAfwBNAKIAVwDHAGIA6gBtAA8BdwAzAYIAVwGNAHsBlwCfAaIAwwGsAOYBnv/p/an/DP60/zH+vv9U/sn/ef7T/5z+3f/A/uj/' +
  '5f7z/wj//f8t/wcAUP8SAHX/HACY/ycAvf8yAOH/PAAEAEcAKABQAEwAWwBwAGYAlABwALgAewDbAIYAAAGQACUBmwBIAaYAbQGw' +
  'AJABuwC0AcYA2AG3/9r9wv/9/c3/Iv7X/0X+4v9q/u3/jf73/7L+AQDW/gsA+v4VAB7/IABC/ysAZv81AIr/QACu/0sA0/9VAPb/' +
  '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' +
  'Y/6zAH3+wgCW/tEAsP7gAMn+7wDi/v4A/f4MARb/GwEv/ysBSf85AWP/SAF8/1cBlv9mAa//dQHI/4QB4v+SAfz/oQEUALEBLQC/' +
  'AUgAzgFhAN0BegDrAZQA+wGtAAoCxwAYAuEAJwL6ADYCO/5zAFT+gQBu/pAAiP6fAKH+rQC7/r0A1P7MAO3+2gAI/+kAIf/4ADr/' +
  'BwFU/xYBbv8lAYf/MwGh/0MBuv9SAdP/YAHt/28BBgB+AR8AjQE4AJwBUwCrAWwAuQGFAMgBnwDYAbgA5gHSAPUB7AAEAgUBEgJF' +
  '/k4AXv5dAHj+awCR/noAq/6JAMX+mADe/qcA9/62ABL/xAAr/9MARP/jAF7/8QB3/wABkf8PAav/HwHE/y0B3f88Afb/SgEQAFkB' +
  'KQBpAUIAeAFcAIYBdgCVAY8AowGpALMBwgDCAdsA0QH2AN8BDwHuAVD+KgBp/jgAg/5HAJz+VQC2/mQA0P50AOn+gwAC/5EAHP+g' +
  'ADb/rgBP/74Aaf/NAIL/2wCc/+oAtv/6AM//CQHo/xcBAQAmARsANAE0AEQBTQBTAWcAYgGBAHABmgB/AbQAjwHNAJ0B5gCsAQEB' +
  'uwEaAckBW/4GAHT+FQCO/iMAp/4yAMD+QQDb/lEA9P5fAA3/bgAn/3wAQf+LAFr/mwB0/6oAjf+4AKb/xwDB/9cA2v/lAPP/9AAL' +
  'AAMBJgARAT8AIQFYADABcgA+AYwATQGlAFsBvwBrAdgAegHxAIkBDAGXASUBpgFk/uP/fv7x/5j+AACx/g0Ayv4cAOX+LAD+/jsA' +
  'F/9JADH/WABK/2YAZP92AH7/hQCX/5QAsP+iAMv/sgDk/8EA/f/PABUA3gAwAO0ASQD8AGIACwF8ABoBlQAoAa8ANwHJAEcB4gBV' +
  'AfsAZAEWAXMBLwGBAW/+v/+J/s7/o/7c/7z+6//V/vr/8P4JAAn/FwAi/yYAPP80AFX/QwBv/1MAif9iAKL/cAC7/38A1v+PAO//' +
  'nQAHAKwAIAC7ADoAyQBUANkAbQDoAIcA9gCgAAUBugAUAdQAIwHtADIBBgFBASABTwE6AV4Bev6b/5T+qf+u/rj/x/7H/+D+1f/7' +
  '/uX/FP/0/y3/AgBH/xAAYP8fAHr/LgCU/z0Arf9MAMb/WgDh/2oA+v95ABIAhwArAJYARQClAF8AtAB4AMMAkgDSAKsA4ADEAO8A' +
  '3wD/APgADQERARwBKwErAUUBOQGE/nf/nf6G/7j+lf/R/qP/6v6y/wT/wv8e/9D/N//f/1H/7v9q//z/g/8LAJ7/GgC3/ygA0P83' +
  'AOr/RwADAFUAHABkADUAcwBPAIEAaACRAIIAoACcAK4AtQC9AM4AzADpANsAAgHqABsB+QA1AQcBTgEWAY/+U/+o/mH/w/5w/9z+' +
  'f//1/o3/D/+d/yn/rP9C/7r/XP/J/3X/2P+O/+f/qf/2/8L/BADb/xIA9f8iAA4AMQAnAD8AQABOAFoAXQBzAG0AjQB7AKcAigDA' +
  'AJgA2QCnAPQAtwANAcYAJgHUAEAB4wBZAfEAmv4v/7P+Pv/O/k3/5/5b/wD/av8a/3r/M/+I/03/l/9n/6b/gP+0/5n/xP+0/9P/' +
  'zf/h/+b/8P8AAAAAGQANADIAHABLACsAZQA5AH4ASQCYAFgAsgBmAMsAdQDkAIQA/wCUABgBogAxAbEASwG/AGQBzgCk/gv/vf4Z' +
  '/9f+KP/x/jf/Cv9F/yT/Vf89/2T/V/9y/3H/gf+K/5D/o/+g/73/rv/X/73/8P/L/wkA2/8iAOr/PAD5/1UABgBvABUAiAAlAKEA' +
  'MwC8AEIA1QBRAO4AXwAIAW8AIgF+ADsBjABVAZsAbgGqAK/+5v7I/vX+4v4D//z+Ev8V/yH/L/8x/0j/P/9h/07/fP9c/5X/a/+u' +
  '/3v/yP+K/+L/mP/7/6f/FAC3/y0Axf9HANT/YADj/3oA8f+TAAEArAAPAMcAHQDgACwA+QA7ABMBSgAtAVkARgFoAGABdgB5AYUA' +
  'uf7D/tL+0v7s/uD+Bf/v/h///f45/w3/Uv8c/2v/K/+G/zn/n/9I/7j/WP/S/2b/6/91/wQAg/8eAJP/NwCi/1AAsf9qAL//hADO' +
  '/50A3v+2AOz/0QD7/+oACQADARcAHQEnADYBNgBQAUQAagFTAIMBYgDE/p7+3f6t/vf+vP4Q/8r+Kv/Z/kT/6f5d//f+dv8G/5H/' +
  'Ff+q/yP/w/8z/93/Qv/2/1D/DwBf/ykAb/9CAH3/WwCM/3UAm/+PAKn/qAC5/8EAyP/bANb/9QDl/w4B9P8oAQMAQQERAFsBIAB1' +
  'AS4AjgE9AM/+e/7o/or+Av+Y/hv/p/41/7X+T//F/mj/1P6B/+P+nP/x/rX/AP/O/xD/6P8e/wEALf8aADz/NABL/00AWv9mAGn/' +
  'fwB3/5oAhv+zAJb/zACk/+YAs/8AAcL/GQHQ/zMB4P9MAe//ZQH9/4ABCwCZARoA2f5W/vL+Zf4M/3T+Jf+C/j7/kf5Z/6H+cv+v' +
  '/ov/vv6l/83+v//b/tj/6/7y//r+CgAI/yMAF/8+ACf/VwA1/3AARP+JAFP/pABh/70Acf/WAID/8ACO/wkBnf8jAaz/PQG8/1YB' +
  'yv9vAdn/igHn/6MB9v/k/jP+/f5C/hf/UP4w/1/+Sf9u/mT/ff59/4z+lv+b/rD/qf7K/7j+4//I/v3/1v4VAOX+LgD0/kkAA/9i' +
  'ABL/ewAh/5QAL/+vAD7/yABO/+EAXP/7AGv/FAF6/y4BiP9IAZj/YQGn/3oBtf+VAcT/rgHT/+7+Dv4I/x3+Iv8s/jv/Ov5U/0n+' +
  'b/9Z/oj/Z/6h/3b+u/+F/tT/k/7u/6P+BwCy/iAAwP45AM/+VADf/m0A7v6GAPz+nwAL/7oAGf/TACn/7AA4/wYBR/8fAVX/OQFk' +
  '/1MBdP9sAYL/hQGR/6ABoP+5Aa7/+P7q/RL/+f0s/wf+Rf8W/l7/JP54/zT+kv9D/qv/Uv7F/2D+3v9v/vj/f/4RAI3+KgCc/kMA' +
  'q/5eALr+dwDJ/pAA2P6pAOb+wwD1/t0ABf/2ABP/EAEi/ykBMf9CAT//XQFP/3YBXv+PAWz/qQF7/8MBiv8D/8f9HP/V/Tf/5P1Q' +
  '//L9af8B/oP/Ef6d/yD+tv8u/tD/Pf7p/0v+AgBb/hwAav41AHn+TgCH/mgAl/6CAKb+mwC0/rQAw/7OANL+6ADh/gEB8P4bAf/+' +
  'NAEN/00BHP9oASz/gQE6/5oBSf+0AVj/zgFm/w3/ov0m/7H9Qf+//Vr/zv1z/9z9jf/s/ab/+/3A/wr+2v8Y/vP/J/4LADf+JgBF' +
  '/j8AVP5YAGP+cgBy/owAgf6lAJD+vgCe/tgArf7xAL3+CwHL/iUB2v4+Aen+VwH3/nIBB/+LARb/pAEk/74BM//XAUL/GP9//TH/' +
  'jf1M/5z9Zf+r/X7/uf2Y/8n9sf/Y/cv/5v3l//X9/v8D/hYAE/4xACL+SgAx/mMAP/59AE/+lgBe/rAAbP7JAHv+4wCK/vwAmf4W' +
  'Aaj+MAG3/kkBxf5iAdT+fAHk/pYB8v6vAQH/yQEQ/+IBHv8j/1r9PP9p/Vf/d/1w/4b9if+V/aP/pP28/7P91v/C/fD/0P0IAN/9' +
  'IQDv/TwA/f1VAAz+bgAb/ogAK/6hADn+uwBI/tQAVv7uAGX+BwF1/iABg/47AZL+VAGh/m0Br/6HAb/+oQHO/roB3P7UAev+7QH6' +
  '/i3/N/1G/0X9YP9U/Xr/Y/2T/3H9rf+B/cb/kP3f/579+v+t/RIAvP0rAMv9RQDa/V8A6f14APf9kgAH/qsAFv7EACT+3gAz/vgA' +
  'Qv4RAVL+KgFg/kUBb/5eAX3+dwGM/pEBnP6qAav+xAG5/t4ByP73Adb+Lf/HAkb/uQJf/6oCev+bApP/jQKs/30Cxv9uAt//YAL5' +
  '/1ECEgBCAisAMgJEACQCXwAVAngABwKSAPgBqwDoAcQA2QHfAMsB+AC8AREBrAErAZ4BRQGPAV4BgQF4AXIBkQFiAaoBUwHFAUUB' +
  '3gE2AfcBKAEj/6MCPP+UAlX/hQJw/3cCif9oAqL/WAK8/0oC1v87Au//LAIIAB4CIQAOAjoA/wFVAPEBbgDiAYgA0wGhAMQBuwC1' +
  'AdUApgHuAJgBBwGIASIBeQE7AWsBVAFcAW4BTQGHAT0BoQEvAbsBIAHUARIB7QEDARj/fgIx/28CSv9hAmX/UgJ+/0QCl/80ArH/' +
  'JQLL/xYC5P8IAv7/+QEWAOkBMADbAUoAzAFjAL0BfQCvAZYAnwGwAJABygCCAeMAcwH8AGMBFwFVATABRgFJATcBYwEpAXwBGQGW' +
  'AQoBsAH8AMkB7QDiAd4ADf9bAib/TAJA/z0CWv8vAnP/IAKM/xACpv8CAsD/8wHZ/+QB8//WAQsAxgElALcBPwCpAVgAmgFyAIsB' +
  'jAB8AaUAbQG/AF4B2ABQAfEAQAEMATEBJQEjAT4BFAFYAQUBcgH2AIsB5wClAdgAvgHKANcBuwAD/zYCHP8oAjb/GQJQ/woCaf/8' +
  'AYL/7AGd/90Btv/PAc//wAHp/7EBAgChARsAkwE1AIQBTgB2AWgAZwGCAFcBmwBIAbUAOgHOACsB6AAbAQIBDQEbAf4ANAHvAE4B' +
  '4QBoAdEAgQHCAJsBtAC0AaUAzgGWAPj+EwIS/wQCK//2AUX/5wFe/9gBd//IAZL/ugGr/6sBxP+dAd7/jgH4/34BEABvASoAYQFD' +
  'AFIBXgBEAXcANAGQACUBqgAWAcMACAHdAPgA9wDpABAB2wApAcwARAG9AF0BrgB2AZ8AkAGQAKkBggDDAXMA7f7uAQf/4AEg/9EB' +
  'Ov/CAVP/tAFs/6QBh/+VAaD/hwG5/3gB0/9pAe3/WQEFAEsBHwA8ATgALgFTAB8BbAAPAYUAAQGfAPIAuADjANIA0wDsAMUABQG2' +
  'AB4BqAA5AZkAUgGJAGsBegCFAWwAngFdALgBTwDk/ssB/f68ARb/rgEw/58BSf+QAWP/gQF9/3IBlv9jAa//VQHK/0YB4/82Afz/' +
  'KAEVABkBLgAKAUkA/ABiAOwAewDdAJUAzwCvAMAAyACwAOIAoQD7AJMAFAGEAC8BdgBIAWYAYQFXAHsBSACVAToArgErANn+pgHy' +
  '/pgBC/+JASX/egE+/2wBWP9cAXL/TQGL/z8BpP8wAb//IQHY/xIB8f8DAQoA9AAjAOYAPgDXAFcAxwBwALkAigCqAKQAmwC9AIsA' +
  '1wB9APAAbgAJAWAAJAFRAD0BQQBWATIAcAEkAIoBFQCjAQcAz/6CAej+cwEB/2QBG/9WATX/RwFO/zcBaP8pAYH/GgGa/wsBtf/9' +
  'AM7/7QDn/94AAQDQABoAwQA0ALIATQCjAGYAlACBAIUAmgB3ALMAZwDNAFgA5gBKAAABOwAaASwAMwEdAEwBDgBnAQAAgAHy/5kB' +
  '4//E/l4B3f5QAfb+QQEQ/zIBKv8kAUP/FAFd/wUBdv/3AI//6ACq/9kAw//KANz/uwD2/6wADwCeACkAjwBCAH8AWwBxAHYAYgCP' +
  'AFMAqABEAMIANQDbACYA9QAYAA8BCQAoAfr/QQHs/1wB3f91Ac7/jgHA/7n+OgHS/isB6/4dAQX/DgEf//8AOP/vAFL/4QBr/9IA' +
  'hf/EAJ//tQC4/6UA0f+WAOv/iAAEAHkAHgBrADcAWwBQAEwAawA9AIQALwCdAB8AtwAQANEAAgDqAPT/BAHl/x0B1v82Acf/UQG4' +
  '/2oBqv+DAZv/r/4WAcj+CAHh/vkA/P7rABX/3AAu/8wASP+9AGH/rwB7/6AAlf+SAK7/ggDH/3MA4v9kAPv/VgAUAEcALQA3AEcA' +
  'KQBhABoAegALAJMA/f+tAO7/xwDf/+AA0f/6AML/EwGy/y0BpP9HAZX/YAGG/3kBeP+k/vIAvf7jANb+1QDx/sYACv+3ACP/qAA9' +
  '/5kAV/+KAHD/fACK/20Ao/9dALz/TwDX/0AA8P8xAAkAIwAiABMAPAAEAFYA9/9vAOj/iADY/6MAyf+8ALv/1QCs/+8Anv8IAY7/' +
  'IgF//zwBcP9VAWL/bgFT/5r+zwCz/sAAzf6xAOf+owAA/5QAGf+EADP/dgBN/2cAZv9YAID/SgCZ/zoAs/8rAM3/HQDm/w4AAAAA' +
  'ABkA8P8yAOL/TADT/2UAxf9+ALX/mQCm/7IAl//LAIn/5QB6//8Aav8YAVz/MgFN/0sBPv9kATD/j/6qAKj+mwDC/o0A3P5+APX+' +
  'bwAO/2AAKf9RAEL/QgBb/zQAdf8lAI7/FQCo/wcAwv/5/9v/6v/1/9z/DgDM/ycAvf9BAK//WgCg/3MAkP+OAIH/pwBz/8AAZP/a' +
  'AFb/9ABG/w0BN/8nASn/QAEa/1kBC/+E/oUAnf53ALf+aADR/lkA6v5LAAP/OwAe/ywAN/8eAFD/DwBq/wEAg//y/53/4/+3/9T/' +
  '0P/G/+r/t/8DAKf/HACZ/zYAiv9PAHv/aABs/4MAXf+cAE7/tQBA/88AMf/pACH/AgET/xwBBP81AfX+TgHn/nr+YgCU/lMArf5F' +
  'AMf+NgDg/igA+f4YABT/CQAt//v/Rv/t/2D/3v96/87/k//A/63/sf/G/6L/4f+U//r/hP8SAHX/LABn/0UAWP9fAEj/eQA6/5IA' +
  'K/+rABz/xgAO/98A/v74AO/+EgHh/isB0v5FAcP+b/49AIn+LwCi/iAAvP4SANX+AwDu/vT/Cf/l/yL/1/87/8j/Vf+6/2//qv+I' +
  '/5v/ov+M/7v/fv/W/2//7/9f/wcAUf8hAEL/OgAz/1QAJP9uABX/hwAG/6AA+P67AOn+1ADZ/u0Ay/4HAbz+IAGt/joBn/5k/hoA' +
  'fv4LAJf+/v+x/u//yv7h/+T+0f/+/sL/F/+z/zD/pf9K/5b/ZP+G/33/eP+X/2n/sP9a/8v/TP/k/zz//f8t/xYAH/8wABD/SQAA' +
  '/2MA8v58AOP+lQDU/rAAxv7JALb+4gCn/vwAmf4WAYr+LwF7/lv+9/90/uj/jf7Z/6f+y//A/rz/2v6s//T+nv8N/4//Jv+A/0H/' +
  'cv9a/2L/c/9T/43/Rf+m/zb/wf8n/9r/F//z/wn/DAD6/iYA7P4/ANz+WQDN/nIAvv6MALD+pgCh/r8Akf7YAIP+8gB0/gwBZf4l' +
  'AVf+UP7S/2n+w/+C/rX/nP6m/7b+l//P/oj/6f55/wL/av8b/1z/Nv9N/0//Pf9o/y//gv8g/5z/Ef+2/wP/z//z/uj/5P4CANb+' +
  'GwDH/jQAt/5OAKn+ZwCa/oEAi/6bAH3+tABt/s0AXv7oAFD+AQFB/hoBMv5G/q//X/6g/3j+kf+S/oP/rP50/8X+ZP/f/lb/+P5H' +
  '/xL/OP8s/yr/Rf8a/17/C/94//3+kv/u/qz/3/7F/9D+3v/B/vn/sv4RAKT+KgCU/kQAhf5eAHf+dwBo/pEAWf6qAEn+wwA7/t4A' +
  'LP73AB7+EAEP/jv+iv9U/nv/bf5t/4j+Xv+h/lD/uv5A/9T+Mf/t/iL/B/8U/yH/Bf86//X+U//n/m7/2P6H/8n+of+7/rr/q/7T' +
  '/5z+7v+O/gYAf/4fAG/+OQBh/lMAUv5sAEP+hgA1/p8AJf64ABb+0wAI/uwA+f0FAer9MP5n/0n+WP9i/kn/ff47/5b+LP+v/hz/' +
  'yf4O/+L+//78/vD+Fv/i/i//0v5I/8P+Y/+1/nz/pv6W/5f+r/+I/sj/ef7j/2r+/P9c/hQATP4uAD3+SAAv/mEAIP57ABH+lAAB' +
  '/q0A8/3IAOT94QDW/foAx/0m/kL/P/4z/1j+Jf9z/hb/jP4I/6X++P6//un+2f7a/vL+zP4M/73+Jf+t/j7/n/5Z/5D+cv+B/oz/' +
  'c/6l/2P+v/9U/tn/Rv7y/zf+CgAn/iUAGf4+AAr+VwD7/XEA7f2KAN39pADO/b4AwP3XALH98ACi/Rv+H/80/hD/Tf4B/2j+8/6B' +
  '/uT+mv7U/rT+xv7O/rf+5/6p/gH/mv4a/4r+M/97/k7/bf5n/17+gf9Q/pr/QP60/zH+zv8i/uf/FP4AAAT+GgD1/TMA5/1MANj9' +
  'ZgDJ/X8Auv2ZAKv9swCc/cwAjv3lAH/9EP76/in+7P5D/t3+Xf7O/nb+wP6P/rD+qf6h/sP+k/7c/oT+9v51/g//Zf4p/1f+Q/9I' +
  '/lz/Ov52/yv+j/8b/qn/DP7D//793P/v/fX/3/0PANH9KADC/UEAs/1bAKX9dQCV/Y4Ahv2oAHj9wQBp/doAWv0G/tb+H/7H/jn+' +
  'uP5T/qr+bP6b/oX+i/6g/n3+uf5u/tL+X/7s/lH+Bf9B/h//Mv45/yT+Uv8V/mz/Bv6G//f9n//o/bn/2f3S/8v96/+7/QUArP0e' +
  'AJ79NwCP/VEAgP1rAHD9hABi/Z4AU/23AEX90QA2/dEAxwLaAKQC5QB/Au8AXAL6ADcCBQEUAg8B7wEaAcsBJQGnAS8BgwE6AV8B' +
  'RQE7AU4BFwFZAfMAZAHQAG4BqwB5AYYAgwFjAI4BPgCZARsAowH4/64B1P+5AbD/wwGL/84BaP/YAUP/4gEg/+0B+/73Adj+twC3' +
  'AsEAlALMAG8C1gBMAuEAJwLsAAQC9gDfAQEBuwEMAZcBFgFzASABUAErASsBNQEIAUAB4wBLAcAAVQGbAGABdwBqAVMAdQEvAIAB' +
  'CwCKAej/lQHE/6ABoP+pAXv/tAFY/78BM//JARD/1AHr/t4ByP6dAKkCpwCFArIAYQK8AD0CxwAZAtIA9QHbANEB5gCsAfEAiQH7' +
  'AGQBBgFBAREBHAEbAfkAJgHUADEBsQA7AYwARgFoAFABRQBbASAAZQH+/28B2f96Abb/hQGR/48Bbf+aAUn/pQEl/68BAf+6Ad3+' +
  'xAG5/oQAmgKOAHcCmQBSAqMALwKtAAoCuADnAcIAwgHNAJ4B2AB6AeIAVgHtADIB+AAOAQIB6gANAcYAGAGiACIBfgAtAVkANgE2' +
  'AEEBEQBMAe//VgHK/2EBp/9sAYL/dgFe/4EBO/+MARb/lgHz/qEBzv6qAav+awCLAnUAaAJ/AEMCiQAgApQA+wGfANgBqQCzAbQA' +
  'jwG/AGwByQBHAdQAJAHfAP8A6QDcAPQAtwD/AJQACAFvABMBSwAdAScAKAEDADMB4P89Abz/SAGY/1MBdP9dAU//aAEs/3MBB/98' +
  'AeT+hwG//pEBnP5QAHsCWgBYAmUAMwJvABACegDsAYUAyAGPAKQBmgB/AaUAXAGvADcBugAUAcQA7wDOAMwA2QCnAOQAhADuAF8A' +
  '+QA7AAMBFwAOAfT/GQHR/yMBrP8uAYn/OQFk/0IBP/9NARz/WAH4/mIB1P5tAbD+dwGM/jcAbQJBAEkCTAAlAlYAAgJhAN0BbAC6' +
  'AXYAlQGBAHABjABNAZUAKQGgAAUBqwDhALUAvQDAAJkAywB1ANUAUQDgACwA6gAJAPUA5f8AAcL/CQGd/xQBev8fAVX/KQEx/zQB' +
  'Df8/Aen+SQHG/lQBof5eAX7+HgBeAigAOwIzABYCPQDzAUgAzgFTAKsBXACGAWcAYgFyAD4BfAAaAYcA9wCSANIAnACvAKcAigCy' +
  'AGcAvABCAMcAHgDRAPv/2wDX/+YAs//wAI//+wBr/wYBR/8QASL/GwH//iYB2v4wAbf+OwGS/kUBb/4EAFACDgAsAhkACAIiAOQB' +
  'LQDAATgAnAFCAHgBTQBTAVgAMAFiAAsBbQDoAHgAwwCCAKAAjQB7AJgAWAChADMArAAPALYA7f/BAMj/zACl/9YAgP/hAF3/7AA4' +
  '//YAFP8BAfD+DAHM/hYBqP4gAYT+KgFg/uv/QQL1/x4CAAD5AQkA1gEUALEBHwCOASkAaQE0AEUBPwAhAUkA/QBUANkAXwC1AGgA' +
  'kQBzAG0AfgBJAIgAJQCTAAEAnQDe/6gAuf+zAJb/vQBx/8gATv/TACr/3QAF/+gA4v7yAL3+/ACa/gcBdf4RAVL+0v8xAtz/DgLn' +
  '/+kB8f/GAfz/oQEGAH4BEABZARsANQEmABEBMADtADoAyQBFAKUATwCCAFoAXQBlADoAbwAVAHoA8f+EAM7/jwCq/5oAhv+kAGL/' +
  'rwA+/7oAGv/DAPX+zgDS/tkArf7jAIr+7gBl/vgAQv64/yICwv//Ac3/2gHX/7cB4v+TAe3/bwH2/0sBAQAmAQsAAwEVAN4AIAC7' +
  'ACsAlgA1AHMAQABOAEsAKwBVAAYAYADj/2oAv/91AJv/fwB4/4kAU/+UADD/nwAL/6kA5v60AMP+vwCf/skAe/7UAFf+3gAz/p//' +
  'FAKp//ABtP/MAb3/qQHI/4QB0/9hAd3/PAHo/xcB8//0AP3/0AAHAKwAEgCIABwAZAAnAEAAMgAcADwA+f9HANT/UACx/1sAjP9m' +
  'AGn/cABE/3sAIf+GAPz+kADY/psAtP6mAJD+sABt/rsASP7EACX+hv8FAo//4gGa/70BpP+aAa//dQG6/1IBxP8tAc//CQHa/+UA' +
  '5P/BAO//ngD6/3kAAwBWAA4AMQAZAA4AIgDq/y0Axv83AKL/QgB+/00AWv9XADb/YgAS/20A7v53AMn+ggCm/o0Agf6WAF7+oQA5' +
  '/qsAFv5s//cBdv/TAYH/rwGL/4sBlv9nAaH/QwGr/x8Btv/6AMH/1wDL/7IA1v+PAOH/agDq/0cA9f8iAAAAAAAJANv/FAC3/x4A' +
  'lP8pAG//NABM/z4AJ/9JAAT/VADf/l4Au/5oAJf+cwBz/n0AT/6IACv+kgAH/lL/5wFc/8MBZ/+fAXH/ewF8/1cBh/8zAZH/DwGc' +
  '/+oApv/HALD/ogC7/38Axv9aAND/NwDb/xMA5v/w//D/zP/7/6f/BACE/w8AX/8aADz/IwAX/y4A9P45AM/+QwCr/k4Ah/5ZAGP+' +
  'YwA//m4AG/54APj9Of/YAUP/tQFO/5ABWP9tAWP/SAFu/yUBd/8AAYL/3ACN/7gAl/+UAKL/cACt/0wAt/8pAML/BADN/+L/1/+9' +
  '/+L/mP/r/3X/9v9R/wEALf8KAAn/FQDl/iAAwf4qAJz+NQB5/kAAVP5KADH+VQAM/l8A6f0g/8kBKv+mATX/ggE+/14BSf86AVT/' +
  'FgFe//IAaf/NAHT/qgB+/4UAif9iAJT/PQCe/xoAqf/2/7T/0/+9/67/yP+K/9L/Zv/d/0L/6P8f//L/+v79/9f+BwCy/hEAjf4c' +
  'AGr+JwBG/jEAIv48AP79RQDa/QX/uwEP/5cBGv9zAST/UAEv/ysBOv8IAUT/4wBP/74AWv+bAGT/dwBv/1MAev8vAIP/CwCO/+j/' +
  'mf/E/6P/oP+u/3v/uP9Y/8P/M//O/xD/2P/r/uP/yP7u/6P++P9//gIAW/4MADf+FgAU/iEA7/0rAMz97P6rAfb+iAEB/2MBC/9A' +
  'ARb/GwEh//gAK//TADb/rwBB/4sASv9nAFX/QwBg/x8Aav/8/3X/2P+A/7T/iv+Q/5X/a/+f/0j/qv8j/7X/AP+//9v+yv+4/tT/' +
  'lP7e/2/+6f9M/vT/J/7+/wT+CADf/RIAvP3T/pwB3f55Aej+VAHy/jEB/f4MAQj/6QAS/8UAHP+gACf/fQAx/1gAPP81AEf/EABR' +
  '/+7/XP/J/2f/pv9x/4H/fP9d/4b/Of+R/xX/nP/x/qX/zf6w/6r+u/+F/sX/YP7Q/z3+2/8Y/uX/9f3w/9H9+v+t/bn+jgHD/moB' +
  'zv5GAdf+IgHi/v4A7f7aAPf+tgAC/5EADf9uABf/SQAi/yYALf8CADf/3/9C/7v/Tf+X/1f/c/9h/07/a/8r/3b/Bv+B/+P+i/++' +
  '/pb/m/6h/3b+q/9S/rb/Lv7B/wr+y//m/db/wv3f/5/9oP5/Aan+XAG0/jcBvv4UAcn+7wDU/swA3v6nAOn+gwD0/l8A/v47AAn/' +
  'FwAU//T/Hv/R/yn/rP8z/4n/Pf9k/0j/P/9S/xz/Xf/4/mj/1P5y/7D+ff+M/oj/aP6S/0P+nf8g/qj/+/2x/9j9vP+z/cb/kP2G' +
  '/nABkP5NAZv+KQGl/gUBsP7hALv+vQDF/pkA0P50ANv+UQDl/iwA8P4JAPv+5f8E/8L/D/+d/xr/ev8k/1X/L/8x/zn/Df9E/+n+' +
  'T//G/ln/of5k/37+b/9Z/nj/NP6D/xH+jv/t/Zj/yf2j/6X9rf+B/Wz+YQF2/j0Bgf4ZAYv+9QCW/tEAof6tAKv+iQC2/mQAwP5B' +
  'AMr+HADV/vr/4P7V/+r+sv/1/o3/AP9q/wr/Rv8V/yH/H//+/ir/2f41/7b+Pv+R/kn/bv5U/0n+Xv8l/mn/Af50/939fv+5/Yn/' +
  'lf2T/3H9U/5SAV3+LwFo/goBcv7nAH3+wgCI/p8Akf56AJz+VgCn/jIAsf4OALz+6//H/sf/0f6j/9z+f//n/lv/8f43//z+Ev8F' +
  '/+/+EP/K/hv/p/4l/4L+MP9f/jv/O/5F/xb+UP/z/Vv/zv1l/6v9cP+G/Xr/Y/06/kMBRP4gAU/++wBY/tgAY/6zAG7+kAB4/mwA' +
  'g/5HAI7+JACY/gAAo/7d/67+uP+4/pX/w/5w/87+Tf/X/ij/4v4E/+z+4P73/rz+Av+Y/gz/dP4X/1H+Iv8s/iz/B/43/+T9Qv+/' +
  '/Uz/nP1X/3j9YP9U/R/+NQEp/hEBNP7tAD7+yQBJ/qUAVP6CAF7+XQBp/jgAdP4VAH7+8f+J/s7/lP6q/53+hv+o/mL/s/4+/73+' +
  'Gv/I/vX+0v7S/t3+rf7o/or+8v5l/v3+Qv4I/x3+Ev/5/Rz/1f0n/7H9Mf+N/Tz/af1G/0b9Bv4lARD+AgEb/t0AJf66ADD+lQA7' +
  '/nIARf5NAFD+KQBb/gUAZP7i/2/+vv96/pr/hP52/4/+Uv+a/i7/pP4K/6/+5f65/sL+xP6d/s/+ev7Z/lX+5P4y/u7+Df74/un9' +
  'A//G/Q7/of0Y/379I/9Z/S3/Nv34ASUB7QECAeIB3QDYAboAzgGVAMMBcgC5AU0ArgEpAKMBBQCZAeL/jgG+/4MBmv95AXf/bgFS' +
  '/2QBL/9ZAQr/TgHl/kUBwv46AZ7+LwF6/iUBVv4aATL+DwEO/gUB6f36AMb97wCh/eUAfv3aAFn9zwA2/d8BNAHUARAByQHsAL8B' +
  'yAC0AaQAqQGBAKABXACVATcAigEUAIAB8P91Ac3/agGp/2ABhf9VAWH/SwE9/0ABGf81AfT+KwHR/iABrP4WAYn+DAFk/gEBQf72' +
  'ABz+7AD4/eEA1P3WALD9zACM/cEAaP22AEX9xQFEAboBIAGvAfwApQHYAJoBtACPAZAAhQFsAHoBRwBvASQAZQEAAFsB3f9QAbj/' +
  'RgGV/zsBcP8xAU3/JgEp/xsBBP8RAeH+BgG8/vsAmf7xAHT+5gBR/tsALP7SAAj+xwDk/bwAwP2yAJz9pwB4/ZwAVP2sAVIBoQEv' +
  'AZYBCgGMAecAgQHCAHYBnwBsAXoAYQFWAFYBMgBMAQ4AQQHs/zYBx/8tAaT/IgF//xgBXP8NATf/AgET//gA7/7tAMv+4gCn/tgA' +
  'g/7NAF/+wgA7/rgAFv6tAPP9owDO/ZkAq/2OAIb9gwBj/ZIBYQGHAT0BfAEZAXMB9gBoAdEAXQGuAFMBiQBIAWQAPQFBADMBHQAo' +
  'Afr/HQHW/xMBsv8IAY7//wBq//QARv/pACH/3wD+/tQA2f7JALb+vwCR/rQAbv6pAEn+nwAl/pQAAf6JAN39fwC6/XUAlf1qAHL9' +
  'eAFvAW0BTAFiASgBWAEEAU0B4ABCAbwAOQGYAC4BcwAjAVAAGQErAA4BCAADAeT/+QDB/+4AnP/kAHn/2QBU/84AMP/EAAz/ugDo' +
  '/q8Axf6lAKD+mgB9/o8AWP6FADP+egAQ/m8A7P1lAMj9WgCk/U8AgP1fAX8BVAFcAUkBNwE/ARQBNAHvACkBzAAfAagAFAGDAAkB' +
  'YAAAATsA9QAYAOoA9P/gANH/1QCs/8sAif/AAGT/tQBA/6sAHP+gAPj+lQDU/owAsP6BAIz+dgBo/mwAQ/5hACD+VgD7/UwA2P1B' +
  'ALP9NgCQ/UYBjgE7AWsBMAFGASYBIwEbAf4AEAHbAAYBtgD7AJIA8ABuAOYASgDbACYA0QACAMcA3/+8ALv/sgCX/6cAc/+cAE7/' +
  'kgAr/4cABv98AOP+cgC+/mcAm/5cAHf+UwBS/kgAL/49AAr+MwDn/SgAwv0dAJ/9KwGdASABeQEWAVUBDAExAQEBDQH2AOkA7ADF' +
  'AOEAoADWAH0AzABYAMEANQC2ABAArADu/6EAyf+YAKb/jQCB/4IAXf94ADr/bQAV/2IA8v5YAM3+TQCq/kIAhf44AGH+LQA9/iIA' +
  'Gf4ZAPX9DgDR/QMArf0SAasBBwGIAfwAYwHyAEAB6AAbAd0A+ADTANMAyACvAL0AiwCzAGcAqABEAJ0AHwCTAP3/iADY/34Atf9z' +
  'AJD/aABs/18ASP9UACT/SQAA/z8A3P40ALj+KQCU/h8Ab/4UAEz+CQAn/gAABP71/9/96v+8/fkAuwHuAJgB4wBzAdkAUAHOACsB' +
  'wwAIAboA4wCvAL8ApACbAJoAdwCPAFMAhAAvAHoACwBvAOj/ZQDF/1oAoP9PAHv/RQBY/zoAM/8wABD/JgDs/hsAyP4QAKT+BgB/' +
  '/vz/XP7x/zf+5/8U/tz/7/3R/8z93wDKAdQApgHJAIIBvwBeAbQAOgGpABYBnwDyAJQAzQCJAKoAfwCFAHUAYgBqAD0AYAAaAFUA' +
  '9/9LANP/QACv/zUAiv8rAGf/IABC/xUAH/8LAPr+AQDX/vb/sv7t/47+4v9q/tf/Rv7N/yL+wv/+/bf/2v3GANgBuwC1AbAAkAGm' +
  'AG0BmwBIAZAAJQGGAAEBewDcAHAAuQBmAJQAWwBxAFAATABHACkAPAAEADIA4v8nAL3/HACZ/xIAdf8HAFH//f8t//P/Cf/o/+X+' +
  '3f/B/tP/nP7I/3n+vf9U/rT/Mf6p/wz+nv/p/awA5wGhAMQBlgCfAY0AfAGCAFcBdwA0AW0ADwFiAOsAVwDHAE0AowBCAH8ANwBb' +
  'AC0ANwAiABMAGQDw/w4AzP8DAKf/+v+E/+//X//k/zz/2v8X/8//9P7E/9D+uv+r/q//iP6k/2P+mv9A/o//G/6F//j9kwD3AYgA' +
  '0wF9AK8BcwCLAWgAZwFeAEQBVAAfAUkA+gA+ANcANACyACkAjwAeAGsAFABHAAkAIwAAAAAA9f/c/+r/t//h/5T/1v9v/8v/TP/B' +
  '/yf/tv8E/6v/3/6h/7v+lv+X/ov/c/6B/1D+dv8r/mv/CP55AAUCbgDiAWMAvQFZAJoBTgB2AUMAUgE5AC4BLgAJASMA5gAaAMEA' +
  'DwCeAAQAeQD7/1YA8P8xAOb/DgDb/+r/0P/G/8b/ov+7/37/sP9a/6b/Nv+c/xP/kf/u/of/yf58/6b+cf+B/mf/Xv5c/zr+Uf8W' +
  '/mAAFAJVAPEBSgDMAUAAqQE1AIQBKgBhASAAPAEVABgBCgD0AAEA0AD2/6wA6/+IAOL/ZADX/0AAzf8dAML/+f+3/9T/rf+x/6L/' +
  'jP+X/2n/jf9F/4L/If93//3+bv/Y/mP/tf5Y/5D+Tv9t/kP/SP44/yX+RwAjAjwA/wExANsBJwC3ARwAkwERAG8BBwBLAf3/JgHy' +
  '/wMB6P/eAN3/uwDS/5YAyP9zAL3/TwC0/ysAqf8HAJ7/4/+U/8D/if+b/37/eP90/1P/af8w/17/C/9U/+f+Sf/D/j7/n/41/3v+' +
  'Kv9X/h//M/4sADECIQAOAhYA6QEMAMYBAgChAfj/fgHu/1kB4/81Adj/EgHO/+0Aw//KALj/pQCu/4IAo/9dAJn/OgCO/xUAg//y' +
  '/3r/zv9v/6r/ZP+G/1r/Yv9P/z7/RP8a/zr/9f4v/9L+JP+t/hr/iv4P/2X+BP9C/hMAQQIIAB4C/v/5AfT/1gHp/7EB3v+OAdT/' +
  'aQHK/0UBv/8hAbX//QCq/9kAn/+1AJX/kgCK/20AgP9KAHX/JQBq/wEAYP/e/1X/uv9K/5b/Qf9y/zb/Tv8r/yr/If8F/xb/4v4L' +
  '/73+Af+a/vb+df7r/lL++/9QAvD/LALl/wgC2//kAdD/wAHF/50Bu/94AbD/UwGl/zABnP8LAZH/6ACG/8QAfP+gAHH/fABn/1gA' +
  'XP80AFH/DwBH/+3/PP/I/zH/pf8n/4D/HP9d/xL/OP8I/xT//f7w/vL+zP7o/qn+3f6E/tL+Yf7h/14C1v87Asv/FgLB//MBtv/P' +
  'Aav/qwGh/4cBlv9iAYv/PwGB/xoBdv/3AGv/0gBh/68AV/+KAE3/ZwBC/0IAN/8eAC3/+/8i/9f/F/+z/w3/j/8C/2z/9/5H/+3+' +
  'Iv/i/v/+1/7a/s7+t/7D/pP+uP5v/sf/bQK8/0oCsf8lAqj/AgKd/90Bkv+6AYj/lQF9/3EBcv9NAWj/KQFd/wUBUv/hAEj/vQA9' +
  '/5kAM/92ACn/UQAe/ywAFP8JAAn/5f/+/sL/9P6e/+n+ev/e/lb/1P4x/8n+Dv++/un+tP7G/qn+of6f/n7+rv99AqP/WQKY/zUC' +
  'jv8SAoP/7QF4/8oBb/+lAWT/gQFZ/10BT/85AUT/FQE5//EAL//NACT/qQAa/4UAD/9hAAT/PAD7/hkA8P71/+X+0v/b/q3/0P6K' +
  '/8X+Zf+7/kH/sP4e/6X++f6b/tb+kP6x/oX+jv6U/4sCif9oAn7/RAJ0/yACaf/8AV7/2AFU/7QBSf+PAT7/bAE1/0cBKv8kAR//' +
  '/wAV/9wACv+3AAD/lAD1/m8A6v5LAOD+KADV/gMAyv7h/8D+vP+2/pn/q/50/6H+UP+W/iz/i/4I/4H+5P52/sD+a/6c/nv/mgJw' +
  '/3cCZf9SAlv/LwJQ/woCRf/nATv/wgEw/54BJf96ARv/VgEQ/zIBBf8OAfz+6wDx/sYA5/6jANz+fgDR/lkAx/42ALz+EgCx/u//' +
  'p/7L/5z+p/+R/oP/iP5e/33+O/9y/hb/aP7z/l3+zv5S/qv+Yf+pAlf/hQJM/2ECQv89Ajf/GQIs//YBIv/RARf/rAEM/4kBAv9k' +
  'Aff+QQHs/h0B4v75ANf+1QDO/rEAw/6NALj+aACu/kUAo/4gAJj+/v+O/tn/g/62/3j+kf9u/m3/Y/5J/1j+Jf9P/gH/RP7d/jn+' +
  'uv5H/7kCPP+VAjH/cQIn/00CHP8pAhL/BQII/+EB/f68AfL+mQHo/nQB3f5RAdL+LAHI/gkBvf7kALP+wQCo/p0Anf54AJT+VQCJ' +
  '/jAAfv4NAHT+6f9p/sb/Xv6h/1T+ff9J/ln/Pv41/zT+Ef8p/u3+Hv7J/i7/xwIj/6QCGP9/Ag7/XAID/zcC+P4UAu7+7wHk/ssB' +
  '2f6oAc/+gwHE/mABuf47Aa/+GAGk/vMAmv7QAI/+qwCE/ocAev5jAG/+PwBk/hsAW/74/1D+1P9F/rD/O/6L/zD+aP8l/kP/G/4g' +
  '/xD++/4F/tj+9wHW/t4Bx/7FAbj+qwGq/pEBmv54AYv+XgF9/kUBbv4sAV/+EQFQ/vgAQf7fADL+xQAk/qsAFf6SAAb+eAD3/V8A' +
  '6P1EANn9KwDL/RIAvP35/6z94P+e/cb/j/2s/4D9k/9y/Xr/Yv1f/1P9Rv9F/S3/Nv3sAfr+0wHs/roB3f6gAc7+hgG+/m0BsP5T' +
  'AaH+OgGT/iEBhP4GAXT+7QBl/tQAV/66AEj+oAA6/ocAK/5tABv+VAAM/jkA/v0gAO/9BwDh/e7/0f3V/8L9u/+z/aH/pf2I/5b9' +
  'b/+G/VT/eP07/2n9Iv9a/eIBH//JARD/sAEB/5YB8/59AeP+YwHU/kkBxv4wAbf+FwGp/vwAmf7jAIr+ygB7/rAAbf6XAF7+fQBQ' +
  '/mMAQP5KADH+MAAi/hYAFP7+/wX+5P/1/cv/5/2y/9j9l//J/X7/u/1l/6v9S/+c/TH/jv0Y/3/91wFC/74BM/+lASX/iwEW/3IB' +
  'Bv9YAfj+PgHp/iUB2v4MAcz+8QC8/tgArf6/AJ/+pQCQ/owAgf5yAHP+WABj/j8AVP4lAEb+CwA3/vP/Kf7Z/xn+wP8K/qf/+/2M' +
  '/+39c//e/Vr/zv1A/8D9Jv+x/Q3/ov3OAWf/tAFY/5sBSf+BATv/aAEr/08BHP80AQ7/GwH//gIB8P7oAOH+zgDS/rUAw/6bALX+' +
  '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' +
  'xP5rAav+XAGQ/k0Bd/4/AV7+LwFE/iABK/4SARH+AwHRAMcCtwC5Ap4AqgKEAJsCawCLAlIAfQI3AG4CHgBgAgUAUQLs/0EC0v8y' +
  'Arn/JAKf/xUChv8HAm3/+AFS/+gBOf/ZAR//ywEG/7wB7P6uAdL+ngG5/o8BoP6BAYX+cgFs/mMBU/5TATn+RQEg/jYBBv4oAdAA' +
  'Nv22AEb9nQBU/YMAY/1qAHL9UACA/TYAkP0dAJ/9BACt/er/vP3R/8z9uP/a/Z7/6f2F//j9a/8I/lH/Fv44/yX+Hv8z/gT/Qv7r' +
  '/lL+0f5h/rj+b/6f/n7+hP6O/mv+nP5S/qv+OP66/h7+yP4F/tj+2gBZ/cEAaf2oAHj9jgCG/XUAlf1bAKT9QQCz/SgAwv0PANH9' +
  '9f/f/dz/7/3D//79qf8M/pD/G/52/yv+XP86/kP/SP4p/1f+D/9l/vb+df7c/oT+w/6T/qr+of6P/rH+dv7A/l3+zv5D/t3+Kf7s' +
  '/hD++/7lAH79zACO/bMAnP2ZAKv9gAC6/WYAyP1MANj9MwDn/RoA9f0AAAT+5/8U/s7/Iv60/zH+m/9A/oH/UP5n/17+Tv9t/jT/' +
  'e/4a/4r+Af+a/uf+qf7O/rf+tf7G/pr+1v6B/uT+aP7z/k7+Af80/hD/G/4g/+8Aof3WALH9vQDA/aMAzv2JAN39cADs/VYA+/09' +
  'AAr+JAAZ/gkAJ/7x/zf+2P9G/r7/VP6k/2P+i/9z/nH/gf5Y/5D+Pf+f/iT/rf4L/73+8f7M/tj+2v6+/un+pP75/ov+CP9y/hb/' +
  'V/4l/z7+M/8l/kP/+gDG/eEA1v3IAOT9rgDz/ZQAAf57ABD+YQAg/kgAL/4vAD3+FABM/vz/XP7j/2r+yf95/q//iP6W/5f+fP+m' +
  '/mP/tf5I/8P+L//S/hb/4v78/vD+4/7//sn+Dv+v/h7/lv4s/33+O/9i/kn/Sf5Y/zD+aP8FAen97AD5/dMACP65ABb+nwAl/oYA' +
  'M/5sAEP+UwBS/jkAYf4fAG/+BgB//u7/jv7T/5z+uv+r/qH/u/6H/8n+bv/Y/lP/5/46//X+If8F/wf/FP/t/iL/1P4x/7r+Qf+h' +
  '/lD/iP5e/23+bf9U/nv/O/6L/w8BDv72AB7+3QAs/sIAO/6pAEn+kABY/nYAaP5dAHf+QwCF/ikAlP4QAKT++P+y/t3/wf7E/9D+' +
  'q//f/pH/7v53//3+Xf8L/0T/Gv8r/yr/Ef84//f+R//e/lb/xP5l/6v+dP+R/oP/d/6R/17+oP9F/rD/GgEy/gEBQv7oAFH+zQBf' +
  '/rQAbv6bAH3+gQCM/mcAm/5OAKr+NAC4/hsAyP4CANf+6P/l/s//9P62/wT/nP8T/4L/If9o/zD/T/8+/zb/Tv8b/13/Av9s/+n+' +
  'ev/P/or/tv6Z/5z+p/+C/rb/af7F/1D+1P8lAVb+DAFl/vMAdP7YAIP+vwCR/qYAoP6MALD+cgC+/lkAzf4/ANz+JgDs/g0A+v7z' +
  '/wn/2v8X/8H/J/+n/zb/jf9F/3P/U/9a/2L/Qf9y/yb/gP8N/4//9P6e/9r+rf/B/rz/p/7L/43+2f90/uj/W/74/y8Bev4WAYr+' +
  '/ACZ/uIAp/7JALb+sADF/pUA1P58AOP+YwDy/kkAAP8wABD/FgAf//3/Lf/k/zz/y/9M/7D/Wv+X/2n/ff94/2T/hv9L/5b/MP+l' +
  '/xf/s//+/sL/5P7S/8r+4f+x/u//l/7+/37+CwBl/hsAOgGe/iEBrf4HAbz+7QDL/tQA2f67AOj+oAD4/ocABv9uABX/VAAk/zsA' +
  'M/8hAEL/BwBR/+//X//W/2//u/9+/6L/jP+I/5v/b/+q/1b/uv87/8j/Iv/X/wn/5f/v/vX/1f4DALz+EgCi/iAAif4vAHD+PwBF' +
  'AcL+LAHS/hIB4f74AO/+3wD+/sYADP+rABz/kgAr/3kAOv9fAEj/RgBY/ywAZ/8SAHX/+v+E/+H/lP/G/6L/rf+x/5P/wP96/87/' +
  'YP/e/0b/7f8t//v/FP8JAPr+GQDg/igAx/42AK3+RQCU/lMAev5jAE8B5f41AfX+HAEE/wIBE//pACH/0AAw/7UAQP+cAE7/gwBd' +
  '/2kAbP9PAHv/NgCK/xwAmf8DAKf/6v+3/9D/xv+3/9T/nf/j/4T/8v9q/wEAUP8PADf/HgAe/ywAA/88AOr+SwDR/lkAt/5oAJ7+' +
  'dwCE/ocAWgEK/0ABGv8nASn/DQE3//QARv/aAFT/wABk/6cAc/+OAIH/dACQ/1oAoP9BAK//JwC9/w4AzP/1/9z/2//q/8L/+f+o' +
  '/wcAjv8VAHX/JQBb/zQAQv9CACn/UQAO/2EA9f5vANz+fgDC/o0AqP6bAI/+qwBkAS//SwE+/zIBTf8YAVz//wBq/+UAef/LAIn/' +
  'sgCX/5kApv9+ALX/ZQDF/0wA0/8yAOL/GQDw/wAAAADm/w4Azf8dALP/KwCZ/zoAgP9KAGb/WABN/2cANP92ABn/hQAA/5QA5/6j' +
  'AM3+sQCz/sAAmv7QAG4BUv9VAWL/PAFw/yIBf/8IAY7/7wCc/9UArP+8ALv/owDJ/4gA2P9vAOj/VgD3/zwABAAiABMACQAjAPD/' +
  'MQDX/0AAvP9PAKP/XQCK/20AcP98AFf/igA9/5kAI/+pAAr/twDx/sYA1v7VAL3+4wCk/vMAeQF3/2ABhv9HAZX/LQGk/xMBsv/6' +
  'AMH/4ADR/8cA3/+uAO7/kwD9/3oACwBhABoARwApAC0ANwAUAEcA+/9WAOL/ZADH/3MArv+CAJX/kgB7/6AAYv+vAEj/vQAu/80A' +
  'Ff/cAPz+6wDh/vkAyP4IAa/+GAGDAZr/agGq/1EBuP82Acf/HQHW/wQB5P/qAPT/0QACALcAEACdAB8AhAAvAGsAPQBQAEwANwBb' +
  'AB4AawAEAHkA7P+IANH/lgC4/6UAn/+1AIX/xABr/9IAUv/hADj/8QAf//8ABv8OAev+HQHS/isBuf47AY4Bvv91Ac7/XAHd/0EB' +
  '7P8oAfr/DwEIAPUAGADcACYAwgA1AKgARACPAFMAdgBiAFsAcQBCAH8AKQCPAA8AngD3/6wA3P+7AMP/ygCq/9kAkP/oAHb/9wBd' +
  '/wUBQ/8VASr/JAER/zIB9v5BAd3+UAHE/mABmQHi/4AB8v9nAQAATAEOADMBHQAaASsAAAE7AOcASgDNAFgAswBnAJoAdwCBAIUA' +
  'ZgCUAE0AowA0ALIAGgDBAAEA0ADn/94Azv/tALX//QCb/wsBgf8aAWj/KQFO/zkBNf9HARv/VgEB/2QB6P5zAc/+gwGjAQUAigEV' +
  'AHEBJABWATIAPQFBACQBUAAKAWAA8ABuANcAfQC9AIsApACbAIsAqgBwALkAVwDHAD4A1wAkAOYACgD0APH/AwHY/xIBv/8hAaT/' +
  'MAGL/z8Bcv9NAVj/XQE//2wBJf96AQv/iQHy/pgB2f6oAa4BKQCVATkAewFHAGEBVgBIAWQALwFzABUBgwD7AJIA4gCgAMgArwCv' +
  'AL8AlQDNAHsA3ABiAOsASQD6AC8ACQEVABgB/P8mAeP/NQHK/0UBr/9TAZb/YgF9/3EBY/+BAUn/jwEw/54BFv+sAf3+uwHk/ssB' +
  'uQFNAKABXQCGAWwAbAF6AFMBiQA6AZgAHwGoAAYBtgDtAMUA0wDTALoA4wCgAPIAhgABAW0ADwFUAB8BOQAuASAAPAEGAEsB7v9Z' +
  'AdX/aQG6/3gBof+HAYj/lQFu/6UBVP+0ATv/wgEh/9EBCP/gAe/+7wHDAXIAqQGCAJABkAB2AZ8AXQGuAEQBvAApAcwAEAHbAPcA' +
  '6QDdAPgAwwAIAaoAFgGQACUBdwA0AV4ARAFDAFIBKgBhARAAbwH4/34B3v+OAcT/nQGr/6sBkv+6AXf/ygFe/9gBRf/nASv/9gES' +
  '/wQC+P4UAs4BlQC0AaUAmwG0AIEBwgBoAdEATwHgADQB7wAbAf4AAgENAegAGwHOACsBtQA6AZsASAGCAFcBaQBnAU4AdgE1AIQB' +
  'GwCTAQIAoQHp/7EBz//AAbb/zwGd/90Bgv/tAWn//AFQ/woCNv8ZAh3/KAID/zcC2QG6AL8BygCmAdgAjAHnAHMB9gBaAQQBPwEU' +
  'ASYBIwENATEB8wBAAdkAUAHAAF4BpgBtAY0AfAF0AIsBWQCaAUAAqQEmALcBDQDGAfT/1gHa/+QBwf/zAaj/AgKN/xICdP8gAlv/' +
  'LwJB/z0CKP9MAg7/XALiAd0AyQHtALAB/ACWAQoBfQEZAWMBKAFJATcBMAFGARcBVQH8AGMB4wBzAcoAggGwAJABlwCfAX0ArwFj' +
  'AL0BSgDMATAA2wEWAOkB/v/5AeT/CALL/xYCsv8lApf/NQJ+/0QCZf9SAkv/YQIx/28CGP9/Au0BAgHUARIBuwEgAaEBLwGIAT0B' +
  'bgFMAVQBXAE7AWsBIgF5AQcBiAHuAJgB1QCmAbsAtQGiAMQBiADTAW4A4gFVAPEBOwD/ASEADgIIAB4C7/8sAtb/OwK8/0oCov9Z' +
  'Aon/aAJw/3cCVv+FAjz/lAIj/6QC+AElAd8BNQHGAUQBrAFSAZIBYQF5AW8BXwF/AUYBjgEtAZ0BEgGrAfkAuwHgAMoBxgDYAawA' +
  '5wGTAPcBeQAFAmAAFAJGACMCLAAxAhMAQQL6/1AC4f9eAsf/bQKt/30ClP+LAnv/mgJg/6kCR/+3Ai7/xwI=';

function decode(): Int16Array {
  const bin = atob(PROJECTION_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

let cached: Int16Array | null = null;

/** 投影表，按需解码一次 */
export function projectionTable(): Int16Array {
  cached ??= decode();
  return cached;
}

/**
 * 查一格的屏幕偏移。
 *
 * ★ 表项在内存里的顺序是 `(Y, X)`，故这里要**倒过来**取 —— 见文件头的订正说明。
 *
 * @param view 视角 0..7
 * @param row  行 0..28（= 目标块Y − 摄像机块Y + 14，即世界 Y 方向）
 * @param col  列 0..28（= 目标块X − 摄像机块X + 14，即世界 X 方向）
 * @returns 该格相对屏幕中心的偏移；越界返回 null（原版此时直接跳过不画）
 */
export function projectCell(view: number, row: number, col: number): { x: number; y: number } | null {
  if (row < 0 || row >= VIEW_SPAN || col < 0 || col >= VIEW_SPAN) return null;
  const t = projectionTable();
  const at = ((view % VIEW_COUNT) * VIEW_SPAN * VIEW_SPAN + row * VIEW_SPAN + col) * 2;
  return { x: t[at + 1]!, y: t[at]! };
}

/**
 * 把一个世界坐标投影到屏幕（相对屏幕中心）。
 *
 * 完全照 VA 0x004090fc 的算法：先按 32 取整得块坐标查表，
 * 再用块内余数走 `SUBTILE_MATRIX` 补上亚像素偏移。
 *
 * @param camTileX 摄像机所在的块坐标（世界坐标 >> 5）
 * @param subX 摄像机相对该块原点的**亚格**偏移（世界单位 0..31）。
 *
 *   ★ 原版的镜头中心**恒是一对像素坐标**（`[0x48b2ac]` / `[0x48b2b0]`，
 *   `fcn_0040829d` 入口写入），不只贴边推镜头那一段：
 *   ```asm
 *   004083ae  ecx = camX >> 5 → [esp+0x50]      ; 查表用的块
 *   004083cc  call fcn_00407a2c(camX, camY, &oX, &oY)   ; 镜头**自己**的块内余量过同一张矩阵
 *   004083e1  oX += 0xdc ; oY += 0x104           ; 再加棋盘区中心 (220, 260)
 *   ...
 *   00408590  col = (objX >> 5) − [esp+0x50] + 0xe
 *   004085dc  call fcn_00407a2c(objX, objY, &pX, &pY)   ; 物件的块内余量
 *   004085f8  屏幕X = 表[col,row].x − pX + oX     ; ★ 物件的余量**减**、镜头的余量**加**
 *   ```
 *   ⇒ 块差按**各自** `>> 5` 取、两份余量**分别**过矩阵再一减一加。
 *   先前这里写成「把世界点平移 `sub` 再投影」（`(x − sub) >> 5`）——
 *   投影表带透视、矩阵带取整，两者差 1–2 px，且会让同一物件在镜头滑过块界时抖一下。
 * @param subY 同上（Y 方向）
 */
export function projectWorld(
  view: number,
  x: number,
  y: number,
  camTileX: number,
  camTileY: number,
  subX = 0,
  subY = 0,
): { x: number; y: number } | null {
  const col = (x >> 5) - camTileX + VIEW_CENTER;
  const row = (y >> 5) - camTileY + VIEW_CENTER;
  const base = projectCell(view, row, col);
  if (base === null) return null;

  // @source fcn_00407a2c：o1 喂 X、o2 喂 Y（配对单向，见 SUBTILE_MATRIX 的说明）
  const o = subtileOffset(view, x & 0x1f, y & 0x1f);
  const c = subtileOffset(view, subX & 0x1f, subY & 0x1f);
  return { x: base.x - o.x + c.x, y: base.y - o.y + c.y };
}

/**
 * 块内余量（世界单位 0..31）→ 屏幕像素偏移。
 *
 * @source `fcn_00407a2c`（VA 0x00407a2c）逐行：
 *   `o1 = (m[0]*dx >> 5) + (m[2]*dy >> 5)`、`o2 = (m[1]*dx >> 5) + (m[3]*dy >> 5)`
 *   （`sar` 是算术右移，负数向下取整 —— 与 JS 的 `>>` 同）。
 *   物件用它时**减**、镜头用它时**加**（`fcn_0040829d`，见 `projectWorld`）。
 */
export function subtileOffset(view: number, dx: number, dy: number): { x: number; y: number } {
  const m = SUBTILE_MATRIX[view % VIEW_COUNT]!;
  return {
    x: ((m[0] * dx) >> 5) + ((m[2] * dy) >> 5),
    y: ((m[1] * dx) >> 5) + ((m[3] * dy) >> 5),
  };
}
