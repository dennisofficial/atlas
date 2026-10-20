import { Folder } from "lucide-react";
import type { ReactNode } from "react";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@dltech/atlas-ui/components/hover-card";
import { Separator } from "@dltech/atlas-ui/components/separator";

import {
  type AppThread,
  findProject,
  formatCount,
} from "../../fixtures/app";

export interface ThreadHoverCardProps {
  thread: AppThread;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}

function DiffStat({ thread }: { thread: AppThread }) {
  return (
    <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
      <span className="text-diff-add-foreground">
        +{formatCount(thread.added)}
      </span>
      <span className="text-diff-remove-foreground">
        −{formatCount(thread.removed)}
      </span>
      <span className="text-warning">~{formatCount(thread.changed)}</span>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-foreground">
        {children}
      </span>
    </div>
  );
}

export function ThreadHoverCardBody({ thread }: { thread: AppThread }) {
  const project = findProject(thread.projectId);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm leading-snug font-medium text-pretty">
          {thread.title}
        </p>
        <p className="text-xs text-muted-foreground">
          Created {thread.created}, updated {thread.updated}
        </p>
      </div>
      <DiffStat thread={thread} />
      <Separator />
      <div className="flex flex-col gap-1.5">
        <DetailRow label="Model">{thread.model}</DetailRow>
        <DetailRow label="Project">
          <Folder className="size-3.5 text-muted-foreground" />
          <span className="truncate">{project.name}</span>
        </DetailRow>
      </div>
    </div>
  );
}

export function ThreadHoverCard({
  thread,
  defaultOpen,
  className,
  children,
}: ThreadHoverCardProps) {
  return (
    <HoverCard defaultOpen={defaultOpen}>
      <HoverCardTrigger
        delay={350}
        closeDelay={100}
        render={<div className={className} />}
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={8}
        alignOffset={-6}
        className="w-72 p-3"
      >
        <ThreadHoverCardBody thread={thread} />
      </HoverCardContent>
    </HoverCard>
  );
}
