import { describe, expect, it } from 'bun:test'

import type { Attachment, PendingInputsState } from '@dltech/atlas-core'

import { takeBackOf } from '../use-pending-take-back'

const attachment: Attachment = {
  id: 'att-1',
  name: 'diagram.png',
  mediaType: 'image/png',
  size: 12,
  content: { store: 'inline', data: 'aGVsbG8=' },
}

describe('the message Up takes back', () => {
  it('is nothing while a message is still sending', () => {
    expect(takeBackOf({ pending: [] })).toBeUndefined()
  })

  it('is the last queued message, with its text and attachments', () => {
    const pending: PendingInputsState = {
      pending: [
        {
          inboxId: 3,
          seq: 3,
          at: '2026-11-25T10:00:00.000Z',
          kind: 'message',
          message: { text: 'earlier' },
        },
        {
          inboxId: 5,
          seq: 5,
          at: '2026-11-25T10:00:01.000Z',
          kind: 'message',
          message: { text: 'ship it', attachments: [attachment] },
        },
      ],
    }
    expect(takeBackOf(pending)).toEqual({
      targetInboxId: 5,
      text: 'ship it',
      attachments: [attachment],
    })
  })

  it('is nothing for a queued command', () => {
    const pending: PendingInputsState = {
      pending: [
        {
          inboxId: 8,
          seq: 8,
          at: '2026-11-25T10:00:00.000Z',
          kind: 'command',
          event: { type: 'command-applied', command: 'compact' },
        } as never,
      ],
    }
    expect(takeBackOf(pending)).toBeUndefined()
  })
})
