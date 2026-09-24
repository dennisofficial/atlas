"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { CSSProperties, ReactElement, ReactNode } from "react";

import { cn } from "../lib/cn";

export interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  kbd?: string;
  delay?: number;
  style?: CSSProperties;
  className?: string;
}

export function Tooltip({
  children,
  content,
  side = "top",
  kbd,
  delay = 250,
  style,
  className,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delay={delay}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger render={children as ReactElement} />
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Positioner side={side} sideOffset={6}>
            <TooltipPrimitive.Popup
              style={style}
              className={cn(
                "pointer-events-none z-[60] flex animate-[atlas-fade-up_var(--duration-fast)_var(--ease-out)_both] items-center gap-[6px] rounded-sm border border-border bg-popover px-[7px] py-1 text-xs leading-[1.35] whitespace-nowrap text-popover-foreground shadow-menu select-none",
                className,
              )}
            >
              {content}
              {kbd ? <span className="font-mono text-hint">{kbd}</span> : null}
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
