# Q-CARD-1 偏离登记（换地/换屋的目標類別跟脚下走 + 拆除卡的物件分支）

> 本轮解出：**换地/换屋在脚下是設施时的目标类别与效果**、**拆除卡打地图物件那一支**、
> `0xe0c0204` 的用途。
>
> ★ **2026-09-16 更新**：当时 §4 那条「还没进 core」最后也补上了
> （`demolishLikeTargetAllowed()`，见 §4 第 1 条）—— **本卡现在没有未做项**，
> §4 剩下的三条都是「原版自己就这样」或「表现层不涉及」的说明。
>
> 取证一律 `python3 tools/disasm.py`（exe = 最终真值）。

## 1. 缺口

`packages/core/src/cards/target.ts` 的 `targetClassOf()` 把 `0xe0c0202` 写死成
`'land'`，注释说「换地/换屋只认住宅/连锁店（換的是房契），不认設施」——**错**。
另外 `0xe0c0626`（拆除卡）只给 `landOrFacility`，于是 core 收不了
`{ kind: 'object' }`，而原版那张卡有第三条分支专门打地图物件。

## 2. 取证（VA）

### 2.1 换地卡(4) 的选择参数**由脚下那一格决定**

`rich4_card_huandika.asm`（VA 0x00442622）：

| 脚下实例编码 | 地址 | 推的选择参数 | 拾取类别位 |
|---|---|---|---|
| `0x7d0 < code < 0xfa0`（地块） | `00442685` | `push 0xe0c0202` | 低字节 `0x02` = 只认地块 |
| `0xfa0 < code < 0x1770`（設施） | `004428cc` | `push 0xe0c0204` | 低字节 `0x04` = 只认設施 |

两条区间之外（路面/企業/物件）→ `loc_00442ade` → `eax = 0`，**连选择都不开、不扣卡**。

换屋卡(5)（VA 0x00442b02）同形：`00442b6b` 推 `0xe0c0202`、`00442d81` 推 `0xe0c0204`。

`0xe0c0204` 全 asm 只出现在这两张卡（各 2 处），没有别处用它。
它规范化后的类别位就是 **bit2 = 設施**：拾取窗口 `0x44627d` 的
`test byte [0x48c594], 4` → `0xfa0 < code < 0x1770`。两个参数的**组号相同 = 2**
（`(param & 0xff00) >> 8` = 2，跳表 `0x445e2d` 第 2 项 = VA 0x0044639a），
即「类別要与脚下那一格同类，且不能是同一格」：

```asm
004463c2  cmp ebx,0x7d0 / jle 設施分支
004463d2  cmp ecx,0x7d0 / jle 拒绝      ; ecx = 脚下实例编码，必须也是地块
004463de  cmp ecx,0xfa0 / jge 拒绝
004463ea  cmp ecx,ebx / je  拒绝        ; ★ 不能选脚下那一格
004463f2  jmp 接受
```

### 2.2 效果：换地**只换 owner**、换屋**换 type+level**

- **换地卡設施分支** VA 0x00442a09（`edi` = 脚下設施、`esi` = 选中設施）：
  ```asm
  mov byte [esi + 0x19], bl   ; 选中.owner = 脚下原主
  mov al, byte [esp]
  mov byte [edi + 0x19], al   ; 脚下.owner = 选中原主
  ```
  与地块分支 0x004427bb **完全同形**：只写 `+0x19`，等级 `+0x1a`、种类 `+0x18`
  原地不动。尾部 `call 0x40a4e1` / `0x451985` / `0x41d476` 是重画与停帧（表现）。

- **换屋卡**两条分支都调**同一个助手** `0x40b4f8(脚下, 选中)`。该助手前段是
  两个图标相向飞过去的动画（浮点，`0x40b555..0x40b6a2`），尾部落状态
  （地块 0x0040b6c5、設施 0x0040b8aa，同形）：
  ```asm
  mov al,[ebx+0x1a] / mov ah,[esi+0x1a] / mov [ebx+0x1a],ah / mov [esi+0x1a],al
  mov al,[ebx+0x18] / mov ah,[esi+0x18] / mov [ebx+0x18],ah / mov [esi+0x18],al
  ```
  ⇒ **种类（`+0x18`）与等级（`+0x1a`）一起互换，owner 不动**。
  ⚠️ 先前 core 的 `applySwapHouseCard` **只换等级、漏了种类**；本轮一并补上，
  并新增設施版。設施种类互换意味着 旅館↔購物中心↔加油站↔研究所 也会换，
  等级上限表不参与校验（原版如此，不做「改良」）。

### 2.3 拆除卡(12) 的物件分支（VA 0x00443d22）

选择参数 `0xe0c0626` 的低字节 = `0x26` = bit1|bit2|**bit5**（地块|設施|物件）。
编码走完地块、設施两条区间之后：

```asm
00443d22  test byte [esp + 1], 0x80   ; 物件编码带 bit15（0x8000 | handle<<8）
00443d2a  je   loc_00443dae           ; 不是物件 → 什么都不做
00443d2f  mov  esi, [esp] / and esi,0x7f00 / sar esi,8   ; handle
          ... 用物件所在节点播一次动画 ...
00443d97  push esi / call _rich4_remove_object           ; VA 0x0040e14d
```

**哪些物件可拆**：拾取窗口的额外规则（跳表组 6，VA 0x00446528）在
`test bh,0x80` 之后查种类，只放行 **`0x10` 路障 / `0x11` 地雷 / `0x12` 定時炸彈**，
其余（神明/禮物/寶箱/惡犬/死神）一律红叉。

**效果**：`_rich4_remove_object(handle)`（0x0040e14d）= 本项目
`rules/object-landing.ts` 的 `releaseObject`：
- 路障/地雷/定時炸彈 → `inc byte [0x497321/2/3]`（`remain_tool_amount`，
  即**回道具 2/3/4 的库存**）；
- 定時炸彈另有 `if (attached) players[attached-1].f64 = 0`；
- `nodeId/state/attached` 清零、物件离图；
- **不记敌意**（地块/設施两支各有一处 `update_hostility`，物件支没有）。

⚠️ 物件支走完 `_rich4_remove_object` 后落到 `loc_00443dae`
（`test edi,edi / je 结束`）**直接返回**，于是 `loc_00443db6` 那段
（`read_mkf(0x211)` + `fcn_0045144f` 爆炸动画 + 台词 + `refresh_screen`）
**不执行** —— 纯表现，无规则。

### 2.4 AI 那一跳（`_rich4_get_ai_card_param_value`，0x41e6f2）**不用改**

- 该函数体只有两条指令：`eax = [esp+4]; return ai_params[eax]`（表 `0x48be58`）——
  **它只是读表**。全部卡片都 `push 0`。写表的是各卡的 AI 判定函数
  （跳表 `0x475324`，见 `packages/core/src/ai/card-policy.ts`）。
- 换地卡 AI = `0x41eae2`：**本来就有設施分支**
  （`0x41ebc5` 起：脚下是設施 → 扫画面里的設施，要求 `+0x22` 更贵、等级更高）。
  core 的 `huandi` 早已同样处理 ⇒ **无需改动**。
- 换屋卡 AI = `0x41e6e3` = `xor eax,eax; ret` ⇒ **电脑从不打换屋卡**；
  core 的 `AI_NEVER_PLAYS = [5,6,18,19,20,21]` 已含 5 ⇒ 无需改动。
- 拆除卡 AI = `0x41f6a9`：本来就会挑物件（`0x41f7ba` 起：type `0x10` 打别人地上的、
  `0x11` 打自己地上的，`0x12` 不挑），core 的 `chaichu` 也早已如此。
  **但改动前 `willWork` 走的是 core 的 `landOrFacility` 校验，`{kind:'object'}`
  会被 `wrongTargetKind` 挡下 —— 那条 AI 分支实际是死的。** 本轮把
  `0xe0c0626` 归到 `landFacilityOrObject` 之后它才真正可达。

## 3. 落了什么码

| 文件 | 改动 |
|---|---|
| `core/src/cards/target.ts` | 新增 `StandingInstanceKind`；`targetClassOf`/`targetClassOfCard` 加 `standing` 入参（`0xe0c0202` + 脚下設施 → `facility`）；新增类别 `'facility'` / `'landFacilityOrObject'`；`0xe0c0204` → `facility`；`validateTarget` 三个新分支 |
| `core/src/cards/swap-and-stock.ts` | `applySwapFacilityCard`（只换 owner）+ `SWAP_LAND_FACILITY_SELECTION_PARAM` |
| `core/src/cards/turn-and-house.ts` | `applySwapHouseCard` **补上种类互换**；新增 `applySwapHouseFacilityCard`（换 type+level） |
| `core/src/cards/land-cards.ts` | `DEMOLISHABLE_OBJECT_TYPES` + `applyDemolishObjectCard`（复用 `releaseObject`，回库存、不记敌意） |
| `core/src/cards/registry.ts` | `standingInstanceKind()`；换地/换屋「脚下什么都没有 → `notStandingOnLand`」；case 4/5 設施分支；case 12 物件分支 |
| `client/src/picking.ts` | `pickCandidates` 认 `facility` / `landFacilityOrObject`（含物件候选） |
| `client/src/inventory.ts` | `routeCardPick` 把脚下类别传给 `targetClassOfCard`（换地/换屋进对的那一档） |

测试：`core/src/cards/standing-target.test.ts`（新增，17 条）+ `target.test.ts` /
`swap-and-stock.test.ts` / `turn-and-house.test.ts` 相应更新。

## 4. 没做 / 解不出的

1. ✅ **拆除卡（以及怪獸卡）「不能选自己 / 不能选空地」—— 2026-09-16 复核：已接。**
   先前这段写「还没进 core、只靠效果函数的返回值兜」，**与代码对不上**：
   两处都在 registry 的 `case 11`（怪獸卡）/ `case 12`（拆除卡）里显式判了 ——

   ```ts
   // core/src/cards/registry.ts（地块与設施两条支路各一处，共 4 处）
   if (!demolishLikeTargetAllowed(fac.owner, fac.level, cur)) return fail('targetNotAllowed');
   if (!demolishLikeTargetAllowed(targetLand.owner, targetLand.level, cur)) return fail('targetNotAllowed');
   ```

   判据函数在 `core/src/cards/land-cards.ts` 的 `demolishLikeTargetAllowed()`，
   注释里带着那两处 VA（怪獸卡 VA 0x00446457 / 拆除卡 VA 0x004464c3）：

   ```ts
   if (owner === currentPlayer + 1) return false;   // 自己的 → 不收
   if (level === 0) return false;                   // 空地（等级 0）→ 不收
   ```

   **UI 侧也是对的**：这一条走的是 `canUseCard` 预演（`state/preview.ts`），
   拾取候选里根本不会出现自己的地/空地，光标因此落到「红叉」那一档
   （`Data.mkf` 资源 0 图 5，见 `refreshPickCursor()`），与原版一致。
   **用例**：`registry.test.ts` 的怪獸卡 4 条（0 级設施 / 自己的設施 / 空地 / 自己的地）
   —— 拆除卡那一半原先**没有**用例，2026-09-16 按同形补齐 4 条
   （`拆除卡：0 级設施（空地）/ 自己的設施 / 0 级地块（空地）/ 自己的地 → targetNotAllowed`）。
2. **换屋卡把設施种类换掉之后的连带量**（`FACILITY_MAX_LEVEL`、租金表窗口、
   研究所研发状态）原版**不做任何处理**，core 同样照搬。若实战里出现
   「研究所 ↔ 加油站 互换后等级超上限」不是本项目的 bug，是原版行为。
3. 换地卡/换屋卡尾部的 `0x40a4e1`(重画地块) / `0x451985` / `0x41d476` /
   `0x45285e` 都是表现层停帧与重绘，未进 core（C-ARC-2）。
4. AI 的**视野**（画面内 ±220 像素）与镜头钳位仍是既有偏差 D-005，与本卡无关。
