import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../lib/cn";

const cardVariants = cva(
  "flex min-w-0 flex-col overflow-hidden rounded-md border border-border",
  {
    variants: {
      surface: {
        card: "bg-card",
        panel: "bg-surface-panel",
        overlay: "bg-surface-overlay",
      },
      elevated: {
        true: "shadow-card",
      },
      rail: {
        true: "border-l-2 border-l-primary",
      },
    },
    defaultVariants: {
      surface: "card",
    },
  },
);

export type CardProps = Omit<ComponentProps<"section">, "children"> &
  VariantProps<typeof cardVariants> & {
    children?: ReactNode;
    title?: string;
    subtitle?: string;
    badge?: ReactNode;
    actions?: ReactNode;
    footer?: ReactNode;
    padded?: boolean;
  };

export function Card({
  children,
  title,
  subtitle,
  badge,
  actions,
  footer,
  surface,
  elevated,
  rail,
  padded = true,
  className,
  ...props
}: CardProps) {
  return (
    <section
      className={cn(cardVariants({ surface, elevated, rail }), className)}
      {...props}
    >
      {title || badge || actions ? (
        <header className="flex min-h-row-default items-center gap-4 border-b border-border bg-muted px-6 py-4">
          <div className="flex min-w-0 flex-1 flex-col gap-px">
            {title ? (
              <span className="truncate text-base font-medium text-foreground">
                {title}
              </span>
            ) : null}
            {subtitle ? (
              <span className="text-xs text-hint">{subtitle}</span>
            ) : null}
          </div>
          {badge}
          {actions ? (
            <div className="flex items-center gap-2">{actions}</div>
          ) : null}
        </header>
      ) : null}
      <div className={cn("min-w-0 flex-1", padded && "p-6")}>{children}</div>
      {footer ? (
        <footer className="flex items-center gap-4 border-t border-border bg-muted px-6 py-[7px] text-xs text-hint">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}
