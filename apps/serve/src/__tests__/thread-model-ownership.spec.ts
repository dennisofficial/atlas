import { describe, expect, it } from 'bun:test'
import { EForkMode, toThreadId, type ThreadId } from '@dltech/atlas-core'
import { EClientFrame, EClientRequest, type ThreadSummary } from '@dltech/atlas-harness'

import { answerSetThreadModel } from '../thread-model'
import { PICKED } from './child-model-fixture'

const ROOT = toThreadId('served-root')
const TARGET = toThreadId('target')
const ANCESTOR = toThreadId('ancestor')

const summary = (args: { id: ThreadId; spawnedBy?: ThreadId }): ThreadSummary => ({
  id: args.id,
  head: 0,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  workspace: '/workspace',
  repo: null,
  ...(args.spawnedBy === undefined ? {} : { agent: { spawnedBy: args.spawnedBy, type: 'explore' } }),
})

const cases: { name: string; rows: ThreadSummary[] }[] = [
  { name: 'a missing ancestor', rows: [summary({ id: TARGET, spawnedBy: ANCESTOR })] },
  { name: 'a self-cycle', rows: [summary({ id: TARGET, spawnedBy: TARGET })] },
  { name: 'a multi-thread cycle', rows: [summary({ id: TARGET, spawnedBy: ANCESTOR }), summary({ id: ANCESTOR, spawnedBy: TARGET })] },
  { name: 'fork ancestry rather than supervision', rows: [{ ...summary({ id: TARGET }), parent: { threadId: ROOT, forkSeq: 0 }, forkMode: EForkMode.Reference }] },
  { name: 'a detached ancestor', rows: [summary({ id: TARGET, spawnedBy: ANCESTOR }), summary({ id: ANCESTOR })] },
]

describe('cloud model retarget ownership', () => {
  for (const scenario of cases) {
    it(`refuses ${scenario.name} without writing, broadcasting, or selecting main`, async () => {
      const rows = new Map([summary({ id: ROOT }), ...scenario.rows].map((thread) => [thread.id, thread]))
      const written: unknown[] = []
      const selected: unknown[] = []
      const reply = await answerSetThreadModel({
        frame: {
          kind: EClientFrame.Request,
          id: 'ownership',
          op: EClientRequest.SetThreadModel,
          params: { threadId: TARGET, model: PICKED, retarget: true },
        },
        threadId: ROOT,
        transcript: {
          log: { read: async () => [], readOwn: async () => [], head: async () => 0 },
          threads: {
            find: async ({ threadId }) => rows.get(threadId),
            spawned: async () => [],
            rename: async () => undefined,
            chooseModel: async (args) => void written.push(args),
          },
          ledger: { forThreadTree: async () => ({ own: [], delegated: [] }) },
        },
        select: (model) => void selected.push(model),
      })
      expect(reply).toMatchObject({ ok: false, data: { message: 'the model target does not belong to this served session' } })
      expect(written).toEqual([])
      expect(selected).toEqual([])
    })
  }
})
