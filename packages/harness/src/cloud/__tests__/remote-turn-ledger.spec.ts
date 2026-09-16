import { describe, expect, it } from 'bun:test'
import { toRunId, toThreadId } from '@dltech/atlas-core'

import { RemoteTurnLedger } from '../remote-turn-ledger'
import { SessionsClient } from '../sessions-client'
import type { TurnSpend } from '../../ledger/turn-ledger.port'

type Call = { url: string; method: string; body?: unknown }

const spend: TurnSpend = {
  runId: toRunId('run_1'),
  threadId: toThreadId('brn_1'),
  status: 'done',
  providerId: 'anthropic',
  modelId: 'claude-opus',
  steps: 3,
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 25,
  cacheWriteTokens: 10,
  startedAt: '2026-09-15T00:00:00.000Z',
  endedAt: '2026-09-15T00:01:00.000Z',
  durationMs: 60_000,
}

const { runId: _runId, threadId: _threadId, ...spendFields } = spend
const wireTurn = { runId: 'run_1', threadId: 'brn_1', ...spendFields }

const harness = (responses: unknown[], statuses?: number[]) => {
  const calls: Call[] = []
  let at = 0
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      ...(body === undefined ? {} : { body }),
    })
    const status = statuses?.[at] ?? 200
    const next = status === 204 ? undefined : responses[at]
    at += 1
    return new Response(next === undefined ? '' : JSON.stringify(next), { status })
  }) as typeof fetch
  const client = new SessionsClient({ url: 'http://cloud.test', token: 'sess_test', fetchFn })
  return { ledger: new RemoteTurnLedger({ client }), calls }
}

describe('RemoteTurnLedger', () => {
  it('record puts the spend without the identity fields in the body', async () => {
    const { ledger, calls } = harness([], [204])

    await ledger.record(spend)

    expect(calls[0]?.method).toBe('PUT')
    expect(calls[0]?.url).toBe('http://cloud.test/v1/threads/brn_1/turns/run_1')
    expect(calls[0]?.body).toMatchObject({ status: 'done', steps: 3 })
    expect(calls[0]?.body).not.toHaveProperty('runId')
    expect(calls[0]?.body).not.toHaveProperty('threadId')
  })

  it('forThread maps the wire rows to spends', async () => {
    const { ledger } = harness([[wireTurn]])

    const turns = await ledger.forThread({ threadId: toThreadId('brn_1') })

    expect(turns).toHaveLength(1)
    expect(turns[0]).toEqual(spend)
  })

  it('forThreadTree keeps the own/delegated split', async () => {
    const delegated = { ...wireTurn, runId: 'run_2', threadId: 'brn_child' }
    const { ledger } = harness([{ own: [wireTurn], delegated: [delegated] }])

    const tree = await ledger.forThreadTree({ threadId: toThreadId('brn_1') })

    expect(tree.own[0]?.runId).toBe(toRunId('run_1'))
    expect(tree.delegated[0]).toMatchObject({
      runId: toRunId('run_2'),
      threadId: toThreadId('brn_child'),
    })
  })
})
