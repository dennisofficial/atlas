import { describe, expect, it } from 'bun:test'

import { sharedListing } from '../shared-listing'

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const rig = () => {
  let now = 0
  const calls: string[] = []
  const pending: ReturnType<typeof deferred<string[]>>[] = []
  const list = sharedListing({
    list: ({ project }: { project: string }) => {
      calls.push(project)
      const next = deferred<string[]>()
      pending.push(next)
      return next.promise
    },
    keyOf: ({ project }) => project,
    freshForMs: 1_000,
    nowMs: () => now,
  })
  return {
    list,
    calls,
    pending,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('sharedListing', () => {
  it('serves concurrent callers from one request', async () => {
    const { list, calls, pending } = rig()

    const all = Promise.all(Array.from({ length: 50 }, () => list({ project: 'atlas' })))
    pending[0]?.resolve(['thread-1'])

    expect(await all).toEqual(Array.from({ length: 50 }, () => ['thread-1']))
    expect(calls).toEqual(['atlas'])
  })

  it('reuses a settled listing until it goes stale, then asks again', async () => {
    const { list, calls, pending, advance } = rig()
    const first = list({ project: 'atlas' })
    pending[0]?.resolve(['thread-1'])
    await first

    advance(999)
    expect(await list({ project: 'atlas' })).toEqual(['thread-1'])
    expect(calls).toHaveLength(1)

    advance(1)
    const fresh = list({ project: 'atlas' })
    pending[1]?.resolve(['thread-2'])
    expect(await fresh).toEqual(['thread-2'])
    expect(calls).toHaveLength(2)
  })

  it('drops a failed listing so the next caller retries', async () => {
    const { list, calls, pending } = rig()
    const failed = list({ project: 'atlas' })
    pending[0]?.reject(new Error('the API answered 500'))
    await expect(failed).rejects.toThrow('500')

    const retried = list({ project: 'atlas' })
    pending[1]?.resolve(['thread-1'])
    expect(await retried).toEqual(['thread-1'])
    expect(calls).toHaveLength(2)
  })

  it('keeps listings for different keys apart', async () => {
    const { list, calls, pending } = rig()
    const atlas = list({ project: 'atlas' })
    const other = list({ project: 'other' })
    pending[0]?.resolve(['a'])
    pending[1]?.resolve(['b'])

    expect([await atlas, await other]).toEqual([['a'], ['b']])
    expect(calls).toEqual(['atlas', 'other'])
  })
})
