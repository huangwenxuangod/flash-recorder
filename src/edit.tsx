import { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type Event, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalSize } from "@tauri-apps/api/window";
import { FiCamera, FiUser, FiImage, FiPause, FiPlay, FiSliders, FiFolder } from "react-icons/fi";
import { Toaster, toast } from "react-hot-toast";
import "./App.css";

import { SelectMenu, type SelectOption } from "./components/SelectMenu";
import { motion } from "framer-motion";
import { Button } from "@heroui/react";
import TimelineUI from "./components/TimelineUI";

const SETTINGS_EXPORT_DIR = "settingsExportDir";
const SETTINGS_FPS = "settingsFps";
const SETTINGS_RESOLUTION = "settingsResolution";

type Block = { id: string; start: number; end: number };
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
  camera_position?: "top_left" | "top_right" | "bottom_left" | "bottom_right";
  shrink_16_9?: number;
  shrink_1_1?: number;
  shrink_9_16?: number;
  portrait_split?: boolean;
  portrait_bottom_ratio?: number;
  safe_x?: number;
  safe_y?: number;
  safe_w?: number;
  safe_h?: number;
};

type ExportStatus = {
  job_id: string;
  state: string;
  progress: number;
  error?: string | null;
  output_path?: string;
};

const aspectOptions: SelectOption[] = [
  { value: "16:9", label: "16:9" },
  { value: "1:1", label: "1:1" },
  { value: "9:16", label: "9:16" },
];

type CameraPosition = "top_left" | "top_right" | "bottom_left" | "bottom_right";
const cameraPositionOptions: SelectOption[] = [
  { value: "top_left", label: "左上角" },
  { value: "top_right", label: "右上角" },
  { value: "bottom_left", label: "左下角" },
  { value: "bottom_right", label: "右下角" },
];

const EditPage = () => {
  const [outputPath, setOutputPath] = useState("");
  const [editPadding, setEditPadding] = useState(0);
  const [editRadius, setEditRadius] = useState(12);
  const [editShadow, setEditShadow] = useState(20);
  const [safeRect, setSafeRect] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const [editAspect, setEditAspect] = useState<"16:9" | "1:1" | "9:16">("16:9");
  const [cameraSize, setCameraSize] = useState(168);
  const [cameraShape, setCameraShape] = useState<"circle" | "rounded" | "square">("circle");
  const [cameraShadow, setCameraShadow] = useState(22);
  const [cameraMirror, setCameraMirror] = useState(false);
  const [cameraBlur, setCameraBlur] = useState(false);
  const [backgroundType, setBackgroundType] = useState<"gradient" | "wallpaper">("gradient");
  const [backgroundPreset, setBackgroundPreset] = useState(0);
  const [activeTab, setActiveTab] = useState<"camera" | "avatar" | "background" | "frame">("camera");
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
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const isScrubbingRef = useRef(false);
  const prevPlayingRef = useRef(false);
  const autoPlayRef = useRef(true);
  const previewAreaRef = useRef<HTMLDivElement | null>(null);
  const [previewBaseHeight, setPreviewBaseHeight] = useState(236);
  const previewContentRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [avatarScale, setAvatarScale] = useState(1);
  const zoomTimerRef = useRef<number | null>(null);
  const lastExportStateRef = useRef<string | null>(null);
  const exportToastIdRef = useRef<string | null>(null);
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [isMobile, setIsMobile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cameraPosition, setCameraPosition] = useState<CameraPosition>("bottom_left");
  const [clipBlocks, setClipBlocks] = useState<Block[]>([]);
  const [avatarBlocks, setAvatarBlocks] = useState<Block[]>([]);
  const historyRef = useRef<{ clip: Block[]; avatar: Block[] }[]>([]);
  const histIndexRef = useRef<number>(-1);
  const pushHistory = (clip: Block[], avatar: Block[]) => {
    const last = historyRef.current[histIndexRef.current] || null;
    const same =
      last &&
      JSON.stringify(last.clip) === JSON.stringify(clip) &&
      JSON.stringify(last.avatar) === JSON.stringify(avatar);
    if (same) return;
    historyRef.current = historyRef.current.slice(0, histIndexRef.current + 1);
    historyRef.current.push({ clip: clip.map((b) => ({ ...b })), avatar: avatar.map((b) => ({ ...b })) });
    histIndexRef.current = historyRef.current.length - 1;
  };
  useEffect(() => {
    pushHistory(clipBlocks, avatarBlocks);
  }, [clipBlocks, avatarBlocks]);
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const z = e.ctrlKey && !e.shiftKey && (e.key.toLowerCase() === "z");
      const y = (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "z") || (e.ctrlKey && e.key.toLowerCase() === "y");
      if (z) {
        if (histIndexRef.current > 0) {
          histIndexRef.current -= 1;
          const entry = historyRef.current[histIndexRef.current];
          setClipBlocks(entry.clip.map((b) => ({ ...b })));
          setAvatarBlocks(entry.avatar.map((b) => ({ ...b })));
          persistClipBlocks(entry.clip);
          persistAvatarBlocks(entry.avatar);
        }
      } else if (y) {
        if (histIndexRef.current < historyRef.current.length - 1) {
          histIndexRef.current += 1;
          const entry = historyRef.current[histIndexRef.current];
          setClipBlocks(entry.clip.map((b) => ({ ...b })));
          setAvatarBlocks(entry.avatar.map((b) => ({ ...b })));
          persistClipBlocks(entry.clip);
          persistAvatarBlocks(entry.avatar);
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    setOutputPath(localStorage.getItem("recordingOutputPath") ?? "");
    setCameraPath(localStorage.getItem("recordingCameraPath") ?? "");
  }, []);

  useEffect(() => {
    if (!outputPath) {
      setPreviewSrc("");
      return;
    }
    setPreviewLoading(true);
    invoke<string>("ensure_preview", { outputPath })
      .then((p) => {
        setPreviewSrc(convertFileSrc(p));
        setPreviewError("");
      })
      .catch(() => {
        setPreviewSrc("");
        setPreviewError("预览生成失败");
      })
      .finally(() => setPreviewLoading(false));
  }, [outputPath]);

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
    if (!outputPath) return;
    invoke<string>("ensure_clip_track", { inputPath: outputPath })
      .then(async (path) => {
        const url = convertFileSrc(path);
        const res = await fetch(url);
        const data = await res.json();
        const segs = (data?.segments || []) as { start_s: number; end_s: number }[];
        const blocks = segs
          .filter((s) => Number.isFinite(s.start_s) && Number.isFinite(s.end_s))
          .map((s, index) => ({
            id: `clip-${index}-${Math.round(s.start_s * 1000)}`,
            start: Math.max(0, s.start_s),
            end: Math.max(0, s.end_s),
          }))
          .filter((s) => s.end > s.start)
          .sort((a, b) => a.start - b.start);
        setClipBlocks(blocks);
      })
      .catch(() => setClipBlocks([]));
    invoke<string>("ensure_camera_track", { inputPath: outputPath })
      .then(async (path) => {
        const url = convertFileSrc(path);
        const res = await fetch(url);
        const data = await res.json();
        const segs = (data?.segments || []) as { start_s: number; end_s: number; visible?: boolean }[];
        const blocks = segs
          .filter((s) => s.visible !== false)
          .filter((s) => Number.isFinite(s.start_s) && Number.isFinite(s.end_s))
          .map((s, index) => ({
            id: `avatar-${index}-${Math.round(s.start_s * 1000)}`,
            start: Math.max(0, s.start_s),
            end: Math.max(0, s.end_s),
          }))
          .filter((s) => s.end > s.start)
          .sort((a, b) => a.start - b.start);
        setAvatarBlocks(blocks);
      })
      .catch(() => setAvatarBlocks([]));
  }, [outputPath]);

  const persistClipBlocks = async (blocks: { id: string; start: number; end: number }[]) => {
    if (!outputPath) return;
    const segments = blocks
      .map((b) => ({
        start_s: Math.max(0, b.start),
        end_s: Math.max(0, b.end),
      }))
      .filter((s) => s.end_s > s.start_s)
      .sort((a, b) => a.start_s - b.start_s);
    const payload = { segments };
    await invoke<string>("save_clip_track", { inputPath: outputPath, trackJson: JSON.stringify(payload) }).catch(() => null);
  };
  const persistAvatarBlocks = async (blocks: { id: string; start: number; end: number }[]) => {
    if (!outputPath) return;
    const segments = blocks
      .map((b) => ({
        start_s: Math.max(0, b.start),
        end_s: Math.max(0, b.end),
        visible: true,
      }))
      .filter((s) => s.end_s > s.start_s)
      .sort((a, b) => a.start_s - b.start_s);
    const payload = { segments };
    await invoke<string>("save_camera_track", { inputPath: outputPath, trackJson: JSON.stringify(payload) }).catch(() => null);
  };
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
        const cameraPosValue =
          state.camera_position === "top_left" ||
          state.camera_position === "top_right" ||
          state.camera_position === "bottom_right"
            ? (state.camera_position as CameraPosition)
            : "bottom_left";
        setEditAspect(aspect);
        setEditPadding(state.padding);
        setEditRadius(state.radius);
        setEditShadow(state.shadow);
        setCameraSize(
          aspect === "9:16"
            ? (typeof state.camera_size === "number" && state.camera_size >= 120 ? state.camera_size : 120)
            : state.camera_size
        );
        setCameraShape(cameraShapeValue);
        setCameraShadow(state.camera_shadow);
        setCameraMirror(state.camera_mirror);
        setCameraBlur(state.camera_blur);
        setBackgroundType(backgroundValue);
        setBackgroundPreset(state.background_preset);
        setCameraPosition(cameraPosValue);
        const nextSafe = {
          x: typeof state.safe_x === "number" ? state.safe_x : 0,
          y: typeof state.safe_y === "number" ? state.safe_y : 0,
          w: typeof state.safe_w === "number" ? state.safe_w : 1,
          h: typeof state.safe_h === "number" ? state.safe_h : 1,
        };
        const w = Math.min(1, Math.max(0.2, nextSafe.w));
        const h = Math.min(1, Math.max(0.2, nextSafe.h));
        const x = Math.min(1 - w, Math.max(0, nextSafe.x));
        const y = Math.min(1 - h, Math.max(0, nextSafe.y));
        setSafeRect({ x, y, w, h });
        hasLoadedRef.current = true;
      })
      .catch(() => {
        hasLoadedRef.current = true;
      });
  }, [outputPath]);

  useEffect(() => {
    if (editAspect === "9:16" && cameraSize < 120) {
      setCameraSize(120);
    }
  }, [editAspect, cameraSize]);
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
    const handleLoadedData = () => {
      drawCanvas();
      if (autoPlayRef.current) {
        autoPlayRef.current = false;
        video.play().catch(() => null);
      }
    };
    const handleDuration = () => {
      setPreviewDuration(Number.isFinite(video.duration) ? video.duration : 0);
    };
    const handleTime = () => {
      if (!isScrubbingRef.current) {
        const t = ensureClipPlayback(video);
        setPreviewTime(t);
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
      const t = ensureClipPlayback(video);
      syncAvatarToPreview(t);
      setPreviewTime(t);
    };
    video.addEventListener("loadedmetadata", handleLoaded);
    video.addEventListener("loadeddata", handleLoadedData);
    video.addEventListener("durationchange", handleDuration);
    video.addEventListener("timeupdate", handleTime);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("seeked", handleSeeked);
    handleLoaded();
    return () => {
      video.removeEventListener("loadedmetadata", handleLoaded);
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("durationchange", handleDuration);
      video.removeEventListener("timeupdate", handleTime);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("seeked", handleSeeked);
    };
  }, [previewSrc]);
  useEffect(() => {
    autoPlayRef.current = true;
  }, [previewSrc]);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video) return;
    let stop = false;
    let rafId: number | null = null;
    const runRaf = () => {
      if (stop) return;
      if (!isScrubbingRef.current) {
        const t = ensureClipPlayback(video);
        setPreviewTime(t);
        syncAvatarToPreview(t);
      }
      drawCanvas();
      rafId = requestAnimationFrame(runRaf);
    };
    const hasRvfc = typeof (video as any).requestVideoFrameCallback === "function";
    if (previewPlaying) {
      if (hasRvfc) {
        const tick = () => {
          if (stop) return;
          if (!isScrubbingRef.current) {
            const t = ensureClipPlayback(video);
            setPreviewTime(t);
            syncAvatarToPreview(t);
          }
          drawCanvas();
          (video as any).requestVideoFrameCallback(tick);
        };
        (video as any).requestVideoFrameCallback(tick);
      } else {
        runRaf();
      }
    }
    return () => {
      stop = true;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
  }, [previewPlaying, previewSrc]);

  useEffect(() => {
    if (!cameraPath) {
      setAvatarSrc("");
      return;
    }
    setAvatarSrc(convertFileSrc(cameraPath));
  }, [cameraPath]);

  // 移除未使用的路径拼接与设置常量
  const sessionIdFromInput = (input: string) => {
    const parts = input.split(/[/\\]/);
    return parts.length >= 2 ? parts[parts.length - 2] : "export";
  };

  useEffect(() => {
    if (!outputPath || !hasLoadedRef.current) {
      return;
    }
    const safeRect = safeRectForAspect();
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
      camera_position: cameraPosition,
      safe_x: safeRect.x,
      safe_y: safeRect.y,
      safe_w: safeRect.w,
      safe_h: safeRect.h,
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
    cameraPosition,
  ]);

  useEffect(() => {
    const unlistenPromise: Promise<UnlistenFn> = listen<ExportStatus>(
      "export_progress",
      (event: Event<ExportStatus>) => {
      const status = event.payload;
      if (activeJobIdRef.current && status.job_id !== activeJobIdRef.current) {
        return;
      }
      setExportStatus(status);
      if (status.state === "running" && !exportToastIdRef.current) {
        exportToastIdRef.current = toast.loading("正在导出…", { duration: Infinity });
      }
      if (status.state === "completed" && lastExportStateRef.current !== "completed") {
        if (exportToastIdRef.current) {
          toast.dismiss(exportToastIdRef.current);
          exportToastIdRef.current = null;
        }
        toast.success("导出完成");
        setPreviewError("");
        setPreviewLoading(false);
      }
      if (status.state === "failed" && lastExportStateRef.current !== "failed") {
        if (exportToastIdRef.current) {
          toast.dismiss(exportToastIdRef.current);
          exportToastIdRef.current = null;
        }
        if (status.error) {
          console.error("export_failed detail:", status.error);
        } else {
          console.error("export_failed detail: empty error payload", status);
        }
        const message =
          typeof status.error === "string" && status.error.trim().length > 0
            ? status.error.split("\n")[0].slice(0, 140)
            : "导出失败";
        toast.error(message);
      }
      lastExportStateRef.current = status.state;
      if (["completed", "failed", "cancelled"].includes(status.state)) {
        activeJobIdRef.current = null;
      }
      }
    );
    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => null);
    };
  }, []);

  useEffect(() => {
    const updateToolbar = () => {
      const area = previewAreaRef.current;
      const section = sectionRef.current;
      if (!area || !section) {
        return;
      }
      const areaRect = area.getBoundingClientRect();
      const sectionRect = section.getBoundingClientRect();
      const offsetY = -35;
      const left =
        Math.round(areaRect.left + areaRect.width / 2) - Math.round(sectionRect.left);
      const top = Math.round(areaRect.bottom + offsetY) - Math.round(sectionRect.top);
      setToolbarPos({ left, top });
    };
    updateToolbar();
    const observer = new ResizeObserver(updateToolbar);
    if (previewAreaRef.current) {
      observer.observe(previewAreaRef.current);
    }
    window.addEventListener("resize", updateToolbar);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateToolbar);
    };
  }, [editAspect, previewBaseHeight]);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const applyEditLayout = async () => {
      await appWindow.setDecorations(true);
      await appWindow.setResizable(true);
      await appWindow.setMinSize(new PhysicalSize(960, 640));
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
      const height = rect.width / previewAspect;
      setPreviewBaseHeight(Math.round(height));
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const updateMobile = () => {
      setIsMobile(window.innerWidth < 1024);
      if (window.innerWidth >= 1024) {
        setDrawerOpen(false);
      }
    };
    updateMobile();
    window.addEventListener("resize", updateMobile);
    return () => window.removeEventListener("resize", updateMobile);
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
  const normalizeBlocks = (blocks: Block[]) =>
    blocks
      .map((b) => ({
        ...b,
        start: Math.max(0, b.start),
        end: Math.max(0, b.end),
      }))
      .filter((b) => b.end > b.start)
      .sort((a, b) => a.start - b.start);
  const clipSegments = useMemo(() => normalizeBlocks(clipBlocks), [clipBlocks]);
  const avatarSegments = useMemo(() => normalizeBlocks(avatarBlocks), [avatarBlocks]);
  const backgroundStops = useMemo(
    () => ({
      gradients: [
        { start: "#6ee7ff", mid: "#a855f7", end: "#f97316", midPos: 0.5 },
        { start: "#0f172a", mid: "#1e40af", end: "#38bdf8", midPos: 0.55 },
        { start: "#111827", mid: "#7c3aed", end: "#ec4899", midPos: 0.6 },
        { start: "#0b1020", mid: "#0f766e", end: "#22d3ee", midPos: 0.6 },
      ],
      wallpapers: [
        { start: "#0f172a", end: "#1f2937" },
        { start: "#0b1020", end: "#1f1b3a" },
        { start: "#1f2937", end: "#0f172a" },
        { start: "#0a0f1f", end: "#0b1020" },
      ],
    }),
    []
  );

  const previewAspect = useMemo(() => {
    if (editAspect === "1:1") {
      return 1;
    }
    if (editAspect === "9:16") {
      return 9 / 16;
    }
    return 16 / 9;
  }, [editAspect]);
  const evenize = (n: number) => (n % 2 === 0 ? n : n - 1);
  const previewFrameHeight = evenize(previewBaseHeight);
  const previewFrameWidth = evenize(Math.round(previewFrameHeight * previewAspect));
  const drawCanvasBackground = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    if (backgroundType === "wallpaper") {
      const stops = backgroundStops.wallpapers[backgroundPreset % backgroundStops.wallpapers.length];
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, stops.start);
      grad.addColorStop(1, stops.end);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const stops = backgroundStops.gradients[backgroundPreset % backgroundStops.gradients.length];
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, stops.start);
    grad.addColorStop(stops.midPos, stops.mid);
    grad.addColorStop(1, stops.end);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  };
  const updateSafeRect = (next: Partial<{ x: number; y: number; w: number; h: number }>) => {
    setSafeRect((prev) => {
      const draft = { ...prev, ...next };
      const w = Math.min(1, Math.max(0.2, draft.w));
      const h = Math.min(1, Math.max(0.2, draft.h));
      const x = Math.min(1 - w, Math.max(0, draft.x));
      const y = Math.min(1 - h, Math.max(0, draft.y));
      return { x, y, w, h };
    });
  };
  const safeRectForAspect = () => ({
    x: Math.min(1 - safeRect.w, Math.max(0, safeRect.x)),
    y: Math.min(1 - safeRect.h, Math.max(0, safeRect.y)),
    w: Math.min(1, Math.max(0.2, safeRect.w)),
    h: Math.min(1, Math.max(0.2, safeRect.h)),
  });
  const isTimeInSegments = (segments: Block[], t: number) =>
    segments.some((s) => t >= s.start && t <= s.end);
  const clampTimeToSegments = (segments: Block[], t: number) => {
    if (segments.length === 0) return t;
    for (const seg of segments) {
      if (t >= seg.start && t <= seg.end) {
        return t;
      }
    }
    const next = segments.find((seg) => t < seg.start);
    if (next) {
      return next.start;
    }
    return segments[segments.length - 1].end;
  };
  const ensureClipPlayback = (video: HTMLVideoElement) => {
    if (clipSegments.length === 0) {
      return video.currentTime || 0;
    }
    const t = video.currentTime || 0;
    for (const seg of clipSegments) {
      if (t >= seg.start && t <= seg.end) {
        return t;
      }
      if (t < seg.start) {
        video.currentTime = seg.start;
        return seg.start;
      }
    }
    const last = clipSegments[clipSegments.length - 1];
    video.currentTime = last.end;
    if (!video.paused) {
      video.pause();
      setPreviewPlaying(false);
    }
    return last.end;
  };
  const effectiveAvatarScale = avatarScale;
  const exportDisabled =
    !outputPath || exportStatus?.state === "running" || exportStatus?.state === "queued";
  const cameraRadius =
    cameraShape === "circle" ? "9999px" : cameraShape === "rounded" ? "18px" : "6px";
  // 统一使用 Toast 展示导出状态

  const previewLabel = useMemo(() => {
    if (previewLoading) {
      return "生成预览中";
    }
    if (previewError) {
      return "预览生成失败";
    }
    return "";
  }, [previewError, previewLoading]);
  const previewControlsDisabled = !previewSrc || previewLoading || !!previewError;
  const exportBusy =
    exportStatus?.state === "running" || exportStatus?.state === "queued";

  const [exportDir, setExportDir] = useState("");
  const [exportFps, setExportFps] = useState(() => Number(localStorage.getItem(SETTINGS_FPS) ?? 60));
  const [exportResolution, setExportResolution] = useState(() =>
    Number(localStorage.getItem(SETTINGS_RESOLUTION) ?? 1080)
  );
  useEffect(() => {
    const saved = localStorage.getItem(SETTINGS_EXPORT_DIR) || "";
    if (saved) {
      setExportDir(saved);
    } else {
      invoke<string>("get_export_dir")
        .then((dir) => setExportDir(dir))
        .catch(() => null);
    }
  }, []);
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SETTINGS_EXPORT_DIR) {
        setExportDir(event.newValue ?? "");
      }
      if (event.key === SETTINGS_FPS) {
        setExportFps(Number(event.newValue ?? 60));
      }
      if (event.key === SETTINGS_RESOLUTION) {
        setExportResolution(Number(event.newValue ?? 1080));
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);
  const joinPath = (dir: string, name: string) => {
    if (!dir) return name;
    const hasSep = dir.endsWith("\\") || dir.endsWith("/");
    if (hasSep) return `${dir}${name}`;
    const sep = dir.includes("\\") ? "\\" : "/";
    return `${dir}${sep}${name}`;
  };
  const buildExportPath = (input: string) => {
    const name = `Flash Recorder_${sessionIdFromInput(input)}.mp4`;
    return joinPath(exportDir, name);
  };
  const bitrateForResolution = (value: number) => {
    if (value >= 2160) return 45000;
    if (value >= 1440) return 20000;
    if (value >= 1080) return 12000;
    return 6000;
  };
  const openExportFolder = async () => {
    try {
      let target = exportDir;
      if (!target) {
        target = await invoke<string>("get_export_dir");
        setExportDir(target);
      }
      await invoke("open_path", { path: target });
    } catch (error) {
      toast.error(String(error).split("\n")[0].slice(0, 140));
    }
  };

  const profileForAspect = () => {
    if (editAspect === "1:1") {
      const base = evenize(exportResolution || 1080);
      return { width: base, height: base };
    }
    if (editAspect === "9:16") {
      const base = evenize(exportResolution || 1080);
      return { width: base, height: evenize((base * 16) / 9) };
    }
    const base = evenize(exportResolution || 1080);
    return { width: evenize((base * 16) / 9), height: base };
  };

  const handleExport = async () => {
    if (!outputPath || exportDisabled) {
      return;
    }
    const size = profileForAspect();
    const safeRect = safeRectForAspect();
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
      camera_position: cameraPosition,
      safe_x: safeRect.x,
      safe_y: safeRect.y,
      safe_w: safeRect.w,
      safe_h: safeRect.h,
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
            fps: exportFps || 60,
            bitrate_kbps: bitrateForResolution(exportResolution || 1080),
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
      if (!exportToastIdRef.current) {
        exportToastIdRef.current = toast.loading("正在导出…", { duration: Infinity });
      }
    } catch (error) {
      setExportStatus({
        job_id: "",
        state: "failed",
        progress: 0,
        error: String(error),
      });
      toast.error(String(error).split("\n")[0].slice(0, 140));
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
    const clipVisible = clipSegments.length > 0 && isTimeInSegments(clipSegments, target);
    const avatarVisible = avatarSegments.length > 0 && isTimeInSegments(avatarSegments, target);
    if (!clipVisible || !avatarVisible) {
      avatarVideo.pause();
      return;
    }
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
  
  const rafRef = useRef<number | null>(null);
  
  const drawCanvas = () => {
    const video = previewVideoRef.current;
    const canvas = canvasRef.current;
    const container = previewContentRef.current;
    if (!video || !canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const cw = Math.max(2, Math.round(rect.width));
    const ch = Math.max(2, Math.round(rect.height));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    const time = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const clipVisible = clipSegments.length > 0 && isTimeInSegments(clipSegments, time);
    if (clipVisible && (video.readyState < 2 || !vw || !vh)) return;
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, cw, ch);
    const baseSafe = safeRectForAspect();
    const safeRect = baseSafe;
    const safeX = Math.round(safeRect.x * cw);
    const safeY = Math.round(safeRect.y * ch);
    const safeW = Math.max(1, Math.round(safeRect.w * cw));
    const safeH = Math.max(1, Math.round(safeRect.h * ch));
    const composite = compositeCanvasRef.current ?? document.createElement("canvas");
    if (!compositeCanvasRef.current) {
      compositeCanvasRef.current = composite;
    }
    if (composite.width !== cw || composite.height !== ch) {
      composite.width = cw;
      composite.height = ch;
    }
    const compCtx = composite.getContext("2d");
    if (!compCtx) return;
    compCtx.imageSmoothingEnabled = true;
    compCtx.clearRect(0, 0, cw, ch);
    drawCanvasBackground(compCtx, cw, ch);
    if (clipVisible) {
      const scale = Math.min(safeW / vw, safeH / vh);
      const destW = Math.max(1, Math.round(vw * scale));
      const destH = Math.max(1, Math.round(vh * scale));
      const destX = Math.round(safeX + (safeW - destW) / 2);
      const destY = Math.round(safeY + (safeH - destH) / 2);
      compCtx.drawImage(video, 0, 0, vw, vh, destX, destY, destW, destH);
    }
    ctx.drawImage(composite, 0, 0, cw, ch);
    return;
  };
  useEffect(() => {
    if (!previewPlaying) {
      drawCanvas();
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
  }, [previewPlaying, previewFrameWidth, previewFrameHeight, clipSegments, avatarSegments]);
  useEffect(() => {
    drawCanvas();
  }, [previewTime, previewFrameWidth, previewFrameHeight, clipSegments, avatarSegments]);
  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video) return;
    const t = clampTimeToSegments(clipSegments, video.currentTime || 0);
    if (Number.isFinite(t) && t !== video.currentTime) {
      video.currentTime = t;
    }
    setPreviewTime(t);
    syncAvatarToPreview(t);
    drawCanvas();
  }, [clipSegments, avatarSegments]);
  const clipVisibleForPreview = clipSegments.length > 0 && isTimeInSegments(clipSegments, previewTime);
  const avatarVisibleForPreview =
    clipVisibleForPreview && avatarSegments.length > 0 && isTimeInSegments(avatarSegments, previewTime);
  const previewSurface = previewSrc ? (
    <>
      <video
        ref={previewVideoRef}
        className="h-0 w-0 absolute opacity-0 pointer-events-none"
        src={previewSrc}
        muted
        preload="metadata"
        playsInline
      />
      <canvas ref={canvasRef} className="h-full w-full" />
    </>
  ) : (
    <div className="flex h-full items-center justify-center text-[11px] text-slate-400">
      {previewLabel || "暂无预览"}
    </div>
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full flex-col px-3 py-3">
        <div className="flex flex-1 gap-2.5">
          <section
            className="relative flex min-w-0 flex-1 flex-col items-center gap-2.5 rounded-3xl border border-white/5 bg-slate-900/40 p-2.5 shadow-2xl"
            ref={sectionRef}
          >
            {/* 删除 Preview 行 */}

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
                  <div
                    className="relative h-full w-full overflow-hidden rounded-2xl"
                    ref={previewContentRef}
                    onClick={() => {
                      setAvatarScale(0.7);
                    }}
                    onDoubleClick={() => {
                      setAvatarScale(1);
                      if (zoomTimerRef.current) {
                        window.clearTimeout(zoomTimerRef.current);
                        zoomTimerRef.current = null;
                      }
                    }}
                  >
                    <motion.div
                      className="h-full w-full"
                      style={{ transformOrigin: "top left", willChange: "transform" }}
                      animate={{ x: 0, y: 0, scale: 1 }}
                      transition={{ duration: 0.01 }}
                    >
                      {previewSurface}
                    </motion.div>
                  </div>
                </div>
                <motion.div
                  className="absolute overflow-hidden"
                  style={{
                    width: evenize(cameraSize),
                    height: evenize(cameraSize),
                    borderRadius: cameraRadius,
                    boxShadow: `0 16px 40px rgba(0,0,0,${cameraShadow / 120}), 0 0 0 1px rgba(255,255,255,0.1), inset 0 1px 0 rgba(255,255,255,0.25)`,
                    transformOrigin: (cameraPosition === "top_left"
                        ? "top left"
                        : cameraPosition === "top_right"
                        ? "top right"
                        : cameraPosition === "bottom_right"
                        ? "bottom right"
                        : "bottom left"),
                    background: cameraBlur ? "rgba(15, 23, 42, 0.25)" : "rgba(15, 23, 42, 0.18)",
                    backdropFilter: cameraBlur ? "blur(18px) saturate(140%)" : "blur(10px)",
                    opacity: avatarVisibleForPreview ? 1 : 0,
                    pointerEvents: "none",
                    ...(cameraPosition === "top_left"
                      ? { top: 12, left: 12 }
                      : cameraPosition === "top_right"
                      ? { top: 12, right: 12 }
                      : cameraPosition === "bottom_right"
                      ? { bottom: 12, right: 12 }
                      : { bottom: editAspect === "9:16" ? 16 : 12, left: editAspect === "9:16" ? 16 : 12 }),
                  }}
                  animate={{ scale: effectiveAvatarScale, scaleX: cameraMirror ? -1 : 1 }}
                  transition={{ duration: 0.5, ease: [0.215, 0.61, 0.355, 1] }}
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
                </motion.div>
                {/* 悬浮工具栏移动到外层，避免被 overflow-hidden 裁剪 */}
              
              </div>
            </div>
            <div
              className="pointer-events-none absolute z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-[10px] text-slate-200"
              style={{ left: toolbarPos.left, top: toolbarPos.top }}
            >
              <div className="w-24">
                <SelectMenu
                  value={editAspect}
                  options={aspectOptions}
                  onChange={(value) => setEditAspect(value as "16:9" | "1:1" | "9:16")}
                  icon={<FiSliders className="text-slate-500" />}
                />
              </div>
              <Button
                type="button"
                onClick={togglePreviewPlayback}
                disabled={previewControlsDisabled}
                className={`pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 px-2.5 py-1 transition ${
                  previewControlsDisabled
                    ? "bg-slate-900/50 text-slate-500"
                    : "bg-slate-950/70 text-slate-200 hover:border-cyan-400/50"
                }`}
              >
                {previewPlaying ? <FiPause /> : <FiPlay />}
                <span>{previewPlaying ? "暂停" : "播放"}</span>
              </Button>
              <Button
                type="button"
                onClick={handleExport}
                disabled={exportDisabled}
                className={`pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 px-2.5 py-1 transition ${
                  exportDisabled
                    ? "bg-slate-900/50 text-slate-500"
                    : "bg-slate-950/70 text-slate-200 hover:border-cyan-400/50"
                }`}
              >
                {exportBusy ? (
                  <span className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-r-transparent" />
                ) : null}
                <span>导出</span>
              </Button>
              <Button
                type="button"
                onClick={openExportFolder}
                className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 px-2.5 py-1 transition bg-slate-950/70 text-slate-200 hover:border-cyan-400/50"
              >
                <FiFolder />
                <span>打开文件夹</span>
              </Button>
            </div>

 
            <div className="w-full px-3 py-2">
              <TimelineUI
                duration={previewDuration}
                playheadPercent={previewDuration > 0 ? Math.min(100, Math.max(0, (previewTime / previewDuration) * 100)) : 0}
                compact={true}
                className="w-full"
                smoothFactor={0.5}
                clipBlocks={clipBlocks}
                avatarBlocks={avatarBlocks}
                onClipChange={(blocks) => {
                  const next = normalizeBlocks(blocks);
                  setClipBlocks(next);
                  persistClipBlocks(next);
                }}
                onAvatarChange={(blocks) => {
                  const next = normalizeBlocks(blocks);
                  setAvatarBlocks(next);
                  persistAvatarBlocks(next);
                }}
                onScrubStart={() => {
                  const video = previewVideoRef.current;
                  if (!video) return;
                  prevPlayingRef.current = !video.paused && !video.ended;
                  isScrubbingRef.current = true;
                  video.pause();
                }}
                onScrubMove={(tSeconds) => {
                  const video = previewVideoRef.current;
                  if (!video) return;
                  const raw = Math.max(0, Math.min(previewDuration || 0, tSeconds));
                  const t = clampTimeToSegments(clipSegments, raw);
                  video.currentTime = t;
                  syncAvatarToPreview(t);
                  setPreviewTime(t);
                }}
                onScrubEnd={(tSeconds) => {
                  const video = previewVideoRef.current;
                  if (!video) return;
                  const raw = Math.max(0, Math.min(previewDuration || 0, tSeconds));
                  const t = clampTimeToSegments(clipSegments, raw);
                  video.currentTime = t;
                  isScrubbingRef.current = false;
                  syncAvatarToPreview(t);
                  setPreviewTime(t);
                  if (prevPlayingRef.current && !video.ended) {
                    video.play().catch(() => null);
                  } else {
                    video.pause();
                  }
                }}
              />
            </div>
            <Toaster position="top-center" toastOptions={{ duration: 1600 }} />
          </section>

          <aside
            className="flex gap-2"
            style={{
              width: isMobile ? 56 : "clamp(280px, 24vw, 380px)",
            }}
          >
            <div className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-slate-900/60 p-1.5">
              <Button
                isIconOnly
                type="button"
                onClick={() => {
                  setActiveTab("camera");
                  if (isMobile) setDrawerOpen(true);
                }}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
                  activeTab === "camera"
                    ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
                    : "border-white/10 bg-slate-950/60 text-slate-400"
                }`}
                aria-label="相机设置"
              >
                <FiCamera />
              </Button>
              <Button
                isIconOnly
                type="button"
                onClick={() => {
                  setActiveTab("background");
                  if (isMobile) setDrawerOpen(true);
                }}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
                  activeTab === "background"
                    ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
                    : "border-white/10 bg-slate-950/60 text-slate-400"
                }`}
                aria-label="背景设置"
              >
                <FiImage />
              </Button>
              <Button
                isIconOnly
                type="button"
                onClick={() => {
                  setActiveTab("frame");
                  if (isMobile) setDrawerOpen(true);
                }}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
                  activeTab === "frame"
                    ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
                    : "border-white/10 bg-slate-950/60 text-slate-400"
                }`}
                aria-label="画框设置"
              >
                <FiSliders />
              </Button>
            </div>

            {!isMobile ? (
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
                      min={120}
                      max={320}
                      step={2}
                      value={Math.max(120, cameraSize)}
                      onChange={(event) => setCameraSize(Number(event.target.value))}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    {(["circle", "rounded", "square"] as const).map((shape) => (
                      <Button
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
                      </Button>
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
                    <Button
                      type="button"
                      role="switch"
                      aria-checked={cameraMirror}
                      onClick={() => setCameraMirror((v) => !v)}
                    className={`h-5 w-10 rounded-full border transition cursor-pointer ${
                        cameraMirror ? "border-cyan-400/60 bg-cyan-400/30" : "border-white/10 bg-slate-900/80"
                      }`}
                    >
                      <span className={`block h-4 w-4 rounded-full bg-white transition ${cameraMirror ? "translate-x-5" : "translate-x-1"}`} />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2">
                    <span>Blur</span>
                    <Button
                      type="button"
                      role="switch"
                      aria-checked={cameraBlur}
                      onClick={() => setCameraBlur((v) => !v)}
                    className={`h-5 w-10 rounded-full border transition cursor-pointer ${
                        cameraBlur ? "border-cyan-400/60 bg-cyan-400/30" : "border-white/10 bg-slate-900/80"
                      }`}
                    >
                      <span className={`block h-4 w-4 rounded-full bg-white transition ${cameraBlur ? "translate-x-5" : "translate-x-1"}`} />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2">
                    <span className="text-xs text-slate-400">相机位置</span>
                    <div className="w-32">
                      <SelectMenu
                        value={cameraPosition}
                        options={cameraPositionOptions}
                        onChange={(value) => setCameraPosition(value as CameraPosition)}
                        icon={<FiUser className="text-slate-500" />}
                      />
                    </div>
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
                      <Button
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
                      </Button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(backgroundType === "gradient"
                      ? backgroundPresets.gradients
                      : backgroundPresets.wallpapers
                    ).map((preset, index) => (
                      <Button
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
                      <span>{editShadow}</span>
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
                  <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
                    <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                      Safe Area
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <span>X</span>
                        <span>{Math.round(safeRect.x * 100)}%</span>
                      </div>
                      <input
                        className="mt-2 w-full"
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(safeRect.x * 100)}
                        onChange={(event) => updateSafeRect({ x: Number(event.target.value) / 100 })}
                      />
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center justify-between">
                        <span>Y</span>
                        <span>{Math.round(safeRect.y * 100)}%</span>
                      </div>
                      <input
                        className="mt-2 w-full"
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(safeRect.y * 100)}
                        onChange={(event) => updateSafeRect({ y: Number(event.target.value) / 100 })}
                      />
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center justify-between">
                        <span>W</span>
                        <span>{Math.round(safeRect.w * 100)}%</span>
                      </div>
                      <input
                        className="mt-2 w-full"
                        type="range"
                        min={20}
                        max={100}
                        step={1}
                        value={Math.round(safeRect.w * 100)}
                        onChange={(event) => updateSafeRect({ w: Number(event.target.value) / 100 })}
                      />
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center justify-between">
                        <span>H</span>
                        <span>{Math.round(safeRect.h * 100)}%</span>
                      </div>
                      <input
                        className="mt-2 w-full"
                        type="range"
                        min={20}
                        max={100}
                        step={1}
                        value={Math.round(safeRect.h * 100)}
                        onChange={(event) => updateSafeRect({ h: Number(event.target.value) / 100 })}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
              </div>
            ) : null}
          </aside>
          {isMobile && drawerOpen ? (
            <div className="fixed inset-y-0 right-0 z-50 w-[min(90vw,380px)] rounded-l-2xl border border-white/5 bg-slate-900/90 p-3 text-xs text-slate-300 backdrop-blur">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Settings</div>
                <Button
                  isIconOnly
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="h-7 w-7 rounded-lg border border-white/10 bg-slate-950/60 text-slate-400"
                  aria-label="关闭"
                >
                  ×
                </Button>
              </div>
              <div className="space-y-3">
                {activeTab === "camera" ? (
                  <div className="space-y-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Camera</div>
                    <div>
                      <div className="flex items-center justify-between">
                        <span>Size</span>
                        <span>{cameraSize}px</span>
                      </div>
                      <input
                        className="mt-2 w-full"
                        type="range"
                        min={120}
                        max={320}
                        step={2}
                        value={cameraSize}
                        onChange={(event) => setCameraSize(Number(event.target.value))}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      {(["circle", "rounded", "square"] as const).map((shape) => (
                        <Button
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
                        </Button>
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
                      <Button
                        type="button"
                        role="switch"
                        aria-checked={cameraMirror}
                        onClick={() => setCameraMirror((v) => !v)}
                        className={`h-5 w-10 rounded-full border transition ${
                          cameraMirror ? "border-cyan-400/60 bg-cyan-400/30" : "border-white/10 bg-slate-900/80"
                        }`}
                      >
                        <span className={`block h-4 w-4 rounded-full bg-white transition ${cameraMirror ? "translate-x-5" : "translate-x-1"}`} />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2">
                      <span>Blur</span>
                      <Button
                        type="button"
                        role="switch"
                        aria-checked={cameraBlur}
                        onClick={() => setCameraBlur((v) => !v)}
                        className={`h-5 w-10 rounded-full border transition ${
                          cameraBlur ? "border-cyan-400/60 bg-cyan-400/30" : "border-white/10 bg-slate-900/80"
                        }`}
                      >
                        <span className={`block h-4 w-4 rounded-full bg-white transition ${cameraBlur ? "translate-x-5" : "translate-x-1"}`} />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2">
                      <span className="text-xs text-slate-400">相机位置</span>
                      <div className="w-32">
                        <SelectMenu
                          value={cameraPosition}
                          options={cameraPositionOptions}
                          onChange={(value) => setCameraPosition(value as CameraPosition)}
                          icon={<FiUser className="text-slate-500" />}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
                {activeTab === "background" ? (
                  <div className="space-y-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Background</div>
                    <div className="flex items-center gap-2">
                      {(["gradient", "wallpaper"] as const).map((type) => (
                        <Button
                          key={type}
                          type="button"
                          onClick={() => setBackgroundType(type)}
                          className={`flex-1 rounded-full border px-2 py-1 ${
                            backgroundType === type ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200" : "border-white/10 bg-slate-950/60 text-slate-400"
                          }`}
                        >
                          {type === "gradient" ? "Gradient" : "Wallpaper"}
                        </Button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {(backgroundType === "gradient" ? backgroundPresets.gradients : backgroundPresets.wallpapers).map((preset, index) => (
                        <Button
                          key={`${backgroundType}-${preset}`}
                          type="button"
                          onClick={() => setBackgroundPreset(index)}
                          className={`h-10 rounded-xl border ${backgroundPreset === index ? "border-cyan-400/60" : "border-white/10"}`}
                          style={{ background: preset }}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                {activeTab === "frame" ? (
                  <div className="space-y-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Frame</div>
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
                    <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
                      <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                        Safe Area
                      </div>
                      <div>
                        <div className="flex items-center justify-between">
                          <span>X</span>
                          <span>{Math.round(safeRect.x * 100)}%</span>
                        </div>
                        <input
                          className="mt-2 w-full"
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={Math.round(safeRect.x * 100)}
                          onChange={(event) => updateSafeRect({ x: Number(event.target.value) / 100 })}
                        />
                      </div>
                      <div className="mt-3">
                        <div className="flex items-center justify-between">
                          <span>Y</span>
                          <span>{Math.round(safeRect.y * 100)}%</span>
                        </div>
                        <input
                          className="mt-2 w-full"
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={Math.round(safeRect.y * 100)}
                          onChange={(event) => updateSafeRect({ y: Number(event.target.value) / 100 })}
                        />
                      </div>
                      <div className="mt-3">
                        <div className="flex items-center justify-between">
                          <span>W</span>
                          <span>{Math.round(safeRect.w * 100)}%</span>
                        </div>
                        <input
                          className="mt-2 w-full"
                          type="range"
                          min={20}
                          max={100}
                          step={1}
                          value={Math.round(safeRect.w * 100)}
                          onChange={(event) => updateSafeRect({ w: Number(event.target.value) / 100 })}
                        />
                      </div>
                      <div className="mt-3">
                        <div className="flex items-center justify-between">
                          <span>H</span>
                          <span>{Math.round(safeRect.h * 100)}%</span>
                        </div>
                        <input
                          className="mt-2 w-full"
                          type="range"
                          min={20}
                          max={100}
                          step={1}
                          value={Math.round(safeRect.h * 100)}
                          onChange={(event) => updateSafeRect({ h: Number(event.target.value) / 100 })}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<EditPage />);
