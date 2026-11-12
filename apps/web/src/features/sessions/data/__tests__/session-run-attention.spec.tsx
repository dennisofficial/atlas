import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { BUSY_REASON } from '@dltech/atlas-client/transcript'
import {
  ERunFailureKind,
  ERunRemedy,
  chainEvents,
  toRunId,
  toThreadId,
  type RunFailure,
  type V2Body,
} from '@dltech/atlas-core'

import { RunFailureCard } from '@/features/threads/transcript/run-failure-card'

import { sessionAttentionOf, sessionFailureCardOf } from '../session-run-attention'

const eventsOf = (bodies: readonly V2Body[]) =>
  chainEvents({
    threadId: toThreadId('thread-1'),
    runId: toRunId('run-1'),
    epoch: 1,
    at: '2026-11-12T10:00:00.000Z',
    from: undefined,
    bodies,
  })

const extraUsage: RunFailure = {
  kind: ERunFailureKind.Other,
  message:
    'AI_APICallError: Third-party apps now draw from your extra usage, not your plan limits.',
  statusCode: 400,
  providerId: 'anthropic',
  modelId: 'claude-opus-5-5',
  accountId: 'acc_personal',
}

const quota: RunFailure = { ...extraUsage, kind: ERunFailureKind.Quota, message: 'no credits' }

const accountLabelOf = (accountId: string): string | undefined =>
  accountId === 'acc_personal' ? 'dennislysenko@hotmail.com' : undefined

const handlersOf = () => ({
  retry: mock(() => undefined),
  fixCredential: mock(() => undefined),
  switchModel: mock(() => undefined),
  openAgent: mock(() => undefined),
})

describe('sessionAttentionOf', () => {
  it('keeps the durable failure of the latest run', () => {
    const attention = sessionAttentionOf({
      events: eventsOf([
        { type: 'user-said', text: 'go' },
        { type: 'run-failed', failure: extraUsage },
      ]),
      working: false,
    })
    expect(attention?.failure).toEqual(extraUsage)
    expect(attention?.failureSeq).toBe(2)
    expect(attention?.remedies).toEqual([{ remedy: ERunRemedy.Retry, enabled: true }])
  })

  it('disables retry while a run is in flight', () => {
    const attention = sessionAttentionOf({
      events: eventsOf([{ type: 'run-failed', failure: extraUsage }]),
      working: true,
    })
    expect(attention?.remedies).toEqual([{ remedy: ERunRemedy.Retry, enabled: false }])
    expect(attention?.busyReason).toBe(BUSY_REASON)
  })

  it('forgets a failure a later message superseded', () => {
    const attention = sessionAttentionOf({
      events: eventsOf([
        { type: 'run-failed', failure: extraUsage },
        { type: 'user-said', text: 'again' },
      ]),
      working: false,
    })
    expect(attention).toBeNull()
  })

  it('has nothing to say without a failure', () => {
    expect(
      sessionAttentionOf({ events: eventsOf([{ type: 'user-said', text: 'go' }]), working: false }),
    ).toBeNull()
  })
})

describe('sessionFailureCardOf', () => {
  const cardOf = (failure: RunFailure, working = false) => {
    const attention = sessionAttentionOf({
      events: eventsOf([
        { type: 'user-said', text: 'go' },
        { type: 'run-failed', failure },
      ]),
      working,
    })
    if (attention === null) throw new Error('expected attention')
    return sessionFailureCardOf({ attention, accountLabelOf, handlers: handlersOf() })
  }

  it('shows the provider message and the account label', () => {
    const card = cardOf(extraUsage)
    expect(card.title).toBe('The run failed')
    expect(card.detail).toBe(extraUsage.message)
    expect(card.meta).toBe('dennislysenko@hotmail.com · claude-opus-5-5')
  })

  it('names the account in the message when the provider refused its quota', () => {
    expect(cardOf(quota).detail).toContain('dennislysenko@hotmail.com')
  })

  it('always offers a switch model action that opens the picker', () => {
    const handlers = handlersOf()
    const attention = sessionAttentionOf({
      events: eventsOf([{ type: 'run-failed', failure: extraUsage }]),
      working: false,
    })
    if (attention === null) throw new Error('expected attention')
    const card = sessionFailureCardOf({ attention, accountLabelOf, handlers })
    const switchModel = card.actions?.find((action) => action.label === 'Switch model')
    expect(switchModel).toBeDefined()
    switchModel?.onSelect()
    expect(handlers.switchModel).toHaveBeenCalledTimes(1)
  })

  it('renders the message, account and action instead of a bare failure line', () => {
    const markup = renderToStaticMarkup(<RunFailureCard {...cardOf(extraUsage)} />)
    expect(markup).toContain('Third-party apps now draw from your extra usage')
    expect(markup).toContain('dennislysenko@hotmail.com')
    expect(markup).toContain('Switch model')
  })
})
