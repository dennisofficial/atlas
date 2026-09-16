import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "../lib/cn";

export type ScrollAreaProps = {
  children?: ReactNode;
  height?: number | string;
  maxHeight?: number | string;
  horizontal?: boolean;
  fade?: boolean;
  style?: CSSProperties;
  className?: string;
};

const fadeClass =
  "pointer-events-none absolute inset-x-0 z-10 h-[14px] from-background";

export function ScrollArea({
  children,
  height,
  maxHeight,
  horizontal = false,
  fade = false,
  style,
  className,
}: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root
      type="always"
      className={cn("relative min-h-0 min-w-0 overflow-hidden", className)}
      style={{ height, maxHeight, ...style }}
    >
      <ScrollAreaPrimitive.Viewport className="h-full w-full min-w-0 rounded-[inherit]">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation={horizontal ? "horizontal" : "vertical"}
        className={cn(
          "flex touch-none select-none bg-transparent p-px",
          horizontal ? "h-5 flex-col" : "w-5",
        )}
      >
        <ScrollAreaPrimitive.Thumb
          className={cn(
            "relative flex-1 rounded-full bg-scrollbar-thumb hover:bg-scrollbar-thumb-hover",
            horizontal ? "min-w-[36px]" : "min-h-[36px]",
          )}
        />
      </ScrollAreaPrimitive.Scrollbar>
      {fade ? (
        <>
          <span
            aria-hidden
            className={cn(fadeClass, "top-0 bg-gradient-to-b to-transparent")}
          />
          <span
            aria-hidden
            className={cn(
              fadeClass,
              "bottom-0 bg-gradient-to-t to-transparent",
            )}
          />
        </>
      ) : null}
    </ScrollAreaPrimitive.Root>
  );
}
