import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../lib/cn";

const kbdCapVariants = cva(
  "inline-flex items-center justify-center rounded-sm border border-border border-b-2 bg-muted px-2 font-mono leading-none text-meta",
  {
    variants: {
      size: {
        sm: "h-[15px] min-w-[15px] text-2xs",
        md: "h-[18px] min-w-[18px] text-sm",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

export type KbdProps = Omit<ComponentProps<"span">, "children"> &
  VariantProps<typeof kbdCapVariants> & {
    children?: ReactNode;
    keys?: string[];
    label?: string;
  };

export function Kbd({
  children,
  keys,
  label,
  size,
  className,
  ...props
}: KbdProps) {
  const parts = keys ?? (typeof children === "string" ? [children] : undefined);
  return (
    <span
      className={cn("inline-flex items-center gap-[3px]", className)}
      {...props}
    >
      {parts
        ? parts.map((part, i) => (
            <kbd key={i} className={kbdCapVariants({ size })}>
              {part}
            </kbd>
          ))
        : children}
      {label ? (
        <span className="ml-[3px] text-xs text-hint">{label}</span>
      ) : null}
    </span>
  );
}
