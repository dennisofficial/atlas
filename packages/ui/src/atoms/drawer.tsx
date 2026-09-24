"use client";

import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "../lib/cn";

export type DrawerSide = "bottom" | "top" | "right";

export interface DrawerProps {
  open?: boolean;
  side?: DrawerSide;
  title?: string;
  badge?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  hints?: ReactNode;
  onClose?: () => void;
  size?: number;
  scrim?: boolean;
  style?: CSSProperties;
  className?: string;
}

const slideIn: Record<DrawerSide, string> = {
  right:
    "animate-[atlas-slide-in-right_var(--duration-slow)_var(--ease-out)_both]",
  bottom:
    "animate-[atlas-slide-in-bottom_var(--duration-slow)_var(--ease-out)_both]",
  top: "animate-[atlas-slide-in-bottom_var(--duration-slow)_var(--ease-out)_both]",
};

const edgeBorder: Record<DrawerSide, string> = {
  right: "border-l",
  bottom: "border-t",
  top: "border-b",
};

export function Drawer({
  open = false,
  side = "bottom",
  title,
  badge,
  children,
  footer,
  hints,
  onClose,
  size = 380,
  scrim = true,
  style,
  className,
}: DrawerProps) {
  useEffect(() => {
    if (!open || !onClose) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const vertical = side !== "right";

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-0 z-[90] flex",
        side === "right"
          ? "justify-end"
          : side === "top"
            ? "items-start"
            : "items-end",
      )}
    >
      {scrim ? (
        <div
          onMouseDown={onClose}
          className="pointer-events-auto absolute inset-0 bg-scrim"
        />
      ) : null}
      <div
        role="dialog"
        style={{
          ...(vertical ? { maxHeight: size } : { width: size }),
          ...style,
        }}
        className={cn(
          "pointer-events-auto relative flex max-h-full flex-col border-border bg-surface-overlay shadow-menu",
          vertical && "w-full",
          edgeBorder[side],
          slideIn[side],
          className,
        )}
      >
        {title ? (
          <header className="flex items-center gap-2 border-b border-border px-[14px] py-[10px]">
            <span className="flex-1 text-base font-medium text-primary">
              {title}
            </span>
            {badge}
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="p-[2px] font-mono text-[13px] leading-none text-hint transition-colors duration-[var(--duration-fast)] hover:text-foreground"
              >
                ✗
              </button>
            ) : null}
          </header>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto p-[14px]">{children}</div>
        {footer || hints ? (
          <footer className="flex items-center gap-[10px] border-t border-border px-[14px] py-[9px]">
            <div className="flex flex-1 flex-wrap gap-3">{hints}</div>
            <div className="flex gap-[6px]">{footer}</div>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
