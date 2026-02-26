import { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalSize } from "@tauri-apps/api/window";
import { FiCamera, FiUser, FiImage, FiPause, FiPlay, FiSliders, FiFolder } from "react-icons/fi";
import { Toaster, toast } from "react-hot-toast";
import "./App.css";

import { SelectMenu, type SelectOption } from "./components/SelectMenu";
import { motion } from "framer-motion";
import { Button } from "@heroui/react";
import TimelineUI from "./components/TimelineUI";

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
  settings?: {
    max_zoom?: number;
  };
};
type CursorEvent = {
  kind: string;
  offset_ms: number;
  axn: number;
  ayn: number;
};

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
  const smoothZoomRef = useRef<number | null>(null);
  const [zoomProgress, setZoomProgress] = useState(0);
  const zoomProgressRef = useRef(0);
  const [cursorEvents, setCursorEvents] = useState<CursorEvent[]>([]);
  const [clipBlocks, setClipBlocks] = useState<Block[]>([]);
  const [zoomBlocks, setZoomBlocks] = useState<Block[]>([]);
  const [avatarBlocks, setAvatarBlocks] = useState<Block[]>([]);
  const historyRef = useRef<{ clip: Block[]; zoom: Block[]; avatar: Block[] }[]>([]);
  const histIndexRef = useRef<number>(-1);
  const pushHistory = (clip: Block[], zoom: Block[], avatar: Block[]) => {
    const last = historyRef.current[histIndexRef.current] || null;
    const same =
      last &&
      JSON.stringify(last.clip) === JSON.stringify(clip) &&
      JSON.stringify(last.zoom) === JSON.stringify(zoom) &&
      JSON.stringify(last.avatar) === JSON.stringify(avatar);
    if (same) return;
    historyRef.current = historyRef.current.slice(0, histIndexRef.current + 1);
    historyRef.current.push({ clip: clip.map((b) => ({ ...b })), zoom: zoom.map((b) => ({ ...b })), avatar: avatar.map((b) => ({ ...b })) });
    histIndexRef.current = historyRef.current.length - 1;
  };
  useEffect(() => {
    pushHistory(clipBlocks, zoomBlocks, avatarBlocks);
  }, [clipBlocks, zoomBlocks, avatarBlocks]);
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const z = e.ctrlKey && !e.shiftKey && (e.key.toLowerCase() === "z");
      const y = (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "z") || (e.ctrlKey && e.key.toLowerCase() === "y");
      if (z) {
        if (histIndexRef.current > 0) {
          histIndexRef.current -= 1;
          const entry = historyRef.current[histIndexRef.current];
          setClipBlocks(entry.clip.map((b) => ({ ...b })));
          setZoomBlocks(entry.zoom.map((b) => ({ ...b })));
          setAvatarBlocks(entry.avatar.map((b) => ({ ...b })));
          persistClipBlocks(entry.clip);
          persistZoomBlocks(entry.zoom);
          persistAvatarBlocks(entry.avatar);
        }
      } else if (y) {
        if (histIndexRef.current < historyRef.current.length - 1) {
          histIndexRef.current += 1;
          const entry = historyRef.current[histIndexRef.current];
          setClipBlocks(entry.clip.map((b) => ({ ...b })));
          setZoomBlocks(entry.zoom.map((b) => ({ ...b })));
          setAvatarBlocks(entry.avatar.map((b) => ({ ...b })));
          persistClipBlocks(entry.clip);
          persistZoomBlocks(entry.zoom);
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
    if (!previewSrc || !outputPath) {
      setCursorEvents([]);
      return;
    }
    invoke<string>("ensure_cursor_track", { inputPath: outputPath })
      .then(async (cursorPath) => {
        const url = convertFileSrc(cursorPath);
        const res = await fetch(url);
        const text = await res.text();
        const events: CursorEvent[] = [];
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          try {
            const rec = JSON.parse(line) as CursorEvent;
            if (typeof rec.axn === "number" && typeof rec.ayn === "number") {
              events.push(rec);
            }
          } catch {
            continue;
          }
        }
        events.sort((a, b) => a.offset_ms - b.offset_ms);
        setCursorEvents(events);
      })
      .catch(() => setCursorEvents([]));
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
    if (!outputPath) return;
    invoke<string>("ensure_clip_track", { inputPath: outputPath })
      .then(async (path) => {
        const url = convertFileSrc(path);
        const res = await fetch(url);
        const data = await res.json();
        const segs = (data?.segments || []) as { start_s: number; end_s: number }[];
        if (segs.length === 0) {
          setClipBlocks([]);
        } else {
          const start = Math.min(...segs.map((s) => s.start_s));
          const end = Math.max(...segs.map((s) => s.end_s));
          setClipBlocks([{ id: "clip-1", start, end }]);
        }
      })
      .catch(() => setClipBlocks([]));
    invoke<string>("ensure_camera_track", { inputPath: outputPath })
      .then(async (path) => {
        const url = convertFileSrc(path);
        const res = await fetch(url);
        const data = await res.json();
        const segs = (data?.segments || []) as { start_s: number; end_s: number; visible?: boolean }[];
        const vis = segs.filter((s) => s.visible !== false);
        if (vis.length === 0) {
          setAvatarBlocks([]);
        } else {
          const start = Math.min(...vis.map((s) => s.start_s));
          const end = Math.max(...vis.map((s) => s.end_s));
          setAvatarBlocks([{ id: "avatar-1", start, end }]);
        }
      })
      .catch(() => setAvatarBlocks([]));
  }, [outputPath]);

  useEffect(() => {
    if (!zoomTrack || !previewDuration) {
      setZoomBlocks([]);
      return;
    }
    const frames = zoomTrack.frames || [];
    const windows: { start: number; end: number }[] = [];
    let i = 0;
    const n = frames.length;
    while (i < n) {
      while (i < n && frames[i].zoom <= 1.0001) i++;
      if (i >= n) break;
      const s = (frames[i].time_ms || 0) / 1000;
      let j = i;
      while (j < n && frames[j].zoom > 1.0001) j++;
      const e = (frames[Math.max(0, j - 1)].time_ms || 0) / 1000;
      windows.push({ start: s, end: e });
      i = j;
      if (windows.length > 100) break;
    }
    const z = windows.length
      ? windows.map((w, i2) => ({ id: `zoom-${i2 + 1}`, start: w.start, end: Math.min(previewDuration, w.end) }))
      : [];
    setZoomBlocks(z);
  }, [zoomTrack, previewDuration]);

  const persistClipBlocks = async (blocks: { id: string; start: number; end: number }[]) => {
    if (!outputPath) return;
    const seg = blocks[0];
    const payload = seg
      ? { segments: [{ start_s: seg.start, end_s: seg.end }] }
      : { segments: [] as { start_s: number; end_s: number }[] };
    await invoke<string>("save_clip_track", { inputPath: outputPath, trackJson: JSON.stringify(payload) }).catch(() => null);
  };
  const persistAvatarBlocks = async (blocks: { id: string; start: number; end: number }[]) => {
    if (!outputPath) return;
    const seg = blocks[0];
    const payload = seg
      ? { segments: [{ start_s: seg.start, end_s: seg.end, visible: true }] }
      : { segments: [] as { start_s: number; end_s: number; visible: boolean }[] };
    await invoke<string>("save_camera_track", { inputPath: outputPath, trackJson: JSON.stringify(payload) }).catch(() => null);
  };
  const persistZoomBlocks = async (blocks: { id: string; start: number; end: number }[]) => {
    if (!outputPath) return;
    const fps = 30;
    const videoDuration =
      previewVideoRef.current && Number.isFinite(previewVideoRef.current.duration)
        ? previewVideoRef.current.duration
        : 0;
    const maxEnd = blocks.reduce((acc, b) => Math.max(acc, b.end), 0);
    const duration = Math.max(previewDuration || 0, videoDuration, maxEnd);
    const totalFrames = Math.max(1, Math.round(duration * fps));
    const frames: ZoomFrame[] = [];
    const rampIn = 0.4;
    const rampOut = 0.4;
    const ease = (u: number) => 1 + (2 - 1) * (1 - Math.pow(1 - Math.max(0, Math.min(1, u)), 3));
    let cursorIndex = 0;
    let currentAxn = 0.5;
    let currentAyn = 0.5;
    for (let i = 0; i < totalFrames; i++) {
      const t = i / fps;
      let inWindow = false;
      let z = 1;
      const tMs = Math.round(t * 1000);
      while (cursorIndex < cursorEvents.length && cursorEvents[cursorIndex].offset_ms <= tMs) {
        currentAxn = cursorEvents[cursorIndex].axn;
        currentAyn = cursorEvents[cursorIndex].ayn;
        cursorIndex += 1;
      }
      for (const b of blocks) {
        if (t >= b.start && t <= b.end) {
          inWindow = true;
          if (t < b.start + rampIn) {
            const u = (t - b.start) / Math.max(1e-6, rampIn);
            z = ease(u);
          } else if (t > b.end - rampOut) {
            const u = (b.end - t) / Math.max(1e-6, rampOut);
            z = ease(u);
          } else {
            z = 2.0;
          }
          break;
        }
      }
      frames.push({
        time_ms: tMs,
        axn: currentAxn,
        ayn: currentAyn,
        zoom: inWindow ? z : 1.0,
      });
    }
    const payload = {
      fps,
      frames,
      settings: {
        max_zoom: 2.0,
        ramp_in_s: rampIn,
        ramp_out_s: rampOut,
        sample_ms: 120,
        follow_threshold_px: 160,
      },
    };
    await invoke<string>("save_zoom_track", { inputPath: outputPath, trackJson: JSON.stringify(payload) }).catch(() => null);
    setZoomTrack(payload as ZoomTrack);
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
    const video = previewVideoRef.current;
    if (!video) return;
    let stop = false;
    let rafId: number | null = null;
    const runRaf = () => {
      if (stop) return;
      if (!isScrubbingRef.current) {
        setPreviewTime(video.currentTime || 0);
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
            setPreviewTime(video.currentTime || 0);
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
  const MARGIN_LR_169 = 0.06;
  const MARGIN_TB_916 = 0.36;
  const MARGIN_TB_11 = 0.24;
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
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
  const safeRectForAspect = () => {
    let marginLR = 0;
    let marginTB = 0;
    if (editAspect === "16:9") {
      marginLR = MARGIN_LR_169;
    } else if (editAspect === "1:1") {
      marginTB = MARGIN_TB_11;
    } else {
      marginTB = MARGIN_TB_916;
    }
    const w = Math.max(0, 1 - marginLR * 2);
    const h = Math.max(0, 1 - marginTB * 2);
    return { x: marginLR, y: marginTB, w, h };
  };
  const avatarZoomTarget = editAspect === "9:16" ? 0.62 : 0.7;
  const zoomAvatarScale = lerp(1, avatarZoomTarget, zoomProgress);
  const effectiveAvatarScale = Math.min(avatarScale, zoomAvatarScale);
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
      await persistZoomBlocks(zoomBlocks);
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
    if (video.readyState < 2 || !vw || !vh || !Number.isFinite(video.currentTime)) return;
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, cw, ch);
    let z = 1;
    let axn = 0.5;
    let ayn = 0.5;
    if (zoomTrack && zoomTrack.frames && zoomTrack.frames.length > 0) {
      const fps = zoomTrack.fps || 30;
      const idx = Math.max(0, Math.min(zoomTrack.frames.length - 1, Math.round((video.currentTime || 0) * fps)));
      const f = zoomTrack.frames[idx];
      if (f) {
        z = f.zoom || 1;
        axn = f.axn ?? 0.5;
        ayn = f.ayn ?? 0.5;
      }
    }
    const tz = z;
    const taxn = axn;
    const tayn = ayn;
    const prevZ = smoothZoomRef.current ?? tz;
    const prevAxn = smoothAxnRef.current ?? taxn;
    const prevAyn = smoothAynRef.current ?? tayn;
    const nextZ = prevZ + (tz - prevZ) * 0.25;
    const nextAxn = prevAxn + (taxn - prevAxn) * 0.35;
    const nextAyn = prevAyn + (tayn - prevAyn) * 0.35;
    smoothZoomRef.current = nextZ;
    smoothAxnRef.current = nextAxn;
    smoothAynRef.current = nextAyn;
    z = nextZ;
    axn = nextAxn;
    ayn = nextAyn;
    const maxZoom = Math.max(1.0001, zoomTrack?.settings?.max_zoom ?? 2);
    const rawProgress = (z - 1) / (maxZoom - 1);
    const easedProgress = easeInOutCubic(clamp(rawProgress, 0, 1));
    if (Math.abs(zoomProgressRef.current - easedProgress) > 0.001) {
      zoomProgressRef.current = easedProgress;
      setZoomProgress(easedProgress);
    }
    const safeRect = safeRectForAspect();
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
    const destAspect = safeW / safeH;
    const videoAspect = vw / vh;
    let srcW = vw;
    let srcH = vh;
    let srcX = 0;
    let srcY = 0;
    if (videoAspect >= destAspect) {
      srcH = vh;
      srcW = Math.max(1, Math.round(vh * destAspect));
      srcX = Math.round((vw - srcW) / 2);
      srcY = 0;
    } else {
      srcW = vw;
      srcH = Math.max(1, Math.round(vw / destAspect));
      srcX = 0;
      srcY = Math.round((vh - srcH) / 2);
    }
    compCtx.drawImage(video, srcX, srcY, srcW, srcH, safeX, safeY, safeW, safeH);
    const sw = Math.max(1, Math.round(cw / Math.max(1e-6, z)));
    const sh = Math.max(1, Math.round(ch / Math.max(1e-6, z)));
    const baseX = safeX + Math.round(axn * safeW - sw / 2);
    const baseY = safeY + Math.round(ayn * safeH - sh / 2);
    const baseXClamped = clamp(baseX, 0, Math.max(0, cw - sw));
    const baseYClamped = clamp(baseY, 0, Math.max(0, ch - sh));
    const safeMaxX = Math.max(safeX, safeX + safeW - sw);
    const safeMaxY = Math.max(safeY, safeY + safeH - sh);
    const safeXClamped = clamp(baseXClamped, safeX, safeMaxX);
    const safeYClamped = clamp(baseYClamped, safeY, safeMaxY);
    const sx = Math.round(lerp(baseXClamped, safeXClamped, easedProgress));
    const sy = Math.round(lerp(baseYClamped, safeYClamped, easedProgress));
    ctx.drawImage(composite, sx, sy, sw, sh, 0, 0, cw, ch);
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
  }, [previewPlaying, zoomTrack, previewFrameWidth, previewFrameHeight]);
  useEffect(() => {
    drawCanvas();
  }, [previewTime, zoomTrack, previewFrameWidth, previewFrameHeight]);
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
                zoomBlocks={zoomBlocks}
                avatarBlocks={avatarBlocks}
                onClipChange={(blocks) => {
                  setClipBlocks(blocks);
                  persistClipBlocks(blocks);
                }}
                onZoomChange={(blocks) => {
                  setZoomBlocks(blocks);
                  persistZoomBlocks(blocks);
                }}
                onAvatarChange={(blocks) => {
                  setAvatarBlocks(blocks);
                  persistAvatarBlocks(blocks);
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
                  const t = Math.max(0, Math.min(previewDuration || 0, tSeconds));
                  video.currentTime = t;
                  syncAvatarToPreview(t);
                  setPreviewTime(t);
                }}
                onScrubEnd={(tSeconds) => {
                  const video = previewVideoRef.current;
                  if (!video) return;
                  const t = Math.max(0, Math.min(previewDuration || 0, tSeconds));
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
                    <div>
                      <div className="flex items-center justify-between">
                        <span>16:9 左右边距固定 6%</span>
                      </div>
                      <div className="mt-2 text-slate-400">与竞品一致的左右留边</div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <span>1:1 上下边距固定 24%</span>
                      </div>
                      <div className="mt-2 text-slate-400">保持原画面比例，垂直留边</div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <span>Safe Area 9:16</span>
                        <span>固定 36%</span>
                      </div>
                      <div className="mt-2 text-slate-400">9:16 上下边距固定 36%</div>
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
