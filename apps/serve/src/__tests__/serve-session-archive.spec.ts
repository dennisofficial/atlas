import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { atlasDirectory, sessionDirectory } from '@dltech/atlas-harness'

import { serveSessionArchive } from '../serve-session-archive'

const thread = toThreadId('archived')

const seedSession = (): void => {
  const dir = sessionDirectory({ home: atlasDirectory(), sessionId: thread })
  mkdirSync(join(dir, 'threads'), { recursive: true })
  writeFileSync(join(dir, 'meta.json'), '{}')
}

describe('the served session archive', () => {
  it('ends the family shells before it builds the archive', async () => {
    seedSession()
    const order: string[] = []

    const archive = await serveSessionArchive({
      threadId: thread,
      endFamilyShells: async () => {
        order.push('ended')
      },
    })

    expect(order).toEqual(['ended'])
    expect(archive).not.toBeNull()
  })

  it('builds nothing when the family shells would not end', async () => {
    seedSession()

    await expect(
      serveSessionArchive({
        threadId: thread,
        endFamilyShells: async () => {
          throw new Error('still writing')
        },
      }),
    ).rejects.toThrow('still writing')
  })
})
