# Q-DOLL-1 機器娃娃（道具 1）的**动画与音效** —— 表现层缺口

> 需求方报：「使用道具-机器娃娃后没有看到动画和音效」。
> 本文件登记这一轮的**取证结论**与**没解出/有意不做的**。
> 代码落点：`packages/client/src/render.ts`、`packages/client/src/main.ts`、
> `packages/assets-pipeline/src/audio.ts`。
> 相关的旧记录：`T-047.md` 的 `D-T047-6`（補間起不来的那一条，已由中央修在
> `actorWalkTriggers`）。**本条是它的下半截** —— 補間起得来了，但没人画。

---

## ✅ Q-DOLL-1　機器娃娃走的那一趟**补间在动、棋盘上却没有人**

- **现象**：用完道具 1，`state.lastNpcWalks` 里确实有一条 `{slot: 4, path: [...]}`
  （9 格），`actorWalkTriggers` 也确实给它起了补间（`D-T047-6` 修好的那条），
  但屏幕上什么都没有、也没有声音。
- **根因（两个独立的缺口，各修各的）**：
  1. **没人画**：`runDoll` 走完就 `idleActor()`，于是**这一次动作产出的 state 里**
     娃娃已经是 `nodeId = 0 / place = 3（未出场）`。而 `actorTokens` 的头一句是
     `place !== board → 跳过`（照抄 exe `fcn_0040829d` 的 `cmp byte [rec+10], 0 /
     jne 跳过`）—— 整趟补间一帧都出不来。换句话说：`D-T047-6` 把「补间」修好了，
     但**绘制**那一头还卡在同一句判据上。
  2. **没声音**：`playSoundFor`（`main.ts`）里没有道具 1 那一路。
- **为什么原版没这个问题**：原版是**逐格 tick** 走的，走的**过程**里
  `[0x498e72]`（= 替身记录 `+10`，`place`）一直是 **0**；只有走完、轮次交还主人时
  才被写成 3（`fcn_00418ebd`，VA 0x00418ebd：
  `if ([0x49910c] != 8) …; [0x49910c] = [0x498e70]; if ([0x498e72] == 0) [0x498e72] = 3`）。
  本引擎 core 一次动作走完整趟，中间态**不存在**，所以只能拿宿主喂进来的
  `ActorWalk` 现算。
- **处置（已做，纯表现）**：
  - `render.ts` 的 `ActorTokenOptions` 新增 `walkingOffBoard(slot)`：不在盘上、
    但这一帧还在播补间时，由宿主给出「当前那一格的**落点节点 + 朝向**」，
    照常出一个**走姿** token。`#actorSlots` 从补间现算（`#actorWalkScreen` 多返回
    `nodeId` / `direction`；后者走 core 的 `directionOf`，与 exe 的
    `_rich4_calculate_direction` VA 0x00454fb4 同一套）。补间播完 → 回调返回
    null → 娃娃直接消失，**这就是原版的「收场」**。
  - `ActorWalkStep` 增加 `fromNode` / `toNode`（娃娃收场后 state 里已经查不到节点）。
  - 同一条路顺带修好**走回老家的惡人**（`place = 監獄/醫院` 那种，同一句判据挡着）。
  - 朝向 `actorWalkDirection(step)` = `directionOf(to − from)`，出处是 exe
    **逐格那一次** `fcn_00407a8c(来路, 落点)`（VA 0x0040c6f6..0x0040c719），
    不是把玩家那条搬过来的。参数顺序的坑见下面动画表的注。
- **测试**：`packages/client/src/doll-tool.test.ts` —— 纯函数（朝向 8 向、
  `fromNode/toNode`、`actorTokens` 的四种分支）＋ 端到端
  （`BoardRenderer.draw()` 在补间中途真的画了 `Data.mkf` `0x20a`、
  走完那一帧不再画、「動畫過程」关掉也不画）。

---

## ★ 取证清单（VA 逐条）

### 动画

| 项 | 值 | 出处 |
|---|---|---|
| 图组 | **站姿 `Data.mkf` 0x209（521）= 8 张（8 向各 1 帧）；走姿 `0x20a`（522）= 40 张（8 向 × 5 帧）** | VA 0x0040bf37 / 0x0040bf55（`_rich4_update_player_sprite` 的 actor 8 分支，写死，**不与 NPC 那套 `0x16c + actor×4` 连号**）|
| 步数 | **固定 9 步，不掷骰** | VA 0x0040deb9 `mov esi, 9` / 0x0040debe `[0x48baf8] = 9` |
| 节拍 | 与四大惡人同一条：**逐格** 补间，每格 tick 数 = `trunc(屏幕距离 × 0.125)`，一 tick 一帧 | VA 0x0040c5e6（`actorWalkSteps` 的注释里已有）|
| 收场 | **没有消失动画**：走完 → `fcn_00418ebd` 把 `[0x49910c]` 交还主人、`place`（`[0x498e72]`）写成 3，接着 `fcn_00415e70` 只是重画一次棋盘。所以「收场」= 下一帧不再画它 | VA 0x00418ebd / 0x00418ef3；`fcn_00415e70`（VA 0x00415e70 起）里没有精灵/音效调用 |
| 走在盘上 | 走的过程中 `place` 一直是 0（只有走完才被写成 3） | VA 0x00418ebd 的那一句 `cmp byte [0x498e72], 0 / jne`（非 0 才不动它）|
| 每格朝向 | **面朝去路**：每 tick 重算一次 `+9 direction` = `dir(来路 → 落点)`（与玩家那一支同向） | VA 0x0040c6f6..0x0040c719 —— `push [+4 落点] / push [+6 来路] / call fcn_00407a8c / mov [+9], al` |

> ⚠️ **读那两个 `push` 时踩过的坑（留给后来者）**：本工程的调用约定是
> **cdecl（参数从右往左压栈）**，所以 `push A / push B / call f` 里
> **B 才是第一个参数**。拿 `_memcpy` 一验就清楚：`push n / push src / push dst /
> call memcpy`（`rich4_sound_effect.asm:146`）与 `memcpy(dst, src, n)` 逐位对上。
> 于是娃娃那一处是 `fcn_00407a8c(来路, 落点)` = **面朝去路**。
> 我一开始按"先压的是第一个参数"读，得出"娃娃倒着走"，与玩家那一支、
> 与直觉都冲突；回 `_memcpy` 校正压栈方向后才定案（`render.ts` 的
> `actorWalkDirection` 注释里写全了）。同一个坑对
> `fcn_0040e033` 里那处 `fcn_00407a8c(邻格, 本格)` 也适用 ——
> **先压的是本格、第二参数才是邻格**，物件朝向因此是「背离第一个邻格」。

### 音效 —— **只用一声，38**

| 项 | 值 | 出处 |
|---|---|---|
| 哪一号 | **38** —— 移动音效表 `0x48234a` 的**第 9 项**（表里第一项就是音效号）| 表项 VA `0x482392`；代码 VA 0x0040ded3 `mov eax, 0x48234a / add eax, 0x48` |
| 什么时候放 | **用道具 1 的那一下**（娃娃上路、`fcn_0040dd1f` 的 actor 8 分支），**不是**走一格放一次 | VA 0x0040deb9..0x0040dedc |
| 走完那次「放音」是什么 | 是 **Stop** 不是 Play：`eax = [0x4749d4]×8 + 0x48234a; call fcn_004542e9`，而 `fcn_004542e9`（VA 0x004542e9）里调的是 `IDirectSoundBuffer::Stop`（vtable +0x48）。`[0x4749d4]` 正是 0x40decb 存下的 9 → 同一个 38 号 | VA 0x0040d8dc..0x0040d8ea |
| 逐格有音效吗 | **没有**。逐格那条音效（`fcn_0040d7c4` state 2，VA 0x0040d9f2）只由**玩家**掷骰那一步进入（写 state 2 的唯一一处在 `fcn_0040dd1f` 的 actor < 4 分支，VA 0x0040dd7e）；娃娃那一支起步就是 state 1，而逐格推进的 `fcn_0040c05c` 里没有任何放音调用 | 0x0040dd7e / 0x0040c05c |

### 音效落点（做了）

- `audio.ts` 的 `SOUND_IDS` 新增 **`DOLL: 38`**（带 `@source` 与上面那张表）。
- `main.ts` 的 `playSoundFor` 里新增一条：`after.lastNpcWalks` **换了身份**且
  含 `slot = 4` → `sound.play('Effect.mkf', SOUND_IDS.DOLL)`。
  用「数组身份 + 槽位」而不是「看替身记录」的理由写在代码注释里
  （记录前后都是「未出场」，认不出来；`lastNpcWalks` 是整体覆写）。
- 溯源测试：`packages/assets-pipeline/src/audio.test.ts` 直接读 `rich4.exe`
  数据段 `0x48234a + 9×8` 那 4 个字节，断言等于 `SOUND_IDS.DOLL`。

---

## ⚠️ 没解出 / 有意不做的

1. ~~**音效 38 的编号语义没验证**~~ —— **已由另一路取证解决**（写进 `audio.ts`
   的 `SOUND_IDS` 头注释）：`_rich4_init_sound_effect_info`（VA 0x00454176）就是
   拿表项的**第一个 dword** 去 `read_mkf(Effect.mkf, ecx)`
   （`00454186 mov ecx, [ebx]` / `00454199 call _read_mkf`），读到 `-1` 停 ——
   所以表项里的值**就是** `Effect.mkf` 的资源号，38 就是那一段音频本身。
   剩下的只有「没听过它到底像不像一台机器走路」（#38 确实是非空槽，
   见 `audio.test.ts` 对 99 个非空槽的体检）—— 这是**试听**层面的确认，不是取证缺口。
2. **`MOVE_SOUND` 那个「走一格放一次」的旧读法没动**。这一次顺带看清了：
   原版那个音效是**一次移动放一次**（`fcn_0040d7c4` 的 state 1 → 掷完骰开始走
   那一下，走完 `Stop`），不是逐格。本引擎 `main.ts` 的 `stepTick()` 是逐格放，
   与 exe 不一致 —— 但那一路**不是本条的授权范围**（玩家那条），且改动会影响
   所有人的走子听感，故**只登记不动**。谁做「走子音效」那张卡时把这条一并订正。
3. **`D-T047-2/3/4` 那三条仍然成立**（娃娃不受影响：它的图组是写死的两支，
   没有載具/夢遊变体），不重复登记。
4. **`D-T047-5`「一輪多个惡人并播」仍然成立**，与娃娃无关（娃娃一趟就一个）。
5. **没有实机画面可比对**：本轮是「照 exe 的判据与资源号」做出来的，
   浏览器里没有逐帧目视核过（授权里不许起 dev server）。取证依据是上面那张表。
