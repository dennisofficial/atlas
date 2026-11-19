import { dirname, join } from 'node:path'

import { newKey, type RemoteCalls } from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import type { WorkspaceConfig } from '../config/agent-host-config'

export type GitWatch = {
  watchedRepos(): Promise<readonly string[]>
  onRepo(listener: (repoPath: string) => void): () => void
}

const additionalRepoDir = (args: { launchDirectory: string; repo: string }): string =>
  join(dirname(args.launchDirectory), args.repo.split('/')[1] ?? args.repo)

export const watchWorkspaceRepos = (args: {
  calls: RemoteCalls
  gate: Promise<void>
  launchDirectory: string
  additionalRepos: WorkspaceConfig['additionalRepos']
  log?: LogPort | undefined
}): GitWatch => {
  const repos = new Set<string>()
  const listeners = new Set<(repoPath: string) => void>()

  const ackQuietly = async (key: string): Promise<void> => {
    await args.calls.ack({ key }).catch((error: unknown) => {
      args.log?.error({
        source: 'runtime.git-watch',
        message: `ack for ${key} failed`,
        ...logFieldsOf({ error }),
      })
    })
  }

  const watchRepo = async (repoPath: string): Promise<void> => {
    if (repos.has(repoPath)) return
    const key = newKey()
    const result = await args.calls.invoke({ key, op: { op: 'git.watch', repoPath } })
    await ackQuietly(key)
    if (result.status !== 'ok') return
    repos.add(repoPath)
    for (const listener of [...listeners]) listener(repoPath)
  }

  const discover = async (): Promise<void> => {
    const key = newKey()
    const result = await args.calls.invoke({
      key,
      op: { op: 'git.discover', root: dirname(args.launchDirectory) },
    })
    await ackQuietly(key)
    if (result.status !== 'ok' || result.op !== 'git.discover') return
    for (const repoPath of result.value.repos) await watchRepo(repoPath)
  }

  const ready = args.gate
    .then(async () => {
      args.calls.onEvent((frame) => {
        if (frame.event.type !== 'git.repo-found') return
        void watchRepo(frame.event.repoPath)
      })
      const candidates = [
        args.launchDirectory,
        ...args.additionalRepos.map(({ repo }) =>
          additionalRepoDir({ launchDirectory: args.launchDirectory, repo }),
        ),
      ]
      for (const repoPath of candidates) await watchRepo(repoPath)
      await discover()
    })
    .catch((error: unknown) => {
      args.log?.error({
        source: 'runtime.git-watch',
        message: 'git watch setup failed',
        ...logFieldsOf({ error }),
      })
    })

  return {
    watchedRepos: async () => {
      await ready
      return [...repos]
    },
    onRepo: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
