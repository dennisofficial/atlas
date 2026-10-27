'use client'

import { useState } from 'react'

import {
  CURRENT_MEMBER_ID,
  INVITE_EXPIRY_DAYS,
  PENDING_INVITES,
  WORKSPACE_MEMBERS,
  WORKSPACE_PROFILE,
  type EWorkspaceRole,
  type PendingInvite,
  type WorkspaceMember,
} from '../fixtures/settings-workspace'
import { WorkspaceInviteDialog } from '../parts/workspace-invite-dialog'
import {
  ALL_ROLES,
  WorkspaceMembersTable,
  WorkspaceMembersToolbar,
} from '../parts/workspace-members-table'
import { WorkspacePendingInvites } from '../parts/workspace-pending-invites'
import { SettingsPage, SettingsSection } from '../settings-layout'

function matchesFilters({
  member,
  needle,
  roleFilter,
}: {
  member: WorkspaceMember
  needle: string
  roleFilter: string
}): boolean {
  const matchesRole = roleFilter === ALL_ROLES || member.role === roleFilter
  const matchesQuery =
    needle === '' ||
    member.name.toLowerCase().includes(needle) ||
    member.email.toLowerCase().includes(needle)
  return matchesRole && matchesQuery
}

export function WorkspaceMembersPage() {
  const [members, setMembers] = useState<WorkspaceMember[]>(WORKSPACE_MEMBERS)
  const [invites, setInvites] = useState<PendingInvite[]>(PENDING_INVITES)
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState(ALL_ROLES)
  const workspaceName = WORKSPACE_PROFILE.name
  const inviter = members.find((member) => member.id === CURRENT_MEMBER_ID)
  const needle = query.trim().toLowerCase()
  const visible = members.filter((member) => matchesFilters({ member, needle, roleFilter }))

  const handleInvite = ({ emails, role }: { emails: string[]; role: EWorkspaceRole }) =>
    setInvites((current) => [
      ...current,
      ...emails.map((email) => ({
        id: `invite-${email}`,
        email,
        role,
        invitedBy: inviter?.name ?? '—',
        expiresInDays: INVITE_EXPIRY_DAYS,
      })),
    ])
  const handleRoleChange = ({ id, role }: { id: string; role: EWorkspaceRole }) =>
    setMembers((current) =>
      current.map((member) => (member.id === id ? { ...member, role } : member)),
    )
  const handleRemove = (id: string) =>
    setMembers((current) => current.filter((member) => member.id !== id))
  const handleResend = (id: string) =>
    setInvites((current) =>
      current.map((invite) =>
        invite.id === id ? { ...invite, expiresInDays: INVITE_EXPIRY_DAYS } : invite,
      ),
    )
  const handleRevoke = (id: string) =>
    setInvites((current) => current.filter((invite) => invite.id !== id))

  return (
    <SettingsPage
      title="Members"
      description={`Manage who can access ${workspaceName} and what they can do.`}
      actions={<WorkspaceInviteDialog workspaceName={workspaceName} onInvite={handleInvite} />}
    >
      <SettingsSection
        title="Members"
        description={`${members.length} ${members.length === 1 ? 'person' : 'people'} in this workspace.`}
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
          onRoleChange={handleRoleChange}
          onRemove={handleRemove}
        />
      </SettingsSection>
      <WorkspacePendingInvites invites={invites} onResend={handleResend} onRevoke={handleRevoke} />
    </SettingsPage>
  )
}
