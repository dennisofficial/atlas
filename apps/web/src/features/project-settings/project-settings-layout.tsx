'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FolderXIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'

import { LoadFailed, LoadingBlocks } from '@/features/settings/data/workspace/query-gate'
import { EQueryState } from '@/lib/use-cloud-query'

import { ProjectProvider } from './data/project-context'
import { identityOf } from './data/project-mapping'
import { useProject } from './data/use-project'
import { EProjectSettingsSection, projectSectionOfPath } from './project-settings-nav'
import { ProjectSettingsShell } from './project-settings-shell'

const NOT_FOUND = 404

function ProjectNotFound() {
  return (
    <Empty variant="outline">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderXIcon />
        </EmptyMedia>
        <EmptyTitle>Project not found</EmptyTitle>
        <EmptyDescription>
          It may have been deleted, or it belongs to another account.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/" />}>
          Back to Atlas
        </Button>
      </EmptyContent>
    </Empty>
  )
}

export function ProjectSettingsLayout({
  projectId,
  children,
}: {
  projectId: string
  children: ReactNode
}) {
  const { query, save } = useProject(projectId)
  const section = projectSectionOfPath(usePathname()) ?? EProjectSettingsSection.Overview

  if (query.state === EQueryState.Ready) {
    return (
      <ProjectSettingsShell
        projectId={projectId}
        active={section}
        title={identityOf(query.data).slug}
      >
        <ProjectProvider projectId={projectId} project={query.data} save={save}>
          {children}
        </ProjectProvider>
      </ProjectSettingsShell>
    )
  }
  if (query.state === EQueryState.Failed) {
    return (
      <ProjectSettingsShell projectId={projectId} active={section} title="" bare>
        {query.error.status === NOT_FOUND ? (
          <ProjectNotFound />
        ) : (
          <LoadFailed label="this project" message={query.error.message} onRetry={query.reload} />
        )}
      </ProjectSettingsShell>
    )
  }
  return (
    <ProjectSettingsShell projectId={projectId} active={section} title="" bare>
      <LoadingBlocks label="project settings" />
    </ProjectSettingsShell>
  )
}
