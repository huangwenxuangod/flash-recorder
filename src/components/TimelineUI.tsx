import { Button, Card, CardBody, Tooltip } from "@heroui/react";
import { FiChevronLeft, FiSearch, FiLink, FiMenu, FiScissors, FiCamera, FiMic, FiPlay, FiMaximize2, FiUser } from "react-icons/fi";

type TimelineUIProps = { duration?: number; playheadPercent?: number; compact?: boolean; className?: string; };

const TimelineUI = ({ duration = 6, playheadPercent = 60, compact = true, className }: TimelineUIProps) => {
  const ticks = Array.from({ length: Math.max(1, Math.floor(duration)) + 1 }, (_, i) => i);
  return (
    <div className={`w-full rounded-2xl border border-white/10 bg-slate-950/60 text-slate-100 overflow-hidden ${className ?? ""}`}>
      <div className="relative flex">
        <div className="w-10 bg-slate-900/60 border-r border-white/10 flex flex-col items-center py-3 space-y-3">
          <Tooltip content="返回">
            <Button isIconOnly size="sm" variant="light" color="default">
              <FiChevronLeft size={18} />
            </Button>
          </Tooltip>
          <Tooltip content="缩放">
            <Button isIconOnly size="sm" variant="light" color="default">
              <FiSearch size={18} />
            </Button>
          </Tooltip>
          <Tooltip content="链接">
            <Button isIconOnly size="sm" variant="light" color="default">
              <FiLink size={18} />
            </Button>
          </Tooltip>
          <Tooltip content="菜单">
            <Button isIconOnly size="sm" variant="light" color="default">
              <FiMenu size={18} />
            </Button>
          </Tooltip>
        </div>

        <div className="flex-1 relative">
          <div className="h-9 border-b border-white/10 bg-slate-900/60 flex items-end px-4 relative">
            <div className="w-full flex justify-between text-[11px] text-slate-400">
              {ticks.map((second) => (
                <span key={second}>{second}s</span>
              ))}
            </div>
            <div
              className="absolute top-0 left-0 w-full h-full"
              style={{
                backgroundImage: "linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px)",
                backgroundSize: "20px 100%",
              }}
            />
          </div>

          <div className="p-3 space-y-3">
            <Card className="bg-[#1e40af] border-none rounded-xl overflow-hidden relative" style={{ height: compact ? "56px" : "80px" }}>
              <CardBody className="px-3 py-2 flex flex-col justify-between">
                <div className="flex items-center space-x-2">
                  <FiScissors size={16} className="text-white" />
                  <span className="font-semibold text-white">Clip</span>
                </div>
                <div className="flex items-center space-x-4 text-xs text-white/80">
                  <div className="flex items-center space-x-1">
                    <FiCamera size={14} />
                    <span>Camera overlay</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <FiMic size={14} />
                    <span>100%</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <FiPlay size={14} />
                    <span>1.00×</span>
                  </div>
                </div>
              </CardBody>
              <div className="absolute top-2 left-[20%] w-12 h-4 bg-yellow-400 rounded-md"></div>
              <div className="absolute top-2 left-[40%] w-12 h-4 bg-yellow-400 rounded-md"></div>
              <div className="absolute top-2 left-[65%] w-12 h-4 bg-yellow-400 rounded-md"></div>
              <div className="absolute top-2 left-[82%] w-12 h-4 bg-yellow-400 rounded-md"></div>
            </Card>

            <Card className="bg-[#db2777] border-none rounded-xl overflow-hidden relative" style={{ height: compact ? "48px" : "60px" }}>
              <CardBody className="p-3 flex flex-col justify-between">
                <div className="flex items-center space-x-2">
                  <FiMaximize2 size={16} className="text-white" />
                  <span className="font-bold text-white">Zoom</span>
                </div>
                <div className="flex items-center space-x-4 text-sm text-white/80">
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

          <div className="absolute top-0 bottom-0 w-[2px] bg-cyan-400 shadow-[0_0_10px_#06b6d4] z-10" style={{ left: `${playheadPercent}%` }} />
        </div>
      </div>

    </div>
  );
};

export default TimelineUI;
