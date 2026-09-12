import type { CSSProperties, ChangeEvent } from "react";
import { useId } from "react";

import { cn } from "../lib/cn";

export type CheckboxProps = {
  checked?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  label?: string;
  hint?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  id?: string;
  style?: CSSProperties;
};

export function Checkbox({
  checked = false,
  indeterminate = false,
  disabled = false,
  label,
  hint,
  onChange,
  id,
  style,
}: CheckboxProps) {
  const generatedId = useId();
  const boxId = id ?? generatedId;
  const on = checked || indeterminate;

  return (
    <label
      htmlFor={boxId}
      style={style}
      className={cn(
        "group flex items-start gap-4",
        disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer",
      )}
    >
      <input
        id={boxId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="absolute size-0 opacity-0"
      />
      <span
        aria-hidden
        className={cn(
          "mt-1 flex size-[15px] shrink-0 items-center justify-center rounded-sm border font-mono text-2xs leading-none text-primary-foreground transition-[background-color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-standard)] group-has-[:focus-visible]:outline-2 group-has-[:focus-visible]:outline-ring group-has-[:focus-visible]:outline-offset-1",
          on ? "border-primary bg-primary" : "border-input bg-card",
        )}
      >
        {indeterminate ? "–" : checked ? "✓" : ""}
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
