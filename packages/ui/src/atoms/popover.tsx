"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "../lib/cn";

export interface PopoverProps {
  trigger: ReactNode;
  children?: ReactNode;
  title?: string;
  footer?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "end";
  width?: number;
  style?: CSSProperties;
  className?: string;
}

export function Popover({
  trigger,
  children,
  title,
  footer,
  open,
  onOpenChange,
  align = "start",
  width = 280,
  style,
  className,
}: PopoverProps) {
  return (
    <PopoverPrimitive.Root
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          sideOffset={5}
          style={{ width, ...style }}
          className={cn(
            "z-50 animate-[atlas-fade-up_var(--duration-fast)_var(--ease-out)_both] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-menu",
            className,
          )}
        >
          {title ? (
            <div className="border-b border-border px-[10px] py-[7px] text-2xs font-medium tracking-caps text-meta uppercase">
              {title}
            </div>
          ) : null}
          <div className="p-[10px] text-base">{children}</div>
          {footer ? (
            <div className="flex justify-end gap-[6px] border-t border-border bg-muted px-[10px] py-[7px]">
              {footer}
            </div>
          ) : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
