// SPDX-License-Identifier: GPL-3.0-or-later
// 发布版不要额外开一个控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    rich4_desktop_lib::run()
}
