import { FolderSearchIcon, LinkIcon, PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@dltech/atlas-ui/components/breadcrumb'
import { Button } from '@dltech/atlas-ui/components/button'

import { OwnerList } from './owner-list'
import { ProjectRow } from './project-row'
import { filterProjects, PROJECT_OWNERS, PROJECTS } from './projects.fixtures'

export interface ProjectsViewProps {
  initialOwnerId?: string | null
}

function ProjectsHeader({ ownerName }: { ownerName: string }) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/projects" />}>Projects</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{ownerName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Copy link to this view">
          <LinkIcon />
        </Button>
        <Button>
          <PlusIcon data-icon="inline-start" />
          New project
        </Button>
      </div>
    </header>
  )
}

function EmptyResults({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <FolderSearchIcon className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">No projects found</p>
      <p className="text-xs text-muted-foreground">
        {query.trim() ? `Nothing matches “${query.trim()}”.` : 'This owner has no projects yet.'}
      </p>
    </div>
  )
}

export function ProjectsView({ initialOwnerId = null }: ProjectsViewProps) {
  const [ownerId, setOwnerId] = useState<string | null>(initialOwnerId)
  const [query, setQuery] = useState('')
  const owner = PROJECT_OWNERS.find((candidate) => candidate.id === ownerId)
  const projects = filterProjects({ projects: PROJECTS, ownerId, query })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ProjectsHeader ownerName={owner?.name ?? 'All projects'} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] items-start gap-8 px-6 py-8">
          <OwnerList
            owners={PROJECT_OWNERS}
            selectedId={ownerId}
            query={query}
            onQueryChange={setQuery}
            onSelect={setOwnerId}
          />
          <div className="min-w-0 flex-1">
            {projects.length === 0 ? (
              <EmptyResults query={query} />
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {projects.map((project) => (
                  <ProjectRow key={project.id} project={project} showOwner={ownerId === null} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
