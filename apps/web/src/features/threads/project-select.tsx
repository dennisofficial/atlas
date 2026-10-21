'use client'

import { FolderGit2Icon } from 'lucide-react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'
import type { Project } from '@dltech/atlas-wire/web'

export function ProjectSelect({
  projects,
  projectId,
  onProjectChange,
}: {
  projects: readonly Project[]
  projectId: string
  onProjectChange: (projectId: string) => void
}) {
  const items = projects.map((project) => ({ value: project.id, label: project.name }))
  const handleValueChange = (next: string | null) => {
    if (next !== null) onProjectChange(next)
  }
  return (
    <Select items={items} value={projectId} onValueChange={handleValueChange}>
      <SelectTrigger size="sm" aria-label="Project" className="max-w-56 min-w-0 border-0">
        <FolderGit2Icon />
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
