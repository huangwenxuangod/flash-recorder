import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow, PhysicalSize } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { FiCamera, FiFolder, FiMic, FiMonitor, FiPlay, FiSettings, FiVideo } from "react-icons/fi";
import "./App.css";
import { SelectMenu, type SelectOption } from "./components/SelectMenu";
import { Switch } from "@headlessui/react";

type CaptureMode = "screen" | "window" | "region";

type CaptureRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type AppSettings = {
  exportDir: string;
  fps: number;
  resolution: number;
  autostart: boolean;
};

type RegionSelectionPayload = {
  id: number;
  status: "selected" | "cancel";
  region?: CaptureRegion;
};

const REGION_SELECTION_KEY = "regionSelection";
const SETTINGS_EXPORT_DIR = "settingsExportDir";
const SETTINGS_FPS = "settingsFps";
const SETTINGS_RESOLUTION = "settingsResolution";
const SETTINGS_AUTOSTART = "settingsAutostart";

const defaultSettings = (): AppSettings => ({
  exportDir: localStorage.getItem(SETTINGS_EXPORT_DIR) ?? "",
  fps: Number(localStorage.getItem(SETTINGS_FPS) ?? 60),
  resolution: Number(localStorage.getItem(SETTINGS_RESOLUTION) ?? 1080),
  autostart: localStorage.getItem(SETTINGS_AUTOSTART) === "1",
});

const resolutionLabel = (value: number) => {
  if (value === 2160) {
    return "4K (2160p)";
  }
  return `${value}p`;
};

const resolutionValue = (value: number) => `${value}p`;


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
  const [, setOutputPath] = useState("");
  const [, setLogPath] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [audioDevices, setAudioDevices] = useState<string[]>([]);
  const [videoDevices, setVideoDevices] = useState<string[]>([]);
  const [captureMode, setCaptureMode] = useState<CaptureMode>("screen");
  const [windowOptions, setWindowOptions] = useState<string[]>([]);
  const [windowPickerOpen, setWindowPickerOpen] = useState(false);
  const awaitingRegionRef = useRef(false);
  const [pendingRegion, setPendingRegion] = useState<CaptureRegion | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => defaultSettings());
  const [view, setView] = useState<"main" | "settings">("main");
  const [autostartLoading, setAutostartLoading] = useState(true);
  const [defaultExportDir, setDefaultExportDir] = useState("");

  const fpsOptions = [24, 30, 60];
  const resolutionOptions = [720, 1080, 1440, 2160];
  const fpsSelectOptions: SelectOption[] = fpsOptions.map((value) => ({
    value: String(value),
    label: `${value} FPS`,
  }));
  const resolutionSelectOptions: SelectOption[] = resolutionOptions.map((value) => ({
    value: String(value),
    label: resolutionLabel(value),
  }));

  const ellipsizePath = (p: string) => {
    if (!p) return "";
    if (p.length <= 40) return p;
    const sep = p.includes("\\") ? "\\" : "/";
    const parts = p.split(sep).filter((s) => s.length > 0);
    if (parts.length <= 3) {
      const head = p.slice(0, 18);
      const tail = p.slice(-18);
      return `${head}...${tail}`;
    }
    const left = parts.slice(0, 2).join(sep);
    const right = parts.slice(-2).join(sep);
    const prefix = p.startsWith(sep) ? sep : "";
    return `${prefix}${left}${sep}...${sep}${right}`;
  };

  const updateAwaitingRegion = (value: boolean) => {
    awaitingRegionRef.current = value;
  };

  useEffect(() => {
    invoke<string[]>("list_audio_devices")
      .then((devices) => setAudioDevices(devices))
      .catch((error) => setErrorMessage(String(error)));
  }, []);
  useEffect(() => {
    invoke<string>("get_export_dir")
      .then((dir) => setDefaultExportDir(dir))
      .catch(() => null);
  }, []);

  useEffect(() => {
    invoke<string[]>("list_video_devices")
      .then((devices) => setVideoDevices(devices))
      .catch((error) => setErrorMessage(String(error)));
  }, []);

  useEffect(() => {
    let mounted = true;
    isEnabled()
      .then((enabled: boolean) => {
        if (!mounted) {
          return;
        }
        setSettings((prev) => ({ ...prev, autostart: enabled }));
        setAutostartLoading(false);
      })
      .catch(() => {
        if (!mounted) {
          return;
        }
        setAutostartLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const updateSetting = (next: Partial<AppSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...next };
      if ("exportDir" in next) {
        localStorage.setItem(SETTINGS_EXPORT_DIR, updated.exportDir);
      }
      if ("fps" in next) {
        localStorage.setItem(SETTINGS_FPS, String(updated.fps));
      }
      if ("resolution" in next) {
        localStorage.setItem(SETTINGS_RESOLUTION, String(updated.resolution));
      }
      if ("autostart" in next) {
        localStorage.setItem(SETTINGS_AUTOSTART, updated.autostart ? "1" : "0");
      }
      return updated;
    });
  };

  const toggleAutostart = async () => {
    if (autostartLoading) {
      return;
    }
    const target = !settings.autostart;
    setAutostartLoading(true);
    try {
      if (target) {
        await enable();
      } else {
        await disable();
      }
      updateSetting({ autostart: target });
    } catch (error) {
      setErrorMessage(String(error));
    } finally {
      setAutostartLoading(false);
    }
  };

  const resetSettings = async () => {
    localStorage.removeItem(SETTINGS_EXPORT_DIR);
    localStorage.removeItem(SETTINGS_FPS);
    localStorage.removeItem(SETTINGS_RESOLUTION);
    localStorage.removeItem(SETTINGS_AUTOSTART);
    setAutostartLoading(true);
    try {
      await disable();
    } catch {
    } finally {
      setAutostartLoading(false);
    }
    setSettings({ exportDir: "", fps: 60, resolution: 1080, autostart: false });
  };

  const chooseExportDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择导出文件夹",
      });
      if (typeof selected === "string") {
        updateSetting({ exportDir: selected });
      }
    } catch (error) {
      setErrorMessage(String(error));
    }
  };

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
    const posY = Math.max(20, window.screen.availHeight - miniHeight - (20 + 32));
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

  const openEditWindow = async () => {
    const scaleFactor = await getCurrentWindow().scaleFactor();
    const editWidth = Math.max(960, Math.round(1600 / scaleFactor));
    const editHeight = Math.max(720, Math.round(900 / scaleFactor));
    const existing = await WebviewWindow.getByLabel("edit");
    if (existing) {
      await existing.setResizable(false);
      await existing.setSize(new PhysicalSize(1600, 900));
      await existing.show();
      await existing.setFocus();
      await getCurrentWindow().hide();
      return;
    }
    new WebviewWindow("edit", {
      url: "/edit.html",
      width: editWidth,
      height: editHeight,
      resizable: false,
      decorations: true,
      alwaysOnTop: false,
      skipTaskbar: false,
      title: "Edit",
    });
    await getCurrentWindow().hide();
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
        camera_path?: string | null;
      }>("start_recording", {
        request: {
          resolution: resolutionValue(settings.resolution),
          fps: settings.fps,
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
      if (response.camera_path) {
        localStorage.setItem("recordingCameraPath", response.camera_path);
      } else {
        localStorage.removeItem("recordingCameraPath");
      }
      localStorage.removeItem("recordingFinished");
      setOutputPath(response.output_path);
      setLogPath(response.log_path);
      setIsRecording(true);
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
        setOutputPath(localStorage.getItem("recordingOutputPath") ?? "");
        setLogPath(localStorage.getItem("recordingLogPath") ?? "");
        localStorage.removeItem("recordingFinished");
        const appWindow = getCurrentWindow();
        appWindow.show().then(() => appWindow.setFocus()).catch(() => null);
        openEditWindow().catch((error) => setErrorMessage(String(error)));
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
          {view === "settings" ? (
            <>
              <header className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/80 to-blue-500/80 text-slate-950">
                    <FiSettings />
                  </div>
                  <div>
                    <div className="text-lg font-semibold">设置</div>
                    <div className="text-xs text-slate-400">导出与系统偏好</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setView("main")}
                  className="rounded-full border border-white/10 bg-slate-900/60 px-3 py-1 text-xs text-slate-300 transition hover:border-white/20"
                >
                  返回
                </button>
              </header>

              <section className="flex flex-1 flex-col gap-4">
                <div className="rounded-2xl border border-slate-800/80 bg-slate-950/70 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">导出</div>
                  <div className="mt-3 space-y-3">
                    <div>
                      <div className="text-xs text-slate-400">导出路径</div>
                      <button
                        type="button"
                        onClick={chooseExportDir}
                        className="mt-2 flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-800/80 bg-slate-950/90 px-3 py-2.5 text-left transition hover:border-slate-700/80"
                      >
                        <span className="flex items-center gap-3">
                          <FiFolder className="text-slate-500" />
                          <span className="text-sm font-medium text-slate-100">
                            {ellipsizePath(settings.exportDir || defaultExportDir || "recordings")}
                          </span>
                        </span>
                        <span className="text-xs text-slate-400">选择</span>
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs text-slate-400">默认帧率</div>
                        <div className="mt-2">
                          <SelectMenu
                            value={String(settings.fps)}
                            options={fpsSelectOptions}
                            onChange={(value) => updateSetting({ fps: Number(value) })}
                            icon={<FiPlay className="text-slate-500" />}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">默认分辨率</div>
                        <div className="mt-2">
                          <SelectMenu
                            value={String(settings.resolution)}
                            options={resolutionSelectOptions}
                            onChange={(value) => updateSetting({ resolution: Number(value) })}
                            icon={<FiMonitor className="text-slate-500" />}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-800/80 bg-slate-950/70 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">系统</div>
                  <div className="mt-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm text-slate-100">开机自启动</div>
                      <div className="text-xs text-slate-500">开启后系统启动时自动运行</div>
                    </div>
                    <Switch
                      checked={settings.autostart}
                      onChange={() => toggleAutostart()}
                      className={`relative h-7 w-12 rounded-full border transition ${
                        settings.autostart ? "border-cyan-400/60 bg-cyan-400/30" : "border-white/10 bg-slate-900/70"
                      } ${autostartLoading ? "opacity-60 pointer-events-none" : ""}`}
                    >
                      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${settings.autostart ? "left-6" : "left-1"}`} />
                    </Switch>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={resetSettings}
                    className="rounded-full border border-white/10 bg-slate-900/70 px-4 py-2 text-xs text-slate-300 transition hover:border-white/20"
                  >
                    恢复默认
                  </button>
                </div>
              </section>
            </>
          ) : (
            <>
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
                <button
                  type="button"
                  onClick={() => setView("settings")}
                  className="rounded-full border border-white/10 bg-slate-900/60 p-2 text-slate-200 transition hover:border-white/20"
                  aria-label="设置"
                >
                  <FiSettings className="h-4 w-4" />
                </button>
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

                {/* 移除首页“打开文件夹”入口 */}

                {errorMessage ? (
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/70 px-3 py-2 text-xs text-red-300">
                    {errorMessage}
                  </div>
                ) : null}
              </section>
            </>
          )}
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
