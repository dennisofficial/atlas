import { describe, expect, it } from 'bun:test'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { DbMediaRegistry } from './media-registry'

const media = (hash: string) => ({
  hash,
  mediaType: 'image/png' as const,
  size: 120,
  width: 4,
  height: 3,
})

describe('DbMediaRegistry', () => {
  useTestDatabase()
  const registry = new DbMediaRegistry()
  const A = 'a'.repeat(64)
  const B = 'b'.repeat(64)

  it('records an image once per user and reads it back', async () => {
    await registry.insertIfAbsent({ userId: 'user-a', media: media(A) })
    await registry.insertIfAbsent({
      userId: 'user-a',
      media: { ...media(A), width: 99 },
    })
    expect(await registry.find({ userId: 'user-a', hash: A })).toEqual(media(A))
  })

  it('keeps users apart and finds many in one query', async () => {
    await registry.insertIfAbsent({ userId: 'user-a', media: media(A) })
    await registry.insertIfAbsent({ userId: 'user-b', media: media(B) })
    expect(await registry.find({ userId: 'user-a', hash: B })).toBeUndefined()
    expect(await registry.findMany({ userId: 'user-a', hashes: [A, B] })).toEqual([media(A)])
    expect(await registry.findMany({ userId: 'user-a', hashes: [] })).toEqual([])
  })
})
