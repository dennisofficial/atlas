import { describe, expect, it } from 'bun:test'

import { EAttachmentStore, type Attachment } from '@dltech/atlas-core'

import {
  createDraftSync,
  DRAFT_DEBOUNCE_MS,
  type DraftContent,
  type DraftSchedule,
} from '../draft-sync'

const uploadAttachment: Attachment = {
  id: 'chip-upload',
  name: 'a.txt',
  mediaType: 'text/plain',
  size: 3,
  content: {
    store: EAttachmentStore.Upload,
    uploadId: '11111111-1111-4111-8111-111111111111',
    pathname: 'u/a.txt',
  },
}

const mediaAttachment = (args: {
  id: string
  hash: string
  inline?: string | undefined
}): Attachment => ({
  id: args.id,
  name: 'b.png',
  mediaType: 'image/png',
  size: 12,
  content:
    args.inline === undefined
      ? { store: EAttachmentStore.Media, hash: args.hash }
      : { store: EAttachmentStore.Media, hash: args.hash, inline: args.inline },
})

function setup(options: { failPut?: boolean } = {}) {
  const puts: DraftContent[] = []
  let clears = 0
  const timers: { run: () => void; delayMs: number; live: boolean }[] = []
  const schedule: DraftSchedule = (run, delayMs) => {
    const timer = { run, delayMs, live: true }
    timers.push(timer)
    return () => {
      timer.live = false
    }
  }
  const sync = createDraftSync({
    schedule,
    put: async (content) => {
      puts.push(content)
      if (options.failPut) throw new Error('offline')
    },
    clear: async () => {
      clears += 1
    },
  })
  const fire = async () => {
    for (const timer of timers) {
      if (!timer.live) continue
      timer.live = false
      timer.run()
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { sync, puts, clears: () => clears, timers, fire }
}

describe('createDraftSync', () => {
  it('coalesces rapid changes into one put with the latest content', async () => {
    const { sync, puts, timers, fire } = setup()
    sync.loaded(null)
    sync.change({ text: 'h', attachments: [] })
    sync.change({ text: 'he', attachments: [] })
    sync.change({ text: 'hel', attachments: [] })
    expect(timers.filter((timer) => timer.live)).toHaveLength(1)
    expect(timers[0]?.delayMs).toBe(DRAFT_DEBOUNCE_MS)
    await fire()
    expect(puts).toEqual([{ text: 'hel', attachments: [] }])
  })

  it('does not write while the initial fetch is loading', async () => {
    const { sync, puts, timers, fire } = setup()
    sync.change({ text: '', attachments: [] })
    expect(timers).toHaveLength(0)
    await fire()
    expect(puts).toHaveLength(0)
  })

  it('writes what the user typed during a slow fetch instead of the stored draft', async () => {
    const { sync, puts, fire } = setup()
    sync.change({ text: 'typed', attachments: [] })
    expect(sync.loaded({ text: 'old', attachments: [] })).toBeNull()
    await fire()
    expect(puts).toEqual([{ text: 'typed', attachments: [] }])
  })

  it('returns the stored draft to restore and does not write it back', async () => {
    const { sync, puts, timers, fire } = setup()
    sync.change({ text: '', attachments: [] })
    const restored = sync.loaded({ text: 'saved', attachments: [uploadAttachment] })
    expect(restored).toEqual({ text: 'saved', attachments: [uploadAttachment] })
    sync.change({ text: 'saved', attachments: [{ ...uploadAttachment }] })
    expect(timers).toHaveLength(0)
    await fire()
    expect(puts).toHaveLength(0)
  })

  it('writes again once the user edits a restored draft', async () => {
    const { sync, puts, fire } = setup()
    sync.change({ text: '', attachments: [] })
    sync.loaded({ text: 'saved', attachments: [] })
    sync.change({ text: 'saved!', attachments: [] })
    await fire()
    expect(puts).toEqual([{ text: 'saved!', attachments: [] }])
  })

  it('writes an attachment-only change', async () => {
    const { sync, puts, fire } = setup()
    sync.loaded(null)
    sync.change({ text: '', attachments: [uploadAttachment] })
    await fire()
    expect(puts).toEqual([{ text: '', attachments: [uploadAttachment] }])
  })

  it('keys a restored attachment by its content, not by its new chip id', async () => {
    const { sync, puts, timers, fire } = setup()
    sync.change({ text: '', attachments: [] })
    sync.loaded({ text: 'saved', attachments: [mediaAttachment({ id: 'old', hash: 'h1' })] })
    sync.change({ text: 'saved', attachments: [mediaAttachment({ id: 'new', hash: 'h1' })] })
    expect(timers).toHaveLength(0)
    sync.change({ text: 'saved', attachments: [mediaAttachment({ id: 'new', hash: 'h2' })] })
    expect(timers).toHaveLength(1)
    await fire()
    expect(puts.map((put) => put.attachments.map((attachment) => attachment.id))).toEqual([['new']])
  })

  it('strips inline bytes and inline-store attachments from the put', async () => {
    const { sync, puts, fire } = setup()
    sync.loaded(null)
    sync.change({
      text: 'with bytes',
      attachments: [
        {
          ...uploadAttachment,
          content: {
            store: EAttachmentStore.Upload,
            uploadId: '11111111-1111-4111-8111-111111111111',
            pathname: 'u/a.txt',
            inline: 'AAAA',
          },
        },
        mediaAttachment({ id: 'm1', hash: 'h1', inline: 'BBBB' }),
        {
          id: 'pasted',
          name: 'c.png',
          mediaType: 'image/png',
          size: 4,
          content: { store: EAttachmentStore.Inline, data: 'CCCC' },
        },
      ],
    })
    await fire()
    expect(puts).toEqual([
      {
        text: 'with bytes',
        attachments: [uploadAttachment, mediaAttachment({ id: 'm1', hash: 'h1' })],
      },
    ])
  })

  it('clears the server draft after a send and cancels a pending put', async () => {
    const { sync, puts, clears, fire } = setup()
    sync.loaded(null)
    sync.change({ text: 'ship it', attachments: [] })
    sync.handleSent('ship it')
    await fire()
    expect(clears()).toBe(1)
    expect(puts).toHaveLength(0)
  })

  it('does not write the sent text back while the composer still shows it', async () => {
    const { sync, puts, clears, fire } = setup()
    sync.loaded(null)
    sync.change({ text: 'ship it', attachments: [] })
    await fire()
    sync.handleSent('ship it')
    sync.change({ text: 'ship it', attachments: [] })
    await fire()
    sync.change({ text: '', attachments: [] })
    await fire()
    expect(puts).toHaveLength(1)
    expect(clears()).toBe(1)
  })

  it('writes normally once the user types after a send', async () => {
    const { sync, puts, fire } = setup()
    sync.loaded(null)
    sync.handleSent('done')
    sync.change({ text: 'next', attachments: [] })
    await fire()
    expect(puts).toEqual([{ text: 'next', attachments: [] }])
  })

  it('clears the server draft when the composer is emptied by the user', async () => {
    const { sync, clears, fire } = setup()
    sync.loaded(null)
    sync.change({ text: 'a', attachments: [] })
    await fire()
    sync.change({ text: '', attachments: [] })
    await fire()
    expect(clears()).toBe(1)
  })

  it('swallows put failures and keeps syncing later changes', async () => {
    const { sync, puts, fire } = setup({ failPut: true })
    sync.loaded(null)
    sync.change({ text: 'a', attachments: [] })
    await fire()
    sync.change({ text: 'ab', attachments: [] })
    await fire()
    expect(puts.map((put) => put.text)).toEqual(['a', 'ab'])
  })

  it('flushes a pending write on demand and ignores changes after dispose', async () => {
    const { sync, puts, fire } = setup()
    sync.loaded(null)
    sync.change({ text: 'pending', attachments: [] })
    sync.flush()
    sync.dispose()
    sync.change({ text: 'late', attachments: [] })
    await fire()
    expect(puts.map((put) => put.text)).toEqual(['pending'])
  })

  it('flushes nothing when no write is pending', async () => {
    const { sync, puts, clears, timers, fire } = setup()
    sync.loaded(null)
    sync.flush()
    await fire()
    sync.change({ text: 'typed', attachments: [] })
    await fire()
    sync.flush()
    await fire()
    expect(timers).toHaveLength(1)
    expect(puts.map((put) => put.text)).toEqual(['typed'])
    expect(clears()).toBe(0)
  })

  it('ignores a fetch that resolves after dispose', () => {
    const { sync } = setup()
    sync.dispose()
    expect(sync.loaded({ text: 'saved', attachments: [] })).toBeNull()
  })
})
