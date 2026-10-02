import { readFile } from 'node:fs/promises'

import type { RestoredWorkspace, WorkspaceManifest } from '../../../workspace/transfer/manifest'
import type { WorkspaceRestorer } from '../descend-workspace'
import type { WorkspaceRestoration } from '../../../workspace/transfer/restore'

export const EXPORT_PATH = '/tmp/atlas-workspace-export-x/workspace.tar.gz'

export const DUMMY_ARCHIVE = Buffer.from('a fake workspace archive')

export const WORKSPACE_MANIFEST: WorkspaceManifest = {
  version: 1,
  repository: { sourcePath: '/atlas/workspace', originPath: '/work' },
  activeId: 'main',
  activeRelativePath: '',
  trees: [
    {
      id: 'main',
      name: 'main',
      sourcePath: '/atlas/workspace',
      originPath: '/work',
      branch: 'main',
      head: null,
      baseline: null,
      fingerprint: 'fake',
      isMain: true,
    },
  ],
}

export const PREPARE_REPLY = { path: EXPORT_PATH, manifest: WORKSPACE_MANIFEST }

export const RESTORED_HOME: RestoredWorkspace = { cwd: '/work', repository: '/work', trees: [] }

export type RestoreCall = Parameters<WorkspaceRestorer>[0] & { archive: Buffer }

export type FakeRestorer = {
  restore: WorkspaceRestorer
  readonly calls: readonly RestoreCall[]
  readonly commits: number
  readonly rollbacks: number
}

export const fakeRestorer = (
  args: {
    result?: RestoredWorkspace
    fails?: unknown
    transactional?: boolean
    trail?: string[]
    onRestore?: () => Promise<void>
    commitFails?: unknown
  } = {},
): FakeRestorer => {
  const calls: RestoreCall[] = []
  let commits = 0
  let rollbacks = 0
  return {
    calls,
    get commits() {
      return commits
    },
    get rollbacks() {
      return rollbacks
    },
    restore: async (given) => {
      calls.push({ ...given, archive: await readFile(given.archivePath) })
      args.trail?.push('restore')
      await args.onRestore?.()
      if (args.fails !== undefined) throw args.fails
      const restored = args.result ?? RESTORED_HOME
      if (args.transactional !== true) return restored
      const restoration: WorkspaceRestoration = {
        restored,
        commit: async () => {
          commits += 1
          args.trail?.push('commit')
          if (args.commitFails !== undefined) throw args.commitFails
        },
        rollback: async () => {
          rollbacks += 1
          args.trail?.push('rollback')
        },
      }
      return restoration
    },
  }
}
