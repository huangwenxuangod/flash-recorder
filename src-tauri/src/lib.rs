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

fn ffmpeg_binary() -> String {
    if let Ok(status) = Command::new("ffmpeg")
        .args(["-version"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
    {
        if status.success() {
            return "ffmpeg".to_string();
        }
    }
    if let Ok(exe_path) = env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            let candidate = dir.join("resources").join("ffmpeg").join(if cfg!(target_os = "windows") { "ffmpeg.exe" } else { "ffmpeg" });
            if candidate.exists() {
                return candidate.to_string_lossy().to_string();
            }
        }
    }
    "ffmpeg".to_string()
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
}

impl Default for EditState {
    fn default() -> Self {
        Self {
            aspect: "16:9".to_string(),
            padding: 0,
            radius: 12,
            shadow: 20,
            camera_size: 104,
            camera_shape: "circle".to_string(),
            camera_shadow: 22,
            camera_mirror: false,
            camera_blur: false,
            background_type: "gradient".to_string(),
            background_preset: 0,
            camera_position: "bottom_left".to_string(),
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
    if let Some(parent) = path.parent() {
        parent.join("preview.mp4")
    } else {
        PathBuf::from("preview.mp4")
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
    let output = Command::new(ffmpeg_binary())
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

fn build_export_filter(edit_state: &EditState, profile: &ExportProfile, has_camera: bool) -> String {
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
    let shrink = if edit_state.aspect == "9:16" { 0.92f32 } else { 1.0f32 };
    let target_w = evenize(((inner_w as f32) * shrink).round() as i32).max(2);
    let target_h = evenize(((inner_h as f32) * shrink).round() as i32).max(2);
    let base = format!(
        "{bg_source}[bg];[0:v]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,format=rgba"
    );
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
    let scale = (output_w as f32 / 420.0).max(0.1);
    let camera_scale = if edit_state.aspect == "9:16" { 2.0 } else { 1.0 };
    let mut camera_size = (edit_state.camera_size as f32 * scale * camera_scale).round() as i32;
    camera_size = evenize(camera_size.max(2));
    let offset = (12.0 * scale).round() as i32;
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
        "rounded" => (18.0 * scale).round() as i32,
        _ => (6.0 * scale).round() as i32,
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
            "{base};{camera_rounded},split=2[cam][camshadow];[camshadow]boxblur={camera_shadow_blur}:1,colorchannelmixer=aa={camera_shadow_alpha}[camshadow];[base][camshadow]overlay=x={shadow_x}:y={shadow_y}:shortest=1[bg2];[bg2][cam]overlay=x={camera_x}:y={camera_y}:shortest=1[v]",
            shadow_x = camera_x + camera_shadow_offset,
            shadow_y = camera_y + camera_shadow_offset
        )
    } else {
        format!(
            "{base};{camera_rounded}[cam];[base][cam]overlay=x={camera_x}:y={camera_y}:shortest=1[v]"
        )
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
        thread::spawn(move || export_worker(app, state));
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
    let filter = build_export_filter(&job.request.edit_state, &job.request.profile, has_camera);
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
    let mut child = Command::new(ffmpeg_binary())
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "ffmpeg_not_found".to_string())?;
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
    _app: tauri::AppHandle,
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

    let base_dir = PathBuf::from(r"D:\recordings");
    let output_dir = base_dir.join(&session_id);
    fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
    let log_error = |message: String| {
        write_error_log(&output_dir, &message);
        message
    };
    let output_path = output_dir.join("recording.mp4");
    let camera_path = output_dir.join("camera.mp4");
    let log_path = output_dir.join("ffmpeg.log");

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

    let log_file = fs::File::create(&log_path).map_err(|e| log_error(e.to_string()))?;

    let child = Command::new(ffmpeg_binary())
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::from(log_file))
        .spawn()
        .map_err(|_| log_error("ffmpeg_not_found".to_string()))?;

    *guard = Some(RecordingSession {
        id: session_id.clone(),
        started_at: Instant::now(),
        child,
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
    let (stderr_output, stdout_output) = Command::new(ffmpeg_binary())
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
        .map_err(|_| "ffmpeg_not_found".to_string())?;

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
    let (stderr_output, stdout_output) = Command::new(ffmpeg_binary())
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
        .map_err(|_| "ffmpeg_not_found".to_string())?;

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
    let status = Command::new(ffmpeg_binary())
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
        .map_err(|_| "ffmpeg_not_found".to_string())?;
    if status.success() {
        Ok(preview.to_string_lossy().to_string())
    } else {
        Err("preview_failed".to_string())
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
    let status = ExportStatus {
        job_id: job_id.clone(),
        state: "queued".to_string(),
        progress: 0.0,
        error: None,
    };
    {
        let mut guard = state.inner.lock().map_err(|_| "export_state_lock_failed")?;
        guard.statuses.insert(job_id.clone(), status.clone());
        guard.queue.push_back(ExportJob {
            job_id: job_id.clone(),
            request,
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
            start_export,
            get_export_status,
            cancel_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
