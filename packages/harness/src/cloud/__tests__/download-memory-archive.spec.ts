import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sanitiseRepoPath } from '@dltech/atlas-core'

import { buildContextArchive } from '../context-archive'
import { downloadMemoryArchive } from '../download-memory-archive'

let staging: string
let atlasHome: string

beforeEach(() => {
  staging = mkdtempSync(join(tmpdir(), 'atlas-purge-staging-'))
  atlasHome = mkdtempSync(join(tmpdir(), 'atlas-purge-home-'))
})

afterEach(() => {
  rmSync(staging, { recursive: true, force: true })
  rmSync(atlasHome, { recursive: true, force: true })
})

const staged = (name: string, content: string): string => {
  const path = join(staging, name)
  writeFileSync(path, content)
  return path
}

const contextOver = (args: { archive?: Uint8Array | null; bundle?: string | null }) => ({
  readMemoryArchive: () => Promise.resolve(args.archive ?? null),
  readMemoryBundle: () => Promise.resolve(args.bundle ?? null),
})

const archiveOf = (files: readonly { key: string; content: string }[]): Promise<Buffer> =>
  buildContextArchive({
    files: files.map((file) => ({ key: file.key, path: staged(file.key.replaceAll('/', '_'), file.content) })),
  }).then((archive) => {
    if (archive === undefined) throw new Error('expected an archive')
    return archive
  })

const PROJECT_KEY = `project/${encodeURIComponent('/repo/atlas')}/notes.md`

describe('downloadMemoryArchive', () => {
  it('extracts user and project entries back into the directories they were tarred from', async () => {
    const archive = await archiveOf([
      { key: 'user/MEMORY.md', content: '# user memory' },
      { key: PROJECT_KEY, content: '# project memory' },
    ])

    const result = await downloadMemoryArchive({ context: contextOver({ archive }), atlasHome })

    expect(result).toEqual({ restored: 2, skipped: 0 })
    expect(readFileSync(join(atlasHome, 'memory', 'MEMORY.md'), 'utf8')).toBe('# user memory')
    expect(
      readFileSync(
        join(atlasHome, 'projects', sanitiseRepoPath('/repo/atlas'), 'memory', 'notes.md'),
        'utf8',
      ),
    ).toBe('# project memory')
  })

  it('lets the local copy win when the file already exists', async () => {
    mkdirSync(join(atlasHome, 'memory'), { recursive: true })
    writeFileSync(join(atlasHome, 'memory', 'MEMORY.md'), 'local wins')
    const archive = await archiveOf([{ key: 'user/MEMORY.md', content: 'cloud copy' }])

    const result = await downloadMemoryArchive({ context: contextOver({ archive }), atlasHome })

    expect(result).toEqual({ restored: 0, skipped: 1 })
    expect(readFileSync(join(atlasHome, 'memory', 'MEMORY.md'), 'utf8')).toBe('local wins')
  })

  it('skips a bare project entry that carries no repo identity', async () => {
    const archive = await archiveOf([{ key: 'project/notes.md', content: 'homeless' }])

    const result = await downloadMemoryArchive({ context: contextOver({ archive }), atlasHome })

    expect(result).toEqual({ restored: 0, skipped: 1 })
    expect(existsSync(join(atlasHome, 'projects'))).toBe(false)
  })

  it('falls back to the legacy json bundle when no archive was ever synced', async () => {
    const result = await downloadMemoryArchive({
      context: contextOver({ archive: null, bundle: JSON.stringify({ 'user/MEMORY.md': 'from bundle' }) }),
      atlasHome,
    })

    expect(result).toEqual({ restored: 1, skipped: 0 })
    expect(readFileSync(join(atlasHome, 'memory', 'MEMORY.md'), 'utf8')).toBe('from bundle')
  })

  it('restores nothing when the cloud holds neither an archive nor a bundle', async () => {
    const result = await downloadMemoryArchive({ context: contextOver({}), atlasHome })

    expect(result).toEqual({ restored: 0, skipped: 0 })
  })

  it('refuses a corrupt bundle rather than deleting it server-side unseen', async () => {
    await expect(
      downloadMemoryArchive({ context: contextOver({ archive: null, bundle: 'not json' }), atlasHome }),
    ).rejects.toThrow('not readable JSON')
  })
})
