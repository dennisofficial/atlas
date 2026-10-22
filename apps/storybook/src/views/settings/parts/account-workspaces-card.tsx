import { Badge } from '@dltech/atlas-ui/components/badge'

import { EWorkspaceRole, WORKSPACE_MEMBERSHIPS } from '../../../fixtures/settings-account'
import { SettingsCard, SettingsRow, Mono } from '../settings-layout'

export function AccountWorkspacesCard() {
  return (
    <SettingsCard>
      {WORKSPACE_MEMBERSHIPS.map((workspace) => (
        <SettingsRow
          key={workspace.id}
          media={
            <div className="flex size-8 items-center justify-center rounded-md bg-muted text-sm font-semibold">
              {workspace.initial}
            </div>
          }
          title={
            <>
              {workspace.name}
              <Badge variant={workspace.role === EWorkspaceRole.Owner ? 'default' : 'secondary'}>
                {workspace.role}
              </Badge>
            </>
          }
          description={
            <>
              <Mono>{workspace.memberCount}</Mono> members
            </>
          }
        />
      ))}
    </SettingsCard>
  )
}
