import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'bun:test'

import {
  stampDrafts,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventLogPort,
} from '@dltech/atlas-core'

import { createDeltaChannel } from '../../channel/delta-channel'
import { recorder } from '../../channel/__tests__/signals'
import { createIsolatedContainer, registeredPortToken } from '../../container/injection'
import { DeltaChannelToken } from '../../container/tokens'
import { DiagramRepairPort } from '../../diagrams/diagram-repair-port'
import { bindDiagramRepair } from '../compose-diagram-repair'

const threadId = toThreadId('thr-1')

const generated = (text: string): LanguageModelV4GenerateResult => ({
  content: [{ type: 'text', text }],
  finishReason: { unified: 'stop', raw: undefined },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
  warnings: [],
})

function memoryLog(): EventLogPort {
  const rows: Event[] = []
  return {
    async append({ threadId: target, runId, drafts }) {
      const envelopes = drafts.map((_, index) => ({
        id: toEventId(`event-${rows.length + index + 1}`),
        seq: rows.length + index + 1,
        threadId: target,
        runId,
        depth: 0,
        at: '2026-11-05T00:00:00.000Z',
      }))
      const stamped = stampDrafts({ drafts, envelopes })
      rows.push(...stamped)
      return stamped
    },
    read: async () => [...rows],
    refresh: async () => {},
    head: async () => rows.length,
    readOwn: async () => [...rows],
    replace: async () => [],
  }
}

describe('bindDiagramRepair', () => {
  it('announces the repaired diagram on the channel so clients refetch the transcript', async () => {
    const container = createIsolatedContainer()
    const channel = createDeltaChannel()
    container.register(DeltaChannelToken, { useValue: channel })
    const model = new MockLanguageModelV4({
      doGenerate: async () => generated('```mermaid\ngraph TD\n  A["a;b"] --> B\n```'),
    })
    bindDiagramRepair({
      container,
      log: memoryLog(),
      model: () => model,
      modelId: () => 'claude-x',
      runId: () => toRunId('run-1'),
    })
    const { seen, listener } = recorder()
    channel.subscribe({ threadId, listener })

    const outcome = await container.resolve(registeredPortToken(DiagramRepairPort)).repair({
      threadId,
      messageId: toEventId('evt-1'),
      source: 'graph TD\n  A[a;b] --> B',
      error: 'Parse error on line 2',
    })

    expect(outcome).toMatchObject({ kind: 'repaired' })
    expect(seen).toEqual([{ type: 'events-appended' }])
  })
})
