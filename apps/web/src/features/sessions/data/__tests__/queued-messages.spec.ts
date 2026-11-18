import { describe, expect, it } from 'bun:test'

import { EAttachmentStore, type PendingInputsState } from '@dltech/atlas-core'
import { EQueuedAttachmentKind } from '@dltech/atlas-ui/ai/queued-messages'

import {
  mergeWithdrawnIntoDraft,
  queuedMediaHashesOf,
  stagedQueuedOf,
  visibleQueuedOf,
} from '../queued-messages'

type StoredSeed = {
  id: string
  name: string
  mediaType: string
  size: number
  content: { store: EAttachmentStore; hash?: string; uploadId?: string; pathname?: string }
}

type PendingSeed = {
  inboxId: number
  text?: string
  attachments?: readonly StoredSeed[]
}

const pendingOf = (seeds: readonly PendingSeed[]): PendingInputsState => ({
  pending: seeds.map((seed) => ({
    inboxId: seed.inboxId,
    seq: seed.inboxId,
    at: '2026-11-18T10:00:00.000Z',
    kind: 'message',
    message: {
      text: seed.text ?? '',
      clientId: `client-${seed.inboxId}`,
      ...(seed.attachments === undefined ? {} : { attachments: seed.attachments as never }),
    },
  })),
})

const pending = pendingOf([
  { inboxId: 1, text: 'first' },
  { inboxId: 2, text: 'second' },
])

describe('mergeWithdrawnIntoDraft', () => {
  it('uses the withdrawn text alone when the draft is blank', () => {
    expect(mergeWithdrawnIntoDraft({ withdrawn: 'hello', draft: '' })).toBe('hello')
    expect(mergeWithdrawnIntoDraft({ withdrawn: 'hello', draft: '  \n' })).toBe('hello')
  })

  it('puts the withdrawn text first, a blank line, then the existing draft', () => {
    expect(mergeWithdrawnIntoDraft({ withdrawn: 'hello', draft: 'typing' })).toBe('hello\n\ntyping')
  })
})

describe('visibleQueuedOf', () => {
  it('lists the folded pending messages oldest first, keyed by inboxId', () => {
    expect(visibleQueuedOf({ pending })).toEqual([
      { id: '1', text: 'first', attachments: [] },
      { id: '2', text: 'second', attachments: [] },
    ])
  })

  it('shows nothing when the fold holds no message', () => {
    expect(visibleQueuedOf({ pending: { pending: [] } })).toEqual([])
  })
})

describe('stagedQueuedOf', () => {
  it('renders a staged message keyed by its clientId, before any inboxId exists', () => {
    expect(
      stagedQueuedOf({
        staged: [{ clientId: 'client-9', text: 'queued while working', attachments: [] }],
      }),
    ).toEqual([{ id: 'client-9', text: 'queued while working', attachments: [] }])
  })
})

describe('queued attachments', () => {
  const picture = 'b'.repeat(64)
  const storedPicture: StoredSeed = {
    id: 'att-1',
    name: 'image.png',
    mediaType: 'image/png',
    size: 377,
    content: { store: EAttachmentStore.Media, hash: picture },
  }

  it('shows a stored image with its signed preview and a file by name', () => {
    const withAttachments = pendingOf([
      {
        inboxId: 4,
        text: 'What colour fills this image?',
        attachments: [
          storedPicture,
          {
            id: 'att-2',
            name: 'notes.txt',
            mediaType: 'text/plain',
            size: 12,
            content: {
              store: EAttachmentStore.Upload,
              uploadId: '0b6c1f9e-2d4a-4c1b-9f3e-7a2b5c8d1e41',
              pathname: 'composer-uploads/u/notes.txt',
            },
          },
        ],
      },
    ])

    expect(queuedMediaHashesOf({ pending: withAttachments, staged: [] })).toEqual([picture])
    const [entry] = visibleQueuedOf({
      pending: withAttachments,
      urls: new Map([[picture, 'https://blob/image']]),
    })
    expect(entry?.attachments).toEqual([
      {
        id: 'att-1',
        name: 'image.png',
        kind: EQueuedAttachmentKind.Image,
        size: 377,
        previewUrl: 'https://blob/image',
      },
      { id: 'att-2', name: 'notes.txt', kind: EQueuedAttachmentKind.File, size: 12 },
    ])
  })

  it('lists each image hash once across the fold and the staged messages', () => {
    expect(
      queuedMediaHashesOf({
        pending: pendingOf([{ inboxId: 5, text: 'one', attachments: [storedPicture] }]),
        staged: [
          {
            clientId: 'client-5',
            text: 'the same picture again',
            attachments: [{ ...storedPicture, id: 'att-4' }],
          },
        ],
      }),
    ).toEqual([picture])
    expect(queuedMediaHashesOf({ pending: { pending: [] }, staged: [] })).toEqual([])
  })
})
