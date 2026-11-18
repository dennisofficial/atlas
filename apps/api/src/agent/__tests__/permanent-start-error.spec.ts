import { describe, expect, it } from 'bun:test'

import { isPermanentStartError } from '../compose'
import { CredentialsUnavailableError } from '../config/agent-host-credential-port'
import { SessionNotFoundError } from '../config/config-reader'
import { SandboxNotConfiguredError } from '../runtime/session-runtime-factory'

describe('isPermanentStartError', () => {
  it('is permanent for configuration gaps a retry cannot fix', () => {
    expect(isPermanentStartError(new SandboxNotConfiguredError('no token'))).toBe(true)
    expect(isPermanentStartError(new SessionNotFoundError('s-1'))).toBe(true)
    expect(isPermanentStartError(new CredentialsUnavailableError('no key'))).toBe(true)
  })

  it('is transient for anything else, such as a database error', () => {
    expect(isPermanentStartError(new Error('connection reset'))).toBe(false)
    expect(isPermanentStartError('boom')).toBe(false)
  })
})
