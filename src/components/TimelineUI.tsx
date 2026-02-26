import { Button, Card, Popover, PopoverTrigger, PopoverContent } from "@heroui/react";
import { FiChevronLeft, FiSearch, FiLink, FiMenu, FiScissors, FiCamera, FiMic, FiPlay, FiMaximize2, FiUser } from "react-icons/fi";
import { useEffect, useRef, useState } from "react";

type TimelineUIProps = {
  duration?: number;
  playheadPercent?: number;
  compact?: boolean;
  className?: string;
  minorStepPx?: number;
  majorStepPx?: number;
  smoothFactor?: number;
  onScrubStart?: () => void;
  onScrubMove?: (tSeconds: number) => void;
  onScrubEnd?: (tSeconds: number) => void;
  clipBlocks?: { id: string; start: number; end: number }[];
  zoomBlocks?: { id: string; start: number; end: number }[];
  avatarBlocks?: { id: string; start: number; end: number }[];
  onClipChange?: (blocks: { id: string; start: number; end: number }[]) => void;
  onZoomChange?: (blocks: { id: string; start: number; end: number }[]) => void;
  onAvatarChange?: (blocks: { id: string; start: number; end: number }[]) => void;
};

const TimelineUI = ({
  duration = 6,
  playheadPercent = 60,
  compact = true,
  className,
  minorStepPx = 10,
  majorStepPx = 100,
  smoothFactor = 0.35,
  onScrubStart,
  onScrubMove,
  onScrubEnd,
  clipBlocks,
  zoomBlocks,
  avatarBlocks,
  onClipChange,
  onZoomChange,
  onAvatarChange,
}: TimelineUIProps) => {
  const labelStep = duration <= 12 ? 0.5 : 1;
  const labels = Array.from({ length: Math.floor(duration / labelStep) + 1 }, (_, i) => +(i * labelStep).toFixed(labelStep < 1 ? 1 : 0));
  const [hoverId, setHoverId] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const targetXRef = useRef(0);
  const [playheadX, setPlayheadX] = useState(0);
  const playheadXRef = useRef(0);
  const editingRef = useRef<{ type: "clip" | "zoom" | "avatar"; id: string; mode: "move" | "resize-l" | "resize-r"; startX: number; origStart: number; origEnd: number } | null>(null);
  const [selected, setSelected] = useState<{ type: "clip" | "zoom" | "avatar"; id?: string } | null>(null);
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const init = (playheadPercent / 100) * rect.width;
    playheadXRef.current = init;
    setPlayheadX(init);
    targetXRef.current = init;
    let raf = 0;
    const tick = () => {
      const current = playheadXRef.current;
      const target = targetXRef.current;
      const next = current + (target - current) * smoothFactor;
      playheadXRef.current = next;
      setPlayheadX(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const to = (playheadPercent / 100) * rect.width;
    targetXRef.current = to;
    if (!dragging) {
      playheadXRef.current = to;
      setPlayheadX(to);
    }
  }, [playheadPercent, dragging]);
  const toTime = (x: number) => {
    const el = railRef.current;
    if (!el || !duration) return 0;
    const rect = el.getBoundingClientRect();
    const t = (x / rect.width) * duration;
    return Math.max(0, Math.min(duration, t));
  };
  const toX = (t: number) => {
    const el = railRef.current;
    if (!el || !duration) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min((t / duration) * rect.width, rect.width));
  };
  const onPointer = (clientX: number) => {
    const el = railRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    targetXRef.current = x;
    if (onScrubMove) {
      onScrubMove(toTime(x));
    }
  };
  const snapOnRelease = () => {
    const el = railRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(targetXRef.current, rect.width));
    const m = minorStepPx;
    const nearest = Math.round(x / m) * m;
    if (Math.abs(nearest - x) <= 4) {
      targetXRef.current = nearest;
    }
  };
  const formatPrecise = (t: number) => {
    const minutes = Math.floor(t / 60)
      .toString()
      .padStart(2, "0");
    const seconds = Math.floor(t % 60)
      .toString()
      .padStart(2, "0");
    const ms = Math.round((t - Math.floor(t)) * 1000)
      .toString()
      .padStart(3, "0");
    return `${minutes}:${seconds}:${ms}`;
  };
  const displayTime = dragging ? toTime(targetXRef.current) : ((duration || 0) * (playheadPercent / 100));
  const handleBlockDown = (ev: React.PointerEvent, kind: "clip" | "zoom" | "avatar", id: string, mode: "move" | "resize-l" | "resize-r") => {
    ev.stopPropagation();
    setSelected({ type: kind, id: kind === "zoom" ? id : undefined });
    const el = railRef.current;
    if (!el) return;
    (el as HTMLDivElement).setPointerCapture(ev.pointerId);
    const target = (kind === "clip" ? clipBlocks : kind === "zoom" ? zoomBlocks : avatarBlocks) || [];
    const b = target.find((x) => x.id === id);
    if (!b) return;
    editingRef.current = { type: kind, id, mode, startX: ev.clientX, origStart: b.start, origEnd: b.end };
    const move = (e: PointerEvent) => {
      if (!editingRef.current) return;
      const rect = el.getBoundingClientRect();
      const dx = Math.max(0, Math.min(e.clientX - rect.left, rect.width)) - Math.max(0, Math.min(editingRef.current.startX - rect.left, rect.width));
      const dt = (dx / rect.width) * (duration || 0);
      let ns = editingRef.current.origStart;
      let ne = editingRef.current.origEnd;
      if (editingRef.current.mode === "move") {
        ns = Math.max(0, Math.min((duration || 0) - (ne - ns), ns + dt));
        ne = Math.max(ns + 0.2, Math.min(duration || 0, ne + dt));
      } else if (editingRef.current.mode === "resize-l") {
        ns = Math.max(0, Math.min(ne - 0.2, ns + dt));
      } else {
        ne = Math.max(ns + 0.2, Math.min(duration || 0, ne + dt));
      }
      const applySnap = (t: number) => {
        const m = minorStepPx || 10;
        const px = toX(t);
        const nearest = Math.round(px / m) * m;
        if (Math.abs(nearest - px) <= 4) {
          return toTime(nearest);
        }
        return t;
      };
      ns = applySnap(ns);
      ne = applySnap(ne);
      const next = target.map((x) => (x.id === id ? { ...x, start: ns, end: ne } : x));
      if (editingRef.current.type === "clip" && onClipChange) onClipChange(next);
      if (editingRef.current.type === "zoom" && onZoomChange) onZoomChange(next);
      if (editingRef.current.type === "avatar" && onAvatarChange) onAvatarChange(next);
    };
    const up = () => {
      (el as HTMLDivElement).releasePointerCapture(ev.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      editingRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const renderBlocks = (kind: "clip" | "zoom" | "avatar") => {
    const items = kind === "clip" ? clipBlocks : kind === "zoom" ? zoomBlocks : avatarBlocks;
    const color =
      kind === "clip" ? "bg-[#1e40af]" : kind === "zoom" ? "bg-[#db2777]" : "bg-[#0ea5e9]";
    return (items || []).map((b: { id: string; start: number; end: number }) => {
      const left = toX(b.start);
      const width = Math.max(4, toX(b.end) - toX(b.start));
      return (
        <div
          key={b.id}
          className={`absolute ${color} rounded-2xl shadow-sm cursor-grab active:cursor-grabbing border ${selected?.type === kind && (selected.id ? selected.id === b.id : true) ? "border-cyan-400/60" : "border-transparent"}`}
          style={{ left, width, top: kind === "avatar" ? (compact ? 6 : 8) : 8, height: compact ? (kind === "avatar" ? 44 : 60) : (kind === "avatar" ? 56 : 72) }}
          onPointerDown={(e) => handleBlockDown(e, kind, b.id, "move")}
        >
          {(selected?.type === kind && (selected.id ? selected.id === b.id : true)) ? (
            <>
              <div
                className="absolute left-0 top-0 h-full w-2 cursor-ew-resize"
                onPointerDown={(e) => handleBlockDown(e, kind, b.id, "resize-l")}
              />
              <div
                className="absolute right-0 top-0 h-full w-2 cursor-ew-resize"
                onPointerDown={(e) => handleBlockDown(e, kind, b.id, "resize-r")}
              />
            </>
          ) : null}
          <div className="px-4 py-2.5 flex flex-col justify-between h-full text-white">
            <div className="flex items-center space-x-2">
              {kind === "clip" ? <FiScissors size={16} /> : kind === "zoom" ? <FiMaximize2 size={16} /> : <FiUser size={16} />}
              <span className="font-semibold">{kind === "clip" ? "Clip" : kind === "zoom" ? "Zoom" : "Avatar"}</span>
            </div>
            {kind !== "avatar" ? (
              <div className={`flex items-center ${kind === "zoom" ? "space-x-4 text-xs text-white/80" : "space-x-6 text-sm text-white/90"}`}>
                {kind === "clip" ? (
                  <>
                    <div className="flex items-center space-x-1">
                      <FiCamera size={12} />
                      <span>Camera overlay</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <FiMic size={12} />
                      <span>100%</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <FiPlay size={12} />
                      <span>1.00×</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center space-x-1">
                      <FiMaximize2 size={14} />
                      <span>2.00×</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <FiPlay size={14} />
                      <span>0.70×</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <span>Follow cursor</span>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      );
    });
  };
  return (
    <div className={`w-full rounded-2xl border border-white/10 bg-slate-950/60 text-slate-100 ${className ?? ""}`}>
      <div className="relative flex">
        <div className="w-10 bg-slate-900/60 border-r border-white/10 flex flex-col items-center py-3 space-y-4">
          <Popover isOpen={hoverId === "back"} placement="top" showArrow offset={8}>
            <PopoverTrigger>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                color="default"
                className="text-white cursor-pointer"
                onMouseEnter={() => setHoverId("back")}
                onMouseLeave={() => setHoverId(null)}
              >
                <FiChevronLeft size={18} />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="bg-white text-black rounded-md shadow-lg px-2.5 py-1">
              返回
            </PopoverContent>
          </Popover>
          <Popover isOpen={hoverId === "zoom"} placement="top" showArrow offset={8}>
            <PopoverTrigger>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                color="default"
                className="text-white cursor-pointer"
                onMouseEnter={() => setHoverId("zoom")}
                onMouseLeave={() => setHoverId(null)}
              >
                <FiSearch size={18} />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="bg-white text-black rounded-md shadow-lg px-2.5 py-1">
              缩放
            </PopoverContent>
          </Popover>
          <Popover isOpen={hoverId === "link"} placement="top" showArrow offset={8}>
            <PopoverTrigger>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                color="default"
                className="text-white cursor-pointer"
                onMouseEnter={() => setHoverId("link")}
                onMouseLeave={() => setHoverId(null)}
              >
                <FiLink size={18} />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="bg-white text-black rounded-md shadow-lg px-2.5 py-1">
              链接
            </PopoverContent>
          </Popover>
          <Popover isOpen={hoverId === "menu"} placement="top" showArrow offset={8}>
            <PopoverTrigger>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                color="default"
                className="text-white cursor-pointer"
                onMouseEnter={() => setHoverId("menu")}
                onMouseLeave={() => setHoverId(null)}
              >
                <FiMenu size={18} />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="bg-white text-black rounded-md shadow-lg px-2.5 py-1">
              菜单
            </PopoverContent>
          </Popover>
        </div>

        <div
          className="flex-1 relative"
          ref={railRef}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
            setDragging(true);
            if (onScrubStart) onScrubStart();
            onPointer(e.clientX);
          }}
          onPointerMove={(e) => {
            if (dragging) onPointer(e.clientX);
          }}
          onPointerUp={() => {
            setDragging(false);
            snapOnRelease();
            if (onScrubEnd) onScrubEnd(toTime(targetXRef.current));
          }}
          onPointerLeave={() => {
            setDragging(false);
          }}
          onPointerCancel={() => {
            setDragging(false);
            snapOnRelease();
            if (onScrubEnd) onScrubEnd(toTime(targetXRef.current));
          }}
        >
          <div className="h-9 border-b border-white/10 bg-slate-900/60 flex items-end px-4 relative">
            <div className="w-full flex justify-between text-[11px] text-slate-400">
              {labels.map((v) => (
                <span key={v}>{v}s</span>
              ))}
            </div>
            <div
              className="absolute top-0 left-0 w-full h-full"
              style={{
                backgroundImage:
                  `linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px),` +
                  `linear-gradient(to right, rgba(255,255,255,0.12) 1px, transparent 1px)`,
                backgroundSize: `${minorStepPx}px 100%, ${majorStepPx}px 100%`,
              }}
            />
          </div>

          <div className="p-4 space-y-4">
            <Card className="bg-transparent border-none rounded-xl overflow-visible relative" style={{ height: compact ? "60px" : "68px" }}>
              {renderBlocks("clip")}
            </Card>

            <Card className="bg-transparent border-none rounded-xl overflow-visible relative" style={{ height: compact ? "60px" : "68px" }}>
              {renderBlocks("zoom")}
            </Card>

            <Card className="bg-transparent border-none rounded-xl overflow-visible relative" style={{ height: compact ? "52px" : "64px" }}>
              {renderBlocks("avatar")}
            </Card>
          </div>

          <div className="absolute top-0 bottom-0 w-[2px] bg-cyan-400 shadow-[0_0_10px_#06b6d4] z-10 will-change-transform" style={{ transform: `translateX(${playheadX}px)` }} />
          {dragging ? (
            <div
              className="absolute z-20"
              style={{ transform: `translateX(${playheadX}px) translateX(-50%)`, top: 24 }}
            >
              <div className="relative pointer-events-none rounded-md bg-cyan-400 px-2.5 py-1 text-[12px] font-semibold text-slate-900 shadow-[0_6px_20px_rgba(6,182,212,0.35)]">
                {formatPrecise(displayTime)}
                <div
                  className="absolute left-1/2 -translate-x-1/2 -bottom-1 h-0 w-0 border-t-8 border-t-cyan-400 border-x-8 border-x-transparent"
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

    </div>
  );
};

export default TimelineUI;
