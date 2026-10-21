import { Badge } from '@dltech/atlas-ui/components/badge'

import type { Organization } from '@/lib/organization-api'

import { initialsOf } from '../session/initials'
import { SettingsCard, SettingsRow } from '../settings-layout'

export function AccountWorkspacesCard({ workspaces }: { workspaces: Organization[] }) {
  if (workspaces.length === 0) {
    return (
      <SettingsCard>
        <SettingsRow
          title="No workspaces yet"
          description="Create a workspace to share secrets and MCP servers with your team."
        />
      </SettingsCard>
    )
  }
  return (
    <SettingsCard>
      {workspaces.map((workspace) => (
        <SettingsRow
          key={workspace.id}
          media={
            <div className="flex size-8 items-center justify-center rounded-md bg-muted text-sm font-semibold">
              {initialsOf(workspace.name).charAt(0)}
            </div>
          }
          title={
            <>
              {workspace.name}
              <Badge variant="secondary">{workspace.slug}</Badge>
            </>
          }
        />
      ))}
    </SettingsCard>
  )
}
