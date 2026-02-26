import { Button, Card, CardBody, Popover, PopoverTrigger, PopoverContent } from "@heroui/react";
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
}: TimelineUIProps) => {
  const labelStep = duration <= 12 ? 0.5 : 1;
  const labels = Array.from({ length: Math.floor(duration / labelStep) + 1 }, (_, i) => +(i * labelStep).toFixed(labelStep < 1 ? 1 : 0));
  const [hoverId, setHoverId] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const targetXRef = useRef(0);
  const [playheadX, setPlayheadX] = useState(0);
  const playheadXRef = useRef(0);
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
  return (
    <div className={`w-full rounded-2xl border border-white/10 bg-slate-950/60 text-slate-100 overflow-hidden ${className ?? ""}`}>
      <div className="relative flex">
        <div className="w-10 bg-slate-900/60 border-r border-white/10 flex flex-col items-center py-3 space-y-3">
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

          <div className="p-3 space-y-3">
            <Card className="bg-[#1e40af] border-none rounded-xl overflow-hidden relative" style={{ height: compact ? "56px" : "64px" }}>
              <CardBody className="px-3 py-2 flex flex-col justify-between">
                <div className="flex items-center space-x-2">
                  <FiScissors size={16} className="text-white" />
                  <span className="font-semibold text-white">Clip</span>
                </div>
                <div className="flex items-center space-x-6 text-sm text-white/90">
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
                </div>
              </CardBody>
              <div className="absolute top-2 left-[20%] w-12 h-4 bg-yellow-400 rounded-md"></div>
              <div className="absolute top-2 left-[40%] w-12 h-4 bg-yellow-400 rounded-md"></div>
              <div className="absolute top-2 left-[65%] w-12 h-4 bg-yellow-400 rounded-md"></div>
              <div className="absolute top-2 left-[82%] w-12 h-4 bg-yellow-400 rounded-md"></div>
            </Card>

            <Card className="bg-[#db2777] border-none rounded-xl overflow-hidden relative" style={{ height: compact ? "56px" : "64px" }}>
              <CardBody className="px-3 py-2 flex flex-col justify-between">
                <div className="flex items-center space-x-2">
                  <FiMaximize2 size={16} className="text-white" />
                  <span className="font-semibold text-white">Zoom</span>
                </div>
                <div className="flex items-center space-x-4 text-xs text-white/80">
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
                </div>
              </CardBody>
            </Card>

            <Card className="bg-[#0ea5e9] border-none rounded-xl overflow-hidden relative" style={{ height: compact ? "48px" : "60px" }}>
              <CardBody className="px-3 py-2 flex flex-col justify-between">
                <div className="flex items-center space-x-2">
                  <FiUser size={16} className="text-white" />
                  <span className="font-semibold text-white">Avatar</span>
                </div>
                <div className="flex items-center space-x-4 text-xs text-white/80">
                  <div className="flex items-center space-x-1">
                    <FiCamera size={14} />
                    <span>On</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <FiPlay size={14} />
                    <span>Synced</span>
                  </div>
                </div>
              </CardBody>
              <div className="absolute bottom-2 left-[30%] w-24 h-3 bg-white/70 rounded-md"></div>
              <div className="absolute bottom-2 left-[62%] w-16 h-3 bg-white/70 rounded-md"></div>
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
