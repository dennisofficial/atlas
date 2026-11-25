'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { FolderXIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

import { EProjectSettingsSection } from '@/features/project-settings/project-settings-nav'
import { fetchProjects } from '@/features/projects/data/projects-api'
import { LoadFailed, LoadingRegion } from '@/features/settings/data/shared/query-gate'
import { SettingsScopeProvider } from '@/features/settings/scope/settings-scope'
import { PROJECTS_KEY } from '@/lib/cloud-keys'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

import { GroupProvider } from './data/group-context'
import { useGroups } from './data/use-groups'
import { GROUPS_HREF, groupSectionOfPath } from './group-settings-nav'
import { GroupSettingsShell } from './group-settings-shell'

const NOT_FOUND = 404
const LOADING_KEYS = ['a', 'b', 'c']

function GroupNotFound() {
  return (
    <Empty variant="outline">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderXIcon />
        </EmptyMedia>
        <EmptyTitle>Group not found</EmptyTitle>
        <EmptyDescription>
          It may have been deleted, or it belongs to another account.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={GROUPS_HREF} />}
        >
          Back to groups
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function GroupSettingsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {LOADING_KEYS.map((key) => (
        <Skeleton key={key} className="h-16 w-full" />
      ))}
    </div>
  )
}

export function GroupSettingsLayout({
  groupId,
  children,
}: {
  groupId: string
  children: ReactNode
}) {
  const groups = useGroups()
  const projects = useCloudQuery({ key: PROJECTS_KEY, load: fetchProjects })
  const active = groupSectionOfPath(usePathname()) ?? EProjectSettingsSection.Overview

  if (groups.query.state === EQueryState.Failed) {
    return (
      <GroupSettingsShell groupId={groupId} active={active} title="" bare>
        {groups.query.error.status === NOT_FOUND ? (
          <GroupNotFound />
        ) : (
          <LoadFailed
            label="this group"
            message={groups.query.error.message}
            onRetry={groups.query.reload}
          />
        )}
      </GroupSettingsShell>
    )
  }
  if (groups.query.state === EQueryState.Loading) {
    return (
      <GroupSettingsShell groupId={groupId} active={active} title="" bare>
        <LoadingRegion label="group settings" className="flex flex-col gap-10">
          <GroupSettingsSkeleton />
        </LoadingRegion>
      </GroupSettingsShell>
    )
  }
  const group = groups.query.data.find((entry) => entry.id === groupId)
  if (group === undefined) {
    return (
      <GroupSettingsShell groupId={groupId} active={active} title="" bare>
        <GroupNotFound />
      </GroupSettingsShell>
    )
  }
  const members =
    projects.state === EQueryState.Ready
      ? projects.data.filter((project) => project.groupId === groupId)
      : []
  return (
    <GroupSettingsShell groupId={groupId} active={active} title={group.name}>
      <SettingsScopeProvider scope={{ kind: 'group', groupId }}>
        <GroupProvider group={group} projects={members} save={groups.save} assign={groups.assign}>
          {children}
        </GroupProvider>
      </SettingsScopeProvider>
    </GroupSettingsShell>
  )
}
