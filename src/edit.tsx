import { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalSize } from "@tauri-apps/api/window";
import { FiCamera, FiUser, FiImage, FiPause, FiPlay, FiSliders, FiFolder } from "react-icons/fi";
import { Toaster, toast } from "react-hot-toast";
import "./App.css";
import { SelectMenu, type SelectOption } from "./components/SelectMenu";
import { Switch } from "@headlessui/react";
import { motion } from "framer-motion";

const SETTINGS_EXPORT_DIR = "settingsExportDir";

type ZoomFrame = {
  time_ms: number;
  axn: number;
  ayn: number;
  zoom: number;
};
type ZoomTrack = {
  fps: number;
  frames: ZoomFrame[];
};

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
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const wasPlayingRef = useRef(false);
  const isScrubbingRef = useRef(false);
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
  const [zoomTrack, setZoomTrack] = useState<ZoomTrack | null>(null);
  const realtimeFrameRef = useRef<ZoomFrame | null>(null);
  const smoothAxnRef = useRef<number | null>(null);
  const smoothAynRef = useRef<number | null>(null);
  const zoomSegments = useMemo(() => {
    const segs: Array<{ s: number; e: number }> = [];
    if (zoomTrack && zoomTrack.frames.length) {
      const frames = zoomTrack.frames;
      let i = 0;
      const n = frames.length;
      while (i < n) {
        while (i < n && frames[i].zoom <= 1.0001) i++;
        if (i >= n) break;
        const s = frames[i].time_ms / 1000;
        let j = i;
        while (j < n && frames[j].zoom > 1.0001) j++;
        const e = frames[Math.max(i, j - 1)].time_ms / 1000;
        segs.push({ s, e });
        i = j;
        if (segs.length > 100) break;
      }
    }
    return segs;
  }, [zoomTrack]);

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
    if (!previewSrc || !outputPath) return;
    invoke<string>("ensure_zoom_track", { inputPath: outputPath })
      .then(async (trackPath) => {
        const url = convertFileSrc(trackPath);
        const res = await fetch(url);
        const data = await res.json();
        setZoomTrack(data as ZoomTrack);
      })
      .catch(() => null);
  }, [previewSrc, outputPath]);

  useEffect(() => {
    const unlistenPromise = listen<ZoomFrame>("zoom_frame", (ev) => {
      const f = ev.payload;
      realtimeFrameRef.current = f;
    });
    return () => {
      unlistenPromise.then((u) => u()).catch(() => null);
    };
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
      setZoomTrack(null);
      return;
    }
    invoke<string>("ensure_zoom_track", { inputPath: outputPath })
      .then(async (trackPath) => {
        const url = convertFileSrc(trackPath);
        const res = await fetch(url);
        const data = await res.json();
        setZoomTrack(data as ZoomTrack);
      })
      .catch(() => setZoomTrack(null));
  }, [outputPath]);

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
        setCameraSize(state.camera_size);
        setCameraShape(cameraShapeValue);
        setCameraShadow(state.camera_shadow);
        setCameraMirror(state.camera_mirror);
        setCameraBlur(state.camera_blur);
        setBackgroundType(backgroundValue);
        setBackgroundPreset(state.background_preset);
        setCameraPosition(cameraPosValue);
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
      smoothAxnRef.current = null;
      smoothAynRef.current = null;
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

  // 移除未使用的路径拼接与设置常量
  const sessionIdFromInput = (input: string) => {
    const parts = input.split(/[/\\]/);
    return parts.length >= 2 ? parts[parts.length - 2] : "export";
  };

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
      camera_position: cameraPosition,
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
    const unlistenPromise = listen<ExportStatus>("export_progress", (event) => {
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
    });
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
      const offsetY = 8;
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
  const shrink = editAspect === "9:16" ? 0.92 : 1.0;
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
  const previewSeekMax = Math.max(previewDuration, 0.001);
  const previewControlsDisabled = !previewSrc || previewLoading || !!previewError;
  const exportBusy =
    exportStatus?.state === "running" || exportStatus?.state === "queued";

  const [exportDir, setExportDir] = useState("");
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
  const openExportFolder = async () => {
    try {
      const dir = await invoke<string>("get_export_dir");
      await invoke("open_path", { path: dir });
    } catch (error) {
      toast.error(String(error).split("\n")[0].slice(0, 140));
    }
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
      camera_position: cameraPosition,
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
  const rafRef = useRef<number | null>(null);
  const sampleZoom = (tMs: number): ZoomFrame | null => {
    const track = zoomTrack;
    if (!track || !track.frames.length) return null;
    const frames = track.frames;
    let i = 0;
    let j = frames.length - 1;
    while (i < j) {
      const m = ((i + j) >> 1) as number;
      if (frames[m].time_ms < tMs) i = m + 1;
      else j = m;
    }
    const idx = i;
    const f1 = frames[idx];
    const f0 = frames[Math.max(0, idx - 1)];
    if (f0.time_ms === f1.time_ms) return f1;
    const u = Math.min(1, Math.max(0, (tMs - f0.time_ms) / (f1.time_ms - f0.time_ms)));
    return {
      time_ms: tMs,
      axn: f0.axn * (1 - u) + f1.axn * u,
      ayn: f0.ayn * (1 - u) + f1.ayn * u,
      zoom: f0.zoom * (1 - u) + f1.zoom * u,
    };
  };
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
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, cw, ch);
    const vw = Math.max(1, video.videoWidth || 0);
    const vh = Math.max(1, video.videoHeight || 0);
    if (!vw || !vh || !Number.isFinite(video.currentTime)) return;
    const tMs = Math.round((video.currentTime || 0) * 1000);
    let frame = sampleZoom(tMs);
    const rt = realtimeFrameRef.current;
    if (rt && Math.abs(rt.time_ms - tMs) <= 200) {
      frame = rt;
    }
    const dx = Math.round(cw * shrink);
    const dy = Math.round(ch * shrink);
    const destX = Math.round((cw - dx) / 2);
    const destY = Math.round((ch - dy) / 2);
    if (!frame) {
      const va = vw / vh;
      const ra = dx / dy;
      const dw = ra > va ? Math.round(dy * va) : dx;
      const dh = ra > va ? dy : Math.round(dx / va);
      const offX = destX + Math.round((dx - dw) / 2);
      const offY = destY + Math.round((dy - dh) / 2);
      ctx.drawImage(video, 0, 0, vw, vh, offX, offY, dw, dh);
      return;
    }
    const z = Math.max(1, Math.min(4, frame.zoom || 1));
    const maxStep = 0.06;
    const prevAxn = smoothAxnRef.current ?? frame.axn;
    const prevAyn = smoothAynRef.current ?? frame.ayn;
    const dxn = frame.axn - prevAxn;
    const dyn = frame.ayn - prevAyn;
    const len = Math.hypot(dxn, dyn);
    if (len > maxStep) {
      const s = maxStep / (len || 1);
      smoothAxnRef.current = prevAxn + dxn * s;
      smoothAynRef.current = prevAyn + dyn * s;
    } else {
      smoothAxnRef.current = frame.axn;
      smoothAynRef.current = frame.ayn;
    }
    const axn2 = smoothAxnRef.current ?? frame.axn;
    const ayn2 = smoothAynRef.current ?? frame.ayn;
    const sw = Math.round(vw / z);
    const sh = Math.round(vh / z);
    const px = Math.round(Math.min(Math.max(axn2 * vw - sw / 2, 0), vw - sw));
    const py = Math.round(Math.min(Math.max(ayn2 * vh - sh / 2, 0), vh - sh));
    ctx.drawImage(video, px, py, sw, sh, destX, destY, dx, dy);
  };
  useEffect(() => {
    if (previewPlaying) {
      const tick = () => {
        drawCanvas();
        rafRef.current = window.requestAnimationFrame(tick);
      };
      rafRef.current = window.requestAnimationFrame(tick);
      return () => {
        if (rafRef.current) {
          window.cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
    } else {
      drawCanvas();
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
  }, [previewPlaying, zoomTrack, shrink, previewFrameWidth, previewFrameHeight]);
  useEffect(() => {
    drawCanvas();
  }, [previewTime, zoomTrack, shrink, previewFrameWidth, previewFrameHeight]);
  const previewSurface = previewSrc ? (
    <>
      <video
        ref={previewVideoRef}
        className="h-0 w-0 absolute opacity-0 pointer-events-none"
        src={previewSrc}
        muted
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
                      const container = previewContentRef.current;
                      if (!container) return;
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
                    transformOrigin:
                      cameraPosition === "top_left"
                        ? "top left"
                        : cameraPosition === "top_right"
                        ? "top right"
                        : cameraPosition === "bottom_right"
                        ? "bottom right"
                        : "bottom left",
                    background: cameraBlur ? "rgba(15, 23, 42, 0.25)" : "rgba(15, 23, 42, 0.18)",
                    backdropFilter: cameraBlur ? "blur(18px) saturate(140%)" : "blur(10px)",
                    ...(cameraPosition === "top_left"
                      ? { top: 12, left: 12 }
                      : cameraPosition === "top_right"
                      ? { top: 12, right: 12 }
                      : cameraPosition === "bottom_right"
                      ? { bottom: 12, right: 12 }
                      : { bottom: 12, left: 12 }),
                  }}
                  animate={{ scale: avatarScale, scaleX: cameraMirror ? -1 : 1 }}
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
              className="pointer-events-auto absolute z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-[10px] text-slate-200"
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
              <button
                type="button"
                onClick={togglePreviewPlayback}
                disabled={previewControlsDisabled}
                className={`flex items-center gap-2 rounded-full border border-white/10 px-2.5 py-1 transition ${
                  previewControlsDisabled
                    ? "bg-slate-900/50 text-slate-500"
                    : "bg-slate-950/70 text-slate-200 hover:border-cyan-400/50"
                }`}
              >
                {previewPlaying ? <FiPause /> : <FiPlay />}
                <span>{previewPlaying ? "暂停" : "播放"}</span>
              </button>
              <button
                type="button"
                onClick={handleExport}
                disabled={exportDisabled}
                className={`flex items-center gap-2 rounded-full border border-white/10 px-2.5 py-1 transition ${
                  exportDisabled
                    ? "bg-slate-900/50 text-slate-500"
                    : "bg-slate-950/70 text-slate-200 hover:border-cyan-400/50"
                }`}
              >
                {exportBusy ? (
                  <span className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-r-transparent" />
                ) : null}
                <span>导出</span>
              </button>
              <button
                type="button"
                onClick={openExportFolder}
                className="flex items-center gap-2 rounded-full border border-white/10 px-2.5 py-1 transition bg-slate-950/70 text-slate-200 hover:border-cyan-400/50"
              >
                <FiFolder />
                <span>打开文件夹</span>
              </button>
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
                style={{ marginTop: 28 }}
              />
            </div>
            {previewDuration > 0 ? (
              <div className="w-full px-3 py-2">
                <div className="relative w-full rounded-xl border border-white/10 bg-slate-950/60">
                  <div className="relative h-9 w-full">
                    {Array.from({ length: Math.ceil(previewDuration) + 1 }).map((_, i) => (
                      <div
                        key={`tick-${i}`}
                        className="absolute top-0 h-full w-px bg-white/10"
                        style={{ left: `${(i / Math.max(previewDuration, 0.001)) * 100}%` }}
                      />
                    ))}
                    <div className="absolute left-2 top-1/2 -translate-y-1/2 rounded-md bg-blue-600/80 px-2 py-1 text-[10px] text-white">
                      Clip
                    </div>
                    <div className="absolute left-8 right-2 top-1/2 h-4 -translate-y-1/2 rounded-md bg-blue-500/40" />
                  </div>
                  <div className="relative h-9 w-full mt-1">
                    <div className="absolute left-2 top-1/2 -translate-y-1/2 rounded-md bg-pink-600/80 px-2 py-1 text-[10px] text-white">
                      Zoom
                    </div>
                    <div className="absolute left-8 right-2 top-1/2 h-4 -translate-y-1/2 rounded-md bg-pink-500/20" />
                    {zoomSegments.map((seg, idx) => {
                      const left = Math.min(100, Math.max(0, (seg.s / previewDuration) * 100));
                      const right = Math.min(100, Math.max(0, (seg.e / previewDuration) * 100));
                      const width = Math.max(0, right - left);
                      return (
                        <div
                          key={`zoom-seg-${idx}`}
                          className="absolute top-1/2 h-4 -translate-y-1/2 rounded-md bg-pink-500/70"
                          style={{ left: `${left}%`, width: `${width}%` }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}
            <Toaster position="top-center" toastOptions={{ duration: 1600 }} />
          </section>

          <aside
            className="flex gap-2"
            style={{
              width: isMobile ? 56 : "clamp(280px, 24vw, 380px)",
            }}
          >
            <div className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-slate-900/60 p-1.5">
              <button
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
              </button>
              <button
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
              </button>
              <button
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
              </button>
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
                    <Switch
                      checked={cameraMirror}
                      onChange={setCameraMirror}
                      className={`h-5 w-10 rounded-full border transition ${
                        cameraMirror ? "border-cyan-400/60 bg-cyan-400/30" : "border-white/10 bg-slate-900/80"
                      }`}
                    >
                      <span className={`block h-4 w-4 rounded-full bg-white transition ${cameraMirror ? "translate-x-5" : "translate-x-1"}`} />
                    </Switch>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2">
                    <span>Blur</span>
                    <Switch
                      checked={cameraBlur}
                      onChange={setCameraBlur}
                      className={`h-5 w-10 rounded-full border transition ${
                        cameraBlur ? "border-cyan-400/60 bg-cyan-400/30" : "border-white/10 bg-slate-900/80"
                      }`}
                    >
                      <span className={`block h-4 w-4 rounded-full bg-white transition ${cameraBlur ? "translate-x-5" : "translate-x-1"}`} />
                    </Switch>
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
            ) : null}
          </aside>
          {isMobile && drawerOpen ? (
            <div className="fixed inset-y-0 right-0 z-50 w-[min(90vw,380px)] rounded-l-2xl border border-white/5 bg-slate-900/90 p-3 text-xs text-slate-300 backdrop-blur">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Settings</div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="h-7 w-7 rounded-lg border border-white/10 bg-slate-950/60 text-slate-400"
                  aria-label="关闭"
                >
                  ×
                </button>
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
                      <Switch
                        checked={cameraMirror}
                        onChange={setCameraMirror}
                        className={`h-5 w-10 rounded-full border transition ${
                          cameraMirror ? "border-cyan-400/60 bg-cyan-400/30" : "border-white/10 bg-slate-900/80"
                        }`}
                      >
                        <span className={`block h-4 w-4 rounded-full bg-white transition ${cameraMirror ? "translate-x-5" : "translate-x-1"}`} />
                      </Switch>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2">
                      <span>Blur</span>
                      <Switch
                        checked={cameraBlur}
                        onChange={setCameraBlur}
                        className={`h-5 w-10 rounded-full border transition ${
                          cameraBlur ? "border-cyan-400/60 bg-cyan-400/30" : "border-white/10 bg-slate-900/80"
                        }`}
                      >
                        <span className={`block h-4 w-4 rounded-full bg-white transition ${cameraBlur ? "translate-x-5" : "translate-x-1"}`} />
                      </Switch>
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
                        <button
                          key={type}
                          type="button"
                          onClick={() => setBackgroundType(type)}
                          className={`flex-1 rounded-full border px-2 py-1 ${
                            backgroundType === type ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200" : "border-white/10 bg-slate-950/60 text-slate-400"
                          }`}
                        >
                          {type === "gradient" ? "Gradient" : "Wallpaper"}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {(backgroundType === "gradient" ? backgroundPresets.gradients : backgroundPresets.wallpapers).map((preset, index) => (
                        <button
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
