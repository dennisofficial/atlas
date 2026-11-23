import { describe, expect, it } from 'bun:test'

import { EWithdrawRefusal, type SessionWithdrawOutput } from '@dltech/atlas-protocol'
import { EAttachmentStore, type Attachment } from '@dltech/atlas-core'

import {
  ALREADY_SENT_NOTICE,
  EWithdrawOutcome,
  withdrawQueued,
  WITHDRAW_UNKNOWN_NOTICE,
} from '../withdraw-queued'

const image: Attachment = {
  id: 'a-1',
  name: 'shot.png',
  mediaType: 'image/png',
  size: 10,
  content: { store: EAttachmentStore.Media, hash: 'h-1' },
}

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
    attachments: [image],
    draft: args.draft ?? '',
    restoreText: args.restoreText ?? true,
  })
  return { calls, result }
}

describe('withdrawQueued', () => {
  it('restores the text and attachments into an empty composer', async () => {
    const { calls, result } = run({ reply: { ok: true } })
    expect(await result).toEqual({
      outcome: EWithdrawOutcome.Withdrawn,
      draft: 'queued text',
      attachments: [image],
    })
    expect(calls).toEqual([{ sessionId: 's-1', inboxId: 4 }])
  })

  it('keeps the existing draft after the withdrawn text', async () => {
    const { result } = run({ reply: { ok: true }, draft: 'typing' })
    expect(await result).toEqual({
      outcome: EWithdrawOutcome.Withdrawn,
      draft: 'queued text\n\ntyping',
      attachments: [image],
    })
  })

  it('leaves the composer alone when the message is not restored', async () => {
    const { result } = run({ reply: { ok: true }, draft: 'typing', restoreText: false })
    expect(await result).toEqual({
      outcome: EWithdrawOutcome.Withdrawn,
      draft: 'typing',
      attachments: [],
    })
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
