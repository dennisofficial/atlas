import { useMemo } from 'react'

import type { Project } from '@dltech/atlas-wire/web'

import { useOrganizations } from '@/features/project-settings/data/use-organizations'
import { PERSONAL_WORKSPACE_VALUE } from '@/features/project-settings/data/project-mapping'
import { EQueryState } from '@/lib/use-cloud-query'
import { useActiveWorkspace } from '@/lib/use-active-workspace'

import { NewProjectDialog } from './new-project-dialog'
import { ownerOptionsOf } from './project-owner'

export function NewProjectHost({
  open,
  onOpenChange,
  projects,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: readonly Project[]
}) {
  const organizations = useOrganizations()
  const workspace = useActiveWorkspace()
  const owners = useMemo(() => ownerOptionsOf(organizations.data ?? []), [organizations.data])
  const loading =
    organizations.state === EQueryState.Loading || workspace.state === EQueryState.Loading
  if (loading) return null
  return (
    <NewProjectDialog
      open={open}
      onOpenChange={onOpenChange}
      projects={projects}
      owners={owners}
      defaultOwnerId={workspace.data?.id ?? PERSONAL_WORKSPACE_VALUE}
    />
  )
}
