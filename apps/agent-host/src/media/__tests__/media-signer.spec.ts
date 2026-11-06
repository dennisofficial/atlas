import { describe, expect, it } from 'bun:test'

import { SIGN_WINDOW_MS } from '@dltech/atlas-core'
import { FakeMediaStore } from '@dltech/atlas-media/testing'

import { SecretCipher } from '../../config/secret-cipher'
import { MediaSigner } from '../media-signer'
import { MemoryMediaSigningWindows } from './support'

const cipher = new SecretCipher('a'.repeat(64))
const ref = { userId: 'u1', hash: 'abc' }

const setup = (start = 3 * SIGN_WINDOW_MS + 1000) => {
  const clock = { now: start }
  const store = new FakeMediaStore()
  const windows = new MemoryMediaSigningWindows()
  const signerOn = (sharedStore: FakeMediaStore) =>
    new MediaSigner({ store: sharedStore, windows, cipher, now: () => clock.now })
  return { clock, store, windows, signer: signerOn(store), signerOn }
}

describe('MediaSigner', () => {
  it('issues one delegation per window and returns the same url every time', async () => {
    const { store, signer } = setup()
    await signer.ready()
    const first = await signer.urlOf(ref)
    await signer.ready()
    expect(await signer.urlOf(ref)).toBe(first)
    expect(store.issued).toBe(1)
  })

  it('shares one in-flight load between concurrent ready calls', async () => {
    const { store, signer } = setup()
    await Promise.all([signer.ready(), signer.ready(), signer.ready()])
    expect(store.issued).toBe(1)
  })

  it('seals the delegation at rest', async () => {
    const { windows, signer } = setup()
    await signer.ready()
    const [row] = [...windows.rows.values()]
    expect(row?.sealed).not.toContain('delegation-1')
  })

  it('makes two signers racing on an empty window adopt the first writer', async () => {
    const { windows, signerOn } = setup()
    const storeA = new FakeMediaStore()
    const storeB = new FakeMediaStore()
    const [a, b] = [signerOn(storeA), signerOn(storeB)]
    await Promise.all([a.ready(), b.ready()])
    expect(storeA.issued + storeB.issued).toBe(2)
    expect(windows.rows.size).toBe(1)
    expect(await a.urlOf(ref)).toBe(await b.urlOf(ref))
  })

  it('lets a second host adopt an existing row without issuing', async () => {
    const { store, windows, signer, signerOn } = setup()
    await signer.ready()
    const other = new FakeMediaStore()
    const second = signerOn(other)
    await second.ready()
    expect(other.issued).toBe(0)
    expect(windows.inserts).toBe(1)
    expect(await second.urlOf(ref)).toBe(await signer.urlOf(ref))
    expect(store.issued).toBe(1)
  })

  it('issues again once the clock passes into the next window', async () => {
    const { clock, store, signer } = setup()
    await signer.ready()
    const first = await signer.urlOf(ref)
    clock.now += SIGN_WINDOW_MS
    await signer.ready()
    expect(store.issued).toBe(2)
    expect(await signer.urlOf(ref)).not.toBe(first)
  })

  it('refuses to sign before ready', async () => {
    const { signer } = setup()
    await expect(signer.urlOf(ref)).rejects.toThrow('ready()')
  })

  it('refuses to sign in a window it has not loaded', async () => {
    const { clock, signer } = setup()
    await signer.ready()
    clock.now += SIGN_WINDOW_MS
    await expect(signer.urlOf(ref)).rejects.toThrow('ready()')
  })
})
