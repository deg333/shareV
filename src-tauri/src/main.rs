#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::{
    collections::HashMap,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Mutex,
    },
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tokio::sync::oneshot;
use image::{codecs::jpeg::JpegEncoder, ImageFormat, RgbaImage};

// ------------------------------------------------------------------ settings
#[derive(Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
struct Hotkeys {
    fullscreen: String,
    region: String,
    window: String,
    last_region: String,
}
impl Default for Hotkeys {
    fn default() -> Self {
        Self {
            fullscreen: "CommandOrControl+PrintScreen".into(),
            region: "PrintScreen".into(),
            window: "Alt+PrintScreen".into(),
            last_region: "CommandOrControl+Shift+PrintScreen".into(),
        }
    }
}

/// Last selected region, in capture-image pixels relative to the monitor it was taken on.
#[derive(Serialize, Deserialize, Clone)]
struct LastRegion {
    mon_x: i32,
    mon_y: i32,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default, rename_all = "camelCase")]
struct Settings {
    hotkeys: Hotkeys,
    save_dir: Option<String>,
    copy_to_clipboard: bool,
    last_region: Option<LastRegion>,
}

struct Editor {
    payload: Option<String>, // PNG data URL waiting to be fetched by `editor_init`
    path: Option<PathBuf>,
    empty: bool,
}
struct Overlay {
    url: String,
    tx: Option<oneshot::Sender<Option<RegionIn>>>,
}
struct Shared {
    data_dir: PathBuf,
    settings: Mutex<Settings>,
    editors: Mutex<HashMap<String, Editor>>,
    overlay: Mutex<Option<Overlay>>,
    busy: AtomicBool,
    counter: AtomicU32,
}

#[derive(Deserialize)]
struct RegionIn {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    vw: f64, // overlay viewport width in CSS px; used to map CSS px -> image px
}

fn shared(app: &AppHandle) -> tauri::State<'_, Shared> {
    app.state::<Shared>()
}

fn save_settings(sh: &Shared) {
    let s = sh.settings.lock().unwrap().clone();
    if let Ok(txt) = serde_json::to_string_pretty(&s) {
        let _ = fs::write(sh.data_dir.join("settings.json"), txt);
    }
}

fn save_dir(sh: &Shared) -> PathBuf {
    let dir = sh
        .settings
        .lock()
        .unwrap()
        .save_dir
        .clone()
        .map(PathBuf::from)
        .unwrap_or_else(|| sh.data_dir.join("Screenshots"));
    let _ = fs::create_dir_all(&dir);
    dir
}

fn resolve_data_dir(app: &tauri::App) -> PathBuf {
    if let Some(base) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        let d = base.join("ShareV-Data");
        let probe = d.join(".w");
        if fs::create_dir_all(&d).is_ok() && fs::write(&probe, b"").is_ok() {
            let _ = fs::remove_file(probe);
            return d;
        }
    }
    let d = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("ShareV"));
    let _ = fs::create_dir_all(&d);
    d
}

fn stamp() -> String {
    chrono::Local::now().format("ShareV_%Y-%m-%d_%H-%M-%S").to_string()
}

// ------------------------------------------------------------------ image helpers
fn png_url(img: &RgbaImage) -> Result<String, String> {
    let mut buf = Cursor::new(Vec::new());
    img.write_to(&mut buf, ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(format!("data:image/png;base64,{}", B64.encode(buf.into_inner())))
}
fn jpeg_url(img: &RgbaImage) -> Result<String, String> {
    let rgb = image::DynamicImage::ImageRgba8(img.clone()).to_rgb8();
    let mut buf = Vec::new();
    JpegEncoder::new_with_quality(&mut buf, 90).encode_image(&rgb).map_err(|e| e.to_string())?;
    Ok(format!("data:image/jpeg;base64,{}", B64.encode(buf)))
}
fn decode_url(url: &str) -> Result<Vec<u8>, String> {
    let b64 = url.split_once(',').map(|x| x.1).ok_or("bad data URL")?;
    B64.decode(b64).map_err(|e| e.to_string())
}
fn crop(img: &RgbaImage, x: u32, y: u32, w: u32, h: u32) -> Option<RgbaImage> {
    let x = x.min(img.width().saturating_sub(1));
    let y = y.min(img.height().saturating_sub(1));
    let w = w.min(img.width() - x);
    let h = h.min(img.height() - y);
    (w > 0 && h > 0).then(|| image::imageops::crop_imm(img, x, y, w, h).to_image())
}

// ------------------------------------------------------------------ capture
struct Shot {
    img: RgbaImage,
    mx: i32,
    my: i32,
}

fn cursor_point(app: &AppHandle) -> Option<(i32, i32)> {
    app.cursor_position().ok().map(|p| (p.x as i32, p.y as i32))
}

/// Capture the monitor at `point` (or the first one). Runs on a worker thread: xcap monitors are not `Send`.
fn shot_at_point(point: Option<(i32, i32)>) -> Result<Shot, String> {
    let mon = match point.and_then(|(x, y)| xcap::Monitor::from_point(x, y).ok()) {
        Some(m) => m,
        None => xcap::Monitor::all().map_err(|e| e.to_string())?.into_iter().next().ok_or("No monitor found")?,
    };
    let img = mon.capture_image().map_err(|e| e.to_string())?;
    Ok(Shot { img, mx: mon.x().unwrap_or(0), my: mon.y().unwrap_or(0) })
}

fn shot_by_origin(mx: i32, my: i32) -> Result<Shot, String> {
    let mons = xcap::Monitor::all().map_err(|e| e.to_string())?;
    let mon = mons
        .iter()
        .find(|m| m.x().unwrap_or(i32::MIN) == mx && m.y().unwrap_or(i32::MIN) == my)
        .or_else(|| mons.first())
        .ok_or("No monitor found")?;
    let img = mon.capture_image().map_err(|e| e.to_string())?;
    Ok(Shot { img, mx: mon.x().unwrap_or(0), my: mon.y().unwrap_or(0) })
}

fn active_window_image() -> Option<RgbaImage> {
    let wins = xcap::Window::all().ok()?;
    let me = std::process::id();
    let usable = |w: &xcap::Window| {
        !w.is_minimized().unwrap_or(true) && w.width().unwrap_or(0) > 40 && w.height().unwrap_or(0) > 40
    };
    let pick = wins
        .iter()
        .find(|w| usable(w) && w.is_focused().unwrap_or(false) && w.pid().unwrap_or(0) != me)
        // focus can be momentarily nowhere right after our window hid: use the top-most real window
        .or_else(|| {
            wins.iter().find(|w| {
                usable(w) && w.pid().unwrap_or(0) != me && !w.title().unwrap_or_default().is_empty()
            })
        })?;
    pick.capture_image().ok()
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

async fn capture_inner(app: &AppHandle, mode: &str) -> Result<Option<RgbaImage>, String> {
    let point = cursor_point(app);
    match mode {
        "full" => Ok(Some(blocking(move || shot_at_point(point)).await??.img)),
        "window" => {
            if let Some(img) = blocking(active_window_image).await? {
                return Ok(Some(img));
            }
            Ok(Some(blocking(move || shot_at_point(point)).await??.img))
        }
        "lastRegion" if shared(app).settings.lock().unwrap().last_region.is_some() => {
            let lr = shared(app).settings.lock().unwrap().last_region.clone().unwrap();
            let shot = blocking(move || shot_by_origin(lr.mon_x, lr.mon_y)).await??;
            Ok(crop(&shot.img, lr.x, lr.y, lr.w, lr.h))
        }
        _ => region(app, point).await,
    }
}

async fn region(app: &AppHandle, point: Option<(i32, i32)>) -> Result<Option<RgbaImage>, String> {
    let Shot { img: full, mx, my } = blocking(move || shot_at_point(point)).await??;
    let (mw, mh) = (full.width(), full.height());
    let (tx, rx) = oneshot::channel();
    *shared(app).overlay.lock().unwrap() = Some(Overlay { url: jpeg_url(&full)?, tx: Some(tx) });
    let data_dir = shared(app).data_dir.join("webview");
    let win = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("overlay/overlay.html".into()))
        .data_directory(data_dir)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    // xcap reports points on macOS and physical pixels elsewhere
    #[cfg(target_os = "macos")]
    {
        let _ = win.set_position(tauri::LogicalPosition::new(mx as f64, my as f64));
        let _ = win.set_size(tauri::LogicalSize::new(mw as f64, mh as f64));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = win.set_position(tauri::PhysicalPosition::new(mx, my));
        let _ = win.set_size(tauri::PhysicalSize::new(mw, mh));
    }
    let _ = win.show();
    let _ = win.set_focus();

    let rect = rx.await.ok().flatten();
    let _ = win.destroy();
    *shared(app).overlay.lock().unwrap() = None;

    let Some(r) = rect else { return Ok(None) };
    let scale = full.width() as f64 / r.vw.max(1.0);
    let (x, y) = ((r.x * scale).round().max(0.0) as u32, (r.y * scale).round().max(0.0) as u32);
    let (w, h) = ((r.w * scale).round() as u32, (r.h * scale).round() as u32);
    let out = crop(&full, x, y, w, h);
    if let Some(o) = &out {
        shared(app).settings.lock().unwrap().last_region =
            Some(LastRegion { mon_x: mx, mon_y: my, x, y, w: o.width(), h: o.height() });
        save_settings(&shared(app));
    }
    Ok(out)
}

async fn do_capture(app: AppHandle, mode: String) {
    if shared(&app).busy.swap(true, Ordering::SeqCst) {
        return;
    }
    let hidden: Vec<WebviewWindow> = app
        .webview_windows()
        .into_values()
        .filter(|w| w.is_visible().unwrap_or(false))
        .collect();
    for w in &hidden {
        let _ = w.hide();
    }
    tokio::time::sleep(Duration::from_millis(350)).await;
    let result = capture_inner(&app, &mode).await;
    for w in &hidden {
        let _ = w.show();
    }
    shared(&app).busy.store(false, Ordering::SeqCst);

    match result {
        Ok(Some(img)) => {
            if shared(&app).settings.lock().unwrap().copy_to_clipboard {
                let _ = app.clipboard().write_image(&Image::new_owned(img.clone().into_raw(), img.width(), img.height()));
            }
            match png_url(&img) {
                Ok(url) => open_editor(&app, Some(url)),
                Err(e) => error_box(&app, &e),
            }
        }
        Ok(None) => {}
        Err(e) => error_box(&app, &e),
    }
}

fn error_box(app: &AppHandle, msg: &str) {
    app.dialog().message(msg).title("ShareV").kind(MessageDialogKind::Error).show(|_| {});
}

fn spawn_capture(app: &AppHandle, mode: &str) {
    let (app, mode) = (app.clone(), mode.to_string());
    tauri::async_runtime::spawn(async move { do_capture(app, mode).await });
}

// ------------------------------------------------------------------ editor windows
fn open_editor(app: &AppHandle, payload: Option<String>) {
    let sh = shared(app);
    {
        let mut eds = sh.editors.lock().unwrap();
        if let Some(url) = &payload {
            // reuse a blank editor window instead of opening another one
            let blank = eds.iter().find(|(l, e)| e.empty && app.get_webview_window(l).is_some()).map(|(l, _)| l.clone());
            if let Some(label) = blank {
                let ed = eds.get_mut(&label).unwrap();
                ed.empty = false;
                ed.payload = Some(url.clone());
                let _ = app.emit_to(label.as_str(), "editor-load", json!({ "dataURL": url }));
                if let Some(w) = app.get_webview_window(&label) {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                return;
            }
        } else if let Some((label, _)) = eds.iter().find(|(l, e)| e.empty && app.get_webview_window(l).is_some()) {
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.show();
                let _ = w.set_focus();
                return;
            }
        }
    }
    let label = format!("editor-{}", sh.counter.fetch_add(1, Ordering::SeqCst));
    sh.editors.lock().unwrap().insert(
        label.clone(),
        Editor { empty: payload.is_none(), payload, path: None },
    );
    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("editor/index.html".into()))
        .title("ShareV")
        .inner_size(1280.0, 860.0)
        .min_inner_size(760.0, 480.0)
        .data_directory(sh.data_dir.join("webview"))
        .build();
    if let Err(e) = built {
        sh.editors.lock().unwrap().remove(&label);
        error_box(app, &format!("Could not open editor: {e}"));
    }
}

#[tauri::command]
async fn capture(app: AppHandle, mode: String) {
    spawn_capture(&app, &mode);
}

#[tauri::command]
async fn editor_init(app: AppHandle, window: WebviewWindow) -> Option<Value> {
    let sh = shared(&app);
    let eds = sh.editors.lock().unwrap();
    eds.get(window.label()).and_then(|e| e.payload.clone()).map(|u| json!({ "dataURL": u }))
}

#[tauri::command]
async fn editor_state(app: AppHandle, window: WebviewWindow, empty: bool) {
    if let Some(e) = shared(&app).editors.lock().unwrap().get_mut(window.label()) {
        e.empty = empty;
    }
}

#[tauri::command]
async fn editor_title(window: WebviewWindow, title: String) {
    let _ = window.set_title(&title);
}

#[tauri::command]
async fn save_svg(app: AppHandle, window: WebviewWindow, svg: String, save_as: bool) -> Result<Option<String>, String> {
    let label = window.label().to_string();
    let existing = shared(&app).editors.lock().unwrap().get(&label).and_then(|e| e.path.clone());
    let target = match existing {
        Some(p) if !save_as => p,
        _ => {
            let dir = save_dir(&shared(&app));
            let a = app.clone();
            let picked = blocking(move || {
                a.dialog()
                    .file()
                    .add_filter("SVG image", &["svg"])
                    .set_directory(dir)
                    .set_file_name(format!("{}.svg", stamp()))
                    .blocking_save_file()
            })
            .await?;
            match picked.and_then(|p| p.into_path().ok()) {
                Some(p) => p,
                None => return Ok(None),
            }
        }
    };
    fs::write(&target, svg).map_err(|e| e.to_string())?;
    if let Some(e) = shared(&app).editors.lock().unwrap().get_mut(&label) {
        e.path = Some(target.clone());
    }
    Ok(Some(target.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn export_png(app: AppHandle, data_url: String) -> Result<Option<String>, String> {
    let dir = save_dir(&shared(&app));
    let a = app.clone();
    let picked = blocking(move || {
        a.dialog()
            .file()
            .add_filter("PNG image", &["png"])
            .set_directory(dir)
            .set_file_name(format!("{}.png", stamp()))
            .blocking_save_file()
    })
    .await?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    fs::write(&path, decode_url(&data_url)?).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn copy_png(app: AppHandle, data_url: String) -> Result<bool, String> {
    let img = image::load_from_memory(&decode_url(&data_url)?).map_err(|e| e.to_string())?.to_rgba8();
    app.clipboard()
        .write_image(&Image::new_owned(img.clone().into_raw(), img.width(), img.height()))
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
async fn open_file(app: AppHandle, window: WebviewWindow) -> Result<Option<Value>, String> {
    let dir = save_dir(&shared(&app));
    let a = app.clone();
    let picked = blocking(move || {
        a.dialog()
            .file()
            .add_filter("Images", &["svg", "png", "jpg", "jpeg", "bmp", "webp"])
            .set_directory(dir)
            .blocking_pick_file()
    })
    .await?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if ext == "svg" {
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        if let Some(e) = shared(&app).editors.lock().unwrap().get_mut(window.label()) {
            e.path = Some(path);
        }
        return Ok(Some(json!({ "kind": "svg", "text": text, "name": name })));
    }
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        _ => "image/png",
    };
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Some(json!({ "kind": "image", "dataURL": format!("data:{mime};base64,{}", B64.encode(bytes)), "name": name })))
}

// ------------------------------------------------------------------ OCR (Windows.Media.Ocr, built into Windows 10/11)
#[derive(Serialize)]
struct OcrLine {
    text: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}
#[derive(Serialize)]
struct OcrOut {
    lines: Vec<OcrLine>,
    language: String,
}

#[cfg(windows)]
fn ocr_impl(png: Vec<u8>) -> Result<OcrOut, String> {
    use windows::{
        Graphics::Imaging::{BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat},
        Media::Ocr::OcrEngine,
        Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
        Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
    };
    let e = |x: windows::core::Error| x.to_string();
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED); // harmless if this thread is already initialised
    }
    let engine = OcrEngine::TryCreateFromUserProfileLanguages().map_err(|_| {
        "No OCR language is installed. Add a language in Windows Settings > Time & language > Language & region.".to_string()
    })?;
    // the engine refuses very large images: scale down, then map coordinates back
    let max = OcrEngine::MaxImageDimension().unwrap_or(2600) as f64;
    let img = image::load_from_memory(&png).map_err(|x| x.to_string())?;
    let scale = (max / img.width().max(img.height()) as f64).min(1.0);
    let bytes = if scale < 1.0 {
        let small = img.resize(
            (img.width() as f64 * scale) as u32,
            (img.height() as f64 * scale) as u32,
            image::imageops::FilterType::Lanczos3,
        );
        let mut buf = Cursor::new(Vec::new());
        small.write_to(&mut buf, ImageFormat::Png).map_err(|x| x.to_string())?;
        buf.into_inner()
    } else {
        png
    };

    let stream = InMemoryRandomAccessStream::new().map_err(e)?;
    let writer = DataWriter::CreateDataWriter(&stream).map_err(e)?;
    writer.WriteBytes(&bytes).map_err(e)?;
    writer.StoreAsync().map_err(e)?.get().map_err(e)?;
    writer.FlushAsync().map_err(e)?.get().map_err(e)?;
    writer.DetachStream().map_err(e)?;
    stream.Seek(0).map_err(e)?;
    let decoder = BitmapDecoder::CreateAsync(&stream).map_err(e)?.get().map_err(e)?;
    let bmp = decoder
        .GetSoftwareBitmapConvertedAsync(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Premultiplied)
        .map_err(e)?
        .get()
        .map_err(e)?;
    let result = engine.RecognizeAsync(&bmp).map_err(e)?.get().map_err(e)?;

    let mut lines = Vec::new();
    for line in result.Lines().map_err(e)? {
        let text = line.Text().map_err(e)?.to_string();
        let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for w in line.Words().map_err(e)? {
            let r = w.BoundingRect().map_err(e)?;
            x0 = x0.min(r.X as f64);
            y0 = y0.min(r.Y as f64);
            x1 = x1.max((r.X + r.Width) as f64);
            y1 = y1.max((r.Y + r.Height) as f64);
        }
        if text.trim().is_empty() || x0 > x1 {
            continue;
        }
        lines.push(OcrLine { text, x: x0 / scale, y: y0 / scale, w: (x1 - x0) / scale, h: (y1 - y0) / scale });
    }
    let language = engine.RecognizerLanguage().and_then(|l| l.DisplayName()).map(|s| s.to_string()).unwrap_or_default();
    Ok(OcrOut { lines, language })
}

#[cfg(not(windows))]
fn ocr_impl(_png: Vec<u8>) -> Result<OcrOut, String> {
    Err("Text recognition uses the built-in Windows OCR engine and is only available on Windows 10/11.".into())
}

#[tauri::command]
async fn ocr(data_url: String) -> Result<OcrOut, String> {
    let bytes = decode_url(&data_url)?;
    blocking(move || ocr_impl(bytes)).await?
}

#[tauri::command]
async fn copy_text(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
async fn ui_load(app: AppHandle) -> Option<String> {
    fs::read_to_string(shared(&app).data_dir.join("ui-settings.json")).ok()
}

#[tauri::command]
async fn ui_save(app: AppHandle, json: String) -> Result<(), String> {
    fs::write(shared(&app).data_dir.join("ui-settings.json"), json).map_err(|e| e.to_string())
}

#[tauri::command]
async fn ui_export(app: AppHandle, json: String) -> Result<Option<String>, String> {
    let dir = shared(&app).data_dir.clone();
    let a = app.clone();
    let picked = blocking(move || {
        a.dialog()
            .file()
            .add_filter("ShareV settings", &["json"])
            .set_directory(dir)
            .set_file_name("ShareV-settings.json")
            .blocking_save_file()
    })
    .await?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn ui_import(app: AppHandle) -> Result<Option<String>, String> {
    let dir = shared(&app).data_dir.clone();
    let a = app.clone();
    let picked = blocking(move || {
        a.dialog().file().add_filter("ShareV settings", &["json"]).set_directory(dir).blocking_pick_file()
    })
    .await?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_folder(app: AppHandle) {
    let dir = save_dir(&shared(&app));
    open_path(&dir);
}

fn open_path(p: &Path) {
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let cmd = "xdg-open";
    let _ = std::process::Command::new(cmd).arg(p).spawn();
}

#[tauri::command]
async fn overlay_init(app: AppHandle) -> Option<Value> {
    shared(&app).overlay.lock().unwrap().as_ref().map(|o| json!({ "url": o.url }))
}

#[tauri::command]
async fn overlay_done(app: AppHandle, rect: Option<RegionIn>) {
    if let Some(tx) = shared(&app).overlay.lock().unwrap().as_mut().and_then(|o| o.tx.take()) {
        let _ = tx.send(rect);
    }
}

// ------------------------------------------------------------------ tray + hotkeys
fn build_tray(app: &tauri::App, hk: &Hotkeys) -> tauri::Result<()> {
    let h = app.handle();
    let item = |id: &str, text: String| MenuItem::with_id(h, id, text, true, None::<&str>);
    let menu = Menu::with_items(
        h,
        &[
            &item("full", format!("Capture full screen  ({})", hk.fullscreen))?,
            &item("window", format!("Capture active window  ({})", hk.window))?,
            &item("region", format!("Capture region  ({})", hk.region))?,
            &item("lastRegion", format!("Capture last region  ({})", hk.last_region))?,
            &PredefinedMenuItem::separator(h)?,
            &item("editor", "Open editor".into())?,
            &item("shots", "Open screenshots folder".into())?,
            &item("data", "Open data folder (settings.json)".into())?,
            &PredefinedMenuItem::separator(h)?,
            &item("quit", "Quit".into())?,
        ],
    )?;
    let mut tray = TrayIconBuilder::new()
        .tooltip("ShareV")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "full" | "window" | "region" | "lastRegion" => spawn_capture(app, ev.id().as_ref()),
            "editor" => {
                let a = app.clone();
                tauri::async_runtime::spawn(async move { open_editor(&a, None) });
            }
            "shots" => open_path(&save_dir(&shared(app))),
            "data" => open_path(&shared(app).data_dir),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                let a = tray.app_handle().clone();
                tauri::async_runtime::spawn(async move { open_editor(&a, None) });
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}


// ------------------------------------------------------------------ Windows: PrintScreen via a low-level keyboard hook
// RegisterHotKey (what the global-shortcut plugin uses) cannot reliably claim PrintScreen / Alt+PrintScreen:
// Windows' Snipping Tool and shell own them. A WH_KEYBOARD_LL hook sees the key first and can swallow it.
#[cfg(windows)]
mod winhook {
    use std::sync::OnceLock;
    use tauri::AppHandle;
    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
        VK_CONTROL, VK_MENU, VK_SHIFT, VK_SNAPSHOT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, KBDLLHOOKSTRUCT, MSG,
        WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
    };

    pub struct Binding {
        pub ctrl: bool,
        pub alt: bool,
        pub shift: bool,
        pub mode: String,
    }
    static APP: OnceLock<AppHandle> = OnceLock::new();
    static BINDINGS: OnceLock<Vec<Binding>> = OnceLock::new();

    /// Parse e.g. "CommandOrControl+Shift+PrintScreen"; returns None unless the key is PrintScreen.
    pub fn parse(acc: &str, mode: &str) -> Option<Binding> {
        let mut b = Binding { ctrl: false, alt: false, shift: false, mode: mode.to_string() };
        let mut is_ps = false;
        for tok in acc.split('+') {
            match tok.trim().to_ascii_lowercase().as_str() {
                "ctrl" | "control" | "commandorcontrol" | "cmdorctrl" | "commandorctrl" | "cmd" | "command" => b.ctrl = true,
                "alt" | "option" => b.alt = true,
                "shift" => b.shift = true,
                "printscreen" | "prtsc" | "prtscr" | "snapshot" => is_ps = true,
                _ => return None,
            }
        }
        is_ps.then_some(b)
    }

    unsafe fn tap_dummy_key() {
        // A key between Alt-down and Alt-up stops Windows from treating it as a lone Alt tap (menu-bar focus).
        let mk = |flags| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(0xFF), wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
        };
        let inputs = [mk(Default::default()), mk(KEYEVENTF_KEYUP)];
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }

    unsafe extern "system" fn proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            let k = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            if k.vkCode == VK_SNAPSHOT.0 as u32 {
                let held = |vk: VIRTUAL_KEY| (GetAsyncKeyState(vk.0 as i32) as u16) & 0x8000 != 0;
                let (c, a, s) = (held(VK_CONTROL), held(VK_MENU), held(VK_SHIFT));
                if let Some(b) = BINDINGS.get().and_then(|v| v.iter().find(|b| b.ctrl == c && b.alt == a && b.shift == s)) {
                    let w = wparam.0 as u32;
                    if w == WM_KEYDOWN || w == WM_SYSKEYDOWN {
                        if b.alt {
                            tap_dummy_key();
                        }
                        if let Some(app) = APP.get() {
                            super::spawn_capture(app, &b.mode);
                        }
                    }
                    return LRESULT(1); // swallow down and up so Snipping Tool / the shell never see it
                }
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    pub fn install(app: AppHandle, bindings: Vec<Binding>) {
        if bindings.is_empty() {
            return;
        }
        let _ = APP.set(app);
        let _ = BINDINGS.set(bindings);
        std::thread::spawn(|| unsafe {
            let hmod = GetModuleHandleW(None).ok().map(|h| HINSTANCE(h.0));
            if let Err(e) = SetWindowsHookExW(WH_KEYBOARD_LL, Some(proc), hmod, 0) {
                if let Some(app) = APP.get() {
                    super::log(&super::shared(app), &format!("keyboard hook failed: {e}"));
                }
                return;
            }
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
    }
}

fn log(sh: &Shared, msg: &str) {
    use std::io::Write;
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(sh.data_dir.join("log.txt")) {
        let _ = writeln!(f, "{} {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), msg);
    }
}

fn register_hotkeys(app: &AppHandle, hk: &Hotkeys) {
    let list = [
        (&hk.fullscreen, "full"),
        (&hk.region, "region"),
        (&hk.window, "window"),
        (&hk.last_region, "lastRegion"),
    ];
    // On Windows, PrintScreen combinations go through the low-level hook (see `winhook`).
    #[cfg(windows)]
    let hooked: Vec<winhook::Binding> = list.iter().filter_map(|(acc, mode)| winhook::parse(acc, mode)).collect();
    #[cfg(windows)]
    let hooked_modes: Vec<String> = hooked.iter().map(|b| b.mode.clone()).collect();
    #[cfg(windows)]
    winhook::install(app.clone(), hooked);

    for (acc, mode) in list {
        if acc.is_empty() {
            continue;
        }
        #[cfg(windows)]
        if hooked_modes.iter().any(|m| m == mode) {
            continue;
        }
        let mode = mode.to_string();
        let res = app.global_shortcut().on_shortcut(acc.as_str(), move |app, _sc, ev| {
            if ev.state() == ShortcutState::Pressed {
                spawn_capture(app, &mode);
            }
        });
        if let Err(e) = res {
            log(&shared(app), &format!("could not register hotkey {acc}: {e}"));
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                let label = window.label();
                let app = window.app_handle();
                if label == "overlay" {
                    // closed without a selection (e.g. Alt+F4): release the waiting capture
                    if let Some(tx) = shared(app).overlay.lock().unwrap().as_mut().and_then(|o| o.tx.take()) {
                        let _ = tx.send(None);
                    }
                } else {
                    shared(app).editors.lock().unwrap().remove(label);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            capture, editor_init, editor_state, editor_title, save_svg, export_png, copy_png, open_file,
            open_folder, overlay_init, overlay_done, ui_load, ui_save, ui_export, ui_import, ocr, copy_text
        ])
        .setup(|app| {
            let data_dir = resolve_data_dir(app);
            let settings_file = data_dir.join("settings.json");
            let mut settings: Settings = fs::read_to_string(&settings_file)
                .ok()
                .and_then(|t| serde_json::from_str(&t).ok())
                .unwrap_or_default();
            // the defaults used to be PrintScreen = full screen, Ctrl+PrintScreen = region: swap those, leave custom ones alone
            if settings.hotkeys.fullscreen == "PrintScreen" && settings.hotkeys.region == "CommandOrControl+PrintScreen" {
                settings.hotkeys.fullscreen = "CommandOrControl+PrintScreen".into();
                settings.hotkeys.region = "PrintScreen".into();
            }
            let hk = settings.hotkeys.clone();
            app.manage(Shared {
                data_dir,
                settings: Mutex::new(settings),
                editors: Mutex::new(HashMap::new()),
                overlay: Mutex::new(None),
                busy: AtomicBool::new(false),
                counter: AtomicU32::new(1),
            });
            save_settings(&shared(app.handle()));
            let tray_ok = build_tray(app, &hk).is_ok();
            register_hotkeys(app.handle(), &hk);
            if !std::env::args().any(|a| a == "--tray") || !tray_ok {
                let h = app.handle().clone();
                tauri::async_runtime::spawn(async move { open_editor(&h, None) });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building ShareV")
        .run(|_app, event| {
            // keep running in the tray after the last window closes
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
