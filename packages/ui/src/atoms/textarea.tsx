"use client";

import type { ChangeEvent, ComponentProps } from "react";
import { useCallback, useEffect, useId, useRef } from "react";

import { cn } from "../lib/cn";

export type TextareaProps = ComponentProps<"textarea"> & {
  mono?: boolean;
  invalid?: boolean;
  label?: string;
  hint?: string;
  error?: string;
  autoGrow?: boolean;
  maxRows?: number;
};

export function Textarea({
  className,
  rows = 3,
  mono = false,
  invalid = false,
  label,
  hint,
  error,
  maxRows,
  autoGrow = false,
  id,
  onChange,
  ...props
}: TextareaProps) {
  const generatedId = useId();
  const areaId = id ?? generatedId;
  const bad = invalid || Boolean(error);
  const ref = useRef<HTMLTextAreaElement>(null);

  const grow = useCallback(() => {
    const el = ref.current;
    if (!el || !autoGrow) return;
    el.style.height = "auto";
    const cap = maxRows ? maxRows * 20 + 16 : Number.POSITIVE_INFINITY;
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
  }, [autoGrow, maxRows]);

  useEffect(() => {
    grow();
  }, [grow]);

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    grow();
    onChange?.(event);
  }

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      {label ? (
        <label htmlFor={areaId} className="text-xs font-medium text-meta">
          {label}
        </label>
      ) : null}
      <textarea
        ref={ref}
        id={areaId}
        rows={rows}
        aria-invalid={bad || undefined}
        onChange={handleChange}
        className={cn(
          "w-full resize-y rounded-md border bg-card px-4.5 py-3.5 text-base text-foreground caret-caret outline-none transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-standard)] placeholder:text-hint disabled:cursor-not-allowed disabled:opacity-45",
          mono ? "font-mono" : "font-sans",
          bad
            ? "border-destructive"
            : "border-input focus-visible:border-ring focus-visible:shadow-[0_0_0_2px_color-mix(in_oklab,var(--ring)_26%,transparent)]",
          autoGrow && "resize-none",
          className,
        )}
        {...props}
      />
      {error || hint ? (
        <span
          className={cn("text-xs", error ? "text-destructive" : "text-hint")}
        >
          {error ?? hint}
        </span>
      ) : null}
    </div>
  );
}
