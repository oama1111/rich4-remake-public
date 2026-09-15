// 大富翁4 重制版 · 桌面壳
// SPDX-License-Identifier: GPL-3.0-or-later
//
// ★ 这个壳**只做两件事**：开一个窗，以及把原版素材以 `rich4://` 协议
//   喂给前端。一条游戏规则都没有 —— 规则全在 `@rich4/core`，
//   前端与浏览器版是同一套代码。
//
// ★ **素材随包附带，双击即可运行**。mkf 归档与 25 首配乐打进
//   `Resources/game/`，启动时自动认。
//
// ⚠️ 仍保留「手动指定目录」这条路，但只作**兜底**：包内素材缺失
//   （例如从源码跑未打包的 dev 版）时才用得上。正常路径下用户
//   看不到任何选目录的界面。

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::http::{Response, StatusCode};
use tauri::{Manager, State};

/// 认定「这确实是大富翁4 的目录」所依据的文件。
///
/// ⚠️ 只认一个不够稳妥：用户可能把素材拆开放。这里要求**全都在**，
///   宁可多问一次，也不要让玩家在游戏跑起来之后才发现缺文件。
const REQUIRED_FILES: &[&str] = &["Data.mkf", "map.mkf", "Panel.mkf", "jump.mkf"];

/// 配置文件名（放在系统的应用配置目录里）
const CONFIG_FILE: &str = "settings.json";

#[derive(Default, Serialize, Deserialize)]
struct Settings {
    /// 原版安装目录
    game_dir: Option<String>,
}

#[derive(Default)]
struct AppState {
    game_dir: Mutex<Option<PathBuf>>,
}

/// 包内素材目录。
///
/// ⚠️ Tauri 的 `resources` 用**数组**形式时会保留源路径的相对结构，
///   `../../../assets/game/*.mkf` 落在 `<Resources>/_up_/_up_/_up_/assets/game/`。
///   这个 `_up_` 是 Tauri 对 `..` 的转写，不是笔误。
///   两种落点都试一遍，省得哪天换成映射形式又要改这里。
fn bundled_game_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let res = app.path().resource_dir().ok()?;
    let candidates = [
        res.join("game"),
        res.join("_up_").join("_up_").join("_up_").join("assets").join("game"),
        res.join("assets").join("game"),
    ];
    candidates.into_iter().find(|p| looks_like_game_dir(p))
}

/// 未打包时的兜底：从可执行文件往上找仓库里的 `assets/game`。
///
/// `cargo run` / `tauri dev` 跑的是 `target/debug/rich4-desktop`，
/// 那时没有 Resources 目录，但仓库就在旁边。
fn repo_game_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut dir = exe.parent()?.to_path_buf();
    for _ in 0..8 {
        let candidate = dir.join("assets").join("game");
        if looks_like_game_dir(&candidate) {
            return Some(candidate);
        }
        dir = dir.parent()?.to_path_buf();
    }
    None
}

fn config_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    let _ = fs::create_dir_all(&dir);
    Some(dir.join(CONFIG_FILE))
}

fn load_settings(app: &tauri::AppHandle) -> Settings {
    config_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_settings(app: &tauri::AppHandle, s: &Settings) {
    if let Some(p) = config_path(app) {
        if let Ok(text) = serde_json::to_string_pretty(s) {
            let _ = fs::write(p, text);
        }
    }
}

/// 目录里是不是真有原版素材
fn looks_like_game_dir(dir: &Path) -> bool {
    REQUIRED_FILES.iter().all(|f| dir.join(f).is_file())
}

/// 把前端的日志转到进程的 stderr。
///
/// ★ 桌面壳里没有浏览器的控制台，前端出了错**看不见**。
///   有这一条，`.app` 的 stderr 就是游戏日志，出问题时
///   `open -a ... --stderr` 或直接跑二进制就能看到。
#[tauri::command]
fn log_line(text: String) {
    eprintln!("[前端] {text}");
}

// ============================================================
//  存档槽（T-053）
// ============================================================

/// 存档目录：`<系统应用数据目录>/saves`，没有就建。
///
/// ★ 文件名沿用原版的 `SAVE<n>.DAT` 槽位编号，只是内容换成 JSON
///   （原版那种二进制存档要另写一套序列化，见 Q-SAVE-1）。
fn saves_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取应用数据目录失败：{e}"))?
        .join("saves");
    fs::create_dir_all(&dir).map_err(|e| format!("建存档目录失败：{e}"))?;
    Ok(dir)
}

fn save_path(app: &tauri::AppHandle, slot: u32) -> Result<PathBuf, String> {
    if slot > 63 {
        return Err(format!("槽号越界：{slot}"));
    }
    Ok(saves_dir(app)?.join(format!("SAVE{slot}.json")))
}

/// 读一个槽；不存在返回 `None`（空槽不是错误）。
#[tauri::command]
fn read_save(app: tauri::AppHandle, slot: u32) -> Option<String> {
    fs::read_to_string(save_path(&app, slot).ok()?).ok()
}

/// 写一个槽。
#[tauri::command]
fn write_save(app: tauri::AppHandle, slot: u32, json: String) -> Result<(), String> {
    let path = save_path(&app, slot)?;
    fs::write(&path, json).map_err(|e| format!("寫入 {} 失敗：{e}", path.display()))
}

/// 列出**存在**的槽号。
#[tauri::command]
fn list_saves(app: tauri::AppHandle) -> Vec<u32> {
    let Ok(dir) = saves_dir(&app) else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<u32> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            name.strip_prefix("SAVE")?
                .strip_suffix(".json")?
                .parse::<u32>()
                .ok()
        })
        .collect();
    out.sort_unstable();
    out
}

/// 当前记着的目录；没设过返回 null
#[tauri::command]
fn get_game_dir(state: State<'_, AppState>) -> Option<String> {
    state
        .game_dir
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|p| p.to_string_lossy().into_owned()))
}

/// 设一个目录。校验不过就把缺了哪些文件原样告诉前端。
#[tauri::command]
fn set_game_dir(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("不是一个目录：{path}"));
    }
    if !looks_like_game_dir(&dir) {
        let missing: Vec<&str> = REQUIRED_FILES
            .iter()
            .copied()
            .filter(|f| !dir.join(f).is_file())
            .collect();
        return Err(format!("这里不像大富翁4 的安装目录，缺少：{}", missing.join("、")));
    }

    if let Ok(mut g) = state.game_dir.lock() {
        *g = Some(dir.clone());
    }
    save_settings(
        &app,
        &Settings {
            game_dir: Some(dir.to_string_lossy().into_owned()),
        },
    );
    Ok(dir.to_string_lossy().into_owned())
}

/// 把 `rich4://localhost/<文件名>` 解析成真实路径。
///
/// ⚠️ **必须防目录穿越**：请求来自网页，`..` 与绝对路径一律拒绝。
///   只允许「目录下的普通文件名」这一种形状。
fn resolve(dir: &Path, url_path: &str) -> Option<PathBuf> {
    let decoded = percent_decode(url_path.trim_start_matches('/'));
    if decoded.is_empty() {
        return None;
    }
    let rel = PathBuf::from(&decoded);
    if rel
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return None;
    }
    let full = dir.join(rel);
    // 再核一次：规范化之后仍须落在 dir 内
    let canon_dir = dir.canonicalize().ok()?;
    let canon_full = full.canonicalize().ok()?;
    if !canon_full.starts_with(&canon_dir) {
        return None;
    }
    Some(canon_full)
}

/// 最小的 percent-decode —— 只为处理文件名里的空格之类
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header("Access-Control-Allow-Origin", "*")
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        // ★ 用自定义协议而不是 IPC 命令传素材：map.mkf 有 76MB，
        //   走 IPC 要先编码成 JSON 再解回来，内存与耗时都不可接受。
        //   协议这条路跟 HTTP 一样，前端 `fetch('rich4://localhost/map.mkf')` 即可。
        // ★ 用**异步**协议：map.mkf 有 73MB，同步处理器会把主线程堵住，
        //   窗口在读盘期间直接假死。异步版本把读盘扔到别的线程上。
        .register_asynchronous_uri_scheme_protocol("rich4", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || {
                let state = app.state::<AppState>();
                let dir = match state.game_dir.lock() {
                    Ok(g) => g.clone(),
                    Err(_) => None,
                };
                let Some(dir) = dir else {
                    eprintln!("[rich4] 还没有素材目录，拒绝 {}", request.uri());
                    responder.respond(not_found());
                    return;
                };
                let Some(file) = resolve(&dir, request.uri().path()) else {
                    eprintln!("[rich4] 路径不合法：{}", request.uri());
                    responder.respond(not_found());
                    return;
                };
                match fs::read(&file) {
                    Ok(bytes) => {
                        eprintln!("[rich4] {} → {} 字节", file.display(), bytes.len());
                        let res = Response::builder()
                            .status(StatusCode::OK)
                            .header("Content-Type", "application/octet-stream")
                            // ★ **必须给 CORS**：页面的 origin 是 `tauri://localhost`，
                            //   素材走的是 `rich4://localhost` —— 这是**跨源请求**。
                            //   少了这三行，fetch 会以一句笼统的 "Load failed" 失败，
                            //   看起来跟文件损坏一模一样，极难排查。
                            .header("Access-Control-Allow-Origin", "*")
                            .header("Access-Control-Allow-Methods", "GET, OPTIONS")
                            .header("Access-Control-Allow-Headers", "*")
                            // 素材是只读的，让 WebView 放心缓存
                            .header("Cache-Control", "public, max-age=31536000, immutable")
                            .body(bytes)
                            .unwrap_or_else(|_| not_found());
                        responder.respond(res);
                    }
                    Err(e) => {
                        eprintln!("[rich4] 读不到 {}：{e}", file.display());
                        responder.respond(not_found());
                    }
                }
            });
        })
        .setup(|app| {
            // 素材来源按这个顺序找，找到就用：
            //   1. 包内 Resources/game     —— 正常安装后的路径
            //   2. 仓库的 assets/game      —— 未打包直接 cargo run 时
            //   3. 用户上次手动指定的目录  —— 兜底
            let handle = app.handle().clone();
            let dir = bundled_game_dir(&handle)
                .or_else(repo_game_dir)
                .or_else(|| {
                    load_settings(&handle)
                        .game_dir
                        .map(PathBuf::from)
                        .filter(|p| looks_like_game_dir(p))
                });
            eprintln!(
                "[rich4] 素材目录 = {:?}（resource_dir = {:?}）",
                dir,
                handle.path().resource_dir().ok()
            );
            if let Ok(mut g) = app.state::<AppState>().game_dir.lock() {
                *g = dir;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_game_dir,
            set_game_dir,
            log_line,
            read_save,
            write_save,
            list_saves
        ])
        .run(tauri::generate_context!())
        .expect("启动失败");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 拒绝目录穿越() {
        let dir = Path::new("/tmp");
        assert!(resolve(dir, "/../etc/passwd").is_none());
        assert!(resolve(dir, "/a/../../etc/passwd").is_none());
        assert!(resolve(dir, "//etc/passwd").is_none());
        assert!(resolve(dir, "/").is_none());
    }

    #[test]
    fn percent_decode_基本可用() {
        assert_eq!(percent_decode("Data.mkf"), "Data.mkf");
        assert_eq!(percent_decode("a%20b.mkf"), "a b.mkf");
        assert_eq!(percent_decode("bad%zz"), "bad%zz");
    }
}
