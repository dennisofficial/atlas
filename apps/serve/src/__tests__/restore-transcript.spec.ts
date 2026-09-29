import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import { buildSessionArchive, sessionDirectory } from '@dltech/atlas-harness'
import { restoreTranscript } from '../restore-transcript'

const THREAD = toThreadId('thread-restore')

const homes: string[] = []
const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-restore-spec-'))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
})

const seedArchive = async (text: string): Promise<Uint8Array> => {
  const source = freshHome()
  const dir = sessionDirectory({ home: source, sessionId: THREAD })
  mkdirSync(join(dir, 'threads'), { recursive: true })
  writeFileSync(join(dir, 'threads', `${THREAD}.events.jsonl`), `${text}\n`)
  const archive = await buildSessionArchive({ sessionDir: dir })
  if (archive === undefined) throw new Error('expected an archive')
  return archive
}

describe('restoring a transcript the lift shipped late', () => {
  it('extracts the archive and refreshes the store when the session is blank', async () => {
    const home = freshHome()
    const archive = await seedArchive('{"type":"user-said"}')
    const refreshed: string[] = []

    const result = await restoreTranscript({
      fetchArchive: async () => archive,
      atlasHome: home,
      threadId: THREAD,
      log: { refresh: async ({ threadId }) => { refreshed.push(threadId) } },
      hasTranscript: () => false,
    })

    expect(result).toEqual({ restored: true, failed: null })
    expect(refreshed).toEqual([THREAD])
    expect(
      existsSync(join(sessionDirectory({ home, sessionId: THREAD }), 'threads', `${THREAD}.events.jsonl`)),
    ).toBe(true)
  })

  it('reads an already-served transcript as restored without re-extracting', async () => {
    const home = freshHome()
    let fetches = 0

    const result = await restoreTranscript({
      fetchArchive: async () => {
        fetches += 1
        return null
      },
      atlasHome: home,
      threadId: THREAD,
      log: { refresh: async () => {} },
      hasTranscript: () => true,
    })

    expect(result).toEqual({ restored: true, failed: null })
    expect(fetches).toBe(0)
  })

  it('fails naming the missing archive rather than reporting a blank restore as success', async () => {
    const home = freshHome()

    const result = await restoreTranscript({
      fetchArchive: async () => null,
      atlasHome: home,
      threadId: THREAD,
      log: { refresh: async () => {} },
      hasTranscript: () => false,
    })

    expect(result.restored).toBe(false)
    expect(result.failed).toContain('no transcript archive')
  })
})
