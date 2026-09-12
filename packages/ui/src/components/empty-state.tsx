import type { ComponentProps, ReactNode } from "react";

import { cn } from "../lib/cn";

export type EmptyStateProps = Omit<ComponentProps<"div">, "children"> & {
  glyph?: ReactNode;
  title?: string;
  body?: string;
  action?: ReactNode;
  hints?: ReactNode[];
  compact?: boolean;
};

export function EmptyState({
  glyph = "⬚",
  title,
  body,
  action,
  hints,
  compact = false,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col items-center justify-center text-center",
        compact ? "gap-3 px-8 py-10" : "gap-5 px-12 py-24",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "font-mono leading-none text-rule",
          compact ? "text-xl" : "text-3xl",
        )}
      >
        {glyph}
      </span>
      {title ? (
        <span
          className={cn(
            "font-medium text-foreground",
            compact ? "text-base" : "text-lg",
          )}
        >
          {title}
        </span>
      ) : null}
      {body ? (
        <span className="max-w-[380px] text-pretty text-base text-meta">
          {body}
        </span>
      ) : null}
      {action ? <span className="mt-1">{action}</span> : null}
      {hints && hints.length > 0 ? (
        <span className="mt-2 flex flex-wrap justify-center gap-6">
          {hints}
        </span>
      ) : null}
    </div>
  );
}
