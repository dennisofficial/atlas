import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import { preserveDescendSource } from '../descend-recovery'
import { useAtlasHome } from './descend-fixture'

describe('a refused transcript handoff', () => {
  it('restores the original transcript and preserves the landed transcript separately', async () => {
    const home = useAtlasHome()
    const threadId = toThreadId('brn_source_recovery')
    const directory = join(home, 'sessions', threadId)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'events'), 'original source\n')
    const recovery = await preserveDescendSource({ threadId })

    await writeFile(join(directory, 'events'), 'incoming cloud\n')
    await recovery.restore()

    expect(await readFile(join(directory, 'events'), 'utf8')).toBe('original source\n')
    expect(await readFile(join(recovery.directory, 'landed', 'events'), 'utf8')).toBe('incoming cloud\n')
    expect(await readFile(join(recovery.directory, 'previous', 'events'), 'utf8')).toBe('original source\n')
  })
})
