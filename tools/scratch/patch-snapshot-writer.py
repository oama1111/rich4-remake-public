#!/usr/bin/env python3
"""save-writer.ts：① 把 0x0004（日期）与 0x268e（物价指数）并入「完全建模」；
② 新增 時光機快照 的 28 区表 + writePlayerSnapshot；③ writeOriginalSaveFile 接 snapshots。"""
from pathlib import Path

P = Path(__file__).resolve().parents[2] / "packages/core/src/loaders/save-writer.ts"

EDITS: list[tuple[str, str, str, int]] = []

# ── 1. MODELED_BLOCK_OFFSETS ─────────────────────────────────────────
EDITS.append((
    "MODELED 表",
    """export const MODELED_BLOCK_OFFSETS: readonly number[] = [
  0x000c, // numPlayers""",
    """export const MODELED_BLOCK_OFFSETS: readonly number[] = [
  0x0004, // 游戏日期（day | month<<8 | year<<16）
  0x000c, // numPlayers""",
    1,
))
EDITS.append((
    "MODELED 表 priceIndex",
    """  0x2676, // 当前玩家
  0x2692, // 已过天数""",
    """  0x2676, // 当前玩家
  0x268e, // 物价指数 [0x4990e8]
  0x2692, // 已过天数""",
    1,
))

# ── 2. 订正「已知未建模」里对 0x268e 的错误描述 ───────────────────────
EDITS.append((
    "未建模说明里的 0x268e",
    """ *   · `0x268e` → `[0x4990e8]`、`0x269a` → `[0x4990dc]`（全股市休市天数，**状态里有**
 *     `market.restDays`，但偏移尚未与 `SaveGame` 对齐，留待下一轮）。""",
    """ *   · `0x269a` → `[0x4990dc]`、`0x26a6` → `[0x4990ec]`（后者两个样本读出来都像 f32 位型：
 *     Save0 = 3215265199 ≈ −1.25、SAVE1 = 1057490816 ≈ 0.56 —— **语义未决**）。
 *   · `0x269e` → `[0x49907c]`（开盘指数）与之并列，`SaveGame` 侧未定名。
 *   ⚠️ 先前这里把 `0x268e` 也列进了本表，并说它是「全股市休市天数」——**两处都错**：
 *     `0x268e` 就是 `save.ts` 的 `OFFSET.priceIndex`（物价指数，实测 Save0 = 5 / SAVE1 = 1），
 *     写侧只是**漏写**，已补（见 `MODELED_BLOCK_OFFSETS`）。""",
    1,
))

# ── 3. 快照区表 + 写出器（插在「顶层拼装」之前） ─────────────────────
SNAPSHOT_SECTION = '''// ============================================================
//  ★ 時光機（道具 10）的 10,008 字节快照
// ============================================================

/**
 * 快照里**有固定偏移**的那些区：`{ snapshotOffset, stateBlockOffset }`。
 *
 * ★ 关键洞察：**快照的每个区都是状态块的某一个块，来自同一个全局变量** ——
 *   原版 `_rich4_store_current_state`（`@source 0x0044808a`）与状态块的
 *   `fwrite` 序列读的是同一批地址（`0x496b68` 玩家、`0x496d08` 物件、`0x499120` 手牌…），
 *   只是**落在快照里的偏移不同**。于是写出器不必重写一套字段映射：
 *   **用 `writeStateBlock` 写出状态块，再把这 28 个区搬到快照偏移上即可**
 *   —— 保真度与状态块逐块相同（完全建模的块就是完全建模的，部分建模的照旧取 carry）。
 *
 * 表的来源（两条独立提取，互相印证）：
 *   · 目的偏移与大小：`rich4-spec/tools/scratch/snapshot_regions.py`
 *     （17 处 `memcpy`，store/restore 两侧完全对称）+ `snapshot_scalars.py`
 *     （8 个 dword 直写 + 有效标记/日期/地图指针）；
 *   · 状态块偏移：`ORIGINAL_SAVE_BLOCKS` 的「目标全局」列
 *     （`save-format.md` §二 权威块序）。
 *
 * 覆盖：28 个区共 **9,999 字节**，另有 4 字节有效标记 + 5 字节对齐填充
 *   + 4 字节地图副本指针（`+0x2714`）= **10,008**。逐区表见 `save-format.md` §五 第 6 条。
 *
 * ⚠️ **不含**每玩家地图副本（`+0x2718` 之后的 `map_data_size` 字节）——
 *   那是「回合开始时的地图」，`GameState` 里没有它的历史副本 ⇒ 仍走 carry。
 */
export const SNAPSHOT_REGIONS: readonly { snapshotOffset: number; stateBlockOffset: number }[] = [
  { snapshotOffset: 0x0004, stateBlockOffset: 0x0004 }, // 游戏日期
  { snapshotOffset: 0x0008, stateBlockOffset: 0x0010 }, // 玩家数组 4×0x68
  { snapshotOffset: 0x01a8, stateBlockOffset: 0x01b4 }, // 特殊实体 5×16
  { snapshotOffset: 0x01f8, stateBlockOffset: 0x0204 }, // objects_info 46×24
  { snapshotOffset: 0x0648, stateBlockOffset: 0x0654 }, // 手牌 4×15
  { snapshotOffset: 0x0684, stateBlockOffset: 0x0690 }, // 道具持有量 4×15
  { snapshotOffset: 0x06c0, stateBlockOffset: 0x06cc }, // 卡片库存 30
  { snapshotOffset: 0x06de, stateBlockOffset: 0x06ea }, // 道具库存 8
  { snapshotOffset: 0x06e8, stateBlockOffset: 0x06f2 }, // 行情历史写游标
  { snapshotOffset: 0x06ec, stateBlockOffset: 0x06f6 }, // 行情历史 6,912
  { snapshotOffset: 0x21ec, stateBlockOffset: 0x21f6 }, // 各玩家持仓
  { snapshotOffset: 0x236c, stateBlockOffset: 0x2376 }, // 12 支股票
  { snapshotOffset: 0x251c, stateBlockOffset: 0x2526 }, // 企業表 28×12
  { snapshotOffset: 0x266c, stateBlockOffset: 0x268e }, // 物价指数
  { snapshotOffset: 0x2670, stateBlockOffset: 0x2692 }, // 已过天数
  { snapshotOffset: 0x2674, stateBlockOffset: 0x2696 }, // 已过月数
  { snapshotOffset: 0x2678, stateBlockOffset: 0x269a }, // [0x4990dc]（未定名）
  { snapshotOffset: 0x267c, stateBlockOffset: 0x269e }, // [0x49907c] 开盘指数（未定名）
  { snapshotOffset: 0x2680, stateBlockOffset: 0x26a2 }, // 当前指数
  { snapshotOffset: 0x2684, stateBlockOffset: 0x26a6 }, // [0x4990ec]（未定名）
  { snapshotOffset: 0x2688, stateBlockOffset: 0x26ba }, // 公库
  { snapshotOffset: 0x268c, stateBlockOffset: 0x26be }, // 樂透号码表
  { snapshotOffset: 0x26b0, stateBlockOffset: 0x26e2 }, // 监狱占用表
  { snapshotOffset: 0x26b8, stateBlockOffset: 0x26ea }, // 医院占用表
  { snapshotOffset: 0x26c0, stateBlockOffset: 0x26f2 }, // 新聞游标
  { snapshotOffset: 0x26c4, stateBlockOffset: 0x26f6 }, // 命運游标
  { snapshotOffset: 0x26c8, stateBlockOffset: 0x26fa }, // 新聞牌堆 36
  { snapshotOffset: 0x26ec, stateBlockOffset: 0x271e }, // 命運牌堆 37
];

/** 快照里**不是**从状态块搬来的那几格（有效标记 / 地图副本指针） */
export const SNAPSHOT_FLAG_OFFSET = 0x0000;
export const SNAPSHOT_MAP_POINTER_OFFSET = 0x2714;

/**
 * 断言快照区表自洽 —— 任何偏移/大小抄错都会在这里炸（与 `assertSaveBlockTable` 同一思路）：
 *   · 每个目标状态块都真实存在，且 `bytes` 就是块表里的 `bytes`；
 *   · 各区在 `[0, 0x2718)` 内**互不重叠**；
 *   · 加上有效标记、地图指针与**实测的 5 字节填充**后恰好铺满 10,008。
 */
export function assertSnapshotRegionTable(): void {
  assertSaveBlockTable();
  const seen: { offset: number; bytes: number }[] = [];
  let total = 0;
  for (const r of SNAPSHOT_REGIONS) {
    const b = ORIGINAL_SAVE_BLOCKS.find((x) => x.offset === r.stateBlockOffset);
    if (b === undefined) {
      throw new Error(`快照区映射到不存在的状态块 0x${r.stateBlockOffset.toString(16)}`);
    }
    seen.push({ offset: r.snapshotOffset, bytes: b.bytes });
    total += b.bytes;
  }
  seen.sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < seen.length; i++) {
    const prev = seen[i - 1]!;
    if (prev.offset + prev.bytes > seen[i]!.offset) {
      throw new Error(
        `快照区重叠：0x${prev.offset.toString(16)}+${prev.bytes} 越过 0x${seen[i]!.offset.toString(16)}`,
      );
    }
  }
  const last = seen[seen.length - 1]!;
  if (last.offset + last.bytes > SNAPSHOT_MAP_POINTER_OFFSET) {
    throw new Error('快照区越过了地图指针格 +0x2714');
  }
  // 有效标记(4) + 各区 + 地图指针(4) + 填充 = 10008；填充实测 = 5（+0x06e6 起 2、+0x2711 起 3）
  const PADDING = 5;
  if (total + 4 + 4 + PADDING !== SNAPSHOT_SIZE) {
    throw new Error(
      `快照区不铺满：${total} + 4 + 4 + ${PADDING} ≠ ${SNAPSHOT_SIZE}`,
    );
  }
}

/** 写出单个玩家的 10,008 字节快照槽 */
export interface WritePlayerSnapshotInput {
  /**
   * **快照时刻**的状态（原版是「本回合开始时」的整份可回滚状态）。
   * ⚠️ 传**当前**状态进来是错的：快照存的是历史状态，两者实测差 40+ 字节。
   */
  state: GameState;
  /**
   * 该槽的原始 10,008 字节（未建模的格从它取）。留空则未建模格写 0 ——
   * 只有在"从零构造"时才该这么用。
   */
  carry: Uint8Array;
  mapDataSize: number;
}

/**
 * 写出**一个**時光機快照槽（10,008 字节，不含其后的地图副本）。
 *
 * 实现：把快照里的 28 个区**按状态块偏移**拼成一份临时 `carry`，
 * 交给 `writeStateBlock`（它会用 `GameState` 覆盖所有已建模块），
 * 再把 28 个区搬回各自的快照偏移。⇒ **字段映射与状态块共用一份，不可能两边不一致。**
 *
 * @source 布局 `0x0044808a`（存）/ `0x00448544`（取）；两条独立提取见
 *   `tools/scratch/snapshot_regions.py` 与 `snapshot_scalars.py`。
 */
export function writePlayerSnapshot(input: WritePlayerSnapshotInput): Uint8Array {
  assertSnapshotRegionTable();
  const { state, carry, mapDataSize } = input;

  // ① 拼一份「按状态块偏移」的 carry：每区的未建模字节来自该槽自己
  const pseudo = new Uint8Array(ORIGINAL_STATE_BLOCK_SIZE);
  for (const r of SNAPSHOT_REGIONS) {
    const b = ORIGINAL_SAVE_BLOCKS.find((x) => x.offset === r.stateBlockOffset)!;
    pseudo.set(carry.subarray(r.snapshotOffset, r.snapshotOffset + b.bytes), r.stateBlockOffset);
  }

  // ② 交给状态块写出器：已建模块**完全由 `state` 产生**
  const block = writeStateBlock({ state, carry: pseudo, mapDataSize });

  // ③ 只把这 28 个区搬回快照的偏移上
  const out = new Uint8Array(SNAPSHOT_SIZE);
  for (const r of SNAPSHOT_REGIONS) {
    const b = ORIGINAL_SAVE_BLOCKS.find((x) => x.offset === r.stateBlockOffset)!;
    out.set(block.subarray(r.stateBlockOffset, r.stateBlockOffset + b.bytes), r.snapshotOffset);
  }

  // ④ 两格非状态块：有效标记 = 1；地图副本指针 = 0
  //    @source `0x004480ce mov dword ptr [eax + 0x48cb80], 1`（只给真人存）
  u32(out, SNAPSHOT_FLAG_OFFSET, 1);
  //    ★ 这一格存的是**进程地址**，读档时被 `malloc` 覆盖
  //      （`@source 0x00402f5d` 分配 → `0x00402f65 mov [esi + 0x48f294], eax`），
  //      实测四个槽是同进程内递推的堆地址 ⇒ 写 0 即可，不必模拟堆布局。
  u32(out, SNAPSHOT_MAP_POINTER_OFFSET, 0);

  return out;
}

'''

anchor = """// ============================================================
//  ★ 顶层拼装：把整个存档文件写出来
// ============================================================"""
EDITS.append(("插入快照段", anchor, SNAPSHOT_SECTION + anchor, 1))

# ── 4. writeOriginalSaveFile 接 snapshots ────────────────────────────
EDITS.append((
    "WriteOriginalFileInput 注释",
    """   * 未建模的部分（版本标识以外的头部字节、每玩家 10,008 快照、每玩家地图副本、
   * 以及各块里"状态没有对应字段"的字节）都从这里取。
   */
  carry: Uint8Array;
}""",
    """   * 未建模的部分（版本标识以外的头部字节、各块里"状态没有对应字段"的字节、
   * 以及每玩家地图副本）都从这里取。
   */
  carry: Uint8Array;
  /**
   * 4 个時光機快照槽的**回合开始时状态**（`state.snapshots` 里那些 JSON 反序列化后的结果）。
   *
   * · `undefined`（默认）⇒ 4 个槽与地图副本**全部走 carry**，行为与从前完全一致
   *   （「读原版存档再写回」这条路径必须用这个，才能逐字节相等）；
   * · 数组项为 `null` ⇒ 该玩家**没有**快照，槽写全零（原版新局就是全零，
   *   `@source map-format.md` 记载 `memset(0x48cb80 + i*0x2718, 0, 0x2718)`）；
   * · 数组项为 `GameState` ⇒ 用 `writePlayerSnapshot` 写出该槽。
   *
   * ⚠️ **每玩家地图副本仍走 carry**：「回合开始时的地图」在本引擎里没有历史副本
   *   （快照 JSON 存的是 `GameState`，地图在 `Rich4Map` 里）。这是下一轮的活。
   */
  snapshots?: readonly (GameState | null)[];
}""",
    1,
))

EDITS.append((
    "writeOriginalSaveFile 主体",
    """  const out = new Uint8Array(total);
  out.set(stateBlock, 0);
  out.set(mapBlock, mapStart);
  // 4 组「快照 + 地图副本」逐字节来自 carry（未建模）
  out.set(carry.subarray(snapStart, total), snapStart);
  return out;
}""",
    """  const out = new Uint8Array(total);
  out.set(stateBlock, 0);
  out.set(mapBlock, mapStart);
  const snaps = input.snapshots;
  if (snaps === undefined) {
    // 4 组「快照 + 地图副本」逐字节来自 carry（读原版存档再写回就走这条）
    out.set(carry.subarray(snapStart, total), snapStart);
    return out;
  }
  for (let i = 0; i < 4; i++) {
    const slotOff = snapStart + i * (SNAPSHOT_SIZE + mapDataSize);
    const snap = snaps[i];
    // null / 缺项 = 该玩家没有快照 ⇒ 槽保持全零（原版新局亦然）
    if (snap !== null && snap !== undefined) {
      out.set(
        writePlayerSnapshot({
          state: snap,
          carry: carry.subarray(slotOff, slotOff + SNAPSHOT_SIZE),
          mapDataSize,
        }),
        slotOff,
      );
    }
    // ⚠️ 每玩家地图副本：仍是 carry（见 `snapshots` 的注释）
    out.set(
      carry.subarray(slotOff + SNAPSHOT_SIZE, slotOff + SNAPSHOT_SIZE + mapDataSize),
      slotOff + SNAPSHOT_SIZE,
    );
  }
  return out;
}""",
    1,
))

src = P.read_text(encoding="utf-8")
for name, old, new, want in EDITS:
    got = src.count(old)
    if got != want:
        raise SystemExit(f"✗ [{name}] 期望 {want} 处匹配，实际 {got} 处")
    src = src.replace(old, new, want)
    print(f"✓ {name}")
P.write_text(src, encoding="utf-8")
print("已写入", P)
