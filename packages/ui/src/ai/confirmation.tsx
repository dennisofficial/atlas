"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { TerminalIcon } from "lucide-react";

import { Button } from "#components/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "#components/item";
import { Kbd } from "#components/kbd";

export enum EConfirmationState {
  Pending = "pending",
  Approved = "approved",
  Denied = "denied",
}

export interface ConfirmationProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  state?: EConfirmationState;
  evidence?: string[];
  shortcuts?: boolean;
  approveLabel?: string;
  denyLabel?: string;
  alwaysLabel?: string;
  onApprove?: () => void;
  onDeny?: () => void;
  onApproveAlways?: () => void;
}

const RESOLVED_LABEL: Record<EConfirmationState, string | undefined> = {
  [EConfirmationState.Pending]: undefined,
  [EConfirmationState.Approved]: "Approved",
  [EConfirmationState.Denied]: "Denied",
};

export function Confirmation({
  title,
  description,
  icon,
  state = EConfirmationState.Pending,
  evidence = [],
  shortcuts = true,
  approveLabel = "Approve",
  denyLabel = "Deny",
  alwaysLabel = "Always allow",
  onApprove,
  onDeny,
  onApproveAlways,
}: ConfirmationProps) {
  const pending = state === EConfirmationState.Pending;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!pending || !shortcuts || event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      onApprove?.();
    }
    if (event.key === "Escape") onDeny?.();
    if (event.key === "a" && onApproveAlways) onApproveAlways();
  };

  return (
    <Item
      variant="outline"
      size="sm"
      role="group"
      tabIndex={pending && shortcuts ? 0 : undefined}
      data-state={state}
      onKeyDown={handleKeyDown}
    >
      <ItemMedia variant="icon">{icon ?? <TerminalIcon />}</ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        {RESOLVED_LABEL[state] ?? description ? (
          <ItemDescription>{RESOLVED_LABEL[state] ?? description}</ItemDescription>
        ) : null}
        {pending && evidence.length > 0 ? (
          <ul className="flex flex-col gap-0.5 font-mono text-xs text-muted-foreground">
            {evidence.map((line) => (
              <li key={line} className="truncate">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
      </ItemContent>
      <ItemActions>
        {onApproveAlways ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={!pending}
            onClick={onApproveAlways}
          >
            {alwaysLabel}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={!pending}
          onClick={onDeny}
        >
          {denyLabel}
          {shortcuts && pending ? <Kbd>Esc</Kbd> : null}
        </Button>
        <Button size="sm" disabled={!pending} onClick={onApprove}>
          {approveLabel}
          {shortcuts && pending ? <Kbd>↵</Kbd> : null}
        </Button>
      </ItemActions>
    </Item>
  );
}
