import { UNREACHABLE } from './auth-api'

export class OrganizationApiError extends Error {}

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
  throw new OrganizationApiError(message)
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
}): Promise<void> {
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
