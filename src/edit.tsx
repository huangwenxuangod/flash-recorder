import { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalSize } from "@tauri-apps/api/window";
import { FiCamera, FiImage, FiSliders } from "react-icons/fi";
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
  const [editPadding, setEditPadding] = useState(18);
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

  const previewFrameWidth = 420;
  const previewFrameHeight = 236;
  const exportDisabled =
    !outputPath || exportStatus?.state === "running" || exportStatus?.state === "queued";
  const stageSize = useMemo(() => {
    const aspectMap = {
      "16:9": 16 / 9,
      "1:1": 1,
      "9:16": 9 / 16,
    };
    const aspect = aspectMap[editAspect];
    let width = previewFrameWidth;
    let height = previewFrameWidth / aspect;
    if (height > previewFrameHeight) {
      height = previewFrameHeight;
      width = previewFrameHeight * aspect;
    }
    return {
      width: Math.round(width),
      height: Math.round(height),
    };
  }, [editAspect]);
  const cameraRadius =
    cameraShape === "circle" ? "9999px" : cameraShape === "rounded" ? "18px" : "6px";
  const cameraShadowValue = `0 12px 30px rgba(0,0,0,${cameraShadow / 100})`;
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
          inputPath: outputPath,
          outputPath: buildExportPath(outputPath),
          editState,
          profile: {
            format: "h264",
            width: size.width,
            height: size.height,
            fps: 60,
            bitrateKbps: 8000,
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
                        ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
                        : "border-white/10 bg-slate-950/50 text-slate-400"
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
              <div className="text-slate-500">Preview</div>
            </div>

            <div
              className="relative flex items-center justify-center rounded-3xl border border-white/5 bg-slate-950/40"
              style={{ width: previewFrameWidth, height: previewFrameHeight }}
            >
              <div
                className="relative flex items-center justify-center rounded-3xl"
                style={{
                  width: stageSize.width,
                  height: stageSize.height,
                  background: previewBackground,
                }}
              >
                <div
                  className="relative flex h-full w-full items-center justify-center bg-slate-950/80"
                  style={{
                    padding: editPadding,
                    borderRadius: editRadius,
                    boxShadow: `0 16px 40px rgba(0,0,0,${editShadow / 100})`,
                  }}
                >
                  <div className="h-full w-full rounded-2xl border border-white/10 bg-slate-900/80">
                    <div className="relative h-full w-full overflow-hidden rounded-2xl">
                      {previewSrc ? (
                        <video
                          className="h-full w-full object-cover"
                          src={previewSrc}
                          autoPlay
                          muted
                          loop
                          playsInline
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[11px] text-slate-400">
                          {previewLabel || "暂无预览"}
                        </div>
                      )}
                    </div>
                  </div>
                  <div
                    className="absolute bottom-3 left-3 overflow-hidden"
                    style={{
                      width: cameraSize,
                      height: cameraSize,
                      borderRadius: cameraRadius,
                      boxShadow: cameraShadowValue,
                      transform: cameraMirror ? "scaleX(-1)" : "none",
                      background: cameraBlur
                        ? "rgba(15, 23, 42, 0.5)"
                        : "rgba(15, 23, 42, 0.8)",
                      backdropFilter: cameraBlur ? "blur(16px)" : "none",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    {avatarSrc ? (
                      <video
                        className="h-full w-full object-cover"
                        src={avatarSrc}
                        autoPlay
                        muted
                        loop
                        playsInline
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-gradient-to-br from-cyan-400/40 via-sky-500/20 to-indigo-500/40 text-[11px] font-semibold text-slate-100">
                        YOU
                      </div>
                    )}
                  </div>
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between rounded-full border border-white/10 bg-slate-950/70 px-2.5 py-1 text-[10px] text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                      00:00
                    </span>
                    <span>{editAspect}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex w-full items-center justify-between text-[10px] text-slate-500">
              <span className="truncate">{outputPath || "D:\\recordings"}</span>
              <span>{errorMessage ? errorMessage : "Ready"}</span>
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
