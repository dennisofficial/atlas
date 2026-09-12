import type { CSSProperties, ChangeEvent } from "react";
import { useId } from "react";

import { cn } from "../lib/cn";

export type RadioOption = {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
};

export type RadioProps = {
  options: RadioOption[];
  value?: string;
  name?: string;
  disabled?: boolean;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  style?: CSSProperties;
};

export function Radio({
  options,
  value,
  name,
  disabled = false,
  onChange,
  style,
}: RadioProps) {
  const generatedName = useId();
  const group = name ?? generatedName;

  return (
    <div role="radiogroup" style={style} className="flex flex-col gap-4">
      {options.map((option) => {
        const off = disabled || Boolean(option.disabled);
        return (
          <label
            key={option.value}
            className={cn(
              "group flex items-start gap-4",
              off ? "cursor-not-allowed opacity-45" : "cursor-pointer",
            )}
          >
            <input
              type="radio"
              name={group}
              value={option.value}
              checked={option.value === value}
              disabled={off}
              onChange={onChange}
              className="absolute size-0 opacity-0"
            />
            <span
              aria-hidden
              className="mt-1 flex size-[15px] shrink-0 items-center justify-center rounded-full border border-input bg-card transition-[border-color] duration-[var(--duration-fast)] ease-[var(--ease-standard)] group-has-[:checked]:border-primary group-has-[:focus-visible]:outline-2 group-has-[:focus-visible]:outline-ring group-has-[:focus-visible]:outline-offset-1"
            >
              <span className="size-[7px] rounded-full bg-transparent transition-[background-color] duration-[var(--duration-fast)] ease-[var(--ease-standard)] group-has-[:checked]:bg-primary" />
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-base leading-9 text-foreground">
                {option.label}
              </span>
              {option.hint ? (
                <span className="text-xs text-hint">{option.hint}</span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
