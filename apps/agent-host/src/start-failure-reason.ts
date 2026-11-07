import { CredentialsUnavailableError } from './config/agent-host-credential-port'
import { SessionNotFoundError } from './config/config-reader'
import { SandboxNotConfiguredError } from './runtime/session-runtime-factory'

const SANDBOX_REASON =
  'This project has no sandbox connection. Connect Vercel in Settings, then retry.'
const CREDENTIALS_REASON =
  'No model account is available. Check your model accounts in Settings, then retry.'
const SESSION_REASON = 'This session no longer exists.'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const startFailureReason = (error: unknown): string => {
  if (error instanceof SandboxNotConfiguredError) return SANDBOX_REASON
  if (error instanceof CredentialsUnavailableError) return CREDENTIALS_REASON
  if (error instanceof SessionNotFoundError) return SESSION_REASON
  return messageOf(error)
}
