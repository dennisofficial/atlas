import { describe, expect, it } from 'bun:test'
import { toRunId, toThreadId } from '@dltech/atlas-core'

import { EClientRequest } from '../channel-wire'
import type { RemoteDeltaChannel } from '../remote-delta-channel'
import { RemoteTurnLedger } from '../remote-turn-ledger'
import type { TurnSpend } from '../../ledger/turn-ledger.port'

type Call = { op: EClientRequest; params: unknown }

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

const harness = (reply: unknown) => {
  const calls: Call[] = []
  const channel: Pick<RemoteDeltaChannel, 'request'> = {
    request: async (args: { op: EClientRequest; params: unknown }) => {
      calls.push({ op: args.op, params: args.params })
      return reply
    },
  }
  return { ledger: new RemoteTurnLedger({ channel }), calls }
}

describe('RemoteTurnLedger', () => {
  it('record refuses — the sandbox owns the ledger writes', async () => {
    const { ledger, calls } = harness({})

    await expect(ledger.record(spend)).rejects.toThrow('the sandbox owns the turn ledger')
    expect(calls).toHaveLength(0)
  })

  it('forThread answers the own rows over the channel', async () => {
    const { ledger, calls } = harness({ own: [wireTurn], delegated: [] })

    const turns = await ledger.forThread({ threadId: toThreadId('brn_1') })

    expect(calls[0]?.op).toBe(EClientRequest.ReadTurns)
    expect(calls[0]?.params).toEqual({ threadId: toThreadId('brn_1') })
    expect(turns).toHaveLength(1)
    expect(turns[0]).toEqual(spend)
  })

  it('forThreadTree keeps the own/delegated split', async () => {
    const delegated = { ...wireTurn, runId: 'run_2', threadId: 'brn_child' }
    const { ledger } = harness({ own: [wireTurn], delegated: [delegated] })

    const tree = await ledger.forThreadTree({ threadId: toThreadId('brn_1') })

    expect(tree.own[0]?.runId).toBe(toRunId('run_1'))
    expect(tree.delegated[0]).toMatchObject({
      runId: toRunId('run_2'),
      threadId: toThreadId('brn_child'),
    })
  })
})
