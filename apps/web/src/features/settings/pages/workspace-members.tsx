'use client'

import { useState } from 'react'

import { QueryGate } from '../data/workspace/query-gate'
import { pendingInviteOf, workspaceMemberOf } from '../data/workspace/members-mapping'
import { runAction } from '../data/workspace/run-action'
import { useMembers } from '../data/workspace/use-members'
import type { WorkspaceAccess } from '../data/workspace/use-workspace-access'
import { pageWrapOf, WorkspaceGate } from '../data/workspace/workspace-gate'
import { describeAccess } from '../data/workspace/workspace-role'
import { type EWorkspaceRole } from '../fixtures/settings-workspace'
import { WorkspaceInviteDialog } from '../parts/workspace-invite-dialog'
import {
  ALL_ROLES,
  WorkspaceMembersTable,
  WorkspaceMembersToolbar,
} from '../parts/workspace-members-table'
import { WorkspacePendingInvites } from '../parts/workspace-pending-invites'
import { SettingsPage, SettingsSection } from '../settings-layout'

const TITLE = 'Members'

function LoadedMembers({ access }: { access: WorkspaceAccess }) {
  const members = useMembers(access.organization.id)
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState(ALL_ROLES)
  const workspaceName = access.organization.name
  const description = describeAccess({
    description: `Manage who can access ${workspaceName} and what they can do.`,
    canEdit: access.canEdit,
  })

  const handleInvite = ({ emails, role }: { emails: string[]; role: EWorkspaceRole }) =>
    runAction({
      work: () => members.invite({ emails, role }),
      success:
        emails.length === 1 ? 'Invitation recorded' : `${emails.length} invitations recorded`,
    })

  return (
    <QueryGate
      query={members.query}
      label="workspace members"
      wrap={pageWrapOf({ title: TITLE, description })}
    >
      {(snapshot) => {
        const rows = snapshot.members.map(workspaceMemberOf)
        const pending = snapshot.invitations.map((invitation) =>
          pendingInviteOf({ invitation, members: snapshot.members, now: snapshot.fetchedAt }),
        )
        const needle = query.trim().toLowerCase()
        const visible = rows.filter((member) => {
          const matchesRole = roleFilter === ALL_ROLES || member.role === roleFilter
          const matchesQuery =
            needle === '' ||
            member.name.toLowerCase().includes(needle) ||
            member.email.toLowerCase().includes(needle)
          return matchesRole && matchesQuery
        })
        const handleRoleChange = ({ id, role }: { id: string; role: EWorkspaceRole }) =>
          void runAction({
            work: () => members.changeRole({ memberId: id, role }),
            success: 'Role updated',
          })
        const handleRemove = (id: string) =>
          void runAction({ work: () => members.remove(id), success: 'Member removed' })
        const handleResend = (id: string) => {
          const invitation = snapshot.invitations.find((entry) => entry.id === id)
          if (invitation === undefined) return
          void runAction({
            work: () => members.resend(invitation),
            success: 'Invitation renewed',
          })
        }
        const handleRevoke = (id: string) =>
          void runAction({ work: () => members.revoke(id), success: 'Invitation revoked' })

        return (
          <SettingsPage
            title={TITLE}
            description={description}
            actions={
              <WorkspaceInviteDialog
                workspaceName={workspaceName}
                canEdit={access.canEdit}
                onInvite={handleInvite}
              />
            }
          >
            <SettingsSection
              title="Members"
              description={`${rows.length} ${rows.length === 1 ? 'person' : 'people'} in this workspace.`}
            >
              <WorkspaceMembersToolbar
                query={query}
                roleFilter={roleFilter}
                onQueryChange={setQuery}
                onRoleFilterChange={setRoleFilter}
              />
              <WorkspaceMembersTable
                members={visible}
                workspaceName={workspaceName}
                canEdit={access.canEdit}
                currentUserId={access.userId}
                onRoleChange={handleRoleChange}
                onRemove={handleRemove}
              />
            </SettingsSection>
            <WorkspacePendingInvites
              invites={pending}
              canEdit={access.canEdit}
              onResend={handleResend}
              onRevoke={handleRevoke}
            />
          </SettingsPage>
        )
      }}
    </QueryGate>
  )
}

export function WorkspaceMembersPage() {
  return (
    <WorkspaceGate title={TITLE}>{(access) => <LoadedMembers access={access} />}</WorkspaceGate>
  )
}
