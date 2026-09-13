# ⚠️ 既有解包产物（`extracted/` 与 `png/`）不可信

> 发现日期：2026-09-13
> 影响范围：**所有 SPR / SMP 精灵资源**，共 720 个资源表、约 13,000 张图像
> 结论：**不得把现有 `png/` 作为超分输入或色彩基准，必须用本项目的 TS 实现重新解包**

---

## 1. 现象

用本项目的 TS 实现与 `tools/dump_all`（C 实现）的产物逐字节比对时，
非精灵资源**完全一致**，但所有 SPR/SMP 资源在开头一段出现差异。

检查参考文件的图像描述表，发现明显不合法的值：

| 资源 | 异常 |
|---|---|
| `extracted/help/0000.bin` | 第 3 张图 `gsize = 0x1ca100de`（480,313,566 字节） |
| `extracted/Panel/0000.bin` | 第 1 张图 `height = -6528`（负高度）、第 3 张 `gsize = 3,885,498,652` |

自洽性判据对比（`help.mkf` 资源 #0，总长 344,474 字节）：

| | 首图偏移 + Σgsize | 结论 |
|---|---|---|
| 本项目 TS 实现 | 156 + 344,318 = **344,474** | ✅ 恰好闭合 |
| `extracted/` 参考 | 156 + 1,450,009,971 = 1,450,010,127 | ❌ 荒谬 |

且本项目解析出的每张 SMP 图像都满足 `width × height × 2 == gsize`，参考文件多处不满足。

---

## 2. 根因

`rich4-re/csrc/mkf/mkf.c` 的 `update_spr_smp_ptr()` 会在读取后**原地改写缓冲区**，
把表中存储的 `gsize` 替换成实际内存指针，供原版 C 代码直接寻址：

```c
sst->chunk_tab[0].gdata = (int16_t*)(s + sst->start_offset + 0x200);
for (int i = 1; i < sst->nchunk; i++) {
    sst->chunk_tab[i].gdata = (int16_t*)((void*)(sst->chunk_tab[i-1].gdata) + lastsz);
}
```

它操作的结构体是（`rich4-re/csrc/mkf/graph_struct.h`）：

```c
struct graph_st {
    int16_t width, height, x, y;   /* 8 字节 */
    int16_t *gdata;                /* 指针 */
    int16_t data[0];
};
```

### 关键：磁盘格式与内存结构体的大小不一致

| | 磁盘上的 `graph_info` | 32 位构建的 `graph_st` | **64 位构建的 `graph_st`** |
|---|---|---|---|
| w/h/x/y | 8 字节 | 8 字节 | 8 字节 |
| gsize / gdata | 4 字节 | 4 字节（指针） | **8 字节（指针）** |
| 对齐填充 | — | — | 结构体按 8 字节对齐 |
| **合计** | **12 字节** | 12 字节 ✅ | **16 字节** ❌ |

原版是 32 位 Windows 程序，指针 4 字节，`graph_st` 恰好 12 字节，与磁盘格式吻合。

但 `tools/dump_all` 是在 **macOS arm64（64 位）** 上编译的，指针变成 8 字节，
`graph_st` 涨到 16 字节。于是 `update_spr_smp_ptr()` 以 **16 字节步长**遍历一张
**12 字节步长**的表，并写入 **8 字节**的堆指针——表被彻底打乱，而且越过表尾，
**连紧随其后的像素数据也被覆盖**。

### 污染范围（实测）

```
[12, 12 + nImages × 16 + 4)
```

对每个 SPR/SMP 资源实测，末差异字节恒为 `12 + n×16 + 3`：

| 样本 | nImages | 预测尾 `12+n*16` | 实测末差异 |
|---|---|---|---|
| `Panel.mkf#28` | 1 | 28 | 31 |
| `map.mkf#16` | 2 | 44 | 47 |
| `jump.mkf#15` | 7 | 124 | 127 |

---

## 3. 影响

### 3.1 `extracted/*.bin`

所有 SPR/SMP 资源的**图像描述表全毁**（尺寸、锚点、gsize），
且前若干字节的像素数据被覆盖。非精灵资源不受影响。

### 3.2 `png/`（1454 张）

`tools/render_smp_spr.py` 是基于 `extracted/` 的描述表来切图的，
而该表已被污染 → **多图资源的切图结果很可能是错的**（尺寸错位、帧错乱）。
单图资源可能侥幸正确（第 0 项的 w/h/x/y 未被覆盖，仅 gsize 被改）。

> ⚠️ **对步骤2（画质升级）的直接后果**：若拿现有 `png/` 去跑超分，
> 等于在放大错误的图像。必须先用本项目的实现重新解包。

### 3.3 色彩

另有一处独立问题：`dump_all.c` 设置 `pixel_fmt = 1`，
`read_mkf()` 会把存储的 **RGB555 转成 RGB565** 布局。
因此 `png/` 的色彩也不是原始值，不可作为色彩基准。

本项目的 `MkfArchive.read()` **默认 `pixelFormat: 'none'`**，保留原始 RGB555，
由渲染层按需转换。

---

## 4. 已采取的措施

1. TS 实现 `packages/assets-pipeline/src/mkf.ts` **不做任何原地指针改写**，
   `gsize` 与 `dataOffset` 分开表达（`GraphInfo.gsize` / `GraphInfo.dataOffset`）。
2. 测试 `mkf.test.ts` 对精灵资源**跳过污染区**再比对，并以
   **Σgsize 恰好闭合**作为独立的正确性判据 —— 720/720 全部通过。
3. 像素格式默认 `none`。

## 5. 待办

- [ ] 用本项目实现重新解包全部素材，替换 `png/`（步骤2 的前置条件）
- [ ] 实现 SPR 的调色板+RLE 解码（SMP 是原始 16bpp，SPR 是压缩编码，
      实测 SPR 图像 `gsize < w*h*2` 占比 >90%）
- [ ] 考虑向上游 `rich4-re` 反馈此 64 位构建缺陷（GPL 社区礼节，
      见 DEVELOPMENT_PLAN.md R6）
