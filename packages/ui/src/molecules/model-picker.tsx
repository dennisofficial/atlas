"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { cn } from "../lib/cn";

export interface PickableModel {
  id: string;
  label: string;
  provider?: string;
  context?: string;
  effort?: string;
  rate?: string;
  unavailable?: boolean;
}

export interface ModelPickerProps {
  models: PickableModel[];
  value?: string;
  onChange?: (model: PickableModel) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showSpend?: boolean;
  style?: CSSProperties;
}

export function ModelPicker({
  models,
  value,
  onChange,
  open,
  onOpenChange,
  showSpend = true,
  style,
}: ModelPickerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = open === undefined ? uncontrolledOpen : open;
  const ref = useRef<HTMLSpanElement>(null);
  const current = models.find((model) => model.id === value) ?? models[0];

  const handleOpenChange = (next: boolean) => {
    if (open === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (ref.current && !ref.current.contains(event.target)) {
        if (open === undefined) setUncontrolledOpen(false);
        onOpenChange?.(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen, open, onOpenChange]);

  return (
    <span ref={ref} className="relative inline-flex" style={style}>
      <button
        type="button"
        onClick={() => handleOpenChange(!isOpen)}
        className={cn(
          "inline-flex h-control-sm shrink-0 items-center gap-3 rounded-sm border px-[7px] font-mono text-xs whitespace-nowrap text-foreground transition-colors duration-[var(--duration-fast)]",
          isOpen
            ? "border-border bg-selected"
            : "border-transparent bg-transparent hover:bg-hover",
        )}
      >
        <span>{current ? current.label : "no model"}</span>
        {current?.effort ? (
          <span className="text-external">{current.effort}</span>
        ) : null}
        <span className="text-rule">▴</span>
      </button>

      {isOpen ? (
        <div
          role="listbox"
          className="absolute bottom-full left-0 z-[55] mb-[5px] w-[330px] animate-[atlas-fade-up_var(--duration-fast)_var(--ease-out)_both] rounded-md border border-border bg-popover p-2 shadow-menu"
        >
          {models.map((model) => {
            const on = current !== undefined && model.id === current.id;
            return (
              <button
                key={model.id}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => {
                  handleOpenChange(false);
                  onChange?.(model);
                }}
                className={cn(
                  "flex w-full items-center gap-4 rounded-sm px-[7px] py-[5px] text-left font-mono text-sm hover:bg-hover",
                  on && "bg-hover",
                )}
              >
                <span className="w-[10px] shrink-0 text-primary">
                  {on ? "❯" : ""}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span
                    className={cn(
                      "truncate",
                      on ? "text-foreground" : "text-secondary-foreground",
                    )}
                  >
                    {model.label}
                  </span>
                  {model.provider || model.context ? (
                    <span className="text-xs text-hint">
                      {model.provider}
                      {model.provider && model.context ? " · " : ""}
                      {model.context}
                    </span>
                  ) : null}
                </span>
                {model.effort ? (
                  <span className="shrink-0 text-xs text-external">
                    {model.effort}
                  </span>
                ) : null}
                {showSpend && model.rate ? (
                  <span className="shrink-0 text-xs text-meta">
                    {model.rate}
                  </span>
                ) : null}
                {model.unavailable ? (
                  <span className="shrink-0 text-xs text-warning">⚠</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}
