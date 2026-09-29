import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { buildContextArchive, type ArchiveFileSource } from '../../context-archive'
import { mergeMemoryArchive } from '../session-archive'

const OLD = new Date('2026-09-20T10:00:00.000Z')
const NEW = new Date('2026-09-28T10:00:00.000Z')

const scratch: string[] = []

afterEach(() => {
  for (const dir of scratch.splice(0, scratch.length)) rmSync(dir, { recursive: true, force: true })
})

const staged = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-memory-merge-'))
  scratch.push(dir)
  return dir
}

const writeAt = (args: { path: string; content: string; at: Date }): void => {
  mkdirSync(join(args.path, '..'), { recursive: true })
  writeFileSync(args.path, args.content)
  utimesSync(args.path, args.at, args.at)
}

const tarOf = async (
  files: readonly { key: string; content: string; at: Date }[],
): Promise<Uint8Array> => {
  const dir = staged()
  const sources: ArchiveFileSource[] = []
  for (const file of files) {
    const path = join(dir, file.key.replaceAll('/', '-'))
    writeAt({ path, content: file.content, at: file.at })
    sources.push({ key: file.key, path })
  }
  const archive = await buildContextArchive({ files: sources })
  if (archive === undefined) throw new Error('the staged archive should not be empty')
  return archive
}

const projectKeyOf = (repo: string): string => repo.replace(/[^a-zA-Z0-9]/g, '-')

describe('merging the sandbox’s memory archive back into the home', () => {
  it('maps archive keys onto the user and the repo’s project memory roots', async () => {
    const home = staged()
    const repo = staged()
    const archive = await tarOf([
      { key: '.atlas/memory/MEMORY.md', content: 'user index', at: NEW },
      { key: 'project-memory/fact.md', content: 'project fact', at: NEW },
    ])

    const merge = await mergeMemoryArchive({ archive, atlasHome: home, repoRoot: repo })

    expect(merge).toEqual({ merged: 2, kept: 0 })
    expect(readFileSync(join(home, 'memory', 'MEMORY.md'), 'utf8')).toBe('user index')
    expect(
      readFileSync(join(home, 'projects', projectKeyOf(repo), 'memory', 'fact.md'), 'utf8'),
    ).toBe('project fact')
  })

  it('overwrites host files the sandbox’s copy is newer than', async () => {
    const home = staged()
    const repo = staged()
    writeAt({
      path: join(home, 'memory', 'fact.md'),
      content: 'what the host remembered before the lift',
      at: OLD,
    })
    const archive = await tarOf([
      { key: '.atlas/memory/fact.md', content: 'what the cloud session learned', at: NEW },
    ])

    const merge = await mergeMemoryArchive({ archive, atlasHome: home, repoRoot: repo })

    expect(merge).toEqual({ merged: 1, kept: 0 })
    expect(readFileSync(join(home, 'memory', 'fact.md'), 'utf8')).toBe(
      'what the cloud session learned',
    )
  })

  it('keeps host files newer than the sandbox’s copy — another machine wrote them since', async () => {
    const home = staged()
    const repo = staged()
    writeAt({
      path: join(home, 'memory', 'fact.md'),
      content: 'another machine’s newer memory',
      at: NEW,
    })
    const archive = await tarOf([
      { key: '.atlas/memory/fact.md', content: 'the sandbox’s older memory', at: OLD },
    ])

    const merge = await mergeMemoryArchive({ archive, atlasHome: home, repoRoot: repo })

    expect(merge).toEqual({ merged: 0, kept: 1 })
    expect(readFileSync(join(home, 'memory', 'fact.md'), 'utf8')).toBe(
      'another machine’s newer memory',
    )
  })

  it('never deletes host files the archive does not carry', async () => {
    const home = staged()
    const repo = staged()
    writeAt({
      path: join(home, 'memory', 'only-here.md'),
      content: 'the other machine’s memory, never lifted',
      at: NEW,
    })
    const archive = await tarOf([{ key: '.atlas/memory/fact.md', content: 'cloud fact', at: NEW }])

    await mergeMemoryArchive({ archive, atlasHome: home, repoRoot: repo })

    expect(readFileSync(join(home, 'memory', 'only-here.md'), 'utf8')).toBe(
      'the other machine’s memory, never lifted',
    )
  })

  it('skips a key that escapes its memory root rather than writing it', async () => {
    const home = staged()
    const repo = staged()
    const archive = await tarOf([
      { key: '.atlas/memory/../escape.md', content: 'should never land', at: NEW },
    ])

    const merge = await mergeMemoryArchive({ archive, atlasHome: home, repoRoot: repo })

    expect(merge).toEqual({ merged: 0, kept: 0 })
  })
})
