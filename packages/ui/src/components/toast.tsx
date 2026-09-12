import { cva, type VariantProps } from "class-variance-authority";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "../lib/cn";

const toastVariants = cva(
  "flex w-[340px] animate-[atlas-fade-up_var(--duration-normal)_var(--ease-out)_both] items-start gap-[9px] rounded-md border border-l-2 border-border bg-popover px-[11px] py-[9px] shadow-menu",
  {
    variants: {
      tone: {
        neutral: "border-l-border",
        success: "border-l-success",
        warning: "border-l-warning",
        destructive: "border-l-destructive",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

const glyphVariants = cva("shrink-0 font-mono text-sm", {
  variants: {
    tone: {
      neutral: "text-meta",
      success: "text-success",
      warning: "text-warning",
      destructive: "text-destructive",
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
});

export type ToastTone = "neutral" | "success" | "warning" | "destructive";

const glyphs: Record<ToastTone, string> = {
  neutral: "·",
  success: "✓",
  warning: "⚠",
  destructive: "✗",
};

export interface ToastProps extends VariantProps<typeof toastVariants> {
  title?: string;
  body?: string;
  action?: ReactNode;
  onDismiss?: () => void;
  style?: CSSProperties;
  className?: string;
}

export function Toast({
  tone = "neutral",
  title,
  body,
  action,
  onDismiss,
  style,
  className,
}: ToastProps) {
  return (
    <div
      role="status"
      style={style}
      className={cn(toastVariants({ tone }), className)}
    >
      <span className={glyphVariants({ tone })}>
        {glyphs[tone ?? "neutral"]}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        {title ? (
          <span className="text-base leading-[18px] text-foreground">
            {title}
          </span>
        ) : null}
        {body ? (
          <span className="text-xs text-pretty text-hint">{body}</span>
        ) : null}
        {action ? <span className="mt-1">{action}</span> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="p-0 font-mono text-xs leading-[18px] text-hint transition-colors duration-[var(--duration-fast)] hover:text-foreground"
        >
          ✗
        </button>
      ) : null}
    </div>
  );
}

export interface ToastStackProps {
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
}

export function ToastStack({ children, style, className }: ToastStackProps) {
  return (
    <div
      style={style}
      className={cn(
        "fixed right-3 bottom-3 z-[80] flex flex-col items-end gap-2",
        className,
      )}
    >
      {children}
    </div>
  );
}
