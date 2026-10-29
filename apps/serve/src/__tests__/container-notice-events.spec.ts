import { describe, expect, it } from 'bun:test'

import {
  ENoticeTone,
  toRunId,
  toThreadId,
  type EventDraft,
  type NoticePost,
} from '@dltech/atlas-core'

import { CONTAINER_SETUP_FAILURE_KEY } from '../container-setup'
import { collectNotices, recordNoticeEvents } from '../container-notice-events'

const post = (text: string): NoticePost => ({ text, tone: ENoticeTone.Warn })

describe('container notices as thread events', () => {
  it('forwards each notice and remembers it', () => {
    const forwarded: NoticePost[] = []
    const collected = collectNotices({ notify: (p) => void forwarded.push(p) })

    collected.port.notify(post('a'))
    collected.port.notify(post('b'))

    expect(forwarded.map((p) => p.text)).toEqual(['a', 'b'])
    expect(collected.posts.map((p) => p.text)).toEqual(['a', 'b'])
  })

  it('appends one sandbox-setup-reported event per notice and publishes', async () => {
    const appended: { threadId: string; drafts: readonly EventDraft[] }[] = []
    let published = 0
    await recordNoticeEvents({
      posts: [
        {
          text: 'Cloud setup failed: boom',
          tone: ENoticeTone.Warn,
          key: CONTAINER_SETUP_FAILURE_KEY,
        },
        post('image: not applied in Cloud sandboxes'),
      ],
      threadId: toThreadId('t1'),
      app: {
        log: {
          append: async (args: { threadId: string; drafts: readonly EventDraft[] }) => {
            appended.push(args)
            return []
          },
        },
        ids: { nextRunId: () => toRunId('run-1') },
        channel: { publisherFor: () => ({ eventsAppended: () => void (published += 1) }) },
      },
      log: () => undefined,
    })

    expect(appended.flatMap((entry) => entry.drafts)).toEqual([
      { type: 'sandbox-setup-reported', text: 'Cloud setup failed: boom', failed: true },
      {
        type: 'sandbox-setup-reported',
        text: 'image: not applied in Cloud sandboxes',
        failed: false,
      },
    ])
    expect(published).toBe(1)
  })

  it('appends nothing when no notice was posted', async () => {
    let calls = 0
    await recordNoticeEvents({
      posts: [],
      threadId: toThreadId('t1'),
      app: {
        log: {
          append: async () => {
            calls += 1
            return []
          },
        },
        ids: { nextRunId: () => toRunId('run-1') },
        channel: { publisherFor: () => ({ eventsAppended: () => undefined }) },
      },
      log: () => undefined,
    })
    expect(calls).toBe(0)
  })
})
