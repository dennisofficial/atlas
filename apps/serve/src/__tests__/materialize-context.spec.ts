import { describe, expect, it } from 'bun:test'

import { materializeContext } from '../materialize-context'
import type { WorkspaceSpec } from '../workspace-spec'
import { ATLAS_HOME, fakeFiles, materialize, SPEC } from './materialize-context-fixture'

describe('materializeContext', () => {
  it('does nothing when the spec carries no archive', async () => {
    const { files, written } = fakeFiles()

    const readiness = await materialize({ spec: SPEC, files })

    expect(readiness).toEqual({ written: 0, failed: null, projectDirectory: null, identity: null })
    expect(written.size).toBe(0)
  })

  it('keys the readiness identity to the spec’s normalized remote', async () => {
    const { files } = fakeFiles()
    const spec: WorkspaceSpec = { ...SPEC, remoteUrl: 'git@github.com:dennisofficial/atlas.git' }

    const readiness = await materialize({ spec, files })

    expect(readiness.identity).toBe('github.com/dennisofficial/atlas')
  })

  it('reports an archive fetch failure rather than silently writing nothing', async () => {
    const { files } = fakeFiles()

    const readiness = await materializeContext({
      fetchSpec: async () => SPEC,
      fetchArchive: async () => {
        throw new Error('the control plane answered 502 for the context archive')
      },
      atlasHome: ATLAS_HOME,
      files,
    })

    expect(readiness.written).toBe(0)
    expect(readiness.failed).toContain('502')
  })

  it('reports an archive that will not extract rather than silently writing nothing', async () => {
    const { files } = fakeFiles()

    const readiness = await materializeContext({
      fetchSpec: async () => SPEC,
      fetchArchive: async () => new Uint8Array([1, 2, 3]),
      atlasHome: ATLAS_HOME,
      files,
    })

    expect(readiness.written).toBe(0)
    expect(readiness.failed).toContain('did not extract')
  })
})
