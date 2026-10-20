"use client";

import { ChevronDownIcon, TriangleAlertIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#components/dropdown-menu";
import { InputGroupButton } from "#components/input-group";

export enum EEffort {
  Low = "low",
  Medium = "medium",
  High = "high",
}

export interface ModelOption {
  id: string;
  label: string;
  provider?: string;
  context?: string;
  rate?: string;
  unavailable?: boolean;
}

export interface ModelSelectorProps {
  models: ModelOption[];
  value: string;
  onValueChange?: (id: string) => void;
  effort?: EEffort;
  onEffortChange?: (effort: EEffort) => void;
  showRate?: boolean;
}

const EFFORT_LABEL: Record<EEffort, string> = {
  [EEffort.Low]: "Low",
  [EEffort.Medium]: "Medium",
  [EEffort.High]: "High",
};

const EFFORTS = [EEffort.Low, EEffort.Medium, EEffort.High];

export function groupByProvider(
  models: ModelOption[],
): { provider: string; models: ModelOption[] }[] {
  const groups = new Map<string, ModelOption[]>();
  for (const model of models) {
    const provider = model.provider ?? "Models";
    groups.set(provider, [...(groups.get(provider) ?? []), model]);
  }
  return [...groups].map(([provider, grouped]) => ({
    provider,
    models: grouped,
  }));
}

function isEffort(value: string): value is EEffort {
  return EFFORTS.some((effort) => effort === value);
}

export function ModelSelector({
  models,
  value,
  onValueChange,
  effort,
  onEffortChange,
  showRate = true,
}: ModelSelectorProps) {
  const current = models.find((model) => model.id === value) ?? models[0];
  const groups = groupByProvider(models);

  const handleModelChange = (next: string) => onValueChange?.(next);
  const handleEffortChange = (next: string) => {
    if (isEffort(next)) onEffortChange?.(next);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<InputGroupButton size="sm" />}>
          {current?.label ?? "No model"}
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          <DropdownMenuRadioGroup
            value={current?.id ?? ""}
            onValueChange={handleModelChange}
          >
            {groups.map((group, index) => (
              <DropdownMenuGroup key={group.provider}>
                {index > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuLabel>{group.provider}</DropdownMenuLabel>
                {group.models.map((model) => (
                  <DropdownMenuRadioItem
                    key={model.id}
                    value={model.id}
                    disabled={model.unavailable}
                    closeOnClick
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate">{model.label}</span>
                      {model.unavailable ? (
                        <TriangleAlertIcon className="text-warning" />
                      ) : null}
                    </span>
                    <span className="ml-auto flex shrink-0 gap-2 text-xs text-muted-foreground">
                      {model.context ? <span>{model.context}</span> : null}
                      {showRate && model.rate ? <span>{model.rate}</span> : null}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuGroup>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {effort ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<InputGroupButton size="sm" />}>
            {EFFORT_LABEL[effort]}
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={effort}
              onValueChange={handleEffortChange}
            >
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
