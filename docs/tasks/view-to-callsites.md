# `view_to`（VA 0x0041d476）调用点 × 相邻演出调用（机械抽取）

> 由 `tools/speech-callsites.py` 生成，**不要手改**。窗口 = 调用点前后各 45 条指令（不跨函数）。
> 「前」列按**执行方向**从远到近排；线性窗口不解读跳转 —— 分支关系要回 `disasm.py va` 核对。

| # | 调用点 | 所在函数 | 实参（arg1, arg2, arg3；`player_say` 的 arg2 = 表情号） | 之前的演出调用（远→近） | 之后的演出调用（近→远） |
|---|---|---|---|---|---|
| 1 | `0x0040b678` | `0x0040b4f8` | `0, 0, 1` | — | — |
| 2 | `0x0040b851` | `0x0040b4f8` | `0, 0, 1` | — | `0040b8bc` 镜头 view_to |
| 3 | `0x0040b8bc` | `0x0040b4f8` | `0, 0, 1` | `0040b851` 镜头 view_to | — |
| 4 | `0x0040d3e6` | `0x0040d375` | `eax, eax, 0` | — | `0040d3f8` 坏消息台词阶梯 say_bad |
| 5 | `0x0040e384` | `0x0040e32c` | `eax, eax, 4` | — | — |
| 6 | `0x0040eb4d` | `0x0040ead7` | `0, 0, 1` | — | — |
| 7 | `0x0040eddf` | `0x0040ed8f` | `0, 0, 1` | `0040edbb` 播影片 play_flic<br>`0040edd1` 神明台词窗 god_say | `0040ee2f` 訊息框 notice(ms)<br>`0040ee46` 好消息台词阶梯 say_good |
| 8 | `0x0040eea0` | `0x0040ee50` | `0, 0, 1` | `0040ee7c` 播影片 play_flic<br>`0040ee92` 神明台词窗 god_say | `0040eef3` 訊息框 notice(ms) |
| 9 | `0x0040f104` | `0x0040f083` | `0, 0, 1` | `0040f0ac` ★ player_say<br>`0040f0e0` 播影片 play_flic<br>`0040f0f6` 神明台词窗 god_say | `0040f148` 訊息框 notice(ms) |
| 10 | `0x0040f1d6` | `0x0040f155` | `0, 0, 1` | `0040f17e` ★ player_say<br>`0040f1b2` 播影片 play_flic<br>`0040f1c8` 神明台词窗 god_say | — |
| 11 | `0x0040f427` | `0x0040f381` | `eax, edx` | — | `0040f47f` 訊息框 notice(ms)<br>`0040f4d9` 訊息框 notice(ms) |
| 12 | `0x0040f506` | `0x0040f381` | `0, 0, 1` | `0040f47f` 訊息框 notice(ms)<br>`0040f4d9` 訊息框 notice(ms)<br>`0040f4f8` 音效 play_sfx | `0040f517` 播 0x20b 烟花 |
| 13 | `0x0040f5fe` | `0x0040f381` | `eax, edx` | — | `0040f610` 訊息框 notice(ms)<br>`0040f675` 播影片 play_flic |
| 14 | `0x0040f866` | `0x0040f381` | `eax, edx` | — | `0040f878` 訊息框 notice(ms)<br>`0040f8ab` ★ player_say |
| 15 | `0x0040f8ee` | `0x0040f8be` | `0, 0, 1` | — | `0040f975` 訊息框 notice(ms) |
| 16 | `0x0040f9ef` | `0x0040f8be` | `0, 0, 1` | `0040f975` 訊息框 notice(ms)<br>`0040f9c9` 訊息框 notice(ms)<br>`0040f9e1` 音效 play_sfx | `0040fa1e` ★ player_say<br>`0040fa26` 播 0x20b 烟花 |
| 17 | `0x00418d22` | `0x00418c55` | `edi, edi, 1` | `00418ca9` 播影片 play_flic | `00418d69` 刷屏 refresh(清镜头标记) |
| 18 | `0x004199d4` | `0x004198b9` | `0, 0, 1` | `00419996` Yes/No 框 | `004199e3` 音效 play_sfx<br>`00419a19` ★ player_say<br>`00419a21` 播 0x20b 烟花<br>`00419a6e` 音效 play_sfx |
| 19 | `0x0041a0e7` | `0x004198b9` | `0, 0, 1` | `0041a0ab` Yes/No 框 | `0041a0f6` 音效 play_sfx |
| 20 | `0x0041a27f` | `0x004198b9` | `eax, eax, 1` | — | `0041a28e` 音效 play_sfx<br>`0041a31e` Yes/No 框 |
| 21 | `0x0041a92f` | `0x004198b9` | `0, 0, 1` | `0041a8ec` Yes/No 框 | `0041a93e` 音效 play_sfx |
| 22 | `0x0041aadf` | `0x004198b9` | `ecx, edx, 0` | `0041aa62` 訊息框 notice(ms) | `0041ab10` 播影片 play_flic<br>`0041ab5b` ★ player_say<br>`0041ab63` 播 0x20b 烟花 |
| 23 | `0x0041ad75` | `0x004198b9` | `edi, ecx, 0` | `0041acf7` 訊息框 notice(ms) | `0041ad99` 播影片 play_flic<br>`0041adb4` 播 0x20b 烟花 |
| 24 | `0x0041b0ab` | `0x0041a3be` | `0, 0, 1` | — | — |
| 25 | `0x0041b946` | `0x0041b8f9` | `0, 0, 1` | `0041b92e` 音效 play_sfx | `0041b972` 訊息框 notice(ms)<br>`0041b98b` 好消息台词阶梯 say_good<br>`0041b9c6` 镜头 view_to |
| 26 | `0x0041b9c6` | `0x0041b8f9` | `0, 0, 1` | `0041b92e` 音效 play_sfx<br>`0041b946` 镜头 view_to<br>`0041b972` 訊息框 notice(ms)<br>`0041b98b` 好消息台词阶梯 say_good | `0041ba3c` 訊息框 notice(ms)<br>`0041ba71` 音效 play_sfx |
| 27 | `0x0041baa8` | `0x0041b8f9` | `eax, ecx` | `0041ba3c` 訊息框 notice(ms)<br>`0041ba71` 音效 play_sfx | `0041bad4` 訊息框 notice(ms)<br>`0041bafa` 好消息台词阶梯 say_good |
| 28 | `0x0041bb41` | `0x0041bb0c` | `0, 0, 1` | `0041bb29` 音效 play_sfx | `0041bb53` 訊息框 notice(ms) |
| 29 | `0x0041bbdd` | `0x0041bb9d` | `0, 0, 1` | `0041bbc5` 音效 play_sfx | `0041bc53` 訊息框 notice(ms)<br>`0041bc8a` 镜头 view_to |
| 30 | `0x0041bc8a` | `0x0041bb9d` | `eax, ecx` | `0041bbdd` 镜头 view_to<br>`0041bc53` 訊息框 notice(ms) | `0041bc9c` 訊息框 notice(ms)<br>`0041bcde` ★ player_say |
| 31 | `0x0041bd26` | `0x0041bceb` | `0, 0, 1` | — | — |
| 32 | `0x0041bf4d` | `0x0041be5f` | `0, 0, 1` | `0041bece` 播影片 play_flic<br>`0041bf09` ★ player_say | `0041bfc3` 訊息框 notice(ms) |
| 33 | `0x0041c044` | `0x0041bfd2` | `0, 0, 1` | — | — |
| 34 | `0x0041c458` | `0x0041c161` | `eax, eax, 1` | `0041c415` 訊息框 notice(ms)<br>`0041c43a` 音效 play_sfx | — |
| 35 | `0x00432050` | `0x00431f67` | `edx, eax, 0` | `00432003` 訊息框 notice(ms) | `00432074` 播影片 play_flic<br>`0043208f` 播 0x20b 烟花 |
| 36 | `0x004321de` | `0x00432160` | `0, 0, 1` | `004321c1` 訊息框 notice(ms) | — |
| 37 | `0x00432341` | `0x00432259` | `ecx, edx, 0` | `004322f5` 訊息框 notice(ms) | `00432360` 播影片 play_flic |
| 38 | `0x00437aa9` | `0x004379c9` | `0, 0, -1` | `00437a0b` 訊息框 notice(ms) | — |
| 39 | `0x0043c766` | `0x0043bde5` | `edx, eax, 4` | — | — |
| 40 | `0x0043c826` | `0x0043bde5` | `0, 0, 1` | — | `0043c855` 付款 pay_money |
| 41 | `0x0043d5cc` | `0x0043d593` | `eax, eax` | — | `0043d5f9` 坏消息台词阶梯 say_bad |
| 42 | `0x0043d6f1` | `0x0043d593` | `eax, eax` | `0043d6aa` 播影片 play_flic | `0043d71c` ★ player_say |
| 43 | `0x0043ec78` | `0x0043ec3f` | `eax, eax` | — | `0043eca5` 坏消息台词阶梯 say_bad |
| 44 | `0x0043eda0` | `0x0043ec3f` | `eax, eax` | `0043ed59` 播影片 play_flic | `0043edcb` ★ player_say |
| 45 | `0x004427d9` | `0x00442622` | `0, 0, 1` | `00442777` ★ player_say | — |
| 46 | `0x00442a27` | `0x00442622` | `0, 0, 1` | `004429c5` ★ player_say | — |
| 47 | `0x004436c6` | `0x004434c0` | `0, 0, 1` | — | `004436d4` 播 0x20b 烟花 |
| 48 | `0x00445584` | `0x004436e0` | `0, 0, 1` | — | — |
| 49 | `0x00443a76` | `0x00443917` | `ebp, ebx, 0` | — | `00443aaf` 播影片 play_flic<br>`00443afb` ★ player_say |
| 50 | `0x00443c04` | `0x00443b0f` | `eax, eax, 0` | `00443b8a` ★ player_say | — |
| 51 | `0x00443cd0` | `0x00443b0f` | `eax, eax, 0` | — | — |
| 52 | `0x00443da6` | `0x00443b0f` | `0, 0, 1` | — | `00443ddc` 播影片 play_flic<br>`00443e28` ★ player_say<br>`00443e30` 刷屏 refresh(清镜头标记) |
| 53 | `0x004441cf` | `0x004440ea` | `0, 0, 1` | — | — |
| 54 | `0x004446b8` | `0x00444691` | `eax, eax` | — | `0044471f` ★ player_say |
| 55 | `0x00444799` | `0x0044476a` | `eax, eax` | — | — |
| 56 | `0x00444a8a` | `0x00444a60` | `eax, eax` | — | `00444af4` Yes/No 框 |
| 57 | `0x00444bd9` | `0x00444bb2` | `eax, eax` | `00444753` ★ player_say | — |
| 58 | `0x00444eb6` | `0x00444e1a` | `0, 0, 1` | `00444e8a` ★ player_say | — |
| 59 | `0x0044607a` | `0x00445e4d` | `esi, ebx, 0` | — | — |
| 60 | `0x00446f67` | `0x00446f05` | `0, 0, 1` | — | `00446f90` ★ player_say |
| 61 | `0x0044733c` | `0x00447295` | `edx, eax, 0` | `004472ba` ★ player_say | `0044735c` 播影片 play_flic<br>`00447373` 播 0x20b 烟花<br>`00447378` 刷屏 refresh(清镜头标记) |
| 62 | `0x0044756a` | `0x0044755a` | `0, 0, 1` | — | — |
| 63 | `0x00447a78` | `0x004479d2` | `0, 0, 1` | — | `00447aa1` ★ player_say |
| 64 | `0x00447b77` | `0x00447ace` | `edx, eax, 0` | `00447af5` ★ player_say | `00447ba0` 播影片 play_flic<br>`00447bf5` 送醫院 send_to_hospital |
| 65 | `0x0044921d` | `0x0044913d` | `eax, ebp, 2` | — | `0044925b` 播影片 play_flic<br>`00449285` 送醫院 send_to_hospital<br>`00449290` 刷屏 refresh(清镜头标记) |
| 66 | `0x0044943e` | `0x004492a0` | `esi, ebx, 2` | — | `0044947d` 播影片 play_flic |
| 67 | `0x004495ef` | `0x004494e0` | `eax, eax, 2` | — | — |
| 68 | `0x004496c3` | `0x004494e0` | `eax, eax, 2` | — | — |
| 69 | `0x00449a44` | `0x004498b3` | `eax, edx` | — | `00449a5c` 进帐 receive_money |
| 70 | `0x0044a32f` | `0x0044a220` | `eax, eax, 2` | — | — |
| 71 | `0x0044a403` | `0x0044a220` | `eax, eax, 2` | — | — |
| 72 | `0x0044a52e` | `0x0044a453` | `edx, eax, 2` | — | `0044a571` 播影片 play_flic |
| 73 | `0x0044a7ef` | `0x0044a6e0` | `eax, eax, 2` | — | — |
| 74 | `0x0044a8aa` | `0x0044a6e0` | `eax, eax, 2` | — | `0044a8fe` 镜头 view_to |
| 75 | `0x0044a8fe` | `0x0044a6e0` | `0, 0, 1` | `0044a8aa` 镜头 view_to | — |
| 76 | `0x0044aa75` | `0x0044a91e` | `esi, ebx, 2` | — | `0044aac2` 镜头 view_to |
| 77 | `0x0044aac2` | `0x0044a91e` | `0, 0, 1` | `0044aa75` 镜头 view_to | `0044ab19` ★ player_say |
| 78 | `0x0044ac33` | `0x0044ab2c` | `esi, ebx, 2` | — | `0044ac71` 播影片 play_flic |
| 79 | `0x0044aded` | `0x0044ac99` | `esi, ebx, 2` | — | `0044ae2c` 播影片 play_flic |
| 80 | `0x0044b343` | `0x0044b25b` | `eax, edx` | — | `0044b362` 送監獄 send_to_prison |
| 81 | `0x0044bee8` | `0x0044be16` | `eax, eax, 2` | — | `0044bf36` 进帐 receive_money<br>`0044bf51` 镜头 view_to |
| 82 | `0x0044bf51` | `0x0044be16` | `0, 0, 1` | `0044bee8` 镜头 view_to<br>`0044bf36` 进帐 receive_money | `0044bf9f` ★ player_say |
| 83 | `0x0044c080` | `0x0044bfb1` | `eax, eax, 2` | — | `0044c0c6` 进帐 receive_money |
| 84 | `0x0044c19c` | `0x0044c0e8` | `0, 0, 3` | — | `0044c1ae` 訊息框 notice(ms)<br>`0044c1c3` 镜头 view_to<br>`0044c1d5` 訊息框 notice(ms) |
| 85 | `0x0044c1c3` | `0x0044c0e8` | `0, 0, 3` | `0044c19c` 镜头 view_to<br>`0044c1ae` 訊息框 notice(ms) | `0044c1d5` 訊息框 notice(ms) |
| 86 | `0x0044c298` | `0x0044c229` | `0, 0, 3` | — | `0044c2aa` 訊息框 notice(ms) |
| 87 | `0x0044c585` | `0x0044c3b7` | `0, 0, 3` | — | `0044c5c5` ★ player_say |
| 88 | `0x0044c66f` | `0x0044c5d8` | `0, 0, 3` | — | `0044c68c` 訊息框 notice(ms)<br>`0044c6a8` 訊息框 notice(ms) |
| 89 | `0x0044c784` | `0x0044c6ed` | `0, 0, 3` | — | `0044c7a1` 訊息框 notice(ms)<br>`0044c7ba` 訊息框 notice(ms) |
| 90 | `0x0044c88c` | `0x0044c7ef` | `0, 0, 3` | — | `0044c89e` 訊息框 notice(ms) |
| 91 | `0x0044c98f` | `0x0044c91f` | `0, 0, 3` | — | `0044c9aa` 訊息框 notice(ms) |
| 92 | `0x0044cabb` | `0x0044ca46` | `0, 0, 3` | — | `0044cacd` 訊息框 notice(ms)<br>`0044cb00` 镜头 view_to<br>`0044cb41` ★ player_say |
| 93 | `0x0044cb00` | `0x0044ca46` | `0, 0, 3` | `0044cabb` 镜头 view_to<br>`0044cacd` 訊息框 notice(ms) | `0044cb41` ★ player_say |
| 94 | `0x0044cbc3` | `0x0044cb53` | `0, 0, 3` | — | `0044cbde` 訊息框 notice(ms)<br>`0044cc11` 镜头 view_to<br>`0044cc41` ★ player_say |
| 95 | `0x0044cc11` | `0x0044cb53` | `0, 0, 1` | `0044cbc3` 镜头 view_to<br>`0044cbde` 訊息框 notice(ms) | `0044cc41` ★ player_say |
| 96 | `0x0044cceb` | `0x0044cc53` | `0, 0, 3` | — | `0044cd08` 訊息框 notice(ms)<br>`0044cd24` 訊息框 notice(ms)<br>`0044cd65` 送醫院 send_to_hospital |
| 97 | `0x0044ce4c` | `0x0044cd99` | `0, 0, 3` | — | `0044ce69` 訊息框 notice(ms)<br>`0044ce9a` 訊息框 notice(ms)<br>`0044cec2` 付款 pay_money |
| 98 | `0x0044cff6` | `0x0044cf1e` | `0, 0, 3` | — | `0044d013` 訊息框 notice(ms)<br>`0044d041` 訊息框 notice(ms) |
| 99 | `0x0044d189` | `0x0044d0d6` | `0, 0, 3` | — | — |
| 100 | `0x0044d2c0` | `0x0044d224` | `0, 0, 3` | — | `0044d2dd` 訊息框 notice(ms)<br>`0044d2f9` 訊息框 notice(ms)<br>`0044d31f` 进帐 receive_money |
| 101 | `0x0044d6e7` | `0x0044d677` | `0, 0, 3` | — | `0044d702` 訊息框 notice(ms)<br>`0044d777` ★ player_say |
| 102 | `0x0044d822` | `0x0044d783` | `0, 0, 3` | — | `0044d83f` 訊息框 notice(ms)<br>`0044d873` ★ player_say<br>`0044d88c` 訊息框 notice(ms)<br>`0044d8c2` 送監獄 send_to_prison |
| 103 | `0x0044efbd` | `0x0044ef41` | `eax, edx, 0` | — | — |
| 104 | `0x0045268e` | `0x00452444` | `eax, eax, 0` | `00452601` 播影片 play_flic | — |

共 104 处。
