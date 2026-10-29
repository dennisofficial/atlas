'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { FolderPlusIcon, PlusIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'
import type { Project } from '@dltech/atlas-wire/web'

import { QueryGate } from '@/features/settings/data/shared/query-gate'
import { fetchProjects } from '@/features/threads/data/threads-api'
import { useCloudQuery } from '@/lib/use-cloud-query'

import { NewProjectHost } from './new-project-host'
import { ProjectRow } from './project-row'

export const PROJECTS_PATH = '/projects'
export const NEW_PROJECT_PARAM = 'new'

function ProjectList({ projects }: { projects: readonly Project[] }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
      {projects.map((project) => (
        <ProjectRow key={project.id} project={project} />
      ))}
    </ul>
  )
}

function NoProjects({ onNewProject }: { onNewProject: () => void }) {
  return (
    <Empty variant="outline">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderPlusIcon />
        </EmptyMedia>
        <EmptyTitle>No projects yet</EmptyTitle>
        <EmptyDescription>Atlas runs each thread against a project.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" onClick={onNewProject}>
          <PlusIcon data-icon="inline-start" />
          New project
        </Button>
      </EmptyContent>
    </Empty>
  )
}

export function ProjectsView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const query = useCloudQuery({ key: 'projects', load: fetchProjects })
  const [dismissed, setDismissed] = useState(false)
  const [opened, setOpened] = useState(false)
  const open = opened || (searchParams.get(NEW_PROJECT_PARAM) === '1' && !dismissed)

  const handleNewProject = () => setOpened(true)
  const handleOpenChange = (next: boolean) => {
    if (next) return setOpened(true)
    setOpened(false)
    setDismissed(true)
    if (searchParams.has(NEW_PROJECT_PARAM)) router.replace(PROJECTS_PATH)
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-16">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-medium tracking-tight">Projects</h1>
          <Button onClick={handleNewProject}>
            <PlusIcon data-icon="inline-start" />
            New project
          </Button>
        </header>
        <QueryGate query={query} label="projects">
          {(projects) =>
            projects.length === 0 ? (
              <NoProjects onNewProject={handleNewProject} />
            ) : (
              <ProjectList projects={projects} />
            )
          }
        </QueryGate>
        {query.data === undefined ? null : (
          <NewProjectHost open={open} onOpenChange={handleOpenChange} projects={query.data} />
        )}
      </div>
    </div>
  )
}
