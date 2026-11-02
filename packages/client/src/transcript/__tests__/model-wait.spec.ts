import { describe, expect, it } from 'bun:test'
import {
  EModelWaitCause,
  EProviderFailureKind,
  EWaitEpisodeKind,
  toAccountId,
  toThreadId,
  type EventDraft,
  type WaitingForModel,
} from '@dltech/atlas-core'

import { runAttentionOf } from '../run-attention'
import {
  EModelWaitAction,
  modelWaitDetailOf,
  modelWaitViewOf,
  NO_SESSIONS_WAITING,
} from '../model-wait'
import { log } from './fixture'

const key = { accountId: toAccountId('acct-1'), providerId: 'anthropic', modelId: 'claude-x' }

const waiting = (overrides: Partial<WaitingForModel> = {}): WaitingForModel => ({
  episode: { kind: EWaitEpisodeKind.Credential, key, generation: 3 },
  cause: EModelWaitCause.Availability,
  providerId: 'anthropic',
  accountId: 'acct-1',
  modelId: 'claude-x',
  reason: EProviderFailureKind.Quota,
  resetAt: null,
  affectedThreadIds: [toThreadId('root')],
  ...overrides,
})

const waitingLog = (w: WaitingForModel, extra: readonly EventDraft[] = []) =>
  log([
    { type: 'user-said', text: 'go' },
    { type: 'run-failed', failure: { kind: 'auth' as never, message: 'stale card' } },
    { type: 'model-waiting', waiting: w },
    ...extra,
  ])

const idle = { live: [], working: false, turnInFlight: false, channelReady: true }

describe('model wait copy', () => {
  it('names provider and account, the reason, and an unsupplied reset', () => {
    expect(modelWaitDetailOf({ waiting: waiting(), accountLabel: 'Work account' })).toBe(
      'Anthropic · Work account: allowance exhausted. Provider reset: not supplied.',
    )
  })

  it('shows a provider-evidenced reset', () => {
    expect(
      modelWaitDetailOf({ waiting: waiting({ resetAt: '2026-11-02T10:00:00.000Z' }) }),
    ).toContain('Provider reset: 2026-11-02 10:00 UTC.')
  })

  it('never calls an unknown reason an invalid key', () => {
    const detail = modelWaitDetailOf({ waiting: waiting({ reason: EProviderFailureKind.Other }) })
    expect(detail).toContain('model access unavailable')
    expect(detail.toLowerCase()).not.toContain('invalid')
  })

  it('reads a reasonless availability wait as a manual pause', () => {
    expect(modelWaitDetailOf({ waiting: waiting({ reason: null }) })).toContain('paused by you')
  })
})

describe('model wait actions', () => {
  it('offers Recheck access first and Providers second', () => {
    const view = modelWaitViewOf({ events: waitingLog(waiting()) })
    expect(view?.issues[0]?.actions.map((a) => [a.action, a.primary])).toEqual([
      [EModelWaitAction.Recheck, true],
      [EModelWaitAction.Providers, false],
    ])
  })

  it('makes Remove manual pause primary for a paused issue', () => {
    const view = modelWaitViewOf({ events: waitingLog(waiting({ reason: null })) })
    expect(view?.issues[0]?.actions[0]?.action).toBe(EModelWaitAction.RemoveManualPause)
  })

  it('offers only Providers for a control-plane fault', () => {
    const view = modelWaitViewOf({
      events: waitingLog(
        waiting({
          episode: {
            kind: EWaitEpisodeKind.ControlPlane,
            code: 'authority-unavailable',
            providerId: 'anthropic',
            modelId: null,
          },
          cause: EModelWaitCause.ControlPlane,
          accountId: null,
          reason: null,
        }),
      ),
    })
    expect(view?.issues[0]?.actions.map((a) => a.action)).toEqual([EModelWaitAction.Providers])
  })
})

describe('model wait projection', () => {
  it('replaces a stale failure card with one waiting issue for thirty affected children', () => {
    const many = Array.from({ length: 30 }, (_, i) => toThreadId(`child-${i}`))
    const events = waitingLog(waiting({ affectedThreadIds: many }))
    const attention = runAttentionOf({ ...idle, events })
    expect(attention?.failure).toBeNull()
    expect(attention?.modelWait?.issues).toHaveLength(1)
    expect(attention?.modelWait?.issues[0]?.affectedLabel).toBe('30 sessions waiting')
    expect(attention?.remedies).toEqual([])
  })

  it('stays waiting while a shell keeps the thread working', () => {
    const attention = runAttentionOf({ ...idle, working: true, events: waitingLog(waiting()) })
    expect(attention?.modelWait).not.toBeNull()
  })

  it('says no sessions are waiting for an empty affected list', () => {
    const view = modelWaitViewOf({ events: waitingLog(waiting({ affectedThreadIds: [] })) })
    expect(view?.issues[0]?.affectedLabel).toBe(NO_SESSIONS_WAITING)
  })

  it('clears once the episode is cleared', () => {
    const w = waiting()
    const events = waitingLog(w, [
      { type: 'model-wait-cleared', episode: w.episode, cause: w.cause },
    ])
    expect(modelWaitViewOf({ events })).toBeNull()
    expect(runAttentionOf({ ...idle, events })?.modelWait ?? null).toBeNull()
  })

  it('falls back to the persisted status snapshot for a parked pod and marks it partial', () => {
    const view = modelWaitViewOf({
      events: log([{ type: 'user-said', text: 'go' }]),
      snapshot: waiting(),
    })
    expect(view?.partial).toBe(true)
    expect(view?.issues).toHaveLength(1)
  })

  it('ignores a snapshot the log has already cleared', () => {
    const w = waiting()
    const events = log([{ type: 'model-wait-cleared', episode: w.episode, cause: w.cause }])
    expect(modelWaitViewOf({ events, snapshot: w })).toBeNull()
  })

  it('lists every episode a live read supplies and is not partial', () => {
    const second = waiting({
      episode: {
        kind: EWaitEpisodeKind.Credential,
        key: { ...key, accountId: toAccountId('acct-2') },
        generation: 1,
      },
      accountId: 'acct-2',
    })
    const view = modelWaitViewOf({
      events: log([{ type: 'user-said', text: 'go' }]),
      live: [waiting(), second],
    })
    expect(view?.partial).toBe(false)
    expect(view?.issues).toHaveLength(2)
  })

  it('lets a live empty read win over a stale log', () => {
    expect(modelWaitViewOf({ events: waitingLog(waiting()), live: [] })).toBeNull()
  })
})
