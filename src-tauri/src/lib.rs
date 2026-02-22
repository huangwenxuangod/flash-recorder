use std::{
    fs,
    io::Read,
    io::Write,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Deserialize)]
struct StartRecordingRequest {
    resolution: String,
    fps: u32,
    format: String,
    mic_device: Option<String>,
}

#[derive(Serialize)]
struct StartRecordingResponse {
    session_id: String,
    output_path: String,
    log_path: String,
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
    output_path: PathBuf,
    log_path: PathBuf,
    child: Child,
}

#[tauri::command]
fn start_recording(
    _app: tauri::AppHandle,
    state: State<RecordingState>,
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
    let output_path = output_dir.join("recording.mp4");
    let log_path = output_dir.join("ffmpeg.log");

    let (default_width, default_height) = match request.resolution.as_str() {
        "4k" | "4K" => (3840, 2160),
        "1440p" => (2560, 1440),
        "1080p" => (1920, 1080),
        _ => (1920, 1080),
    };
    let video_size = format!("{}x{}", default_width, default_height);

    let fps = if request.fps == 0 { 60 } else { request.fps };

    let mut args = vec![
        "-y".into(),
        "-f".into(),
        "gdigrab".into(),
        "-framerate".into(),
        fps.to_string(),
    ];
    args.extend([
        "-video_size".into(),
        video_size.clone(),
        "-i".into(),
        "desktop".into(),
    ]);

    let mic_device = request.mic_device.unwrap_or_else(|| "auto".into());
    let mut selected_device: Option<String> = None;
    if mic_device == "auto" || mic_device == "default" {
        let devices = list_audio_devices_internal()?;
        selected_device = devices.into_iter().next();
    } else if mic_device != "mute" && !mic_device.trim().is_empty() {
        selected_device = Some(mic_device.clone());
    }

    if let Some(device_name) = selected_device.as_ref() {
        args.extend([
            "-f".into(),
            "dshow".into(),
            "-i".into(),
            format!("audio={}", device_name),
        ]);
    } else {
        args.push("-an".into());
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

    let log_file = fs::File::create(&log_path).map_err(|e| e.to_string())?;

    let child = Command::new("ffmpeg")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::from(log_file))
        .spawn()
        .map_err(|_| "ffmpeg_not_found".to_string())?;

    *guard = Some(RecordingSession {
        id: session_id.clone(),
        started_at: Instant::now(),
        output_path: output_path.clone(),
        log_path: log_path.clone(),
        child,
    });

    Ok(StartRecordingResponse {
        session_id,
        output_path: output_path.to_string_lossy().to_string(),
        log_path: log_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn stop_recording(state: State<RecordingState>) -> Result<StopRecordingResponse, String> {
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
    let output = Command::new("ffmpeg")
        .args(["-list_devices", "true", "-f", "dshow", "-i", "dummy"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            let mut stderr = String::new();
            if let Some(mut stderr_reader) = child.stderr.take() {
                let _ = stderr_reader.read_to_string(&mut stderr);
            }
            let _ = child.wait();
            Ok(stderr)
        })
        .map_err(|_| "ffmpeg_not_found".to_string())?;

    Ok(parse_dshow_audio_devices(&output))
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
        if !in_audio {
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
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            list_audio_devices
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
