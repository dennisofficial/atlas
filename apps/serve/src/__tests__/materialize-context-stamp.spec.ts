import { describe, expect, it } from 'bun:test'

import { join } from 'node:path'

import { materializeContext } from '../materialize-context'
import type { WorkspaceFiles } from '../workspace-files'
import type { WorkspaceSpec } from '../workspace-spec'
import {
  ATLAS_HOME,
  bundle,
  CONTEXT_STAMP_PATH,
  fakeFiles,
  materialize,
  SPEC,
} from './materialize-context-fixture'

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
      contextBundle: bundle({ '.atlas/mcp.json': '# global instructions' }),
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

  it('keys the readiness identity to the spec’s normalized remote', async () => {
    const { files } = fakeFiles()
    const spec: WorkspaceSpec = {
      ...SPEC,
      remoteUrl: 'git@github.com:dennisofficial/atlas.git',
      contextBundle: bundle({ '.atlas/mcp.json': '{}' }),
    }

    const readiness = await materialize({ spec, files })

    expect(readiness.identity).toBe('github.com/dennisofficial/atlas')
  })

  it('does not re-materialize a stamp that carries a pre-sync skillLayout field', async () => {
    const { files, written } = fakeFiles()
    await files.write({
      path: CONTEXT_STAMP_PATH,
      text: JSON.stringify({ projectDirectory: null, identity: null, skillLayout: 'persistent-v1' }),
    })
    const spec: WorkspaceSpec = { ...SPEC, contextBundle: bundle({ '.atlas/mcp.json': '{}' }) }

    const readiness = await materialize({ spec, files })

    expect(readiness.written).toBe(0)
    expect(written.size).toBe(0)
  })

  it('treats a stamp that will not parse as though a stamp had never been written', async () => {
    const { files, written } = fakeFiles()
    await files.write({ path: CONTEXT_STAMP_PATH, text: 'not json' })
    const spec: WorkspaceSpec = {
      ...SPEC,
      contextBundle: bundle({ '.atlas/mcp.json': '# from the corrupt-stamp boot' }),
    }

    const readiness = await materialize({ spec, files })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null, identity: null })
    expect(written.get(join(ATLAS_HOME, 'mcp.json'))).toBe('# from the corrupt-stamp boot')
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
      contextBundle: bundle({ '.atlas/mcp.json': '# still lands even though the stamp cannot' }),
    }

    const readiness = await materialize({ spec, files: unwritable })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null, identity: null })
    expect(written.get(join(ATLAS_HOME, 'mcp.json'))).toBe(
      '# still lands even though the stamp cannot',
    )
  })
})
