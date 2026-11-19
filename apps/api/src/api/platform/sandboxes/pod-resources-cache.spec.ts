import { describe, expect, it } from 'bun:test'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { PodResourcesCache } from './pod-resources-cache'
import type { SandboxResourcesObservation } from './vercel-sandbox.client'

class RecordingBackground extends BackgroundWork {
  readonly kept: Promise<unknown>[] = []

  keepAlive(work: Promise<unknown>): void {
    this.kept.push(work)
  }
}

const cacheWith = () => new PodResourcesCache(new RecordingBackground(), () => undefined)

const deferredRead = () => {
  let release!: (live: SandboxResourcesObservation | null) => void
  const promise = new Promise<SandboxResourcesObservation | null>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe('PodResourcesCache', () => {
  it('forgets an entry so the next read asks again', async () => {
    const cache = cacheWith()
    let reads = 0
    const read = async (): Promise<SandboxResourcesObservation> => {
      reads += 1
      return { vcpus: reads }
    }

    expect(await cache.resolve({ key: 'pod', read })).toEqual({ vcpus: 1 })
    expect(await cache.resolve({ key: 'pod', read })).toEqual({ vcpus: 1 })
    cache.forget('pod')
    expect(await cache.resolve({ key: 'pod', read })).toEqual({ vcpus: 2 })
    expect(reads).toBe(2)
  })

  it('does not let a read started before forget repopulate the entry', async () => {
    const cache = cacheWith()
    const stale = deferredRead()
    const reading = cache.resolve({ key: 'pod', read: () => stale.promise })

    cache.forget('pod')
    stale.release({ vcpus: 16 })
    expect(await reading).toEqual({ vcpus: 16 })

    let reads = 0
    expect(
      await cache.resolve({
        key: 'pod',
        read: async () => {
          reads += 1
          return { vcpus: 4 }
        },
      }),
    ).toEqual({ vcpus: 4 })
    expect(reads).toBe(1)
  })

  it('starts a fresh read after forget instead of joining the stale one in flight', async () => {
    const cache = cacheWith()
    const stale = deferredRead()
    const first = cache.resolve({ key: 'pod', read: () => stale.promise })

    cache.forget('pod')
    const fresh = cache.resolve({ key: 'pod', read: async () => ({ vcpus: 8 }) })
    expect(await fresh).toEqual({ vcpus: 8 })

    stale.release({ vcpus: 16 })
    expect(await first).toEqual({ vcpus: 16 })
    expect(await cache.resolve({ key: 'pod', read: async () => ({ vcpus: 1 }) })).toEqual({
      vcpus: 8,
    })
  })
})
