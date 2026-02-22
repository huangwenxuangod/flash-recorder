import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [camera, setCamera] = useState("no-camera");
  const [mic, setMic] = useState("auto");
  const [resolution, setResolution] = useState("1080p");
  const [fps, setFps] = useState("60");
  const [format, setFormat] = useState("h264");
  const [seconds, setSeconds] = useState(0);
  const [outputPath, setOutputPath] = useState("");
  const [logPath, setLogPath] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [audioDevices, setAudioDevices] = useState<string[]>([]);

  useEffect(() => {
    if (!isRecording) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setSeconds((current) => current + 1);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [isRecording]);

  useEffect(() => {
    invoke<string[]>("list_audio_devices")
      .then((devices) => setAudioDevices(devices))
      .catch((error) => setErrorMessage(String(error)));
  }, []);

  const timerText = useMemo(() => {
    const minutes = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const secs = (seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${secs}`;
  }, [seconds]);

  const handleToggleRecord = async () => {
    if (isRecording) {
      try {
        await invoke("stop_recording");
        setIsRecording(false);
        return;
      } catch (error) {
        setErrorMessage(String(error));
        return;
      }
    }

    setErrorMessage("");
    setSeconds(0);
    try {
      const response = await invoke<{ output_path: string; log_path: string }>("start_recording", {
        request: {
          resolution,
          fps: Number(fps),
          format,
          mic_device: mic,
        },
      });
      setOutputPath(response.output_path);
      setLogPath(response.log_path);
      setIsRecording(true);
    } catch (error) {
      setErrorMessage(String(error));
    }
  };

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <div className="brand-text">
            <div className="brand-title">Flash Recorder</div>
            <div className="brand-subtitle">Windows 录制</div>
          </div>
        </div>
        <div className="top-actions">
          <button className="text-button" type="button">
            打开项目
          </button>
          <button className="text-button" type="button">
            设置
          </button>
          <div className="status-pill">
            <span
              className={`status-dot ${isRecording ? "live" : "idle"}`}
              aria-hidden
            />
            <span>{isRecording ? "录制中" : "就绪"}</span>
            <span className="status-time">{timerText}</span>
          </div>
        </div>
      </header>

      <section className="workspace">
        <div className="controls">
          <div className="section-title">新录制</div>

          <div className="field">
            <label className="label" htmlFor="camera">
              摄像头
            </label>
            <select
              id="camera"
              className="select"
              value={camera}
              onChange={(event) => setCamera(event.target.value)}
            >
              <option value="no-camera">无摄像头</option>
              <option value="front-camera">内置摄像头</option>
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="mic">
              麦克风
            </label>
            <select
              id="mic"
              className="select"
              value={mic}
              onChange={(event) => setMic(event.target.value)}
            >
              <option value="mute">静音</option>
              <option value="auto">自动选择</option>
              {audioDevices.map((device) => (
                <option key={device} value={device}>
                  {device}
                </option>
              ))}
            </select>
          </div>

          <button
            className={`record-btn ${isRecording ? "stop" : ""}`}
            onClick={handleToggleRecord}
            type="button"
          >
            <span className="record-indicator" aria-hidden />
            {isRecording ? "停止录制" : "开始录制"}
          </button>

          <div className="divider" />

          <div className="section-title">导出设置</div>

          <div className="field">
            <label className="label" htmlFor="resolution">
              分辨率
            </label>
            <select
              id="resolution"
              className="select"
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
            >
              <option value="1080p">1080p</option>
              <option value="1440p">1440p</option>
              <option value="4k">4K</option>
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="fps">
              帧率
            </label>
            <select
              id="fps"
              className="select"
              value={fps}
              onChange={(event) => setFps(event.target.value)}
            >
              <option value="30">30 fps</option>
              <option value="60">60 fps</option>
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="format">
              格式
            </label>
            <select
              id="format"
              className="select"
              value={format}
              onChange={(event) => setFormat(event.target.value)}
            >
              <option value="h264">H.264</option>
            </select>
          </div>

          <div className="field">
            <div className="label">保存路径</div>
            <div className="path">{outputPath || "D:\\recordings"}</div>
            {logPath ? <div className="path">{logPath}</div> : null}
            {errorMessage ? <div className="path">{errorMessage}</div> : null}
          </div>

          <div className="shortcut">快捷键：Ctrl + Shift + R</div>
        </div>

        <div className="preview">
          <div className="preview-header">预览</div>
          <div className="preview-frame">
            <div className="preview-content">
              <div className="preview-title">当前屏幕</div>
              <div className="preview-subtitle">点击开始录制</div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
