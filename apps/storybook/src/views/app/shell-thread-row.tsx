import { Archive, ExternalLink, Pin } from "lucide-react";

import { SidebarMenuButton, SidebarMenuItem } from "@dltech/atlas-ui/components/sidebar";
import { cn } from "@dltech/atlas-ui/lib/utils";

import { type AppThread, EThreadStatus } from "../../fixtures/app";
import { RowAction } from "./shell-row-action";
import { ThreadStatusIcon } from "./shell-status-icon";
import { ThreadHoverCard } from "./thread-hover-card";

export interface ThreadRowProps {
  thread: AppThread;
  active: boolean;
  defaultCardOpen: boolean;
}

function hasPullRequest(thread: AppThread): boolean {
  return (
    thread.status === EThreadStatus.PrOpen ||
    thread.status === EThreadStatus.PrMerged
  );
}

export function ThreadRow({ thread, active, defaultCardOpen }: ThreadRowProps) {
  return (
    <SidebarMenuItem>
      <ThreadHoverCard
        thread={thread}
        defaultOpen={defaultCardOpen}
        className={cn(
          "group/thread flex items-center rounded-md hover:bg-sidebar-accent data-popup-open:bg-sidebar-accent",
          active && "bg-sidebar-accent",
        )}
      >
        <SidebarMenuButton
          isActive={active}
          size="sm"
          className="h-7 min-w-0 flex-1 text-sm hover:bg-transparent data-active:bg-transparent"
        >
          <ThreadStatusIcon status={thread.status} />
          <span>{thread.title}</span>
        </SidebarMenuButton>
        <div className="hidden shrink-0 items-center pr-1 group-hover/thread:flex group-data-popup-open/thread:flex">
          <RowAction label="Pin thread">
            <Pin />
          </RowAction>
          <RowAction label="Archive thread">
            <Archive />
          </RowAction>
          {hasPullRequest(thread) && (
            <RowAction label="Open pull request on GitHub">
              <ExternalLink />
            </RowAction>
          )}
        </div>
      </ThreadHoverCard>
    </SidebarMenuItem>
  );
}
