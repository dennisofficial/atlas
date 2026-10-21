import {
  EWorkspaceRole,
  type PendingInvite,
  type WorkspaceMember,
} from '@/features/settings/fixtures/settings-workspace'
import { initialsOf } from '@/features/settings/session/initials'

import type { InvitationRecord, MemberRecord } from './members-api'
import { daysUntil, formatDate } from './relative-time'
import { parseMemberRole } from './workspace-role'

const UNKNOWN = '—'
const PENDING = 'pending'

export function workspaceMemberOf(record: MemberRecord): WorkspaceMember {
  const name = record.user.name === '' ? record.user.email : record.user.name
  return {
    id: record.id,
    userId: record.userId,
    name,
    email: record.user.email,
    initials: initialsOf(name),
    role: parseMemberRole(record.role) ?? EWorkspaceRole.Member,
    joined: formatDate(record.createdAt),
    lastActive: UNKNOWN,
  }
}

export function pendingInviteOf({
  invitation,
  members,
  now,
}: {
  invitation: InvitationRecord
  members: readonly MemberRecord[]
  now: number
}): PendingInvite {
  const inviter = members.find((member) => member.userId === invitation.inviterId)
  return {
    id: invitation.id,
    email: invitation.email,
    role: parseMemberRole(invitation.role ?? '') ?? EWorkspaceRole.Member,
    invitedBy: inviter?.user.name ?? UNKNOWN,
    expiresInDays: daysUntil({ iso: invitation.expiresAt, now }),
  }
}

export const isPending = (invitation: InvitationRecord): boolean => invitation.status === PENDING
