'use client'

import { FolderGit2Icon, FolderXIcon } from 'lucide-react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'
import type { Project } from '@dltech/atlas-wire/web'

const NO_PROJECT = '__no-project__'
export const NO_PROJECT_LABEL = 'No project'

export function projectSelectItemsOf(projects: readonly Project[]) {
  return [
    { value: NO_PROJECT, label: NO_PROJECT_LABEL },
    ...projects.map((project) => ({ value: project.id, label: project.name })),
  ]
}

export function ProjectSelect({
  projects,
  projectId,
  onProjectChange,
}: {
  projects: readonly Project[]
  projectId: string | null
  onProjectChange: (projectId: string | null) => void
}) {
  const items = projectSelectItemsOf(projects)
  const handleValueChange = (next: string | null) => {
    if (next !== null) onProjectChange(next === NO_PROJECT ? null : next)
  }
  return (
    <Select items={items} value={projectId ?? NO_PROJECT} onValueChange={handleValueChange}>
      <SelectTrigger size="sm" variant="ghost" aria-label="Project" className="max-w-56 min-w-0">
        {projectId === null ? <FolderXIcon /> : <FolderGit2Icon />}
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
