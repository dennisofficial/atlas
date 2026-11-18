import { describe, expect, it } from 'bun:test'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { cipher, seedOwner } from '../../config/__tests__/config-reader.fixture'
import { GithubTokenReader } from '../github-token-reader'

const testDb = useTestDatabase()

describe('GithubTokenReader', () => {
  it('decrypts the github connection of the user', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await db.orm.public.GithubConnection.create({
      id: 'gh-1',
      userId: 'user-1',
      login: 'octocat',
      scopes: 'repo',
      sealedToken: cipher.encrypt('gho_secret'),
    })
    const reader = new GithubTokenReader({ db, cipher })
    expect(await reader.read({ userId: 'user-1' })).toBe('gho_secret')
  })

  it('answers null when github is not connected', async () => {
    const { db } = testDb()
    await seedOwner(db)
    expect(await new GithubTokenReader({ db, cipher }).read({ userId: 'user-1' })).toBeNull()
  })
})
