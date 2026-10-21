'use client'

import Link from 'next/link'
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

import { LoadFailed, LoadingBlocks } from '@/features/settings/data/workspace/query-gate'
import { EQueryState } from '@/lib/use-cloud-query'

import { ProjectProvider } from './data/project-context'
import { identityOf } from './data/project-mapping'
import { useProject } from './data/use-project'
import { PROJECT_SECTION_PAGES } from './project-settings-pages'
import type { EProjectSettingsSection } from './project-settings-nav'
import { ProjectSettingsShell } from './project-settings-shell'

const NOT_FOUND = 404

function ProjectNotFound() {
  return (
    <Empty className="border py-10">
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

export function ProjectSettingsRoute({
  projectId,
  section,
}: {
  projectId: string
  section: EProjectSettingsSection
}) {
  const { query, save } = useProject(projectId)
  const Page = PROJECT_SECTION_PAGES[section]

  if (query.state === EQueryState.Ready) {
    return (
      <ProjectSettingsShell
        projectId={projectId}
        active={section}
        title={identityOf(query.data).slug}
      >
        <ProjectProvider projectId={projectId} project={query.data} save={save}>
          <Page />
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
