import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, setSystemTime, spyOn, vi } from 'bun:test'
import { seedSandboxRow, seedThreadRow, seedUsers } from '../../../../test/session-seed'
import type { VercelSandboxClient } from '../../platform/sandboxes/vercel-sandbox.client'
import * as sessionOf from '../../platform/sessions/session-of-thread'
import * as bootSteps from '../../platform/sandboxes/sandbox-boot-steps'
import { EPodState } from '@dltech/atlas-wire'
import { readPodFrame } from '../../platform/sessions/pod-snapshot'
import { inertSignals } from '../../platform/sessions/thread-signals.fixture'
import { podLaunchWith } from './sandbox-provisioning.fixture'
import { podServiceOver, RecordingBackground, realEndpoints } from './thread-pod.fixture'

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
    const background = new RecordingBackground()
    const service = podServiceOver(
      realEndpoints(),
      vercel,
      podLaunchWith().pod,
      inertSignals(),
      background,
    )
    await service.status(scope)
    expect(background.kept).toHaveLength(0)
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
    expect(background.kept).toHaveLength(1)
    release()
    await Promise.all(background.kept)

    expect((await service.status(scope)).resources?.vcpus).toBe(4)
    expect(readResources).toHaveBeenCalledTimes(2)
  })

  it('returns the coherent current revision with resources after an older publication was captured', async () => {
    await db.orm.public.Thread.where({ id: 'thr-1' }).update({ rev: 4 })
    await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr-1' }).update({
      state: 'resuming',
      wakeClaim: new Date(),
    })
    const delayed = await readPodFrame({ threadId: 'thr-1', bumpRev: true })
    expect(delayed).toMatchObject({ rev: 5, status: { state: EPodState.Booting, rev: 5 } })
    await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr-1' }).update({
      state: 'running',
      serveUrl: 'https://serve.example.test',
      wakeClaim: null,
    })
    await readPodFrame({ threadId: 'thr-1', bumpRev: true })
    const { vercel } = vercelCounting()
    const current = await podServiceOver(realEndpoints(), vercel).status(scope)
    expect(current).toMatchObject({
      state: EPodState.Running,
      rev: 6,
      resources: { sandboxId: 'sbx-9', vcpus: 2 },
    })
    expect(current.rev).toBeGreaterThan(delayed.rev)
    expect((await db.orm.public.Thread.where({ id: 'thr-1' }).all().firstOrThrow()).rev).toBe(6)
  })

  it('resolves the pod session once per request', async () => {
    const { vercel } = vercelCounting()
    const podSession = spyOn(sessionOf, 'podSessionOf')
    const readSteps = bootSteps.readBootSteps
    let stepQueryCount = 0
    const bootStepReads = spyOn(bootSteps, 'readBootSteps').mockImplementation(async (args) => {
      const reader = args.reader ?? db
      const queries = spyOn(reader.orm.public.SandboxBootStep, 'where')
      try {
        return await readSteps(args)
      } finally {
        stepQueryCount += queries.mock.calls.length
        queries.mockRestore()
      }
    })

    await podServiceOver(realEndpoints(), vercel).status(scope)

    expect(podSession).toHaveBeenCalledTimes(1)
    expect(bootStepReads).toHaveBeenCalledTimes(1)
    expect(stepQueryCount).toBe(1)
  })
})
