"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { CSSProperties, ReactNode } from "react";

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
    <TooltipPrimitive.Provider delayDuration={delay}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            style={style}
            className={cn(
              "pointer-events-none z-[60] flex animate-[atlas-fade-up_var(--duration-fast)_var(--ease-out)_both] items-center gap-[6px] rounded-sm border border-border bg-popover px-[7px] py-1 text-xs leading-[1.35] whitespace-nowrap text-popover-foreground shadow-menu select-none",
              className,
            )}
          >
            {content}
            {kbd ? <span className="font-mono text-hint">{kbd}</span> : null}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
