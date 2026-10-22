import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  acceptInvitation,
  activeOrganizationId,
  createOrganization,
  getInvitation,
  isWrongRecipientError,
  listOrganizations,
  rejectInvitation,
  OrganizationApiError,
  setActiveOrganization,
} from '../organization-api'

let fetchCalls: { url: string; init?: RequestInit }[]
const realFetch = globalThis.fetch

const answerWith = (response: Response): void => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), ...(init === undefined ? {} : { init }) })
    return response
  }) as typeof fetch
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  fetchCalls = []
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('activeOrganizationId', () => {
  it('reads the active organization id off the session', async () => {
    answerWith(json({ session: { activeOrganizationId: 'org-1' }, user: { id: 'u' } }))

    expect(await activeOrganizationId()).toBe('org-1')
    expect(fetchCalls[0]?.url).toBe('/api/auth/get-session')
  })

  it('answers null when no organization is active', async () => {
    answerWith(json({ session: { activeOrganizationId: null }, user: { id: 'u' } }))

    expect(await activeOrganizationId()).toBeNull()
  })

  it('answers null when the session response is not ok', async () => {
    answerWith(json({}, 401))

    expect(await activeOrganizationId()).toBeNull()
  })
})

describe('listOrganizations', () => {
  it('returns the organizations', async () => {
    answerWith(json([{ id: 'org-1', name: 'Acme', slug: 'acme' }]))

    const organizations = await listOrganizations()

    expect(fetchCalls[0]?.url).toBe('/api/auth/organization/list')
    expect(organizations[0]?.slug).toBe('acme')
  })

  it('raises OrganizationApiError on failure', async () => {
    answerWith(json({ message: 'unauthorized' }, 401))

    await expect(listOrganizations()).rejects.toMatchObject({ message: 'unauthorized' })
  })
})

describe('createOrganization', () => {
  it('posts the name and slug', async () => {
    answerWith(json({ id: 'org-1' }))

    await createOrganization({ name: 'Acme', slug: 'acme' })

    expect(fetchCalls[0]?.url).toBe('/api/auth/organization/create')
    expect(fetchCalls[0]?.init?.method).toBe('POST')
    expect(fetchCalls[0]?.init?.body).toBe(JSON.stringify({ name: 'Acme', slug: 'acme' }))
  })

  it('surfaces a slug conflict', async () => {
    answerWith(json({ message: 'slug is taken' }, 422))

    await expect(createOrganization({ name: 'Acme', slug: 'acme' })).rejects.toBeInstanceOf(
      OrganizationApiError,
    )
  })
})

describe('setActiveOrganization', () => {
  it('posts the organization id', async () => {
    answerWith(json({ id: 'org-1' }))

    await setActiveOrganization({ organizationId: 'org-1' })

    expect(fetchCalls[0]?.url).toBe('/api/auth/organization/set-active')
    expect(fetchCalls[0]?.init?.method).toBe('POST')
    expect(fetchCalls[0]?.init?.body).toBe(JSON.stringify({ organizationId: 'org-1' }))
  })

  it('falls back to the fixed message on failure', async () => {
    answerWith(json({}, 403))

    await expect(setActiveOrganization({ organizationId: 'org-1' })).rejects.toMatchObject({
      message: 'Could not switch organizations',
    })
  })
})

describe('getInvitation', () => {
  it('reads the invitation by encoded id', async () => {
    answerWith(
      json({
        id: 'inv 1',
        organizationId: 'org-1',
        organizationName: 'Acme',
        inviterEmail: 'boss@acme.dev',
        role: 'member',
        email: 'me@acme.dev',
        status: 'pending',
      }),
    )

    const invitation = await getInvitation('inv 1')

    expect(fetchCalls[0]?.url).toBe('/api/auth/organization/get-invitation?id=inv%201')
    expect(invitation).toMatchObject({
      organizationName: 'Acme',
      inviterEmail: 'boss@acme.dev',
      role: 'member',
      organizationId: 'org-1',
    })
  })

  it('flags an invitation addressed to another account', async () => {
    answerWith(
      json({ code: 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION', message: 'not yours' }, 403),
    )

    const failure = await getInvitation('x').catch((cause: unknown) => cause)

    expect(isWrongRecipientError(failure)).toBe(true)
  })

  it('raises with the server message when the invitation is gone', async () => {
    answerWith(json({ message: 'Invitation not found!' }, 400))

    await expect(getInvitation('x')).rejects.toMatchObject({ message: 'Invitation not found!' })
  })
})

describe('accepting and rejecting invitations', () => {
  it('posts the invitation id to accept-invitation', async () => {
    answerWith(json({}))

    await acceptInvitation('inv-1')

    expect(fetchCalls[0]?.url).toBe('/api/auth/organization/accept-invitation')
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toEqual({ invitationId: 'inv-1' })
  })

  it('posts the invitation id to reject-invitation', async () => {
    answerWith(json({}))

    await rejectInvitation('inv-1')

    expect(fetchCalls[0]?.url).toBe('/api/auth/organization/reject-invitation')
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toEqual({ invitationId: 'inv-1' })
  })

  it('raises when the answer is not ok', async () => {
    answerWith(json({ message: 'nope' }, 403))

    await expect(acceptInvitation('inv-1')).rejects.toMatchObject({ message: 'nope' })
  })
})
