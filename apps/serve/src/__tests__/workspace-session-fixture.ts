import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'
import type { RestoredWorkspace, WorkspaceManifest } from '@dltech/atlas-harness'

import { createDirectWorkspace, type DirectWorkspace } from '../direct-workspace'
import { driveWorkspaceArchivePath } from '../drive-bootstrap'
import type { ServeApp, ServeFamily } from '../serve-app'
import { createWorkspaceSession } from '../workspace-session'

export const rootThread = toThreadId('root-thread')

const homes: string[] = []

export const removeFixtureHomes = async (): Promise<void> => {
  for (const path of homes.splice(0)) await rm(path, { recursive: true, force: true })
}

export const manifestFor = (cwd: string): WorkspaceManifest => ({
  version: 1,
  repository: null,
  activeId: 'main',
  activeRelativePath: '',
  trees: [
    {
      id: 'main',
      name: 'main',
      sourcePath: cwd,
      originPath: cwd,
      branch: null,
      head: null,
      baseline: null,
      fingerprint: 'f',
      isMain: true,
    },
  ],
})

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
  stopWorkspaceProcesses?: () => Promise<void>
  family?: ServeFamily | undefined
  capture?: (args: { cwd: string; destination: string }) => Promise<WorkspaceManifest>
  restore?: (args: { destination: string }) => Promise<RestoredWorkspace>
}

export async function buildSession(options: SessionOptions = {}) {
  const home = await mkdtemp(join(tmpdir(), 'atlas-workspace-session-'))
  homes.push(home)
  await mkdir(join(home, 'bootstrap'), { recursive: true })
  const destination = join(home, 'workspace')
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
  const app: Pick<ServeApp, 'log' | 'stopWorkspaceProcesses' | 'family'> = {
    log: { append: unused, read: unused, readOwn: async () => [], head: unused, refresh: unused },
    stopWorkspaceProcesses:
      options.stopWorkspaceProcesses ??
      (async () => {
        events.push('stop')
      }),
    family: options.family,
  }
  const session = createWorkspaceSession({
    direct,
    driveHome: home,
    threadId: rootThread,
    launchDirectory: () => destination,
    app,
    capture:
      options.capture ??
      (async ({ cwd, destination: staging }) => {
        events.push('capture')
        await writeFile(staging, 'tar')
        return manifestFor(cwd)
      }),
    dormant: options.dormant ?? false,
    startChildren:
      options.startChildren === undefined
        ? async () => {
            events.push('start')
          }
        : () => options.startChildren!(direct),
  })
  const supply = (bytes: string) => writeFile(driveWorkspaceArchivePath({ driveHome: home }), bytes)
  const exported = async (): Promise<string[]> => {
    try {
      return (await readdir(join(home, 'exports'))).filter((name) => name.startsWith('workspace-'))
    } catch {
      return []
    }
  }
  return { session, direct, events, home, supply, exported, restores: () => restores }
}
