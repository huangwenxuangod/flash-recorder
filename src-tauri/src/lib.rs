use std::{
    collections::{HashMap, VecDeque},
    env,
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use std::sync::atomic::{AtomicBool, Ordering};
use serde::{Deserialize, Serialize};
use tauri::{async_runtime, Emitter, Manager, State};
use tokio::net::UdpSocket;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::rtp::packet::Packet;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use webrtc::track::track_local::TrackLocalWriter;
use webrtc_util::Unmarshal;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
fn new_cmd(bin: &str) -> Command {
    let mut cmd = Command::new(bin);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}
#[cfg(not(target_os = "windows"))]
fn new_cmd(bin: &str) -> Command {
    Command::new(bin)
}

fn ffmpeg_binary() -> String {
    let bin_name = if cfg!(target_os = "windows") { "ffmpeg.exe" } else { "ffmpeg" };
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe_path) = env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            candidates.push(dir.join("resources").join("ffmpeg").join(&bin_name));
        }
        for anc in exe_path.ancestors() {
            if anc.file_name().and_then(|n| n.to_str()) == Some("src-tauri") {
                candidates.push(PathBuf::from(anc).join("ffmpeg").join(&bin_name));
                break;
            }
        }
    }
    if let Ok(cwd) = env::current_dir() {
        candidates.push(cwd.join("src-tauri").join("ffmpeg").join(&bin_name));
        candidates.push(cwd.join("ffmpeg").join(&bin_name));
    }
    for p in candidates {
        if p.exists() {
            let s = p.to_string_lossy().to_string();
            #[cfg(target_os = "windows")]
            {
                if s.len() >= 120 {
                    let tmp = env::temp_dir().join("fr_ffmpeg.exe");
                    let _ = fs::create_dir_all(tmp.parent().unwrap_or(&PathBuf::from(".")));
                    let _ = fs::copy(&p, &tmp);
                    return tmp.to_string_lossy().to_string();
                }
            }
            return s;
        }
    }
    format!("resources/ffmpeg/{bin_name}")
}

#[derive(Deserialize)]
struct StartRecordingRequest {
    resolution: String,
    fps: u32,
    format: String,
    mic_device: Option<String>,
    camera_device: Option<String>,
    capture_mode: Option<String>,
    window_title: Option<String>,
    region: Option<CaptureRegion>,
}

#[derive(Deserialize, Clone)]
struct CaptureRegion {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[derive(Serialize)]
struct StartRecordingResponse {
    session_id: String,
    output_path: String,
    log_path: String,
    preview_url: Option<String>,
    camera_path: Option<String>,
}

#[derive(Serialize)]
struct StopRecordingResponse {
    session_id: String,
    duration_ms: u64,
}

struct RecordingState {
    inner: Mutex<Option<RecordingSession>>,
}

impl RecordingState {
    fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

struct RecordingSession {
    id: String,
    started_at: Instant,
    child: Child,
    cursor_stop: Arc<AtomicBool>,
}

#[derive(Serialize, Deserialize, Clone)]
struct EditState {
    aspect: String,
    padding: u32,
    radius: u32,
    shadow: u32,
    camera_size: u32,
    camera_shape: String,
    camera_shadow: u32,
    camera_mirror: bool,
    camera_blur: bool,
    background_type: String,
    background_preset: u32,
    camera_position: String,
    #[serde(default)]
    shrink_16_9: f32,
    #[serde(default)]
    shrink_1_1: f32,
    #[serde(default)]
    shrink_9_16: f32,
    #[serde(default)]
    portrait_split: bool,
    #[serde(default)]
    portrait_bottom_ratio: f32,
    #[serde(default)]
    mode_16_9: String,
    #[serde(default)]
    mode_1_1: String,
    #[serde(default)]
    mode_9_16: String,
    #[serde(default)]
    title_safe_16_9: f32,
    #[serde(default)]
    subtitle_safe_16_9: f32,
    #[serde(default)]
    title_safe_1_1: f32,
    #[serde(default)]
    subtitle_safe_1_1: f32,
    #[serde(default)]
    title_safe_9_16: f32,
    #[serde(default)]
    subtitle_safe_9_16: f32,
}

impl Default for EditState {
    fn default() -> Self {
        Self {
            aspect: "16:9".to_string(),
            padding: 0,
            radius: 12,
            shadow: 20,
            camera_size: 168,
            camera_shape: "circle".to_string(),
            camera_shadow: 22,
            camera_mirror: false,
            camera_blur: false,
            background_type: "gradient".to_string(),
            background_preset: 0,
            camera_position: "bottom_left".to_string(),
            shrink_16_9: 0.94,
            shrink_1_1: 0.94,
            shrink_9_16: 0.92,
            portrait_split: true,
            portrait_bottom_ratio: 0.36,
            mode_16_9: "shrink".to_string(),
            mode_1_1: "shrink".to_string(),
            mode_9_16: "split".to_string(),
            title_safe_16_9: 0.08,
            subtitle_safe_16_9: 0.10,
            title_safe_1_1: 0.06,
            subtitle_safe_1_1: 0.12,
            title_safe_9_16: 0.08,
            subtitle_safe_9_16: 0.10,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct ExportProfile {
    format: String,
    width: u32,
    height: u32,
    fps: u32,
    bitrate_kbps: u32,
}

#[derive(Deserialize, Clone)]
struct ExportRequest {
    input_path: String,
    output_path: String,
    edit_state: EditState,
    profile: ExportProfile,
    camera_path: Option<String>,
}

#[derive(Serialize, Clone)]
struct ExportStatus {
    job_id: String,
    state: String,
    progress: f32,
    error: Option<String>,
    output_path: Option<String>,
}

#[derive(Serialize)]
struct ExportStartResponse {
    job_id: String,
}

struct ExportJob {
    job_id: String,
    request: ExportRequest,
}

struct ExportManager {
    queue: VecDeque<ExportJob>,
    running: bool,
    statuses: HashMap<String, ExportStatus>,
    cancellations: HashMap<String, bool>,
}

struct ExportState {
    inner: Arc<Mutex<ExportManager>>,
}

impl ExportState {
    fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(ExportManager {
                queue: VecDeque::new(),
                running: false,
                statuses: HashMap::new(),
                cancellations: HashMap::new(),
            })),
        }
    }
}

const PREVIEW_RTP_PORT: u16 = 19000;

struct PreviewState {
    inner: Mutex<Option<PreviewSession>>,
}

impl PreviewState {
    fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

struct PreviewSession {
    peer: Arc<RTCPeerConnection>,
    udp_task: async_runtime::JoinHandle<()>,
}

#[derive(Serialize, Deserialize, Clone)]
struct Rect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[derive(Serialize, Deserialize)]
struct CaptureMeta {
    mode: String,
    rect: Rect,
    started_at_ms: u64,
}

#[derive(Serialize, Deserialize)]
struct CursorEventRecord {
    kind: String,
    offset_ms: u64,
    axn: f32,
    ayn: f32,
}

#[derive(Serialize, Deserialize, Clone)]
struct ZoomFrame {
    time_ms: u64,
    axn: f32,
    ayn: f32,
    zoom: f32,
}

#[derive(Serialize, Deserialize, Clone)]
struct ZoomSettings {
    max_zoom: f32,
    ramp_in_s: f64,
    ramp_out_s: f64,
    sample_ms: u32,
    follow_threshold_px: f32,
}

impl Default for ZoomSettings {
    fn default() -> Self {
        Self {
            max_zoom: 2.0,
            ramp_in_s: 0.5,
            ramp_out_s: 0.5,
            sample_ms: 120,
            follow_threshold_px: 160.0,
        }
    }
}

#[derive(Serialize, Deserialize)]
struct ZoomTrack {
    fps: u32,
    frames: Vec<ZoomFrame>,
    #[serde(default)]
    settings: Option<ZoomSettings>,
}

#[derive(Serialize, Deserialize, Clone)]
struct ClipSegment {
    start_s: f64,
    end_s: f64,
    #[serde(default)]
    speed: Option<f32>,
}

#[derive(Serialize, Deserialize, Clone)]
struct ClipTrack {
    segments: Vec<ClipSegment>,
}

#[derive(Serialize, Deserialize, Clone)]
struct CameraSegment {
    start_s: f64,
    end_s: f64,
    #[serde(default)]
    visible: bool,
    #[serde(default)]
    size_px: Option<u32>,
    #[serde(default)]
    position: Option<String>,
    #[serde(default)]
    mirror: Option<bool>,
    #[serde(default)]
    blur: Option<bool>,
    #[serde(default)]
    shape: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct CameraTrack {
    segments: Vec<CameraSegment>,
}

fn write_error_log(output_dir: &PathBuf, message: &str) {
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(output_dir.join("error.log"))
    {
        let _ = writeln!(file, "{message}");
    }
}

fn edit_state_path(output_path: &str) -> PathBuf {
    let path = PathBuf::from(output_path);
    if let Some(parent) = path.parent() {
        parent.join("edit_state.json")
    } else {
        PathBuf::from("edit_state.json")
    }
}

fn preview_path(output_path: &str) -> PathBuf {
    let path = PathBuf::from(output_path);
    let session = path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("preview");
    let name = format!("Flash Recorder_{}_preview.mp4", session);
    export_dir_with_fallback().join(name)
}

fn app_install_dir() -> PathBuf {
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            return dir.to_path_buf();
        }
    }
    PathBuf::from(".")
}

fn app_data_root() -> PathBuf {
    app_install_dir()
}

fn work_base_dir() -> PathBuf {
    app_data_root().join("work")
}

fn user_videos_dir() -> PathBuf {
    if let Ok(user) = env::var("USERPROFILE") {
        return PathBuf::from(user).join("Videos");
    }
    PathBuf::from("Videos")
}

fn export_dir_with_fallback() -> PathBuf {
    let preferred = app_data_root().join("recordings");
    if fs::create_dir_all(&preferred).is_ok() {
        return preferred;
    }
    let fallback = user_videos_dir().join("Flash_Recorder");
    let _ = fs::create_dir_all(&fallback);
    fallback
}

fn normalize_export_output_path(req: &ExportRequest) -> String {
    let raw = PathBuf::from(&req.output_path);
    if raw.is_absolute() && raw.parent().is_some() {
        return raw.to_string_lossy().to_string();
    }
    let input = PathBuf::from(&req.input_path);
    let session = input
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("export");
    let name = format!("{session}.mp4");
    export_dir_with_fallback()
        .join(name)
        .to_string_lossy()
        .to_string()
}

fn copy_dir(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir(&from, &to)?;
        } else if file_type.is_file() {
            if let Some(parent) = to.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::copy(&from, &to);
        }
    }
    Ok(())
}

fn maybe_migrate_old_recordings() {
    let candidates = [PathBuf::from(r"D:\recordings"), PathBuf::from(r"D:\Recordings")];
    let target = work_base_dir();
    let _ = fs::create_dir_all(&target);
    for base in candidates {
        if !base.exists() {
            continue;
        }
        if let Ok(entries) = fs::read_dir(&base) {
            for entry in entries.flatten() {
                let path = entry.path();
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    let dst = target.join(entry.file_name());
                    if fs::rename(&path, &dst).is_err() {
                        let _ = copy_dir(&path, &dst);
                        let _ = fs::remove_dir_all(&path);
                    }
                }
            }
        }
    }
}

fn parse_duration_ms(text: &str) -> Option<u64> {
    let marker = "Duration: ";
    let index = text.find(marker)?;
    let tail = &text[index + marker.len()..];
    let duration = tail.split(',').next()?.trim();
    let mut parts = duration.split(':');
    let hours: f64 = parts.next()?.parse().ok()?;
    let minutes: f64 = parts.next()?.parse().ok()?;
    let seconds: f64 = parts.next()?.parse().ok()?;
    let total = ((hours * 3600.0) + (minutes * 60.0) + seconds) * 1000.0;
    Some(total.round() as u64)
}

fn get_media_duration_ms(input_path: &str) -> Option<u64> {
    let output = new_cmd(&ffmpeg_binary())
        .args(["-i", input_path, "-hide_banner"])
        .output()
        .ok()?;
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    parse_duration_ms(&stderr)
}

fn aspect_ratio(aspect: &str) -> f32 {
    match aspect {
        "1:1" => 1.0,
        "9:16" => 9.0 / 16.0,
        _ => 16.0 / 9.0,
    }
}

fn evenize(value: i32) -> i32 {
    if value % 2 == 0 {
        value
    } else {
        value - 1
    }
}

fn parse_hex_color(value: &str) -> (i32, i32, i32) {
    let hex = value.trim_start_matches('#');
    if hex.len() != 6 {
        return (0, 0, 0);
    }
    let r = i32::from_str_radix(&hex[0..2], 16).unwrap_or(0);
    let g = i32::from_str_radix(&hex[2..4], 16).unwrap_or(0);
    let b = i32::from_str_radix(&hex[4..6], 16).unwrap_or(0);
    (r, g, b)
}

fn background_source(edit_state: &EditState, width: i32, height: i32, fps: u32) -> String {
    let gradients = [
        ("#6ee7ff", "#a855f7", "#f97316", 0.5),
        ("#0f172a", "#1e40af", "#38bdf8", 0.55),
        ("#111827", "#7c3aed", "#ec4899", 0.6),
        ("#0b1020", "#0f766e", "#22d3ee", 0.6),
    ];
    let wallpapers = [
        ("#0f172a", "#1f2937"),
        ("#0b1020", "#1f1b3a"),
        ("#1f2937", "#0f172a"),
        ("#0a0f1f", "#0b1020"),
    ];
    let index = edit_state.background_preset as usize;
    let t = "((X/max(W-1,1))+(Y/max(H-1,1)))/2";
    if edit_state.background_type == "wallpaper" {
        let (start, end) = wallpapers[index % wallpapers.len()];
        let (sr, sg, sb) = parse_hex_color(start);
        let (er, eg, eb) = parse_hex_color(end);
        let r = format!("{sr}+({er}-{sr})*{t}");
        let g = format!("{sg}+({eg}-{sg})*{t}");
        let b = format!("{sb}+({eb}-{sb})*{t}");
        format!(
            "nullsrc=s={width}x{height}:r={fps},format=rgba,geq=r='{r}':g='{g}':b='{b}':a='255'"
        )
    } else {
        let (start, mid, end, mid_pos) = gradients[index % gradients.len()];
        let (sr, sg, sb) = parse_hex_color(start);
        let (mr, mg, mb) = parse_hex_color(mid);
        let (er, eg, eb) = parse_hex_color(end);
        let m = mid_pos;
        let r = format!(
            "if(lte({t},{m}),{sr}+({mr}-{sr})*{t}/{m},{mr}+({er}-{mr})*({t}-{m})/(1-{m}))"
        );
        let g = format!(
            "if(lte({t},{m}),{sg}+({mg}-{sg})*{t}/{m},{mg}+({eg}-{mg})*({t}-{m})/(1-{m}))"
        );
        let b = format!(
            "if(lte({t},{m}),{sb}+({mb}-{sb})*{t}/{m},{mb}+({eb}-{mb})*({t}-{m})/(1-{m}))"
        );
        format!(
            "nullsrc=s={width}x{height}:r={fps},format=rgba,geq=r='{r}':g='{g}':b='{b}':a='255'"
        )
    }
}

fn rounded_alpha_expr(radius: i32) -> String {
    let r2 = radius * radius;
    format!(
        "if(lte(X,{r})*lte(Y,{r})*gt(pow(X-{r},2)+pow(Y-{r},2),{r2}),0,if(lte(W-X,{r})*lte(Y,{r})*gt(pow(W-X-{r},2)+pow(Y-{r},2),{r2}),0,if(lte(X,{r})*lte(H-Y,{r})*gt(pow(X-{r},2)+pow(H-Y-{r},2),{r2}),0,if(lte(W-X,{r})*lte(H-Y,{r})*gt(pow(W-X-{r},2)+pow(H-Y-{r},2),{r2}),0,255))))",
        r = radius,
        r2 = r2
    )
}

fn build_export_filter(edit_state: &EditState, profile: &ExportProfile, has_camera: bool, zoom_override: Option<(String, String, String)>, camera_enable: Option<String>, clip_select: Option<String>) -> String {
    let output_w = profile.width as i32;
    let output_h = profile.height as i32;
    let aspect = aspect_ratio(&edit_state.aspect);
    let mut frame_w = output_w as f32;
    let mut frame_h = frame_w / aspect;
    if frame_h > output_h as f32 {
        frame_h = output_h as f32;
        frame_w = frame_h * aspect;
    }
    let padding = edit_state.padding as i32;
    let mut inner_w = (frame_w.round() as i32 - padding * 2).max(2);
    let mut inner_h = (frame_h.round() as i32 - padding * 2).max(2);
    inner_w = evenize(inner_w);
    inner_h = evenize(inner_h);
    let pos_x = evenize((output_w - inner_w) / 2);
    let pos_y = evenize((output_h - inner_h) / 2);
    let radius = edit_state
        .radius
        .min((inner_w.min(inner_h) / 2) as u32) as i32;
    let shadow = edit_state.shadow as i32;
    let shadow_blur = (shadow / 4).max(1);
    let shadow_alpha = ((shadow as f32) / 120.0).clamp(0.0, 0.6);
    let shadow_offset = (shadow / 6).max(0);
    let bg_source = background_source(edit_state, output_w, output_h, profile.fps);
    let is_portrait_split = false;
    let margin_lr_169 = 0.06f32;
    let margin_tb_916 = 0.36f32;
    let margin_tb_11 = 0.24f32;
    let mut target_w = inner_w.max(2);
    let mut target_h = inner_h.max(2);
    if edit_state.aspect.as_str() == "16:9" {
        target_w = evenize(((inner_w as f32) * (1.0 - margin_lr_169)).round() as i32).max(2);
        target_h = inner_h.max(2);
    } else if edit_state.aspect.as_str() == "1:1" {
        target_w = inner_w.max(2);
        target_h = evenize(((inner_h as f32) * (1.0 - margin_tb_11)).round() as i32).max(2);
    } else if edit_state.aspect.as_str() == "9:16" {
        target_w = inner_w.max(2);
        target_h = evenize(((inner_h as f32) * (1.0 - margin_tb_916)).round() as i32).max(2);
    }
    let super_w = evenize((target_w * 2).max(2));
    let super_h = evenize((target_h * 2).max(2));
    let base = if is_portrait_split {
        unreachable!()
    } else if let Some((z_expr, x_expr, y_expr)) = zoom_override.as_ref() {
        {
            let mut s = format!(
                "{bg_source}[bg];[0:v]scale={super_w}:{super_h}:force_original_aspect_ratio=decrease,format=rgba,zoompan=z='{z}':x='{x}':y='{y}':d=1:s={target_w}x{target_h}:fps={fps}",
                z = z_expr,
                x = x_expr,
                y = y_expr,
                fps = profile.fps
            );
            if let Some(expr) = clip_select.as_ref() {
                s = format!("{},select='{}',setpts=N/({}*TB)", s, expr, profile.fps);
            }
            s
        }
    } else {
        {
            let mut s = format!(
                "{bg_source}[bg];[0:v]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,format=rgba,fps={fps}",
                fps = profile.fps
            );
            if let Some(expr) = clip_select.as_ref() {
                s = format!("{},select='{}',setpts=N/({}*TB)", s, expr, profile.fps);
            }
            s
        }
    };
    let rounded = if radius > 0 {
        let alpha_expr = rounded_alpha_expr(radius);
        format!("{base},geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='{alpha_expr}'")
    } else {
        base
    };
    let base_label = if has_camera { "base" } else { "v" };
    let base = if shadow > 0 {
        let shadow_x_expr = format!("{}+({}-overlay_w)/2+{}", pos_x, inner_w, shadow_offset);
        let shadow_y_expr = format!("{}+({}-overlay_h)/2+{}", pos_y, inner_h, shadow_offset);
        let fg_x_expr = format!("{}+({}-overlay_w)/2", pos_x, inner_w);
        let fg_y_expr = format!("{}+({}-overlay_h)/2", pos_y, inner_h);
        format!(
            "{rounded},split=2[fg][shadow];[shadow]boxblur={shadow_blur}:1,colorchannelmixer=aa={shadow_alpha}[shadow];[bg][shadow]overlay=x={shadow_x}:y={shadow_y}:shortest=1[bg2];[bg2][fg]overlay=x={fg_x}:y={fg_y}:shortest=1[{base_label}]",
            shadow_x = shadow_x_expr,
            shadow_y = shadow_y_expr,
            fg_x = fg_x_expr,
            fg_y = fg_y_expr,
            base_label = base_label
        )
    } else {
        let fg_x_expr = format!("{}+({}-overlay_w)/2", pos_x, inner_w);
        let fg_y_expr = format!("{}+({}-overlay_h)/2", pos_y, inner_h);
        format!(
            "{rounded}[fg];[bg][fg]overlay=x={fg_x}:y={fg_y}:shortest=1[{base_label}]",
            fg_x = fg_x_expr,
            fg_y = fg_y_expr,
            base_label = base_label
        )
    };
    if !has_camera {
        return base;
    }
    let mut camera_size = if edit_state.aspect.as_str() == "9:16" {
        evenize((edit_state.camera_size as i32).max(2))
    } else {
        evenize(((inner_w as f32) * 0.10).round() as i32).max(2)
    };
    let offset = if edit_state.aspect.as_str() == "9:16" { 16 } else { 12 };
    let (camera_x, camera_y) = match edit_state.camera_position.as_str() {
        "top_left" => (offset, offset),
        "top_right" => ((output_w - camera_size - offset).max(0), offset),
        "bottom_right" => (
            (output_w - camera_size - offset).max(0),
            (output_h - camera_size - offset).max(0),
        ),
        _ => (offset, (output_h - camera_size - offset).max(0)),
    };
    let camera_radius = match edit_state.camera_shape.as_str() {
        "circle" => camera_size / 2,
        "rounded" => evenize((inner_w / 24).max(4)),
        _ => evenize((inner_w / 64).max(2)),
    }
    .min(camera_size / 2);
    let camera_shadow = edit_state.camera_shadow as i32;
    let camera_shadow_blur = (camera_shadow / 4).max(1);
    let camera_shadow_alpha = ((camera_shadow as f32) / 120.0).clamp(0.0, 0.6);
    let camera_shadow_offset = (camera_shadow / 6).max(0);
    let mirror = if edit_state.camera_mirror { "hflip," } else { "" };
    let camera_base = format!(
        "[1:v]{mirror}scale={camera_size}:{camera_size}:force_original_aspect_ratio=increase,crop={camera_size}:{camera_size},format=rgba"
    );
    let camera_rounded = if camera_radius > 0 {
        let alpha_expr = rounded_alpha_expr(camera_radius);
        format!("{camera_base},geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='{alpha_expr}'")
    } else {
        camera_base
    };
    if camera_shadow > 0 {
        format!(
            "{base};{camera_rounded},split=2[cam][camshadow];[camshadow]boxblur={camera_shadow_blur}:1,colorchannelmixer=aa={camera_shadow_alpha}[camshadow];[base][camshadow]overlay=x={shadow_x}:y={shadow_y}:shortest=1{enable_shadow}[bg2];[bg2][cam]overlay=x={camera_x}:y={camera_y}:shortest=1{enable_cam}[v]",
            shadow_x = camera_x + camera_shadow_offset,
            shadow_y = camera_y + camera_shadow_offset,
            enable_shadow = camera_enable.as_ref().map(|e| format!(":enable={}", e)).unwrap_or_default(),
            enable_cam = camera_enable.as_ref().map(|e| format!(":enable={}", e)).unwrap_or_default()
        )
    } else {
        format!(
            "{base};{camera_rounded}[cam];[base][cam]overlay=x={camera_x}:y={camera_y}:shortest=1{enable}[v]",
            enable = camera_enable.as_ref().map(|e| format!(":enable={}", e)).unwrap_or_default()
        )
    }
}

fn derive_zoom_override(input_path: &str) -> Option<(String, String, String)> {
    let binding = PathBuf::from(input_path);
    let dir = binding.parent()?;
    let path = dir.join("zoom_track.json");
    let data = fs::read_to_string(&path).ok()?;
    let track: ZoomTrack = serde_json::from_str(&data).ok()?;
    if track.frames.is_empty() {
        return None;
    }
    let settings = track.settings.clone().unwrap_or_default();
    let mut windows: Vec<(f64, f64)> = Vec::new();
    let mut i = 0usize;
    let n = track.frames.len();
    while i < n {
        while i < n && track.frames[i].zoom <= 1.0001 {
            i += 1;
        }
        if i >= n {
            break;
        }
        let s = (track.frames[i].time_ms as f64) / 1000.0;
        let mut j = i;
        while j < n && track.frames[j].zoom > 1.0001 {
            j += 1;
        }
        let e = (track.frames[j.saturating_sub(1)].time_ms as f64) / 1000.0;
        windows.push((s, e));
        i = j;
        if windows.len() > 100 {
            break;
        }
    }
    let mut z_expr = String::from("1");
    for (s, e) in windows.iter() {
        let up = format!("(1+({mz}-1)*(1-pow(1-((time-{s})/{r} ),3)))", mz = settings.max_zoom, s = s, r = settings.ramp_in_s.max(1e-6));
        let flat = format!("{}", settings.max_zoom);
        let down = format!("(1+({mz}-1)*(1-pow(1-(({e}-time)/{r}),3)))", mz = settings.max_zoom, e = e, r = settings.ramp_out_s.max(1e-6));
        let expr = format!(
            "if(between(time,{s},{s_up}),{up},if(between(time,{s_up},{e_dn}),{flat},if(between(time,{e_dn},{e}),{down},{fallback})))",
            s = s,
            s_up = s + settings.ramp_in_s,
            e_dn = e - settings.ramp_out_s,
            e = e,
            up = up,
            flat = flat,
            down = down,
            fallback = z_expr
        );
        z_expr = expr;
    }
    let mut anchors: Vec<(f64, f64)> = Vec::new();
    let mut t_prev = f64::MIN;
    for f in track.frames.iter() {
        let t = (f.time_ms as f64) / 1000.0;
        if t - t_prev >= 0.12 {
            anchors.push((t, f.axn as f64));
            t_prev = t;
        }
        if anchors.len() > 150 {
            break;
        }
    }
    if anchors.is_empty() {
        anchors.push((0.0, 0.5));
        anchors.push((1.0, 0.5));
    }
    let mut ax_expr = anchors.last().unwrap().1.to_string();
    for w in anchors.windows(2).rev() {
        let (t0, a0) = w[0];
        let (t1, a1) = w[1];
        let lerp = format!(
            "(({a0})*(1-((time-{t0})/({dt})))+({a1})*(((time-{t0})/({dt}))))",
            a0 = a0,
            a1 = a1,
            t0 = t0,
            dt = (t1 - t0).max(1e-6)
        );
        ax_expr = format!("if(between(time,{t0},{t1}),{lerp},{fallback})", t0 = t0, t1 = t1, lerp = lerp, fallback = ax_expr);
    }
    let mut ay_anchors: Vec<(f64, f64)> = Vec::new();
    let mut ty_prev = f64::MIN;
    for f in track.frames.iter() {
        let t = (f.time_ms as f64) / 1000.0;
        if t - ty_prev >= 0.12 {
            ay_anchors.push((t, f.ayn as f64));
            ty_prev = t;
        }
        if ay_anchors.len() > 150 {
            break;
        }
    }
    if ay_anchors.is_empty() {
        ay_anchors.push((0.0, 0.5));
        ay_anchors.push((1.0, 0.5));
    }
    let mut ay_expr = ay_anchors.last().unwrap().1.to_string();
    for w in ay_anchors.windows(2).rev() {
        let (t0, a0) = w[0];
        let (t1, a1) = w[1];
        let lerp = format!(
            "(({a0})*(1-((time-{t0})/({dt})))+({a1})*(((time-{t0})/({dt}))))",
            a0 = a0,
            a1 = a1,
            t0 = t0,
            dt = (t1 - t0).max(1e-6)
        );
        ay_expr = format!("if(between(time,{t0},{t1}),{lerp},{fallback})", t0 = t0, t1 = t1, lerp = lerp, fallback = ay_expr);
    }
    let x_expr = format!("clip(({ax})*iw - (iw/({z}))/2, 0, iw - iw/({z}))", ax = ax_expr, z = z_expr);
    let y_expr = format!("clip(({ay})*ih - (ih/({z}))/2, 0, ih - ih/({z}))", ay = ay_expr, z = z_expr);
    Some((z_expr, x_expr, y_expr))
}

fn derive_camera_enable(input_path: &str) -> Option<String> {
    let binding = PathBuf::from(input_path);
    let dir = binding.parent()?;
    let path = dir.join("camera_track.json");
    let data = fs::read_to_string(&path).ok()?;
    let track: CameraTrack = serde_json::from_str(&data).ok()?;
    if track.segments.is_empty() {
        return None;
    }
    let mut expr = String::new();
    for seg in track.segments.iter() {
        if !seg.visible {
            continue;
        }
        let part = format!("between(t,{},{})", seg.start_s, seg.end_s);
        if expr.is_empty() {
            expr = part;
        } else {
            expr = format!("({})+({})", expr, part);
        }
    }
    if expr.is_empty() {
        None
    } else {
        Some(expr)
    }
}

fn derive_clip_select(input_path: &str) -> Option<String> {
    let binding = PathBuf::from(input_path);
    let dir = binding.parent()?;
    let path = dir.join("clip_track.json");
    let data = fs::read_to_string(&path).ok()?;
    let track: ClipTrack = serde_json::from_str(&data).ok()?;
    if track.segments.is_empty() {
        return None;
    }
    let mut expr = String::new();
    for seg in track.segments.iter() {
        let part = format!("between(t,{},{})", seg.start_s, seg.end_s);
        if expr.is_empty() {
            expr = part;
        } else {
            expr = format!("({})+({})", expr, part);
        }
    }
    if expr.is_empty() {
        None
    } else {
        Some(expr)
    }
}
fn emit_export_status(app: &tauri::AppHandle, status: &ExportStatus) {
    let _ = app.emit("export_progress", status);
}

fn ensure_export_worker(app: tauri::AppHandle, state: Arc<Mutex<ExportManager>>) {
    let should_spawn = {
        let mut guard = state.lock().ok();
        if let Some(manager) = guard.as_mut() {
            if manager.running {
                false
            } else {
                manager.running = true;
                true
            }
        } else {
            false
        }
    };
    if should_spawn {
        tauri::async_runtime::spawn(export_worker_async(app, state));
    }
}

async fn export_worker_async(app: tauri::AppHandle, state: Arc<Mutex<ExportManager>>) {
    loop {
        let job = {
            let mut guard = match state.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            guard.queue.pop_front()
        };
        let Some(job) = job else {
            if let Ok(mut guard) = state.lock() {
                guard.running = false;
            }
            return;
        };
        let mut status = ExportStatus {
            job_id: job.job_id.clone(),
            state: "running".to_string(),
            progress: 0.0,
            error: None,
            output_path: Some(job.request.output_path.clone()),
        };
        if let Ok(mut guard) = state.lock() {
            guard.statuses.insert(job.job_id.clone(), status.clone());
        }
        emit_export_status(&app, &status);
        let app_cloned = app.clone();
        let state_cloned = state.clone();
        let job_cloned = ExportJob {
            job_id: job.job_id.clone(),
            request: job.request.clone(),
        };
        let result = tauri::async_runtime::spawn_blocking(move || run_export_job(&app_cloned, &state_cloned, &job_cloned)).await;
        let ok = match result {
            Ok(ref r) => r.is_ok(),
            Err(_) => false,
        };
        status.state = if ok { "completed".to_string() } else { "failed".to_string() };
        status.progress = if ok { 1.0 } else { status.progress };
        status.error = if ok {
            None
        } else {
            match result {
                Ok(r) => r.err(),
                Err(_) => Some("export_task_join_failed".to_string()),
            }
        };
        if let Ok(mut guard) = state.lock() {
            guard.statuses.insert(job.job_id.clone(), status.clone());
            guard.cancellations.remove(&job.job_id);
        }
        emit_export_status(&app, &status);
    }
}

fn export_worker(app: tauri::AppHandle, state: Arc<Mutex<ExportManager>>) {
    loop {
        let job = {
            let mut guard = match state.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            guard.queue.pop_front()
        };
        let Some(job) = job else {
            if let Ok(mut guard) = state.lock() {
                guard.running = false;
            }
            return;
        };
        let mut status = ExportStatus {
            job_id: job.job_id.clone(),
            state: "running".to_string(),
            progress: 0.0,
            error: None,
            output_path: Some(job.request.output_path.clone()),
        };
        if let Ok(mut guard) = state.lock() {
            guard.statuses.insert(job.job_id.clone(), status.clone());
        }
        emit_export_status(&app, &status);
        let result = run_export_job(&app, &state, &job);
        status.state = if result.is_ok() {
            "completed".to_string()
        } else {
            "failed".to_string()
        };
        status.progress = if result.is_ok() { 1.0 } else { status.progress };
        status.error = result.err();
        if let Ok(mut guard) = state.lock() {
            guard.statuses.insert(job.job_id.clone(), status.clone());
            guard.cancellations.remove(&job.job_id);
        }
        emit_export_status(&app, &status);
    }
}

fn run_export_job(
    app: &tauri::AppHandle,
    state: &Arc<Mutex<ExportManager>>,
    job: &ExportJob,
) -> Result<(), String> {
    let duration_ms = get_media_duration_ms(&job.request.input_path);
    let camera_path = job
        .request
        .camera_path
        .as_ref()
        .filter(|path| !path.is_empty());
    let has_camera = camera_path
        .map(|path| PathBuf::from(path).exists())
        .unwrap_or(false);
    let zoom_override = derive_zoom_override(&job.request.input_path);
    let camera_enable = derive_camera_enable(&job.request.input_path);
    let clip_select = derive_clip_select(&job.request.input_path);
    let filter = build_export_filter(&job.request.edit_state, &job.request.profile, has_camera, zoom_override, camera_enable, clip_select);
    let mut args = vec!["-y".to_string(), "-i".to_string(), job.request.input_path.clone()];
    if let Some(path) = camera_path {
        if has_camera {
            args.push("-i".to_string());
            args.push(path.to_string());
        }
    }
    args.extend([
        "-filter_complex".to_string(),
        filter,
        "-map".to_string(),
        "[v]".to_string(),
        "-map".to_string(),
        "0:a?".to_string(),
        "-r".to_string(),
        job.request.profile.fps.to_string(),
    ]);
    let bitrate = format!("{}k", job.request.profile.bitrate_kbps.max(1));
    match job.request.profile.format.as_str() {
        "h265" | "hevc" => {
            args.extend([
                "-c:v".to_string(),
                "libx265".to_string(),
                "-preset".to_string(),
                "fast".to_string(),
                "-b:v".to_string(),
                bitrate,
            ]);
        }
        _ => {
            args.extend([
                "-c:v".to_string(),
                "libx264".to_string(),
                "-preset".to_string(),
                "fast".to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
                "-b:v".to_string(),
                bitrate,
            ]);
        }
    }
    args.extend([
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "160k".to_string(),
        "-progress".to_string(),
        "pipe:1".to_string(),
        "-nostats".to_string(),
        job.request.output_path.clone(),
    ]);
    let bin = ffmpeg_binary();
    let mut child = new_cmd(&bin)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg_not_found: {} (bin={})", e.to_string(), bin))?;
    let stdout = child
        .stdout
        .take()
        .ok_or("export_stdout_unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or("export_stderr_unavailable".to_string())?;
    let job_id = job.job_id.clone();
    let app_handle = app.clone();
    let state_handle = Arc::clone(state);
    let job_output_path = job.request.output_path.clone();
    let reader_handle = thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            let bytes = match reader.read_line(&mut line) {
                Ok(bytes) => bytes,
                Err(_) => break,
            };
            if bytes == 0 {
                break;
            }
            let trimmed = line.trim();
            if let Some(value) = trimmed.strip_prefix("out_time_ms=") {
                if let Ok(out_time_ms) = value.parse::<u64>() {
                    if let Some(duration_ms) = duration_ms {
                        let progress = (out_time_ms as f64 / duration_ms as f64).min(1.0);
                        let status = ExportStatus {
                            job_id: job_id.clone(),
                            state: "running".to_string(),
                            progress: progress as f32,
                            error: None,
                            output_path: Some(job_output_path.clone()),
                        };
                        if let Ok(mut guard) = state_handle.lock() {
                            guard.statuses.insert(job_id.clone(), status.clone());
                        }
                        emit_export_status(&app_handle, &status);
                    }
                }
            }
            if trimmed == "progress=end" {
                break;
            }
        }
    });
    let stderr_handle = thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buffer = String::new();
        let _ = reader.read_to_string(&mut buffer);
        buffer
    });
    loop {
        let cancelled = {
            if let Ok(guard) = state.lock() {
                guard.cancellations.get(&job.job_id).copied().unwrap_or(false)
            } else {
                false
            }
        };
        if cancelled {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader_handle.join();
            let _ = stderr_handle.join();
            return Err("export_cancelled".to_string());
        }
        if let Ok(Some(status)) = child.try_wait() {
            let _ = reader_handle.join();
            let stderr_output = stderr_handle.join().unwrap_or_default();
            return if status.success() {
                Ok(())
            } else if stderr_output.trim().is_empty() {
                Err("export_failed".to_string())
            } else {
                let tail = stderr_output
                    .lines()
                    .rev()
                    .take(12)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect::<Vec<_>>()
                    .join("\n");
                Err(format!("export_failed:\n{tail}"))
            };
        }
        thread::sleep(Duration::from_millis(120));
    }
}

async fn create_preview_session() -> Result<PreviewSession, String> {
    let mut media_engine = MediaEngine::default();
    media_engine
        .register_default_codecs()
        .map_err(|e| e.to_string())?;
    let api = APIBuilder::new().with_media_engine(media_engine).build();
    let peer = Arc::new(
        api.new_peer_connection(RTCConfiguration::default())
            .await
            .map_err(|e| e.to_string())?,
    );
    let track = Arc::new(TrackLocalStaticRTP::new(
        RTCRtpCodecCapability {
            mime_type: "video/H264".to_string(),
            clock_rate: 90000,
            channels: 0,
            sdp_fmtp_line: "packetization-mode=1;level-asymmetry-allowed=1;profile-level-id=42e01f"
                .to_string(),
            rtcp_feedback: vec![],
        },
        "video".to_string(),
        "preview".to_string(),
    ));
    let rtp_sender = peer.add_track(track.clone()).await.map_err(|e| e.to_string())?;
    async_runtime::spawn(async move {
        let mut buf = vec![0u8; 1500];
        loop {
            if rtp_sender.read(&mut buf).await.is_err() {
                break;
            }
        }
    });
    let track_for_task = track.clone();
    let udp_task = async_runtime::spawn(async move {
        let socket = match UdpSocket::bind(("127.0.0.1", PREVIEW_RTP_PORT)).await {
            Ok(socket) => socket,
            Err(_) => return,
        };
        let mut buf = vec![0u8; 2048];
        loop {
            let (len, _) = match socket.recv_from(&mut buf).await {
                Ok(result) => result,
                Err(_) => break,
            };
            let mut raw = &buf[..len];
            let packet = match Packet::unmarshal(&mut raw) {
                Ok(packet) => packet,
                Err(_) => continue,
            };
            let _ = track_for_task.write_rtp(&packet).await;
        }
    });
    Ok(PreviewSession { peer, udp_task })
}

async fn stop_preview_session(session: PreviewSession) {
    let _ = session.peer.close().await;
    session.udp_task.abort();
}

#[tauri::command]
fn exclude_window_from_capture(app: tauri::AppHandle, label: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
        };

        let window = app.get_webview_window(&label).ok_or("window_not_found")?;
        let hwnd = window.hwnd().map_err(|_| "hwnd_unavailable")?;
        let hwnd: HWND = hwnd.0 as HWND;
        let result = unsafe { SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) };
        if result == 0 {
            return Err("exclude_from_capture_failed".into());
        }
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label);
        Ok(())
    }
}

#[tauri::command]
fn start_recording(
    app: tauri::AppHandle,
    state: State<RecordingState>,
    preview_state: State<PreviewState>,
    request: StartRecordingRequest,
) -> Result<StartRecordingResponse, String> {
    let mut guard = state.inner.lock().map_err(|_| "state_lock_failed")?;
    if guard.is_some() {
        return Err("recording_already_running".into());
    }

    let session_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis()
        .to_string();

    let base_dir = work_base_dir();
    let output_dir = base_dir.join(&session_id);
    fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
    let log_error = |message: String| {
        write_error_log(&output_dir, &message);
        message
    };
    let output_path = output_dir.join("recording.mp4");
    let camera_path = output_dir.join("camera.mp4");
    let log_path = output_dir.join("ffmpeg.log");
    let cursor_path = output_dir.join("cursor.jsonl");

    let fps = if request.fps == 0 { 60 } else { request.fps };
    let _ = &request.resolution;

    let capture_mode = request
        .capture_mode
        .as_deref()
        .unwrap_or("screen")
        .to_string();
    let mut args = vec![
        "-y".into(),
        "-thread_queue_size".into(),
        "512".into(),
        "-rtbufsize".into(),
        "256M".into(),
        "-f".into(),
        "gdigrab".into(),
        "-framerate".into(),
        fps.to_string(),
    ];

    if capture_mode == "window" {
        let window_title = request
            .window_title
            .clone()
            .ok_or("window_title_required")?;
        args.extend(["-i".into(), format!("title={window_title}")]);
    } else if capture_mode == "region" {
        let mut region = request.region.clone().ok_or("region_required")?;
        if region.width <= 0 || region.height <= 0 {
            return Err("invalid_region".into());
        }
        if region.x % 2 != 0 {
            region.x += 1;
            region.width -= 1;
        }
        if region.y % 2 != 0 {
            region.y += 1;
            region.height -= 1;
        }
        if region.width % 2 != 0 {
            region.width -= 1;
        }
        if region.height % 2 != 0 {
            region.height -= 1;
        }
        if region.width <= 0 || region.height <= 0 {
            return Err("invalid_region".into());
        }
        args.extend([
            "-offset_x".into(),
            region.x.to_string(),
            "-offset_y".into(),
            region.y.to_string(),
            "-video_size".into(),
            format!("{}x{}", region.width, region.height),
            "-i".into(),
            "desktop".into(),
        ]);
    } else {
        args.extend(["-i".into(), "desktop".into()]);
    }

    let mut input_index: usize = 1;
    let mut camera_index: Option<usize> = None;
    let mut audio_index: Option<usize> = None;

    let camera_device = request.camera_device.unwrap_or_else(|| "auto".into());
    let mut selected_camera: Option<String> = None;
    if camera_device == "auto" || camera_device == "default" {
        let devices = list_video_devices_internal().map_err(log_error)?;
        selected_camera = devices.into_iter().next();
    } else if camera_device != "off"
        && camera_device != "none"
        && camera_device != "no-camera"
        && !camera_device.trim().is_empty()
    {
        selected_camera = Some(camera_device.clone());
    }

    if let Some(camera_name) = selected_camera.as_ref() {
        args.extend([
            "-thread_queue_size".into(),
            "512".into(),
            "-f".into(),
            "dshow".into(),
            "-i".into(),
            format!("video={}", camera_name),
        ]);
        camera_index = Some(input_index);
        input_index += 1;
    }

    let mic_device = request.mic_device.unwrap_or_else(|| "auto".into());
    let mut selected_device: Option<String> = None;
    if mic_device == "auto" || mic_device == "default" {
        let devices = list_audio_devices_internal().map_err(log_error)?;
        selected_device = devices.into_iter().next();
    } else if mic_device != "mute" && !mic_device.trim().is_empty() {
        selected_device = Some(mic_device.clone());
    }

    if let Some(device_name) = selected_device.as_ref() {
        args.extend([
            "-thread_queue_size".into(),
            "512".into(),
            "-f".into(),
            "dshow".into(),
            "-i".into(),
            format!("audio={}", device_name),
        ]);
        audio_index = Some(input_index);
    } else {
        args.push("-an".into());
    }

    let preview_url = if camera_index.is_some() {
        Some("webrtc://local".to_string())
    } else {
        None
    };

    if preview_url.is_some() {
        {
            let mut preview_guard = preview_state
                .inner
                .lock()
                .map_err(|_| "preview_state_lock_failed")?;
            if let Some(existing) = preview_guard.take() {
                async_runtime::block_on(stop_preview_session(existing));
            }
        }
        let session = async_runtime::block_on(create_preview_session()).map_err(log_error)?;
        let mut preview_guard = preview_state
            .inner
            .lock()
            .map_err(|_| "preview_state_lock_failed")?;
        *preview_guard = Some(session);
    }

    if let Some(camera_input) = camera_index {
        let filter = format!(
            "[{camera_input}:v]crop='min(iw,ih)':'min(iw,ih)',hflip,split=2[cam_preview][cam_avatar];[cam_preview]fps=20,scale=240:240:force_original_aspect_ratio=increase,crop=240:240,format=yuv420p[preview];[cam_avatar]fps=30,scale=240:240:force_original_aspect_ratio=increase,crop=240:240,format=yuv420p[avatar]"
        );
        args.extend([
            "-filter_complex".into(),
            filter,
            "-map".into(),
            "0:v".into(),
        ]);
        if let Some(audio_input) = audio_index {
            args.push("-map".into());
            args.push(format!("{audio_input}:a"));
        }
    }

    match request.format.as_str() {
        "h265" | "hevc" => {
            args.extend([
                "-c:v".into(),
                "libx265".into(),
                "-preset".into(),
                "fast".into(),
            ]);
        }
        _ => {
            args.extend([
                "-c:v".into(),
                "libx264".into(),
                "-preset".into(),
                "ultrafast".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
            ]);
        }
    }

    if selected_device.is_some() {
        args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "160k".into()]);
    }

    args.push(output_path.to_string_lossy().to_string());
    if camera_index.is_some() {
        args.extend([
            "-map".into(),
            "[avatar]".into(),
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "veryfast".into(),
                "-crf".into(),
                "23".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            camera_path.to_string_lossy().to_string(),
        ]);
    }
    if preview_url.is_some() {
        args.extend([
            "-map".into(),
            "[preview]".into(),
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "ultrafast".into(),
            "-tune".into(),
            "zerolatency".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-profile:v".into(),
            "baseline".into(),
            "-g".into(),
            "30".into(),
            "-keyint_min".into(),
            "30".into(),
            "-bf".into(),
            "0".into(),
            "-f".into(),
            "rtp".into(),
            format!("rtp://127.0.0.1:{PREVIEW_RTP_PORT}?pkt_size=1200"),
        ]);
    }

    let rect = {
        if capture_mode == "region" {
            let region = request.region.clone().ok_or("region_required")?;
            Rect {
                x: region.x,
                y: region.y,
                width: region.width,
                height: region.height,
            }
        } else {
            #[cfg(target_os = "windows")]
            {
                use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
                let w = unsafe { GetSystemMetrics(SM_CXSCREEN) }.max(2);
                let h = unsafe { GetSystemMetrics(SM_CYSCREEN) }.max(2);
                Rect { x: 0, y: 0, width: w, height: h }
            }
            #[cfg(not(target_os = "windows"))]
            {
                Rect { x: 0, y: 0, width: 1920, height: 1080 }
            }
        }
    };
    let started_at_ms = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis() as u64;
    let meta = CaptureMeta { mode: capture_mode.clone(), rect: rect.clone(), started_at_ms };
    let _ = fs::write(output_dir.join("capture.json"), serde_json::to_string(&meta).unwrap_or_default());

    let log_file = fs::File::create(&log_path).map_err(|e| log_error(e.to_string()))?;

    let bin = ffmpeg_binary()
        ;
    let child = new_cmd(&bin)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::from(log_file))
        .spawn()
        .map_err(|e| log_error(format!("ffmpeg_not_found: {} (bin={})", e.to_string(), bin)))?;

    let stop_flag = Arc::new(AtomicBool::new(false));
    {
        let started = Instant::now();
        let stop_flag_clone = stop_flag.clone();
        let cursor_path_clone = cursor_path.clone();
        let rect_clone = rect.clone();
        let app_clone = app.clone();
        thread::spawn(move || {
            #[cfg(target_os = "windows")]
            {
                use std::io::BufWriter;
                use windows_sys::Win32::Foundation::POINT;
                use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
                use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
                let file = fs::File::create(&cursor_path_clone);
                if file.is_err() {
                    return;
                }
                let mut writer = BufWriter::new(file.unwrap());
                let mut last_btn = false;
                let mut last_axn = -1f32;
                let mut last_ayn = -1f32;
                let mut window_start_ms: Option<u64> = None;
                let mut window_end_ms: Option<u64> = None;
                loop {
                    if stop_flag_clone.load(Ordering::Relaxed) {
                        break;
                    }
                    let mut pt = POINT { x: 0, y: 0 };
                    let ok = unsafe { GetCursorPos(&mut pt as *mut POINT) };
                    if ok == 0 {
                        thread::sleep(Duration::from_millis(30));
                        continue;
                    }
                    let rel_x = (pt.x - rect_clone.x) as f64;
                    let rel_y = (pt.y - rect_clone.y) as f64;
                    let axn = (rel_x / (rect_clone.width as f64)).clamp(0.0, 1.0) as f32;
                    let ayn = (rel_y / (rect_clone.height as f64)).clamp(0.0, 1.0) as f32;
                    let btn = unsafe { GetAsyncKeyState(VK_LBUTTON as i32) } < 0;
                    let offset_ms = started.elapsed().as_millis() as u64;
                    let mut wrote_move = false;
                    if (axn - last_axn).abs() > 0.0001 || (ayn - last_ayn).abs() > 0.0001 {
                        let rec = CursorEventRecord { kind: "move".into(), offset_ms, axn, ayn };
                        if let Ok(line) = serde_json::to_string(&rec) {
                            let _ = writeln!(writer, "{line}");
                            wrote_move = true;
                        }
                        last_axn = axn;
                        last_ayn = ayn;
                    }
                    if btn && !last_btn {
                        let rec = CursorEventRecord { kind: "down".into(), offset_ms, axn, ayn };
                        if let Ok(line) = serde_json::to_string(&rec) {
                            let _ = writeln!(writer, "{line}");
                            wrote_move = true;
                        }
                        if let (Some(s), Some(e)) = (window_start_ms, window_end_ms) {
                            if offset_ms <= e {
                                // 5s 窗口内再次点击：仅延长窗口，不再重新缓入
                                window_end_ms = Some(offset_ms.saturating_add(5000));
                            } else {
                                window_start_ms = Some(offset_ms);
                                window_end_ms = Some(offset_ms.saturating_add(5000));
                            }
                        } else {
                            window_start_ms = Some(offset_ms);
                            window_end_ms = Some(offset_ms.saturating_add(5000));
                        }
                    } else if !btn && last_btn {
                        let rec = CursorEventRecord { kind: "up".into(), offset_ms, axn, ayn };
                        if let Ok(line) = serde_json::to_string(&rec) {
                            let _ = writeln!(writer, "{line}");
                            wrote_move = true;
                        }
                        // 松开不立即结束窗口，仍保持到 window_end_ms 或下一次点击
                    }
                    let mut zoom: f32 = 1.0;
                    if let (Some(s), Some(e)) = (window_start_ms, window_end_ms) {
                        let ramp = 500u64;
                        if offset_ms < s.saturating_add(ramp) {
                            let u = (((offset_ms.saturating_sub(s)) as f64) / (ramp as f64)).clamp(0.0, 1.0);
                            zoom = (1.0 + (2.0 - 1.0) * (1.0 - (1.0 - u).powi(3))) as f32;
                        } else if offset_ms <= e.saturating_sub(ramp) {
                            zoom = 2.0;
                        } else if offset_ms <= e {
                            let u = (((e.saturating_sub(offset_ms)) as f64) / (ramp as f64)).clamp(0.0, 1.0);
                            zoom = (1.0 + (2.0 - 1.0) * (1.0 - (1.0 - u).powi(3))) as f32;
                        } else {
                            zoom = 1.0;
                            window_start_ms = None;
                            window_end_ms = None;
                        }
                    }
                    let _ = app_clone.emit(
                        "zoom_frame",
                        ZoomFrame {
                            time_ms: offset_ms,
                            axn,
                            ayn,
                            zoom,
                        },
                    );
                    last_btn = btn;
                    if !wrote_move {
                        thread::sleep(Duration::from_millis(30));
                    } else {
                        thread::sleep(Duration::from_millis(10));
                    }
                }
            }
        });
    }

    *guard = Some(RecordingSession {
        id: session_id.clone(),
        started_at: Instant::now(),
        child,
        cursor_stop: stop_flag,
    });

    Ok(StartRecordingResponse {
        session_id,
        output_path: output_path.to_string_lossy().to_string(),
        log_path: log_path.to_string_lossy().to_string(),
        preview_url,
        camera_path: camera_index.map(|_| camera_path.to_string_lossy().to_string()),
    })
}

#[tauri::command]
async fn webrtc_create_answer(
    preview_state: State<'_, PreviewState>,
    offer_sdp: String,
) -> Result<String, String> {
    let peer = {
        let guard = preview_state
            .inner
            .lock()
            .map_err(|_| "preview_state_lock_failed")?;
        guard
            .as_ref()
            .map(|session| session.peer.clone())
            .ok_or("preview_not_ready")?
    };
    let offer = RTCSessionDescription::offer(offer_sdp).map_err(|e| e.to_string())?;
    peer.set_remote_description(offer)
        .await
        .map_err(|e| e.to_string())?;
    let answer = peer.create_answer(None).await.map_err(|e| e.to_string())?;
    let mut gather = peer.gathering_complete_promise().await;
    peer.set_local_description(answer)
        .await
        .map_err(|e| e.to_string())?;
    let _ = gather.recv().await;
    let local = peer
        .local_description()
        .await
        .ok_or("missing_local_description")?;
    Ok(local.sdp)
}

#[tauri::command]
fn stop_recording(
    state: State<RecordingState>,
    preview_state: State<PreviewState>,
) -> Result<StopRecordingResponse, String> {
    let mut guard = state.inner.lock().map_err(|_| "state_lock_failed")?;
    let mut session = guard.take().ok_or("no_active_recording")?;
    session.cursor_stop.store(true, Ordering::Relaxed);
    let duration_ms = session.started_at.elapsed().as_millis() as u64;
    let session_id = session.id.clone();
    if let Some(mut stdin) = session.child.stdin.take() {
        let _ = stdin.write_all(b"q");
        let _ = stdin.flush();
    }
    let mut exited = false;
    for _ in 0..20 {
        if let Ok(Some(_)) = session.child.try_wait() {
            exited = true;
            break;
        }
        thread::sleep(Duration::from_millis(200));
    }
    if !exited {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    if let Ok(mut preview_guard) = preview_state.inner.lock() {
        if let Some(preview_session) = preview_guard.take() {
            async_runtime::block_on(stop_preview_session(preview_session));
        }
    }
    Ok(StopRecordingResponse {
        session_id,
        duration_ms,
    })
}

#[tauri::command]
fn list_audio_devices() -> Result<Vec<String>, String> {
    list_audio_devices_internal()
}

fn list_audio_devices_internal() -> Result<Vec<String>, String> {
    let bin = ffmpeg_binary();
    let (stderr_output, stdout_output) = new_cmd(&bin)
        .args(["-list_devices", "true", "-f", "dshow", "-i", "dummy"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            let mut stderr_bytes = Vec::new();
            if let Some(mut stderr_reader) = child.stderr.take() {
                let _ = stderr_reader.read_to_end(&mut stderr_bytes);
            }
            let mut stdout_bytes = Vec::new();
            if let Some(mut stdout_reader) = child.stdout.take() {
                let _ = stdout_reader.read_to_end(&mut stdout_bytes);
            }
            let _ = child.wait();
            let stderr = String::from_utf8_lossy(&stderr_bytes).to_string();
            let stdout = String::from_utf8_lossy(&stdout_bytes).to_string();
            Ok((stderr, stdout))
        })
        .map_err(|e| format!("ffmpeg_not_found: {} (bin={})", e.to_string(), bin))?;

    let combined = format!("{stderr_output}\n{stdout_output}");
    Ok(parse_dshow_audio_devices(&combined))
}

#[tauri::command]
fn list_video_devices() -> Result<Vec<String>, String> {
    list_video_devices_internal()
}

#[tauri::command]
fn list_windows() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            EnumWindows, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible,
        };

        unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
            if IsWindowVisible(hwnd) == 0 {
                return 1;
            }
            let length = GetWindowTextLengthW(hwnd);
            if length == 0 {
                return 1;
            }
            let mut buffer = vec![0u16; (length + 1) as usize];
            let written = GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
            if written <= 0 {
                return 1;
            }
            let title = String::from_utf16_lossy(&buffer[..written as usize]);
            let trimmed = title.trim();
            if trimmed.is_empty() {
                return 1;
            }
            let titles = unsafe { &mut *(lparam as *mut Vec<String>) };
            if !titles.iter().any(|item| item == trimmed) {
                titles.push(trimmed.to_string());
            }
            1
        }

        let mut titles: Vec<String> = Vec::new();
        let result = unsafe {
            EnumWindows(Some(enum_windows_proc), &mut titles as *mut _ as LPARAM)
        };
        if result == 0 {
            return Err("list_windows_failed".into());
        }
        if titles.is_empty() {
            return Ok(Vec::new());
        }
        titles.sort();
        return Ok(titles);
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }
}

fn list_video_devices_internal() -> Result<Vec<String>, String> {
    let bin = ffmpeg_binary();
    let (stderr_output, stdout_output) = new_cmd(&bin)
        .args(["-list_devices", "true", "-f", "dshow", "-i", "dummy"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            let mut stderr_bytes = Vec::new();
            if let Some(mut stderr_reader) = child.stderr.take() {
                let _ = stderr_reader.read_to_end(&mut stderr_bytes);
            }
            let mut stdout_bytes = Vec::new();
            if let Some(mut stdout_reader) = child.stdout.take() {
                let _ = stdout_reader.read_to_end(&mut stdout_bytes);
            }
            let _ = child.wait();
            let stderr = String::from_utf8_lossy(&stderr_bytes).to_string();
            let stdout = String::from_utf8_lossy(&stdout_bytes).to_string();
            Ok((stderr, stdout))
        })
        .map_err(|e| format!("ffmpeg_not_found: {} (bin={})", e.to_string(), bin))?;

    let combined = format!("{stderr_output}\n{stdout_output}");
    Ok(parse_dshow_video_devices(&combined))
}

fn parse_dshow_audio_devices(stderr: &str) -> Vec<String> {
    let mut devices = Vec::new();
    let mut in_audio = false;
    for line in stderr.lines() {
        if line.contains("DirectShow audio devices") {
            in_audio = true;
            continue;
        }
        if line.contains("DirectShow video devices") {
            in_audio = false;
            continue;
        }
        if !in_audio && !line.contains("(audio)") {
            continue;
        }
        if line.contains("(none)") {
            continue;
        }
        if let Some(start) = line.find('"') {
            let rest = &line[start + 1..];
            if let Some(end) = rest.find('"') {
                let name = rest[..end].trim();
                if !name.is_empty() && !devices.iter().any(|item| item == name) {
                    devices.push(name.to_string());
                }
            }
        }
    }
    devices
}

fn parse_dshow_video_devices(stderr: &str) -> Vec<String> {
    let mut devices = Vec::new();
    let mut in_video = false;
    for line in stderr.lines() {
        if line.contains("DirectShow video devices") {
            in_video = true;
            continue;
        }
        if line.contains("DirectShow audio devices") {
            in_video = false;
            continue;
        }
        if !in_video && !line.contains("(video)") {
            continue;
        }
        if line.contains("(none)") {
            continue;
        }
        if let Some(start) = line.find('"') {
            let rest = &line[start + 1..];
            if let Some(end) = rest.find('"') {
                let name = rest[..end].trim();
                if !name.is_empty() && !devices.iter().any(|item| item == name) {
                    devices.push(name.to_string());
                }
            }
        }
    }
    devices
}

#[tauri::command]
fn save_edit_state(output_path: String, edit_state: EditState) -> Result<(), String> {
    let path = edit_state_path(&output_path);
    let serialized = serde_json::to_string_pretty(&edit_state).map_err(|e| e.to_string())?;
    fs::write(path, serialized).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_edit_state(output_path: String) -> Result<EditState, String> {
    let path = edit_state_path(&output_path);
    if !path.exists() {
        return Ok(EditState::default());
    }
    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

#[tauri::command]
fn ensure_preview(output_path: String) -> Result<String, String> {
    let preview = preview_path(&output_path);
    if preview.exists() {
        return Ok(preview.to_string_lossy().to_string());
    }
    let bin = ffmpeg_binary();
    let status = new_cmd(&bin)
        .args([
            "-y",
            "-i",
            &output_path,
            "-vf",
            "scale=1024:-2",
            "-r",
            "30",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            "-an",
            preview.to_string_lossy().as_ref(),
        ])
        .status()
        .map_err(|e| format!("ffmpeg_not_found: {} (bin={})", e.to_string(), bin))?;
    if status.success() {
        Ok(preview.to_string_lossy().to_string())
    } else {
        Err("preview_failed".to_string())
    }
}

#[tauri::command]
fn ensure_zoom_track(input_path: String) -> Result<String, String> {
    let dir = PathBuf::from(&input_path)
        .parent()
        .ok_or("invalid_input_path")?
        .to_path_buf();
    let path = dir.join("zoom_track.json");
    if path.exists() {
        return Ok(path.to_string_lossy().to_string());
    }
    let meta_path = dir.join("capture.json");
    let cursor_path = {
        let direct = dir.join("cursor.jsonl");
        if direct.exists() {
            direct
        } else {
            let mut found: Option<PathBuf> = None;
            if let Ok(entries) = fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.ends_with("cursor.jsonl"))
                        .unwrap_or(false)
                    {
                        found = Some(p);
                        break;
                    }
                }
            }
            found.ok_or("cursor_events_missing")?
        }
    };
    let capture_meta: CaptureMeta = serde_json::from_str(
        &fs::read_to_string(&meta_path).map_err(|_| "capture_meta_missing")?,
    )
    .map_err(|_| "capture_meta_parse_failed")?;
    let rect_w = capture_meta.rect.width.max(1) as f64;
    let rect_h = capture_meta.rect.height.max(1) as f64;
    let fps = 30u32;
    let duration_ms = get_media_duration_ms(&input_path).unwrap_or(15000);
    let mut events: Vec<CursorEventRecord> = Vec::new();
    let data = fs::read_to_string(&cursor_path).map_err(|_| "cursor_read_failed")?;
    for line in data.lines() {
        if let Ok(rec) = serde_json::from_str::<CursorEventRecord>(line) {
            events.push(rec);
        }
    }
    if events.is_empty() {
        let frames: Vec<ZoomFrame> = (0..=((duration_ms / 1000) * fps as u64))
            .map(|i| ZoomFrame {
                time_ms: ((i as f64) * (1000.0 / fps as f64)).round() as u64,
                axn: 0.5,
                ayn: 0.5,
                zoom: 1.0,
            })
            .collect();
        let track = ZoomTrack { fps, frames, settings: Some(ZoomSettings::default()) };
        fs::write(&path, serde_json::to_string(&track).map_err(|_| "track_serialize_failed")?)
            .map_err(|_| "track_write_failed")?;
        return Ok(path.to_string_lossy().to_string());
    }
    let mut downs: Vec<usize> = Vec::new();
    for (i, ev) in events.iter().enumerate() {
        if ev.kind == "down" {
            downs.push(i);
        }
    }
    let mut windows: Vec<(f64, f64, Vec<(f64, f32, f32)>)> = Vec::new();
    let mut wi = 0usize;
    while wi < downs.len() {
        let di = downs[wi];
        let start_rec = &events[di];
        let mut s = (start_rec.offset_ms as f64) / 1000.0;
        let mut e = s + 5.0;
        let mut wj = wi + 1;
        // 合并 5s 窗口内的连续点击：仅延长窗口终点，不重启缓入
        while wj < downs.len() {
            let ds = (events[downs[wj]].offset_ms as f64) / 1000.0;
            if ds <= e {
                e = ds + 5.0;
                wj += 1;
            } else {
                break;
            }
        }
        let mut path_px = 0.0;
        let mut last_axn = start_rec.axn;
        let mut last_ayn = start_rec.ayn;
        let mut follow_start_ms: Option<u64> = None;
        let mut follow_start_axn: f32 = start_rec.axn;
        let mut follow_start_ayn: f32 = start_rec.ayn;
        for ev in events.iter().skip(di + 1) {
            let t = (ev.offset_ms as f64) / 1000.0;
            if t > e {
                break;
            }
            if ev.kind == "move" {
                let dx = (ev.axn - last_axn) as f64 * rect_w;
                let dy = (ev.ayn - last_ayn) as f64 * rect_h;
                path_px += (dx * dx + dy * dy).sqrt();
                last_axn = ev.axn;
                last_ayn = ev.ayn;
                if follow_start_ms.is_none() && path_px >= 160.0 {
                    follow_start_ms = Some(ev.offset_ms);
                    follow_start_axn = ev.axn;
                    follow_start_ayn = ev.ayn;
                }
            }
        }
        let mut anchors: Vec<(f64, f32, f32)> = Vec::new();
        anchors.push((s, start_rec.axn, start_rec.ayn));
        if let Some(ms) = follow_start_ms {
            let t_follow = (ms as f64) / 1000.0;
            anchors.push((t_follow, follow_start_axn, follow_start_ayn));
            let mut next_sample_ms = ms + 120;
            for ev in events.iter().skip(di + 1) {
                let t = (ev.offset_ms as f64) / 1000.0;
                if t > e {
                    break;
                }
                if ev.kind == "move" && ev.offset_ms >= next_sample_ms {
                    anchors.push((t, ev.axn, ev.ayn));
                    next_sample_ms = ev.offset_ms + 120;
                    if anchors.len() > 4000 {
                        break;
                    }
                }
            }
        }
        let last = anchors.last().cloned().unwrap_or(anchors[0]);
        anchors.push((e, last.1, last.2));
        windows.push((s, e, anchors));
        wi = wj;
        if windows.len() >= 100 {
            break;
        }
    }
    let total_frames = ((duration_ms as f64) / (1000.0 / fps as f64)).ceil() as u64;
    let mut frames: Vec<ZoomFrame> = Vec::with_capacity(total_frames as usize + 1);
    for i in 0..=total_frames {
        let t_ms = ((i as f64) * (1000.0 / fps as f64)).round() as u64;
        let t = (t_ms as f64) / 1000.0;
        let mut axn: f32 = 0.5;
        let mut ayn: f32 = 0.5;
        let mut zoom: f32 = 1.0;
        for (s, e, anchors) in windows.iter() {
            if t < *s || t > *e {
                continue;
            }
            let ramp = 0.5f64;
            if t >= *s && t < *s + ramp {
                let u = ((t - *s) / ramp).clamp(0.0, 1.0);
                zoom = (1.0 + (2.0 - 1.0) * (1.0 - (1.0 - u).powi(3))) as f32;
            } else if t > *e - ramp && t <= *e {
                let u = (((*e) - t) / ramp).clamp(0.0, 1.0);
                zoom = (1.0 + (2.0 - 1.0) * (1.0 - (1.0 - u).powi(3))) as f32;
            } else {
                zoom = 2.0;
            }
            let mut ax = anchors[0].1;
            let mut ay = anchors[0].2;
            for w in anchors.windows(2) {
                let (t0, ax0, ay0) = w[0];
                let (t1, ax1, ay1) = w[1];
                if t >= t0 && t <= t1 {
                    let dt = (t1 - t0).max(0.001);
                    let u = ((t - t0) / dt).clamp(0.0, 1.0) as f32;
                    ax = ax0 * (1.0 - u) + ax1 * u;
                    ay = ay0 * (1.0 - u) + ay1 * u;
                    break;
                } else if t > t1 {
                    ax = ax1;
                    ay = ay1;
                }
            }
            axn = ax;
            ayn = ay;
            break;
        }
        frames.push(ZoomFrame {
            time_ms: t_ms,
            axn,
            ayn,
            zoom,
        });
    }
    let track = ZoomTrack { fps, frames, settings: Some(ZoomSettings::default()) };
    fs::write(&path, serde_json::to_string(&track).map_err(|_| "track_serialize_failed")?)
        .map_err(|_| "track_write_failed")?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn ensure_clip_track(input_path: String) -> Result<String, String> {
    let dir = PathBuf::from(&input_path)
        .parent()
        .ok_or("invalid_input_path")?
        .to_path_buf();
    let path = dir.join("clip_track.json");
    if path.exists() {
        return Ok(path.to_string_lossy().to_string());
    }
    let duration_ms = get_media_duration_ms(&input_path).unwrap_or(0);
    let mut segments: Vec<ClipSegment> = Vec::new();
    if duration_ms > 0 {
        segments.push(ClipSegment { start_s: 0.0, end_s: (duration_ms as f64) / 1000.0, speed: None });
    }
    let track = ClipTrack { segments };
    fs::write(&path, serde_json::to_string(&track).map_err(|_| "track_serialize_failed")?)
        .map_err(|_| "track_write_failed")?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn save_clip_track(input_path: String, track_json: String) -> Result<String, String> {
    let dir = PathBuf::from(&input_path)
        .parent()
        .ok_or("invalid_input_path")?
        .to_path_buf();
    let path = dir.join("clip_track.json");
    fs::write(&path, track_json).map_err(|_| "track_write_failed".to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn ensure_camera_track(input_path: String) -> Result<String, String> {
    let dir = PathBuf::from(&input_path)
        .parent()
        .ok_or("invalid_input_path")?
        .to_path_buf();
    let path = dir.join("camera_track.json");
    if path.exists() {
        return Ok(path.to_string_lossy().to_string());
    }
    let duration_ms = get_media_duration_ms(&input_path).unwrap_or(0);
    let segments: Vec<CameraSegment> = if duration_ms > 0 {
        vec![CameraSegment {
            start_s: 0.0,
            end_s: (duration_ms as f64) / 1000.0,
            visible: true,
            size_px: None,
            position: None,
            mirror: None,
            blur: None,
            shape: None,
        }]
    } else {
        Vec::new()
    };
    let track = CameraTrack { segments };
    fs::write(&path, serde_json::to_string(&track).map_err(|_| "track_serialize_failed")?)
        .map_err(|_| "track_write_failed")?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn load_click_markers(input_path: String) -> Result<Vec<f64>, String> {
    let dir = PathBuf::from(&input_path)
        .parent()
        .ok_or("invalid_input_path")?
        .to_path_buf();
    let cursor_path = {
        let direct = dir.join("cursor.jsonl");
        if direct.exists() {
            direct
        } else {
            let mut found: Option<PathBuf> = None;
            if let Ok(entries) = fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.ends_with("cursor.jsonl"))
                        .unwrap_or(false)
                    {
                        found = Some(p);
                        break;
                    }
                }
            }
            found.ok_or("cursor_events_missing")?
        }
    };
    let data = fs::read_to_string(&cursor_path).map_err(|_| "cursor_read_failed")?;
    let mut times_s: Vec<f64> = Vec::new();
    for line in data.lines() {
        if let Ok(rec) = serde_json::from_str::<CursorEventRecord>(line) {
            if rec.kind == "down" {
                times_s.push((rec.offset_ms as f64) / 1000.0);
            }
        }
    }
    Ok(times_s)
}
#[tauri::command]
fn save_camera_track(input_path: String, track_json: String) -> Result<String, String> {
    let dir = PathBuf::from(&input_path)
        .parent()
        .ok_or("invalid_input_path")?
        .to_path_buf();
    let path = dir.join("camera_track.json");
    fs::write(&path, track_json).map_err(|_| "track_write_failed".to_string())?;
    Ok(path.to_string_lossy().to_string())
}
#[tauri::command]
fn save_zoom_track(input_path: String, track_json: String) -> Result<String, String> {
    let dir = PathBuf::from(&input_path)
        .parent()
        .ok_or("invalid_input_path")?
        .to_path_buf();
    let path = dir.join("zoom_track.json");
    fs::write(&path, track_json).map_err(|_| "track_write_failed".to_string())?;
    Ok(path.to_string_lossy().to_string())
}
#[tauri::command]
fn get_export_dir() -> Result<String, String> {
    Ok(export_dir_with_fallback()
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut target = {
            let p = PathBuf::from(&path);
            if p.exists() { p } else { export_dir_with_fallback() }
        };
        if !target.exists() {
            let _ = fs::create_dir_all(&target);
        }
        let _ = new_cmd("explorer").arg(&target).spawn();
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("unsupported_platform".to_string())
    }
}
#[tauri::command]
fn start_export(
    app: tauri::AppHandle,
    state: State<ExportState>,
    request: ExportRequest,
) -> Result<ExportStartResponse, String> {
    let job_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis()
        .to_string();
    let normalized_output = normalize_export_output_path(&request);
    let status = ExportStatus {
        job_id: job_id.clone(),
        state: "queued".to_string(),
        progress: 0.0,
        error: None,
        output_path: Some(normalized_output.clone()),
    };
    {
        let mut guard = state.inner.lock().map_err(|_| "export_state_lock_failed")?;
        guard.statuses.insert(job_id.clone(), status.clone());
        guard.queue.push_back(ExportJob {
            job_id: job_id.clone(),
            request: ExportRequest {
                output_path: normalized_output,
                ..request
            },
        });
    }
    emit_export_status(&app, &status);
    ensure_export_worker(app, state.inner.clone());
    Ok(ExportStartResponse { job_id })
}

#[tauri::command]
fn get_export_status(
    state: State<ExportState>,
    job_id: String,
) -> Result<ExportStatus, String> {
    let guard = state.inner.lock().map_err(|_| "export_state_lock_failed")?;
    guard
        .statuses
        .get(&job_id)
        .cloned()
        .ok_or_else(|| "export_not_found".to_string())
}

#[tauri::command]
fn cancel_export(state: State<ExportState>, job_id: String) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|_| "export_state_lock_failed")?;
    guard.cancellations.insert(job_id.clone(), true);
    if let Some(status) = guard.statuses.get_mut(&job_id) {
        status.state = "cancelled".to_string();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    maybe_migrate_old_recordings();
    let _ = fs::create_dir_all(export_dir_with_fallback());
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .manage(RecordingState::new())
        .manage(PreviewState::new())
        .manage(ExportState::new())
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            webrtc_create_answer,
            list_audio_devices,
            list_video_devices,
            list_windows,
            exclude_window_from_capture,
            save_edit_state,
            load_edit_state,
            ensure_preview,
            ensure_zoom_track,
            save_zoom_track,
            ensure_clip_track,
            save_clip_track,
            ensure_camera_track,
            save_camera_track,
            load_click_markers,
            get_export_dir,
            open_path,
            start_export,
            get_export_status,
            cancel_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
