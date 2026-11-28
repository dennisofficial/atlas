import { describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  EAuthKind,
  ERepairAction,
  ERunFailureKind,
  chainEvents,
  credentialRepairOf,
  repairActionsOf,
  toRunId,
  toThreadId,
  type RunFailure,
  type RecordEventBody,
  type RecordEvent,
} from '@dltech/atlas-core'

import type { Account } from '@/features/settings/data/personal/accounts-api'

import {
  otherAccountsOf,
  repairActionSpecsOf,
  repairCardViewOf,
  retryTargetsOf,
} from '../credential-repair-view'

const MAIN = toThreadId('thread-1')
const CHILD = toThreadId('agent-1')

const eventsOf = (bodies: readonly RecordEventBody[]): RecordEvent[] =>
  chainEvents({
    threadId: MAIN,
    runId: toRunId('run-1'),
    epoch: 1,
    at: '2026-11-23T10:00:00.000Z',
    from: undefined,
    bodies,
  })

const failure: RunFailure = {
  kind: ERunFailureKind.Auth,
  message: 'invalid x-api-key',
  statusCode: 401,
  providerId: 'anthropic',
  modelId: 'claude-opus-5-5',
  accountId: 'acc_1',
}

const account = (over: Partial<Account> = {}): Account => ({
  id: 'acc_1',
  provider: 'anthropic',
  kind: 'oauth',
  label: 'dennis@example.com',
  status: 'active',
  createdAt: '2026-11-01T00:00:00.000Z',
  ...over,
})

const otherAccount = account({ id: 'acc_2', label: 'work@example.com' })

const repairOf = (bodies: readonly RecordEventBody[]) => {
  const repair = credentialRepairOf({ mainThreadId: MAIN, events: eventsOf(bodies) })
  if (repair === null) throw new Error('expected a repair')
  return repair
}

describe('repairActionSpecsOf', () => {
  it('names the repair actions and offers one swap per other account', () => {
    const repair = repairOf([
      { type: 'user-said', text: 'go' },
      { type: 'run-failed', failure },
    ])
    const specs = repairActionSpecsOf({
      actions: repairActionsOf({
        repair,
        accountKind: EAuthKind.Oauth,
        otherAccountsOfProvider: 1,
      }),
      otherAccounts: [otherAccount],
    })

    expect(specs.map((spec) => spec.label)).toEqual([
      'Re-sign in',
      'Use work@example.com',
      'Switch model',
    ])
    expect(specs[1]?.detail).toBe('New sessions will use it too.')
    expect(specs[1]?.accountId).toBe('acc_2')
  })

  it('offers a key replacement only for an api-key account', () => {
    const repair = repairOf([{ type: 'run-failed', failure }])

    expect(
      repairActionSpecsOf({
        actions: repairActionsOf({
          repair,
          accountKind: EAuthKind.ApiKey,
          otherAccountsOfProvider: 0,
        }),
        otherAccounts: [],
      }).map((spec) => spec.label),
    ).toEqual(['Replace key', 'Switch model'])
  })

  it('offers a check again only when the provider named a reset', () => {
    const repair = repairOf([
      {
        type: 'run-failed',
        failure: { ...failure, kind: ERunFailureKind.Quota, resetAt: '2026-11-24T00:00:00.000Z' },
      },
    ])

    expect(
      repairActionSpecsOf({
        actions: repairActionsOf({
          repair,
          accountKind: EAuthKind.Oauth,
          otherAccountsOfProvider: 0,
        }),
        otherAccounts: [],
      }).some((spec) => spec.action === ERepairAction.CheckAgain),
    ).toBe(true)
  })
})

describe('retryTargetsOf', () => {
  it('retries the session once for a main failure', () => {
    const repair = repairOf([{ type: 'run-failed', failure }])
    expect(retryTargetsOf({ repair, sessionId: 's1' })).toEqual([{ sessionId: 's1' }])
  })

  it('retries one sub-agent per failed agent', () => {
    const repair = repairOf([
      {
        type: 'agent-spawned',
        agentId: CHILD,
        agentType: 'builder',
        intent: 'fix the tests',
        mode: 'fork',
      },
      {
        type: 'agent-ended',
        agentId: CHILD,
        agentType: 'builder',
        intent: 'fix the tests',
        status: EAgentStatus.Failed,
        prose: 'stopped',
        turns: 1,
        toolCalls: 2,
        failure,
      },
    ])

    expect(retryTargetsOf({ repair, sessionId: 's1' })).toEqual([
      { sessionId: 's1', agentId: 'agent-1' },
    ])
  })

  it('retries the main thread and every failed agent of one credential', () => {
    const repair = repairOf([
      { type: 'run-failed', failure },
      {
        type: 'agent-ended',
        agentId: CHILD,
        agentType: 'explore',
        intent: 'find the caller',
        status: EAgentStatus.Failed,
        prose: 'stopped',
        turns: 1,
        toolCalls: 1,
        failure,
      },
    ])

    expect(retryTargetsOf({ repair, sessionId: 's1' })).toEqual([
      { sessionId: 's1' },
      { sessionId: 's1', agentId: 'agent-1' },
    ])
  })
})

describe('repairCardViewOf', () => {
  it('names the provider, the account and the reason', () => {
    const repair = repairOf([{ type: 'run-failed', failure }])
    const view = repairCardViewOf({
      repair,
      providerLabel: 'Anthropic',
      accountLabel: 'dennis@example.com',
    })

    expect(view.title).toBe('Atlas could not call claude-opus-5-5')
    expect(view.detail).toBe('Anthropic, dennis@example.com, The sign-in is no longer accepted')
    expect(view.notes).toEqual([])
  })

  it('says the key was refused for an api-key account', () => {
    const repair = repairOf([{ type: 'run-failed', failure }])
    const view = repairCardViewOf({
      repair,
      providerLabel: 'OpenAI',
      accountLabel: 'livecheck-bad-key',
      accountKind: EAuthKind.ApiKey,
    })

    expect(view.detail).toBe('OpenAI, livecheck-bad-key, The key was refused')
  })

  it('keeps the sign-in copy for an oauth account', () => {
    const repair = repairOf([{ type: 'run-failed', failure }])
    const view = repairCardViewOf({
      repair,
      providerLabel: 'Anthropic',
      accountLabel: 'dennis@example.com',
      accountKind: EAuthKind.Oauth,
    })

    expect(view.detail).toBe('Anthropic, dennis@example.com, The sign-in is no longer accepted')
  })

  it('names the sub-agent that is waiting', () => {
    const repair = repairOf([
      {
        type: 'agent-spawned',
        agentId: CHILD,
        agentType: 'builder',
        intent: 'fix the tests',
        mode: 'fork',
      },
      {
        type: 'agent-ended',
        agentId: CHILD,
        agentType: 'builder',
        intent: 'fix the tests',
        status: EAgentStatus.Failed,
        prose: 'stopped',
        turns: 1,
        toolCalls: 2,
        failure,
      },
    ])
    const view = repairCardViewOf({ repair, providerLabel: 'Anthropic', accountLabel: undefined })

    expect(view.title).toBe('A sub-agent could not call claude-opus-5-5')
    expect(view.notes).toEqual(['Waiting: builder — fix the tests'])
  })

  it('draws a credential wait with no failure event', () => {
    const repair = repairOf([
      {
        type: 'model-waiting',
        waiting: {
          episode: {
            kind: 'credential',
            key: { accountId: 'acc_1', providerId: 'anthropic', modelId: 'claude-opus-5-5' },
            generation: 0,
          },
          cause: 'availability',
          providerId: 'anthropic',
          accountId: 'acc_1',
          modelId: 'claude-opus-5-5',
          reason: 'quota',
          resetAt: '2026-11-24T00:00:00.000Z',
          affectedThreadIds: [MAIN],
        },
      },
    ])
    const view = repairCardViewOf({ repair, providerLabel: 'Anthropic', accountLabel: undefined })

    expect(view.detail).toContain('The plan or credit limit is used up')
    expect(view.detail).toContain('Resets at')
    expect(retryTargetsOf({ repair, sessionId: 's1' })).toEqual([{ sessionId: 's1' }])
  })

  it('keeps every secret out of the copy', () => {
    const repair = repairOf([
      { type: 'run-failed', failure: { ...failure, message: 'sk-ant-secret Bearer abc' } },
    ])
    const view = repairCardViewOf({ repair, providerLabel: 'Anthropic', accountLabel: 'a@b.c' })
    const text = [view.title, view.detail, ...view.notes].join(' ')

    expect(text).not.toContain('sk-')
    expect(text).not.toContain('Bearer')
  })
})

describe('otherAccountsOf', () => {
  it('skips the repair account and expired accounts', () => {
    expect(
      otherAccountsOf({
        accounts: [account(), otherAccount, account({ id: 'acc_3', status: 'expired' })],
        providerId: 'anthropic',
        accountId: 'acc_1',
      }).map((entry) => entry.id),
    ).toEqual(['acc_2'])
  })
})
