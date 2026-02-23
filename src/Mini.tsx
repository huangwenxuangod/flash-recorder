import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { FiSquare } from "react-icons/fi";
import "./App.css";

function Mini() {
  const [isRecording, setIsRecording] = useState(
    () => localStorage.getItem("recordingActive") === "1"
  );
  const [camera, setCamera] = useState(() => localStorage.getItem("selectedCamera") ?? "no-camera");
  const [seconds, setSeconds] = useState(() => {
    const startedAt = Number(localStorage.getItem("recordingStart") ?? 0);
    return startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
  });
  const [errorMessage, setErrorMessage] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
      if (event.key === "recordingStart" && event.newValue) {
        const startedAt = Number(event.newValue);
        setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
      }
      if (event.key === "selectedCamera" && event.newValue) {
        setCamera(event.newValue);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
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
          <div className="h-8 w-8 overflow-hidden rounded-md border border-white/10 bg-slate-800/80">
            {camera === "no-camera" ? (
              <div className="flex h-full w-full items-center justify-center text-[8px] text-slate-400">
                Avatar
              </div>
            ) : (
              <video ref={videoRef} className="h-full w-full object-cover" autoPlay muted playsInline />
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
