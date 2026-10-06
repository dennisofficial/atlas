import { describe, expect, it } from 'bun:test'

import { join } from 'node:path'

import { materializeContext } from '../materialize-context'
import type { WorkspaceFiles } from '../workspace-files'
import type { WorkspaceSpec } from '../workspace-spec'
import {
  ATLAS_HOME,
  bundle,
  CONTEXT_STAMP_PATH,
  CWD,
  fakeFiles,
  materialize,
  SPEC,
} from './materialize-context-fixture'

describe('materializeContext with a resume stamp', () => {
  it('skips materialization entirely once a resumed sandbox finds its stamp already on disk', async () => {
    const { files, written } = fakeFiles()
    await files.write({
      path: CONTEXT_STAMP_PATH,
      text: JSON.stringify({ projectDirectory: '/Users/dennis/dev/atlas', skillLayout: 'persistent-v1' }),
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
      skillLayout: 'persistent-v1',
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
