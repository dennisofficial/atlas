import { describe, expect, it } from 'bun:test'

import { mkdtemp, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildContextArchive } from '../../cloud/context-archive'
import { memoryDirectoriesFor } from '../../memory/read-memory'
import { materializeContext } from '../materialize-context'
import type { WorkspaceFiles } from '../workspace-files'
import type { FetchContextArchive } from '../workspace-spec'
import type { WorkspaceSpec } from '../workspace-spec'

const ATLAS_HOME = '/srv/atlas-home'
const CWD = '/srv/workspace'

const SPEC: WorkspaceSpec = {
  remoteUrl: null,
  branch: null,
  commit: null,
  patch: '',
  githubToken: null,
  contextBundle: null,
}

const fakeFiles = () => {
  const written = new Map<string, string>()
  const writtenBytes = new Map<string, Buffer>()
  const stamped = new Map<string, string>()
  const files: WorkspaceFiles = {
    exists: async (path) => stamped.has(path),
    read: async (path) => {
      const text = stamped.get(path)
      if (text === undefined) throw new Error(`no such file: ${path}`)
      return text
    },
    write: async ({ path, text }) => {
      stamped.set(path, text)
    },
    writeBytes: async ({ path, bytes }) => {
      writtenBytes.set(path, bytes)
      written.set(path, bytes.toString('utf8'))
    },
    empty: async () => undefined,
  }
  return { files, written, writtenBytes, stamped }
}

const CONTEXT_STAMP_PATH = join(ATLAS_HOME, 'context.stamp')

const bundle = (entries: Record<string, string>): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(entries).map(([path, text]) => [path, Buffer.from(text, 'utf8').toString('base64')]),
    ),
  )

const materialize = (args: { spec: WorkspaceSpec; files: WorkspaceFiles }) =>
  materializeContext({ fetchSpec: async () => args.spec, atlasHome: ATLAS_HOME, cwd: CWD, files: args.files })

describe('materializeContext', () => {
  it('writes each skill flavour where the serve’s registry looks for it', async () => {
    const { files, written } = fakeFiles()
    const spec: WorkspaceSpec = {
      ...SPEC,
      contextBundle: bundle({
        '.atlas/skills/review/SKILL.md': '# review',
        '.agents/skills/explore/SKILL.md': '# explore',
        '.claude/skills/notes.md': '# notes',
      }),
    }

    const readiness = await materialize({ spec, files })

    expect(readiness).toEqual({ written: 3, failed: null, projectDirectory: null, identity: null })
    expect(written.get('/srv/atlas-home/skills/review/SKILL.md')).toBe('# review')
    expect(written.get(join(homedir(), '.agents', 'skills', 'explore', 'SKILL.md'))).toBe(
      '# explore',
    )
    expect(written.get(join(homedir(), '.claude', 'skills', 'notes.md'))).toBe('# notes')
    expect(written.size).toBe(3)
  })

  it('writes the global instructions file onto the serve’s atlas home', async () => {
    const { files, written } = fakeFiles()
    const spec: WorkspaceSpec = {
      ...SPEC,
      contextBundle: bundle({ '.atlas/ATLAS.md': '# global instructions' }),
    }

    const readiness = await materialize({ spec, files })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null, identity: null })
    expect(written.get(join(ATLAS_HOME, 'ATLAS.md'))).toBe('# global instructions')
  })

  it('writes the local mcp config onto the serve’s atlas home', async () => {
    const { files, written } = fakeFiles()
    const spec: WorkspaceSpec = {
      ...SPEC,
      contextBundle: bundle({ '.atlas/mcp.json': '{"mcpServers":{}}' }),
    }

    const readiness = await materialize({ spec, files })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null, identity: null })
    expect(written.get(join(ATLAS_HOME, 'mcp.json'))).toBe('{"mcpServers":{}}')
  })

  it('writes user memory files under the serve’s atlas home memory directory', async () => {
    const { files, written } = fakeFiles()
    const spec: WorkspaceSpec = {
      ...SPEC,
      contextBundle: bundle({ '.atlas/memory/MEMORY.md': '# user memory' }),
    }

    const readiness = await materialize({ spec, files })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null, identity: null })
    expect(written.get(join(ATLAS_HOME, 'memory', 'MEMORY.md'))).toBe('# user memory')
  })

  it('writes project memory into the serve’s own project memory directory, keyed independently of the Mac path', async () => {
    const { files, written } = fakeFiles()
    const spec: WorkspaceSpec = {
      ...SPEC,
      contextBundle: bundle({ 'project-memory/MEMORY.md': '# project memory' }),
    }

    const readiness = await materialize({ spec, files })
    const projectMemoryDirectory = memoryDirectoriesFor({ atlasHome: ATLAS_HOME, repoRoot: CWD }).project

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null, identity: null })
    expect(written.get(join(projectMemoryDirectory, 'MEMORY.md'))).toBe('# project memory')
  })

  it('writes gitignored project-local instruction files into the workspace root', async () => {
    const { files, written } = fakeFiles()
    const spec: WorkspaceSpec = {
      ...SPEC,
      contextBundle: bundle({ 'project/ATLAS.local.md': '# only on this machine' }),
    }

    const readiness = await materialize({ spec, files })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null, identity: null })
    expect(written.get(join(CWD, 'ATLAS.local.md'))).toBe('# only on this machine')
  })

  it('refuses a project-local key that tries to nest into a subdirectory', async () => {
    const { files, written } = fakeFiles()
    const spec: WorkspaceSpec = {
      ...SPEC,
      contextBundle: bundle({ 'project/nested/ATLAS.local.md': '# nope' }),
    }

    const readiness = await materialize({ spec, files })

    expect(readiness).toEqual({ written: 0, failed: null, projectDirectory: null, identity: null })
    expect(written.size).toBe(0)
  })

  it('does nothing when the spec carries no bundle', async () => {
    const { files, written } = fakeFiles()

    const readiness = await materialize({ spec: SPEC, files })

    expect(readiness).toEqual({ written: 0, failed: null, projectDirectory: null, identity: null })
    expect(written.size).toBe(0)
  })

  it('tolerates an older control plane that does not know the field', async () => {
    const { files } = fakeFiles()
    const legacy = {
      remoteUrl: null,
      branch: null,
      commit: null,
      patch: '',
      githubToken: null,
    }

    const readiness = await materializeContext({
      fetchSpec: async () => legacy as WorkspaceSpec,
      atlasHome: ATLAS_HOME,
      cwd: CWD,
      files,
    })

    expect(readiness).toEqual({ written: 0, failed: null, projectDirectory: null, identity: null })
  })

  it('reports an unparseable bundle without failing the boot', async () => {
    const { files } = fakeFiles()

    const readiness = await materialize({ spec: { ...SPEC, contextBundle: 'not json' }, files })

    expect(readiness.written).toBe(0)
    expect(readiness.failed).toContain('did not parse')
  })

  it('refuses paths that climb out of the skill roots', async () => {
    const { files, written } = fakeFiles()
    const spec: WorkspaceSpec = {
      ...SPEC,
      contextBundle: bundle({
        '../escape/SKILL.md': '# nope',
        '.atlas/skills/good/SKILL.md': '# fine',
      }),
    }

    const readiness = await materialize({ spec, files })

    expect(readiness.written).toBe(1)
    expect([...written.keys()].every((path) => !path.includes('escape'))).toBe(true)
  })

  it('carries the spec’s projectDirectory back out, so the caller can key memory uploads by it', async () => {
    const { files } = fakeFiles()
    const spec: WorkspaceSpec = { ...SPEC, projectDirectory: '/Users/dennis/dev/atlas' }

    const readiness = await materialize({ spec, files })

    expect(readiness.projectDirectory).toBe('/Users/dennis/dev/atlas')
  })

  it('preserves non-UTF8 bytes instead of corrupting them through a text round trip', async () => {
    const { files, writtenBytes } = fakeFiles()
    const rawBytes = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02])
    const spec: WorkspaceSpec = {
      ...SPEC,
      contextBundle: JSON.stringify({ '.atlas/skills/icons/logo.png': rawBytes.toString('base64') }),
    }

    const readiness = await materialize({ spec, files })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null, identity: null })
    expect(writtenBytes.get(join(ATLAS_HOME, 'skills', 'icons', 'logo.png'))).toEqual(rawBytes)
  })
})

describe('materializeContext with an archive fetcher', () => {
  it('writes from the archive when the fetcher answers one, without ever touching the legacy bundle', async () => {
    const { files, written } = fakeFiles()
    const staging = await mkdtemp(join(tmpdir(), 'atlas-materialize-archive-'))
    const source = join(staging, 'ATLAS.md')
    await writeFile(source, '# from the archive', 'utf8')
    const archive = await buildContextArchive({ files: [{ key: '.atlas/ATLAS.md', path: source }] })
    if (archive === undefined) throw new Error('expected an archive')
    const fetchArchive: FetchContextArchive = async () => archive

    const readiness = await materializeContext({
      fetchSpec: async () => ({ ...SPEC, contextBundle: bundle({ '.atlas/ATLAS.md': '# ignored legacy value' }) }),
      fetchArchive,
      atlasHome: ATLAS_HOME,
      cwd: CWD,
      files,
    })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null, identity: null })
    expect(written.get(join(ATLAS_HOME, 'ATLAS.md'))).toBe('# from the archive')
  })

  it('falls back to the legacy contextBundle JSON once a persistent 404 exhausts the retry bound', async () => {
    const { files, written } = fakeFiles()
    const spec: WorkspaceSpec = { ...SPEC, contextBundle: bundle({ '.atlas/ATLAS.md': '# legacy fallback' }) }
    let calls = 0
    const fetchArchive: FetchContextArchive = async () => {
      calls += 1
      return null
    }
    const slept: number[] = []

    const readiness = await materializeContext({
      fetchSpec: async () => spec,
      fetchArchive,
      archiveRetry: { attempts: 3, intervalMs: 3_000, sleep: async (ms) => void slept.push(ms) },
      atlasHome: ATLAS_HOME,
      cwd: CWD,
      files,
    })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null, identity: null })
    expect(written.get(join(ATLAS_HOME, 'ATLAS.md'))).toBe('# legacy fallback')
    expect(calls).toBe(3)
    expect(slept).toEqual([3_000, 3_000])
  })

  it('materializes from the archive once a 404 clears within the retry window, without waiting out the whole bound', async () => {
    const { files, written } = fakeFiles()
    const staging = await mkdtemp(join(tmpdir(), 'atlas-materialize-archive-retry-'))
    const source = join(staging, 'ATLAS.md')
    await writeFile(source, '# landed on the second try', 'utf8')
    const archive = await buildContextArchive({ files: [{ key: '.atlas/ATLAS.md', path: source }] })
    if (archive === undefined) throw new Error('expected an archive')
    let calls = 0
    const fetchArchive: FetchContextArchive = async () => {
      calls += 1
      return calls < 2 ? null : archive
    }
    const slept: number[] = []

    const readiness = await materializeContext({
      fetchSpec: async () => SPEC,
      fetchArchive,
      archiveRetry: { attempts: 30, intervalMs: 3_000, sleep: async (ms) => void slept.push(ms) },
      atlasHome: ATLAS_HOME,
      cwd: CWD,
      files,
    })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null, identity: null })
    expect(written.get(join(ATLAS_HOME, 'ATLAS.md'))).toBe('# landed on the second try')
    expect(calls).toBe(2)
    expect(slept).toEqual([3_000])
  })

  it('never retries a thrown transport error, unlike a 404', async () => {
    const { files } = fakeFiles()
    let calls = 0
    const fetchArchive: FetchContextArchive = async () => {
      calls += 1
      throw new Error('the control plane answered 502 for the context archive')
    }
    const slept: number[] = []

    const readiness = await materializeContext({
      fetchSpec: async () => SPEC,
      fetchArchive,
      archiveRetry: { attempts: 30, intervalMs: 3_000, sleep: async (ms) => void slept.push(ms) },
      atlasHome: ATLAS_HOME,
      cwd: CWD,
      files,
    })

    expect(readiness.written).toBe(0)
    expect(readiness.failed).toContain('502')
    expect(calls).toBe(1)
    expect(slept).toEqual([])
  })

  it('reports a genuine archive-fetch failure rather than silently falling back', async () => {
    const { files } = fakeFiles()
    const fetchArchive: FetchContextArchive = async () => {
      throw new Error('the control plane answered 502 for the context archive')
    }

    const readiness = await materializeContext({
      fetchSpec: async () => SPEC,
      fetchArchive,
      atlasHome: ATLAS_HOME,
      cwd: CWD,
      files,
    })

    expect(readiness.written).toBe(0)
    expect(readiness.failed).toContain('502')
  })

  it('reports an archive that will not extract rather than silently writing nothing', async () => {
    const { files } = fakeFiles()
    const fetchArchive: FetchContextArchive = async () => new Uint8Array([1, 2, 3])

    const readiness = await materializeContext({
      fetchSpec: async () => SPEC,
      fetchArchive,
      atlasHome: ATLAS_HOME,
      cwd: CWD,
      files,
    })

    expect(readiness.written).toBe(0)
    expect(readiness.failed).toContain('did not extract')
  })
})

describe('materializeContext with a resume stamp', () => {
  it('skips materialization entirely once a resumed sandbox finds its stamp already on disk', async () => {
    const { files, written } = fakeFiles()
    await files.write({
      path: CONTEXT_STAMP_PATH,
      text: JSON.stringify({ projectDirectory: '/Users/dennis/dev/atlas' }),
    })
    let specCalls = 0
    let archiveCalls = 0

    const readiness = await materializeContext({
      fetchSpec: async () => {
        specCalls += 1
        return SPEC
      },
      fetchArchive: async () => {
        archiveCalls += 1
        return null
      },
      atlasHome: ATLAS_HOME,
      cwd: CWD,
      files,
    })

    expect(readiness).toEqual({
      written: 0,
      failed: null,
      projectDirectory: '/Users/dennis/dev/atlas',
      identity: null,
    })
    expect(specCalls).toBe(0)
    expect(archiveCalls).toBe(0)
    expect(written.size).toBe(0)
  })

  it('writes the stamp once a fresh boot materializes its bundle, keyed to the spec’s projectDirectory', async () => {
    const { files, stamped } = fakeFiles()
    const spec: WorkspaceSpec = {
      ...SPEC,
      contextBundle: bundle({ '.atlas/ATLAS.md': '# global instructions' }),
      projectDirectory: '/Users/dennis/dev/atlas',
    }

    const readiness = await materialize({ spec, files })

    expect(readiness).toEqual({
      written: 1,
      failed: null,
      projectDirectory: '/Users/dennis/dev/atlas',
      identity: null,
    })
    expect(JSON.parse(stamped.get(CONTEXT_STAMP_PATH) ?? '')).toEqual({
      projectDirectory: '/Users/dennis/dev/atlas',
      identity: null,
    })
  })

  it('writes project memory into the identity-keyed directory the host shares when the spec names a remote', async () => {
    const { files, written } = fakeFiles()
    const spec: WorkspaceSpec = {
      ...SPEC,
      remoteUrl: 'git@github.com:dennisofficial/atlas.git',
      contextBundle: bundle({ 'project-memory/MEMORY.md': '# project memory' }),
    }

    const readiness = await materialize({ spec, files })

    expect(readiness.identity).toBe('github.com/dennisofficial/atlas')
    expect(
      written.get(
        join(ATLAS_HOME, 'projects', 'github.com', 'dennisofficial', 'atlas', 'memory', 'MEMORY.md'),
      ),
    ).toBe('# project memory')
  })

  it('treats a stamp that will not parse as though a stamp had never been written', async () => {
    const { files, written } = fakeFiles()
    await files.write({ path: CONTEXT_STAMP_PATH, text: 'not json' })
    const spec: WorkspaceSpec = {
      ...SPEC,
      contextBundle: bundle({ '.atlas/ATLAS.md': '# from the corrupt-stamp boot' }),
    }

    const readiness = await materialize({ spec, files })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null, identity: null })
    expect(written.get(join(ATLAS_HOME, 'ATLAS.md'))).toBe('# from the corrupt-stamp boot')
  })

  it('does not fail the boot when the stamp itself cannot be written', async () => {
    const { files, written } = fakeFiles()
    const unwritable: WorkspaceFiles = {
      ...files,
      write: async () => {
        throw new Error('disk is read-only')
      },
    }
    const spec: WorkspaceSpec = {
      ...SPEC,
      contextBundle: bundle({ '.atlas/ATLAS.md': '# still lands even though the stamp cannot' }),
    }

    const readiness = await materialize({ spec, files: unwritable })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null, identity: null })
    expect(written.get(join(ATLAS_HOME, 'ATLAS.md'))).toBe(
      '# still lands even though the stamp cannot',
    )
  })
})
