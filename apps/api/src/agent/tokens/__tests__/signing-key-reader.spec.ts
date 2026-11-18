import { describe, expect, it } from 'bun:test'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { cipher, seedOwner } from '../../config/__tests__/config-reader.fixture'
import { SigningKeyReader } from '../signing-key-reader'

const testDb = useTestDatabase()

describe('SigningKeyReader', () => {
  it('decrypts the signing key of the user with its identity', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await db.orm.public.SshSigningKey.create({
      userId: 'user-1',
      publicKey: 'ssh-ed25519 AAAApublic',
      sealedPrivateKey: cipher.encrypt('-----PRIVATE-----'),
      githubKeyId: 42n,
      userName: 'Dennis',
      userEmail: 'dennis@example.com',
    })
    expect(await new SigningKeyReader({ db, cipher }).read({ userId: 'user-1' })).toEqual({
      publicKey: 'ssh-ed25519 AAAApublic',
      privateKey: '-----PRIVATE-----',
      userName: 'Dennis',
      userEmail: 'dennis@example.com',
    })
  })

  it('answers null when the user has no signing key', async () => {
    const { db } = testDb()
    await seedOwner(db)
    expect(await new SigningKeyReader({ db, cipher }).read({ userId: 'user-1' })).toBeNull()
  })

  it('rejects a key sealed with another cipher', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await db.orm.public.SshSigningKey.create({
      userId: 'user-1',
      publicKey: 'ssh-ed25519 AAAApublic',
      sealedPrivateKey: 'not-sealed',
      githubKeyId: 42n,
      userName: 'Dennis',
      userEmail: 'dennis@example.com',
    })
    await expect(new SigningKeyReader({ db, cipher }).read({ userId: 'user-1' })).rejects.toThrow()
  })
})
