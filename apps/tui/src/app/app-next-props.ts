import type { AccountFile } from './account/account-file'
import type { LaunchFlags } from './launch-flags'
import type { GitRemote } from './new-session'
import type { AuthRefusal, SessionClient } from './session-client'

export type SessionClientArgs = {
  apiUrl: string
  token: string
  clientVersion: string
  fetchFn?: typeof fetch | undefined
  onAuthLost: (status: AuthRefusal) => void
}

export type SessionClientFactory = (args: SessionClientArgs) => SessionClient

export type AppNextProps = {
  accountPath: string
  initialAccount: AccountFile | null
  apiUrl: string
  clientVersion: string
  openUrl: (url: string) => void
  launch?: LaunchFlags | undefined
  cwd?: string | undefined
  git?: GitRemote | undefined
  fetchFn?: typeof fetch | undefined
  now?: (() => number) | undefined
  createClient?: SessionClientFactory | undefined
  onQuit: () => void
}
