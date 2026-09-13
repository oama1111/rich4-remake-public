# 大富翁4 地图数据格式（已完全解明）

> 解明日期：2026-09-13　｜　对应 DEVELOPMENT_PLAN.md 的 **Q1**
> 结论来源：`rich4-re/asm/rich4_load_map.asm`、`rich4_node_utils.asm` 的汇编分析 + 8 张地图原始数据的统计验证

---

## 1. 地图资源定位

```
global_map_id = game_stage * 4 + game_map      // 0..7，共 8 张地图
```

**证据**：`rich4_load_map.asm:80-86`
```asm
movsx edx, word [ref_004991b6]   ; game_stage
shl   edx, 2                     ; *4
movsx eax, word [ref_004991b8]   ; game_map
add   eax, edx                   ; global_map_id
```

| 资源号 | 内容 |
|---|---|
| `global_map_id * 2` | GND 地形图块集（含 512B 调色板） |
| `global_map_id * 2 + 1` | **地图结构数据**（本文主题） |
| `16 + global_map_id` | 地图缩略图 |
| `0x18`, `0x1a` | 全局共用图素 |
| `0x27 + global_map_id*5 + i` (i=0..4) | 地图附属资源 |
| `0x4f + global_map_id` | 地图附属资源 |
| stage=0: `0x57 + i` (i=0..16)<br>stage=1: `0x68 + game_map*17 + i` | 关卡资源 |

---

## 2. 地图数据头（40 字节 = 10 个 uint32）

**证据**：`rich4_load_map.asm:183-210`

| 偏移 | 字段 | 说明 |
|---|---|---|
| 0x00 | `num_map_nodes` | 节点数量（**索引从 1 开始**） |
| 0x04 | `node_table_offset` | 节点表偏移（相对本资源起始） |
| 0x08 | `num_lands` | 住宅地块数 |
| 0x0c | `land_table_offset` | 住宅地块表偏移 |
| 0x10 | `num_facilities` | 设施地块数 |
| 0x14 | `facility_table_offset` | 设施地块表偏移 |
| 0x18 | `num_commercials` | 上市企业数 |
| 0x1c | `commercial_table_offset` | 上市企业表偏移 |
| 0x20 | `num_landscapes` | 特殊景观数 |
| 0x24 | `landscape_table_offset` | 特殊景观表偏移 |

所有表的**索引均从 1 开始**，即第 i 项位于 `table_offset + i * entry_size`。

### 2.1 地图数据总长度

原版用如下公式算出整块地图数据的大小，并按此为**每个玩家**分配一份存档缓冲：

```
map_data_size = (landscape_table_offset + (num_landscapes + 1) * 0x1c) - resource_base
```

**证据**：`rich4_load_map.asm:211-221`（结果存入 `ref_00498e94`，随后 `malloc` 给每个玩家）

---

## 3. 地图节点结构（40 = 0x28 字节）★ Q1 的答案

**节点大小证据**：`rich4_node_utils.asm:19-22`
```asm
mov eax, edx        ; eax = idx
shl eax, 2          ; eax = idx*4
lea ecx, [edx + eax] ; ecx = idx*5
shl ecx, 3          ; ecx = idx*40   ← 节点 = 40 字节
```

| 偏移 | 大小 | 类型 | 字段 | 说明 |
|---|---|---|---|---|
| `0x00` | 2 | int16 | `x` | 世界坐标 X |
| `0x02` | 2 | int16 | `y` | 世界坐标 Y |
| **`0x04`** | **20** | **BIG5 字符串** | **`name`** | **地块名称，null 结尾** ★ |
| `0x18` | 2 | uint16 | `adjacent[0]` | 相邻节点号（0 = 无） |
| `0x1a` | 2 | uint16 | `adjacent[1]` | |
| `0x1c` | 2 | uint16 | `adjacent[2]` | |
| `0x1e` | 2 | uint16 | `adjacent[3]` | |
| `0x20` | 2 | uint16 | `type` | 地块类型，见 §3.2 |
| `0x22` | 2 | uint16 | `decorIndex` | 装饰/图素索引（**语义待确认**） |
| `0x24` | 4 | uint32 | `flags` | 标志位，见 §3.3 |

> ### ★ 0x04 的 20 字节此前被误标为 "reserved"
> Kimi 版解析器把这 20 字节当作未知数据保留。实测证明它是 **BIG5 编码的地块名称字符串**：
> 全部 987 个节点中 921 个带名称，**用 `big5` / `cp950` / `big5hkscs` 回退解码后 100% 成功**。
>
> 例：`a5 64 a4 f9` → 「卡片」、`c5 5d aa 6b ab ce` → 「魔法屋」、`bb c8 a6 e6` → 「銀行」
>
> 这也印证了 `rich4-re/docs/map.txt` 的提示：「通过 ref_004639e1 这个格式化字符串，找出 sprintf 中传入的地块名称」。

### 3.1 相邻节点的用途

节点是否"有效可走"的判定（原版逻辑）：

```c
bool is_walkable = (dword[node+0x18] != 0) || (dword[node+0x1c] != 0);
```
即 4 个 adjacent 中至少有一个非 0。

**证据**：`rich4_node_utils.asm:28-31`

### 3.2 `type` 字段（0x20）

编码为 **基数 + 表索引**，索引对应 §2 的四张表：

| 取值 | 含义 | 验证结果 |
|---|---|---|
| `0` | 特殊格（非地产），具体种类看 `flags` 低字节 | 378 个节点 |
| `2000 + i` | **住宅地块** → `lands[i]` | 381/389 名称匹配 ✅ |
| `4000 + i` | **设施地块** → `facilities[i]` | 116/116 名称匹配 ✅ |
| `6000 + i` | **上市企业** → `commercials[i]` | 部分匹配（企业节点常用通用名如「百貨公司」「銀行」） |
| `8000 + i` | **特殊景观** → `landscapes[i]` | 6/8 匹配 |

> 少量不匹配来自 Kimi 解析器读取表内名称时用了错误的字段长度（见 §4 注），并非 type 编码本身有误。

### 3.3 `flags` 字段（0x24）

| 位 | 含义 |
|---|---|
| bits 0–7 | **特殊格子类型**（静态，仅当 `type == 0` 时有意义），见下表 |
| bits 8–23 | **运行时占用状态**（地图文件中恒为 0，游戏中写入） |
| bits 24–31 | 静态标志。实测用到 bit 27、bit 28、**bit 31** |

**原版的"可放置物品"判定**：
```c
bool occupied = (dword[node+0x24] & 0x80ffff00) != 0;
```
即 bits 8–23 或 bit 31 任一置位则视为不可用。地图文件中 bits 8–23 恒为 0，故静态层面由 **bit 31** 决定该格是否禁止放置道具（47 个节点置位）。

**证据**：`rich4_node_utils.asm:26`、`rich4.asm:2878`、`rich4.asm:3181`

#### 特殊格子类型（flags 低字节）

| 值 | 名称 | 数量 |
|---|---|---|
| 1 | 公園 | 10 |
| 2 | 新聞 | 17 |
| 3 | 命運 | 22 |
| 4 | 監獄 | 7 |
| 5 | 醫院 | 3 |
| 6 | 企鵝挖寶 | 9 |
| 7 | 七彩氣球 | 10 |
| 8 | 喜從天降 | 8 |
| 9 | 樂透 | 16 |
| 10 | 得５０點 | 26 |
| 11 | 得３０點 | 39 |
| 12 | 得１０點 / 星座 / 行星 | 130 |
| 13 | 卡片 | 13 |
| 14 | 銀行 | — |
| 15 | 百貨公司 | — |
| 16 | 魔法屋 | 15 |

---

## 4. 地块表结构

| 表 | 每项大小 | 名称字段 |
|---|---|---|
| `lands`（住宅） | `0x34` = 52 | `0x04` 起，至 `0x16`（**19 字节**，因 `0x17` 是 `price_status`） |
| `facilities`（设施） | `0x38` = 56 | `0x04` 起，至 `0x17`（**20 字节**，因 `0x18` 是 `type`） |
| `commercials`（上市企业） | `0x34` = 52 | `0x04` 起 |
| `landscapes`（特殊景观） | `0x1c` = 28 | `0x04` 起 |

> **注**：Kimi 版解析器对 lands 用了 16 字节、对 facilities/commercials/landscapes 用了 24 字节的名称长度，后者会越界读入 `type`/`owner` 等字段，导致部分名称被污染。正确长度见上表（由 `rich4-re/csrc/land.h` 的字段偏移推出）。

### 4.1 上市企业的额外字段

`rich4_load_map.asm:317-330` 显示，载入地图时会为每个上市企业节点计算：

```c
commercial[i].field_0x30 = 10000 - stocks_on_map[commercial[i].field_0x19].price;
```
其中 `0x19` 是该企业对应的股票索引，`stocks_on_map` 每项 36 字节、股价在 `+8`。

---

## 5. 地形图块（GND 资源）

资源号 `global_map_id * 2`，格式：

```
0x00  4B   签名 "GND\0"
0x04  2B   tile_width   (实测 72)
0x06  2B   tile_height  (实测 72)
0x08  2B   pixels_per_tile
0x10  512B 调色板：256 项 uint16，RGB555
0x210 ...  图块像素数据，每块 tile_w*tile_h 字节（8bpp 索引色）
```

RGB555 解码：
```c
r = (c >> 10) & 0x1F;  g = (c >> 5) & 0x1F;  b = c & 0x1F;
R = r<<3 | r>>2;  G = g<<3 | g>>2;  B = b<<3 | b>>2;
```

> 载入地图时，原版把 `资源[global_map_id*2] + 0x10` 起的 512 字节 memcpy 到全局调色板 `0x48b6b4`，
> 并记录 `0x48bac4 = rsrc + 0x210`（图块数据起点）、`0x48bacc = rsrc + 0x2a90`。
> **证据**：`rich4_load_map.asm:108-124`

---

## 6. 8 张地图的规模实测

| 地图 | 节点 | 住宅 | 设施 | 企业 | 景观 |
|---|---|---|---|---|---|
| 0 | 103 | 50 | 4 | 3 | 21 |
| 1 | 144 | 73 | 8 | 4 | 26 |
| 2 | 110 | 49 | 5 | 6 | 16 |
| 3 | — | 55 | 8 | 6 | 16 |
| 4 | — | 47 | 5 | 3 | 2 |
| 5 | — | 60 | 3 | 12 | 143 |
| 6 | — | 55 | 6 | 3 | 154 |
| 7 | — | **0** | 20 | 7 | 79 |
| **合计** | **987** | | | | |

> 地图 7 没有任何住宅地块（全为设施），是特殊关卡。

---

## 7. 尚待确认

| # | 问题 | 线索 |
|---|---|---|
| a | `0x22` (`decorIndex`) 的确切语义 | 56 种取值，多为奇数；疑似指向图素或 `objects_info`（46 项 × 24 字节） |
| b | `flags` bit 27 / bit 28 的含义 | 静态数据中分别出现 3 次 / 7 次 |
| c | `type` 基数 6000 的名称匹配率偏低 | 需确认企业节点是否使用独立显示名 |
