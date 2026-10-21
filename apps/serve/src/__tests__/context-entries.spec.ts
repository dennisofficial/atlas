import { describe, expect, it } from 'vitest'

import { sandboxUserLayerTrees } from '@dltech/atlas-harness'

import { writeContextEntries } from '../context-entries'
import { ATLAS_HOME, fakeFiles } from './workspace-files-fixture'

const PROJECT_DIRECTORY = '/srv/workspace/atlas'

describe('writeContextEntries', () => {
  it('refuses traversal keys and skips keys that name no supported tree, before any write', async () => {
    const { files, written } = fakeFiles()
    const trees = sandboxUserLayerTrees({
      atlasHome: ATLAS_HOME,
      projectDirectory: PROJECT_DIRECTORY,
    })
    const entry = (path: string) => ({ path, readBytes: async () => Buffer.from('x') })

    const outcome = await writeContextEntries({
      files,
      entries: [
        entry('user-layer/skills/../../etc/x'),
        entry('user-layer/skills/.atlas/../../etc/x'),
        entry('user-layer/memory/user/a/b.md'),
        entry('user-layer/bogus/x'),
      ],
      targets: { atlasHome: ATLAS_HOME, userLayerTrees: trees },
      overwrite: true,
    })

    expect(outcome).toEqual({ written: 0, failed: null })
    expect(written.size).toBe(0)
  })
})
