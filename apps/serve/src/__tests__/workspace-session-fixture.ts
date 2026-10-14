import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'
import type { RestoredWorkspace } from '@dltech/atlas-harness'

import { createDirectWorkspace, type DirectWorkspace } from '../direct-workspace'
import { driveWorkspaceArchivePath } from '../drive-bootstrap'
import { createWorkspaceSession } from '../workspace-session'

export const rootThread = toThreadId('root-thread')

const homes: string[] = []

export const removeFixtureHomes = async (): Promise<void> => {
  for (const path of homes.splice(0)) await rm(path, { recursive: true, force: true })
}

export const restoredAt = (cwd: string): RestoredWorkspace => ({
  cwd,
  repository: cwd,
  trees: [{ id: 'main', sourcePath: '/host/repo', path: cwd, branch: null, renamedFrom: null }],
})

const unused = async (): Promise<never> => {
  throw new Error('the session must not touch this log operation')
}

export const deferred = () => {
  let release: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

export const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

export type SessionOptions = {
  dormant?: boolean
  startChildren?: (direct: DirectWorkspace) => Promise<void>
  restore?: (args: { destination: string }) => Promise<RestoredWorkspace>
}

export async function buildSession(options: SessionOptions = {}) {
  const home = await mkdtemp(join(tmpdir(), 'atlas-workspace-session-'))
  homes.push(home)
  await mkdir(join(home, 'bootstrap'), { recursive: true })
  const destination = join(home, 'workspace')
  await mkdir(destination, { recursive: true })
  const events: string[] = []
  let restores = 0
  const direct = createDirectWorkspace({
    driveHome: home,
    destination,
    restore: async (given) => {
      restores += 1
      if (options.restore !== undefined) return options.restore(given)
      return restoredAt(join(destination, `repo-${restores}`))
    },
  })
  const session = createWorkspaceSession({
    direct,
    dormant: options.dormant ?? false,
    startChildren:
      options.startChildren === undefined
        ? async () => {
            events.push('start')
          }
        : () => options.startChildren!(direct),
  })
  const supply = (bytes: string) => writeFile(driveWorkspaceArchivePath({ driveHome: home }), bytes)
  return { session, direct, events, home, supply, restores: () => restores }
}
