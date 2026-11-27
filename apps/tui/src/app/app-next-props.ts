import type { AccountFile } from './account/account-file'
import type { LoginExchange } from './account/login-exchange'
import type { LoopbackStarter } from './account/use-sign-in'
import type { LaunchFlags } from './launch-flags'
import type { GitRemote } from './new-session'
import type { AuthRefusal, SessionClient } from './session-client'
import type { UpdateCheck } from './use-update-check'

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
  webOrigin?: string | undefined
  env?: Record<string, string | undefined> | undefined
  platform?: string | undefined
  openUrl: (url: string) => void
  exchangeLogin?: LoginExchange | undefined
  startLoopbackWait?: LoopbackStarter | undefined
  launch?: LaunchFlags | undefined
  cwd?: string | undefined
  git?: GitRemote | undefined
  fetchFn?: typeof fetch | undefined
  now?: (() => number) | undefined
  createClient?: SessionClientFactory | undefined
  checkUpdate?: UpdateCheck | undefined
  onQuit: () => void
}
