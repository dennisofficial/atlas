import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { GithubTokenReader } from '../tokens/github-token-reader'
import type { ShellEnvCell } from './shell-env'

export type GithubTokenRefresher = () => Promise<void>

export const githubTokenRefresher = (args: {
  reader: Pick<GithubTokenReader, 'read'>
  cell: ShellEnvCell
  userId: string
  sessionId: string
  launchDirectory: string
  log?: LogPort | undefined
}): GithubTokenRefresher => {
  return async () => {
    try {
      const token = await args.reader.read({ userId: args.userId })
      await args.cell.updateToken({
        token,
        launchDirectory: args.launchDirectory,
        signal: new AbortController().signal,
      })
    } catch (error) {
      args.log?.error({
        source: 'runtime.github-token',
        message: `reading the github token for ${args.sessionId} failed; shells keep the previous one`,
        ...logFieldsOf({ error }),
      })
    }
  }
}
