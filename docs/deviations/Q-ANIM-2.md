# Q-ANIM-2 「踩到惡犬」那一段演出（狗咬 FLIC）—— 取证、落码与三处未接

> 起因：需求方回报「踩到狗之后没有触发狗咬人的动画和配音就直接进医院了，
> 也没有救护车来拉人的动画。正确顺序应该是：踩到狗 → 触发狗咬人动画/配音 →
> 触发救护车来拉人动画/配音 → 镜头到医院同时触发对应场景台词」。
>
> 复核命令一律是 `cd rich4-remake && python3 tools/disasm.py …`。
> 本次**只接**「徒步踩到惡犬」那一支里**能证**的那一段影片；下面 §3 是没做的。

---

## 1. 原版那一支的完整次序（VA 0x0041b837）

落点跳表 `ref_0041b3e5`（VA 0x0041b3e5，18 项 = 種類 1..18）的第 11 项就是它
（`rich4-re/asm/rich4_player_core_actions.asm:2595 dd loc_0041b837`）。

```asm
0041b837  mov  edi, [0x48baf8]           ; 剩余步数
0041b83d  test edi, edi / jne 0x41c164   ; 没停下来就不咬
0041b845  push 0xb / call 0x40e14d       ; remove_object(11) —— 狗自己消失
0041b84f  mov  ebp, [0x49910c]           ; 当前玩家
0041b855  cmp  ebp, 4 / jge 0x41b8a7     ; NPC（4..7）跳过玩家那两支
0041b85a  imul eax, ebp, 0x68
0041b85d  cmp  byte [eax + 0x496b79], 0  ; ★ player + 0x11 = traffic_method
0041b864  je   0x41b89e                  ;   徒步 → 救护车那一支
0041b866  push edi / push edi            ; x = 0、y = 0（edi 恒 0）  ← 有车那一支
0041b868  push 0x228 / call 0x450441     ; read_mkf（Data.mkf 0x228 = god-ok.FLC）
0041b87d  push 0x55 / push 0x10001 / call 0x45144f   ; 播 + 音效 85
0041b891  call 0x456e11                  ; libc_free
0041b899  jmp  0x41c164                  ; ★ 有车这一支**不住院**
0041b89e  push ebp / call 0x40cd07       ; wreck_vehicle(玩家)
0041b8a7  push 0 / push 0 / push 0x214 / call 0x450441   ; read_mkf（DOG.FLC） ← ★ 徒步那一支
0041b8c1  push 0x5d / push 0x30001 / push 0x28 / push 0 / call 0x45144f  ; 播 + 音效 93
0041b8d6  call 0x456e11                  ; libc_free
0041b8de  xor edi, edi / mov [0x48baf8], edi   ; 剩余步数清零
0041b8e6  push 3 / push ebp / call 0x43ec3f    ; send_to_hospital(玩家, 3)
```

`send_to_hospital`（`_rich4_add_player_days_in_hospital`，VA 0x0043ec3f）内部：

```asm
0043ec6e  push y / push x / push 0 / call 0x41d476   ; 镜头：居中到**该玩家**（不是医院）
0043ed27  cmp byte [0x497159], 0 / je 0x43ed85       ; ★「動畫過程」闸门
0043ed34  push 0x20c / call 0x450441                 ; read_mkf（Data.mkf 0x20c = AMBUL.FLC）
0043ed4a  push 0x5c / push 0x1e0001 / push 0xd2 / push 0 / call 0x45144f  ; 播 + 音效 92
0043ed59  …（播完才继续）
0043eda0  push y / push x / push 0 / call 0x41d476   ; 又一次居中到该玩家
```

⇒ **次序（徒步）**：
`remove_object(11)` → **狗咬影片 0x214（4.332 s，音效 85）** → `wreck_vehicle` →
**`send_to_hospital` 里的救护车影片 0x20c（6.2 s，音效 92）** → 落账。
`wreck_vehicle` 自己没有影片，但它会在**这一段之内**切状态（`traffic_method = 0`、
车回库存），本引擎的 `rules/object-landing.ts` 已经在规则层做掉了。

## 2. 本次落的码

- 新增 `packages/client/src/dog-fx.ts`：`DOG_BITE_FILM` 规格表 + `dogBiteFxTrigger()`。
  - 资源 `0x214`（嵌入源路径 `D:\RICH4\FLCS\DOG.FLC`）、38 帧、440×440、114 ms/帧、
    flags `0x10001`、音效 `85`（`Effect.mkf` 0x55）、落点**屏幕 (0,0)**
    —— 五个数各自 `@source` 到上面那几条 `push`（`dog-fx.test.ts` 里回 exe 钉了字节）。
- `main.ts`：
  - `startActionFx` 里 `startDogFx(before, state)` **排在 `startConfineFx` 之前**；
  - `startBoardFilm(spec, after?)` 多一个「播完接哪一段」的入参 +
    `pendingBoardFilmAfter` 排队位，`tickBoardFilm` 在上一段收摊后接第二段；
  - `holdForActorWalk` 多一道 `pendingBoardFilmAfter !== null` 的闸（挡两段之间的空档），
    **两段都播完**才 `resumeTurnDriver()`；
  - 重开/重同步那两处把排队位一起清掉。
- `packages/client/src/dog-fx.test.ts`：17 条，含 4 条可证伪的（改资源号 / 反闸门 /
  换次序 / 落点改成 0x28 都会红）。

⚠️ **不吃「動畫過程」**：惡犬那一支（0x41b837..0x41b8f8）里**没有**
`cmp byte [0x497159], 0`（`dog-fx.test.ts` 直接在那段字节里搜过），与
住院/入獄/神明那三支**不同** ⇒ 本模块不加 `options.animation` 闸。
但**救护车那一段仍然吃**（它在 `send_to_hospital` 里，`0x43ed27` 那句就是），
所以关掉「動畫過程」时：狗咬照播 4.332 s、救护车不播、回合驱动照放行。

## 3. 没做的 / 没证的（三条）

1. **有车那一支的 `0x228`（`god-ok.FLC`）本引擎够不到**。
   原版：`traffic_method != 0` ⇒ 播 0x228（18 帧 × 71 ms = 1.278 s、音效 85、
   落点 (0,0)）**且不住院、不 wreck**；本引擎 core 把这一支判成
   「有车就咬不到：`hospitalDays = 0`、`stopMovement = false`、车也不掉」
   （`rules/object-landing.ts:657-673`，`object-landing.test.ts:208` 有断言）。
   两者**观测不同**，而「有车的人踩到狗到底怎样」是**规则口径**，
   按 WORKPLAN §2 规则 4 不自行裁定 ⇒ 见 `docs/escalations.md` 的 **E-16**。
2. **救护车影片本身没有「抬人」的内容**。`Data.mkf 0x20c` 的嵌入源路径是
   `C:\MAKE\FLCS\AMBUL.FLC`、62 帧、440×**74**（只有棋盘正中那一条），
   本引擎从 2026-09-16 起就会播它（`confine-fx.ts`）。需求方说的
   「救护车来拉人」如果指画面里没有救护车/担架，那是**素材如此**，不是漏接。
3. **「镜头到医院」在 exe 里没有对应物**（需求方的期望，不是原版行为）：
   - `send_to_hospital` 全文只有两次 `call 0x41d476`，两次的入参都是
     **该玩家自己的 `player+0x08/+0x0a`**（VA 0x0043ec6e / 0x0043eda0）——
     即「镜头居中到当事人」，**没有任何一处把镜头搬到医院格**；
     `callers 0x43ec3f` 的 10 个调用点（`0x40aed6/0x40cef3/0x41b77e/0x41b8ef/0x41c827/`
     `0x432421/0x4470df/0x447bf5/0x449285/0x44cd65`）里也没有「搬镜头」那一类。
   - ⇒ 本引擎**不动镜头**（`engine` 的镜头本来就跟当前玩家走）。

4. **「医院场景台词」其实早就有，而且这一支就是它**
   —— 需求方要的那句原版确实说，本引擎也已经接了：
   - 原版：`send_to_hospital` 里 `0x0043edbc` 取 `event 20` 的字串
     （表 `0x48089a + 角色*28 + 80`）、`0x0043edcb call 0x44ef41`
     （`_rich4_player_say`）——「我不要打針！！」；
     ⚠️ 但 `0x0043ec80 test dh,dh / jne 0x43ed6c` 是**加刑**那一支：
     **只有「新判」（`days_in_hospital` 由 0 变非 0）才说**，本来住着院再加刑不说。
   - 本引擎：`speech.ts` 的 `detectHospitalEntered`（`source: [0x0043edbc]`，
     判据 `enteredBlocking(before, after, 'inHospital')` = 0 → 非 0）就是同一句，
     `playSoundFor` 已经在放它。
   - ⇒「镜头到医院同时触发对应场景台词」这句**只需要狗咬那 4.332 秒接上**
     （接上之前，人是一瞬间进的医院，那句话只闪一下就没了 —— 看起来像"没触发"）。
     这一条本次**没有改动**（本来就对）。
