import Link from 'next/link'
import { useMemo, useState } from 'react'

import { SidebarGroup } from '@dltech/atlas-ui/components/sidebar'
import type { SessionBucketCounts } from '@dltech/atlas-wire/web'

import type { ApiPrStatesSubscribe } from '@/features/threads/data/api-pr-states-source'
import { useApiPrStates } from '@/features/threads/data/use-api-pr-states'

import { SidebarPrStatesProvider } from './shell-sidebar-pr-states'
import { ThreadFamilyProvider } from './shell-thread-family'
import { useClock } from './use-clock'
import { Bucket } from './shell-bucket'
import { ProjectGroup } from './shell-project-group'
import {
  countThreads,
  mainThreadsOf,
  partitionThreads,
  projectKeyOf,
  type ProjectThreads,
} from './thread-partition'

export interface ThreadListProps {
  entries: readonly ProjectThreads[]
  counts?: SessionBucketCounts | null
  activeThreadId: string | null
  subscribe?: ApiPrStatesSubscribe
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

export function ThreadList(props: ThreadListProps) {
  const family = useMemo(
    () => props.entries.flatMap((entry) => mainThreadsOf(entry.sessions)),
    [props.entries],
  )
  const states = useApiPrStates({
    subscribe: props.subscribe,
    enabled: family.some((thread) => thread.runner !== 'local'),
  })
  return (
    <ThreadFamilyProvider threads={family}>
      <SidebarPrStatesProvider states={states}>
        <ThreadListContent {...props} />
      </SidebarPrStatesProvider>
    </ThreadFamilyProvider>
  )
}

const countSessionRows = (entries: readonly ProjectThreads[]): number =>
  entries.reduce(
    (total, entry) => total + entry.sessions.filter((session) => session.view !== undefined).length,
    0,
  )

const bucketTotalOf = (args: {
  streamCount: number | undefined
  entries: readonly ProjectThreads[]
}): number =>
  args.streamCount === undefined
    ? countThreads(args.entries)
    : args.streamCount + countSessionRows(args.entries)

function ThreadListContent({ entries, counts, activeThreadId }: ThreadListProps) {
  const [collapsed, setCollapsed] = useState<string[]>([])
  const now = useClock()
  const partition = useMemo(() => partitionThreads({ entries, now }), [entries, now])
  const archivedTotal = bucketTotalOf({
    streamCount: counts?.archived,
    entries: partition.archived,
  })

  const handleOpenChange = (projectId: string, open: boolean) => {
    setCollapsed((current) =>
      open ? current.filter((id) => id !== projectId) : [...current, projectId],
    )
  }

  if (entries.every((entry) => entry.project === null && entry.sessions.length === 0)) {
    return (
      <SidebarGroup>
        <NoProjects />
      </SidebarGroup>
    )
  }

  return (
    <SidebarGroup>
      <div className="flex flex-col gap-3">
        {partition.groups.map((entry) => {
          const key = projectKeyOf(entry.project)
          return (
            <ProjectGroup
              key={key}
              entry={entry}
              open={!collapsed.includes(key)}
              onOpenChange={(open) => handleOpenChange(key, open)}
              activeThreadId={activeThreadId}
            />
          )
        })}
        {partition.archived.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <Bucket
              label="Archived"
              entries={partition.archived}
              total={archivedTotal}
              activeThreadId={activeThreadId}
            />
          </div>
        )}
      </div>
    </SidebarGroup>
  )
}
