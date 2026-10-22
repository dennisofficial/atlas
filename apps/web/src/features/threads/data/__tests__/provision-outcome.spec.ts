import { describe, expect, it } from 'bun:test'

import { ESandboxProvisionState, EVercelCredentialGap } from '@dltech/atlas-wire/web'

import {
  clearProvisionOutcome,
  NOT_CONFIGURED_FALLBACK,
  notConfiguredOf,
  provisionOutcomeOf,
  setProvisionOutcome,
} from '../provision-outcome'

describe('notConfiguredOf', () => {
  it('is null unless the reply is not-configured', () => {
    expect(notConfiguredOf({ state: ESandboxProvisionState.Booting })).toBeNull()
    expect(notConfiguredOf({ state: ESandboxProvisionState.Running })).toBeNull()
  })

  it('carries the error and gap, falling back to a generic message', () => {
    expect(
      notConfiguredOf({
        state: ESandboxProvisionState.NotConfigured,
        error: 'Add a Vercel token',
        gap: EVercelCredentialGap.UserCredential,
      }),
    ).toEqual({ error: 'Add a Vercel token', gap: EVercelCredentialGap.UserCredential })
    expect(notConfiguredOf({ state: ESandboxProvisionState.NotConfigured })).toEqual({
      error: NOT_CONFIGURED_FALLBACK,
    })
  })
})

describe('provision outcome store', () => {
  it('remembers an outcome per thread until cleared', () => {
    setProvisionOutcome({ threadId: 't1', outcome: { error: 'x' } })
    expect(provisionOutcomeOf('t1')).toEqual({ error: 'x' })
    expect(provisionOutcomeOf('t2')).toBeUndefined()
    clearProvisionOutcome('t1')
    expect(provisionOutcomeOf('t1')).toBeUndefined()
  })
})
