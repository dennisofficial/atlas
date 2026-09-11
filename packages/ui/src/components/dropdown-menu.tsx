import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "../lib/cn";

export interface DropdownMenuItem {
  id?: string;
  kind?: "item" | "label" | "separator";
  label?: string;
  icon?: ReactNode;
  kbd?: string;
  checked?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  onSelect?: () => void;
}

export interface DropdownMenuProps {
  trigger: ReactNode;
  items: DropdownMenuItem[];
  align?: "start" | "end";
  width?: number;
  onSelect?: (item: DropdownMenuItem) => void;
  style?: CSSProperties;
  className?: string;
}

export function DropdownMenu({
  trigger,
  items,
  align = "start",
  width = 220,
  onSelect,
  style,
  className,
}: DropdownMenuProps) {
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        {trigger}
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align={align}
          sideOffset={5}
          style={{ width, ...style }}
          className={cn(
            "z-50 animate-[atlas-fade-up_var(--duration-fast)_var(--ease-out)_both] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-menu",
            className,
          )}
        >
          {items.map((item, i) => {
            if (item.kind === "separator") {
              return (
                <DropdownMenuPrimitive.Separator
                  key={item.id ?? `separator-${i}`}
                  className="my-1 h-px bg-rule"
                />
              );
            }
            if (item.kind === "label") {
              return (
                <DropdownMenuPrimitive.Label
                  key={item.id ?? `label-${i}`}
                  className="px-[7px] pt-[5px] pb-[3px] text-2xs font-medium tracking-caps text-meta uppercase"
                >
                  {item.label}
                </DropdownMenuPrimitive.Label>
              );
            }
            return (
              <DropdownMenuPrimitive.Item
                key={item.id ?? `item-${i}`}
                disabled={item.disabled ?? false}
                onSelect={() => {
                  onSelect?.(item);
                  item.onSelect?.();
                }}
                className={cn(
                  "group flex h-row-default w-full items-center gap-[7px] rounded-sm px-[7px] text-base outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-hover",
                  item.destructive
                    ? "text-destructive data-[highlighted]:text-destructive"
                    : "text-secondary-foreground data-[highlighted]:text-foreground",
                )}
              >
                {item.icon ? (
                  <span className="flex text-hint group-data-[highlighted]:text-inherit">
                    {item.icon}
                  </span>
                ) : null}
                <span className="flex-1 truncate">{item.label}</span>
                {item.kbd ? (
                  <span className="font-mono text-2xs text-hint">
                    {item.kbd}
                  </span>
                ) : null}
                {item.checked ? (
                  <span className="font-mono text-primary">✓</span>
                ) : null}
              </DropdownMenuPrimitive.Item>
            );
          })}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
