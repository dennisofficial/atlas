import { describe, expect, it } from 'bun:test'
import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import { EClientFrame, EClientRequest, type ThreadSummary } from '@dltech/atlas-harness'

import { EServeEvent, type ServeLogLine } from '../serve-log'
import { answerSetThreadModel } from '../thread-model'
import { PICKED } from './child-model-fixture'

const ROOT = toThreadId('served-root')
const CHILD = toThreadId('child')

const summary = (args: { id: ThreadId; spawnedBy?: ThreadId }): ThreadSummary => ({
  id: args.id,
  head: 0,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  workspace: '/workspace',
  repo: null,
  ...(args.spawnedBy === undefined
    ? {}
    : { agent: { spawnedBy: args.spawnedBy, type: 'explore' } }),
})

const answer = async (args: {
  target: ThreadId
  persist?: (model: { ref: string; effort: string }) => Promise<void>
  log?: (line: ServeLogLine) => void
}) => {
  const rows = new Map(
    [summary({ id: ROOT }), summary({ id: CHILD, spawnedBy: ROOT })].map((row) => [row.id, row]),
  )
  const order: string[] = []
  const reply = await answerSetThreadModel({
    frame: {
      kind: EClientFrame.Request,
      id: 'persist',
      op: EClientRequest.SetThreadModel,
      params: { threadId: args.target, model: PICKED, retarget: true },
    },
    threadId: ROOT,
    transcript: {
      log: { read: async () => [], readOwn: async () => [], head: async () => 0 },
      threads: {
        find: async ({ threadId }) => rows.get(threadId),
        spawned: async () => [],
        rename: async () => undefined,
        chooseModel: async () => void order.push('stored'),
      },
      ledger: { forThreadTree: async () => ({ own: [], delegated: [] }) },
    },
    select: () => void order.push('selected'),
    ...(args.persist === undefined
      ? {}
      : {
          persist: async (model) => {
            order.push('persisted')
            await args.persist?.(model)
          },
        }),
    ...(args.log === undefined ? {} : { log: args.log }),
  })
  return { reply, order }
}

describe('set-thread-model persistence', () => {
  it('persists the root thread model after applying it locally', async () => {
    const persisted: unknown[] = []
    const { reply, order } = await answer({
      target: ROOT,
      persist: async (model) => void persisted.push(model),
    })
    expect(reply).toMatchObject({ ok: true })
    expect(persisted).toEqual([PICKED])
    expect(order).toEqual(['stored', 'selected', 'persisted'])
  })

  it('does not persist a supervised child retarget', async () => {
    const persisted: unknown[] = []
    const { reply } = await answer({
      target: CHILD,
      persist: async (model) => void persisted.push(model),
    })
    expect(reply).toMatchObject({ ok: true })
    expect(persisted).toEqual([])
  })

  it('still answers success and logs when persisting fails', async () => {
    const lines: ServeLogLine[] = []
    const { reply } = await answer({
      target: ROOT,
      persist: async () => {
        throw new Error('api down')
      },
      log: (line) => void lines.push(line),
    })
    expect(reply).toMatchObject({ ok: true, data: { model: PICKED } })
    expect(lines).toEqual([
      { event: EServeEvent.ThreadModelPersistFailed, threadId: ROOT, message: 'api down' },
    ])
  })

  it('answers without persisting when no persister is bound', async () => {
    const { reply, order } = await answer({ target: ROOT })
    expect(reply).toMatchObject({ ok: true })
    expect(order).toEqual(['stored', 'selected'])
  })
})
