import { describe, expect, it } from 'bun:test'

import { EWithdrawRefusal, type SessionWithdrawOutput } from '@dltech/atlas-protocol'

import { EWithdrawOutcome, requestWithdraw } from '../withdraw-queued'

const run = (reply: SessionWithdrawOutput) => {
  const calls: unknown[] = []
  const result = requestWithdraw({
    api: {
      withdraw: async (input) => {
        calls.push(input)
        return reply
      },
    },
    sessionId: 's-1',
    inboxId: 4,
  })
  return { calls, result }
}

describe('requestWithdraw', () => {
  it('records the request as soon as the host takes it, restoring nothing yet', async () => {
    const { calls, result } = run({ ok: true })
    expect(await result).toEqual({ outcome: EWithdrawOutcome.Queued })
    expect(calls).toEqual([{ sessionId: 's-1', inboxId: 4 }])
  })

  it('says already sent when the holder consumed the message first', async () => {
    const { result } = run({ ok: false, reason: EWithdrawRefusal.AlreadyConsumed })
    expect(await result).toEqual({ outcome: EWithdrawOutcome.Refused, notice: 'Already sent' })
  })

  it('says it is gone when the entry is unknown', async () => {
    const { result } = run({ ok: false, reason: EWithdrawRefusal.Unknown })
    expect(await result).toEqual({
      outcome: EWithdrawOutcome.Refused,
      notice: 'That message is no longer queued',
    })
  })
})
