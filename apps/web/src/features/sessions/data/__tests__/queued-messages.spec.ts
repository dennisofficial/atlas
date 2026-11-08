import { describe, expect, it } from 'bun:test'

import { EAttachmentStore } from '@dltech/atlas-core'
import { EQueuedAttachmentKind } from '@dltech/atlas-ui/ai/queued-messages'

import { mergeWithdrawnIntoDraft, queuedMediaHashesOf, visibleQueuedOf } from '../queued-messages'

const queued = [
  { inboxId: 1, text: 'first', postedAt: '2026-11-06T10:00:00.000Z' },
  { inboxId: 2, text: 'second', postedAt: '2026-11-06T10:00:01.000Z' },
]

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
  it('lists queued entries oldest first as composer-dock entries', () => {
    expect(visibleQueuedOf({ queued })).toEqual([
      { id: '1', text: 'first', attachments: [] },
      { id: '2', text: 'second', attachments: [] },
    ])
  })

  it('renders every entry the server queued, with no client-side hiding', () => {
    expect(visibleQueuedOf({ queued }).map((entry) => entry.id)).toEqual(['1', '2'])
  })

  it('shows nothing without a queued field', () => {
    expect(visibleQueuedOf({ queued: undefined })).toEqual([])
  })
})

describe('visibleQueuedOf attachments', () => {
  const hash = 'a'.repeat(64)
  const withAttachments = [
    {
      inboxId: 3,
      text: 'look',
      postedAt: '2026-11-06T10:00:02.000Z',
      media: [
        {
          media: {
            hash,
            mediaType: 'image/png' as const,
            size: 10,
            width: 2,
            height: 3,
          },
          source: 'shot.png',
        },
      ],
      uploads: [
        {
          uploadId: '0b6c1f9e-2d4a-4c1b-9f3e-7a2b5c8d1e40',
          pathname: 'composer-uploads/u/0b6c1f9e-2d4a-4c1b-9f3e-7a2b5c8d1e40/deploy.sh',
          name: 'deploy.sh',
          size: 7,
          mediaType: 'text/x-sh',
        },
      ],
    },
  ]

  it('shows queued images with their signed preview and files by name', () => {
    const [entry] = visibleQueuedOf({
      queued: withAttachments,
      urls: new Map([[hash, 'https://blob/shot']]),
    })
    expect(entry?.attachments).toEqual([
      {
        id: `media-0-${hash}`,
        name: 'shot.png',
        kind: EQueuedAttachmentKind.Image,
        size: 10,
        previewUrl: 'https://blob/shot',
      },
      {
        id: '0b6c1f9e-2d4a-4c1b-9f3e-7a2b5c8d1e40',
        name: 'deploy.sh',
        kind: EQueuedAttachmentKind.File,
        size: 7,
      },
    ])
  })

  it('shows the attachments the server stored on the queued message', () => {
    const picture = 'b'.repeat(64)
    const queuedWithStored = [
      {
        inboxId: 4,
        text: 'What colour fills this image?',
        postedAt: '2026-11-06T10:00:03.000Z',
        attachments: [
          {
            id: 'att-1',
            name: 'image.png',
            mediaType: 'image/png',
            size: 377,
            content: { store: EAttachmentStore.Media, hash: picture },
          },
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
    ]

    expect(queuedMediaHashesOf(queuedWithStored)).toEqual([picture])
    const [entry] = visibleQueuedOf({
      queued: queuedWithStored,
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
      {
        id: 'att-2',
        name: 'notes.txt',
        kind: EQueuedAttachmentKind.File,
        size: 12,
      },
    ])
  })

  it('lists each queued image hash once', () => {
    expect(queuedMediaHashesOf([...withAttachments, ...withAttachments])).toEqual([hash])
    expect(queuedMediaHashesOf(undefined)).toEqual([])
  })
})
