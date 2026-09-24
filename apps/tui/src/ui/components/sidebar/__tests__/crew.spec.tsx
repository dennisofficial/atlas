import { EAgentStatus } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import type { SidebarSubagent } from '../../../../store/subagent-row'
import { teardown } from '../../../markdown/__tests__/harness'
import { SubagentsSection } from '../crew'

const WIDTH = 40

const HEIGHT = 20

const row = (over: Partial<SidebarSubagent> & { id: string }): SidebarSubagent => ({
  name: 'vault audit',
  status: EAgentStatus.Running,
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: null,
  state: '1m 4s',
  model: null,
  selected: false,
  ...over,
})

async function rowsOf(
  props: React.ComponentProps<typeof SubagentsSection>,
): Promise<readonly string[]> {
  const setup = await testRender(
    <box flexDirection="column" width={WIDTH} height={HEIGHT}>
      <SubagentsSection {...props} />
    </box>,
    { width: WIDTH, height: HEIGHT },
  )

  try {
    await setup.flush()
    return setup.captureCharFrame().split('\n')
  } finally {
    await teardown(setup)
  }
}

describe('the crew panel splits into a teammate tier and a sub-agent tier', () => {
  it('draws teammates first, then sub-agents, told apart by agentType', async () => {
    const frame = (
      await rowsOf({
        subagents: [
          row({ id: 't1', name: 'feature work', agentType: 'teammate' }),
          row({ id: 's1', name: 'vault audit', agentType: 'explore' }),
        ],
        cells: WIDTH,
      })
    ).join('\n')

    expect(frame).toContain('TEAMMATES')
    expect(frame).toContain('SUB-AGENTS')
    expect(frame.indexOf('TEAMMATES')).toBeLessThan(frame.indexOf('SUB-AGENTS'))
  })

  it('hides the teammate header when nothing in the roster is a teammate', async () => {
    const frame = (
      await rowsOf({ subagents: [row({ id: 's1', agentType: 'explore' })], cells: WIDTH })
    ).join('\n')

    expect(frame).not.toContain('TEAMMATES')
    expect(frame).toContain('SUB-AGENTS')
  })

  it('hides the sub-agent header when the whole roster is teammates', async () => {
    const frame = (
      await rowsOf({ subagents: [row({ id: 't1', agentType: 'teammate' })], cells: WIDTH })
    ).join('\n')

    expect(frame).toContain('TEAMMATES')
    expect(frame).not.toContain('SUB-AGENTS')
  })

  it('draws nothing for an empty roster', async () => {
    const frame = (await rowsOf({ subagents: [], cells: WIDTH })).join('\n')

    expect(frame.trim()).toBe('')
  })

  it('renders a teammate row with the same fields a sub-agent row carries', async () => {
    const frame = (
      await rowsOf({
        subagents: [
          row({
            id: 't1',
            name: 'feature work',
            agentType: 'teammate',
            model: 'Claude Haiku 4.5',
          }),
        ],
        cells: WIDTH,
      })
    ).join('\n')

    expect(frame).toContain('feature work')
    expect(frame).toContain('1m 4s')
    expect(frame).toContain('Claude Haiku 4.5')
  })

  it('keeps the retirement fold under the sub-agent tier, not the teammate tier', async () => {
    const frame = (
      await rowsOf({
        subagents: [
          row({ id: 't1', agentType: 'teammate' }),
          row({ id: 's1', agentType: 'explore' }),
        ],
        fold: { hidden: 2, hiddenFailed: false, hiddenTeammates: 0 },
        cells: WIDTH,
      })
    ).join('\n')

    expect(frame).toContain('in /agents')
  })

  it('counts retired rows against the tier they retired from', async () => {
    const frame = (
      await rowsOf({
        subagents: [
          row({ id: 't1', agentType: 'teammate' }),
          row({ id: 's1', agentType: 'explore' }),
        ],
        fold: { hidden: 3, hiddenFailed: false, hiddenTeammates: 2 },
        cells: WIDTH,
      })
    ).join('\n')

    expect(frame).toContain('TEAMMATES  1/3')
    expect(frame).toContain('SUB-AGENTS  1/2')
    expect(frame).toContain('3 mores in /agents')
  })

  it('lights a row that still runs something of its own, numbers only', async () => {
    const frame = (
      await rowsOf({
        subagents: [
          row({
            id: 't1',
            name: 'feature work',
            agentType: 'teammate',
            status: EAgentStatus.Finished,
            activity: { shells: 2, subagents: 1 },
          }),
        ],
        cells: WIDTH,
      })
    ).join('\n')

    expect(frame).toContain('⏺ feature work')
    expect(frame).toContain('2 shells')
    expect(frame).toContain('1 agent')
  })

  it('reads a finished row with nothing running as settled', async () => {
    const frame = (
      await rowsOf({
        subagents: [
          row({
            id: 't1',
            name: 'feature work',
            agentType: 'teammate',
            status: EAgentStatus.Finished,
          }),
        ],
        cells: WIDTH,
      })
    ).join('\n')

    expect(frame).toContain('⏺ feature work')
  })

  it('leaves a row with nothing running bare of chips', async () => {
    const frame = (
      await rowsOf({ subagents: [row({ id: 's1', agentType: 'explore' })], cells: WIDTH })
    ).join('\n')

    expect(frame).not.toContain('shell')
    expect(frame).not.toContain('agent')
  })

  it('treats a row with no agentType as a sub-agent rather than dropping it', async () => {
    const frame = (
      await rowsOf({ subagents: [row({ id: 's1', name: 'legacy child' })], cells: WIDTH })
    ).join('\n')

    expect(frame).toContain('legacy child')
    expect(frame).toContain('SUB-AGENTS')
    expect(frame).not.toContain('TEAMMATES')
  })
})
