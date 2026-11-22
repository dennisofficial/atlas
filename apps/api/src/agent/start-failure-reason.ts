import { connectProviderAdvice } from '@dltech/atlas-core'

import { CredentialsUnavailableError } from './config/agent-host-credential-port'
import { SessionNotFoundError } from './config/config-reader'
import { providerLabelOfRef } from './config/model-labels'
import { BYOK_RETIRED_GAP } from '@dltech/atlas-pods/runtime/sandbox-not-configured-error'
import { SandboxNotConfiguredError } from './runtime/session-runtime-factory'

const SANDBOX_REASON =
  'This project has no sandbox connection. Connect Vercel in Settings, then retry.'
const BYOK_RETIRED_REASON =
  "This session ran on your own Vercel key, which Atlas no longer supports. Start a new session to continue on Atlas's sandboxes."
const CREDENTIALS_REASON =
  'No model account is available. Check your model accounts in Settings, then retry.'
const SESSION_REASON = 'This session no longer exists.'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const credentialsReasonOf = (error: CredentialsUnavailableError): string => {
  if (error.unavailable === undefined) return CREDENTIALS_REASON
  return `${error.message} ${connectProviderAdvice(providerLabelOfRef(error.unavailable))}`
}

const sandboxReasonOf = (error: SandboxNotConfiguredError): string =>
  error.gap === BYOK_RETIRED_GAP ? BYOK_RETIRED_REASON : SANDBOX_REASON

export const startFailureReason = (error: unknown): string => {
  if (error instanceof SandboxNotConfiguredError) return sandboxReasonOf(error)
  if (error instanceof CredentialsUnavailableError) return credentialsReasonOf(error)
  if (error instanceof SessionNotFoundError) return SESSION_REASON
  return messageOf(error)
}
