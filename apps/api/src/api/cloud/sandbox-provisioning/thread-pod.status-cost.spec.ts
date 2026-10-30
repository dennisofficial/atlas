import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, setSystemTime, spyOn, vi } from 'bun:test'
import { seedSandboxRow, seedThreadRow, seedUsers } from '../../../../test/session-seed'
import type { VercelSandboxClient } from '../../platform/sandboxes/vercel-sandbox.client'
import * as sessionOf from '../../platform/sessions/session-of-thread'
import { podServiceOver, realEndpoints } from './thread-pod.fixture'

const scope = { userId: 'usr-1', threadId: 'thr-1' }

const vercelCounting = () => {
  const readResources = vi.fn(async () => ({ vcpus: 2, memoryMb: 4096 }))
  return {
    readResources,
    vercel: { inspect: vi.fn(), readResources } as unknown as VercelSandboxClient,
  }
}

describe('ThreadPodService status cost', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers('usr-1')
    await seedThreadRow({ id: 'thr-1', userId: 'usr-1' })
    await seedSandboxRow({ threadId: 'thr-1', userId: 'usr-1', sandboxId: 'sbx-9' })
  })

  afterEach(() => {
    setSystemTime()
    vi.restoreAllMocks()
  })

  it('reads Vercel once and answers repeat reads from the cache', async () => {
    const { readResources, vercel } = vercelCounting()
    const service = podServiceOver(realEndpoints(), vercel)

    const first = await service.status(scope)
    const second = await service.status(scope)
    const third = await service.status(scope)

    expect(readResources).toHaveBeenCalledTimes(1)
    expect(second.resources).toEqual(first.resources)
    expect(third.resources).toMatchObject({ sandboxId: 'sbx-9', vcpus: 2, memoryMb: 4096 })
  })

  it('serves the stale size while an expired entry refreshes off the request path', async () => {
    const { readResources, vercel } = vercelCounting()
    const service = podServiceOver(realEndpoints(), vercel)
    await service.status(scope)
    let release: () => void = () => undefined
    readResources.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ vcpus: 4, memoryMb: 8192 })
        }),
    )
    setSystemTime(new Date(Date.now() + 120_000))

    const stale = await service.status(scope)
    expect(stale.resources?.vcpus).toBe(2)
    expect(readResources).toHaveBeenCalledTimes(2)
    release()
    await Promise.resolve()
    await Promise.resolve()

    expect((await service.status(scope)).resources?.vcpus).toBe(4)
    expect(readResources).toHaveBeenCalledTimes(2)
  })

  it('resolves the pod session once per request', async () => {
    const { vercel } = vercelCounting()
    const podSession = spyOn(sessionOf, 'podSessionOf')
    const bootStepReads = spyOn(db.orm.public.SandboxBootStep, 'where')

    await podServiceOver(realEndpoints(), vercel).status(scope)

    expect(podSession).toHaveBeenCalledTimes(1)
    expect(bootStepReads).toHaveBeenCalledTimes(1)
  })
})
