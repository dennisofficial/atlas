import { describe, expect, it } from 'bun:test'

import type { EventDraft } from '../../events/body'
import { eventBodySchema } from '../../events/schema'
import { toEventId, toRunId, toThreadId } from '../../events/ids'
import { stampDrafts } from '../../events/stamp'
import { messagesFromEvents } from '../../assembly/rules/messages-from-events'
import { diagramRepairsByMessage, repairsForMessage } from '../diagram-repairs'
import { applyDiagramRepairs } from '../mermaid-fences'
import { diagramRepairPrompt, repairedSourceOf } from '../repair-prompt'

const BROKEN = 'sequenceDiagram\n  A->>M: types; M-->>A: ends -'
const FIXED = 'sequenceDiagram\n  A->>M: types\n  M-->>A: ends'

const message = (source: string): string =>
  ['Here is the flow:', '', '```mermaid', source, '```', '', 'Done.'].join('\n')

const repaired = (args: { messageId: string; original: string; repaired: string }) => ({
  type: 'diagram-repaired' as const,
  messageId: toEventId(args.messageId),
  original: args.original,
  repaired: args.repaired,
  modelId: 'claude-sonnet-4-5',
})

describe('applyDiagramRepairs', () => {
  it('swaps a repaired fence body and leaves the prose alone', () => {
    const repairs = new Map([[BROKEN, FIXED]])
    expect(applyDiagramRepairs({ text: message(BROKEN), repairs })).toBe(message(FIXED))
  })

  it('leaves a fence without a repair untouched', () => {
    const text = message('flowchart TD\n  A --> B')
    expect(applyDiagramRepairs({ text, repairs: new Map([[BROKEN, FIXED]]) })).toBe(text)
  })

  it('follows a repair of a repair to the latest source', () => {
    const repairs = new Map([
      [BROKEN, 'still broken'],
      ['still broken', FIXED],
    ])
    expect(applyDiagramRepairs({ text: message(BROKEN), repairs })).toBe(message(FIXED))
  })

  it('stops on a repair cycle instead of looping', () => {
    const repairs = new Map([
      ['a', 'b'],
      ['b', 'a'],
    ])
    expect(applyDiagramRepairs({ text: message('a'), repairs })).toContain('```mermaid\n')
  })

  it('ignores mermaid inside a non-mermaid fence', () => {
    const text = ['```md', '```mermaid', BROKEN, '```', '```'].join('\n')
    expect(applyDiagramRepairs({ text, repairs: new Map([[BROKEN, FIXED]]) })).not.toContain(FIXED)
  })
})

describe('diagramRepairsByMessage', () => {
  it('keys repairs by message and lets the latest repair of a source win', () => {
    const byMessage = diagramRepairsByMessage([
      repaired({ messageId: 'm1', original: BROKEN, repaired: 'first' }),
      repaired({ messageId: 'm1', original: `${BROKEN}\n`, repaired: FIXED }),
      repaired({ messageId: 'm2', original: 'x', repaired: 'y' }),
      { type: 'user-said' },
    ])
    expect(repairsForMessage({ byMessage, messageId: 'm1' }).get(BROKEN)).toBe(FIXED)
    expect(repairsForMessage({ byMessage, messageId: 'm3' }).size).toBe(0)
  })
})

describe('the diagram-repaired event', () => {
  it('parses through the event body schema', () => {
    const body = repaired({ messageId: 'm1', original: BROKEN, repaired: FIXED })
    expect(eventBodySchema.parse(body)).toEqual(body)
  })

  it('never reaches the model', () => {
    const drafts: EventDraft[] = [
      { type: 'user-said', text: 'draw it' },
      { type: 'assistant-said', parts: [{ type: 'text', text: message(BROKEN) }] },
      repaired({ messageId: 'evt-2', original: BROKEN, repaired: FIXED }),
    ]
    const events = stampDrafts({
      drafts,
      envelopes: drafts.map((_, index) => ({
        id: toEventId(`evt-${index + 1}`),
        seq: index + 1,
        threadId: toThreadId('thread-1'),
        runId: toRunId('run-1'),
        depth: 0,
        at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      })),
    })
    const assembled = messagesFromEvents()(
      { system: [], messages: [] },
      {
        events,
        threadId: toThreadId('thread-1'),
        step: 0,
        provider: { id: 'anthropic', modelId: 'test' },
      },
    )
    const rendered = JSON.stringify(assembled.messages)
    expect(rendered).toContain('A->>M: types;')
    expect(rendered).not.toContain(FIXED)
  })
})

describe('the repair prompt', () => {
  it('carries the error and the source', () => {
    const prompt = diagramRepairPrompt({ source: BROKEN, error: 'Parse error on line 2' })
    expect(prompt).toContain('Parse error on line 2')
    expect(prompt).toContain(BROKEN)
  })

  it('reads the source out of a reply with or without a fence', () => {
    expect(repairedSourceOf(FIXED)).toBe(FIXED)
    expect(repairedSourceOf(`\`\`\`mermaid\n${FIXED}\n\`\`\``)).toBe(FIXED)
    expect(repairedSourceOf('   ')).toBeUndefined()
  })
})
