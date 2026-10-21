"use client";

import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ChevronDownIcon, PinIcon } from "lucide-react";
import { cn } from "cn";

import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "#components/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "#components/dropdown-menu";
import { InputGroupButton } from "#components/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "#components/popover";

import {
  firstSelectable,
  modelSelectorGroups,
  togglePinned,
  type ModelOption,
  type UnconnectedProvider,
} from "./model-selector-groups";

export {
  groupByProvider,
  modelSelectorGroups,
  togglePinned,
  type ModelOption,
  type ModelSelectorGroups,
  type ProviderGroup,
  type UnconnectedProvider,
} from "./model-selector-groups";

export enum EEffort {
  Low = "low",
  Medium = "medium",
  High = "high",
}

export interface ModelSelectorProps {
  models: ModelOption[];
  value: string;
  onValueChange?: (id: string) => void;
  effort?: EEffort;
  onEffortChange?: (effort: EEffort) => void;
  showRate?: boolean;
  pinned?: string[];
  onPinnedChange?: (ids: string[]) => void;
  defaultOpen?: boolean;
}

const EFFORT_LABEL: Record<EEffort, string> = {
  [EEffort.Low]: "Low",
  [EEffort.Medium]: "Medium",
  [EEffort.High]: "High",
};

const EFFORTS = [EEffort.Low, EEffort.Medium, EEffort.High];

const PIN_SHORTCUT_CODE = "KeyP";

function isEffort(value: string): value is EEffort {
  return EFFORTS.some((effort) => effort === value);
}

interface ModelRowProps {
  model: ModelOption;
  checked: boolean;
  pinned: boolean;
  canPin: boolean;
  showRate: boolean;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
}

function ModelRow({
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
  const handlePinClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onTogglePin(model.id);
  };

  return (
    <CommandItem
      value={model.id}
      disabled={model.unavailable}
      data-checked={checked}
      onSelect={handleSelect}
      className="h-8"
    >
      <span className="min-w-0 flex-1 truncate" title={model.label}>
        {model.label}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
        {model.unavailable ? <span>Not connected</span> : null}
        {!model.unavailable && model.context ? <span>{model.context}</span> : null}
        {!model.unavailable && showRate && model.rate ? (
          <span className="w-6 text-right">{model.rate}</span>
        ) : null}
      </span>
      {canPin ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={pinned ? `Unpin ${model.label}` : `Pin ${model.label}`}
          aria-pressed={pinned}
          aria-keyshortcuts="Alt+P"
          onMouseDown={handlePinMouseDown}
          onClick={handlePinClick}
          className={cn(
            "pointer-events-auto flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground",
            pinned
              ? "text-foreground"
              : "opacity-0 group-hover/command-item:opacity-100 group-data-selected/command-item:opacity-100",
          )}
        >
          <PinIcon className={cn("size-3.5", pinned && "fill-current")} />
        </button>
      ) : null}
    </CommandItem>
  );
}

function CollapsedProvider({ group }: { group: UnconnectedProvider }) {
  const noun = group.total === 1 ? "model" : "models";
  return (
    <CommandItem value={`provider:${group.provider}`} disabled className="h-8">
      <span className="min-w-0 flex-1 truncate">
        {group.provider} · {group.total} {noun}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">Not connected</span>
    </CommandItem>
  );
}

export function ModelSelector({
  models,
  value,
  onValueChange,
  effort,
  onEffortChange,
  showRate = true,
  pinned = [],
  onPinnedChange,
  defaultOpen = false,
}: ModelSelectorProps) {
  const current = models.find((model) => model.id === value) ?? models[0];
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(current?.id ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  const groups = modelSelectorGroups({ models, query, pinned });
  const pinnedIds = new Set(groups.pinned.map((model) => model.id));
  const canPin = onPinnedChange !== undefined;
  const hasConnectedSection = groups.pinned.length > 0 || groups.providers.length > 0;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    setQuery("");
    if (next) setHighlighted(current?.id ?? "");
  };
  const handleQueryChange = (next: string) => {
    setQuery(next);
    const first = firstSelectable(modelSelectorGroups({ models, query: next, pinned }));
    setHighlighted(next.trim().length === 0 ? (current?.id ?? "") : (first?.id ?? ""));
  };
  const handleModelSelect = (id: string) => {
    onValueChange?.(id);
    handleOpenChange(false);
  };
  const handleTogglePin = (id: string) =>
    onPinnedChange?.(togglePinned({ pinned, id }));
  const handleListKeyDown = (event: KeyboardEvent) => {
    if (!canPin || !event.altKey || event.code !== PIN_SHORTCUT_CODE) return;
    const target = models.find((model) => model.id === highlighted);
    if (target === undefined || target.unavailable) return;
    event.preventDefault();
    handleTogglePin(target.id);
  };
  const handleEffortChange = (next: string) => {
    if (isEffort(next)) onEffortChange?.(next);
  };

  const renderRow = (model: ModelOption) => (
    <ModelRow
      key={model.id}
      model={model}
      checked={model.id === current?.id}
      pinned={pinnedIds.has(model.id)}
      canPin={canPin && !model.unavailable}
      showRate={showRate}
      onSelect={handleModelSelect}
      onTogglePin={handleTogglePin}
    />
  );

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger render={<InputGroupButton size="sm" />}>
          {current?.label ?? "No model"}
          <ChevronDownIcon />
        </PopoverTrigger>
        <PopoverContent align="start" initialFocus={inputRef} className="w-80 gap-0 p-0">
          <Command
            label="Models"
            shouldFilter={false}
            loop
            value={highlighted}
            onValueChange={setHighlighted}
            onKeyDown={handleListKeyDown}
          >
            <CommandInput
              ref={inputRef}
              autoFocus
              aria-label="Search models"
              placeholder="Search models"
              value={query}
              onValueChange={handleQueryChange}
            />
            <CommandList className="max-h-80">
              {groups.isEmpty ? (
                <p role="status" className="px-2 py-6 text-center text-sm text-muted-foreground">
                  No models match “{query.trim()}”
                </p>
              ) : null}
              {groups.pinned.length > 0 ? (
                <CommandGroup heading="Pinned">{groups.pinned.map(renderRow)}</CommandGroup>
              ) : null}
              {groups.providers.map((group) => (
                <CommandGroup key={group.provider} heading={group.provider}>
                  {group.models.map(renderRow)}
                </CommandGroup>
              ))}
              {groups.unconnected.length > 0 ? (
                <>
                  {hasConnectedSection ? <CommandSeparator className="my-1" /> : null}
                  <CommandGroup heading="Connect a provider">
                    {groups.unconnected
                      .filter((group) => group.collapsed)
                      .map((group) => (
                        <CollapsedProvider key={group.provider} group={group} />
                      ))}
                  </CommandGroup>
                  {groups.unconnected
                    .filter((group) => !group.collapsed)
                    .map((group) => (
                      <CommandGroup key={group.provider} heading={group.provider}>
                        {group.models.map(renderRow)}
                      </CommandGroup>
                    ))}
                </>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {effort ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<InputGroupButton size="sm" />}>
            {EFFORT_LABEL[effort]}
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={effort} onValueChange={handleEffortChange}>
              {EFFORTS.map((option) => (
                <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                  {EFFORT_LABEL[option]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}
