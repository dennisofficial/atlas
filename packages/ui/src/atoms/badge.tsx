import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../lib/cn";

const badgeVariants = cva(
  "inline-flex h-[18px] items-center gap-2 whitespace-nowrap rounded-sm border border-transparent px-3 font-sans text-xs font-medium leading-none [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "text-meta",
        primary: "text-primary",
        success: "text-success",
        warning: "text-warning",
        destructive: "text-destructive",
        code: "text-code",
        external: "text-external",
      },
      variant: {
        soft: "",
        solid: "text-primary-foreground",
        bare: "bg-transparent px-0",
      },
    },
    compoundVariants: [
      { variant: "soft", tone: "neutral", class: "border-border bg-muted" },
      {
        variant: "soft",
        tone: "primary",
        class:
          "border-[color-mix(in_oklab,var(--primary)_34%,transparent)] bg-[color-mix(in_oklab,var(--primary)_14%,transparent)]",
      },
      {
        variant: "soft",
        tone: "success",
        class:
          "border-[color-mix(in_oklab,var(--success)_32%,transparent)] bg-[color-mix(in_oklab,var(--success)_14%,transparent)]",
      },
      {
        variant: "soft",
        tone: "warning",
        class:
          "border-[color-mix(in_oklab,var(--warning)_32%,transparent)] bg-[color-mix(in_oklab,var(--warning)_14%,transparent)]",
      },
      {
        variant: "soft",
        tone: "destructive",
        class:
          "border-[color-mix(in_oklab,var(--destructive)_32%,transparent)] bg-[color-mix(in_oklab,var(--destructive)_14%,transparent)]",
      },
      {
        variant: "soft",
        tone: "code",
        class:
          "border-[color-mix(in_oklab,var(--code)_30%,transparent)] bg-[color-mix(in_oklab,var(--code)_13%,transparent)]",
      },
      {
        variant: "soft",
        tone: "external",
        class:
          "border-[color-mix(in_oklab,var(--external)_32%,transparent)] bg-[color-mix(in_oklab,var(--external)_14%,transparent)]",
      },
      { variant: "solid", tone: "neutral", class: "bg-meta" },
      { variant: "solid", tone: "primary", class: "bg-primary" },
      { variant: "solid", tone: "success", class: "bg-success" },
      { variant: "solid", tone: "warning", class: "bg-warning" },
      { variant: "solid", tone: "destructive", class: "bg-destructive" },
      { variant: "solid", tone: "code", class: "bg-code" },
      { variant: "solid", tone: "external", class: "bg-external" },
    ],
    defaultVariants: {
      tone: "neutral",
      variant: "soft",
    },
  },
);

export type BadgeProps = Omit<ComponentProps<"span">, "children"> &
  VariantProps<typeof badgeVariants> & {
    children?: ReactNode;
    mono?: boolean;
    dot?: boolean;
    icon?: ReactNode;
  };

export function Badge({
  children,
  tone,
  variant,
  mono = false,
  dot = false,
  icon,
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        badgeVariants({ tone, variant }),
        mono && "font-mono",
        className,
      )}
      {...props}
    >
      {dot ? (
        <span className="size-[5px] shrink-0 rounded-full bg-current" />
      ) : null}
      {icon}
      {children}
    </span>
  );
}
