# 钱的流向

大富翁 4 里的钱有**两条互不相同的路**，规则不同，不能互相套用。

> ⚠️ **本文档的上一版有错。** 它断言「过路费不走 `pay_money`」，
> 依据是「全 exe 只有 4 处调用」。那个计数来自**线性反汇编**，
> 而本 exe 的代码段夹杂数据会导致失步——真实调用点是 **20 处**。
> 教训写在文末。

---

## 1. `pay_money`（VA 0x0041d2c6）—— 绝大多数钱的流动

实现：`packages/core/src/rules/payment.ts`（`transferMoney`）

- 两级级联：一个口袋不够就把负数搬进另一个
- 两个口袋都空 → **削减实付额**（收款方只收到实付部分）并触发破产
- flags bit0 = 收款进现金，bit2 = 付款先扣存款
- 参与方编号：玩家下标 / `>100` 企业（下标 1 基）/ `-1` 公库

共 **20 处**调用点（`python3 tools/disasm.py callers 0x41d2c6`）：

```
0040ec99 0040efd9 0040f076 00419fb4 0041a003 0041a74f 0041b022 0041b686
0041c39b 0041c79e 004258ac 0043c855 00442479 004453a4 00449ddb 0044a013
0044a215 0044bad8 0044c3a3 0044cec2
```

已辨明的几处：

| 调用点 | 形式 | 用途 |
|---|---|---|
| 0x00419fb4 / 0x0041a003 | `pay_money(付款方, 收款方, 额, 0)` | **过路费**，见下 |
| 0x00442479 | `pay_money(cur, seller, price, 0)` | 购地卡 |
| 0x0040ec99 | `pay_money(i, cur, amt, 1)` | 其他玩家各付当前玩家 |
| 0x0040efd9 | `pay_money(cur, i, amt, 0)` | 当前玩家各付其他玩家 |
| 0x0040f076 | `pay_money(cur, -1, amt, 0)` | 付给公库 |

---

## 2. ★ 过路费与**同盟分账**

落点收租在落点结算函数内，VA 0x00419a9d 起。

### 第一步：取地主的同盟对象

```asm
mov al, byte [(land.owner - 1)*0x68 + 0x496ba9]   ; player[地主].allied_player
mov dword [esp + 0xe4], eax                        ; 0 表示地主没有同盟
```

### 第二步：分别算两份租金

```asm
cmp byte [land + 0x18], 0        ; 0 = 住宅，非 0 = 连锁店
jne 连锁店分支
push land.name / push land.owner
call 0x419744                    ; ★ calculate_land_toll(地主, 地块名)
mov ebp, eax                     ; ebp = 地主那一份
push land.name / push [esp+0xe8] ; 再算一次，这次传**同盟者**
…                                 ; 结果落在 [esp+0xcc]
```

> `calculate_land_toll` 的真实入口是 **0x00419744**
> （rich4-re 记的 0x419750 落在函数体中间）。
> 它有多个调用者，不只是显示面板——上一版文档在这点上也错了。

### 第三步：合并与分账

```asm
mov edx, [esp + 0xcc]            ; 同盟那一份
add ebp, edx                     ; ★ 总租金 = 地主份 + 同盟份
fild (edx) / fild (ebp) / fdivp
fstp dword [esp + 0xc4]          ; ★ 比例 = 同盟份 / 总额
```

### 第四步：付款，分两笔

```asm
; 有同盟（[esp+0xe4] != 0）：
fild(ebp) / fmul [esp+0xc4] / fistp [esp+0xcc]   ; 同盟应得 = round(总额 × 比例)
mov ebx, ebp / sub ebx, [esp+0xcc]                ; 地主应得 = 总额 - 同盟应得
pay_money(付款方, 地主, ebx, 0)                    ; @0x00419fb4
pay_money(付款方, 同盟, [esp+0xd0], 0)             ; @0x0041a003

; 无同盟（跳到 0x00419fcf）：
pay_money(付款方, 地主, ebp, 0)                    ; 同一个 call @0x0041a003
```

两条分支**汇流到同一条 `call`**，这也是当初按调用点计数容易看漏的原因。

**效果**：结盟后，盟友名下**同名地块**的租金会并入你的收租，
再按两份的比例分账。这正是原版同盟的核心收益。

### 顺带辨明的两个函数（都是表现层，core 不需要）

- `0x0044f4ed(付款方, ?, 租金)`：阈值 = **物价指数 × 5000**
  （`pi*5 → *8 → -pi → *16 → +pi → *8` 的移位序列），
  租金超过阈值才随机触发台词。
- `0x0044f354(地主, 租金)`：阈值 = **物价指数 × 9000**（`imul …, 0x2328`），
  超过则按地主的 `character` 取台词。

---

## 3. 落点消费 —— 就地 `cmp` + `sub`

实现：`packages/core/src/rules/purchase.ts`

买地、盖房、买设施**确实不走 pay_money**（这一条上一版没错）：

```asm
cmp ebp, dword [player + 0x1c]     ; 只与**现金**比较
jg  放弃                            ; 钱不够直接放弃
sub dword [player + 0x1c], ebp     ; 直接扣现金
```

五处消费点（0x004199c5 / 0x0041a132 / 0x0041a29f / 0x0041a34d / 0x0041a984）
结构一致，**都没有存款级联，也都不会触发破产**，且目标全是
`[0x49910c]`（当前玩家）。

> 钱在银行里就是买不了地，必须先取出来。这是与收租的根本差别：
> **付租金会动用存款，买东西不会。**

消费前还有一道 `call 0x0040fa61(player)` 的附身检查：
`god_info` 为 7（小衰神）、8（大衰神）、15（死神）时禁止消费。
物件名表在 VA 0x0047ed76。

---

## 方法论教训

**永远不要用线性反汇编做全局统计。**

本 exe 的代码段夹杂数据，`md.disasm` 从段首一路扫会在数据处失步，
之后的指令全是错的。这已经造成过两次错误结论：

1. 漏掉 `pay_money` 自己对 `cash` 的写入（124 处引用只找出 2 处）
2. 把 `pay_money` 的 20 个调用点数成 4 个，进而错判「过路费不走它」

正确做法是用 `tools/disasm.py` 的两个字节锚定命令：

```bash
python3 tools/disasm.py xref cash          # 谁碰了某个字段/绝对地址
python3 tools/disasm.py callers 0x41d2c6   # 谁调用了某个函数
```

`xref` 按字节搜常量再对每个命中点独立对齐；
`callers` 扫描 0xE8 并按 `目标 = 地址 + 5 + rel32` 反推——
两者都不受失步影响。
