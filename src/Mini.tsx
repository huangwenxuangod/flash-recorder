import { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { FiSquare } from "react-icons/fi";
import "./App.css";

function Mini() {
  const [isRecording, setIsRecording] = useState(
    () => localStorage.getItem("recordingActive") === "1"
  );
  const [seconds, setSeconds] = useState(() => {
    const startedAt = Number(localStorage.getItem("recordingStart") ?? 0);
    return startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedCamera, setSelectedCamera] = useState(
    () => localStorage.getItem("selectedCamera") ?? "auto"
  );
  const [avatarStream, setAvatarStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const applyMiniLayout = async () => {
      await appWindow.setAlwaysOnTop(true);
      await appWindow.setResizable(false);
      await appWindow.setDecorations(true);
      const miniWidth = 300;
      const miniHeight = 80;
      await appWindow.setSize(new LogicalSize(miniWidth, miniHeight));
      const posX = 20;
      const posY = Math.max(20, window.screen.availHeight - miniHeight - 20);
      await appWindow.setPosition(new LogicalPosition(posX, posY));
    };
    applyMiniLayout();
  }, []);

  useEffect(() => {
    invoke("exclude_window_from_capture", { label: "mini" }).catch((error) =>
      setErrorMessage(String(error))
    );
  }, []);

  useEffect(() => {
    const startedAt = Number(localStorage.getItem("recordingStart") ?? 0);
    const tick = () => {
      if (!startedAt) {
        setSeconds((current) => current + 1);
        return;
      }
      setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    };
    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "recordingActive") {
        const active = event.newValue === "1";
        setIsRecording(active);
      }
      if (event.key === "selectedCamera" && event.newValue) {
        setSelectedCamera(event.newValue);
      }
      if (event.key === "recordingStart" && event.newValue) {
        const startedAt = Number(event.newValue);
        setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }
    videoRef.current.srcObject = avatarStream;
  }, [avatarStream]);

  useEffect(() => {
    const stopStream = () => {
      if (avatarStream) {
        avatarStream.getTracks().forEach((track) => track.stop());
        setAvatarStream(null);
      }
    };
    const openPreview = async () => {
      if (!isRecording || selectedCamera === "no-camera") {
        stopStream();
        return;
      }
      try {
        const baseStream = await navigator.mediaDevices.getUserMedia({ video: true });
        baseStream.getTracks().forEach((track) => track.stop());
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((device) => device.kind === "videoinput");
        let constraints: MediaStreamConstraints = { video: true };
        if (selectedCamera !== "auto") {
          const matched = videoDevices.find((device) => device.label === selectedCamera);
          if (matched?.deviceId) {
            constraints = { video: { deviceId: { exact: matched.deviceId } } };
          }
        }
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        setAvatarStream(stream);
      } catch (error) {
        stopStream();
        setErrorMessage(String(error));
      }
    };
    openPreview();
    return () => stopStream();
  }, [isRecording, selectedCamera]);

  const timerText = useMemo(() => {
    const minutes = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const secs = (seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${secs}`;
  }, [seconds]);

  const stopRecording = async () => {
    try {
      await invoke("stop_recording");
      localStorage.removeItem("recordingActive");
      localStorage.removeItem("recordingStart");
      localStorage.removeItem("selectedCamera");
      localStorage.removeItem("selectedMic");
      localStorage.setItem("recordingFinished", "1");
      setIsRecording(false);
      const mainWindow = await WebviewWindow.getByLabel("main");
      if (mainWindow) {
        await mainWindow.show();
        await mainWindow.setFocus();
      }
      const miniWindow = await WebviewWindow.getByLabel("mini");
      if (miniWindow) {
        await miniWindow.close();
      }
    } catch (error) {
      setErrorMessage(String(error));
    }
  };

  return (
    <main className="h-full w-full bg-slate-950">
      <div className="flex h-full w-full items-center p-1.5">
        <div className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-gradient-to-r from-slate-950/90 via-slate-900/90 to-slate-950/90 px-2.5 py-1.5 shadow-2xl">
          <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-slate-800/80">
            {avatarStream ? (
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                autoPlay
                muted
                playsInline
              />
            ) : (
              <span className="text-[8px] text-slate-400">Avatar</span>
            )}
          </div>
          <div className="flex flex-col">
            <div className="text-[8px] uppercase tracking-[0.3em] text-slate-400">Recording</div>
            <div className="text-[12px] font-semibold text-white">{timerText}</div>
          </div>
          <div className="flex-1" />
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full border border-red-400/40 bg-red-500/15 text-red-200 transition hover:bg-red-500/25 disabled:opacity-60"
            type="button"
            onClick={stopRecording}
            disabled={!isRecording}
            aria-label="停止录制"
          >
            <FiSquare />
          </button>
        </div>
        {errorMessage ? <div className="ml-3 text-xs text-red-300">{errorMessage}</div> : null}
      </div>
    </main>
  );
}

export default Mini;

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(<Mini />);
}
