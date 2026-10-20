import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { SidebarGroup } from "@dltech/atlas-ui/components/sidebar";

import { BUCKETS, PROJECTS, threadsOf } from "../../fixtures/app";
import { ProjectGroup } from "./shell-project-group";

export interface ThreadListProps {
  activeThreadId?: string;
  threadCardId?: string;
  projectCardId?: string;
}

function BucketRow({
  label,
  hint,
  count,
}: {
  label: string;
  hint?: string;
  count: number;
}) {
  return (
    <button
      type="button"
      className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <ChevronRight className="size-4 shrink-0" />
      <span className="shrink-0">{label}</span>
      {hint && <span className="shrink-0 text-xs opacity-70">{hint}</span>}
      <span className="h-px min-w-3 flex-1 bg-sidebar-border" />
      <span className="font-mono text-xs tabular-nums">{count}</span>
    </button>
  );
}

export function ThreadList({
  activeThreadId,
  threadCardId,
  projectCardId,
}: ThreadListProps) {
  const [collapsed, setCollapsed] = useState<string[]>([]);

  const handleOpenChange = (projectId: string, open: boolean) => {
    setCollapsed((current) =>
      open ? current.filter((id) => id !== projectId) : [...current, projectId],
    );
  };

  return (
    <SidebarGroup className="gap-3 px-2 py-2">
      {PROJECTS.map((project) => (
        <ProjectGroup
          key={project.id}
          project={project}
          threads={threadsOf(project.id)}
          open={!collapsed.includes(project.id)}
          onOpenChange={(open) => handleOpenChange(project.id, open)}
          activeThreadId={activeThreadId}
          threadCardId={threadCardId}
          defaultCardOpen={project.id === projectCardId}
        />
      ))}
      <div className="flex flex-col gap-0.5">
        <BucketRow label="Inactive" hint="Last 72h" count={BUCKETS.inactive} />
        <BucketRow label="Archived" count={BUCKETS.archived} />
      </div>
    </SidebarGroup>
  );
}
