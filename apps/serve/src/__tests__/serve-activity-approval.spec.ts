import { describe, expect, it } from 'bun:test'

import { toThreadId, type Event } from '@dltech/atlas-core'

import { createApprovalWatcher } from '../serve-activity-approval'

const threadId = toThreadId('thread-approval')

const event = (seq: number, type: string, callId: string): Event =>
  ({ seq, type, callId }) as unknown as Event

describe('createApprovalWatcher', () => {
  it('reports waiting while an approval is unanswered and clears when answered', async () => {
    const stored: Event[] = []
    const changes: boolean[] = []
    const watcher = createApprovalWatcher({
      threadId,
      log: {
        head: async () => stored.at(-1)?.seq ?? 0,
        readOwn: async ({ fromSeq }) => stored.filter((e) => e.seq >= (fromSeq ?? 0)),
      },
      onChange: (waiting) => changes.push(waiting),
    })

    stored.push(event(1, 'approval-requested', 'c1'))
    watcher.refresh()
    await new Promise((resolve) => setTimeout(resolve, 10))
    stored.push(event(2, 'approval-answered', 'c1'))
    watcher.refresh()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(changes).toEqual([true, false])
  })
})
