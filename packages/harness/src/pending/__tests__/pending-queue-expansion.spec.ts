import { EContextSlot, EMessageOrigin, type EventDraft } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { createPendingQueue } from '../pending-queue'

const expandContext = ({ text }: { text: string }): readonly EventDraft[] =>
  text.startsWith('/review')
    ? [{ type: 'context-loaded', slot: EContextSlot.Skill, key: 'review', content: text }]
    : []

describe('skill expansion at dequeue', () => {
  it('expands at prepare using the edited text and never stores the expansion', () => {
    const queue = createPendingQueue({ expandContext })
    queue.enqueue({ text: 'hello' })
    const id = queue.getSnapshot()[0]?.id ?? ''
    queue.update({ id, text: '/review now' })

    const batch = queue.prepare()
    expect(batch.drafts.map((draft) => draft.type)).toEqual(['context-loaded', 'user-said'])
    batch.release?.()

    expect(queue.takeBackLast()).toEqual({ text: '/review now', images: [], files: [] })
  })

  it('drains stored context only, without expanding', () => {
    const queue = createPendingQueue({ expandContext })
    queue.enqueue({ text: '/review' })
    expect(queue.drain()[0]?.context).toBeUndefined()
  })

  it('expands nothing without an expander or for non-operator messages', () => {
    const plain = createPendingQueue()
    plain.enqueue({ text: '/review' })
    expect(plain.prepare().drafts).toHaveLength(1)

    const queue = createPendingQueue({ expandContext })
    queue.enqueue({ text: '/review', via: EMessageOrigin.ParentAgent })
    expect(queue.prepare().drafts).toHaveLength(1)
  })
})
