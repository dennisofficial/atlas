"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { useId } from "react";

import { cn } from "../lib/cn";

const inputWellVariants = cva(
  "flex min-w-0 items-center gap-3 rounded-md border bg-card px-4 transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-standard)] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-45",
  {
    variants: {
      size: {
        sm: "h-control-sm",
        md: "h-control-md",
        lg: "h-control-lg",
      },
      invalid: {
        true: "border-destructive",
        false:
          "border-input focus-within:border-ring focus-within:shadow-[0_0_0_2px_color-mix(in_oklab,var(--ring)_26%,transparent)]",
      },
    },
    defaultVariants: {
      size: "md",
      invalid: false,
    },
  },
);

const sizeFonts = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-md",
} as const;

export type InputProps = Omit<ComponentProps<"input">, "size"> &
  VariantProps<typeof inputWellVariants> & {
    mono?: boolean;
    icon?: ReactNode;
    suffix?: ReactNode;
    label?: string;
    hint?: string;
    error?: string;
  };

export function Input({
  className,
  size,
  mono = false,
  invalid = false,
  icon,
  suffix,
  label,
  hint,
  error,
  id,
  disabled,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const bad = Boolean(invalid) || Boolean(error);

  return (
    <div className={cn("flex min-w-0 flex-col gap-2.5", className)}>
      {label ? (
        <label htmlFor={inputId} className="text-xs font-medium text-meta">
          {label}
        </label>
      ) : null}
      <div className={cn(inputWellVariants({ size, invalid: bad }))}>
        {icon ? <span className="flex text-hint">{icon}</span> : null}
        <input
          id={inputId}
          disabled={disabled}
          aria-invalid={bad || undefined}
          className={cn(
            "min-w-0 flex-1 border-none bg-transparent text-foreground caret-caret outline-none placeholder:text-hint disabled:cursor-not-allowed",
            sizeFonts[size ?? "md"],
            mono ? "font-mono" : "font-sans",
          )}
          {...props}
        />
        {suffix ? (
          <span className="flex text-xs text-hint">{suffix}</span>
        ) : null}
      </div>
      {error || hint ? (
        <span
          className={cn("text-xs", error ? "text-destructive" : "text-hint")}
        >
          {error ?? hint}
        </span>
      ) : null}
    </div>
  );
}
