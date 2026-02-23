import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { FiCamera, FiMic, FiPlay, FiVideo } from "react-icons/fi";
import "./App.css";

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [camera, setCamera] = useState("no-camera");
  const [mic, setMic] = useState("auto");
  const [viewMode, setViewMode] = useState<"record" | "edit">("record");
  const [outputPath, setOutputPath] = useState("");
  const [logPath, setLogPath] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [audioDevices, setAudioDevices] = useState<string[]>([]);
  const [videoDevices, setVideoDevices] = useState<string[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "recordingActive") {
        const active = event.newValue === "1";
        setIsRecording(active);
      }
      if (event.key === "recordingFinished" && event.newValue === "1") {
        setViewMode("edit");
        setOutputPath(localStorage.getItem("recordingOutputPath") ?? "");
        setLogPath(localStorage.getItem("recordingLogPath") ?? "");
        localStorage.removeItem("recordingFinished");
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    invoke<string[]>("list_audio_devices")
      .then((devices) => setAudioDevices(devices))
      .catch((error) => setErrorMessage(String(error)));
  }, []);

  useEffect(() => {
    invoke<string[]>("list_video_devices")
      .then((devices) => setVideoDevices(devices))
      .catch((error) => setErrorMessage(String(error)));
  }, []);

  useEffect(() => {
    if (camera === "no-camera") {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      return;
    }
    const startPreview = async () => {
      try {
        const deviceList = await navigator.mediaDevices.enumerateDevices();
        const target = deviceList.find(
          (device) => device.kind === "videoinput" && device.label === camera
        );
        const constraints =
          camera !== "auto" && target?.deviceId
            ? { video: { deviceId: { exact: target.deviceId } } }
            : { video: true };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (error) {
        setErrorMessage(String(error));
      }
    };
    startPreview();
  }, [camera]);

  const openMiniWindow = async () => {
    const existing = await WebviewWindow.getByLabel("mini");
    if (existing) {
      await existing.show();
      await existing.setFocus();
      return;
    }
    const miniWidth = 300;
    const miniHeight = 80;
    const posX = 20;
    const posY = Math.max(20, window.screen.availHeight - miniHeight - 20);
    new WebviewWindow("mini", {
      url: "/mini.html",
      width: miniWidth,
      height: miniHeight,
      x: posX,
      y: posY,
      resizable: false,
      decorations: true,
      alwaysOnTop: true,
      skipTaskbar: false,
      title: "Recording",
    });
  };

  const startRecording = async () => {
    setErrorMessage("");
    try {
      const response = await invoke<{ output_path: string; log_path: string }>("start_recording", {
        request: {
          resolution: "1080p",
          fps: 60,
          format: "h264",
          mic_device: mic,
          camera_device: camera,
        },
      });
      const startedAt = Date.now();
      localStorage.setItem("recordingActive", "1");
      localStorage.setItem("recordingStart", startedAt.toString());
      localStorage.setItem("selectedCamera", camera);
      localStorage.setItem("selectedMic", mic);
      localStorage.setItem("recordingOutputPath", response.output_path);
      localStorage.setItem("recordingLogPath", response.log_path);
      localStorage.removeItem("recordingFinished");
      setOutputPath(response.output_path);
      setLogPath(response.log_path);
      setIsRecording(true);
      setViewMode("record");
      await openMiniWindow();
      await getCurrentWindow().hide();
    } catch (error) {
      setErrorMessage(String(error));
    }
  };

  const handleToggleRecord = async () => {
    if (isRecording) {
      return;
    }
    await startRecording();
  };

  if (viewMode === "edit") {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-6">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/80 to-blue-500/80 text-slate-950">
                <FiVideo />
              </div>
              <div>
                <div className="text-lg font-semibold">Flash Recorder</div>
                <div className="text-xs text-slate-400">编辑视频</div>
              </div>
            </div>
            <button
              className="rounded-full border border-white/10 bg-slate-900/70 px-4 py-2 text-xs text-slate-300 transition hover:border-white/20"
              type="button"
              onClick={() => setViewMode("record")}
            >
              返回录制
            </button>
          </header>

          <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">导出文件</div>
            <div className="mt-4 space-y-2 text-sm text-slate-200">
              <div>{outputPath || "D:\\recordings"}</div>
              {logPath ? <div className="text-xs text-slate-400">{logPath}</div> : null}
            </div>
            {errorMessage ? <div className="mt-4 text-xs text-red-300">{errorMessage}</div> : null}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/80 to-blue-500/80 text-slate-950">
              <FiVideo />
            </div>
            <div>
              <div className="text-lg font-semibold">Flash Recorder</div>
              <div className="text-xs text-slate-400">全屏录制 · 极简模式</div>
            </div>
          </div>
          <div className="rounded-full border border-white/10 bg-slate-900/70 px-4 py-2 text-xs text-slate-300">
            {isRecording ? "录制中" : "就绪"}
          </div>
        </header>

        <section className="grid gap-5 md:grid-cols-[1.1fr_1fr]">
          <div className="flex flex-col gap-5 rounded-2xl border border-white/10 bg-slate-900/60 p-5 shadow-xl">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">录制控制</div>

            <button
              className="flex items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-white to-slate-200 px-5 py-3 text-sm font-semibold text-slate-900 transition hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-70"
              type="button"
              onClick={handleToggleRecord}
              disabled={isRecording}
            >
              <FiPlay />
              {isRecording ? "录制中" : "开始录制"}
            </button>

            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2">
                <FiCamera className="text-slate-400" />
                <select
                  className="w-full bg-transparent text-sm text-slate-200 outline-none"
                  value={camera}
                  onChange={(event) => setCamera(event.target.value)}
                >
                  <option value="no-camera">关闭摄像头</option>
                  <option value="auto">默认摄像头</option>
                  {videoDevices.map((device) => (
                    <option key={device} value={device}>
                      {device}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2">
                <FiMic className="text-slate-400" />
                <select
                  className="w-full bg-transparent text-sm text-slate-200 outline-none"
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
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-950/50 px-4 py-3 text-xs text-slate-400">
              {outputPath || "D:\\recordings"}
              {logPath ? <div className="mt-2">{logPath}</div> : null}
              {errorMessage ? <div className="mt-2 text-red-300">{errorMessage}</div> : null}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 p-6 shadow-xl">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">头像预览</div>
            <div className="mt-4 flex h-full items-center justify-center">
              {camera === "no-camera" ? (
                <div className="text-sm text-slate-400">未启用摄像头</div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="h-48 w-48 overflow-hidden rounded-[36px] border border-cyan-300/30 bg-slate-900 shadow-2xl">
                    <video ref={videoRef} className="h-full w-full object-cover" autoPlay muted playsInline />
                  </div>
                  <div className="text-xs text-slate-400">导出视频将自动叠加头像</div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;
