import { afterEach, describe, expect, it } from 'bun:test'
import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import {
  EClientFrame,
  EClientRequest,
  EServeFrame,
  type ReadActivityReply,
} from '@dltech/atlas-wire'

import { answerReadActivity, routeActivityRead } from '../activity-requests'
import { isReadOnlyFrame } from '../socket-state-requests'
import { connect } from './client'
import { fakeServeApp } from './fakes'
import {
  releaseServeSpec,
  startWithHomeSpec,
  threadId as served,
  TOKEN,
} from './serve-spec-fixture'

afterEach(releaseServeSpec)

const root = toThreadId('root')
const child = toThreadId('child')
const grandchild = toThreadId('grandchild')
const idle: ReadActivityReply = {
  runtimeId: 'runtime-1',
  revision: 0,
  turnEpoch: 0,
  working: false,
  awaiting: null,
  observedOutcome: null,
}
const frameOf = (params: unknown) => ({
  kind: EClientFrame.Request as const,
  id: 'activity-1',
  op: EClientRequest.ReadActivity,
  params,
})

const fixture = () => {
  const reads: ThreadId[] = []
  const activity = {
    read: async ({ threadId }: { threadId: ThreadId }) => {
      reads.push(threadId)
      return idle
    },
  }
  const threads = {
    spawned: async ({ threadId }: { threadId: ThreadId }) => {
      const id = threadId === root ? child : threadId === child ? grandchild : undefined
      return id === undefined
        ? []
        : [
            {
              id,
              head: 0,
              createdAt: '',
              updatedAt: '',
              workspace: null,
              repo: null,
            },
          ]
    },
  }
  return { activity, threads, reads }
}

describe('read-activity requests', () => {
  it('carries the registered app reader through boot and socket routing', async () => {
    const reads: ThreadId[] = []
    const app = fakeServeApp({ threadId: served, root: '/workspace' })
    const handle = await startWithHomeSpec({
      compose: async () => ({
        ...app,
        activity: {
          read: async ({ threadId }) => {
            reads.push(threadId)
            return idle
          },
        },
      }),
    })
    const client = await connect({ port: handle.port, token: TOKEN })
    try {
      client.send({
        kind: EClientFrame.Hello,
        threadId: served,
        channelCursor: null,
        lastEventSeq: 0,
      })
      await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
      client.send(frameOf({ threadId: served }))
      const reply = await client.waitFor(
        (frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'activity-1',
      )
      expect(reply).toEqual({
        kind: EServeFrame.Reply,
        replyTo: 'activity-1',
        ok: true,
        data: idle,
      })
      expect(reads).toEqual([served])
    } finally {
      client.close()
    }
  })

  it('refuses unknown, foreign and malformed addresses before reading activity', async () => {
    const test = fixture()
    for (const params of [
      { threadId: 'foreign' },
      { threadId: 'unknown' },
      { threadId: root, wake: true },
      {},
      { threadId: '' },
    ]) {
      expect(
        (
          await answerReadActivity({
            frame: frameOf(params),
            root,
            activity: test.activity,
            threads: test.threads,
          })
        ).ok,
      ).toBe(false)
    }
    expect(test.reads).toEqual([])
  })

  it('does not replace failed or malformed runtime readings with idle', async () => {
    const test = fixture()
    await expect(
      answerReadActivity({
        frame: frameOf({ threadId: root }),
        root,
        threads: test.threads,
        activity: {
          read: async () => {
            throw new Error('approval initialization failed')
          },
        },
      }),
    ).rejects.toThrow('approval initialization failed')
    await expect(
      answerReadActivity({
        frame: frameOf({ threadId: root }),
        root,
        threads: test.threads,
        activity: { read: async () => ({ ...idle, revision: -1 }) },
      }),
    ).rejects.toThrow()
    expect(isReadOnlyFrame(frameOf({ threadId: root }))).toBe(true)
  })

  it('routes failed initialization to a refused reply instead of a fabricated snapshot', async () => {
    const test = fixture()
    const response = new Promise<unknown>((reply) => {
      expect(
        routeActivityRead({
          frame: frameOf({ threadId: root }),
          root,
          threads: test.threads,
          reply,
          activity: {
            read: async () => {
              throw new Error('activity unavailable')
            },
          },
        }),
      ).toBe(true)
    })
    expect(await response).toEqual({
      kind: EServeFrame.Reply,
      replyTo: 'activity-1',
      ok: false,
      data: { message: 'activity unavailable' },
    })
    const replies: unknown[] = []
    expect(
      routeActivityRead({
        frame: frameOf({ threadId: root }),
        root,
        activity: test.activity,
        threads: undefined,
        reply: (frame) => replies.push(frame),
      }),
    ).toBe(true)
    expect(replies).toEqual([
      {
        kind: EServeFrame.Reply,
        replyTo: 'activity-1',
        ok: false,
        data: { message: 'this serve cannot read activity' },
      },
    ])
    expect(test.reads).toEqual([])
  })

  it('answers registered root and descendant readings without reconstructing activity', async () => {
    const test = fixture()
    for (const threadId of [root, child, grandchild]) {
      expect(
        await answerReadActivity({
          frame: frameOf({ threadId }),
          root,
          activity: test.activity,
          threads: test.threads,
        }),
      ).toEqual({ kind: EServeFrame.Reply, replyTo: 'activity-1', ok: true, data: idle })
    }
    expect(test.reads).toEqual([root, child, grandchild])
  })
})
