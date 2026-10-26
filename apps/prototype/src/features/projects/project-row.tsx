import { MessageSquareIcon, UsersIcon } from 'lucide-react'
import Link from 'next/link'

import { cn } from '@dltech/atlas-ui/lib/utils'

import { projectSettingsHref } from '../shell/thread-href'
import { ProjectSparkline } from './project-sparkline'
import type { ProjectSummary } from './projects.fixtures'

export function ProjectTile({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-sm font-semibold uppercase text-foreground',
        className,
      )}
    >
      {name.charAt(0)}
    </span>
  )
}

function Meta({ project }: { project: ProjectSummary }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span>{project.updated}</span>
      <span aria-hidden>·</span>
      <span className="flex items-center gap-1" title="Threads">
        <MessageSquareIcon className="size-3" />
        <span className="font-mono tabular-nums">{project.threads}</span>
      </span>
      <span aria-hidden>·</span>
      <span className="flex items-center gap-1" title="Members">
        <UsersIcon className="size-3" />
        <span className="font-mono tabular-nums">{project.members}</span>
      </span>
    </p>
  )
}

export function ProjectRow({
  project,
  showOwner,
}: {
  project: ProjectSummary
  showOwner: boolean
}) {
  return (
    <li>
      <Link
        href={projectSettingsHref(project.name)}
        className="flex min-h-20 items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
      >
        <ProjectTile name={project.name} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="truncate text-sm">
            {showOwner ? <span className="text-muted-foreground">{project.owner} / </span> : null}
            <span className="font-semibold text-foreground">{project.name}</span>
          </p>
          {project.description ? (
            <p className="truncate text-xs text-muted-foreground">{project.description}</p>
          ) : null}
          <Meta project={project} />
        </div>
        <ProjectSparkline
          series={project.activity}
          label={`${project.name} activity, last 14 days`}
        />
      </Link>
    </li>
  )
}
