'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { BuildingIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'

import { SettingsPage } from '@/features/settings/settings-layout'

import { QueryGate } from './query-gate'
import { useWorkspaceAccess, type WorkspaceAccess } from './use-workspace-access'

export function pageWrapOf({
  title,
  description,
}: {
  title: string
  description?: string
}): (content: ReactNode) => ReactNode {
  const descriptionProps = description === undefined ? {} : { description }
  return function wrapPage(content) {
    return (
      <SettingsPage title={title} {...descriptionProps}>
        {content}
      </SettingsPage>
    )
  }
}

function NoWorkspace() {
  return (
    <Empty variant="outline">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BuildingIcon />
        </EmptyMedia>
        <EmptyTitle>You&apos;re not in a workspace yet</EmptyTitle>
        <EmptyDescription>
          Workspace settings appear once you create or join a workspace.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/" />}>
          Go to home
        </Button>
      </EmptyContent>
    </Empty>
  )
}

export function WorkspaceGate({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: (access: WorkspaceAccess) => ReactNode
}) {
  const query = useWorkspaceAccess()
  const wrap = pageWrapOf({ title, ...(description === undefined ? {} : { description }) })
  return (
    <QueryGate query={query} label="your workspace" wrap={wrap}>
      {(access) => (access === null ? wrap(<NoWorkspace />) : children(access))}
    </QueryGate>
  )
}
