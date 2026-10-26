import { EPodResizeApplies } from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { seedSandboxRow, seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { SandboxMissingError } from '../../platform/sandboxes/vercel-sandbox.client'
import type { VercelSandboxClient } from '../../platform/sandboxes/vercel-sandbox.client'
import { podServiceOver, realEndpoints } from './thread-pod.fixture'

const vercelWith = (overrides: Partial<Record<'readResources' | 'updateResources', unknown>>) =>
  ({
    inspect: vi.fn(),
    readResources: vi.fn(async () => ({ vcpus: 2, memoryMb: 4096 })),
    updateResources: vi.fn(async () => undefined),
    ...overrides,
  }) as unknown as VercelSandboxClient

const scope = { userId: 'usr-1', threadId: 'thr-1' }

describe('ThreadPodService resources', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers('usr-1', 'usr-2')
    await seedThreadRow({ id: 'thr-1', userId: 'usr-1' })
  })

  it('omits resources for a thread that never had a pod', async () => {
    const pod = await podServiceOver(realEndpoints(), vercelWith({})).status(scope)

    expect(pod.resources).toBeUndefined()
  })

  it('merges the row identity with the live and pending size', async () => {
    await seedSandboxRow({
      threadId: 'thr-1',
      userId: 'usr-1',
      sandboxId: 'sbx-9',
      region: 'sfo1',
    })
    const vercel = vercelWith({
      readResources: vi.fn(async () => ({
        vcpus: 2,
        memoryMb: 4096,
        pendingVcpus: 4,
      })),
    })

    const pod = await podServiceOver(realEndpoints(), vercel).status(scope)

    expect(pod.resources).toEqual({
      sandboxId: 'sbx-9',
      region: 'sfo1',
      vcpus: 2,
      memoryMb: 4096,
      pendingVcpus: 4,
    })
  })

  it('keeps the row identity when Vercel cannot be read', async () => {
    await seedSandboxRow({
      threadId: 'thr-1',
      userId: 'usr-1',
      sandboxId: 'sbx-9',
    })
    const vercel = vercelWith({
      readResources: vi.fn(async () => {
        throw new Error('vercel is down')
      }),
    })

    const pod = await podServiceOver(realEndpoints(), vercel).status(scope)

    expect(pod.resources).toEqual({ sandboxId: 'sbx-9', region: 'iad1' })
  })

  it('resizes through Vercel and says it applies at the next wake', async () => {
    const row = await seedSandboxRow({ threadId: 'thr-1', userId: 'usr-1' })
    const updateResources = vi.fn(async () => undefined)
    const service = podServiceOver(realEndpoints(), vercelWith({ updateResources }))

    const reply = await service.resize({ ...scope, vcpus: 4 })

    expect(reply).toEqual({ vcpus: 4, appliesAt: EPodResizeApplies.Restart })
    expect(updateResources).toHaveBeenCalledWith({
      threadId: 'thr-1',
      name: row.name,
      vcpus: 4,
    })
  })

  it('answers 404 resizing a thread with no pod, another user, or a vanished sandbox', async () => {
    const service = podServiceOver(realEndpoints(), vercelWith({}))
    await expect(service.resize({ ...scope, vcpus: 4 })).rejects.toMatchObject({
      status: 404,
    })

    await seedSandboxRow({ threadId: 'thr-1', userId: 'usr-1' })
    await expect(
      service.resize({ userId: 'usr-2', threadId: 'thr-1', vcpus: 4 }),
    ).rejects.toMatchObject({
      status: 404,
    })

    const gone = podServiceOver(
      realEndpoints(),
      vercelWith({
        updateResources: vi.fn(async () => {
          throw new SandboxMissingError('atlas-thread-thr-1')
        }),
      }),
    )
    await expect(gone.resize({ ...scope, vcpus: 4 })).rejects.toMatchObject({
      status: 404,
    })
  })
})
