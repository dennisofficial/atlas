import { describe, expect, it } from 'bun:test'

import { EWithdrawRefusal, type SessionWithdrawOutput } from '@dltech/atlas-protocol'

import {
  ALREADY_SENT_NOTICE,
  EWithdrawOutcome,
  withdrawQueued,
  WITHDRAW_UNKNOWN_NOTICE,
} from '../withdraw-queued'

const run = (args: { reply: SessionWithdrawOutput; draft?: string; restoreText?: boolean }) => {
  const calls: unknown[] = []
  const result = withdrawQueued({
    api: {
      withdraw: async (input) => {
        calls.push(input)
        return args.reply
      },
    },
    sessionId: 's-1',
    inboxId: 4,
    text: 'queued text',
    draft: args.draft ?? '',
    restoreText: args.restoreText ?? true,
  })
  return { calls, result }
}

describe('withdrawQueued', () => {
  it('restores the text into an empty composer', async () => {
    const { calls, result } = run({ reply: { ok: true } })
    expect(await result).toEqual({ outcome: EWithdrawOutcome.Withdrawn, draft: 'queued text' })
    expect(calls).toEqual([{ sessionId: 's-1', inboxId: 4 }])
  })

  it('keeps the existing draft after the withdrawn text', async () => {
    const { result } = run({ reply: { ok: true }, draft: 'typing' })
    expect(await result).toEqual({
      outcome: EWithdrawOutcome.Withdrawn,
      draft: 'queued text\n\ntyping',
    })
  })

  it('leaves the draft alone when the text is not restored', async () => {
    const { result } = run({ reply: { ok: true }, draft: 'typing', restoreText: false })
    expect(await result).toEqual({ outcome: EWithdrawOutcome.Withdrawn, draft: 'typing' })
  })

  it('says already sent when the host consumed it first', async () => {
    const { result } = run({ reply: { ok: false, reason: EWithdrawRefusal.AlreadyConsumed } })
    expect(await result).toEqual({ outcome: EWithdrawOutcome.Refused, notice: ALREADY_SENT_NOTICE })
  })

  it('says it is gone when the entry is unknown', async () => {
    const { result } = run({ reply: { ok: false, reason: EWithdrawRefusal.Unknown } })
    expect(await result).toEqual({
      outcome: EWithdrawOutcome.Refused,
      notice: WITHDRAW_UNKNOWN_NOTICE,
    })
  })
})
