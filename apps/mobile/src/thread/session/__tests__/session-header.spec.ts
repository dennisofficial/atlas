import { describe, expect, it } from 'bun:test'

import { ESessionDisplay } from '@dltech/atlas-client/stream'
import { ESessionStatus } from '@dltech/atlas-core'
import { ESandboxStatus, type StreamSessionRow } from '@dltech/atlas-protocol'

import { sessionHeaderOf, UNTITLED } from '../session-header'

const NOW = Date.parse('2026-11-23T10:02:05.000Z')
const LEASE = { epoch: 1, holderHostId: 1, live: true }

const summaryOf = (fields: Partial<StreamSessionRow>): StreamSessionRow => ({
  sessionId: 'ses_1',
  projectId: null,
  title: 'Fix the flaky spec',
  naming: false,
  mainThreadId: 'thr_1',
  createdAt: '2026-11-23T10:00:00.000Z',
  updatedAt: '2026-11-23T10:00:00.000Z',
  archivedAt: null,
  model: { ref: 'anthropic/claude-opus', effort: 'high', fast: false },
  ...fields,
})

const headerOf = (args: {
  summary?: StreamSessionRow
  fallbackTitle?: string
  state?: ESessionStatus
  sandbox?: ESandboxStatus
  turnStartedAt?: string
}) =>
  sessionHeaderOf({
    summary: args.summary,
    fallbackTitle: args.fallbackTitle,
    status:
      args.state === undefined
        ? undefined
        : {
            state: args.state,
            lease: LEASE,
            ...(args.sandbox === undefined
              ? {}
              : { sandbox: { status: args.sandbox, at: '2026-11-23T10:00:00.000Z' } }),
          },
    turnStartedAt: args.turnStartedAt,
    now: NOW,
  })

describe('sessionHeaderOf title', () => {
  it('takes the live title from the sessions feed', () => {
    expect(headerOf({ summary: summaryOf({}), fallbackTitle: 'Old' }).title).toBe(
      'Fix the flaky spec',
    )
  })

  it('falls back to the title the list passed while the feed loads', () => {
    expect(headerOf({ fallbackTitle: 'From the list' }).title).toBe('From the list')
  })

  it('says Untitled for a listed session with no title yet', () => {
    expect(headerOf({ summary: summaryOf({ title: null }) }).title).toBe(UNTITLED)
  })

  it('stays blank before anything is known', () => {
    expect(headerOf({}).title).toBe('')
  })
})

describe('sessionHeaderOf state', () => {
  it('shows nothing before a status arrives', () => {
    expect(headerOf({}).subtitle).toBeNull()
  })

  it('adds the elapsed turn time while working', () => {
    const header = headerOf({
      state: ESessionStatus.Thinking,
      turnStartedAt: '2026-11-23T10:00:00.000Z',
    })
    expect(header.display).toBe(ESessionDisplay.Working)
    expect(header.subtitle).toBe('Working · 2m 5s')
  })

  it('shows Working without a time when no turn is open', () => {
    expect(headerOf({ state: ESessionStatus.RunningTool }).subtitle).toBe('Working')
  })

  it('parks an idle session whose pod sleeps', () => {
    const header = headerOf({ state: ESessionStatus.Idle, sandbox: ESandboxStatus.Sleeping })
    expect(header.display).toBe(ESessionDisplay.Parked)
    expect(header.subtitle).toBe('Parked')
  })

  it('names a start failure', () => {
    expect(headerOf({ state: ESessionStatus.StartFailed }).subtitle).toBe('Start failed')
  })

  it('asks for the operator when the agent waits', () => {
    expect(headerOf({ state: ESessionStatus.WaitingForOperator }).subtitle).toBe('Waiting for you')
  })

  it('uses the feed row status until the stream reports one', () => {
    const header = headerOf({ summary: summaryOf({ status: { state: ESessionStatus.Failed } }) })
    expect(header.subtitle).toBe('Failed')
  })

  it('ignores the turn start once the session is idle', () => {
    const header = headerOf({
      state: ESessionStatus.Idle,
      turnStartedAt: '2026-11-23T10:00:00.000Z',
    })
    expect(header.subtitle).toBe('Idle')
  })
})

describe('sessionHeaderOf pull request', () => {
  it('carries the pull request of the session row for the title chip', () => {
    const header = headerOf({
      summary: summaryOf({
        pullRequest: {
          repo: 'dennisofficial/atlas',
          number: 2844,
          url: 'https://github.com/dennisofficial/atlas/pull/2844',
          state: 'open',
          checks: null,
          mergeable: null,
        },
      }),
    })
    expect(header.pullRequest?.number).toBe(2844)
  })

  it('shows no chip for a session without a pull request', () => {
    expect(headerOf({ summary: summaryOf({}) }).pullRequest).toBeNull()
  })
})
