# Q-TOLL-FX-1 —— 過路費「同街地块一起闪」的**逐像素** vs **整张精灵**

> 需求方报：「同一条街的连号地块，过路费只触发当格」。
> 本文件登记这一轮的**取证结论**与**有意偏离的那一处**。
> 代码落点：`client/src/toll-flash-fx.ts`、`client/src/render.ts`、
> `client/src/notice-box-screen.ts`、`client/src/main.ts`、
> `core/src/rules/{toll,rent}.ts`、`core/src/state/{types,reduce}.ts`。
> 规格来自 `docs/tasks/W-60-playtest6.md` 的 W-69（首席已通读
> `0x00419b11..0x00419c88` 与 `fcn_00451985`）。

---

## 0. 先钉死一条：**钱没算错**

地图 0「台北市」4 块地同属 2 号玩家、各 1 级，0 号玩家踩上去 ⇒ 实付
**4800 = 1200 × 4**（`core/rules/toll.ts` 的 `calculateLandToll()` 逐块查表相加，
再 × 物價指数）。用例已原样入库（`core/src/rules/rent.test.ts` 的
「金额回归」一条），任何人「修」规则都会当场变红。

缺的是**收費之前那一段演出**：原版把算进这笔钱的每一块地在棋盘 id 图上标
`0xffff`，再一起闪 16 帧。

## 1. 做了

| 事 | 落点 | 出处 |
|---|---|---|
| 算出「算进这笔钱的每一块地」 | `core/rules/toll.ts` 的 `tollLands()`（`calculateLandToll` 与它共用同一套判据）、`core/rules/rent.ts` 的 `RentResult.counted` | `loc_00419760` / `loc_004197a5`；标记点 `0x00419b9e` / `0x00419c1a` / `0x00419c61` |
| 瞬态提示 `lastTollLands`（只在 > 1 块时写） | `core/src/state/types.ts` + `reduce.ts`（出口按引用相等清成 `null`，与 `lastCardPlay` 同一套） | `0x00419c79 cmp [esp+0xe8],1 / jle` |
| 亮度节拍表 | `client/src/toll-flash-fx.ts` | `fcn_00451985`：16 帧 × **30 ms**（`0x00451a37 push 0x1e`）+ 静 **400 ms**（`0x00451a49 push 0x190`）；表 `0x476380` |
| 算进 `stageBusy()`（訊息框要等它） | `client/src/stage-gate.ts` 的 `tollFlash` 位 + `notice-box-screen.ts` 的 `setNoticeStartGate` | 原版这一段是阻塞的，且在 `0x00419d5a call 0x440cac`（費用訊息框）**之前** |
| 任意滑鼠鍵跳过 | `main.ts` 的 `skipTollFlash()`（mousedown / mouseup / contextmenu 三处，且**吃掉**这一下） | `fcn_004528b9` 返回非 0 即 break |

## 2. 有意偏离：按**精灵**调亮，不是按**像素**

原版改的是棋盘 **id 图**（`[0x474938]`，440×440）上那几格的像素：
第 k 帧给这些像素的 5 位色分量加 `LEVEL[k]`。本引擎**没有**那张 id 图 ——
建筑是逐张精灵贴出来的，所以等价做法是：画那几块地上的建筑时套一句
`ctx.filter = brightness(1 + level/32)`（与 `ASLEEP_FILTER` 的套路一致），
画完立刻清掉。

于是有**两处可见差异**：

1. **整张精灵一起亮**：原版只亮那一格的**地块像素**，本引擎会把压在这一格上的
   整张建筑图（含它的阴影/边框）一起调亮。单块地上两者几乎看不出差别。
2. **空地（未持有/等级 0）不闪**：原版闪的是 id 图上的格子像素，空地也闪；
   本引擎那一支**一个像素都不画**（`landArt` 返回 null，原版也是「露出地砖」），
   所以没有精灵可调。⇒ 本引擎只在**有建筑/空地 logo 的格子**上看得见闪光。
   ⚠️ 但过路费只在**别人持有的地**上收，那些格子必然有主 ⇒ 一定有图可亮。

阈值上「±16 / 32 = ±50% 亮度」正是 5 位分量的半程（满量程 31），
与 `fcn_00451985` 的 `+16` 同一个语义。

## 3. 浏览器实测（前台标签页）

`__rich4.warp(nodeOf[台北市#1])` 触发（先把 4 块台北市设成 1 号玩家的、各 1 级），
每 30 ms 采一次整幅画面的平均亮度：

```
pre 65.305 → 120ms 65.283（正峰）→ 330–360ms 64.630（负峰）→ 500ms+ 64.984（回 0）
→ 900ms 仍 64.984（400 ms 静）→ 1000ms 67.630（訊息框出现）
```

- 曲线与表 `[4,8,12,16,…,−16,…,0]` 对得上（峰值在 ~90–120 ms、谷值在 ~330 ms）；
- 訊息框在 880 ms 之前**一帧都不画**（330 ms 截图里棋盘干净）；
- 在 150 ms 派一次滑鼠按下 ⇒ 250 ms 时訊息框已经出现（闪被跳过）。

钉子：`client/src/toll-flash-fx.test.ts`（节拍表逐点）、
`client/src/toll-flash.test.ts`（`landFlash` 只亮那几块、画完清 filter）、
`client/src/notice-box-screen.test.ts`（闸关着不起播、闸一开当场起播）、
`core/src/rules/rent.test.ts` + `core/src/state/notice.test.ts`（金额回归、
`counted` 的四种阵容、`lastTollLands` 只活一条 action）。

## 4. 没做 / 不确定

1. **没实测「4 块地同时闪」的逐格截图对比** —— 亮度曲线是整幅画面的统计量，
   没有逐块比对。四块都在同一片区域，肉眼在 620 px 的截图上看不出单块差异。
2. **原版那 16 帧的 `LEVEL` 是加在 5 位分量上的**，本引擎用 `brightness()`
   （乘性、sRGB 空间）近似加性 —— 中段（−16 → 0）两者观感接近，两端
   （+16 / −16）不保证逐像素一致。这是上面第 2 节那条偏离的必然结果。
3. **块数 ≤ 1 时**由 core 判（`counted.length > 1`），与 `0x00419c79` 一致 ——
   但原版那个判据数的是「标进 id 图的格子数」，本引擎数的是 `counted.length`，
   两者同一集合。
