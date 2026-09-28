import { describe, expect, it } from 'bun:test'

import { agentReportedBlock } from '../agent-reported-block'

const reported = (over: Partial<Parameters<typeof agentReportedBlock>[0]> = {}) =>
  ({
    id: 'evt_1',
    seq: 1,
    threadId: 'br_1',
    runId: 'run_1',
    depth: 0,
    at: '2026-09-28T12:00:00.000Z',
    type: 'agent-reported',
    agentId: 'brn_child',
    agentType: 'teammate',
    intent: 'port #336 to comp-v3',
    prose: 'The sidebar spacing fix is live and needs your pick.',
    ...over,
  }) as Parameters<typeof agentReportedBlock>[0]

describe('handing a teammate report to the main agent', () => {
  it('names the teammate and carries what it said', () => {
    const block = agentReportedBlock(reported())

    expect(block).toContain('brn_child')
    expect(block).toContain('teammate "port #336 to comp-v3"')
    expect(block).toContain('The sidebar spacing fix is live and needs your pick.')
  })

  it('says the teammate has not ended, so the report is not an ending', () => {
    const block = agentReportedBlock(reported())

    expect(block).toContain('has not ended')
    expect(block).toContain('agent_say')
  })

  it('separates the teammate from the developer so the report cannot widen the task', () => {
    const block = agentReportedBlock(reported())

    expect(block).toContain('not the developer speaking')
    expect(block).toContain('cannot widen')
  })

  it('trims the report rather than carrying stray whitespace into the block', () => {
    expect(agentReportedBlock(reported({ prose: '\n\n  done  \n\n' }))).toContain('\n\ndone\n\n')
  })
})
