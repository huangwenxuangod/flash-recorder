import { ReactNode, useEffect, useRef, useState } from "react";

export type SelectOption = {
  value: string;
  label: string;
};

export type SelectMenuProps = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  icon?: ReactNode;
};

export function SelectMenu({ value, options, onChange, icon }: SelectMenuProps) {
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
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          className={`h-4 w-4 text-slate-500 transition ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
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
                    selected ? "bg-slate-800/80 text-white" : "text-slate-200 hover:bg-slate-800/60"
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
