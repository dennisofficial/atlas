import type { Project } from '@dltech/atlas-wire/web'

import { NewProjectDialog } from './new-project-dialog'

export function NewProjectHost({
  open,
  onOpenChange,
  projects,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: readonly Project[]
}) {
  return <NewProjectDialog open={open} onOpenChange={onOpenChange} projects={projects} />
}
