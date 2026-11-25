import { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { describe, expect, it } from 'bun:test'

import type { ScopedFileMount } from '../../runtime/project-files'
import {
  mergedFileMounts,
  readProjectFiles,
  type ProjectFileRows,
  type SealedFileMountRow,
} from '../project-files'

const KEY = 'a'.repeat(64)

const cipher = new SecretCipher(KEY)

const row = (path: string, contents: string, mode = 0o600): SealedFileMountRow => ({
  path,
  sealedContents: cipher.encrypt(JSON.stringify(contents)),
  mode,
})

const rowsOf = (args: {
  projectMounts?: readonly SealedFileMountRow[]
  userMounts?: readonly SealedFileMountRow[]
}): ProjectFileRows => ({
  projectMounts: async () => args.projectMounts ?? [],
  userMounts: async () => args.userMounts ?? [],
})

const mountOf = (path: string, contents: string): ScopedFileMount => ({
  path,
  contents,
  mode: 0o600,
})

describe('mergedFileMounts', () => {
  it('keeps the project mount when a personal mount holds the same path', () => {
    const mounts = mergedFileMounts({
      projectMounts: [mountOf('~/notes.md', 'project')],
      userMounts: [mountOf('~/notes.md', 'personal'), mountOf('~/.npmrc', 'personal')],
    })

    expect(mounts).toEqual([mountOf('~/.npmrc', 'personal'), mountOf('~/notes.md', 'project')])
  })

  it('returns the personal mounts of a session without a project', () => {
    const mounts = mergedFileMounts({
      projectMounts: [],
      userMounts: [mountOf('~/.npmrc', 'personal')],
    })

    expect(mounts).toEqual([mountOf('~/.npmrc', 'personal')])
  })
})

describe('readProjectFiles', () => {
  it('unseals the project and personal mounts with their modes', async () => {
    const mounts = await readProjectFiles({
      rows: rowsOf({
        projectMounts: [row('.env.keys', 'DOTENV_PRIVATE_KEY=x')],
        userMounts: [row('~/notes.md', 'hi', 0o644)],
      }),
      cipher,
      userId: 'user-1',
      projectId: 'prj-1',
    })

    expect(mounts).toEqual([
      { path: '.env.keys', contents: 'DOTENV_PRIVATE_KEY=x', mode: 0o600 },
      { path: '~/notes.md', contents: 'hi', mode: 0o644 },
    ])
  })

  it('reads the personal mounts of a session that has no project', async () => {
    const mounts = await readProjectFiles({
      rows: rowsOf({ userMounts: [row('~/.npmrc', 'registry=x')] }),
      cipher,
      userId: 'user-1',
      projectId: null,
    })

    expect(mounts).toEqual([{ path: '~/.npmrc', contents: 'registry=x', mode: 0o600 }])
  })

  it('drops a row whose contents do not open', async () => {
    const mounts = await readProjectFiles({
      rows: rowsOf({
        projectMounts: [
          row('.env', 'KEY=1'),
          { path: 'broken', sealedContents: 'nope', mode: 0o600 },
        ],
      }),
      cipher,
      userId: 'user-1',
      projectId: 'prj-1',
    })

    expect(mounts).toEqual([{ path: '.env', contents: 'KEY=1', mode: 0o600 }])
  })
})
