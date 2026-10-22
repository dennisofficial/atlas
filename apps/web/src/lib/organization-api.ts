import { UNREACHABLE } from './auth-api'

export enum EOrganizationErrorCode {
  NotInvitationRecipient = 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION',
}

export class OrganizationApiError extends Error {
  readonly code: string | undefined

  constructor(message: string, options: { code?: string | undefined } = {}) {
    super(message)
    this.code = options.code
  }
}

export const isWrongRecipientError = (cause: unknown): boolean =>
  cause instanceof OrganizationApiError && cause.code === EOrganizationErrorCode.NotInvitationRecipient

export type Organization = {
  id: string
  name: string
  slug: string
}

type SessionBody = { session?: { activeOrganizationId?: string } | null } | null

const readBody = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json().catch(() => ({}))) as Record<string, unknown>

const failWith = async (response: Response, fallback: string): Promise<never> => {
  const body = await readBody(response)
  const message = typeof body.message === 'string' ? body.message : fallback
  throw new OrganizationApiError(message, {
    code: typeof body.code === 'string' ? body.code : undefined,
  })
}

export async function activeOrganizationId(): Promise<string | null> {
  let response: Response
  try {
    response = await fetch('/api/auth/get-session')
  } catch {
    throw new OrganizationApiError(UNREACHABLE)
  }
  if (!response.ok) return null

  const body = (await response.json().catch(() => null)) as SessionBody
  return body?.session?.activeOrganizationId ?? null
}

export async function listOrganizations(): Promise<Organization[]> {
  let response: Response
  try {
    response = await fetch('/api/auth/organization/list')
  } catch {
    throw new OrganizationApiError(UNREACHABLE)
  }
  if (!response.ok) await failWith(response, 'Could not load organizations')
  return (await response.json()) as Organization[]
}

export async function createOrganization(args: {
  name: string
  slug: string
}): Promise<string> {
  let response: Response
  try {
    response = await fetch('/api/auth/organization/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: args.name, slug: args.slug }),
    })
  } catch {
    throw new OrganizationApiError(UNREACHABLE)
  }
  if (!response.ok) await failWith(response, 'Could not create the organization')
  const body = await readBody(response)
  if (typeof body.id !== 'string') throw new OrganizationApiError('Could not create the organization')
  return body.id
}

export async function setActiveOrganization(args: {
  organizationId: string
}): Promise<void> {
  let response: Response
  try {
    response = await fetch('/api/auth/organization/set-active', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId: args.organizationId }),
    })
  } catch {
    throw new OrganizationApiError(UNREACHABLE)
  }
  if (!response.ok) await failWith(response, 'Could not switch organizations')
}

export type Invitation = {
  id: string
  organizationId: string
  organizationName: string
  inviterEmail: string
  role: string
  email: string
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')

export async function getInvitation(invitationId: string): Promise<Invitation> {
  let response: Response
  try {
    response = await fetch(`/api/auth/organization/get-invitation?id=${encodeURIComponent(invitationId)}`)
  } catch {
    throw new OrganizationApiError(UNREACHABLE)
  }
  if (!response.ok) await failWith(response, 'This invitation is not available')
  const body = await readBody(response)
  return {
    id: textOf(body.id),
    organizationId: textOf(body.organizationId),
    organizationName: textOf(body.organizationName),
    inviterEmail: textOf(body.inviterEmail),
    role: textOf(body.role),
    email: textOf(body.email),
  }
}

const answerInvitation = async (args: {
  action: 'accept-invitation' | 'reject-invitation'
  invitationId: string
}): Promise<void> => {
  let response: Response
  try {
    response = await fetch(`/api/auth/organization/${args.action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invitationId: args.invitationId }),
    })
  } catch {
    throw new OrganizationApiError(UNREACHABLE)
  }
  if (!response.ok) await failWith(response, 'Could not answer the invitation')
}

export const acceptInvitation = (invitationId: string): Promise<void> =>
  answerInvitation({ action: 'accept-invitation', invitationId })

export const rejectInvitation = (invitationId: string): Promise<void> =>
  answerInvitation({ action: 'reject-invitation', invitationId })
