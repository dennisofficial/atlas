import { GitBranchIcon, GitPullRequestIcon, PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";

import { Badge } from "@dltech/atlas-ui/components/badge";
import { Button } from "@dltech/atlas-ui/components/button";
import { SidebarTrigger } from "@dltech/atlas-ui/components/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@dltech/atlas-ui/components/tooltip";

import { ESessionState } from "./session-types";

export interface SessionHeaderProps {
  state: ESessionState;
  panelOpen: boolean;
  onTogglePanel: () => void;
}

const STATE_LABEL: Record<ESessionState, string> = {
  [ESessionState.Running]: "Running",
  [ESessionState.Idle]: "Idle",
  [ESessionState.ApprovalPending]: "Needs approval",
};

export function SessionHeader({ state, panelOpen, onTogglePanel }: SessionHeaderProps) {
  const label = panelOpen ? "Hide panel" : "Show panel";
  const PanelIcon = panelOpen ? PanelRightCloseIcon : PanelRightOpenIcon;
  const hasPullRequest = state === ESessionState.Idle;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
      <SidebarTrigger />
      <h1 className="truncate text-sm font-medium">Rebase ui on shadcn base-nova</h1>
      <span className="flex min-w-0 items-center gap-1 font-mono text-xs text-muted-foreground">
        <GitBranchIcon className="size-3.5 shrink-0" />
        <span className="truncate">dennis/shadcn-ui-storybook</span>
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {hasPullRequest ? (
          <Badge variant="outline">
            <GitPullRequestIcon />
            <span className="font-mono">#1316</span> Open
          </Badge>
        ) : (
          <Badge variant="secondary">{STATE_LABEL[state]}</Badge>
        )}
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label={label} aria-pressed={panelOpen} onClick={onTogglePanel} />}
          >
            <PanelIcon />
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
