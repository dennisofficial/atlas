import { useTestDatabase } from '@dltech/atlas-db/testing'
import { EThreadStreamFrame } from '@dltech/atlas-wire'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedUsers, threadById, USER_A } from '../../../../test/session-seed'
import { recordingSignals } from './thread-signals.fixture'
import { ThreadsService } from './threads.service'

const context = {
  type: 'context-loaded',
  body: '{}',
  contextSlot: 'file',
  contextKey: 'a',
  contextDigest: 'same',
}
const said = { type: 'user-said', body: '{}' }
const target = { userId: USER_A }
const identity = { threadId: 'thr_open', runId: 'run_open' }

describe('thread open event publication', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers(USER_A)
  })

  it('initial open publishes newly stored events once while preserving the reply', async () => {
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf(identity.threadId)
    const reply = await new ThreadsService(signals).open({
      ...target,
      draft: { ...identity, drafts: [context, context, said] },
    })
    expect(reply.events.map((event) => event.seq)).toEqual([1, 1, 2])
    expect(Object.keys(reply).sort()).toEqual(['events', 'thread'])
    expect(frames).toEqual([
      {
        type: EThreadStreamFrame.Events,
        fromSeq: 1,
        historyRev: 0,
        events: reply.events.filter((_, index) => index !== 1),
      },
      { type: EThreadStreamFrame.Head, head: 2, historyRev: 0 },
    ])
    expect(await threadById(identity.threadId)).toMatchObject({ head: 2, historyRev: 0 })
  })

  it('reopening publishes only fresh suffix rows, never duplicate reused contexts', async () => {
    const { signals, framesOf } = recordingSignals()
    const service = new ThreadsService(signals)
    await service.open({ ...target, draft: { ...identity, drafts: [context] } })
    const frames = framesOf(identity.threadId)
    const reply = await service.open({
      ...target,
      draft: { ...identity, drafts: [context, context, said] },
    })
    expect(reply.events.map((event) => event.seq)).toEqual([1, 2])
    expect(frames).toEqual([
      { type: EThreadStreamFrame.Events, fromSeq: 2, historyRev: 0, events: reply.events.slice(1) },
      { type: EThreadStreamFrame.Head, head: 2, historyRev: 0 },
    ])
    expect(await threadById(identity.threadId)).toMatchObject({ head: 2, historyRev: 0 })
  })

  it('a transfer with only reused suffix drafts publishes nothing', async () => {
    const { signals, framesOf } = recordingSignals()
    const service = new ThreadsService(signals)
    await service.open({ ...target, draft: { ...identity, drafts: [context] } })
    const frames = framesOf(identity.threadId)
    const reply = await service.open({
      ...target,
      draft: { ...identity, drafts: [context, context] },
    })
    expect(reply.events).toHaveLength(1)
    expect(frames).toEqual([])
    expect(await threadById(identity.threadId)).toMatchObject({ head: 1, historyRev: 0 })
  })

  it('concurrent replays serialize boundary inspection and append the novel suffix once', async () => {
    const { signals, framesOf } = recordingSignals()
    const service = new ThreadsService(signals)
    await service.open({ ...target, draft: { ...identity, drafts: [said] } })
    const frames = framesOf(identity.threadId)
    const replies = await Promise.all(
      Array.from({ length: 4 }, () =>
        service.open({
          ...target,
          draft: { ...identity, drafts: [said, said] },
        }),
      ),
    )
    expect(replies.every((reply) => reply.thread.head === 2 && reply.events.length === 2)).toBe(
      true,
    )
    expect(frames.filter((frame) => frame.type === EThreadStreamFrame.Events)).toHaveLength(1)
    expect(await threadById(identity.threadId)).toMatchObject({ head: 2, historyRev: 0 })
  })
})
