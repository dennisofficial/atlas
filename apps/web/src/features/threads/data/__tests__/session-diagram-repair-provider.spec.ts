import { describe, expect, it, mock } from 'bun:test'

import { diagramContextOf } from '@dltech/atlas-core'

import { repairCallOf } from '../session-diagram-repair-provider'
import type { RepairDiagramAction } from '../diagram-repair'

const CHART = 'flowchart LR\n  A[Start --> B{Check'
const ERROR = 'Parse error on line 2'
const REPORT = `# Report\n\nThe chart is broken.\n\n\`\`\`mermaid\n${CHART}\n\`\`\`\n\nThat is all.`

describe('repairCallOf', () => {
  it('gives the action the chart, the error and the context around the fence', async () => {
    const repairDiagram = mock<RepairDiagramAction>(async () => {})
    await repairCallOf({
      repairDiagram,
      request: { chart: CHART, error: ERROR, messageText: REPORT },
    })

    expect(repairDiagram).toHaveBeenCalledTimes(1)
    expect(repairDiagram.mock.calls[0]?.[0]).toEqual({
      messageId: '',
      chart: CHART,
      error: ERROR,
      context: diagramContextOf({ text: REPORT, source: CHART }),
    })
  })

  it('keeps the message id a thread-scoped repair needs', async () => {
    const repairDiagram = mock<RepairDiagramAction>(async () => {})
    await repairCallOf({
      repairDiagram,
      request: { chart: CHART, error: ERROR, messageText: REPORT, messageId: 'evt-7' },
    })

    expect(repairDiagram.mock.calls[0]?.[0].messageId).toBe('evt-7')
  })

  it('sends no context when the fence is not in the message text', async () => {
    const repairDiagram = mock<RepairDiagramAction>(async () => {})
    await repairCallOf({
      repairDiagram,
      request: { chart: CHART, error: ERROR, messageText: 'nothing here' },
    })

    expect(repairDiagram.mock.calls[0]?.[0]).not.toHaveProperty('context')
  })
})
