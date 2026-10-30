import { describe, expect, it } from 'bun:test'

import { ERunFailureKind, type RunFailure } from '@dltech/atlas-core'

import { failureViewOf } from '../failure-view'

const of = (failure: Partial<RunFailure> & { kind: ERunFailureKind }, label?: string) =>
  failureViewOf({
    failure: {
      message: null,
      runId: null,
      failure: { message: 'raw', ...failure },
    },
    accountLabelOf: (id) => (id === 'acc_1' ? label : undefined),
  })

describe('failureViewOf', () => {
  it('is null without a failure', () => {
    expect(failureViewOf({ failure: null })).toBeNull()
  })

  it('names provider and account for auth and links to settings', () => {
    const view = of(
      { kind: ERunFailureKind.Auth, providerId: 'openai', accountId: 'acc_1' },
      'Work key',
    )

    expect(view?.title).toContain('OpenAI')
    expect(view?.detail).toContain('Work key')
    expect(view?.showSettings).toBe(true)
  })

  it('falls back when the account label is unknown', () => {
    const view = of({
      kind: ERunFailureKind.Auth,
      providerId: 'openai',
      accountId: 'acc_9',
    })

    expect(view?.detail).toContain('this account')
  })

  it('links to settings for quota', () => {
    expect(of({ kind: ERunFailureKind.Quota, providerId: 'openai' })?.showSettings).toBe(true)
  })

  it.each([ERunFailureKind.RateLimited, ERunFailureKind.Network, ERunFailureKind.Other])(
    'has no settings link for %s',
    (kind) => {
      expect(of({ kind })?.showSettings).toBe(false)
    },
  )

  it('shows the raw message for other failures', () => {
    const view = of({ kind: ERunFailureKind.Other, message: 'boom' })

    expect(view).toEqual({
      title: 'The run failed',
      detail: 'boom',
      showSettings: false,
    })
  })

  it('handles a legacy message-only failure', () => {
    const view = failureViewOf({
      failure: { message: 'old', failure: null, runId: null },
    })

    expect(view).toEqual({
      title: 'The run failed',
      detail: 'old',
      showSettings: false,
    })
    expect(failureViewOf({ failure: { message: null, failure: null, runId: null } })?.detail).toBe(
      'The run failed.',
    )
  })
})
