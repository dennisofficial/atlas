import type { CSSProperties, ChangeEvent } from "react";
import { useId } from "react";

import { cn } from "../lib/cn";

export type SliderProps = {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  label?: string;
  valueLabel?: string;
  ticks?: string[];
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  id?: string;
  style?: CSSProperties;
};

export function Slider({
  value = 0,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  label,
  valueLabel,
  ticks,
  onChange,
  id,
  style,
}: SliderProps) {
  const generatedId = useId();
  const sliderId = id ?? generatedId;
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;

  return (
    <div
      style={style}
      className={cn("flex min-w-0 flex-col gap-3", disabled && "opacity-45")}
    >
      {label || valueLabel ? (
        <div className="flex items-baseline justify-between gap-4">
          {label ? (
            <label htmlFor={sliderId} className="text-xs font-medium text-meta">
              {label}
            </label>
          ) : null}
          {valueLabel ? (
            <span className="font-mono text-2xs text-foreground">
              {valueLabel}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="relative flex h-4 items-center">
        <div className="absolute inset-x-0 top-[7px] h-[3px] rounded-xs bg-muted" />
        <div
          className="absolute top-[7px] left-0 h-[3px] rounded-xs bg-primary"
          style={{ width: `${pct}%` }}
        />
        <input
          id={sliderId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={onChange}
          className={cn(
            "peer relative z-10 m-0 h-4 w-full appearance-none bg-transparent opacity-0",
            disabled ? "cursor-not-allowed" : "cursor-pointer",
          )}
        />
        <span
          aria-hidden
          style={{ left: `calc(${pct}% - ${(pct / 100) * 11}px)` }}
          className="pointer-events-none absolute top-[3px] size-[11px] rounded-full border-2 border-background bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-ring peer-focus-visible:outline-offset-1"
        />
      </div>
      {ticks && ticks.length > 0 ? (
        <div className="flex justify-between font-mono text-2xs text-hint">
          {ticks.map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
