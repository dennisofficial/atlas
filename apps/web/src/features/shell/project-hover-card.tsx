import { Settings } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@dltech/atlas-ui/components/hover-card'
import { Separator } from '@dltech/atlas-ui/components/separator'
import type { Project } from '@dltech/atlas-wire/web'

import { RowAction } from './shell-row-action'

const NONE = 'None'

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 font-mono text-foreground">
        <span className="truncate">{children}</span>
      </span>
    </div>
  )
}

function ProjectHoverCardBody({ project }: { project: Project }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium">{project.name}</p>
        <RowAction
          label="Project settings"
          href={`/projects/${encodeURIComponent(project.id)}/settings`}
        >
          <Settings />
        </RowAction>
      </div>
      {project.description.length === 0 ? null : (
        <p className="line-clamp-2 text-xs text-muted-foreground">{project.description}</p>
      )}
      <Separator />
      <div className="flex flex-col gap-1.5">
        <DetailRow label="Repository">{project.repo ?? NONE}</DetailRow>
        <DetailRow label="Base branch">{project.baseBranch ?? NONE}</DetailRow>
      </div>
    </div>
  )
}

export function ProjectHoverCard({
  project,
  className,
  children,
}: {
  project: Project
  className?: string
  children: ReactNode
}) {
  return (
    <HoverCard>
      <HoverCardTrigger delay={350} closeDelay={100} render={<div className={className} />}>
        {children}
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" sideOffset={8} alignOffset={-6} className="w-72">
        <ProjectHoverCardBody project={project} />
      </HoverCardContent>
    </HoverCard>
  )
}
