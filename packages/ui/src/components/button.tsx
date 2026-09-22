import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../lib/cn";
import { Spinner } from "./spinner";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md font-sans font-medium leading-none tracking-normal outline-none transition-[background,color,border-color,filter,opacity] duration-[var(--duration-fast)] ease-[var(--ease-standard)] active:translate-y-[0.5px] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0 [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground border border-transparent hover:brightness-[1.08]",
        secondary:
          "bg-secondary text-secondary-foreground border border-border hover:bg-selected",
        outline:
          "bg-transparent text-foreground border border-border hover:bg-hover hover:border-warm-700",
        ghost:
          "bg-transparent text-meta border border-transparent hover:bg-hover hover:text-foreground",
        destructive:
          "bg-destructive text-destructive-foreground border border-transparent hover:brightness-[1.08]",
        link: "bg-transparent text-link border border-transparent hover:underline underline-offset-2",
      },
      size: {
        xs: "h-control-xs px-1.5 text-xs gap-1",
        sm: "h-control-sm px-2 text-sm gap-[5px]",
        md: "h-control-md px-3 text-base gap-1.5",
        lg: "h-control-lg px-4 text-md gap-2",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export type ButtonProps = Omit<ComponentProps<"button">, "children"> &
  VariantProps<typeof buttonVariants> & {
    children?: ReactNode;
    icon?: ReactNode;
    iconRight?: ReactNode;
    iconOnly?: boolean;
    loading?: boolean;
    fullWidth?: boolean;
    asChild?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  children,
  icon,
  iconRight,
  iconOnly = false,
  loading = false,
  fullWidth = false,
  asChild = false,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  const classNames = cn(
    buttonVariants({ variant, size }),
    fullWidth && "flex w-full",
    iconOnly && "aspect-square px-0",
    variant === "link" && "h-auto px-0",
    className,
  );

  if (asChild) {
    return (
      <Slot className={classNames} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <button className={classNames} disabled={disabled || loading} type={type} {...props}>
      {loading ? <Spinner /> : icon}
      {iconOnly ? null : children}
      {iconRight}
    </button>
  );
}
