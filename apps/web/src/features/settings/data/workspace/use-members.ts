'use client'

import { useCallback } from 'react'

import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import {
  cancelInvitation,
  inviteMember,
  listInvitations,
  listMembers,
  removeMember,
  updateMemberRole,
  type InvitationRecord,
  type MemberRecord,
} from './members-api'
import { isPending } from './members-mapping'

export type MembersSnapshot = {
  members: MemberRecord[]
  invitations: InvitationRecord[]
  fetchedAt: number
}

export type MembersResource = {
  query: CloudQuery<MembersSnapshot>
  invite: (args: { emails: string[]; role: string }) => Promise<void>
  resend: (invitation: InvitationRecord) => Promise<void>
  revoke: (invitationId: string) => Promise<void>
  changeRole: (args: { memberId: string; role: string }) => Promise<void>
  remove: (memberId: string) => Promise<void>
}

export function useMembers(organizationId: string): MembersResource {
  const load = useCallback(async (): Promise<MembersSnapshot> => {
    const [members, invitations] = await Promise.all([
      listMembers(organizationId),
      listInvitations(organizationId),
    ])
    return { members, invitations: invitations.filter(isPending), fetchedAt: Date.now() }
  }, [organizationId])
  const query = useCloudQuery({ key: `members:${organizationId}`, load })
  const { reload } = query

  const invite = useCallback(
    async (args: { emails: string[]; role: string }) => {
      try {
        for (const email of args.emails) {
          await inviteMember({ email, role: args.role, organizationId })
        }
      } finally {
        reload()
      }
    },
    [organizationId, reload],
  )
  const resend = useCallback(
    async (invitation: InvitationRecord) => {
      await inviteMember({
        email: invitation.email,
        role: invitation.role ?? 'member',
        organizationId,
        resend: true,
      })
      reload()
    },
    [organizationId, reload],
  )
  const revoke = useCallback(
    async (invitationId: string) => {
      await cancelInvitation(invitationId)
      reload()
    },
    [reload],
  )
  const changeRole = useCallback(
    async (args: { memberId: string; role: string }) => {
      await updateMemberRole({ ...args, organizationId })
      reload()
    },
    [organizationId, reload],
  )
  const remove = useCallback(
    async (memberId: string) => {
      await removeMember({ memberIdOrEmail: memberId, organizationId })
      reload()
    },
    [organizationId, reload],
  )
  return { query, invite, resend, revoke, changeRole, remove }
}
