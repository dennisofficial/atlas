import Link from 'next/link'
import { useMemo, useState } from 'react'

import { SidebarGroup } from '@dltech/atlas-ui/components/sidebar'
import { ESessionBucket, type SessionBucketCounts } from '@dltech/atlas-wire/web'

import type { ApiPrStatesSubscribe } from '@/features/threads/data/api-pr-states-source'
import { useApiPrStates } from '@/features/threads/data/use-api-pr-states'
import { usePrObservationRegistry } from '@/features/threads/data/use-pr-observation'

import { SidebarPrObservationsProvider } from './shell-pr-observations'
import { SidebarPrStatesProvider } from './shell-sidebar-pr-states'
import { ThreadFamilyProvider } from './shell-thread-family'
import { useClock } from './use-clock'
import type { PageBucket } from './session-pager'
import { Bucket } from './shell-bucket'
import { BucketSheet } from './shell-bucket-sheet'
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
  const { registry, observe } = usePrObservationRegistry()
  const family = useMemo(
    () => props.entries.flatMap((entry) => mainThreadsOf(entry.sessions)),
    [props.entries],
  )
  const states = useApiPrStates({
    subscribe: props.subscribe,
    observe,
    enabled: family.some((thread) => thread.runner !== 'local'),
  })
  return (
    <ThreadFamilyProvider threads={family}>
      <SidebarPrObservationsProvider registry={registry}>
        <SidebarPrStatesProvider states={states}>
          <ThreadListContent {...props} />
        </SidebarPrStatesProvider>
      </SidebarPrObservationsProvider>
    </ThreadFamilyProvider>
  )
}

function ThreadListContent({ entries, counts, activeThreadId }: ThreadListProps) {
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [paging, setPaging] = useState<PageBucket | null>(null)
  const now = useClock()
  const partition = useMemo(() => partitionThreads({ entries, now }), [entries, now])
  const totals = {
    [ESessionBucket.Inactive]: counts?.inactive ?? countThreads(partition.inactive),
    [ESessionBucket.Archived]: counts?.archived ?? countThreads(partition.archived),
  }

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

  const hasBuckets = partition.inactive.length > 0 || partition.archived.length > 0
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
        {hasBuckets && (
          <div className="flex flex-col gap-0.5">
            {partition.inactive.length > 0 && (
              <Bucket
                label="Inactive"
                hint="Last 72h"
                entries={partition.inactive}
                total={totals[ESessionBucket.Inactive]}
                onShowAll={() => setPaging(ESessionBucket.Inactive)}
                activeThreadId={activeThreadId}
              />
            )}
            {partition.archived.length > 0 && (
              <Bucket
                label="Archived"
                entries={partition.archived}
                total={totals[ESessionBucket.Archived]}
                onShowAll={() => setPaging(ESessionBucket.Archived)}
                activeThreadId={activeThreadId}
              />
            )}
          </div>
        )}
      </div>
      {paging !== null && (
        <BucketSheet
          bucket={paging}
          onOpenChange={(open) => {
            if (!open) setPaging(null)
          }}
        />
      )}
    </SidebarGroup>
  )
}
