import { describe, expect, it } from 'bun:test'

import { CredentialsUnavailableError } from '../config/agent-host-credential-port'
import { SessionNotFoundError } from '../config/config-reader'
import { SandboxNotConfiguredError } from '../runtime/session-runtime-factory'
import { startFailureReason } from '../start-failure-reason'

describe('startFailureReason', () => {
  it('tells the user what to do about a missing sandbox connection', () => {
    expect(startFailureReason(new SandboxNotConfiguredError('user-credential'))).toBe(
      'This project has no sandbox connection. Connect Vercel in Settings, then retry.',
    )
  })

  it('tells the user what to do about missing model accounts', () => {
    expect(startFailureReason(new CredentialsUnavailableError('no model account'))).toBe(
      'No model account is available. Check your model accounts in Settings, then retry.',
    )
  })

  it('says a deleted session is gone', () => {
    expect(startFailureReason(new SessionNotFoundError('s-1'))).toBe(
      'This session no longer exists.',
    )
  })

  it('keeps the message of anything else', () => {
    expect(startFailureReason(new Error('connection reset'))).toBe('connection reset')
    expect(startFailureReason('boom')).toBe('boom')
  })
})
