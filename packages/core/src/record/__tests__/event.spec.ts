import { describe, expect, it } from 'bun:test'

import { v2EventSchema } from '../event'
import { mint } from './support'

describe('v2EventSchema', () => {
  it('accepts a minted v1 body event and a record body event', () => {
    const [plain] = mint({ count: 1 })
    expect(v2EventSchema.safeParse(plain).success).toBe(true)
    const consumed = { ...plain, type: 'input-consumed', inboxId: 1 }
    delete (consumed as { text?: string }).text
    expect(v2EventSchema.safeParse(consumed).success).toBe(true)
  })

  it('rejects a bad prevHash, an unknown type and a bad record body', () => {
    const [plain] = mint({ count: 1 })
    expect(v2EventSchema.safeParse({ ...plain, prevHash: 'abc' }).success).toBe(false)
    expect(v2EventSchema.safeParse({ ...plain, type: 'nope' }).success).toBe(false)
    expect(v2EventSchema.safeParse({ ...plain, type: 'history-rewound', toSeq: -1 }).success).toBe(
      false,
    )
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
    expect(v2EventSchema.safeParse(compacted).success).toBe(false)
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
    expect(v2EventSchema.safeParse(fact).success).toBe(true)
    expect(v2EventSchema.safeParse({ ...fact, key: '' }).success).toBe(false)
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
    expect(v2EventSchema.safeParse(aborted).success).toBe(true)

    const dispatched = {
      ...plain,
      type: 'tool-dispatched',
      callId: 'call-1',
      name: 'bash',
      bootId: 'boot-7',
    }
    delete (dispatched as { text?: string }).text
    expect(v2EventSchema.safeParse(dispatched).success).toBe(true)
  })
})
