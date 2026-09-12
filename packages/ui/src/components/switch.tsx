import type { CSSProperties, ChangeEvent } from "react";
import { useId } from "react";

import { cn } from "../lib/cn";

const trackSizes = {
  sm: "h-[15px] w-[26px]",
  md: "h-[18px] w-[32px]",
} as const;

const knobSizes = {
  sm: "size-[11px] group-has-[:checked]:left-[12px]",
  md: "size-[14px] group-has-[:checked]:left-[15px]",
} as const;

export type SwitchProps = {
  checked?: boolean;
  disabled?: boolean;
  label?: string;
  hint?: string;
  size?: keyof typeof trackSizes;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  id?: string;
  style?: CSSProperties;
};

export function Switch({
  checked = false,
  disabled = false,
  label,
  hint,
  size = "md",
  onChange,
  id,
  style,
}: SwitchProps) {
  const generatedId = useId();
  const switchId = id ?? generatedId;

  return (
    <label
      htmlFor={switchId}
      style={style}
      className={cn(
        "group flex items-center gap-5",
        disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer",
      )}
    >
      <input
        id={switchId}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="absolute size-0 opacity-0"
      />
      <span
        aria-hidden
        className={cn(
          "relative shrink-0 rounded-full border border-border bg-muted transition-[background-color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-standard)] group-has-[:checked]:border-transparent group-has-[:checked]:bg-primary group-has-[:focus-visible]:outline-2 group-has-[:focus-visible]:outline-ring group-has-[:focus-visible]:outline-offset-1",
          trackSizes[size],
        )}
      >
        <span
          className={cn(
            "absolute top-px left-1 rounded-full bg-warm-400 transition-[left,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)] group-has-[:checked]:bg-primary-foreground",
            knobSizes[size],
          )}
        />
      </span>
      {label ? (
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-base leading-9 text-foreground">{label}</span>
          {hint ? <span className="text-xs text-hint">{hint}</span> : null}
        </span>
      ) : null}
    </label>
  );
}
