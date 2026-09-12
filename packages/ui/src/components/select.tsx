import { cva, type VariantProps } from "class-variance-authority";
import type { CSSProperties, ChangeEvent } from "react";
import { useId } from "react";

import { cn } from "../lib/cn";

const selectWellVariants = cva(
  "relative flex min-w-0 items-center rounded-md border bg-card transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-standard)] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-45",
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

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectProps = VariantProps<typeof selectWellVariants> & {
  options: SelectOption[];
  value?: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  mono?: boolean;
  disabled?: boolean;
  label?: string;
  hint?: string;
  placeholder?: string;
  id?: string;
  style?: CSSProperties;
};

export function Select({
  options,
  value,
  onChange,
  size,
  mono = false,
  disabled = false,
  invalid = false,
  label,
  hint,
  placeholder,
  id,
  style,
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <div style={style} className="flex min-w-0 flex-col gap-2.5">
      {label ? (
        <label htmlFor={selectId} className="text-xs font-medium text-meta">
          {label}
        </label>
      ) : null}
      <div className={cn(selectWellVariants({ size, invalid }))}>
        <select
          id={selectId}
          value={value}
          disabled={disabled}
          onChange={onChange}
          className={cn(
            "h-full min-w-0 flex-1 appearance-none border-none bg-transparent pr-[26px] pl-4.5 text-foreground outline-none disabled:cursor-not-allowed",
            size === "sm" ? "text-sm" : "text-base",
            mono ? "font-mono" : "font-sans",
          )}
        >
          {placeholder ? <option value="">{placeholder}</option> : null}
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
        <span
          aria-hidden
          className="pointer-events-none absolute right-4.5 font-mono text-2xs text-hint"
        >
          ▾
        </span>
      </div>
      {hint ? <span className="text-xs text-hint">{hint}</span> : null}
    </div>
  );
}
