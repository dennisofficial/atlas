import { describe, expect, it } from 'bun:test'

import { EFinishReason } from '../../stream/chunk'
import { chainHash } from '../chain'
import { chainEvents } from '../chain-events'
import { RECORD_ONLY_TYPES, recordEventSchema, type RecordEvent } from '../event'
import { mint, NOW, runId, threadId } from './support'

describe('recordEventSchema', () => {
  it('keeps the step finish reason through parsing so the chain hash is unchanged', () => {
    const [event] = chainEvents({
      threadId,
      runId,
      epoch: 3,
      at: NOW,
      bodies: [{ type: 'assistant-said', parts: [], finish: EFinishReason.ToolCalls }],
    })
    const parsed = recordEventSchema.parse(JSON.parse(JSON.stringify(event)))
    expect(parsed).toMatchObject({ finish: EFinishReason.ToolCalls })
    expect(chainHash(parsed)).toBe(chainHash(event as RecordEvent))
  })

  it('accepts a minted v1 body event and a record body event', () => {
    const [plain] = mint({ count: 1 })
    expect(recordEventSchema.safeParse(plain).success).toBe(true)
    const consumed = { ...plain, type: 'input-consumed', inboxId: 1 }
    delete (consumed as { text?: string }).text
    expect(recordEventSchema.safeParse(consumed).success).toBe(true)
  })

  it('rejects a bad prevHash, an unknown type and a bad record body', () => {
    const [plain] = mint({ count: 1 })
    expect(recordEventSchema.safeParse({ ...plain, prevHash: 'abc' }).success).toBe(false)
    expect(recordEventSchema.safeParse({ ...plain, type: 'nope' }).success).toBe(false)
    expect(
      recordEventSchema.safeParse({ ...plain, type: 'history-rewound', toSeq: -1 }).success,
    ).toBe(false)
  })

  it('refuses the v1 history-compacted body', () => {
    const [plain] = mint({ count: 1 })
    const compacted = {
      ...plain,
      type: 'history-compacted',
      fromSeq: 1,
      throughSeq: 1,
      anchor: 'prefix',
      summary: 's',
      replaced: 1,
    }
    expect(recordEventSchema.safeParse(compacted).success).toBe(false)
  })

  it('accepts a fact-recorded body and rejects a malformed one', () => {
    const [plain] = mint({ count: 1 })
    const fact = {
      ...plain,
      type: 'fact-recorded',
      key: 'hook:can-write:run-1:call-1',
      kind: 'hook-decision',
      value: { decision: 'deny', reason: 'no' },
    }
    delete (fact as { text?: string }).text
    expect(recordEventSchema.safeParse(fact).success).toBe(true)
    expect(recordEventSchema.safeParse({ ...fact, key: '' }).success).toBe(false)
  })

  it('accepts an assistant-said aborted by a handoff and a tool-dispatched with a bootId', () => {
    const [plain] = mint({ count: 1 })
    const aborted = {
      ...plain,
      type: 'assistant-said',
      parts: [{ type: 'text', text: 'partial' }],
      aborted: 'handoff',
    }
    delete (aborted as { text?: string }).text
    expect(recordEventSchema.safeParse(aborted).success).toBe(true)

    const dispatched = {
      ...plain,
      type: 'tool-dispatched',
      callId: 'call-1',
      name: 'bash',
      bootId: 'boot-7',
    }
    delete (dispatched as { text?: string }).text
    expect(recordEventSchema.safeParse(dispatched).success).toBe(true)
  })

  it('round-trips inboxId on outcomes and still decodes them without one', () => {
    const [plain] = mint({ count: 1 })
    const rewound = { ...plain, type: 'history-rewound', toSeq: 1 }
    delete (rewound as { text?: string }).text
    const summarised = {
      ...plain,
      type: 'history-summarised',
      fromSeq: 1,
      throughSeq: 2,
      anchor: 'prefix',
      summary: 's',
    }
    delete (summarised as { text?: string }).text
    for (const body of [rewound, summarised]) {
      expect(recordEventSchema.safeParse(body).success).toBe(true)
      expect(recordEventSchema.parse({ ...body, inboxId: 5 })).toMatchObject({ inboxId: 5 })
      expect(recordEventSchema.safeParse({ ...body, inboxId: 0 }).success).toBe(false)
    }
  })

  it('accepts an input-refused body, rejects a malformed one and keeps it record-only', () => {
    const [plain] = mint({ count: 1 })
    const refused = { ...plain, type: 'input-refused', inboxId: 4, reason: 'not now' }
    delete (refused as { text?: string }).text
    expect(recordEventSchema.safeParse(refused).success).toBe(true)
    expect(recordEventSchema.safeParse({ ...refused, inboxId: 0 }).success).toBe(false)
    expect(recordEventSchema.safeParse({ ...refused, reason: undefined }).success).toBe(false)
    expect(RECORD_ONLY_TYPES.has('input-refused')).toBe(true)
  })

  it('accepts the input log bodies and rejects malformed ones', () => {
    const [plain] = mint({ count: 1 })
    const withoutText = <T extends object>(body: T): T => {
      delete (body as { text?: string }).text
      return body
    }
    const posted = withoutText({
      ...plain,
      type: 'input-posted',
      inboxId: 4,
      kind: 'command:compact',
      postedAt: NOW,
    })
    const withdrawn = withoutText({ ...plain, type: 'input-withdrawn', inboxId: 4 })
    const restored = withoutText({
      ...plain,
      type: 'input-refused',
      inboxId: 4,
      reason: 'already-sent',
      targetInboxId: 4,
      clientId: 'c-1',
    })

    for (const body of [posted, withdrawn, restored]) {
      expect(recordEventSchema.safeParse(body).success).toBe(true)
    }
    for (const type of ['input-posted', 'input-withdrawn'] as const) {
      expect(RECORD_ONLY_TYPES.has(type)).toBe(true)
    }
    expect(recordEventSchema.parse({ ...posted, clientId: 'c-1', text: 'go' })).toMatchObject({
      clientId: 'c-1',
      kind: 'command:compact',
      postedAt: NOW,
    })
    expect(recordEventSchema.safeParse({ ...posted, postedAt: undefined }).success).toBe(false)
    expect(recordEventSchema.safeParse({ ...posted, kind: '' }).success).toBe(false)
    expect(recordEventSchema.safeParse({ ...withdrawn, inboxId: 0 }).success).toBe(false)
    expect(recordEventSchema.safeParse({ ...restored, targetInboxId: 0 }).success).toBe(false)
  })

  it('keeps a clientId on user-said so a dimmed bubble can be matched to its log event', () => {
    const [plain] = mint({ count: 1 })
    expect(recordEventSchema.parse({ ...plain, clientId: 'c-1' })).toMatchObject({
      clientId: 'c-1',
    })
  })
})
