import { beforeEach, describe, expect, it } from 'bun:test'

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { buildContextArchive } from '@dltech/atlas-harness'

import { dismissNotice } from '../../../ui/notice-store'
import { mergeRemoteMemory } from '../merge-remote-memory'

import {
  entryFor,
  fetchServingArchive,
  fetchServingLegacyOnly,
  freshDirectory,
  SESSION,
  setMtime,
} from './merge-memory-fixture'

beforeEach(() => {
  dismissNotice()
})

describe('mergeRemoteMemory reading a real archive', () => {
  it('untars the archive and applies last-writer-wins by the mtime tar restored', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const staged = await freshDirectory('atlas-merge-staged-')
    await writeFile(join(staged, 'MEMORY.md'), '# from the cloud archive', 'utf8')
    await setMtime(join(staged, 'MEMORY.md'), 5_000)
    const archive = await buildContextArchive({ files: [{ key: 'user/MEMORY.md', path: join(staged, 'MEMORY.md') }] })
    if (archive === undefined) throw new Error('expected an archive')

    const result = await mergeRemoteMemory({
      session: SESSION,
      atlasHome,
      fetchFn: fetchServingArchive(archive),
    })

    expect(result.replaced).toBe(1)
    expect(await readFile(join(atlasHome, 'memory', 'MEMORY.md'), 'utf8')).toBe(
      '# from the cloud archive',
    )
  })

  it('falls back to the legacy JSON bundle when the archive route 404s', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const fetchFn = fetchServingLegacyOnly({ 'user/MEMORY.md': entryFor('# from the legacy route', 1_000) })

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, fetchFn })

    expect(result.replaced).toBe(1)
    expect(await readFile(join(atlasHome, 'memory', 'MEMORY.md'), 'utf8')).toBe(
      '# from the legacy route',
    )
  })

  it('answers nothing when both the archive and the legacy route report nothing stored', async () => {
    const atlasHome = await freshDirectory('atlas-merge-home-')
    const fetchFn = fetchServingLegacyOnly(null)

    const result = await mergeRemoteMemory({ session: SESSION, atlasHome, fetchFn })

    expect(result.replaced).toBe(0)
  })
})
