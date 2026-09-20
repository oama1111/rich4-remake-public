# `player_say`（VA 0x0044ef41）调用点 × 相邻演出调用（机械抽取）

> 由 `tools/speech-callsites.py` 生成，**不要手改**。窗口 = 调用点前后各 45 条指令（不跨函数）。
> 「前」列按**执行方向**从远到近排；线性窗口不解读跳转 —— 分支关系要回 `disasm.py va` 核对。

| # | 调用点 | 所在函数 | 实参（arg1, arg2, arg3；`player_say` 的 arg2 = 表情号） | 之前的演出调用（远→近） | 之后的演出调用（近→远） |
|---|---|---|---|---|---|
| 1 | `0x00407956` | `0x00407842` | `eax, 3, ebp` | — | `00407998` 播影片 play_flic |
| 2 | `0x0040ca51` | `0x0040c912` | `esi, 2, edi` | — | `0040caca` ★ player_say |
| 3 | `0x0040caca` | `0x0040c912` | `esi, 2, edi` | `0040ca51` ★ player_say | `0040cb4c` ★ player_say |
| 4 | `0x0040cb4c` | `0x0040c912` | `edi, 1, ebp` | `0040caca` ★ player_say | `0040cb98` 訊息框 notice(ms) |
| 5 | `0x0040d060` | `0x0040cd87` | `edi, 3, ecx` | — | — |
| 6 | `0x0040d249` | `0x0040cd87` | `ebx, 2, ecx` | — | — |
| 7 | `0x0040e659` | `0x0040e32c` | `ebx, 2, ecx` | — | — |
| 8 | `0x0040ecde` | `0x0040ec14` | `ecx, 3, esi` | `0040ec56` 神明台词窗 god_say<br>`0040ec60` 神明轉盤窗<br>`0040ec99` 付款 pay_money | — |
| 9 | `0x0040ef44` | `0x0040ef1b` | `eax, 2, edx` | — | `0040ef78` 播影片 play_flic<br>`0040ef8e` 神明台词窗 god_say<br>`0040ef98` 神明轉盤窗<br>`0040efd9` 付款 pay_money |
| 10 | `0x0040f00d` | `0x0040efe4` | `eax, 2, edi` | — | `0040f041` 播影片 play_flic<br>`0040f057` 神明台词窗 god_say<br>`0040f061` 神明轉盤窗<br>`0040f076` 付款 pay_money |
| 11 | `0x0040f0ac` | `0x0040f083` | `eax, 2, edx` | — | `0040f0e0` 播影片 play_flic<br>`0040f0f6` 神明台词窗 god_say<br>`0040f104` 镜头 view_to |
| 12 | `0x0040f17e` | `0x0040f155` | `eax, 2, esi` | — | `0040f1b2` 播影片 play_flic<br>`0040f1c8` 神明台词窗 god_say<br>`0040f1d6` 镜头 view_to |
| 13 | `0x0040f314` | `0x0040f2eb` | `eax, 2, esi` | — | `0040f348` 播影片 play_flic<br>`0040f35e` 神明台词窗 god_say |
| 14 | `0x0040f8ab` | `0x0040f381` | `edi, 0, ebp` | `0040f866` 镜头 view_to<br>`0040f878` 訊息框 notice(ms) | — |
| 15 | `0x0040fa1e` | `0x0040f8be` | `edi, 0, ebp` | `0040f9c9` 訊息框 notice(ms)<br>`0040f9e1` 音效 play_sfx<br>`0040f9ef` 镜头 view_to | `0040fa26` 播 0x20b 烟花 |
| 16 | `0x004154cf` | `0x00415215` | `edi, 0, esi` | `0041548e` 訊息框 notice(ms) | — |
| 17 | `0x00419a19` | `0x004198b9` | `esi, 0, edi` | `00419996` Yes/No 框<br>`004199d4` 镜头 view_to<br>`004199e3` 音效 play_sfx | `00419a21` 播 0x20b 烟花<br>`00419a6e` 音效 play_sfx |
| 18 | `0x0041ab5b` | `0x004198b9` | `esi, 0, ecx` | `0041aadf` 镜头 view_to<br>`0041ab10` 播影片 play_flic | `0041ab63` 播 0x20b 烟花<br>`0041abf0` 訊息框 notice(ms) |
| 19 | `0x0041ac1f` | `0x004198b9` | `esi, ebp, edi` | `0041abf0` 訊息框 notice(ms) | `0041acf7` 訊息框 notice(ms) |
| 20 | `0x0041b211` | `0x0041b211` | `ebx, 0, ecx` | — | — |
| 21 | `0x0041bb90` | `0x0041bb90` | `ebp, 0, edi` | — | — |
| 22 | `0x0041bcde` | `0x0041bb9d` | `edi, 0, edx` | `0041bc53` 訊息框 notice(ms)<br>`0041bc8a` 镜头 view_to<br>`0041bc9c` 訊息框 notice(ms) | — |
| 23 | `0x0041bf09` | `0x0041be5f` | `ebp, 1, ecx` | `0041bece` 播影片 play_flic | `0041bf4d` 镜头 view_to |
| 24 | `0x0041d6dd` | `0x0041d559` | `ebp, 3, edx` | `0041d6ae` 訊息框 notice(ms) | — |
| 25 | `0x0041d947` | `0x0041d89e` | `esi, 3, edx` | — | — |
| 26 | `0x004320a2` | `0x004320a2` | `ecx, 0, 0x46482f` | — | — |
| 27 | `0x0043d71c` | `0x0043d593` | `ebp, 2, edi` | `0043d6aa` 播影片 play_flic<br>`0043d6f1` 镜头 view_to | — |
| 28 | `0x0043edcb` | `0x0043ec3f` | `ebp, 2, edi` | `0043ed59` 播影片 play_flic<br>`0043eda0` 镜头 view_to | — |
| 29 | `0x00442118` | `0x004420d8` | `ecx, 3, ebx` | — | — |
| 30 | `0x00442225` | `0x004421b4` | `esi, 3, edi` | — | — |
| 31 | `0x00442313` | `0x004421b4` | `ebp, 1, edi` | — | `0044231b` 刷屏 refresh(清镜头标记) |
| 32 | `0x0044242f` | `0x00442325` | `ecx, 3, ebp` | — | `00442479` 付款 pay_money<br>`004424a7` ★ player_say<br>`004424af` 刷屏 refresh(清镜头标记) |
| 33 | `0x004424a7` | `0x00442325` | `esi, 1, edx` | `0044242f` ★ player_say<br>`00442479` 付款 pay_money | `004424af` 刷屏 refresh(清镜头标记) |
| 34 | `0x004425a8` | `0x00442325` | `ecx, 3, ebp` | — | `004425fb` 訊息框 notice(ms) |
| 35 | `0x00442777` | `0x00442622` | `ecx, 3, ebp` | — | `004427d9` 镜头 view_to |
| 36 | `0x0044287a` | `0x00442622` | `edx, 2, ecx` | — | — |
| 37 | `0x004429c5` | `0x00442622` | `ecx, 3, ebp` | — | `00442a27` 镜头 view_to |
| 38 | `0x00442c44` | `0x00442b02` | `ecx, 3, edx` | — | — |
| 39 | `0x00442d28` | `0x00442b02` | `edi, 2, esi` | — | — |
| 40 | `0x00442e5f` | `0x00442b02` | `ecx, 3, edx` | — | — |
| 41 | `0x00442fc1` | `0x00442f4d` | `ebp, 3, edi` | — | — |
| 42 | `0x00443061` | `0x00442f4d` | `edi, 0, ecx` | — | — |
| 43 | `0x00443120` | `0x0044309b` | `esi, 3, ecx` | — | `004431aa` ★ player_say |
| 44 | `0x004431aa` | `0x0044309b` | `esi, 3, edi` | `00443120` ★ player_say | `0044321b` 刷屏 refresh(清镜头标记) |
| 45 | `0x004432fe` | `0x00443225` | `ebp, 3, ecx` | — | `0044333d` ★ player_say |
| 46 | `0x0044333d` | `0x00443225` | `edx, 1, ecx` | `004432fe` ★ player_say | — |
| 47 | `0x00443427` | `0x00443225` | `ebp, 3, ecx` | — | `00443464` ★ player_say |
| 48 | `0x00443464` | `0x00443225` | `ebx, 1, edx` | `00443427` ★ player_say | — |
| 49 | `0x00443539` | `0x004434c0` | `esi, 3, edi` | — | — |
| 50 | `0x00443751` | `0x004436e0` | `ebx, 0, esi` | — | — |
| 51 | `0x0044398f` | `0x00443917` | `ebp, 0, edi` | — | — |
| 52 | `0x00443afb` | `0x00443917` | `edi, 1, ebp` | `00443a76` 镜头 view_to<br>`00443aaf` 播影片 play_flic | `00443b03` 刷屏 refresh(清镜头标记) |
| 53 | `0x00443b8a` | `0x00443b0f` | `ebp, 0, eax` | — | `00443c04` 镜头 view_to |
| 54 | `0x00443e28` | `0x00443b0f` | `esi, 1, ecx` | `00443da6` 镜头 view_to<br>`00443ddc` 播影片 play_flic | `00443e30` 刷屏 refresh(清镜头标记) |
| 55 | `0x00443e9c` | `0x00443e3d` | `ecx, 3, esi` | — | — |
| 56 | `0x00443f6e` | `0x00443e3d` | `esi, 1, edi` | — | `00443f76` 刷屏 refresh(清镜头标记) |
| 57 | `0x00444002` | `0x00443f80` | `ebp, 3, ecx` | — | `0044408f` ★ player_say |
| 58 | `0x0044408f` | `0x00443f80` | `esi, 3, ecx` | `00444002` ★ player_say | `004440c3` ★ player_say<br>`004440d2` 刷屏 refresh(清镜头标记) |
| 59 | `0x004440c3` | `0x00443f80` | `esi, 2, edx` | `0044408f` ★ player_say | `004440d2` 刷屏 refresh(清镜头标记) |
| 60 | `0x0044412a` | `0x004440ea` | `ecx, 3, ebx` | — | — |
| 61 | `0x0044424d` | `0x004441dc` | `ebx, 3, edi` | — | — |
| 62 | `0x00444356` | `0x004441dc` | `ebx, 1, ecx` | — | — |
| 63 | `0x00444534` | `0x004444bf` | `ebp, 3, edi` | — | — |
| 64 | `0x0044464a` | `0x004444bf` | `ebx, 1, edx` | `0044461c` 送監獄 send_to_prison | `0044467d` 送監獄 send_to_prison<br>`00444685` 刷屏 refresh(清镜头标记) |
| 65 | `0x0044471f` | `0x00444691` | `esi, 0, edi` | `004446b8` 镜头 view_to | — |
| 66 | `0x00444a1d` | `0x0044476a` | `edi, 0, esi` | `004449df` 訊息框 notice(ms) | `00444a4b` ★ player_say |
| 67 | `0x00444a4b` | `0x0044476a` | `ebx, 2, edi` | `004449df` 訊息框 notice(ms)<br>`00444a1d` ★ player_say | — |
| 68 | `0x00444b5e` | `0x00444a60` | `edi, 0, edx` | `00444af4` Yes/No 框 | `00444b98` ★ player_say<br>`00444ba0` 刷屏 refresh(清镜头标记) |
| 69 | `0x00444b98` | `0x00444a60` | `ecx, 1, edi` | `00444b5e` ★ player_say | `00444ba0` 刷屏 refresh(清镜头标记) |
| 70 | `0x00444753` | `0x00444bb2` | `?` | — | `00444bd9` 镜头 view_to |
| 71 | `0x00444e8a` | `0x00444e1a` | `ebp, 0, edi` | — | `00444eb6` 镜头 view_to |
| 72 | `0x00444f5b` | `0x00444f25` | `edx, 0, ecx` | — | `00444fdb` 訊息框 notice(ms) |
| 73 | `0x00445079` | `0x0044503f` | `ebx, 0, ecx` | — | — |
| 74 | `0x0044526b` | `0x004451f0` | `ebp, 0, esi` | — | — |
| 75 | `0x00445419` | `0x004451f0` | `ebx, 2, ecx` | `004453a4` 付款 pay_money<br>`004453ef` 訊息框 notice(ms) | `00445421` 刷屏 refresh(清镜头标记) |
| 76 | `0x004454a2` | `0x0044542d` | `edi, 0, esi` | — | — |
| 77 | `0x00445604` | `0x00445593` | `edi, 0, esi` | — | — |
| 78 | `0x00445788` | `0x00445710` | `ebp, 3, edi` | — | — |
| 79 | `0x004458cb` | `0x00445710` | `ebp, 0, edx` | — | `004458d3` 刷屏 refresh(清镜头标记) |
| 80 | `0x00445961` | `0x004458df` | `ebp, 3, ecx` | — | `004459ee` ★ player_say |
| 81 | `0x004459ee` | `0x004458df` | `esi, 3, ecx` | `00445961` ★ player_say | `00445a25` ★ player_say<br>`00445a34` 刷屏 refresh(清镜头标记) |
| 82 | `0x00445a25` | `0x004458df` | `esi, 2, edx` | `004459ee` ★ player_say | `00445a34` 刷屏 refresh(清镜头标记) |
| 83 | `0x00446bcc` | `0x00446baa` | `edx, 0, ecx` | — | `00446c5d` 音效 play_sfx |
| 84 | `0x00446f90` | `0x00446f05` | `esi, 0, edi` | `00446f67` 镜头 view_to | — |
| 85 | `0x004472ba` | `0x00447295` | `edx, 0, ecx` | — | `0044733c` 镜头 view_to |
| 86 | `0x00447aa1` | `0x004479d2` | `edi, 0, ebp` | `00447a78` 镜头 view_to | — |
| 87 | `0x00447af5` | `0x00447ace` | `edx, 0, ecx` | `004470ea` 刷屏 refresh(清镜头标记) | `00447b77` 镜头 view_to |
| 88 | `0x004494cd` | `0x004492a0` | `eax, 2, edx` | `0044947d` 播影片 play_flic | — |
| 89 | `0x0044a5c3` | `0x0044a453` | `ebx, 2, edi` | `0044a571` 播影片 play_flic | — |
| 90 | `0x0044ab19` | `0x0044a91e` | `eax, 2, ecx` | `0044aac2` 镜头 view_to | — |
| 91 | `0x0044bf9f` | `0x0044be16` | `ecx, 2, edx` | `0044bf36` 进帐 receive_money<br>`0044bf51` 镜头 view_to | — |
| 92 | `0x0044c5c5` | `0x0044c3b7` | `eax, 0, ebp` | `0044c585` 镜头 view_to | — |
| 93 | `0x0044ca30` | `0x0044c91f` | `ebx, 2, ecx` | — | — |
| 94 | `0x0044cb41` | `0x0044ca46` | `ebp, 2, edi` | `0044cabb` 镜头 view_to<br>`0044cacd` 訊息框 notice(ms)<br>`0044cb00` 镜头 view_to | — |
| 95 | `0x0044cc41` | `0x0044cb53` | `edi, 2, ebp` | `0044cbc3` 镜头 view_to<br>`0044cbde` 訊息框 notice(ms)<br>`0044cc11` 镜头 view_to | — |
| 96 | `0x0044d777` | `0x0044d677` | `ecx, 2, esi` | `0044d6e7` 镜头 view_to<br>`0044d702` 訊息框 notice(ms) | — |
| 97 | `0x0044d873` | `0x0044d783` | `ebx, 0, ecx` | `0044d822` 镜头 view_to<br>`0044d83f` 訊息框 notice(ms) | `0044d88c` 訊息框 notice(ms)<br>`0044d8c2` 送監獄 send_to_prison |
| 98 | `0x0044f2b5` | `0x0044f230` | `esi, 0, ecx` | — | — |
| 99 | `0x0044f347` | `0x0044f2c2` | `esi, 2, ecx` | — | — |
| 100 | `0x0044f420` | `0x0044f354` | `esi, 3, ecx` | — | — |
| 101 | `0x0044f4e0` | `0x0044f42d` | `esi, 2, ecx` | — | — |
| 102 | `0x0044f554` | `0x0044f4ed` | `edi, 1, ebp` | — | — |
| 103 | `0x0044f61a` | `0x0044f567` | `esi, 3, ecx` | — | — |
| 104 | `0x0044f6df` | `0x0044f627` | `ebx, ecx, esi` | — | — |

共 104 处。
