import { describe, expect, it } from 'bun:test'

import { readProjectFiles, type ProjectFileRows, type SealedFileMountRow } from '../project-files'
import { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'

const KEY = 'a'.repeat(64)

const cipher = new SecretCipher(KEY)

const row = (path: string, contents: string, mode = 0o600): SealedFileMountRow => ({
  path,
  sealedContents: cipher.encrypt(JSON.stringify(contents)),
  mode,
})

const rowsOf = (mounts: readonly SealedFileMountRow[]): ProjectFileRows => ({
  mounts: async () => mounts,
})

describe('readProjectFiles', () => {
  it('unseals the mounted files with their modes', async () => {
    const mounts = await readProjectFiles({
      rows: rowsOf([row('.env.keys', 'DOTENV_PRIVATE_KEY=x'), row('~/notes.md', 'hi', 0o644)]),
      cipher,
      projectId: 'prj-1',
    })

    expect(mounts).toEqual([
      { path: '.env.keys', contents: 'DOTENV_PRIVATE_KEY=x', mode: 0o600 },
      { path: '~/notes.md', contents: 'hi', mode: 0o644 },
    ])
  })

  it('drops a row whose contents do not open', async () => {
    const mounts = await readProjectFiles({
      rows: rowsOf([row('.env', 'KEY=1'), { path: 'broken', sealedContents: 'nope', mode: 0o600 }]),
      cipher,
      projectId: 'prj-1',
    })

    expect(mounts).toEqual([{ path: '.env', contents: 'KEY=1', mode: 0o600 }])
  })
})
