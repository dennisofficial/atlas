import Link from 'next/link'
import { SettingsIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import type { Project } from '@dltech/atlas-wire/web'

import {
  EProjectSettingsSection,
  hrefOfProjectSection,
} from '@/features/project-settings/project-settings-nav'
import { relativeTime } from '@/features/settings/data/personal/relative-time'

export const NO_REPOSITORY_LABEL = 'No repository'

export function ProjectRow({ project }: { project: Project }) {
  const settingsHref = hrefOfProjectSection({
    projectId: project.id,
    section: EProjectSettingsSection.Overview,
  })
  return (
    <li className="flex items-center gap-2 pr-3 transition-colors focus-within:bg-muted/50 hover:bg-muted/50">
      <Link
        href={`/threads/new?project=${encodeURIComponent(project.id)}`}
        className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3 outline-none"
      >
        <span className="truncate text-sm font-medium">{project.name}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate font-mono">{project.repo ?? NO_REPOSITORY_LABEL}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">Updated {relativeTime({ from: project.updatedAt })}</span>
        </span>
      </Link>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`${project.name} settings`}
        nativeButton={false}
        render={<Link href={settingsHref} />}
      >
        <SettingsIcon />
      </Button>
    </li>
  )
}
