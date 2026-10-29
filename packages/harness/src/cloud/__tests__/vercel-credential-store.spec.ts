import { describe, expect, it } from 'bun:test'

import type { CloudClient } from '../cloud-client'
import { VercelCredentialStore } from '../vercel-credential-store'

const fakeClient = () => {
  const saves: unknown[] = []
  let removed = 0
  let wire = {
    configured: false,
    teamId: null as string | null,
    vercelProjectId: null as string | null,
    updatedAt: null,
  }
  const client = {
    readVercel: async () => wire,
    saveVercel: async (input: { teamId: string; vercelProjectId: string }) => {
      saves.push(input)
      wire = {
        configured: true,
        teamId: input.teamId,
        vercelProjectId: input.vercelProjectId,
        updatedAt: null,
      }
    },
    removeVercel: async () => {
      removed += 1
      wire = { configured: false, teamId: null, vercelProjectId: null, updatedAt: null }
    },
  } as unknown as CloudClient
  return { client, saves, removed: () => removed }
}

describe('VercelCredentialStore', () => {
  it('is signed out without a client and does nothing', async () => {
    const store = new VercelCredentialStore(() => null)
    expect(store.signedIn()).toBe(false)
    await store.update({ token: 't' })
    expect(store.snapshot().configured).toBe(false)
  })

  it('holds fields until the token, team and project are all present, then saves once', async () => {
    const { client, saves } = fakeClient()
    const store = new VercelCredentialStore(() => client)
    await store.update({ teamId: 'team_1' })
    await store.update({ token: 'tok' })
    expect(saves).toEqual([])
    await store.update({ projectId: 'prj_1' })
    expect(saves).toEqual([{ teamId: 'team_1', vercelProjectId: 'prj_1', token: 'tok' }])
    expect(store.snapshot()).toEqual({
      configured: true,
      tokenSet: true,
      teamId: 'team_1',
      projectId: 'prj_1',
    })
  })

  it('edits team without resending the token once configured', async () => {
    const { client, saves } = fakeClient()
    const store = new VercelCredentialStore(() => client)
    await store.update({ token: 'tok', teamId: 'a', projectId: 'p' })
    await store.update({ teamId: 'b' })
    expect(saves[1]).toEqual({ teamId: 'b', vercelProjectId: 'p' })
  })

  it('clears through the resource', async () => {
    const { client, removed } = fakeClient()
    const store = new VercelCredentialStore(() => client)
    await store.update({ token: 'tok', teamId: 'a', projectId: 'p' })
    await store.clear()
    expect(removed()).toBe(1)
    expect(store.snapshot().configured).toBe(false)
  })

  it('reports a failed save instead of swallowing it', async () => {
    const { client } = fakeClient()
    const failing = {
      ...client,
      readVercel: client.readVercel.bind(client),
      saveVercel: async () => {
        throw new Error('boom')
      },
    } as unknown as CloudClient
    const store = new VercelCredentialStore(() => failing)

    expect(await store.update({ token: 'tok', teamId: 'a', projectId: 'p' })).toEqual({
      ok: false,
      message: 'boom',
    })
  })

  it('refuses an empty team or project with a short message', async () => {
    const { client, saves } = fakeClient()
    const store = new VercelCredentialStore(() => client)
    await store.update({ token: 'tok', teamId: 'a', projectId: 'p' })

    expect(await store.update({ teamId: '' })).toEqual({ ok: false, message: 'Team ID required' })
    expect(await store.update({ projectId: '  ' })).toEqual({
      ok: false,
      message: 'Project ID required',
    })
    expect(saves).toHaveLength(1)
    expect(store.snapshot().teamId).toBe('a')
  })

  it('reports ok while fields are still being collected', async () => {
    const { client } = fakeClient()
    const store = new VercelCredentialStore(() => client)

    expect(await store.update({ teamId: 'a' })).toEqual({ ok: true })
  })

  it('reports a failed clear', async () => {
    const store = new VercelCredentialStore(
      () =>
        ({
          readVercel: async () => ({ configured: false }),
          removeVercel: async () => {
            throw new Error('nope')
          },
        }) as unknown as CloudClient,
    )

    expect(await store.clear()).toEqual({ ok: false, message: 'nope' })
  })
})
