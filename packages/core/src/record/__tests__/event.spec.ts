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
})
