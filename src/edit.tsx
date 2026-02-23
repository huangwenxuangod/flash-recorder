import { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalSize } from "@tauri-apps/api/window";
import { FiCamera, FiImage, FiPause, FiPlay, FiSliders } from "react-icons/fi";
import "./App.css";

type EditState = {
  aspect: string;
  padding: number;
  radius: number;
  shadow: number;
  camera_size: number;
  camera_shape: string;
  camera_shadow: number;
  camera_mirror: boolean;
  camera_blur: boolean;
  background_type: string;
  background_preset: number;
};

type ExportStatus = {
  job_id: string;
  state: string;
  progress: number;
  error?: string | null;
};

const EditPage = () => {
  const [outputPath, setOutputPath] = useState("");
  const [errorMessage] = useState("");
  const [editPadding, setEditPadding] = useState(0);
  const [editRadius, setEditRadius] = useState(12);
  const [editShadow, setEditShadow] = useState(20);
  const [editAspect, setEditAspect] = useState<"16:9" | "1:1" | "9:16">("16:9");
  const [cameraSize, setCameraSize] = useState(104);
  const [cameraShape, setCameraShape] = useState<"circle" | "rounded" | "square">("circle");
  const [cameraShadow, setCameraShadow] = useState(22);
  const [cameraMirror, setCameraMirror] = useState(false);
  const [cameraBlur, setCameraBlur] = useState(false);
  const [backgroundType, setBackgroundType] = useState<"gradient" | "wallpaper">("gradient");
  const [backgroundPreset, setBackgroundPreset] = useState(0);
  const [activeTab, setActiveTab] = useState<"camera" | "background" | "frame">("camera");
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
  const [previewSrc, setPreviewSrc] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [cameraPath, setCameraPath] = useState("");
  const [avatarSrc, setAvatarSrc] = useState("");
  const hasLoadedRef = useRef(false);
  const activeJobIdRef = useRef<string | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const avatarVideoRef = useRef<HTMLVideoElement | null>(null);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const wasPlayingRef = useRef(false);
  const isScrubbingRef = useRef(false);
  const previewAreaRef = useRef<HTMLDivElement | null>(null);
  const [previewBaseHeight, setPreviewBaseHeight] = useState(236);

  useEffect(() => {
    setOutputPath(localStorage.getItem("recordingOutputPath") ?? "");
    setCameraPath(localStorage.getItem("recordingCameraPath") ?? "");
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "recordingOutputPath") {
        setOutputPath(event.newValue ?? "");
      }
      if (event.key === "recordingCameraPath") {
        setCameraPath(event.newValue ?? "");
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (!outputPath) {
      return;
    }
    invoke<EditState>("load_edit_state", { outputPath })
      .then((state) => {
        const aspect =
          state.aspect === "1:1" || state.aspect === "9:16" ? state.aspect : "16:9";
        const cameraShapeValue =
          state.camera_shape === "rounded" || state.camera_shape === "square"
            ? state.camera_shape
            : "circle";
        const backgroundValue = state.background_type === "wallpaper" ? "wallpaper" : "gradient";
        setEditAspect(aspect);
        setEditPadding(state.padding);
        setEditRadius(state.radius);
        setEditShadow(state.shadow);
        setCameraSize(state.camera_size);
        setCameraShape(cameraShapeValue);
        setCameraShadow(state.camera_shadow);
        setCameraMirror(state.camera_mirror);
        setCameraBlur(state.camera_blur);
        setBackgroundType(backgroundValue);
        setBackgroundPreset(state.background_preset);
        hasLoadedRef.current = true;
      })
      .catch(() => {
        hasLoadedRef.current = true;
      });
  }, [outputPath]);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video) {
      return;
    }
    const handleLoaded = () => {
      setPreviewDuration(Number.isFinite(video.duration) ? video.duration : 0);
      video.currentTime = 0;
      video.pause();
      setPreviewPlaying(false);
      setPreviewTime(0);
    };
    const handleDuration = () => {
      setPreviewDuration(Number.isFinite(video.duration) ? video.duration : 0);
    };
    const handleTime = () => {
      if (!isScrubbingRef.current) {
        setPreviewTime(video.currentTime || 0);
      }
    };
    const handlePlay = () => setPreviewPlaying(true);
    const handlePause = () => setPreviewPlaying(false);
    const handleEnded = () => {
      video.pause();
      video.currentTime = 0;
      setPreviewPlaying(false);
      setPreviewTime(0);
      if (avatarVideoRef.current) {
        avatarVideoRef.current.pause();
        avatarVideoRef.current.currentTime = 0;
      }
    };
    const handleSeeked = () => {
      syncAvatarToPreview(video.currentTime || 0);
    };
    video.addEventListener("loadedmetadata", handleLoaded);
    video.addEventListener("durationchange", handleDuration);
    video.addEventListener("timeupdate", handleTime);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("seeked", handleSeeked);
    handleLoaded();
    return () => {
      video.removeEventListener("loadedmetadata", handleLoaded);
      video.removeEventListener("durationchange", handleDuration);
      video.removeEventListener("timeupdate", handleTime);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("seeked", handleSeeked);
    };
  }, [previewSrc]);

  useEffect(() => {
    if (!cameraPath) {
      setAvatarSrc("");
      return;
    }
    setAvatarSrc(convertFileSrc(cameraPath));
  }, [cameraPath]);

  useEffect(() => {
    if (!outputPath) {
      return;
    }
    setPreviewLoading(true);
    setPreviewError("");
    invoke<string>("ensure_preview", { outputPath })
      .then((path) => {
        setPreviewSrc(convertFileSrc(path));
      })
      .catch((error) => {
        setPreviewSrc("");
        setPreviewError(String(error));
      })
      .finally(() => {
        setPreviewLoading(false);
      });
  }, [outputPath]);

  useEffect(() => {
    if (!outputPath || !hasLoadedRef.current) {
      return;
    }
    const editState: EditState = {
      aspect: editAspect,
      padding: editPadding,
      radius: editRadius,
      shadow: editShadow,
      camera_size: cameraSize,
      camera_shape: cameraShape,
      camera_shadow: cameraShadow,
      camera_mirror: cameraMirror,
      camera_blur: cameraBlur,
      background_type: backgroundType,
      background_preset: backgroundPreset,
    };
    invoke("save_edit_state", { outputPath, editState }).catch(() => null);
  }, [
    outputPath,
    editPadding,
    editRadius,
    editShadow,
    editAspect,
    cameraSize,
    cameraShape,
    cameraShadow,
    cameraMirror,
    cameraBlur,
    backgroundType,
    backgroundPreset,
  ]);

  useEffect(() => {
    const unlistenPromise = listen<ExportStatus>("export_progress", (event) => {
      const status = event.payload;
      if (activeJobIdRef.current && status.job_id !== activeJobIdRef.current) {
        return;
      }
      setExportStatus(status);
      if (["completed", "failed", "cancelled"].includes(status.state)) {
        activeJobIdRef.current = null;
      }
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => null);
    };
  }, []);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const applyEditLayout = async () => {
      await appWindow.setDecorations(true);
      await appWindow.setResizable(false);
      await appWindow.setSize(new PhysicalSize(1600, 900));
    };
    applyEditLayout();
  }, []);

  useEffect(() => {
    const node = previewAreaRef.current;
    if (!node) {
      return;
    }
    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      if (!rect.width) {
        return;
      }
      const height = rect.width / (16 / 9);
      setPreviewBaseHeight(Math.round(height));
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const backgroundPresets = useMemo(
    () => ({
      gradients: [
        "linear-gradient(135deg, #6ee7ff 0%, #a855f7 50%, #f97316 100%)",
        "linear-gradient(135deg, #0f172a 0%, #1e40af 55%, #38bdf8 100%)",
        "linear-gradient(135deg, #111827 0%, #7c3aed 60%, #ec4899 100%)",
        "linear-gradient(135deg, #0b1020 0%, #0f766e 60%, #22d3ee 100%)",
      ],
      wallpapers: [
        "linear-gradient(135deg, #0f172a 0%, #1f2937 100%)",
        "linear-gradient(135deg, #0b1020 0%, #1f1b3a 55%, #2b1055 100%)",
        "linear-gradient(135deg, #1f2937 0%, #0f172a 50%, #111827 100%)",
        "linear-gradient(135deg, #0a0f1f 0%, #1d2a4a 50%, #0b1020 100%)",
      ],
    }),
    []
  );
  const previewBackground =
    backgroundType === "gradient"
      ? backgroundPresets.gradients[backgroundPreset % backgroundPresets.gradients.length]
      : backgroundPresets.wallpapers[backgroundPreset % backgroundPresets.wallpapers.length];

  const previewAspect = useMemo(() => {
    if (editAspect === "1:1") {
      return 1;
    }
    if (editAspect === "9:16") {
      return 9 / 16;
    }
    return 16 / 9;
  }, [editAspect]);
  const previewFrameHeight = previewBaseHeight;
  const previewFrameWidth = Math.round(previewFrameHeight * previewAspect);
  const exportDisabled =
    !outputPath || exportStatus?.state === "running" || exportStatus?.state === "queued";
  const cameraRadius =
    cameraShape === "circle" ? "9999px" : cameraShape === "rounded" ? "18px" : "6px";
  const exportStatusLabel = useMemo(() => {
    if (!exportStatus) {
      return "未导出";
    }
    if (exportStatus.state === "running") {
      return `导出中 ${Math.round(exportStatus.progress * 100)}%`;
    }
    if (exportStatus.state === "queued") {
      return "排队中";
    }
    if (exportStatus.state === "completed") {
      return "已完成";
    }
    if (exportStatus.state === "cancelled") {
      return "已取消";
    }
    if (exportStatus.error) {
      return `失败: ${exportStatus.error}`;
    }
    return "失败";
  }, [exportStatus]);

  const previewLabel = useMemo(() => {
    if (previewLoading) {
      return "生成预览中";
    }
    if (previewError) {
      return "预览生成失败";
    }
    return "";
  }, [previewError, previewLoading]);
  const previewSeekMax = Math.max(previewDuration, 0.001);
  const previewControlsDisabled = !previewSrc || previewLoading || !!previewError;

  const buildExportPath = (input: string) => {
    const sep = input.includes("\\") ? "\\" : "/";
    const index = input.lastIndexOf(sep);
    if (index === -1) {
      return "export.mp4";
    }
    return `${input.slice(0, index)}${sep}export.mp4`;
  };

  const profileForAspect = () => {
    if (editAspect === "1:1") {
      return { width: 1080, height: 1080 };
    }
    if (editAspect === "9:16") {
      return { width: 1080, height: 1920 };
    }
    return { width: 1920, height: 1080 };
  };

  const handleExport = async () => {
    if (!outputPath || exportDisabled) {
      return;
    }
    const size = profileForAspect();
    const editState: EditState = {
      aspect: editAspect,
      padding: editPadding,
      radius: editRadius,
      shadow: editShadow,
      camera_size: cameraSize,
      camera_shape: cameraShape,
      camera_shadow: cameraShadow,
      camera_mirror: cameraMirror,
      camera_blur: cameraBlur,
      background_type: backgroundType,
      background_preset: backgroundPreset,
    };
    try {
      const response = await invoke<{ job_id: string }>("start_export", {
        request: {
          input_path: outputPath,
          output_path: buildExportPath(outputPath),
          edit_state: editState,
          camera_path: cameraPath || null,
          profile: {
            format: "h264",
            width: size.width,
            height: size.height,
            fps: 60,
            bitrate_kbps: 12000,
          },
        },
      });
      activeJobIdRef.current = response.job_id;
      setExportStatus({
        job_id: response.job_id,
        state: "queued",
        progress: 0,
        error: null,
      });
    } catch (error) {
      setExportStatus({
        job_id: "",
        state: "failed",
        progress: 0,
        error: String(error),
      });
    }
  };
  const togglePreviewPlayback = () => {
    const video = previewVideoRef.current;
    if (!video || previewControlsDisabled) {
      return;
    }
    if (video.ended) {
      video.currentTime = 0;
    }
    if (video.paused) {
      video.play().catch(() => null);
      syncAvatarToPreview();
    } else {
      video.pause();
      syncAvatarToPreview();
    }
  };
  const syncAvatarToPreview = (time?: number) => {
    const avatarVideo = avatarVideoRef.current;
    const previewVideo = previewVideoRef.current;
    if (!avatarVideo || !previewVideo) {
      return;
    }
    const target = typeof time === "number" ? time : previewVideo.currentTime || 0;
    if (Number.isFinite(avatarVideo.duration) && target <= avatarVideo.duration) {
      avatarVideo.currentTime = target;
    } else {
      avatarVideo.currentTime = target;
    }
    if (previewVideo.paused || previewVideo.ended) {
      avatarVideo.pause();
    } else {
      avatarVideo.play().catch(() => null);
    }
  };
  const handlePreviewSeek = (value: number) => {
    const video = previewVideoRef.current;
    if (!video || previewControlsDisabled) {
      return;
    }
    video.currentTime = value;
    setPreviewTime(value);
    syncAvatarToPreview(value);
  };
  const startScrub = () => {
    if (previewControlsDisabled) {
      return;
    }
    isScrubbingRef.current = true;
    wasPlayingRef.current = previewPlaying;
    previewVideoRef.current?.pause();
    avatarVideoRef.current?.pause();
  };
  const endScrub = () => {
    if (!isScrubbingRef.current) {
      return;
    }
    isScrubbingRef.current = false;
    if (wasPlayingRef.current) {
      previewVideoRef.current?.play().catch(() => null);
      avatarVideoRef.current?.play().catch(() => null);
    }
  };
  const previewSurface = previewSrc ? (
    <video
      ref={previewVideoRef}
      className="h-full w-full object-contain"
      src={previewSrc}
      muted
      playsInline
    />
  ) : (
    <div className="flex h-full items-center justify-center text-[11px] text-slate-400">
      {previewLabel || "暂无预览"}
    </div>
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-3 py-3">
        <div className="flex flex-1 gap-2.5">
          <section className="flex min-w-0 flex-1 flex-col items-center gap-2.5 rounded-3xl border border-white/5 bg-slate-900/40 p-2.5 shadow-2xl">
            <div className="flex w-full items-center justify-between text-[11px] text-slate-400">
              <div className="flex items-center gap-1.5">
                {(["16:9", "1:1", "9:16"] as const).map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    onClick={() => setEditAspect(ratio)}
                    className={`rounded-full border px-2 py-0.5 ${
                      editAspect === ratio
                        ? "border-cyan-400/60 text-cyan-200"
                        : "border-white/10 text-slate-400"
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
              <div className="text-slate-500">Preview</div>
            </div>

            <div
              className="relative flex w-full items-center justify-center"
              ref={previewAreaRef}
              style={{ height: previewBaseHeight }}
            >
              <div
                className="relative flex items-center justify-center overflow-hidden rounded-3xl border border-white/5"
                style={{
                  width: previewFrameWidth,
                  height: previewFrameHeight,
                  background: previewBackground,
                }}
              >
                <div
                  className="relative flex h-full w-full items-center justify-center"
                  style={{
                    padding: editPadding,
                    borderRadius: editRadius,
                    boxShadow: `0 16px 40px rgba(0,0,0,${editShadow / 100})`,
                  }}
                >
                  <div className="relative h-full w-full overflow-hidden rounded-2xl">
                    {previewSurface}
                  </div>
                </div>
                <div
                  className="absolute bottom-3 left-3 overflow-hidden"
                  style={{
                    width: cameraSize,
                    height: cameraSize,
                    borderRadius: cameraRadius,
                    boxShadow: `0 16px 40px rgba(0,0,0,${cameraShadow / 120}), 0 0 0 1px rgba(255,255,255,0.1), inset 0 1px 0 rgba(255,255,255,0.25)`,
                    transform: cameraMirror ? "scaleX(-1)" : "none",
                    background: cameraBlur
                      ? "rgba(15, 23, 42, 0.25)"
                      : "rgba(15, 23, 42, 0.18)",
                    backdropFilter: cameraBlur ? "blur(18px) saturate(140%)" : "blur(10px)",
                  }}
                >
                  {avatarSrc ? (
                    <video
                      ref={avatarVideoRef}
                      className="h-full w-full object-cover"
                      src={avatarSrc}
                      muted
                      playsInline
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-gradient-to-br from-cyan-400/40 via-sky-500/20 to-indigo-500/40 text-[11px] font-semibold text-slate-100">
                      YOU
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={togglePreviewPlayback}
                  disabled={previewControlsDisabled}
                  className={`absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] ${
                    previewControlsDisabled
                      ? "border-white/10 bg-slate-900/50 text-slate-500"
                      : "border-white/10 bg-slate-950/70 text-slate-200"
                  }`}
                >
                  {previewPlaying ? <FiPause /> : <FiPlay />}
                  <span>{previewPlaying ? "暂停" : "播放"}</span>
                </button>
              
              </div>
            </div>

            <div className="flex w-full items-center justify-between text-[10px] text-slate-500">
              <span className="truncate">{outputPath || "D:\\recordings"}</span>
              <span>{errorMessage ? errorMessage : "Ready"}</span>
            </div>
            <div className="flex w-full items-center px-3 py-1.5">
              <input
                type="range"
                min={0}
                max={previewSeekMax}
                step={0.01}
                value={Math.min(previewTime, previewSeekMax)}
                onChange={(event) => handlePreviewSeek(Number(event.target.value))}
                onPointerDown={startScrub}
                onPointerUp={endScrub}
                onPointerCancel={endScrub}
                disabled={previewControlsDisabled}
                className="h-1.5 w-full cursor-pointer accent-cyan-400"
              />
            </div>
            <div className="flex w-full items-center justify-between text-[10px] text-slate-400">
              <button
                type="button"
                onClick={handleExport}
                disabled={exportDisabled}
                className={`rounded-full border px-3 py-1 ${
                  exportDisabled
                    ? "border-white/10 bg-slate-900/40 text-slate-500"
                    : "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
                }`}
              >
                导出
              </button>
              <span className="truncate">{exportStatusLabel}</span>
            </div>
          </section>

          <aside className="flex w-48 gap-2">
            <div className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-slate-900/60 p-1.5">
              <button
                type="button"
                onClick={() => setActiveTab("camera")}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
                  activeTab === "camera"
                    ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
                    : "border-white/10 bg-slate-950/60 text-slate-400"
                }`}
              >
                <FiCamera />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("background")}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
                  activeTab === "background"
                    ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
                    : "border-white/10 bg-slate-950/60 text-slate-400"
                }`}
              >
                <FiImage />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("frame")}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
                  activeTab === "frame"
                    ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
                    : "border-white/10 bg-slate-950/60 text-slate-400"
                }`}
              >
                <FiSliders />
              </button>
            </div>

            <div className="flex-1 rounded-2xl border border-white/5 bg-slate-900/60 p-2.5 text-xs text-slate-300">
              {activeTab === "camera" ? (
                <div className="space-y-3">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                    Camera
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <span>Size</span>
                      <span>{cameraSize}px</span>
                    </div>
                    <input
                      className="mt-2 w-full"
                      type="range"
                      min={80}
                      max={170}
                      value={cameraSize}
                      onChange={(event) => setCameraSize(Number(event.target.value))}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    {(["circle", "rounded", "square"] as const).map((shape) => (
                      <button
                        key={shape}
                        type="button"
                        onClick={() => setCameraShape(shape)}
                        className={`flex-1 rounded-full border px-2 py-1 ${
                          cameraShape === shape
                            ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
                            : "border-white/10 bg-slate-950/60 text-slate-400"
                        }`}
                      >
                        {shape}
                      </button>
                    ))}
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <span>Shadow</span>
                      <span>{cameraShadow}%</span>
                    </div>
                    <input
                      className="mt-2 w-full"
                      type="range"
                      min={0}
                      max={60}
                      value={cameraShadow}
                      onChange={(event) => setCameraShadow(Number(event.target.value))}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2">
                    <span>Mirror</span>
                    <button
                      type="button"
                      onClick={() => setCameraMirror((prev) => !prev)}
                      className={`h-5 w-10 rounded-full border transition ${
                        cameraMirror
                          ? "border-cyan-400/60 bg-cyan-400/30"
                          : "border-white/10 bg-slate-900/80"
                      }`}
                    >
                      <span
                        className={`block h-4 w-4 rounded-full bg-white transition ${
                          cameraMirror ? "translate-x-5" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2">
                    <span>Blur</span>
                    <button
                      type="button"
                      onClick={() => setCameraBlur((prev) => !prev)}
                      className={`h-5 w-10 rounded-full border transition ${
                        cameraBlur
                          ? "border-cyan-400/60 bg-cyan-400/30"
                          : "border-white/10 bg-slate-900/80"
                      }`}
                    >
                      <span
                        className={`block h-4 w-4 rounded-full bg-white transition ${
                          cameraBlur ? "translate-x-5" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              ) : null}

              {activeTab === "background" ? (
                <div className="space-y-3">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                    Background
                  </div>
                  <div className="flex items-center gap-2">
                    {(["gradient", "wallpaper"] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setBackgroundType(type)}
                        className={`flex-1 rounded-full border px-2 py-1 ${
                          backgroundType === type
                            ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
                            : "border-white/10 bg-slate-950/60 text-slate-400"
                        }`}
                      >
                        {type === "gradient" ? "Gradient" : "Wallpaper"}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(backgroundType === "gradient"
                      ? backgroundPresets.gradients
                      : backgroundPresets.wallpapers
                    ).map((preset, index) => (
                      <button
                        key={`${backgroundType}-${preset}`}
                        type="button"
                        onClick={() => setBackgroundPreset(index)}
                        className={`h-10 rounded-xl border ${
                          backgroundPreset === index
                            ? "border-cyan-400/60"
                            : "border-white/10"
                        }`}
                        style={{ background: preset }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {activeTab === "frame" ? (
                <div className="space-y-3">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                    Frame
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <span>Padding</span>
                      <span>{editPadding}px</span>
                    </div>
                    <input
                      className="mt-2 w-full"
                      type="range"
                      min={0}
                      max={60}
                      value={editPadding}
                      onChange={(event) => setEditPadding(Number(event.target.value))}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <span>Radius</span>
                      <span>{editRadius}px</span>
                    </div>
                    <input
                      className="mt-2 w-full"
                      type="range"
                      min={0}
                      max={28}
                      value={editRadius}
                      onChange={(event) => setEditRadius(Number(event.target.value))}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <span>Shadow</span>
                      <span>{editShadow}%</span>
                    </div>
                    <input
                      className="mt-2 w-full"
                      type="range"
                      min={0}
                      max={50}
                      value={editShadow}
                      onChange={(event) => setEditShadow(Number(event.target.value))}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<EditPage />);
