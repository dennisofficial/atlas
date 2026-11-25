import { describe, expect, it } from 'bun:test'

import { FileSystemPort, type FileStat, type FileSystemEntry } from '@dltech/atlas-core'
import type { CapturedBase } from '@dltech/atlas-host'

import {
  ECapturedBasesState,
  readCapturedBases,
  replayCapturedBases,
  writeCapturedBases,
} from '../workspace-bases'
import { markMaterialized } from '../workspace-materialize'
import { checkSentinels, type Deps } from '../workspace-state'
import { RecordingProcessPort } from './workspace-fakes'

class MemoryFiles extends FileSystemPort {
  readonly contents = new Map<string, string>()
  readonly writes: string[] = []
  readonly directories = new Set<string>()
  failingWrite: string | null = null
  failingRename = false
  droppingWrites = false

  override stat(args: { path: string }): Promise<FileStat> {
    const present = this.contents.has(args.path) || this.directories.has(args.path)
    if (!present) return Promise.reject(new Error('missing'))
    return Promise.resolve({
      size: this.contents.get(args.path)?.length ?? 0,
      mode: 0o644,
      mtimeMs: 0,
      isFile: () => !this.directories.has(args.path),
      isDirectory: () => this.directories.has(args.path),
    })
  }

  override readLink(): Promise<string | null> {
    return Promise.resolve(null)
  }

  override readFile(args: { path: string }): Promise<string> {
    const content = this.contents.get(args.path)
    return content === undefined
      ? Promise.reject(new Error(`missing ${args.path}`))
      : Promise.resolve(content)
  }

  override readBytes(args: { path: string }): Promise<Uint8Array> {
    return this.readFile(args).then((text) => new TextEncoder().encode(text))
  }

  override readTextForEdit(args: {
    path: string
  }): Promise<{ text: string; strict: string | null }> {
    return this.readFile(args).then((text) => ({ text, strict: text }))
  }

  override writeFile(args: { path: string; content: string | Uint8Array }): Promise<void> {
    this.writes.push(args.path)
    if (args.path === this.failingWrite) return Promise.reject(new Error('disk full'))
    if (this.droppingWrites) return Promise.resolve()
    this.contents.set(
      args.path,
      typeof args.content === 'string' ? args.content : new TextDecoder().decode(args.content),
    )
    return Promise.resolve()
  }

  override removeFile(args: { path: string }): Promise<void> {
    this.contents.delete(args.path)
    return Promise.resolve()
  }

  override mkdir(args: { path: string }): Promise<void> {
    this.directories.add(args.path)
    return Promise.resolve()
  }

  override rename(args: { from: string; to: string }): Promise<void> {
    if (this.failingRename) return Promise.reject(new Error('rename refused'))
    const content = this.contents.get(args.from)
    if (content === undefined) return Promise.reject(new Error(`missing ${args.from}`))
    this.contents.delete(args.from)
    this.contents.set(args.to, content)
    return Promise.resolve()
  }

  override readDirectory(): Promise<readonly FileSystemEntry[]> {
    return Promise.resolve([])
  }

  override glob(): Promise<readonly string[]> {
    return Promise.resolve([])
  }
}

const bases: readonly CapturedBase[] = [{ repoPath: '/workspace', base: 'main' }]

const filesAt = (): MemoryFiles => {
  const files = new MemoryFiles()
  files.directories.add('/workspace')
  return files
}

const depsOf = (files: MemoryFiles): Deps => ({
  processes: new RecordingProcessPort(),
  files,
  warnings: [],
})

describe('captured bases persistence', () => {
  it('publishes the bases through a partial file and reads them back', async () => {
    const files = filesAt()
    const written = await writeCapturedBases({ files, path: '/state/session-bases', bases })

    expect(written).toBe(true)
    expect(files.writes).toEqual(['/state/session-bases.partial'])
    expect([...files.contents.keys()]).toEqual(['/state/session-bases'])
    expect(await readCapturedBases({ files, path: '/state/session-bases' })).toEqual({
      state: ECapturedBasesState.Present,
      bases,
    })
  })

  it('reports a write that never reaches the file', async () => {
    const files = filesAt()
    files.droppingWrites = true

    expect(await writeCapturedBases({ files, path: '/state/session-bases', bases })).toBe(false)
  })

  it('reads a corrupt bases file as corrupt, never as an empty list', async () => {
    const files = filesAt()
    files.contents.set('/state/session-bases', '{"repoPath":')

    expect(await readCapturedBases({ files, path: '/state/session-bases' })).toEqual({
      state: ECapturedBasesState.Corrupt,
      detail: '/state/session-bases',
    })
  })

  it('warns instead of replaying a corrupt bases file as empty', async () => {
    const files = filesAt()
    files.contents.set('/state/session-bases', '[{"repoPath":"/workspace"}]')
    const deps = depsOf(files)

    const replayed = await replayCapturedBases({
      deps,
      path: '/state/session-bases',
      expectedRepos: 1,
    })

    expect(replayed).toEqual([])
    expect(deps.warnings).toEqual([
      'the captured session bases are unreadable; diffs fall back to the base branch: /state/session-bases',
    ])
  })
})

describe('marking a workspace materialized', () => {
  it('writes the sentinel after the bases are persisted', async () => {
    const files = filesAt()

    const marked = await markMaterialized({
      deps: depsOf(files),
      basesPath: '/state/session-bases',
      sentinelPath: '/state/workspace-materialized',
      bases,
    })

    expect(marked).toBe(true)
    expect(files.contents.get('/state/workspace-materialized')).toBeString()
    expect(await readCapturedBases({ files, path: '/state/session-bases' })).toEqual({
      state: ECapturedBasesState.Present,
      bases,
    })
  })

  it('leaves no sentinel when the bases cannot be written, so the next prepare captures again', async () => {
    const files = filesAt()
    files.failingWrite = '/state/session-bases.partial'
    const deps = depsOf(files)

    const marked = await markMaterialized({
      deps,
      basesPath: '/state/session-bases',
      sentinelPath: '/state/workspace-materialized',
      bases,
    })

    expect(marked).toBe(false)
    expect(files.contents.has('/state/workspace-materialized')).toBe(false)
    expect(files.contents.has('/state/session-bases.partial')).toBe(false)
    expect(deps.warnings).toHaveLength(1)
    expect(
      await checkSentinels({
        deps,
        sentinels: {
          materialized: '/state/workspace-materialized',
          setupRan: '/state/setup-ran',
          setupStarted: '/state/setup-started',
          primary: '/state/primary-cloned',
          bases: '/state/session-bases',
        },
        launchDirectory: '/workspace',
      }),
    ).toEqual({ materialized: false, setupRan: false, setupStarted: undefined })
  })

  it('leaves no sentinel when the bases file cannot be published', async () => {
    const files = filesAt()
    files.failingRename = true
    const deps = depsOf(files)

    const marked = await markMaterialized({
      deps,
      basesPath: '/state/session-bases',
      sentinelPath: '/state/workspace-materialized',
      bases,
    })

    expect(marked).toBe(false)
    expect(files.contents.size).toBe(0)
    expect(deps.warnings).toHaveLength(1)
  })

  it('leaves no sentinel when the persisted bases do not read back', async () => {
    const files = filesAt()
    files.droppingWrites = true
    const deps = depsOf(files)

    const marked = await markMaterialized({
      deps,
      basesPath: '/state/session-bases',
      sentinelPath: '/state/workspace-materialized',
      bases,
    })

    expect(marked).toBe(false)
    expect(files.contents.has('/state/workspace-materialized')).toBe(false)
  })
})
