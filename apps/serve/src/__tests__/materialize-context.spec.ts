import { describe, expect, it } from 'bun:test'

import { join } from 'node:path'

import { materializeContext } from '../materialize-context'
import type { WorkspaceSpec } from '../workspace-spec'
import { ATLAS_HOME, bundle, fakeFiles, materialize, SPEC } from './materialize-context-fixture'

const MCP_CONFIG = '{"mcpServers":{}}'

describe('materializeContext', () => {
  it('writes the local mcp config onto the serve’s atlas home', async () => {
    const { files, written } = fakeFiles()
    const spec: WorkspaceSpec = { ...SPEC, contextBundle: bundle({ '.atlas/mcp.json': MCP_CONFIG }) }

    const readiness = await materialize({ spec, files })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null, identity: null })
    expect(written.get(join(ATLAS_HOME, 'mcp.json'))).toBe(MCP_CONFIG)
  })

  it.each([
    '.atlas/skills/review/SKILL.md',
    '.agents/skills/explore/SKILL.md',
    '.claude/skills/notes.md',
    '.atlas/ATLAS.md',
    '.atlas/memory/MEMORY.md',
    'project-memory/MEMORY.md',
    'project/ATLAS.local.md',
  ])('leaves user-layer entry %s to the sync engine', async (path) => {
    const { files, written } = fakeFiles()
    const spec: WorkspaceSpec = { ...SPEC, contextBundle: bundle({ [path]: '# user layer' }) }

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
    const legacy = { remoteUrl: null, branch: null, commit: null, patch: '', githubToken: null }

    const readiness = await materializeContext({
      fetchSpec: async () => legacy as WorkspaceSpec,
      atlasHome: ATLAS_HOME,
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

  it('refuses paths that climb out of the atlas home', async () => {
    const { files, written } = fakeFiles()
    const spec: WorkspaceSpec = {
      ...SPEC,
      contextBundle: bundle({ '../escape/mcp.json': '# nope', '.atlas/mcp.json': MCP_CONFIG }),
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
      contextBundle: JSON.stringify({ '.atlas/mcp.json': rawBytes.toString('base64') }),
    }

    const readiness = await materialize({ spec, files })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null, identity: null })
    expect(writtenBytes.get(join(ATLAS_HOME, 'mcp.json'))).toEqual(rawBytes)
  })
})
