import { describe, expect, it } from 'bun:test'

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { walkMemoryDirectory } from '../walk-memory'

const freshDirectory = async (): Promise<string> => mkdtemp(join(tmpdir(), 'atlas-walk-memory-'))

describe('walkMemoryDirectory', () => {
  it('returns nothing for a directory that does not exist', async () => {
    const directory = join(await freshDirectory(), 'never-created')

    expect(await walkMemoryDirectory(directory)).toEqual([])
  })

  it('base64-encodes each flat file and reports its mtime', async () => {
    const directory = await freshDirectory()
    await writeFile(join(directory, 'MEMORY.md'), '# notes', 'utf8')

    const entries = await walkMemoryDirectory(directory)

    expect(entries).toHaveLength(1)
    expect(entries[0]?.name).toBe('MEMORY.md')
    expect(Buffer.from(entries[0]?.content ?? '', 'base64').toString('utf8')).toBe('# notes')
    expect(entries[0]?.mtime).toBeGreaterThan(0)
  })

  it('never descends into a nested directory', async () => {
    const directory = await freshDirectory()
    await writeFile(join(directory, 'MEMORY.md'), '# top level', 'utf8')
    await mkdir(join(directory, 'projects', 'some-repo'), { recursive: true })
    await writeFile(join(directory, 'projects', 'some-repo', 'MEMORY.md'), '# nested', 'utf8')

    const entries = await walkMemoryDirectory(directory)

    expect(entries.map((entry) => entry.name)).toEqual(['MEMORY.md'])
  })

  it('preserves non-UTF8 bytes through the base64 round trip', async () => {
    const directory = await freshDirectory()
    const rawBytes = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02])
    await writeFile(join(directory, 'icon.png'), rawBytes)

    const entries = await walkMemoryDirectory(directory)

    expect(Buffer.from(entries[0]?.content ?? '', 'base64')).toEqual(rawBytes)
  })
})
