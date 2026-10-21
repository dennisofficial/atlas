'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dltech/atlas-ui/components/select'

import { EQueryState } from '@/lib/use-cloud-query'

import {
  organizationIdOfValue,
  workspaceOptionsOf,
  workspaceValueOf,
} from './data/project-mapping'
import { useOrganizations } from './data/use-organizations'
import { SettingsRow } from './settings-layout'

export function WorkspaceRow({
  organizationId,
  onChange,
}: {
  organizationId: string | null
  onChange: (organizationId: string | null) => void
}) {
  const organizations = useOrganizations()
  const options = workspaceOptionsOf({
    organizations: organizations.state === EQueryState.Ready ? organizations.data : [],
    current: organizationId,
  })
  const failed = organizations.state === EQueryState.Failed
  const handleValueChange = (value: unknown) => {
    if (typeof value === 'string') onChange(organizationIdOfValue(value))
  }
  return (
    <SettingsRow
      title="Workspace"
      htmlFor="project-workspace"
      description={
        failed
          ? `Couldn't load your workspaces: ${organizations.error.message}`
          : 'The workspace this project belongs to. Members of the workspace can see it.'
      }
    >
      <Select
        items={options}
        value={workspaceValueOf(organizationId)}
        disabled={organizations.state === EQueryState.Loading}
        onValueChange={handleValueChange}
      >
        <SelectTrigger id="project-workspace" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  )
}
