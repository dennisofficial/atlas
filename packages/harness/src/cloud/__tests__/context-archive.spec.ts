import { describe, expect, it } from 'bun:test'

import { lstat, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildContextArchive, extractContextArchive, TAR_NOT_FOUND_MESSAGE } from '../context-archive'

const freshDirectory = async (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), prefix))

describe('buildContextArchive', () => {
  it('returns undefined when there is nothing to archive', async () => {
    await expect(buildContextArchive({ files: [] })).resolves.toBeUndefined()
  })

  it('skips a source that does not exist rather than failing the whole archive', async () => {
    const staging = await freshDirectory('atlas-archive-staging-')
    const present = join(staging, 'present.txt')
    await writeFile(present, 'here', 'utf8')

    const archive = await buildContextArchive({
      files: [
        { key: 'present.txt', path: present },
        { key: 'missing.txt', path: join(staging, 'missing.txt') },
      ],
    })
    if (archive === undefined) throw new Error('expected an archive')

    const extracted = await extractContextArchive({ archive })
    try {
      expect(extracted.entries.map((entry) => entry.key)).toEqual(['present.txt'])
    } finally {
      await extracted.cleanup()
    }
  })

  it('reports a clear error when the tar command is not on PATH', async () => {
    const staging = await freshDirectory('atlas-archive-staging-')
    const present = join(staging, 'present.txt')
    await writeFile(present, 'here', 'utf8')

    await expect(
      buildContextArchive({
        files: [{ key: 'present.txt', path: present }],
        tarCommand: 'atlas-nonexistent-tar-binary',
      }),
    ).rejects.toThrow(TAR_NOT_FOUND_MESSAGE)
  })

  it('follows a symlinked source rather than shipping a dangling link', async () => {
    const staging = await freshDirectory('atlas-archive-staging-')
    const real = join(staging, 'real.md')
    await writeFile(real, 'real content', 'utf8')
    const link = join(staging, 'linked.md')
    await symlink(real, link)

    const archive = await buildContextArchive({ files: [{ key: 'linked.md', path: link }] })
    if (archive === undefined) throw new Error('expected an archive')

    const extracted = await extractContextArchive({ archive })
    try {
      const entry = extracted.entries.find((candidate) => candidate.key === 'linked.md')
      if (entry === undefined) throw new Error('expected linked.md in the archive')
      expect((await lstat(entry.path)).isSymbolicLink()).toBe(false)
      expect(await readFile(entry.path, 'utf8')).toBe('real content')
    } finally {
      await extracted.cleanup()
    }
  })
})

describe('extractContextArchive', () => {
  it('round-trips content and preserves each entry’s key, including one nested under a wire prefix', async () => {
    const staging = await freshDirectory('atlas-archive-staging-')
    await writeFile(join(staging, 'top.txt'), 'top level', 'utf8')
    await writeFile(join(staging, 'source.md'), 'nested content', 'utf8')

    const archive = await buildContextArchive({
      files: [
        { key: 'top.txt', path: join(staging, 'top.txt') },
        { key: 'a/b/nested.md', path: join(staging, 'source.md') },
      ],
    })
    if (archive === undefined) throw new Error('expected an archive')

    const extracted = await extractContextArchive({ archive })
    try {
      const keys = extracted.entries.map((entry) => entry.key).sort()
      expect(keys).toEqual(['a/b/nested.md', 'top.txt'])

      const top = extracted.entries.find((entry) => entry.key === 'top.txt')
      const nested = extracted.entries.find((entry) => entry.key === 'a/b/nested.md')
      if (top === undefined || nested === undefined) throw new Error('expected both entries')
      expect(await readFile(top.path, 'utf8')).toBe('top level')
      expect(await readFile(nested.path, 'utf8')).toBe('nested content')
    } finally {
      await extracted.cleanup()
    }
  })

  it('preserves the source mtime within tar’s one-second granularity', async () => {
    const staging = await freshDirectory('atlas-archive-staging-')
    const source = join(staging, 'note.md')
    await writeFile(source, 'a note', 'utf8')
    const sourceMtimeMs = (await stat(source)).mtimeMs

    const archive = await buildContextArchive({ files: [{ key: 'note.md', path: source }] })
    if (archive === undefined) throw new Error('expected an archive')

    const extracted = await extractContextArchive({ archive })
    try {
      const entry = extracted.entries.find((candidate) => candidate.key === 'note.md')
      if (entry === undefined) throw new Error('expected note.md in the archive')
      expect(Math.abs(entry.mtimeMs - sourceMtimeMs)).toBeLessThan(1_000)
    } finally {
      await extracted.cleanup()
    }
  })

  it('preserves non-UTF8 bytes through the archive round trip', async () => {
    const staging = await freshDirectory('atlas-archive-staging-')
    const source = join(staging, 'icon.png')
    const rawBytes = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02])
    await writeFile(source, rawBytes)

    const archive = await buildContextArchive({ files: [{ key: 'icon.png', path: source }] })
    if (archive === undefined) throw new Error('expected an archive')

    const extracted = await extractContextArchive({ archive })
    try {
      const entry = extracted.entries.find((candidate) => candidate.key === 'icon.png')
      if (entry === undefined) throw new Error('expected icon.png in the archive')
      expect(await readFile(entry.path)).toEqual(rawBytes)
    } finally {
      await extracted.cleanup()
    }
  })

  it('reports a clear error when the tar command is not on PATH', async () => {
    await expect(
      extractContextArchive({
        archive: new Uint8Array([0x1f, 0x8b]),
        tarCommand: 'atlas-nonexistent-tar-binary',
      }),
    ).rejects.toThrow(TAR_NOT_FOUND_MESSAGE)
  })

  it('rejects an archive that is not valid gzip', async () => {
    await expect(
      extractContextArchive({ archive: new TextEncoder().encode('not a gzip archive') }),
    ).rejects.toThrow()
  })
})
