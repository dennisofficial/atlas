import { Root } from "@radix-ui/react-separator";
import type { ComponentProps } from "react";

import { cn } from "../lib/cn";

export type SeparatorProps = Omit<
  ComponentProps<typeof Root>,
  "orientation" | "decorative" | "children"
> & {
  orientation?: "horizontal" | "vertical";
  label?: string;
  inset?: number;
};

export function Separator({
  orientation = "horizontal",
  label,
  inset = 0,
  className,
  style,
  ...props
}: SeparatorProps) {
  if (orientation === "vertical") {
    return (
      <Root
        orientation="vertical"
        decorative={false}
        className={cn("w-px shrink-0 self-stretch bg-rule", className)}
        style={{ margin: `0 ${inset}px`, ...style }}
        {...props}
      />
    );
  }

  if (label) {
    return (
      <Root
        orientation="horizontal"
        decorative={false}
        className={cn("flex items-center gap-4", className)}
        style={{ margin: `${inset}px 0`, ...style }}
        {...props}
      >
        <span className="whitespace-nowrap text-2xs font-medium uppercase tracking-caps text-meta">
          {label}
        </span>
        <span className="h-px flex-1 bg-rule" />
      </Root>
    );
  }

  return (
    <Root
      orientation="horizontal"
      decorative={false}
      className={cn("h-px bg-rule", className)}
      style={{ margin: `${inset}px 0`, ...style }}
      {...props}
    />
  );
}
