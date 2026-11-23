import { describe, expect, it } from 'bun:test'

import { EAgentStatus } from '../../agents/status'
import { EAuthKind } from '../../credentials/account'
import { ERunFailureKind } from '../../events/run-failure'
import { EProviderFailureKind } from '../../models/provider-failure'
import {
  credentialRepairOf,
  ERepairAction,
  ERepairSource,
  REPAIRABLE_FAILURE_KINDS,
  repairActionsOf,
  type CredentialRepair,
} from '../repair-episode'
import {
  agentEnded,
  agentRestarted,
  agentSpawned,
  CHILD,
  credentialEpisode,
  credentialWait,
  dismissed,
  failureOf,
  MAIN,
  modelWaitCleared,
  modelWaiting,
  runFailed,
  turnStarted,
  userSaid,
} from './repair-fixtures'

const repairOf = (overrides: Partial<CredentialRepair> = {}): CredentialRepair => ({
  source: ERepairSource.Failure,
  providerId: 'anthropic',
  modelId: null,
  accountId: 'a1',
  kind: ERunFailureKind.Auth,
  reason: null,
  resetAt: null,
  since: '2026-11-20T00:00:01.000Z',
  seq: 1,
  main: true,
  agents: [],
  ...overrides,
})

describe('credentialRepairOf', () => {
  it('folds a main run failure with a repairable kind', () => {
    const events = [runFailed(failureOf())]

    expect(credentialRepairOf({ mainThreadId: MAIN, events })).toMatchObject({
      source: ERepairSource.Failure,
      kind: ERunFailureKind.Auth,
      main: true,
      agents: [],
      providerId: 'anthropic',
      accountId: 'a1',
    })
  })

  it('counts every repairable kind as an open stop', () => {
    for (const kind of [
      ERunFailureKind.Quota,
      ERunFailureKind.MissingCredential,
      ERunFailureKind.Delivery,
    ]) {
      const events = [runFailed(failureOf({ kind }))]

      expect(REPAIRABLE_FAILURE_KINDS.has(kind)).toBe(true)
      expect(credentialRepairOf({ mainThreadId: MAIN, events })).toMatchObject({ kind })
    }
  })

  it('ignores a kind a credential cannot repair', () => {
    for (const kind of [
      ERunFailureKind.Network,
      ERunFailureKind.RateLimited,
      ERunFailureKind.Overloaded,
      ERunFailureKind.ContextOverflow,
      ERunFailureKind.Other,
    ]) {
      const events = [runFailed(failureOf({ kind }))]

      expect(credentialRepairOf({ mainThreadId: MAIN, events })).toBeNull()
    }
  })

  it('clears a main failure when the next turn starts', () => {
    const events = [runFailed(failureOf()), turnStarted()]

    expect(credentialRepairOf({ mainThreadId: MAIN, events })).toBeNull()
  })

  it('clears a main failure when the operator speaks', () => {
    const events = [runFailed(failureOf()), userSaid()]

    expect(credentialRepairOf({ mainThreadId: MAIN, events })).toBeNull()
  })

  it('clears a main failure the operator dismissed', () => {
    const failure = runFailed(failureOf())
    const events = [failure, dismissed(failure.seq)]

    expect(credentialRepairOf({ mainThreadId: MAIN, events })).toBeNull()
  })

  it('keeps a main failure dismissed by another seq', () => {
    const events = [runFailed(failureOf()), dismissed(9999)]

    expect(credentialRepairOf({ mainThreadId: MAIN, events })).not.toBeNull()
  })

  it('folds a failed sub-agent as an agent stop', () => {
    const events = [agentSpawned(), agentEnded({ failure: failureOf() })]

    expect(credentialRepairOf({ mainThreadId: MAIN, events })).toMatchObject({
      source: ERepairSource.Failure,
      main: false,
      agents: [{ agentId: CHILD, agentType: 'explore', intent: 'audit the settings registry' }],
    })
  })

  it('clears an agent stop when the agent restarts', () => {
    const events = [agentSpawned(), agentEnded({ failure: failureOf() }), agentRestarted()]

    expect(credentialRepairOf({ mainThreadId: MAIN, events })).toBeNull()
  })

  it('clears an agent stop when the agent ends again', () => {
    const events = [
      agentSpawned(),
      agentEnded({ failure: failureOf() }),
      agentEnded({ status: EAgentStatus.Finished }),
    ]

    expect(credentialRepairOf({ mainThreadId: MAIN, events })).toBeNull()
  })

  it('folds nothing for a legacy ending that carries no failure', () => {
    const events = [agentSpawned(), agentEnded({ failureCause: 'provider returned 402' })]

    expect(credentialRepairOf({ mainThreadId: MAIN, events })).toBeNull()
  })

  it('folds a main and a child stop on one account into one repair', () => {
    const mainFailure = runFailed(failureOf())
    const spawned = agentSpawned()
    const childEnding = agentEnded({ failure: failureOf({ kind: ERunFailureKind.Quota }) })
    const events = [mainFailure, spawned, childEnding]
    const repair = credentialRepairOf({ mainThreadId: MAIN, events })

    expect(repair).toMatchObject({
      main: true,
      kind: ERunFailureKind.Quota,
      seq: childEnding.seq,
      agents: [{ agentId: CHILD }],
    })
    expect(repair?.agents).toHaveLength(1)
  })

  it('folds an open wait on the main thread', () => {
    const events = [modelWaiting(credentialWait())]

    expect(credentialRepairOf({ mainThreadId: MAIN, events })).toMatchObject({
      source: ERepairSource.Waiting,
      kind: ERunFailureKind.Auth,
      reason: EProviderFailureKind.Auth,
      main: true,
      agents: [],
      accountId: 'a1',
    })
  })

  it('names the waiting sub-agent from its spawn', () => {
    const events = [agentSpawned(), modelWaiting(credentialWait({ affectedThreadIds: [CHILD] }))]

    expect(credentialRepairOf({ mainThreadId: MAIN, events })).toMatchObject({
      source: ERepairSource.Waiting,
      main: false,
      agents: [{ agentId: CHILD, agentType: 'explore' }],
    })
  })

  it('clears a wait at a later generation', () => {
    const episode = credentialEpisode({ generation: 1 })
    const events = [
      modelWaiting(credentialWait({ episode })),
      modelWaitCleared(credentialEpisode({ generation: 2 })),
    ]

    expect(credentialRepairOf({ mainThreadId: MAIN, events })).toBeNull()
  })

  it('lets a wait later than a failure on the same account win', () => {
    const events = [runFailed(failureOf()), modelWaiting(credentialWait())]
    const repair = credentialRepairOf({ mainThreadId: MAIN, events })

    expect(repair).toMatchObject({ source: ERepairSource.Waiting })
    expect(repair?.seq).toBe(events[1]?.seq ?? -1)
  })

  it('folds a failure with no account', () => {
    const events = [runFailed(failureOf({ accountId: undefined }))]

    expect(credentialRepairOf({ mainThreadId: MAIN, events })).toMatchObject({
      accountId: null,
      main: true,
    })
  })
})

describe('repairActionsOf', () => {
  it('offers sign-in and a model swap for an oauth auth failure on the main thread', () => {
    expect(
      repairActionsOf({
        repair: repairOf(),
        accountKind: EAuthKind.Oauth,
        otherAccountsOfProvider: 0,
      }),
    ).toEqual([ERepairAction.ReSignIn, ERepairAction.SwapModel])
  })

  it('offers a key replacement and a model swap for an api-key auth failure', () => {
    expect(
      repairActionsOf({
        repair: repairOf(),
        accountKind: EAuthKind.ApiKey,
        otherAccountsOfProvider: 0,
      }),
    ).toEqual([ERepairAction.ReplaceKey, ERepairAction.SwapModel])
  })

  it('offers another account when the provider has one', () => {
    expect(
      repairActionsOf({
        repair: repairOf(),
        accountKind: EAuthKind.ApiKey,
        otherAccountsOfProvider: 1,
      }),
    ).toEqual([ERepairAction.ReplaceKey, ERepairAction.SwapAccount, ERepairAction.SwapModel])
  })

  it('never offers sign-in for a quota and offers a check at its reset', () => {
    expect(
      repairActionsOf({
        repair: repairOf({
          kind: ERunFailureKind.Quota,
          resetAt: '2026-12-01T00:00:00.000Z',
        }),
        accountKind: EAuthKind.Oauth,
        otherAccountsOfProvider: 0,
      }),
    ).toEqual([ERepairAction.SwapModel, ERepairAction.CheckAgain])
  })

  it('offers only a model swap when the account kind is unknown', () => {
    expect(
      repairActionsOf({ repair: repairOf(), accountKind: null, otherAccountsOfProvider: 0 }),
    ).toEqual([ERepairAction.SwapModel])
  })

  it('offers no model swap for a sub-agent stop', () => {
    expect(
      repairActionsOf({
        repair: repairOf({
          main: false,
          agents: [{ agentId: CHILD, agentType: 'explore', intent: '' }],
        }),
        accountKind: EAuthKind.Oauth,
        otherAccountsOfProvider: 0,
      }),
    ).toEqual([ERepairAction.ReSignIn])
  })
})
