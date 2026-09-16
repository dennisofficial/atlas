import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { cn } from "../lib/cn";

export interface PaletteCommand {
  name: string;
  summary?: string;
  argumentHint?: string;
  kind?: "cmd" | "skill";
}

export interface CommandPaletteProps {
  open?: boolean;
  commands: PaletteCommand[];
  placeholder?: string;
  onClose?: () => void;
  onRun?: (command: PaletteCommand) => void;
  footerHint?: string;
  style?: CSSProperties;
  className?: string;
}

export function CommandPalette({
  open = false,
  commands,
  placeholder = "Type a command…",
  onClose,
  onRun,
  footerHint = "⇥ complete",
  style,
  className,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const matches = useMemo(() => {
    const needle = query.toLowerCase();
    return commands.filter((command) =>
      `${command.name} ${command.summary ?? ""}`.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose?.();
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((n) => Math.min(matches.length - 1, n + 1));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((n) => Math.max(0, n - 1));
      }
      if (event.key === "Enter") {
        const command = matches[index];
        if (command) onRun?.(command);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, matches, index, onClose, onRun]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-start justify-center bg-scrim pt-[76px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        style={style}
        className={cn(
          "w-[560px] max-w-[calc(100%-32px)] animate-[atlas-pop_var(--duration-fast)_var(--ease-out)_both] overflow-hidden rounded-lg border border-border bg-surface-overlay shadow-palette",
          className,
        )}
      >
        <div className="flex h-10 items-center gap-2 border-b border-border px-3">
          <span className="font-mono text-[13px] text-primary">❯</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            placeholder={placeholder}
            className="flex-1 border-none bg-transparent font-mono text-base text-foreground outline-none [caret-color:var(--caret)] placeholder:text-hint"
          />
          <span className="shrink-0 font-mono text-2xs whitespace-nowrap text-hint">
            {matches.length ? index + 1 : 0}/{matches.length} · {footerHint}
          </span>
        </div>
        <div className="max-h-[264px] overflow-auto p-1">
          {matches.length === 0 ? (
            <div className="px-[10px] py-[18px] text-center text-base text-hint">
              No command matches{" "}
              <span className="font-mono text-meta">{query}</span>
            </div>
          ) : (
            matches.map((command, i) => {
              const on = i === index;
              return (
                <button
                  key={command.name}
                  type="button"
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => onRun?.(command)}
                  className={cn(
                    "flex h-row-default w-full items-center gap-[10px] rounded-sm px-2 text-left font-mono text-sm",
                    on ? "bg-hover" : "bg-transparent",
                  )}
                >
                  <span className="w-[10px] text-primary">{on ? "❯" : ""}</span>
                  <span
                    className={cn(
                      "min-w-[150px]",
                      on ? "text-foreground" : "text-secondary-foreground",
                    )}
                  >
                    /{command.name}
                    {command.argumentHint ? (
                      <span className="text-hint"> {command.argumentHint}</span>
                    ) : null}
                  </span>
                  <span className="flex-1 truncate text-hint">
                    {command.summary}
                  </span>
                  <span
                    className={cn(
                      "text-2xs",
                      command.kind === "skill" ? "text-external" : "text-meta",
                    )}
                  >
                    {command.kind ?? "cmd"}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
