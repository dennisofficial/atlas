import { describe, expect, it } from 'bun:test'

import { EClientRequest } from '@dltech/atlas-client/channel'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { requestDiagramRepair } from '../diagram-repair'
import { eventsFromWire } from '../events-from-wire'
import { durableTranscriptOf, ETranscriptKind, transcriptViewOf } from '../transcript-items'

const BROKEN = 'sequenceDiagram\n  A->>M: types; M-->>A: ends -'
const FIXED = 'sequenceDiagram\n  A->>M: types\n  M-->>A: ends'
const answer = (source: string) => ['Flow:', '', '```mermaid', source, '```'].join('\n')

const wire = (seq: number, body: Record<string, unknown>): WireEvent => ({
  id: `evt_${seq}`,
  threadId: 'thr_1',
  seq,
  runId: 'run_1',
  depth: 0,
  at: `2026-11-05T10:00:${String(seq).padStart(2, '0')}.000Z`,
  type: String(body.type),
  body: JSON.stringify(body),
})

const agentTextOf = (events: WireEvent[]): string[] =>
  transcriptViewOf({
    durable: durableTranscriptOf({ events: eventsFromWire(events) }),
    live: [],
  }).items.flatMap((item) => (item.kind === ETranscriptKind.Agent ? [item.text] : []))

describe('diagram repairs in the transcript', () => {
  const said = wire(1, { type: 'user-said', text: 'draw it' })
  const replied = wire(2, {
    type: 'assistant-said',
    parts: [{ type: 'text', text: answer(BROKEN) }],
  })

  it('renders the message as written until a repair lands', () => {
    expect(agentTextOf([said, replied])).toEqual([answer(BROKEN)])
  })

  it('renders the repaired diagram once the repair event arrives', () => {
    const repaired = wire(3, {
      type: 'diagram-repaired',
      messageId: 'evt_2',
      original: BROKEN,
      repaired: FIXED,
      modelId: 'claude-sonnet-4-5',
    })
    expect(agentTextOf([said, replied, repaired])).toEqual([answer(FIXED)])
  })

  it('leaves another message with the same diagram alone', () => {
    const other = wire(3, {
      type: 'diagram-repaired',
      messageId: 'evt_9',
      original: BROKEN,
      repaired: FIXED,
      modelId: 'claude-sonnet-4-5',
    })
    expect(agentTextOf([said, replied, other])).toEqual([answer(BROKEN)])
  })
})

describe('requestDiagramRepair', () => {
  it('sends the repair op and returns the repaired source', async () => {
    const calls: unknown[] = []
    const repaired = await requestDiagramRepair({
      request: async (call) => {
        calls.push(call)
        return { kind: 'repaired', repaired: FIXED }
      },
      threadId: 'thr_1',
      messageId: 'evt_2',
      source: BROKEN,
      error: 'Parse error on line 2',
    })
    expect(repaired).toBe(FIXED)
    expect(calls).toEqual([
      {
        op: EClientRequest.RepairDiagram,
        params: {
          threadId: 'thr_1',
          messageId: 'evt_2',
          source: BROKEN,
          error: 'Parse error on line 2',
        },
      },
    ])
  })

  it('throws the model failure so the error view can show it', async () => {
    const failing = requestDiagramRepair({
      request: async () => ({ kind: 'failed', reason: 'the model returned no diagram' }),
      threadId: 'thr_1',
      messageId: 'evt_2',
      source: BROKEN,
      error: 'x',
    })
    await expect(failing).rejects.toThrow('the model returned no diagram')
  })
})
