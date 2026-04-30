"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";

export type View = "dashboard" | "grid";

interface Props {
  current: View;
  onChange: (v: View) => void;
  openCellsCount: number;
}

export function Sidebar({ current, onChange, openCellsCount }: Props) {
  const [open, setOpen] = useState(false);

  // Close drawer on Escape and lock body scroll while open (mobile only)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function handleNav(v: View) {
    onChange(v);
    setOpen(false);
  }

  return (
    <>
      {/* Mobile top bar (visible < md) */}
      <div
        className="md:hidden sticky top-0 z-30 flex items-center justify-between bg-card border-b border-border px-3"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 0.25rem)",
          paddingBottom: "0.25rem",
          minHeight: "calc(3rem + env(safe-area-inset-top))",
        }}
      >
        <button
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 text-slate-200"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
          <span className="font-bold tracking-tight">CR</span>
        </button>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => handleNav("dashboard")}
            className={clsx(
              "px-2 py-1 rounded transition",
              current === "dashboard" ? "bg-slate-800 text-white" : "text-slate-400"
            )}
          >
            Chart
          </button>
          <button
            onClick={() => handleNav("grid")}
            className={clsx(
              "relative px-2 py-1 rounded transition",
              current === "grid" ? "bg-slate-800 text-white" : "text-slate-400"
            )}
          >
            Grid
            {openCellsCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-cyan-400 text-black text-[9px] font-bold px-1 rounded-full min-w-[16px] text-center">
                {openCellsCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Backdrop for mobile drawer */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar — drawer on mobile, static on md+ */}
      <aside
        className={clsx(
          "bg-card border-r border-border flex flex-col py-4 px-2 gap-1 shrink-0 z-50 transition-transform",
          // Desktop
          "md:static md:translate-x-0 md:w-56 md:min-h-screen",
          // Mobile drawer
          "fixed top-0 left-0 h-[100dvh] w-64",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 1rem)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)",
        }}
      >
        <div className="px-3 py-2 mb-2 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight">CR</h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">
              Crypto Analysis
            </p>
          </div>
          <button
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="md:hidden text-slate-400 hover:text-white text-xl leading-none px-2"
          >
            ✕
          </button>
        </div>

        <NavItem
          label="Dashboard"
          active={current === "dashboard"}
          onClick={() => handleNav("dashboard")}
        />
        <NavItem
          label="Grid Trading"
          active={current === "grid"}
          onClick={() => handleNav("grid")}
          badge={openCellsCount > 0 ? openCellsCount : undefined}
          badgeColor="cyan"
        />

        <div className="mt-auto px-3 pt-4 border-t border-border">
          <form action="/auth/logout" method="post">
            <button
              type="submit"
              className="w-full text-left text-xs text-slate-400 hover:text-white py-2 transition"
            >
              Logout
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}

function NavItem({
  label,
  active,
  onClick,
  badge,
  badgeColor,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  badgeColor?: "yellow" | "cyan";
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex items-center justify-between text-left px-3 py-2 rounded text-sm transition",
        active
          ? "bg-slate-800 text-white border-l-2 border-blue-400"
          : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 border-l-2 border-transparent"
      )}
    >
      <span>{label}</span>
      {badge !== undefined && (
        <span
          className={clsx(
            "text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center",
            badgeColor === "cyan" ? "bg-cyan-400" : "bg-yellow-500"
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
