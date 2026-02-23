use std::{
    fs,
    io::Read,
    io::Write,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{async_runtime, Manager, State};
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
        let region = request.region.clone().ok_or("region_required")?;
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
            "[{camera_input}:v]scale=iw*0.25:-1,crop='min(iw,ih)':'min(iw,ih)',hflip,split=2[cam_base][cam_preview];[cam_base]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(pow(max(abs(X-W/2)-W/3,0),2)+pow(max(abs(Y-H/2)-W/3,0),2),W*W/36),255,0)'[cam];[cam_preview]fps=15,scale=160:160:force_original_aspect_ratio=increase,crop=160:160,format=yuv420p[preview];[0:v][cam]overlay=W-w-24:H-h-24:shortest=1[v]"
        );
        args.extend([
            "-filter_complex".into(),
            filter,
            "-map".into(),
            "[v]".into(),
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

    let child = Command::new("ffmpeg")
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
    let (stderr_output, stdout_output) = Command::new("ffmpeg")
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
    let (stderr_output, stdout_output) = Command::new("ffmpeg")
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(RecordingState::new())
        .manage(PreviewState::new())
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            webrtc_create_answer,
            list_audio_devices,
            list_video_devices,
            list_windows,
            exclude_window_from_capture
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
