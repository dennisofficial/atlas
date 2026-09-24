import type { ComponentProps } from "react";

import { cn } from "../lib/cn";

const MONO_WIDTHS = ["94%", "78%", "88%"] as const;

export type SkeletonProps = ComponentProps<"span"> & {
  width?: number | string;
  height?: number;
  radius?: string;
  lines?: number;
  mono?: boolean;
};

function SkeletonBar({
  width,
  height,
  radius,
}: {
  width: number | string;
  height: number;
  radius: string;
}) {
  return (
    <span
      className="relative block overflow-hidden bg-muted"
      style={{ width, height, borderRadius: radius }}
    >
      <span className="absolute inset-0 animate-[atlas-sweep_1.3s_var(--ease-standard)_infinite] bg-gradient-to-r from-transparent via-selected to-transparent" />
    </span>
  );
}

export function Skeleton({
  width = "100%",
  height = 12,
  radius = "var(--radius-sm)",
  lines,
  mono = false,
  className,
  ...props
}: SkeletonProps) {
  if (lines !== undefined && lines > 1) {
    const widths = Array.from({ length: lines }, (_, i) =>
      i === lines - 1 ? "62%" : mono ? (MONO_WIDTHS[i % 3] ?? "100%") : "100%",
    );
    return (
      <span className={cn("flex w-full flex-col gap-3", className)} {...props}>
        {widths.map((w, i) => (
          <SkeletonBar key={i} width={w} height={height} radius={radius} />
        ))}
      </span>
    );
  }

  return (
    <span className={cn("block w-full", className)} {...props}>
      <SkeletonBar width={width} height={height} radius={radius} />
    </span>
  );
}
