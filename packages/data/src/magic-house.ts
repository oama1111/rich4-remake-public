/*
 * 魔法屋的 12 个功能
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ **由脚本直接从 `Rich4/rich4.exe` 提取**：
 *   `_rich4_magic_house_function_info` @ VA 0x00475724，每项 16 字节：
 *   ```c
 *   struct { const char *name; int frames; int x; int y; };
 *   ```
 *   `+12`（即 `y`）在 `rich4_magic_house.asm` 里被反复读取
 *   （`mov ebx, [eax + 0x475724 + 12]`），是步长为 16 的直接证据。
 *
 * ⚠️ **只有名字与摆位是已验证的数据，效果本身尚未实现。**
 *   魔法屋的实现（`rich4_magic_house.asm`，2826 行）几乎全是转盘动画与
 *   窗口状态机（`[0x48c3a2]` 是 UI 阶段号，不是选中的功能号），
 *   十二个效果分别落在哪段代码尚未定位。
 *
 *   名字读起来都很直白（「立刻坐牢三天」「存入所有現金」），
 *   照着名字写十二个效果并不难——但那是**按中文猜规则**，
 *   不是移植。坐牢三天用的是不是 `confine` 的那套天数语义？
 *   「就地加蓋房屋」免不免费、吃不吃物价指数？都没有依据。
 *   故此处只落表，效果留空，由 `rules/interaction.ts` 明确报「未实现」。
 */

export interface MagicHouseOption {
  /** 转盘上的序号 0..11 */
  id: number;
  /** 原版名称（BIG5 解码后的繁体） */
  name: string;
  /**
   * 该选项图标的动画帧数 @source 结构体 +4
   * ⚠️ 「帧数」是按取值范围（6..10）与用途推断的，未在代码里确认。
   */
  frames: number;
  /** 转盘上的位置 @source 结构体 +8 / +12（640×480 屏幕坐标） */
  x: number;
  y: number;
}

/**
 * 十二个功能。
 *
 * ⚠️ 第 11 项（拍賣當格土地）的名字取自字符串池 0x0046481d——它紧跟在
 * 第 10 项之后，语义也与其余十一项同类；但表里 0x004757d4 那 16 字节
 * **不符合前十一项的字段模式**（后三个字段读出来是不合理的值），
 * 故其 frames/x/y 未采信，置 0 并标明。
 */
export const MAGIC_HOUSE_OPTIONS: readonly MagicHouseOption[] = [
  { id: 0, name: '變賣所有卡片', frames: 10, x: 510, y: 150 },
  { id: 1, name: '抽取命運三張', frames: 7, x: 545, y: 88 },
  { id: 2, name: '立刻坐牢三天', frames: 7, x: 568, y: 147 },
  { id: 3, name: '原地停留一回合', frames: 7, x: 550, y: 234 },
  { id: 4, name: '存入所有現金', frames: 7, x: 510, y: 320 },
  { id: 5, name: '就地加蓋房屋', frames: 7, x: 422, y: 320 },
  { id: 6, name: '得一張卡片', frames: 6, x: 134, y: 318 },
  { id: 7, name: '向後轉', frames: 6, x: 92, y: 250 },
  { id: 8, name: '變賣所有道具', frames: 6, x: 72, y: 130 },
  { id: 9, name: '就地拆除房屋', frames: 6, x: 77, y: 85 },
  { id: 10, name: '住院檢查三天', frames: 9, x: 122, y: 154 },
  // ⚠️ 见上方说明：名字可信，摆位未采信
  { id: 11, name: '拍賣當格土地', frames: 0, x: 0, y: 0 },
];

/** 魔法屋功能数 */
export const MAGIC_HOUSE_OPTION_COUNT = MAGIC_HOUSE_OPTIONS.length;
