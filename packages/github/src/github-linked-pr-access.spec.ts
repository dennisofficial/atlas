import { stubGlobal, unstubAllGlobals } from '@dltech/bun-test-shims'
import { afterEach, describe, expect, it, setSystemTime, vi } from 'bun:test'
import { ELinkedPrAccess, LinkedPrAccess } from './github-linked-pr-access'
import { credentialFingerprint } from './github-request-budget'
import { localCoordinator } from './github-request-coordinator.fixture'
import {
  EGithubHttpCategory,
  GITHUB_AUTH_HTTP_BUDGET_PER_MINUTE,
} from './github-request-coordinator.types'
import type { GithubService } from './github.service'

const TOKEN = 'ghu-linked'
const OWNER = { userId: 'usr_1', repoFullName: 'Compai/App' }
const REPO = { userId: 'usr_1', repoFullName: 'compai/app' }

const githubWithToken = () => ({ findToken: async () => TOKEN }) as unknown as GithubService

const stubFetch = (status: number) => {
  const calls: string[] = []
  stubGlobal(
    'fetch',
    vi.fn(async (target: Parameters<typeof fetch>[0]) => {
      calls.push(String(target))
      return Response.json({}, { status })
    }),
  )
  return calls
}

const accessWith = () => {
  const github = githubWithToken()
  const coordinator = localCoordinator(github)
  return { coordinator, access: new LinkedPrAccess({ coordinator, github }) }
}

describe('LinkedPrAccess', () => {
  afterEach(() => {
    setSystemTime()
    unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('checks an unknown repo once, allows it, and remembers the answer', async () => {
    const calls = stubFetch(200)
    const { coordinator, access } = accessWith()

    await expect(access.check(OWNER)).resolves.toBe(ELinkedPrAccess.Allowed)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('/repos/compai/app')

    await expect(access.check(REPO)).resolves.toBe(ELinkedPrAccess.Allowed)
    expect(calls).toHaveLength(1)
    expect(await coordinator.deniedAccess(REPO)).toBe(false)
  })

  it('serves a granted repo without an access call however long the grant is held', async () => {
    const calls = stubFetch(200)
    const { access } = accessWith()

    await expect(access.check(REPO)).resolves.toBe(ELinkedPrAccess.Allowed)
    setSystemTime(new Date(Date.now() + 365 * 24 * 3_600_000))
    await expect(access.check(REPO)).resolves.toBe(ELinkedPrAccess.Allowed)

    expect(calls).toHaveLength(1)
  })

  it('denies a repo github answers 404 for and caches the denial', async () => {
    const calls = stubFetch(404)
    const { access } = accessWith()

    await expect(access.check(REPO)).resolves.toBe(ELinkedPrAccess.Denied)
    expect(calls).toHaveLength(1)

    await expect(access.check(REPO)).resolves.toBe(ELinkedPrAccess.Denied)
    expect(calls).toHaveLength(1)
  })

  it('parks a repo the authorization budget refuses as pending and records nothing', async () => {
    const calls = stubFetch(200)
    const { coordinator, access } = accessWith()
    const identity = {
      credentialFingerprint: credentialFingerprint(TOKEN),
      resource: 'core',
      category: EGithubHttpCategory.Authorization,
      source: 'repo-access',
    }
    for (let slot = 0; slot < GITHUB_AUTH_HTTP_BUDGET_PER_MINUTE; slot += 1)
      await coordinator.takeHttpSlot(identity)

    await expect(access.check(REPO)).resolves.toBe(ELinkedPrAccess.Pending)
    expect(calls).toEqual([])
    expect(await coordinator.provenAccess(REPO)).toBe(false)
    expect(await coordinator.deniedAccess(REPO)).toBe(false)
  })

  it('gathers concurrent checks of one repo into a single call', async () => {
    const calls = stubFetch(200)
    const { access } = accessWith()

    const verdicts = await Promise.all([access.check(REPO), access.check(OWNER)])

    expect(verdicts).toEqual([ELinkedPrAccess.Allowed, ELinkedPrAccess.Allowed])
    expect(calls).toHaveLength(1)
  })

  it('denies a repo when the user holds no github token', async () => {
    const calls = stubFetch(200)
    const github = { findToken: async () => undefined } as unknown as GithubService
    const coordinator = localCoordinator(github)
    const access = new LinkedPrAccess({ coordinator, github })

    await expect(access.check(REPO)).resolves.toBe(ELinkedPrAccess.Denied)
    expect(calls).toEqual([])
  })
})
