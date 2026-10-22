import { describe, expect, it } from 'bun:test'

import { ECompactionAnchor, toThreadId, type ThreadId } from '@dltech/atlas-core'
import {
  cancelCompactionParamsSchema,
  compactHistoryParamsSchema,
  compactionReplySchema,
  EWireCompactionAnchor,
  EWireCompactScope,
  summariseHistoryParamsSchema,
} from '@dltech/atlas-wire'

import { ECompaction, ECompactScope } from '../../composition/compact-turn'
import { EClientRequest } from '../channel-wire'
import { RemoteCompaction } from '../remote-compaction'
import { COMPACTION_REQUEST_TIMEOUT_MS, requestTimeoutFor } from '../request-timeout'

const threadId: ThreadId = toThreadId('thr-1')

type Sent = { op: EClientRequest; params: unknown }

const scripted = (answer: (sent: Sent) => Promise<unknown>) => {
  const sent: Sent[] = []
  return {
    sent,
    channel: {
      request: (request: Sent) => {
        sent.push(request)
        return answer(request)
      },
    },
  }
}

const compactedReply = { type: 'compacted', replaced: 4, fromSeq: 1, throughSeq: 5 } as const

describe('compaction wire shapes', () => {
  it('defaults the scope to recent', () => {
    const parsed = compactHistoryParamsSchema.parse({ threadId: 'thr-1', operationId: 'op-1' })

    expect(parsed.scope).toBe(EWireCompactScope.Recent)
  })

  it('rejects an empty operation id and an unknown scope', () => {
    expect(compactHistoryParamsSchema.safeParse({ threadId: 'thr-1', operationId: '' }).success).toBe(false)
    expect(
      compactHistoryParamsSchema.safeParse({ threadId: 'thr-1', operationId: 'op', scope: 'all' }).success,
    ).toBe(false)
  })

  it('requires a known anchor and a nonnegative integer seq on summarise', () => {
    const base = { threadId: 'thr-1', operationId: 'op-1' }

    expect(
      summariseHistoryParamsSchema.safeParse({ ...base, anchor: EWireCompactionAnchor.Suffix, seq: 3 }).success,
    ).toBe(true)
    expect(summariseHistoryParamsSchema.safeParse({ ...base, anchor: 'middle', seq: 3 }).success).toBe(false)
    expect(summariseHistoryParamsSchema.safeParse({ ...base, anchor: 'prefix', seq: -1 }).success).toBe(false)
    expect(summariseHistoryParamsSchema.safeParse({ ...base, anchor: 'prefix', seq: 1.5 }).success).toBe(false)
  })

  it('requires thread and operation ids on cancel', () => {
    expect(cancelCompactionParamsSchema.safeParse({ threadId: 'thr-1' }).success).toBe(false)
    expect(cancelCompactionParamsSchema.safeParse({ threadId: 'thr-1', operationId: 'op' }).success).toBe(true)
  })

  it('discriminates the reply by type', () => {
    expect(compactionReplySchema.parse(compactedReply)).toEqual(compactedReply)
    expect(compactionReplySchema.parse({ type: 'refused', reason: 'no' })).toEqual({ type: 'refused', reason: 'no' })
    expect(compactionReplySchema.parse({ type: 'nothing' })).toEqual({ type: 'nothing' })
    expect(compactionReplySchema.safeParse({ type: 'other' }).success).toBe(false)
  })

  it('gives the summarising requests the long timeout', () => {
    expect(requestTimeoutFor({ op: EClientRequest.CompactHistory })).toBe(COMPACTION_REQUEST_TIMEOUT_MS)
    expect(requestTimeoutFor({ op: EClientRequest.SummariseHistory })).toBe(COMPACTION_REQUEST_TIMEOUT_MS)
    expect(COMPACTION_REQUEST_TIMEOUT_MS).toBe(600_000)
  })
})

describe('RemoteCompaction', () => {
  it('requests compact-history with a fresh operation id and maps the reply', async () => {
    const { channel, sent } = scripted(async () => compactedReply)

    const outcome = await new RemoteCompaction({ channel }).compact({
      threadId,
      scope: ECompactScope.Everything,
    })

    expect(outcome).toEqual({ type: ECompaction.Compacted, replaced: 4, fromSeq: 1, throughSeq: 5 })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.op).toBe(EClientRequest.CompactHistory)
    const params = compactHistoryParamsSchema.parse(sent[0]!.params)
    expect(params).toMatchObject({ threadId, scope: EWireCompactScope.Everything })
  })

  it('defaults the scope to recent and never reuses an operation id', async () => {
    const { channel, sent } = scripted(async () => ({ type: 'nothing' }))
    const port = new RemoteCompaction({ channel })

    expect(await port.compact({ threadId })).toEqual({ type: ECompaction.Nothing })
    await port.compact({ threadId })

    const [first, second] = sent.map((request) => compactHistoryParamsSchema.parse(request.params))
    expect(first!.scope).toBe(EWireCompactScope.Recent)
    expect(first!.operationId).not.toBe(second!.operationId)
  })

  it('requests summarise-history with the converted anchor and seq', async () => {
    const { channel, sent } = scripted(async () => compactedReply)

    await new RemoteCompaction({ channel }).summarise({
      threadId,
      anchor: ECompactionAnchor.Suffix,
      seq: 7,
    })

    expect(sent[0]!.op).toBe(EClientRequest.SummariseHistory)
    expect(summariseHistoryParamsSchema.parse(sent[0]!.params)).toMatchObject({
      threadId,
      anchor: EWireCompactionAnchor.Suffix,
      seq: 7,
    })
  })

  it('returns a refusal as a refusal, not an error', async () => {
    const { channel } = scripted(async () => ({ type: 'refused', reason: 'a turn is running' }))

    const outcome = await new RemoteCompaction({ channel }).compact({ threadId })

    expect(outcome).toEqual({ type: ECompaction.Refused, reason: 'a turn is running' })
  })

  it('propagates a remote failure', async () => {
    const { channel } = scripted(() => Promise.reject(new Error('the sandbox is parked')))

    await expect(new RemoteCompaction({ channel }).compact({ threadId })).rejects.toThrow('the sandbox is parked')
  })

  it('rejects a reply that is not a compaction', async () => {
    const { channel } = scripted(async () => ({ type: 'bogus' }))

    await expect(new RemoteCompaction({ channel }).compact({ threadId })).rejects.toThrow()
  })

  it('rejects before sending when the signal is already aborted', async () => {
    const { channel, sent } = scripted(async () => compactedReply)
    const controller = new AbortController()
    controller.abort()

    await expect(
      new RemoteCompaction({ channel }).compact({ threadId, signal: controller.signal }),
    ).rejects.toThrow()
    expect(sent).toHaveLength(0)
  })

  it('sends cancel-compaction with the same operation id when aborted mid-request', async () => {
    let release: (value: unknown) => void = () => undefined
    const { channel, sent } = scripted(({ op }) =>
      op === EClientRequest.CancelCompaction
        ? Promise.resolve({})
        : new Promise((resolve) => {
            release = resolve
          }),
    )
    const controller = new AbortController()

    const pending = new RemoteCompaction({ channel }).summarise({
      threadId,
      anchor: ECompactionAnchor.Prefix,
      seq: 2,
      signal: controller.signal,
    })
    controller.abort()
    release({ type: 'refused', reason: 'cancelled' })
    await pending

    expect(sent.map((request) => request.op)).toEqual([
      EClientRequest.SummariseHistory,
      EClientRequest.CancelCompaction,
    ])
    const started = summariseHistoryParamsSchema.parse(sent[0]!.params)
    expect(cancelCompactionParamsSchema.parse(sent[1]!.params)).toEqual({
      threadId,
      operationId: started.operationId,
    })
  })

  it('does not cancel after success and detaches its listener', async () => {
    const { channel, sent } = scripted(async () => compactedReply)
    const controller = new AbortController()

    await new RemoteCompaction({ channel }).compact({ threadId, signal: controller.signal })
    controller.abort()

    expect(sent.map((request) => request.op)).toEqual([EClientRequest.CompactHistory])
  })

  it('swallows a failed cancel request', async () => {
    let release: (value: unknown) => void = () => undefined
    const { channel } = scripted(({ op }) =>
      op === EClientRequest.CancelCompaction
        ? Promise.reject(new Error('channel closed'))
        : new Promise((resolve) => {
            release = resolve
          }),
    )
    const controller = new AbortController()

    const pending = new RemoteCompaction({ channel }).compact({ threadId, signal: controller.signal })
    controller.abort()
    release({ type: 'nothing' })

    expect(await pending).toEqual({ type: ECompaction.Nothing })
  })
})
