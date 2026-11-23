import { describe, expect, it } from 'bun:test'

import { diagramContextOf } from '../repair-context'
import {
  DIAGRAM_REPAIR_EMPTY,
  DIAGRAM_REPAIR_UNCHANGED,
  diagramRepairOutcomeOf,
  diagramRepairOutcomeSchema,
  diagramRepairPrompt,
  EDiagramRepair,
  type DiagramRepairOutcome,
} from '../repair-prompt'

const BROKEN = 'sequenceDiagram\n  A->>M: types; M-->>A: ends -'
const FIXED = 'sequenceDiagram\n  A->>M: types\n  M-->>A: ends'

describe('diagramRepairOutcomeOf', () => {
  it('accepts a changed diagram, fenced or bare', () => {
    expect(
      diagramRepairOutcomeOf({ source: BROKEN, reply: `\`\`\`mermaid\n${FIXED}\n\`\`\`` }),
    ).toEqual({ kind: EDiagramRepair.Repaired, repaired: FIXED })
  })

  it('fails an empty reply', () => {
    expect(diagramRepairOutcomeOf({ source: BROKEN, reply: '  ' })).toEqual({
      kind: EDiagramRepair.Failed,
      reason: DIAGRAM_REPAIR_EMPTY,
    })
  })

  it('fails a reply that returns the diagram unchanged', () => {
    expect(diagramRepairOutcomeOf({ source: `${BROKEN}\n`, reply: BROKEN })).toEqual({
      kind: EDiagramRepair.Failed,
      reason: DIAGRAM_REPAIR_UNCHANGED,
    })
  })

  it('round-trips through its schema', () => {
    const outcome: DiagramRepairOutcome = { kind: EDiagramRepair.Repaired, repaired: FIXED }
    expect(diagramRepairOutcomeSchema.parse(outcome)).toEqual(outcome)
  })
})

describe('diagramRepairPrompt with context', () => {
  it('carries the surrounding text when given', () => {
    const prompt = diagramRepairPrompt({ source: BROKEN, error: 'bad', context: 'The login flow' })
    expect(prompt).toContain('Text around the diagram:\nThe login flow')
    expect(prompt.indexOf('The login flow')).toBeLessThan(prompt.indexOf(BROKEN))
  })

  it('leaves the context section out when empty', () => {
    expect(diagramRepairPrompt({ source: BROKEN, error: 'bad', context: ' ' })).not.toContain(
      'Text around',
    )
  })
})

describe('diagramContextOf', () => {
  const text = [
    'Here is the login flow:',
    '',
    '```mermaid',
    BROKEN,
    '```',
    '',
    'Then it ends.',
  ].join('\n')

  it('gives the prose before and after the fence, without the fence', () => {
    expect(diagramContextOf({ text, source: BROKEN })).toBe(
      'Here is the login flow:\n…\nThen it ends.',
    )
  })

  it('answers empty when the diagram is not in the text', () => {
    expect(diagramContextOf({ text, source: 'graph TD\n  X --> Y' })).toBe('')
  })

  it('keeps only the nearest text on each side', () => {
    const long = `${'a'.repeat(5000)}\n\n\`\`\`mermaid\n${BROKEN}\n\`\`\`\n${'b'.repeat(5000)}`
    const context = diagramContextOf({ text: long, source: BROKEN })
    expect(context.length).toBeLessThanOrEqual(1203)
    expect(context.startsWith('a')).toBe(true)
    expect(context.endsWith('b')).toBe(true)
  })
})
