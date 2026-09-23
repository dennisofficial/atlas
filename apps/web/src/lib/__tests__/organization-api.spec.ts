import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  activeOrganizationId,
  createOrganization,
  listOrganizations,
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
