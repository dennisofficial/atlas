import Link from 'next/link'
import { useMemo, useState } from 'react'

import { SidebarGroup } from '@dltech/atlas-ui/components/sidebar'

import { useClock } from './use-clock'
import { Bucket } from './shell-bucket'
import { ProjectGroup } from './shell-project-group'
import { partitionThreads, type ProjectThreads } from './thread-partition'

export interface ThreadListProps {
  entries: readonly ProjectThreads[]
  activeThreadId: string | null
}

function NoProjects() {
  return (
    <p className="px-2 text-sm text-muted-foreground">
      No projects yet.{' '}
      <Link href="/projects" className="text-foreground underline-offset-4 hover:underline">
        Add one
      </Link>
    </p>
  )
}

export function ThreadList({ entries, activeThreadId }: ThreadListProps) {
  const [collapsed, setCollapsed] = useState<string[]>([])
  const now = useClock()
  const partition = useMemo(() => partitionThreads({ entries, now }), [entries, now])

  const handleOpenChange = (projectId: string, open: boolean) => {
    setCollapsed((current) =>
      open ? current.filter((id) => id !== projectId) : [...current, projectId],
    )
  }

  if (entries.length === 0) {
    return (
      <SidebarGroup>
        <NoProjects />
      </SidebarGroup>
    )
  }

  const hasBuckets = partition.inactive.length > 0 || partition.archived.length > 0
  return (
    <SidebarGroup>
      <div className="flex flex-col gap-3">
        {partition.groups.map((entry) => (
          <ProjectGroup
            key={entry.project.id}
            entry={entry}
            open={!collapsed.includes(entry.project.id)}
            onOpenChange={(open) => handleOpenChange(entry.project.id, open)}
            activeThreadId={activeThreadId}
          />
        ))}
        {hasBuckets && (
          <div className="flex flex-col gap-0.5">
            {partition.inactive.length > 0 && (
              <Bucket
                label="Inactive"
                hint="Last 72h"
                entries={partition.inactive}
                activeThreadId={activeThreadId}
              />
            )}
            {partition.archived.length > 0 && (
              <Bucket
                label="Archived"
                entries={partition.archived}
                activeThreadId={activeThreadId}
              />
            )}
          </div>
        )}
      </div>
    </SidebarGroup>
  )
}
