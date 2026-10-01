import { describe, expect, it } from 'bun:test'

import type { ThreadIdentity } from '../../thread-reads'
import { cloudReadinessOf } from '../cloud-readiness'
import { fakeCloudChannel } from './fixture'

const tick = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

const identity = (overrides: Partial<ThreadIdentity> = {}): ThreadIdentity => ({
  head: 10,
  count: 10,
  digest: 'a'.repeat(64),
  ...overrides,
})

describe('the readiness registry', () => {
  it('hands back the same readiness for the same channel', () => {
    const channel = fakeCloudChannel()

    expect(cloudReadinessOf(channel)).toBe(cloudReadinessOf(channel))
  })

  it('keeps a separate readiness per channel', () => {
    const first = fakeCloudChannel()
    const second = fakeCloudChannel()

    expect(cloudReadinessOf(first)).not.toBe(cloudReadinessOf(second))
  })
})

describe('waitUntilApplied', () => {
  it('resolves immediately when the exact identity is already applied', async () => {
    const readiness = cloudReadinessOf(fakeCloudChannel())
    readiness.registerApplied(identity(), 1000)

    await readiness.waitUntilApplied(identity())
  })

  it('waits for the exact digest, head and count rather than any registration', async () => {
    const readiness = cloudReadinessOf(fakeCloudChannel())
    let settled = false
    const waiting = readiness.waitUntilApplied(identity()).then(() => {
      settled = true
    })

    readiness.registerApplied(identity({ digest: 'b'.repeat(64) }), 999)
    await tick()
    expect(settled).toBe(false)

    readiness.registerApplied(identity(), 1000)
    await tick()
    expect(settled).toBe(true)
    await waiting
  })

  it('does not match a same-head replacement whose digest and count differ', async () => {
    const readiness = cloudReadinessOf(fakeCloudChannel())
    let settled = false
    const waiting = readiness.waitUntilApplied(identity()).then(() => {
      settled = true
    })

    readiness.registerApplied(identity({ count: 11, digest: 'b'.repeat(64) }), 1001)
    await tick()
    expect(settled).toBe(false)

    readiness.registerApplied(identity(), 1002)
    await waiting
  })

  it('rejects the waiting promises when the attachment is cancelled', async () => {
    const readiness = cloudReadinessOf(fakeCloudChannel())
    const waiting = readiness.waitUntilApplied(identity())

    readiness.cancelWaiting()

    await expect(waiting).rejects.toThrow('detached')
  })

  it('lets a new wait begin after a cancellation', async () => {
    const readiness = cloudReadinessOf(fakeCloudChannel())
    const refused = readiness.waitUntilApplied(identity())
    readiness.cancelWaiting()
    await expect(refused).rejects.toThrow()

    const waiting = readiness.waitUntilApplied(identity())
    readiness.registerApplied(identity(), 1000)
    await waiting
  })
})

describe('registerApplied', () => {
  it('holds the identity and the moment it landed', () => {
    const readiness = cloudReadinessOf(fakeCloudChannel())

    readiness.registerApplied(identity(), 1000)

    expect(readiness.applied()?.identity).toEqual(identity())
    expect(readiness.applied()?.appliedAt).toBe(1000)
  })

  it('clears the snapshot when the view is unmounted', () => {
    const readiness = cloudReadinessOf(fakeCloudChannel())
    readiness.registerApplied(identity(), 1000)

    readiness.registerApplied(null, null)

    expect(readiness.applied()).toBeNull()
  })

  it('notifies subscribers on every registration until unsubscribed', () => {
    const readiness = cloudReadinessOf(fakeCloudChannel())
    const seen: (ThreadIdentity | null)[] = []
    const unsubscribe = readiness.subscribe(() => {
      seen.push(readiness.applied()?.identity ?? null)
    })

    readiness.registerApplied(identity(), 1000)
    readiness.registerApplied(null, null)

    expect(seen).toEqual([identity(), null])

    unsubscribe()
    readiness.registerApplied(identity({ head: 11 }), 1003)
    expect(seen).toEqual([identity(), null])
  })
})
