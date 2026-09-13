# 玩家结构体 `player_info`（0x68 字节）

数组基址 `0x496b68`，步长 `0x68`，共 4 项。

本文档只记录**已由 rich4.exe 反汇编直接证实**的字段。
证据等级见 `reverse-engineering-audit.md`：A = exe / 存档，B = 反汇编，C = 手写 C 与头文件（不可直接采信）。

| 偏移 | 大小 | 名称 | 证据 |
|---|---|---|---|
| 0x08 | u16 | `xpos` | 冬眠卡 `cmp word [p+0x08], 0` |
| 0x0a | u16 | `ypos` | |
| 0x0c | u16 | `node_id` | 换地卡 `mov cx, [p+0x0c]` 后查节点表 |
| 0x0e | u16 | `last_node_id` | |
| 0x10 | u8 | `direction` | |
| 0x11 | u8 | `traffic_method` | |
| 0x12 | u8 | `ndices` | |
| 0x13 | u8 | `character` | ★ 台词表索引，见下 |
| 0x14 | u8 | `sex` | |
| 0x15 | u8 | `who_plays` | 各处 `cmp byte [p+0x15], 0` 判出局 |
| 0x1c | i32 | `cash` | `pay_money` `[p*0x68 + 0x496b84]` |
| 0x20 | i32 | `money_in_bank` | `pay_money` `[p*0x68 + 0x496b88]` |
| 0x24 | i32 | `loan` | |
| 0x28 | i32 | `special_finance` | |
| 0x2c | i32 | `f44` | 语义未明 |
| 0x30 | u16 | `points` | |
| 0x32 | u8 | `days_in_hotel` | 冬眠卡把 0x32..0x35 当一个 dword 比较 |
| 0x33 | u8 | `days_disappearing` | 显示时 `& 0x3f` |
| 0x34 | u8 | `days_in_prison` | |
| 0x35 | u8 | `days_in_hospital` | |
| 0x36 | u8 | `days_sleeping` | 冬眠卡 `mov byte [p+0x36], 5` |
| 0x37 | u8 | `days_sleep_walking` | |
| 0x38 | u8 | `days_stopping` | 停留卡；高位是标志位 |
| 0x39 | u8 | `days_tortoise_walking` | |
| 0x3b | u8 | `days_rejected_by_bank` | |
| 0x3d | u8 | `allied_days` | `break_alliance` `[p*0x68 + 0x496ba5]` |
| 0x3f | u8 | `god_info` | **物件下标 + 1**，非神明种类 |
| 0x40 | u8 | `f64` | 另一个物件引用槽 |
| 0x41 | u8 | `allied_player` | **对方下标 + 1**；`[p*0x68 + 0x496ba9]` |
| 0x42 | u8 | `total_winter_sleep_days` | 冬眠卡 `add byte [p+0x42], 5` |
| **0x4c** | **i32 × 4** | **`hostility[4]`** | ★ 见下 |
| **0x5c** | **i32** | **`monthly_paid`** | ★ 见下 |
| **0x60** | **i32** | **`monthly_received`** | ★ 见下 |

---

## ★ 修正：`hostility[6]` 实为 `hostility[4]` + 两个金额字段

`rich4-re/asm/rich4_player_info.h` 把 0x4c..0x63 这 24 字节记作 `int hostility[6]`。
两处反汇编从两侧把它夹死：

**左侧 —— `update_hostility`（VA 0x0040df69）只按 `b*4` 访问 4 项：**

```asm
0040df8d  imul eax, edx, 0x68          ; edx = a
0040df90  mov  ecx, ebx                ; ebx = b
0040df92  shl  ecx, 2                  ; b * 4
0040df95  add  eax, ecx
0040df9b  mov  edi, dword [eax + 0x496bb4]   ; 0x496bb4 - 0x496b68 = 0x4c
```

b 是玩家下标，最多 4 人 → 数组只有 4 项，占 0x4c..0x5b。

**右侧 —— `pay_money`（VA 0x0041d2c6）把紧随其后的两个 dword 当金额累加：**

```asm
0041d381  add dword [eax + 0x496bc4], ebx    ; +0x5c，付款方累加**实付额**
0041d3ca  add dword [eax + 0x496bc8], ebx    ; +0x60，收款方累加实收额
```

0x4c + 4×4 = 0x5c，恰好接上。三者严丝合缝。

实现：`packages/core/src/rules/hostility.ts`、`packages/core/src/rules/payment.ts`。

---

## ★ `update_hostility` 的完整语义（VA 0x0040df69）

```c
void update_hostility(int a, int b, int delta) {
    if (a == b) return;                                  // 自己对自己不记
    if (delta < 0 && hostility[a][b] == 0) return;
    hostility[a][b] += delta;
    if (hostility[a][b] < 0) hostility[a][b] = 0;         // 下限 0，无上限
    if (delta > 0 && player[a].allied_player == b + 1)
        break_alliance(a);                                // ★ 敌意上升会解除同盟
}
```

最后一条是易漏的联动：**对盟友产生任何正敌意，同盟当场作废**（双向清空
`allied_player` 与 `allied_days`，见 `break_alliance` VA 0x0040cc1a）。
所以冬眠卡、均富卡这类群体效果会顺带拆掉出牌者自己的同盟。

---

## ★ `0x44ef41` 是 `player_say`，**不是** `update_hostility`

差点记错的一处。卡片代码里频繁出现：

```asm
mov  dl, byte [player*0x68 + 0x496b7b]   ; character（+0x13）
eax = character * 0x168                   ; 由移位序列凑出
mov  edx, dword [eax + 0x481242]
push edx / push 3 / push ecx / call 0x44ef41
```

第三个参数看似敌意数值，实为**字符串指针**。验证：`0x481242` 处的 dword 是
`0x004692a3`，指向 BIG5 文本 `#0428讓我把它據為己有！！`。

函数入口也吻合（VA 0x0044ef41）：

```asm
mov ebx, dword [esp + 0x2c]        ; arg2 = 文本指针
cmp ebx, dword [0x4762c8]          ; 与「上一句台词」比较
je  end                            ; 相同则不重复播
mov dword [0x4762c8], ebx
```

即 `player_say(playerIdx, kind, text)`。

### 角色台词表

- 12 个角色，步长 **0x168**（360 字节 = 90 个指针）
- 表内每个槽位对应一种情境；已确认的三个：

| 地址（角色 0） | 情境 | 角色 0 台词 |
|---|---|---|
| `0x481242` | 购地卡·买家 | 讓我把它據為己有！！ |
| `0x481246` | 换地卡 | 黃金地段讓給你！！ |
| `0x481332` | 购地卡·卖家（被买走） | 好大的膽子！！ |

字符串自带 `#NNNN` 四位编号前缀，可作为交叉校验。
台词属于表现层（C-ARC-2），core 不使用；此处登记供 M4 渲染层取用。

⚠️ 表的**起止边界尚未测定**——回溯扫描会被大片 0 指针干扰。
需要完整台词表时，应改为从所有 `call 0x44ef41` 的调用点反推槽位集合。
