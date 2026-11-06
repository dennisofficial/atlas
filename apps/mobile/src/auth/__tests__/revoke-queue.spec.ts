import { describe, expect, it } from 'bun:test'

import { retryPendingRevokes, revokeOrPersist, type IPendingRevokeStorage } from '../revoke-queue'

const createMemoryStorage = (initial?: string): IPendingRevokeStorage & { value?: string } => {
  const storage: IPendingRevokeStorage & { value?: string } = {
    value: initial,
    load: async () => storage.value,
    save: async (value) => {
      storage.value = value
    },
    clear: async () => {
      storage.value = undefined
    },
  }
  return storage
}

const reachable = async () => true
const offline = async () => false

describe('revokeOrPersist', () => {
  it('persists the bearer when the revoke fails', async () => {
    const storage = createMemoryStorage()
    await revokeOrPersist({ storage, revoke: offline, token: 'bearer-1' })
    expect(JSON.parse(storage.value ?? '[]')).toEqual(['bearer-1'])
  })

  it('persists the bearer when the revoke throws', async () => {
    const storage = createMemoryStorage()
    await revokeOrPersist({
      storage,
      revoke: async () => {
        throw new Error('network')
      },
      token: 'bearer-1',
    })
    expect(JSON.parse(storage.value ?? '[]')).toEqual(['bearer-1'])
  })

  it('persists nothing when the revoke succeeds', async () => {
    const storage = createMemoryStorage()
    await revokeOrPersist({ storage, revoke: reachable, token: 'bearer-1' })
    expect(storage.value).toBeUndefined()
  })

  it('keeps earlier pending bearers and does not duplicate one', async () => {
    const storage = createMemoryStorage()
    await revokeOrPersist({ storage, revoke: offline, token: 'bearer-1' })
    await revokeOrPersist({ storage, revoke: offline, token: 'bearer-2' })
    await revokeOrPersist({ storage, revoke: offline, token: 'bearer-2' })
    expect(JSON.parse(storage.value ?? '[]')).toEqual(['bearer-1', 'bearer-2'])
  })
})

describe('retryPendingRevokes', () => {
  it('retries a persisted bearer on the next start and clears it on success', async () => {
    const storage = createMemoryStorage()
    await revokeOrPersist({ storage, revoke: offline, token: 'bearer-1' })
    const revoked: string[] = []
    await retryPendingRevokes({
      storage,
      revoke: async (token) => {
        revoked.push(token)
        return true
      },
    })
    expect(revoked).toEqual(['bearer-1'])
    expect(storage.value).toBeUndefined()
  })

  it('keeps only the bearers that still fail', async () => {
    const storage = createMemoryStorage(JSON.stringify(['bearer-1', 'bearer-2']))
    await retryPendingRevokes({ storage, revoke: async (token) => token === 'bearer-1' })
    expect(JSON.parse(storage.value ?? '[]')).toEqual(['bearer-2'])
  })

  it('does nothing when nothing is pending or the stored value is corrupt', async () => {
    const revoked: string[] = []
    const revoke = async (token: string) => {
      revoked.push(token)
      return true
    }
    await retryPendingRevokes({ storage: createMemoryStorage(), revoke })
    await retryPendingRevokes({ storage: createMemoryStorage('{not json'), revoke })
    expect(revoked).toEqual([])
  })
})
