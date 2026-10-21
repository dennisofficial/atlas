import { z } from 'zod'

import { cloudJson, cloudSend, EHttpMethod } from '@/lib/cloud-api'

const AUTH = '/api/auth/organization'

const memberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: z.string(),
  createdAt: z.string(),
  user: z.object({ name: z.string(), email: z.string() }),
})
export type MemberRecord = z.infer<typeof memberSchema>

const invitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string().nullish(),
  status: z.string(),
  expiresAt: z.string(),
  inviterId: z.string(),
})
export type InvitationRecord = z.infer<typeof invitationSchema>

const membersSchema = z.object({ members: z.array(memberSchema) })
const invitationsSchema = z.array(invitationSchema)

const query = (organizationId: string) => `organizationId=${encodeURIComponent(organizationId)}`

const post = ({ path, body }: { path: string; body: unknown }) =>
  cloudSend({ method: EHttpMethod.Post, path: `${AUTH}/${path}`, body })

export async function listMembers(organizationId: string): Promise<MemberRecord[]> {
  const body = await cloudJson({
    method: EHttpMethod.Get,
    path: `${AUTH}/list-members?${query(organizationId)}`,
    schema: membersSchema,
  })
  return body.members
}

export const listInvitations = (organizationId: string): Promise<InvitationRecord[]> =>
  cloudJson({
    method: EHttpMethod.Get,
    path: `${AUTH}/list-invitations?${query(organizationId)}`,
    schema: invitationsSchema,
  })

export const inviteMember = (args: {
  email: string
  role: string
  organizationId: string
  resend?: boolean
}) => post({ path: 'invite-member', body: args })

export const updateMemberRole = (args: {
  memberId: string
  role: string
  organizationId: string
}) => post({ path: 'update-member-role', body: args })

export const removeMember = (args: { memberIdOrEmail: string; organizationId: string }) =>
  post({ path: 'remove-member', body: args })

export const cancelInvitation = (invitationId: string) =>
  post({ path: 'cancel-invitation', body: { invitationId } })
