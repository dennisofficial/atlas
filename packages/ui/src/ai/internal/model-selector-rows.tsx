import type { KeyboardEvent, MouseEvent } from "react";
import { PinIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "cn";

import { Button } from "#components/button";
import { CommandItem } from "#components/command";

import { reconnectItemValue, type ModelOption } from "../model-selector-groups";

interface ModelRowProps {
  model: ModelOption;
  checked: boolean;
  pinned: boolean;
  canPin: boolean;
  showRate: boolean;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
}

export function ModelRow({
  model,
  checked,
  pinned,
  canPin,
  showRate,
  onSelect,
  onTogglePin,
}: ModelRowProps) {
  const handleSelect = () => onSelect(model.id);
  const handlePinMouseDown = (event: MouseEvent) => event.preventDefault();
  const handlePinKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") event.stopPropagation();
  };
  const handlePinClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onTogglePin(model.id);
  };

  return (
    <CommandItem value={model.id} data-checked={checked} onSelect={handleSelect} className="h-8">
      <span className="min-w-0 flex-1 truncate" title={model.label}>
        {model.label}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
        {model.context ? <span>{model.context}</span> : null}
        {showRate && model.rate ? <span className="w-6 text-right">{model.rate}</span> : null}
      </span>
      {canPin ? (
        <button
          type="button"
          aria-label={pinned ? `Unpin ${model.label}` : `Pin ${model.label}`}
          aria-pressed={pinned}
          onMouseDown={handlePinMouseDown}
          onKeyDown={handlePinKeyDown}
          onClick={handlePinClick}
          className={cn(
            "pointer-events-auto flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            pinned
              ? "text-foreground"
              : "opacity-0 group-hover/command-item:opacity-100 group-data-selected/command-item:opacity-100 focus-visible:opacity-100",
          )}
        >
          <PinIcon className={cn("size-3.5", pinned && "fill-current")} />
        </button>
      ) : null}
    </CommandItem>
  );
}

export function ReconnectRow({
  provider,
  onReconnect,
}: {
  provider: string;
  onReconnect: (provider: string) => void;
}) {
  const handleSelect = () => onReconnect(provider);
  return (
    <CommandItem
      value={reconnectItemValue(provider)}
      onSelect={handleSelect}
      aria-label={`${provider}: sign-in expired. Reconnect`}
      className="h-8"
    >
      <TriangleAlertIcon className="size-3.5 text-warning/80" />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">Sign-in expired</span>
      <span className="shrink-0 text-xs text-primary underline-offset-4 group-hover/command-item:underline group-data-selected/command-item:underline">
        Reconnect
      </span>
    </CommandItem>
  );
}

export function NoProvidersState({
  canConnect,
  onConnect,
}: {
  canConnect: boolean;
  onConnect: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">No providers connected</p>
        <p className="text-xs text-muted-foreground">Connect a provider to choose a model.</p>
      </div>
      {canConnect ? (
        <Button size="sm" variant="outline" onClick={onConnect}>
          Connect a provider
        </Button>
      ) : null}
    </div>
  );
}
