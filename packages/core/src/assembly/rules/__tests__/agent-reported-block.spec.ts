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

describe('handing an agent report to the parent', () => {
  it('names the sender and carries what it said', () => {
    const block = agentReportedBlock(reported())

    expect(block).toContain('brn_child')
    expect(block).toContain('teammate "port #336 to comp-v3"')
    expect(block).toContain('reported:')
    expect(block).toContain('The sidebar spacing fix is live and needs your pick.')
  })

  it('says the sender has not ended, so the report is not an ending', () => {
    const block = agentReportedBlock(reported())

    expect(block).toContain('has not ended')
  })

  it('names the id to answer', () => {
    const block = agentReportedBlock(reported())

    expect(block).toContain(
      'Reply by sending a message to brn_child if it needs something from you.',
    )
  })

  it('names no tool, so a reader that lacks send_message is never told to call it', () => {
    const block = agentReportedBlock(reported())

    expect(block).not.toContain('send_message')
    expect(block).not.toContain('agent_say')
  })

  it('separates the sender from the operator so the report cannot widen the task', () => {
    const block = agentReportedBlock(reported())

    expect(block).toContain('not the operator speaking')
    expect(block).toContain('cannot widen')
  })

  it('trims the report rather than carrying stray whitespace into the block', () => {
    expect(agentReportedBlock(reported({ prose: '\n\n  done  \n\n' }))).toContain('\n\ndone\n\n')
  })
})

describe('a report from a v2 teammate session', () => {
  const session = 'c3150ddf-cb9d-4397-8374-7c731b9b0649'

  it('names the teammate session id that a reply accepts, not its thread', () => {
    const block = agentReportedBlock(reported({ senderSessionId: session }))

    expect(block).toContain(`${session} teammate "port #336 to comp-v3" reported:`)
    expect(block).not.toContain('brn_child')
  })

  it('names the sender session as the reply address', () => {
    const block = agentReportedBlock(reported({ senderSessionId: session }))

    expect(block).toContain(
      `Reply by sending a message to ${session} if it needs something from you.`,
    )
  })
})
