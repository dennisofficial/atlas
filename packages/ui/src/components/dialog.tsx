import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "../lib/cn";

export interface DialogProps {
  open?: boolean;
  title?: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  hints?: ReactNode;
  onClose?: () => void;
  width?: number;
  style?: CSSProperties;
  className?: string;
}

export function Dialog({
  open = false,
  title,
  description,
  children,
  footer,
  hints,
  onClose,
  width = 460,
  style,
  className,
}: DialogProps) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose?.();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-scrim" />
        <DialogPrimitive.Content
          style={{ width, ...style }}
          className={cn(
            "fixed top-1/2 left-1/2 z-[100] flex max-h-[calc(100%-48px)] w-full max-w-[calc(100%-48px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-palette outline-none",
            className,
          )}
        >
          <div className="flex min-h-0 flex-1 animate-[atlas-pop_var(--duration-normal)_var(--ease-out)_both] flex-col">
            <header className="flex items-start gap-[10px] px-4 pt-[14px]">
              <div className="min-w-0 flex-1">
                {title ? (
                  <DialogPrimitive.Title className="text-lg font-semibold tracking-tight text-foreground">
                    {title}
                  </DialogPrimitive.Title>
                ) : null}
                {description ? (
                  <DialogPrimitive.Description className="mt-[5px] text-base text-pretty text-meta">
                    {description}
                  </DialogPrimitive.Description>
                ) : null}
              </div>
              {onClose ? (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="p-[2px] font-mono text-[14px] leading-none text-hint transition-colors duration-[var(--duration-fast)] hover:text-foreground"
                >
                  ✗
                </button>
              ) : null}
            </header>
            {children ? (
              <div className="min-h-0 overflow-auto px-4 py-[14px] text-base">
                {children}
              </div>
            ) : (
              <div className="h-[14px]" />
            )}
            {footer || hints ? (
              <footer className="flex items-center gap-2 border-t border-border bg-muted px-4 py-[10px]">
                <div className="flex flex-1 gap-[10px]">{hints}</div>
                <div className="flex gap-[6px]">{footer}</div>
              </footer>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
