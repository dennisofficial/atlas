import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import { buildSessionArchive } from '../../cloud/session-archive'
import { sessionDirectory } from '../../store/sessions/paths'
import { materializeTranscript } from '../materialize-transcript'

const THREAD = toThreadId('thread-serve')

const homes: string[] = []
const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-transcript-spec-'))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
})

describe('materializing the transcript at boot', () => {
  it('untars the fetched archive into the session directory', async () => {
    const home = freshHome()
    const source = freshHome()
    const dir = sessionDirectory({ home: source, sessionId: THREAD })
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(dir, 'threads'), { recursive: true })
    writeFileSync(join(dir, 'meta.json'), '{"format":1}')
    writeFileSync(join(dir, 'threads', `${THREAD}.events.jsonl`), '')
    const archive = await buildSessionArchive({ sessionDir: dir })
    if (archive === undefined) throw new Error('expected an archive')

    const readiness = await materializeTranscript({
      fetchArchive: async () => archive,
      atlasHome: home,
      threadId: THREAD,
    })

    expect(readiness).toEqual({ restored: true, failed: null })
    const { existsSync } = await import('node:fs')
    expect(existsSync(join(sessionDirectory({ home, sessionId: THREAD }), 'meta.json'))).toBe(true)
  })

  it('leaves a resumed sandbox alone when the session directory is already there', async () => {
    const home = freshHome()
    const dir = sessionDirectory({ home, sessionId: THREAD })
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'meta.json'), '{"format":1,"marker":"resumed"}')
    let fetches = 0

    const readiness = await materializeTranscript({
      fetchArchive: async () => {
        fetches += 1
        return null
      },
      atlasHome: home,
      threadId: THREAD,
    })

    expect(readiness).toEqual({ restored: false, failed: null })
    expect(fetches).toBe(0)
    const { readFileSync } = await import('node:fs')
    expect(readFileSync(join(dir, 'meta.json'), 'utf8')).toContain('resumed')
  })

  it('reports a fetch failure rather than booting against a blank log', async () => {
    const home = freshHome()

    const readiness = await materializeTranscript({
      fetchArchive: async () => {
        throw new Error('the control plane 502d')
      },
      atlasHome: home,
      threadId: THREAD,
    })

    expect(readiness.restored).toBe(false)
    expect(readiness.failed).toContain('the control plane 502d')
  })

  it('reports an archive that will not untar', async () => {
    const home = freshHome()

    const readiness = await materializeTranscript({
      fetchArchive: async () => Buffer.from('not a tar'),
      atlasHome: home,
      threadId: THREAD,
    })

    expect(readiness.restored).toBe(false)
    expect(readiness.failed).toContain('did not extract')
  })

  it('answers unrestored when the control plane has nothing stored', async () => {
    const home = freshHome()

    const readiness = await materializeTranscript({
      fetchArchive: async () => null,
      atlasHome: home,
      threadId: THREAD,
    })

    expect(readiness).toEqual({ restored: false, failed: null })
  })
})
