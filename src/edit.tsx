import { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { FiVideo } from "react-icons/fi";
import "./App.css";

const EditPage = () => {
  const [outputPath, setOutputPath] = useState("");
  const [logPath, setLogPath] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
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

  useEffect(() => {
    setOutputPath(localStorage.getItem("recordingOutputPath") ?? "");
    setLogPath(localStorage.getItem("recordingLogPath") ?? "");
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

  const previewWidth = 760;
  const previewHeight = useMemo(() => {
    const aspectMap = {
      "16:9": 16 / 9,
      "1:1": 1,
      "9:16": 9 / 16,
    };
    return previewWidth / aspectMap[editAspect];
  }, [editAspect]);
  const cameraRadius =
    cameraShape === "circle" ? "9999px" : cameraShape === "rounded" ? "18px" : "6px";
  const cameraShadowValue = `0 16px 40px rgba(0,0,0,${cameraShadow / 100})`;

  const handleBack = async () => {
    try {
      const mainWindow = await WebviewWindow.getByLabel("main");
      if (mainWindow) {
        await mainWindow.show();
        await mainWindow.setFocus();
      }
      await getCurrentWindow().close();
    } catch (error) {
      setErrorMessage(String(error));
    }
  };

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
              onClick={handleBack}
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
              {errorMessage ? <div className="mt-2 text-xs text-red-300">{errorMessage}</div> : null}
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
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Shape & Scale</div>
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
                  {(backgroundType === "gradient"
                    ? backgroundPresets.gradients
                    : backgroundPresets.wallpapers
                  ).map((preset, index) => (
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
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<EditPage />);
