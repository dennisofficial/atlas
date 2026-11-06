import { describe, expect, it } from 'bun:test'

import { FakeMediaStore } from '../src/testing'

describe('FakeMediaStore', () => {
  it('counts the delegations it issues and numbers them', async () => {
    const store = new FakeMediaStore()
    const first = await store.issueReadDelegation({ validUntil: 10 })
    const second = await store.issueReadDelegation({ validUntil: 10 })
    expect(store.issued).toBe(2)
    expect(first.delegationToken).not.toBe(second.delegationToken)
  })

  it('signs the same inputs to the same url and different delegations to different urls', async () => {
    const store = new FakeMediaStore()
    const first = await store.issueReadDelegation({ validUntil: 10 })
    const second = await store.issueReadDelegation({ validUntil: 10 })
    const sign = (delegation: typeof first) =>
      store.presignGet({ delegation, pathname: 'media/u/h', validUntil: 10 })
    expect(await sign(first)).toBe(await sign(first))
    expect(await sign(first)).not.toBe(await sign(second))
  })

  it('heads and deletes what it holds', async () => {
    const store = new FakeMediaStore()
    store.blobs.set('media/u/h', 5)
    expect(await store.head({ pathname: 'media/u/h' })).toEqual({ size: 5 })
    await store.delete({ pathnames: ['media/u/h'] })
    expect(await store.head({ pathname: 'media/u/h' })).toBeNull()
  })

  it('reads the bytes it was given and nothing after a delete', async () => {
    const store = new FakeMediaStore()
    store.put({ pathname: 'media/u/h', bytes: new Uint8Array([1, 2, 3]) })
    expect(await store.read({ pathname: 'media/u/h' })).toEqual(new Uint8Array([1, 2, 3]))
    expect(await store.head({ pathname: 'media/u/h' })).toEqual({ size: 3 })
    await store.delete({ pathnames: ['media/u/h'] })
    expect(await store.read({ pathname: 'media/u/h' })).toBeNull()
  })
})
