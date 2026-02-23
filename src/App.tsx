import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { FiCamera, FiChevronDown, FiMic, FiMonitor, FiPlay, FiVideo } from "react-icons/fi";
import "./App.css";

type SelectOption = {
  value: string;
  label: string;
};

type CaptureMode = "screen" | "window" | "region";

type CaptureRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type RegionSelectionPayload = {
  id: number;
  status: "selected" | "cancel";
  region?: CaptureRegion;
};

const REGION_SELECTION_KEY = "regionSelection";

type SelectMenuProps = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  icon: ReactNode;
};

function SelectMenu({ value, options, onChange, icon }: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const current = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!rootRef.current) {
        return;
      }
      if (rootRef.current.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={rootRef}>
      <button
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-800/80 bg-slate-950/90 px-3 py-2.5 text-left transition hover:border-slate-700/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/30"
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex items-center gap-3">
          {icon}
          <span className="text-sm font-medium text-slate-100">
            {current ? current.label : ""}
          </span>
        </span>
        <FiChevronDown
          className={`h-4 w-4 text-slate-500 transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div
          className="absolute left-0 right-0 z-50 mt-2 rounded-2xl border border-slate-800/80 bg-slate-950/95 p-1 shadow-2xl backdrop-blur"
          role="listbox"
        >
          <div className="max-h-56 overflow-auto">
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                    selected
                      ? "bg-slate-800/80 text-white"
                      : "text-slate-200 hover:bg-slate-800/60"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RegionPicker() {
  const [selectionRect, setSelectionRect] = useState<CaptureRegion | null>(null);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const selectionRectRef = useRef<CaptureRegion | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const apply = async () => {
      await appWindow.show();
      await appWindow.setFocus();
      await appWindow.setDecorations(false);
      await appWindow.setResizable(false);
      await appWindow.setAlwaysOnTop(true);
      await appWindow.setFullscreen(true);
    };
    apply().catch((error) => setErrorMessage(String(error)));
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      document.documentElement.style.background = "";
      document.body.style.background = "";
    };
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const payload: RegionSelectionPayload = { id: Date.now(), status: "cancel" };
        localStorage.setItem(REGION_SELECTION_KEY, JSON.stringify(payload));
        getCurrentWindow()
          .close()
          .catch((error) => setErrorMessage(String(error)));
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const finishSelection = async (rect: CaptureRegion) => {
    const ratio = window.devicePixelRatio || 1;
    const payload: RegionSelectionPayload = {
      id: Date.now(),
      status: "selected",
      region: {
        x: Math.round((window.screenX + rect.x) * ratio),
        y: Math.round((window.screenY + rect.y) * ratio),
        width: Math.round(rect.width * ratio),
        height: Math.round(rect.height * ratio),
      },
    };
    localStorage.setItem(REGION_SELECTION_KEY, JSON.stringify(payload));
    await getCurrentWindow().close();
  };

  return (
    <main
      className="fixed inset-0 z-50 cursor-crosshair bg-transparent"
      onMouseDown={(event) => {
        selectionStartRef.current = { x: event.clientX, y: event.clientY };
        const rect = {
          x: event.clientX,
          y: event.clientY,
          width: 0,
          height: 0,
        };
        selectionRectRef.current = rect;
        setSelectionRect(rect);
      }}
      onMouseMove={(event) => {
        if (!selectionStartRef.current) {
          return;
        }
        const start = selectionStartRef.current;
        const x = Math.min(start.x, event.clientX);
        const y = Math.min(start.y, event.clientY);
        const width = Math.abs(event.clientX - start.x);
        const height = Math.abs(event.clientY - start.y);
        const rect = { x, y, width, height };
        selectionRectRef.current = rect;
        setSelectionRect(rect);
      }}
      onMouseUp={async () => {
        const rect = selectionRectRef.current;
        if (!rect || rect.width < 10 || rect.height < 10) {
          const payload: RegionSelectionPayload = { id: Date.now(), status: "cancel" };
          localStorage.setItem(REGION_SELECTION_KEY, JSON.stringify(payload));
          await getCurrentWindow().close();
          return;
        }
        await finishSelection(rect);
      }}
    >
      {selectionRect ? (
        <div
          className="absolute rounded-md border-2 border-cyan-400 bg-cyan-400/10"
          style={{
            left: selectionRect.x,
            top: selectionRect.y,
            width: selectionRect.width,
            height: selectionRect.height,
          }}
        />
      ) : null}
      <div className="absolute left-6 top-6 rounded-full border border-white/10 bg-slate-950/80 px-4 py-2 text-xs text-slate-200">
        拖拽选择区域，按 Esc 取消
      </div>
      {errorMessage ? (
        <div className="absolute bottom-6 left-6 rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-200">
          {errorMessage}
        </div>
      ) : null}
    </main>
  );
}

function MainApp() {
  const [isRecording, setIsRecording] = useState(false);
  const [camera, setCamera] = useState("auto");
  const [mic, setMic] = useState("auto");
  const [viewMode, setViewMode] = useState<"record" | "edit">("record");
  const [outputPath, setOutputPath] = useState("");
  const [logPath, setLogPath] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [audioDevices, setAudioDevices] = useState<string[]>([]);
  const [videoDevices, setVideoDevices] = useState<string[]>([]);
  const [captureMode, setCaptureMode] = useState<CaptureMode>("screen");
  const [windowOptions, setWindowOptions] = useState<string[]>([]);
  const [windowPickerOpen, setWindowPickerOpen] = useState(false);
  const awaitingRegionRef = useRef(false);
  const [pendingRegion, setPendingRegion] = useState<CaptureRegion | null>(null);
  const [editPadding, setEditPadding] = useState(48);
  const [editRadius, setEditRadius] = useState(24);
  const [editShadow, setEditShadow] = useState(40);
  const [editAspect, setEditAspect] = useState<"16:9" | "1:1" | "9:16">("16:9");
  const [cameraSize, setCameraSize] = useState(180);
  const [cameraShape, setCameraShape] = useState<"circle" | "rounded" | "square">("circle");
  const [cameraShadow, setCameraShadow] = useState(45);
  const [cameraMirror, setCameraMirror] = useState(false);
  const [cameraBlur, setCameraBlur] = useState(false);
  const [backgroundType, setBackgroundType] = useState<"gradient" | "wallpaper">("gradient");
  const [backgroundPreset, setBackgroundPreset] = useState(0);

  const updateAwaitingRegion = (value: boolean) => {
    awaitingRegionRef.current = value;
  };

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

  const startRecording = async (options?: {
    captureMode?: CaptureMode;
    windowTitle?: string;
    region?: CaptureRegion;
  }) => {
    setErrorMessage("");
    try {
      const response = await invoke<{
        output_path: string;
        log_path: string;
        preview_url?: string | null;
      }>("start_recording", {
        request: {
          resolution: "1080p",
          fps: 60,
          format: "h264",
          mic_device: mic,
          camera_device: camera,
          capture_mode: options?.captureMode ?? "screen",
          window_title: options?.windowTitle ?? null,
          region: options?.region ?? null,
        },
      });
      const startedAt = Date.now();
      localStorage.setItem("recordingActive", "1");
      localStorage.setItem("recordingStart", startedAt.toString());
      localStorage.setItem("selectedCamera", camera);
      localStorage.setItem("selectedMic", mic);
      localStorage.setItem("recordingOutputPath", response.output_path);
      localStorage.setItem("recordingLogPath", response.log_path);
      if (response.preview_url) {
        localStorage.setItem("recordingPreviewUrl", response.preview_url);
      } else {
        localStorage.removeItem("recordingPreviewUrl");
      }
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
    if (captureMode === "window") {
      await openWindowPicker();
      return;
    }
    if (captureMode === "region") {
      await openRegionPicker();
      return;
    }
    await startRecording({ captureMode: "screen" });
  };

  const openWindowPicker = async () => {
    setErrorMessage("");
    try {
      const windows = await invoke<string[]>("list_windows");
      setWindowOptions(windows);
      setWindowPickerOpen(true);
    } catch (error) {
      setErrorMessage(String(error));
    }
  };

  const openRegionPicker = async () => {
    if (awaitingRegionRef.current) {
      return;
    }
    updateAwaitingRegion(true);
    const appWindow = getCurrentWindow();
    try {
      await appWindow.hide();
      const existing = await WebviewWindow.getByLabel("region-picker");
      if (existing) {
        await existing.show();
        await existing.setFocus();
        return;
      }
      new WebviewWindow("region-picker", {
        url: "/index.html?mode=region-picker",
        width: window.screen.width,
        height: window.screen.height,
        x: 0,
        y: 0,
        resizable: false,
        decorations: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        fullscreen: true,
        transparent: true,
        backgroundColor: "#00000000",
        title: "Region Picker",
      });
    } catch (error) {
      updateAwaitingRegion(false);
      await appWindow.show();
      await appWindow.setFocus();
      setErrorMessage(String(error));
    }
  };

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
      if (event.key === REGION_SELECTION_KEY && event.newValue) {
        if (!awaitingRegionRef.current) {
          return;
        }
        let payload: RegionSelectionPayload | null = null;
        try {
          payload = JSON.parse(event.newValue) as RegionSelectionPayload;
        } catch {
          payload = null;
        }
        updateAwaitingRegion(false);
        const appWindow = getCurrentWindow();
        if (!payload || payload.status === "cancel" || !payload.region) {
          appWindow.show().then(() => appWindow.setFocus()).catch(() => null);
          return;
        }
        setPendingRegion(payload.region);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (!pendingRegion) {
      return;
    }
    startRecording({ captureMode: "region", region: pendingRegion }).catch((error) =>
      setErrorMessage(String(error))
    );
    setPendingRegion(null);
  }, [pendingRegion, startRecording]);

  if (viewMode === "edit") {
    const aspectMap = {
      "16:9": 16 / 9,
      "1:1": 1,
      "9:16": 9 / 16,
    };
    const previewWidth = 760;
    const previewHeight = previewWidth / aspectMap[editAspect];
    const gradients = [
      "linear-gradient(135deg, #6ee7ff 0%, #a855f7 50%, #f97316 100%)",
      "linear-gradient(135deg, #0f172a 0%, #1e40af 55%, #38bdf8 100%)",
      "linear-gradient(135deg, #111827 0%, #7c3aed 60%, #ec4899 100%)",
      "linear-gradient(135deg, #0b1020 0%, #0f766e 60%, #22d3ee 100%)",
    ];
    const wallpapers = [
      "linear-gradient(135deg, #0f172a 0%, #1f2937 100%)",
      "linear-gradient(135deg, #0b1020 0%, #1f1b3a 55%, #2b1055 100%)",
      "linear-gradient(135deg, #1f2937 0%, #0f172a 50%, #111827 100%)",
      "linear-gradient(135deg, #0a0f1f 0%, #1d2a4a 50%, #0b1020 100%)",
    ];
    const previewBackground =
      backgroundType === "gradient"
        ? gradients[backgroundPreset % gradients.length]
        : wallpapers[backgroundPreset % wallpapers.length];
    const cameraRadius =
      cameraShape === "circle" ? "9999px" : cameraShape === "rounded" ? "18px" : "6px";
    const cameraShadowValue = `0 16px 40px rgba(0,0,0,${cameraShadow / 100})`;

    return (
      <main className="min-h-screen bg-slate-950 text-slate-100">
        <div className="flex min-h-screen flex-col">
          <header className="flex items-center justify-between border-b border-white/5 bg-slate-950/80 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/80 to-blue-500/80 text-slate-950">
                <FiVideo />
              </div>
              <div>
                <div className="text-lg font-semibold">Flash Recorder</div>
                <div className="text-xs text-slate-400">编辑视频</div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <button className="rounded-full border border-white/10 bg-slate-900/70 px-3 py-1.5 hover:border-white/20">
                Rename
              </button>
              <button className="rounded-full border border-white/10 bg-slate-900/70 px-3 py-1.5 hover:border-white/20">
                Presets
              </button>
              <button className="rounded-full border border-white/10 bg-slate-900/70 px-3 py-1.5 hover:border-white/20">
                Export
              </button>
              <button
                className="rounded-full border border-white/10 bg-slate-900/70 px-3 py-1.5 text-slate-200 hover:border-white/20"
                type="button"
                onClick={() => setViewMode("record")}
              >
                返回录制
              </button>
            </div>
          </header>

          <div className="flex flex-1 gap-6 px-6 py-6">
            <section className="flex flex-1 flex-col gap-4 rounded-3xl border border-white/5 bg-slate-900/40 p-6 shadow-2xl">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Screen Recording</span>
                <div className="flex items-center gap-2">
                  {(["16:9", "1:1", "9:16"] as const).map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => setEditAspect(ratio)}
                      className={`rounded-full border px-3 py-1 ${
                        editAspect === ratio
                          ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
                          : "border-white/10 bg-slate-950/50 text-slate-400"
                      }`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              </div>
              <div
                className="relative flex w-full items-center justify-center rounded-3xl border border-white/5"
                style={{ background: previewBackground }}
              >
                <div
                  className="relative flex items-center justify-center bg-slate-950/80"
                  style={{
                    width: previewWidth,
                    height: previewHeight,
                    padding: editPadding,
                    borderRadius: editRadius,
                    boxShadow: `0 30px 80px rgba(0,0,0,${editShadow / 100})`,
                  }}
                >
                  <div className="h-full w-full rounded-2xl border border-white/10 bg-slate-900/80">
                    <div className="flex h-full items-center justify-center text-xs text-slate-400">
                      录制预览区域
                    </div>
                  </div>
                  <div
                    className="absolute bottom-6 left-6 overflow-hidden"
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
                    <div className="flex h-full items-center justify-center text-xs text-slate-300">
                      Camera
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/5 bg-slate-950/60 p-4 text-xs text-slate-400">
                <div className="flex items-center justify-between">
                  <span>导出文件</span>
                  <button className="rounded-full border border-white/10 bg-slate-900/60 px-3 py-1">
                    Crop video
                  </button>
                </div>
                <div className="mt-2 text-sm text-slate-200">{outputPath || "D:\\recordings"}</div>
                {logPath ? <div className="mt-1 text-xs text-slate-500">{logPath}</div> : null}
                {errorMessage ? (
                  <div className="mt-2 text-xs text-red-300">{errorMessage}</div>
                ) : null}
              </div>

              <div className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-slate-950/70 p-4 text-xs text-slate-400">
                <div className="flex items-center justify-between">
                  <span>Timeline</span>
                  <div className="text-slate-500">00:00 / 00:30</div>
                </div>
                <div className="relative h-2 rounded-full bg-slate-800">
                  <div className="h-2 w-1/2 rounded-full bg-cyan-400/70" />
                </div>
                <div className="space-y-2">
                  <div className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-cyan-200">
                    Clip · 100% · 1.0x
                  </div>
                  <div className="rounded-lg border border-violet-400/30 bg-violet-400/10 px-3 py-2 text-violet-200">
                    Camera overlay · 100% · 1.0x
                  </div>
                </div>
              </div>
            </section>

            <aside className="w-[320px] space-y-4">
              <div className="rounded-2xl border border-white/5 bg-slate-900/60 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Shape & Scale
                </div>
                <div className="mt-4 space-y-4 text-xs text-slate-300">
                  <div>
                    <div className="flex items-center justify-between">
                      <span>Padding</span>
                      <span>{editPadding}px</span>
                    </div>
                    <input
                      className="mt-2 w-full"
                      type="range"
                      min={0}
                      max={120}
                      value={editPadding}
                      onChange={(event) => setEditPadding(Number(event.target.value))}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <span>Border Radius</span>
                      <span>{editRadius}px</span>
                    </div>
                    <input
                      className="mt-2 w-full"
                      type="range"
                      min={0}
                      max={48}
                      value={editRadius}
                      onChange={(event) => setEditRadius(Number(event.target.value))}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/5 bg-slate-900/60 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Shadow</div>
                <div className="mt-4 text-xs text-slate-300">
                  <div className="flex items-center justify-between">
                    <span>Shadow Alpha</span>
                    <span>{editShadow}%</span>
                  </div>
                  <input
                    className="mt-2 w-full"
                    type="range"
                    min={0}
                    max={80}
                    value={editShadow}
                    onChange={(event) => setEditShadow(Number(event.target.value))}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-white/5 bg-slate-900/60 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Camera</div>
                <div className="mt-4 space-y-4 text-xs text-slate-300">
                  <div>
                    <div className="flex items-center justify-between">
                      <span>Size</span>
                      <span>{cameraSize}px</span>
                    </div>
                    <input
                      className="mt-2 w-full"
                      type="range"
                      min={100}
                      max={260}
                      value={cameraSize}
                      onChange={(event) => setCameraSize(Number(event.target.value))}
                    />
                  </div>
                  <div>
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
                      max={80}
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
              </div>

              <div className="rounded-2xl border border-white/5 bg-slate-900/60 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Background</div>
                <div className="mt-4 space-y-3 text-xs text-slate-300">
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
                    {(backgroundType === "gradient" ? gradients : wallpapers).map(
                      (preset, index) => (
                        <button
                          key={`${backgroundType}-${preset}`}
                          type="button"
                          onClick={() => setBackgroundPreset(index)}
                          className={`h-14 rounded-xl border ${
                            backgroundPreset === index
                              ? "border-cyan-400/60"
                              : "border-white/10"
                          }`}
                          style={{ background: preset }}
                        />
                      )
                    )}
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>
    );
  }

  const cameraOptions: SelectOption[] = [
    { value: "no-camera", label: "关闭摄像头" },
    { value: "auto", label: "默认摄像头" },
    ...videoDevices.map((device) => ({ value: device, label: device })),
  ];

  const micOptions: SelectOption[] = [
    { value: "mute", label: "静音" },
    { value: "auto", label: "自动选择" },
    ...audioDevices.map((device) => ({ value: device, label: device })),
  ];

  const captureOptions: SelectOption[] = [
    { value: "screen", label: "屏幕录制" },
    { value: "window", label: "窗口录制" },
    { value: "region", label: "区域录制" },
  ];

  return (
    <main className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-100">
      <div className="h-full w-full">
        <div className="flex h-full w-full flex-col gap-3 rounded-[28px] border border-slate-800/80 bg-slate-950/70 px-4 py-4 shadow-2xl">
          <header className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/80 to-blue-500/80 text-slate-950">
              <FiVideo />
            </div>
            <div>
              <div className="text-lg font-semibold">Flash Recorder</div>
              <div className="text-xs text-slate-400">全屏录制 · 极简模式</div>
            </div>
          </header>

          <section className="flex flex-1 flex-col gap-3">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">录制控制</div>

            <button
              className="flex items-center justify-center gap-3 rounded-2xl bg-slate-100 px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
              type="button"
              onClick={handleToggleRecord}
              disabled={isRecording}
            >
              <FiPlay />
              {isRecording ? "录制中" : "开始录制"}
            </button>

            <div className="space-y-3">
              <SelectMenu
                value={captureMode}
                options={captureOptions}
                onChange={(value) => setCaptureMode(value as CaptureMode)}
                icon={<FiMonitor className="text-slate-500" />}
              />
              <SelectMenu
                value={camera}
                options={cameraOptions}
                onChange={setCamera}
                icon={<FiCamera className="text-slate-500" />}
              />
              <SelectMenu
                value={mic}
                options={micOptions}
                onChange={setMic}
                icon={<FiMic className="text-slate-500" />}
              />
            </div>

            <div className="rounded-xl border border-slate-800/80 bg-slate-950/70 px-3 py-2 text-xs text-slate-400">
              {outputPath || "D:\\recordings"}
              {logPath ? <div className="mt-2">{logPath}</div> : null}
              {errorMessage ? <div className="mt-2 text-red-300">{errorMessage}</div> : null}
            </div>
          </section>
        </div>
      </div>
      {windowPickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-[360px] rounded-2xl border border-white/10 bg-slate-950/95 p-4 shadow-2xl">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">选择窗口</div>
            <div className="mt-3 max-h-64 overflow-auto">
              {windowOptions.length === 0 ? (
                <div className="rounded-xl border border-slate-800/80 bg-slate-950/70 px-3 py-2 text-xs text-slate-400">
                  未发现可录制窗口
                </div>
              ) : (
                windowOptions.map((title) => (
                  <button
                    key={title}
                    type="button"
                    className="mb-2 w-full rounded-xl border border-slate-800/80 bg-slate-950/80 px-3 py-2 text-left text-sm text-slate-100 transition hover:border-slate-700/80 hover:bg-slate-900/80"
                    onClick={async () => {
                      setWindowPickerOpen(false);
                      await startRecording({ captureMode: "window", windowTitle: title });
                    }}
                  >
                    {title}
                  </button>
                ))
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="rounded-full border border-white/10 bg-slate-900/70 px-4 py-2 text-xs text-slate-300 transition hover:border-white/20"
                onClick={() => setWindowPickerOpen(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function App() {
  const isRegionPicker = useMemo(
    () => new URLSearchParams(window.location.search).get("mode") === "region-picker",
    []
  );
  return isRegionPicker ? <RegionPicker /> : <MainApp />;
}

export default App;
