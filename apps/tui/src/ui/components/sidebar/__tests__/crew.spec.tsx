import { EAgentStatus } from '@dltech/atlas-core'
import { EChecksState, EPullRequestState } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { ECrewStanding } from '../../../../store/crew-retirement'
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
  failureReason: null,
  ...over,
})

const settledRows = (args: {
  prefix: string
  count: number
  agentType: string
}): { rows: readonly SidebarSubagent[]; standings: ReadonlyMap<string, ECrewStanding> } => {
  const rows = Array.from({ length: args.count }, (_, at) =>
    row({
      id: `${args.prefix}-${at}`,
      name: `${args.prefix} ${at}`,
      agentType: args.agentType,
      status: EAgentStatus.Finished,
      endedAt: '2026-01-01T00:01:00.000Z',
      state: '',
    }),
  )

  return { rows, standings: new Map(rows.map((one) => [one.id, ECrewStanding.Settled])) }
}

const mountCrew = (props: React.ComponentProps<typeof SubagentsSection>) =>
  testRender(
    <box flexDirection="column" width={WIDTH} height={HEIGHT}>
      <SubagentsSection {...props} />
    </box>,
    { width: WIDTH, height: HEIGHT },
  )

async function rowsOf(
  props: React.ComponentProps<typeof SubagentsSection>,
): Promise<readonly string[]> {
  const setup = await mountCrew(props)

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

  it('folds each tier behind its own settled line, counting the full tier in its header', async () => {
    const teammates = settledRows({ prefix: 'mate', count: 4, agentType: 'teammate' })
    const subagents = settledRows({ prefix: 'sub', count: 5, agentType: 'explore' })
    const frame = (
      await rowsOf({
        subagents: [...teammates.rows, ...subagents.rows],
        standings: new Map([...teammates.standings, ...subagents.standings]),
        cells: WIDTH,
      })
    ).join('\n')

    expect(frame).toContain('TEAMMATES  0/4')
    expect(frame).toContain('SUB-AGENTS  0/5')
    expect(frame).toContain('2 settled ▸')
    expect(frame).toContain('3 settled ▸')
    expect(frame).not.toContain('mate 0')
    expect(frame).toContain('mate 3')
    expect(frame).not.toContain('sub 2')
    expect(frame).toContain('sub 4')
  })

  it('keeps a row that is live or held out of the fold however many rows settled around it', async () => {
    const settled = settledRows({ prefix: 'sub', count: 5, agentType: 'explore' })
    const live = row({ id: 'live', name: 'live audit', agentType: 'explore' })
    const held = row({ id: 'held', name: 'held audit', agentType: 'explore', status: EAgentStatus.Failed })
    const frame = (
      await rowsOf({
        subagents: [live, held, ...settled.rows],
        standings: new Map([
          ...settled.standings,
          ['live', ECrewStanding.Live],
          ['held', ECrewStanding.Held],
        ]),
        cells: WIDTH,
      })
    ).join('\n')

    expect(frame).toContain('live audit')
    expect(frame).toContain('held audit')
    expect(frame).toContain('3 settled ▸')
  })

  it('says one failed on the line when a collapsed row went wrong', async () => {
    const settled = settledRows({ prefix: 'sub', count: 5, agentType: 'explore' })
    const [first, ...rest] = settled.rows
    const failed = { ...(first as SidebarSubagent), status: EAgentStatus.Failed, name: 'sub failed' }
    const frame = (
      await rowsOf({ subagents: [failed, ...rest], standings: settled.standings, cells: WIDTH })
    ).join('\n')

    expect(frame).not.toContain('sub failed')
    expect(frame).toContain('3 settled ▸')
    expect(frame).toContain('one failed')
  })

  it('shows no settled line when the settled rows all fit in the tail', async () => {
    const settled = settledRows({ prefix: 'sub', count: 3, agentType: 'explore' })
    const frame = (
      await rowsOf({ subagents: settled.rows, standings: settled.standings, cells: WIDTH })
    ).join('\n')

    expect(frame).not.toContain('settled ▸')
    expect(frame).toContain('sub 0')
  })

  it('brings the collapsed rows back when the settled line is clicked, and folds them again on a second click', async () => {
    const settled = settledRows({ prefix: 'sub', count: 5, agentType: 'explore' })
    const setup = await mountCrew({ subagents: settled.rows, standings: settled.standings, cells: WIDTH })

    try {
      await setup.flush()
      const lineAt = (): number =>
        setup.captureCharFrame().split('\n').findIndex((line) => line.includes('settled'))
      const columnAt = (): number =>
        setup.captureCharFrame().split('\n')[lineAt()]?.indexOf('settled') ?? -1

      expect(setup.captureCharFrame()).not.toContain('sub 0')

      await setup.mockMouse.click(columnAt(), lineAt())
      await setup.flush()
      const open = setup.captureCharFrame()
      expect(open).toContain('sub 0')
      expect(open).toContain('3 settled ▾')

      await setup.mockMouse.click(columnAt(), lineAt())
      await setup.flush()
      expect(setup.captureCharFrame()).not.toContain('sub 0')
    } finally {
      await teardown(setup)
    }
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

  it('names why a failed child failed on the figures line', async () => {
    const frame = (
      await rowsOf({
        subagents: [
          row({
            id: 's1',
            status: EAgentStatus.Failed,
            endedAt: '2026-01-01T00:01:00.000Z',
            state: 'failed',
            failureReason: 'provider inference.net returned 402',
          }),
        ],
        cells: WIDTH,
      })
    ).join('\n')

    expect(frame).toContain('provider inference.net returned 402')
  })

  it('clips a long cause to the row rather than letting it wrap the panel', async () => {
    const lines = await rowsOf({
      subagents: [
        row({
          id: 's1',
          status: EAgentStatus.Failed,
          endedAt: '2026-01-01T00:01:00.000Z',
          state: 'failed',
          failureReason:
            'provider inference.net returned 402: credit exhausted after a very long and detailed explanation that will not fit',
        }),
      ],
      cells: WIDTH,
    })

    const reasonLines = lines.filter((line) => line.includes('402'))
    expect(reasonLines).toHaveLength(1)
    expect(reasonLines[0]).toContain('…')
  })

  it('spends no line on a cause a failed child never recorded', async () => {
    const lines = await rowsOf({
      subagents: [
        row({
          id: 's1',
          status: EAgentStatus.Failed,
          endedAt: '2026-01-01T00:01:00.000Z',
          state: 'failed',
        }),
      ],
      cells: WIDTH,
    })

    expect(lines.join('\n')).toContain('failed')
    expect(lines.filter((line) => line.trim() !== '')).toHaveLength(2)
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

describe('a teammate row carries its pull request pill', () => {
  it('puts the pill on the row beside the model, and leaves a row without one bare', async () => {
    const frame = (
      await rowsOf({
        subagents: [
          row({
            id: 't1',
            name: 'feature work',
            agentType: 'teammate',
            model: 'sonnet',
            pullRequest: {
              label: '#88',
              url: 'https://github.com/dennisofficial/atlas/pull/88',
              state: EPullRequestState.Open,
              checks: EChecksState.Passing,
              pollBacked: false,
            },
          }),
          row({ id: 't2', name: 'other work', agentType: 'teammate', model: 'haiku' }),
        ],
        cells: WIDTH,
      })
    ).join('\n')

    const lines = frame.split('\n')
    expect(lines.find((line) => line.includes('sonnet'))).toContain('#88')
    expect(lines.find((line) => line.includes('haiku'))).not.toContain('#')
  })
})
