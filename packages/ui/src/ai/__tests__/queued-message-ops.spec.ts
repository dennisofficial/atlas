import { describe, expect, it } from 'bun:test'

import { formatSize, isEmptyDraft, removeQueued, saveQueued } from '../queued-message-ops'
import {
  EQueuedAttachmentKind,
  type QueuedAttachment,
  type QueuedMessageEntry,
} from '../queued-message-types'

const PDF: QueuedAttachment = {
  id: 'p',
  name: 'spec.pdf',
  kind: EQueuedAttachmentKind.File,
  size: 10,
}
const PNG: QueuedAttachment = { id: 'i', name: 'shot.png', kind: EQueuedAttachmentKind.Image }

const QUEUE: QueuedMessageEntry[] = [
  { id: 'a', text: 'first', attachments: [] },
  { id: 'b', text: 'second', attachments: [] },
]

describe('queued message ops', () => {
  it('removes by id', () => {
    expect(removeQueued({ queue: QUEUE, id: 'a' }).map((message) => message.id)).toEqual(['b'])
  })

  it('saves in place, trimmed, keeping position', () => {
    const next = saveQueued({ queue: QUEUE, id: 'a', text: '  edited  ', attachments: [] })

    expect(next.map((message) => message.text)).toEqual(['edited', 'second'])
  })

  it('removes the message when saved empty without attachments', () => {
    const next = saveQueued({ queue: QUEUE, id: 'b', text: '   ', attachments: [] })

    expect(next.map((message) => message.id)).toEqual(['a'])
  })

  it('keeps an attachments-only message', () => {
    const next = saveQueued({ queue: QUEUE, id: 'b', text: '  ', attachments: [PDF] })

    expect(next[1]).toEqual({ id: 'b', text: '', attachments: [PDF] })
  })

  it('replaces attachments on save', () => {
    const queue = [...QUEUE, { id: 'c', text: 'x', attachments: [PDF, PNG] }]
    const next = saveQueued({ queue, id: 'c', text: 'x', attachments: [PNG] })

    expect(next[2]?.attachments).toEqual([PNG])
  })

  it('detects an empty draft', () => {
    expect(isEmptyDraft({ text: ' ', attachments: [] })).toBe(true)
    expect(isEmptyDraft({ text: ' ', attachments: [PDF] })).toBe(false)
    expect(isEmptyDraft({ text: 'hi', attachments: [] })).toBe(false)
  })

  it('formats file sizes', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(184_320)).toBe('180 KB')
    expect(formatSize(1_245_184)).toBe('1.2 MB')
  })
})
