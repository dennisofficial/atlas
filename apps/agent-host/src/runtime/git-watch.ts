import { dirname, join } from 'node:path'

import { newKey, type RemoteCalls } from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import type { AgentHostConfigOutput } from '@dltech/atlas-protocol'

export type GitWatch = {
  watchedRepos(): Promise<readonly string[]>
}

const additionalRepoDir = (args: { launchDirectory: string; repo: string }): string =>
  join(dirname(args.launchDirectory), args.repo.split('/')[1] ?? args.repo)

export const watchWorkspaceRepos = (args: {
  calls: RemoteCalls
  gate: Promise<void>
  launchDirectory: string
  additionalRepos: AgentHostConfigOutput['workspace']['additionalRepos']
  log?: LogPort | undefined
}): GitWatch => {
  const watched = args.gate
    .then(async () => {
      const candidates = [
        args.launchDirectory,
        ...args.additionalRepos.map(({ repo }) =>
          additionalRepoDir({ launchDirectory: args.launchDirectory, repo }),
        ),
      ]
      const repos: string[] = []
      for (const repoPath of candidates) {
        const key = newKey()
        const result = await args.calls.invoke({
          key,
          op: { op: 'git.watch', repoPath },
        })
        await args.calls.ack({ key }).catch((error: unknown) => {
          args.log?.error({
            source: 'runtime.git-watch',
            message: `ack for ${key} failed`,
            ...logFieldsOf({ error }),
          })
        })
        if (result.status === 'ok') repos.push(repoPath)
      }
      return repos as readonly string[]
    })
    .catch((error: unknown) => {
      args.log?.error({
        source: 'runtime.git-watch',
        message: 'git watch setup failed',
        ...logFieldsOf({ error }),
      })
      return [] as readonly string[]
    })
  return {
    watchedRepos: () => watched,
  }
}
