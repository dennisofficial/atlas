import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { toEventDto } from '../../platform/sessions/rows'
import { ThreadsService } from '../../platform/sessions/threads.service'
import { eventsOf, launchWith, seedBase } from './sandbox-provisioning.fixture'

const request = {
  userId: 'usr-1',
  draft: { id: 'thr_launch_events', projectId: 'prj-1' },
  firstMessage: { sendId: 'snd_launch', text: 'build this' },
}

describe('first-message launch event publication', () => {
  useTestDatabase()

  beforeEach(seedBase)

  it('carries the committed first row and epoch to creation publication, but not on retry', async () => {
    const announce = spyOn(ThreadsService.prototype, 'announceCreated')
    try {
      const { service } = launchWith()
      const reply = await service.launch(request)
      expect(reply.thread.id).toBe(request.draft.id)
      const stored = await eventsOf(request.draft.id)
      expect(announce.mock.calls).toEqual([
        [
          {
            userId: request.userId,
            threadId: request.draft.id,
            appended: { events: stored.map(toEventDto), head: 1, historyRev: 0 },
          },
        ],
      ])
      expect(await db.orm.public.Thread.first({ id: request.draft.id })).toMatchObject({
        historyRev: 0,
      })
      await service.launch(request)
      expect(announce).toHaveBeenCalledTimes(1)
      expect(await eventsOf(request.draft.id)).toHaveLength(1)
    } finally {
      announce.mockRestore()
    }
  })
})
