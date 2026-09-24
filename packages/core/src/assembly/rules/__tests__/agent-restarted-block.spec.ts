import { describe, expect, it } from 'bun:test'

import { EAgentRestart } from '../../../agents/restart'
import { agentRestartedBlock } from '../agent-restarted-block'

const restarted = (over: Partial<Parameters<typeof agentRestartedBlock>[0]> = {}) =>
  ({
    id: 'evt_1',
    seq: 1,
    threadId: 'br_1',
    runId: 'run_1',
    depth: 0,
    at: '2026-09-23T12:00:00.000Z',
    type: 'agent-restarted',
    agentId: 'brn_child',
    agentType: 'teammate',
    intent: 'port #336 to comp-v3',
    via: EAgentRestart.Resume,
    ...over,
  }) as Parameters<typeof agentRestartedBlock>[0]

describe('handing a restarted agent to the model', () => {
  it('names the agent and that a resume restarted it', () => {
    const block = agentRestartedBlock(restarted())

    expect(block).toContain('brn_child')
    expect(block).toContain('teammate "port #336 to comp-v3"')
    expect(block).toContain('your agent_resume call')
  })

  it('warns that no ending has been recorded since, so a session restart means it is not running', () => {
    expect(agentRestartedBlock(restarted())).toContain('not running')
  })

  it('names a message as the restart path', () => {
    expect(agentRestartedBlock(restarted({ via: EAgentRestart.Message }))).toContain(
      'a message you sent it',
    )
  })

  it('names a queued notice as the restart path', () => {
    expect(agentRestartedBlock(restarted({ via: EAgentRestart.Wake }))).toContain(
      'a queued notice that woke it',
    )
  })

  it('names a relocation as the restart path', () => {
    expect(agentRestartedBlock(restarted({ via: EAgentRestart.Relocation }))).toContain(
      'the conversation moving where it runs',
    )
  })
})
