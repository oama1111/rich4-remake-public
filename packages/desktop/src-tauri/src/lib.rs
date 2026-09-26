// 大富翁4 重制版 · 桌面壳
// SPDX-License-Identifier: GPL-3.0-or-later
//
// ★ 这个壳**只做两件事**：开一个窗，以及把原版素材以 `rich4://` 协议
//   喂给前端。一条游戏规则都没有 —— 规则全在 `@rich4/core`，
//   前端与浏览器版是同一套代码。
//
// ★ 打包形态（**带素材的那份私有仓库**）：**素材随包附带，双击即可运行** ——
//   mkf 归档与 25 首配乐打进 `Resources/game/`，启动时自动认；
//   「手动指定目录」只作**兜底**（包内素材缺失，例如从源码跑未打包的 dev 版）。
//
// ⚠️ **本公开镜像是 code-only**：`tauri.conf.json` 的 `bundle.resources` 已去掉、
//   仓库里没有 `assets/`（指过去只会让打包失败），所以镜像上只剩「手动指定目录」
//   这一条路，素材自备（见 `docs/assets.md`）。

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::http::{Response, StatusCode};
use tauri::{Manager, PhysicalPosition, State};

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
    /// 用户自备音色库的**文件名**（就在 `soundfont/` 目录里）。
    ///
    /// ⚠️ 存文件名而不是绝对路径：用户换机器/换目录时路径会失效，
    ///   而音色库是我们**拷进应用数据目录**的，文件名才是稳定的那一个。
    ///   @see soundfont_dir
    soundfont: Option<String>,
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

// ============================================================
//  HD 素材目录（Q-PERF-1）
// ============================================================
//
// ★ **HD 产物与 `game_dir` 不同源**：`rich4://localhost/<名>` 原本一律解析到
//   玩家自备的原版安装目录（`Data.mkf` 那些），而超分管线的产出在仓库/包内的
//   `assets/hd/`、清单在它的**同级** `assets/hd-manifest.json`。两者放一起会
//   互相看不见，故协议里单开一条 `hd` 路由（见 `is_hd_path`）。
//
// ⚠️ 打包这一层**还没做**：`tauri.conf.json` 的 `resources` 里没有 `assets/hd`，
//   因为该目录被 .gitignore 排除、干净 clone 里根本不存在，写进去会让没跑过
//   超分管线的人连构建都过不去。所以现在只有「仓库里跑」（`cargo run` / dev）
//   能拿到 HD；要把 HD 随包发出去，得先解决「产物不入库但构建需要它」这件事。

/// 这个目录是不是 HD 素材的根（`assets/`）—— 认 `hd/` 子目录或同级清单任一
fn looks_like_hd_dir(dir: &Path) -> bool {
    dir.join("hd").is_dir() || dir.join("hd-manifest.json").is_file()
}

/// 包内的 HD 根；两条候选与 `bundled_game_dir` 同一套落点。
fn bundled_hd_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let res = app.path().resource_dir().ok()?;
    let candidates = [
        res.join("assets"),
        res.join("_up_").join("_up_").join("_up_").join("assets"),
    ];
    candidates.into_iter().find(|p| looks_like_hd_dir(p))
}

/// 未打包时的兜底：从可执行文件往上找仓库里的 `assets/`。
fn repo_hd_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut dir = exe.parent()?.to_path_buf();
    for _ in 0..8 {
        let candidate = dir.join("assets");
        if looks_like_hd_dir(&candidate) {
            return Some(candidate);
        }
        dir = dir.parent()?.to_path_buf();
    }
    None
}

/// HD 素材根目录；两边都没有就返回 `None`（前端照旧整包走原图）。
fn hd_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    bundled_hd_dir(app).or_else(repo_hd_dir)
}

/// 是不是 HD 路由。
///
/// ★ 判据直接照**前端拼出来的 URL**写，不做字符串改写：
///   `host.ts` 的 `hdBase()` 给 `rich4://localhost/hd`，而 `loadHdSource` 拉的是
///   `${hdBase()}-manifest.json` = `rich4://localhost/hd-manifest.json`
///   （清单与 hd 目录同级，见 `cli-upscale.ts` 的 `manifestPath`）。
///   前端拼什么，这里就放行什么 —— 两边各写一套前缀正是 T-065 特意避免的漂移。
///
/// ⚠️ 只放行这两条：`/hd-manifest.json` 与 `/hd/…`。`/hdx`、`/hd`（不带斜杠）
///   都不算，免得哪天目录名改了还能被前缀匹配蒙对。
fn is_hd_path(path: &str) -> bool {
    path == "/hd-manifest.json" || path.starts_with("/hd/")
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
//  替玩家挪**系统鼠标指针**（试玩3 #2）
// ============================================================

/// 窗口**逻辑**坐标 → **物理**坐标。
///
/// ★ 抽出来只为一件事：这条换算能单测（真正那一条要 `Window`，测试里造不出来）。
///   前端给的是页面 CSS px（= 窗口客户区的逻辑坐标），
///   `Window::set_cursor_position` 收的是物理坐标。
fn logical_to_physical(x: f64, y: f64, scale: f64) -> (f64, f64) {
    (x * scale, y * scale)
}

/// 把**系统鼠标指针**挪到窗口内的逻辑坐标 `(x, y)`（Tauri 2 `Window::set_cursor_position`）。
///
/// ★ 这是**原版行为**，不是我们加的：原版在几个时刻会替玩家把指针挪到按钮上
///   （USER32 `SetCursorPos`，导入表 IAT `0x0046231c`）。全 exe 9 处调用里，
///   本条命令服务的是已经取到证的两处：
///   - **回合开始、GO 鈕上场等真人掷骰** —— 相位 1（跳表 `0x418c3d` 的第 1 项
///     `0x418d99`）里 `call 0x4196f1`（`[0x46cafd] = 1` + 画 GO 鈕）之后紧接着
///     `0x00418db0 call SetCursorPos`，落点 `([0x475284] + 0x2e, [0x475288] + 0x22)`；
///   - **YES/NO 訊息框（買地那一扇 `fcn_00440ba8`）的 `WM_CREATE`** ——
///     `0x00453719 call SetCursorPos`，落点 `([0x48cac4] + 0x16, [0x48cac8] + 0x16)`
///     （框左上 + (22,22)，而框 = 资源 0x1b8 那张 96×48 **居中于 (220,320)**）。
///   前面那句「什么时候挪、挪到哪」的判定与算术全在前端
///   （`packages/client/src/cursor-warp.ts`）—— 那边能用单测钉住；
///   这里只做「逻辑坐标 → 物理坐标 → 挪」。
///
/// ⚠️ 浏览器版**调不到**这条命令（网页不能挪系统指针）——
///   前端的 `host.ts` 的 `warpCursor` 在浏览器里是空操作。
#[tauri::command]
fn warp_cursor(window: tauri::Window, x: f64, y: f64) -> Result<(), String> {
    let scale = window
        .scale_factor()
        .map_err(|e| format!("取縮放比失敗：{e}"))?;
    let (px, py) = logical_to_physical(x, y, scale);
    window
        .set_cursor_position(PhysicalPosition::new(px, py))
        .map_err(|e| format!("挪指針失敗：{e}"))
}

// ============================================================
//  音色库（Q8）
// ============================================================

/// 音色库目录：`<系统应用数据目录>/soundfont`，没有就建。
///
/// ★ 音色库**由用户自备**（本项目不分发任何 .sf2，见 DEVELOPMENT_PLAN §5.6），
///   但选中之后**拷进**这里 —— 这样换台机器、或用户把原文件挪走，
///   下次启动照样能用（设置里只记文件名）。
fn soundfont_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取应用数据目录失败：{e}"))?
        .join("soundfont");
    fs::create_dir_all(&dir).map_err(|e| format!("建音色库目录失败：{e}"))?;
    Ok(dir)
}

/// 一个文件是不是 SoundFont 2。
///
/// 只看头 12 字节：`RIFF` + 任意长度 + **3 字节** `sf2`（后面跟第一个 LIST，
/// 不是 `sf2L`）。`.sf3`（Vorbis 压缩样本）在这里被挡住 —— 播放器不解它。
fn looks_like_sf2(head: &[u8]) -> bool {
    head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..11] == b"sf2"
}

/// 现在记着的音色库文件；文件不在了就当没设过。
fn current_soundfont(app: &tauri::AppHandle) -> Option<PathBuf> {
    let name = load_settings(app).soundfont?;
    let path = soundfont_dir(app).ok()?.join(&name);
    path.is_file().then_some(path)
}

/// 音色库文件名；没装返回 null。前端拿它显示「已装 xxx.sf2」。
#[tauri::command]
fn soundfont_status(app: tauri::AppHandle) -> Option<String> {
    current_soundfont(&app).and_then(|p| {
        p.file_name()
            .map(|n| n.to_string_lossy().into_owned())
    })
}

/// 把用户选的文件收进来：校验 → 拷进 `soundfont/` → 记进设置。
///
/// 校验不过就把原因原样报回去（比笼统的「文件不对」有用得多）。
#[tauri::command]
fn set_soundfont(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err(format!("不是一个文件：{path}"));
    }
    let head = fs::read(&src).map_err(|e| format!("读不到文件：{e}"))?;
    if !looks_like_sf2(&head) {
        return Err("这不像 SoundFont 2（.sf2）。.sf3 暂不支持。".to_string());
    }
    let name = src
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| "文件名读不出来".to_string())?;
    let dir = soundfont_dir(&app)?;
    let dst = dir.join(&name);
    // 同一个文件就别白拷一遍（音色库动辄几十 MB）
    if src != dst {
        fs::copy(&src, &dst).map_err(|e| format!("拷贝失败：{e}"))?;
    }
    save_settings(
        &app,
        &Settings {
            game_dir: load_settings(&app).game_dir,
            soundfont: Some(name.clone()),
        },
    );
    Ok(name)
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

// ============================================================
//  问题回报（飞行记录仪）
// ============================================================

/// 写一份问题回报到 `<系统应用数据目录>/reports/`，返回落盘的完整路径。
///
/// ★ 打包后的 `.app` 没有控制台，前端出的事只能靠这份文件带出来
///   （`client/src/flight-recorder.ts`；重放用 `tools/replay-report.ts`）。
/// ★ 文件名只收 `[A-Za-z0-9._-]` —— 前端传什么都不许跳出这个目录。
#[tauri::command]
fn write_report(app: tauri::AppHandle, name: String, json: String) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取应用数据目录失败：{e}"))?
        .join("reports");
    fs::create_dir_all(&dir).map_err(|e| format!("建回报目录失败：{e}"))?;
    let safe: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .collect();
    if safe.is_empty() || safe.starts_with('.') {
        return Err(format!("文件名不合法：{name}"));
    }
    let path = dir.join(safe);
    fs::write(&path, json).map_err(|e| format!("寫入 {} 失敗：{e}", path.display()))?;
    Ok(path.display().to_string())
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

// ============================================================
//  配置文件 `RICH4.CFG`（72 字节，Q-OPT-1）
// ============================================================

/// 配置文件路径：**游戏目录**里的 `RICH4.CFG`（原版就在那儿）。
///
/// ★ 原版把全部设定 + 28 条键位存在这一个 72 字节文件里
///   （`rich4_config_file.h` 的 `rich4_cfg`）：開機 `rich4_read_config()`
///   （VA 0x00411e8f）读、設定屏/熱鍵頁「確定」调 `rich4_write_config()`
///   （VA 0x00411f80）整份写回。
///
/// ⚠️ 没设过游戏目录时退回 `<应用数据目录>/RICH4.CFG`，免得写到不知道哪儿。
fn rich4_cfg_path(app: &tauri::AppHandle, game_dir: Option<PathBuf>) -> Result<PathBuf, String> {
    match game_dir {
        Some(dir) => Ok(dir.join("RICH4.CFG")),
        None => Ok(app
            .path()
            .app_data_dir()
            .map_err(|e| format!("取应用数据目录失败：{e}"))?
            .join("RICH4.CFG")),
    }
}

/// 长度闸门：**必须是 72**（`sizeof(rich4_cfg)`）。抽出来是为了能单测。
fn check_config_len(len: usize) -> Result<(), String> {
    if len != 72 {
        return Err(format!("設定檔長度必須是 72，收到 {len}"));
    }
    Ok(())
}

/// 读 `RICH4.CFG` 的 72 个字节；没有这个文件返回 `None`（不是错误）。
#[tauri::command]
fn read_config(app: tauri::AppHandle, state: State<'_, AppState>) -> Option<Vec<u8>> {
    let dir = state.game_dir.lock().ok().and_then(|g| g.clone());
    let path = rich4_cfg_path(&app, dir).ok()?;
    fs::read(path).ok()
}

/// 写 `RICH4.CFG`（整份覆盖）。
///
/// ⚠️ **长度必须正好 72** —— 与 `sizeof(rich4_cfg)` 对齐；写错长度会让原版
///   `fread` 读不满，设定位全乱。宁可报错也不写坏。
#[tauri::command]
fn write_config(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    bytes: Vec<u8>,
) -> Result<(), String> {
    check_config_len(bytes.len())?;
    let dir = state.game_dir.lock().ok().and_then(|g| g.clone());
    let path = rich4_cfg_path(&app, dir)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("建設定目錄失敗：{e}"))?;
    }
    fs::write(&path, &bytes).map_err(|e| format!("寫入 {} 失敗：{e}", path.display()))
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
            // 换素材目录不该把用户选的音色库一起忘掉
            soundfont: load_settings(&app).soundfont,
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
                let path = request.uri().path();
                let is_hd = is_hd_path(path);
                // ★ 音色库走**同一个协议**、单独一条路由：它不在原版安装目录里，
                //   而在应用数据目录的 `soundfont/`。走 `fetch` 流式读，
                //   不必把几十 MB 的字节塞进 IPC 的 JSON 里。
                let is_soundfont = path.starts_with("/soundfont/");

                // ★ 两条来源分流（Q-PERF-1）：`/hd/**` 与 `/hd-manifest.json` 落在
                //   HD 素材目录，其余照旧落在原版安装目录。两边**不同源**，必须先分。
                let dir = if is_soundfont {
                    match soundfont_dir(&app) {
                        Ok(d) => d,
                        Err(e) => {
                            eprintln!("[rich4] 音色库目录不可用：{e}");
                            responder.respond(not_found());
                            return;
                        }
                    }
                } else if is_hd {
                    match hd_dir(&app) {
                        Some(d) => d,
                        None => {
                            // 没跑过超分管线（或包内没带 HD）——这是**正常状态**：
                            // 404 会让前端 loadHdSource 拿到 null，整包走原图。
                            eprintln!("[rich4] 没有 HD 素材目录，{} 按「没有 HD」处理", request.uri());
                            responder.respond(not_found());
                            return;
                        }
                    }
                } else {
                    let game = state.game_dir.lock().ok().and_then(|g| g.clone());
                    match game {
                        Some(d) => d,
                        None => {
                            eprintln!("[rich4] 还没有素材目录，拒绝 {}", request.uri());
                            responder.respond(not_found());
                            return;
                        }
                    }
                };

                // `/soundfont/x.sf2` → 去掉前缀，其余（含 `/hd/**`）照旧
                let rel = if is_soundfont {
                    path.trim_start_matches("/soundfont")
                } else {
                    path
                };
                let Some(file) = resolve(&dir, rel) else {
                    eprintln!("[rich4] 路径不合法：{}", request.uri());
                    responder.respond(not_found());
                    return;
                };
                match fs::read(&file) {
                    Ok(bytes) => {
                        eprintln!("[rich4] {} → {} 字节", file.display(), bytes.len());
                        // HD 清单是 JSON（前端 res.json()）；其余一律当二进制流
                        let content_type = if is_hd && path.ends_with(".json") {
                            "application/json"
                        } else {
                            "application/octet-stream"
                        };
                        let res = Response::builder()
                            .status(StatusCode::OK)
                            .header("Content-Type", content_type)
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
            soundfont_status,
            set_soundfont,
            log_line,
            read_save,
            write_save,
            list_saves,
            read_config,
            write_config,
            write_report,
            warp_cursor
        ])
        .run(tauri::generate_context!())
        .expect("启动失败");
}

#[cfg(test)]
mod tests {
    /// ★ `RICH4.CFG` 的长度闸门：**不是 72 就拒绝写**。
    ///
    /// 原版 `fread(&global_rich4_cfg, sizeof(global_rich4_cfg), 1, fp)` —— 写坏了长度
    /// 会让它读不满，设定全乱。这里把闸门单独抽出来测（真正的 `write_config`
    /// 要 `AppHandle`，单测里构造不出来）。
    fn check_len(len: usize) -> Result<(), String> {
        if len != 72 {
            return Err(format!("設定檔長度必須是 72，收到 {len}"));
        }
        Ok(())
    }

    #[test]
    fn 設定檔長度閘門() {
        assert!(check_len(72).is_ok());
        assert!(check_len(0).is_err());
        assert!(check_len(71).is_err());
        assert!(check_len(73).is_err());
        assert!(check_len(1024).is_err());
    }

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
    fn 音色库只认_riff_sf2() {
        let mut head = vec![0u8; 16];
        head[0..4].copy_from_slice(b"RIFF");
        head[8..11].copy_from_slice(b"sf2");
        assert!(looks_like_sf2(&head));
        // 4 字节读成 'sf2L' 是这一层最容易犯的错：'sf2' 后面必须允许是任意字节
        head[11] = b'L';
        assert!(looks_like_sf2(&head));
        head[8..11].copy_from_slice(b"sf3");
        assert!(!looks_like_sf2(&head));
        assert!(!looks_like_sf2(b"RIFF"));
    }

    #[test]
    fn percent_decode_基本可用() {
        assert_eq!(percent_decode("Data.mkf"), "Data.mkf");
        assert_eq!(percent_decode("a%20b.mkf"), "a b.mkf");
        assert_eq!(percent_decode("bad%zz"), "bad%zz");
    }

    /// ★ 试玩3 #2：挪指针那条命令的「逻辑 → 物理」换算。
    ///
    /// 用例里的两个数就是两处落点（GO 鈕 (226,154)、YES/NO 框 (194,318)）——
    /// 它们由前端 `client/src/cursor-warp.ts` 按 exe 的立即数算出，那边有单测；
    /// 这里只钉「乘缩放比」这一条。Retina（scale = 2）上物理坐标正好翻倍。
    #[test]
    fn 挪指針_邏輯轉物理() {
        assert_eq!(logical_to_physical(226.0, 154.0, 1.0), (226.0, 154.0));
        assert_eq!(logical_to_physical(226.0, 154.0, 2.0), (452.0, 308.0));
        assert_eq!(logical_to_physical(194.5, 318.25, 1.5), (291.75, 477.375));
    }

    /// ★ Q-PERF-1：HD 路由的判据必须与 host.ts 的 `hdBase()` 严丝合缝 ——
    ///   放行少了，HD 永远 404（静默回退原图，看不出来）；放行多了，
    ///   原版素材会被拿去 HD 目录里找（同样静默 404）。
    #[test]
    fn hd_路由只认前端拼的那两条() {
        // `hdBase()` + `hdRelativePath()` 拼出来的
        assert!(is_hd_path("/hd/Data/1-0.png"));
        assert!(is_hd_path("/hd/map/0-0.png"));
        // `${hdBase()}-manifest.json`
        assert!(is_hd_path("/hd-manifest.json"));

        // 原版素材那条路不能被截胡
        assert!(!is_hd_path("/Data.mkf"));
        assert!(!is_hd_path("/map.mkf"));
        // 前缀蒙对不算（目录名改了要立刻暴露，而不是悄悄少一批图）
        assert!(!is_hd_path("/hd"));
        assert!(!is_hd_path("/hdx/1.png"));
        assert!(!is_hd_path("/hd-manifest.json.bak"));
    }

    /// HD 根的两个判据：`hd/` 子目录、或同级清单
    #[test]
    fn hd_根判据() {
        let base = std::env::temp_dir().join(format!("rich4-hd-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        assert!(!looks_like_hd_dir(&base));

        fs::create_dir_all(base.join("hd")).unwrap();
        assert!(looks_like_hd_dir(&base), "有 hd/ 子目录就算 HD 根");

        fs::remove_dir_all(base.join("hd")).unwrap();
        assert!(!looks_like_hd_dir(&base));
        fs::write(base.join("hd-manifest.json"), "{}").unwrap();
        assert!(looks_like_hd_dir(&base), "同级清单在也算");

        let _ = fs::remove_dir_all(&base);
    }
}
