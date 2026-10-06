import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'
import { EClientFrame, EClientRequest, ECompaction, type ServeFrame } from '@dltech/atlas-harness'

import { createHistoryMutations } from '../history-mutations'
import { createRequestRouter } from '../socket-requests'
import type { SessionSocket } from '../socket-session'
import { createTurnDriver } from '../turn-driver'
import { fakeRewindTarget, fakeServeApp } from './fakes'
import { gate } from './serve-remote-fixture'

const threadId = toThreadId('history-edits')

for (const op of [
  EClientRequest.Rewind,
  EClientRequest.SayToAgent,
  EClientRequest.ApplyWorkspaceArchive,
]) {
  it(`refuses compaction while an earlier ${op} request is still applying`, async () => {
    const entered = gate()
    const release = gate()
    const hold = async (): Promise<void> => {
      entered.open()
      await release.opened
    }
    const app = fakeServeApp({ threadId, root: '/workspace' })
    const driver = createTurnDriver({
      app,
      threadId,
      onTurnStarted: () => undefined,
      onTurnEnded: () => undefined,
      onOutcome: () => undefined,
      onFailure: () => undefined,
    })
    let summaries = 0
    const responses = new Map<string, (reply: ServeFrame) => void>()
    const router = createRequestRouter({
      threadId,
      driver,
      files: app.files,
      log: () => undefined,
      snapshot: () => ({ shells: [], agents: [], services: [] }),
      send: ({ frame }) => {
        if (frame.kind === 'reply') responses.get(frame.replyTo)?.(frame)
      },
      compaction: {
        compact: async () => {
          summaries += 1
          return { type: ECompaction.Nothing }
        },
        summarise: async () => ({ type: ECompaction.Nothing }),
      },
      rewind: {
        target: { ...fakeRewindTarget(), removeChildren: hold },
        truncate: async () => undefined,
      },
      agents: {
        say: async () => {
          await hold()
          return { ok: false, reason: 'no child in this fixture' }
        },
        stop: async () => ({ ok: false, reason: 'no child' }),
        resume: async () => ({ ok: false, reason: 'no child' }),
      },
      workspace: {
        apply: async () => {
          await hold()
          return null
        },
      },
    })
    const send = (args: {
      id: string
      op: EClientRequest
      params: unknown
    }): Promise<ServeFrame> => {
      const reply = new Promise<ServeFrame>((resolve) => {
        responses.set(args.id, resolve)
      })
      router.route({ socket: {} as SessionSocket, frame: { kind: EClientFrame.Request, ...args } })
      return reply
    }
    const params =
      op === EClientRequest.Rewind
        ? { threadId, cuts: [], toSeq: 0 }
        : op === EClientRequest.SayToAgent
          ? { threadId, agentId: 'child', text: 'restart' }
          : {}
    const editing = send({ id: 'edit', op, params })
    await entered.opened
    const refused = await send({
      id: 'compact',
      op: EClientRequest.CompactHistory,
      params: { threadId, operationId: 'compact-1' },
    })
    expect(refused).toMatchObject({
      ok: false,
      data: { message: 'a history mutation is in flight — wait before summarising' },
    })
    expect(summaries).toBe(0)
    release.open()
    await editing
    expect(
      await send({
        id: 'retry',
        op: EClientRequest.CompactHistory,
        params: { threadId, operationId: 'compact-2' },
      }),
    ).toMatchObject({ ok: true, data: { type: 'nothing' } })
    expect(summaries).toBe(1)
    await app.close()
  })
}

describe('history mutation reservations', () => {
  it('releases a failed operation without weakening other concurrent reservations', async () => {
    const edits = createHistoryMutations()
    const held = gate()
    const first = edits.run(() => held.opened)
    await expect(
      edits.run(async () => {
        throw new Error('failed edit')
      }),
    ).rejects.toThrow('failed edit')
    expect(() => edits.assertAvailable()).toThrow('in flight')
    held.open()
    await first
    expect(() => edits.assertAvailable()).not.toThrow()
  })
})
