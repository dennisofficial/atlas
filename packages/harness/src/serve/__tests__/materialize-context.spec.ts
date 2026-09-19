import { describe, expect, it } from 'bun:test'

import { homedir } from 'node:os'
import { join } from 'node:path'

import { memoryDirectoriesFor } from '../../memory/read-memory'
import { materializeContext } from '../materialize-context'
import type { WorkspaceFiles } from '../workspace-files'
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
  const files: WorkspaceFiles = {
    exists: async () => false,
    write: async ({ path, text }) => {
      written.set(path, text)
    },
    writeBytes: async ({ path, bytes }) => {
      writtenBytes.set(path, bytes)
      written.set(path, bytes.toString('utf8'))
    },
    empty: async () => undefined,
  }
  return { files, written, writtenBytes }
}

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

    expect(readiness).toEqual({ written: 3, failed: null, projectDirectory: null })
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

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null })
    expect(written.get(join(ATLAS_HOME, 'ATLAS.md'))).toBe('# global instructions')
  })

  it('writes the local mcp config onto the serve’s atlas home', async () => {
    const { files, written } = fakeFiles()
    const spec: WorkspaceSpec = {
      ...SPEC,
      contextBundle: bundle({ '.atlas/mcp.json': '{"mcpServers":{}}' }),
    }

    const readiness = await materialize({ spec, files })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null })
    expect(written.get(join(ATLAS_HOME, 'mcp.json'))).toBe('{"mcpServers":{}}')
  })

  it('writes user memory files under the serve’s atlas home memory directory', async () => {
    const { files, written } = fakeFiles()
    const spec: WorkspaceSpec = {
      ...SPEC,
      contextBundle: bundle({ '.atlas/memory/MEMORY.md': '# user memory' }),
    }

    const readiness = await materialize({ spec, files })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null })
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

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null })
    expect(written.get(join(projectMemoryDirectory, 'MEMORY.md'))).toBe('# project memory')
  })

  it('writes gitignored project-local instruction files into the workspace root', async () => {
    const { files, written } = fakeFiles()
    const spec: WorkspaceSpec = {
      ...SPEC,
      contextBundle: bundle({ 'project/ATLAS.local.md': '# only on this machine' }),
    }

    const readiness = await materialize({ spec, files })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null })
    expect(written.get(join(CWD, 'ATLAS.local.md'))).toBe('# only on this machine')
  })

  it('refuses a project-local key that tries to nest into a subdirectory', async () => {
    const { files, written } = fakeFiles()
    const spec: WorkspaceSpec = {
      ...SPEC,
      contextBundle: bundle({ 'project/nested/ATLAS.local.md': '# nope' }),
    }

    const readiness = await materialize({ spec, files })

    expect(readiness).toEqual({ written: 0, failed: null, projectDirectory: null })
    expect(written.size).toBe(0)
  })

  it('does nothing when the spec carries no bundle', async () => {
    const { files, written } = fakeFiles()

    const readiness = await materialize({ spec: SPEC, files })

    expect(readiness).toEqual({ written: 0, failed: null, projectDirectory: null })
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

    expect(readiness).toEqual({ written: 0, failed: null, projectDirectory: null })
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

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null })
    expect(writtenBytes.get(join(ATLAS_HOME, 'skills', 'icons', 'logo.png'))).toEqual(rawBytes)
  })
})
