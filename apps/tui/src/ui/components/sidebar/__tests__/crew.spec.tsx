import { EAgentStatus } from '@dltech/atlas-core'
import { EChecksState, EPullRequestState } from '@dltech/atlas-harness'
import { parseColor } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React, { act } from 'react'

import type { SidebarSubagent } from '../../../../store/subagent-row'
import { teardown } from '../../../markdown/__tests__/harness'
import { theme } from '../../../theme'
import { AgentsSection } from '../crew'

const WIDTH = 40

const HEIGHT = 20

const row = (over: Partial<SidebarSubagent> & { id: string }): SidebarSubagent => ({
  name: 'vault audit',
  agentType: 'explore',
  status: EAgentStatus.Running,
  value: '1m 4s',
  selected: false,
  ...over,
})

const settled = (id: string, status = EAgentStatus.Finished): SidebarSubagent =>
  row({ id, name: `settled ${id}`, status, value: 'done' })

type Props = Partial<React.ComponentProps<typeof AgentsSection>>

const mountCrew = (props: Props) =>
  testRender(
    <box flexDirection="column" width={WIDTH} height={HEIGHT}>
      <AgentsSection subagents={[]} expanded={false} cells={WIDTH} {...props} />
    </box>,
    { width: WIDTH, height: HEIGHT },
  )

async function linesOf(props: Props): Promise<string[]> {
  const setup = await mountCrew(props)
  try {
    await setup.flush()
    return setup
      .captureCharFrame()
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line !== '')
  } finally {
    await teardown(setup)
  }
}

describe('the agents panel', () => {
  it('draws nothing for an empty roster', async () => {
    expect(await linesOf({})).toEqual([])
  })

  it('titles one section AGENTS with the running count on the right edge', async () => {
    const lines = await linesOf({
      subagents: [
        row({ id: 'a' }),
        row({ id: 'b', status: EAgentStatus.Blocked, value: 'approve?' }),
      ],
    })

    expect(lines[0]).toBe(
      `AGENTS${' '.repeat(WIDTH - 'AGENTS'.length - '2 running'.length)}2 running`,
    )
  })

  it('omits the count when nothing runs', async () => {
    const lines = await linesOf({ subagents: [row({ id: 'a', status: EAgentStatus.Paused })] })

    expect(lines[0]).toBe('AGENTS')
  })

  it('splits no teammate tier from the sub-agents', async () => {
    const frame = (
      await linesOf({
        subagents: [row({ id: 't', agentType: 'teammate' }), row({ id: 's' })],
      })
    ).join('\n')

    expect(frame).not.toContain('TEAMMATES')
    expect(frame).not.toContain('SUB-AGENTS')
  })

  it('draws one line per row with a shape-coded glyph and the right value', async () => {
    const lines = await linesOf({
      subagents: [
        row({ id: 'run', name: 'Composer queue fix', value: '3m 12s' }),
        row({
          id: 'held',
          name: 'Visual review',
          waitingOn: 'bash "bun test"',
          value: 'bash "bun test"',
        }),
        row({ id: 'blk', name: 'Fix serve wake', status: EAgentStatus.Blocked, value: 'approve?' }),
        row({ id: 'pau', name: 'Paused one', status: EAgentStatus.Paused, value: 'paused' }),
      ],
    })

    expect(lines).toHaveLength(5)
    expect(lines[1]).toMatch(/^● Composer queue fix\s+3m 12s$/)
    expect(lines[2]).toMatch(/^◷ Visual review\s+bash "bun test"$/)
    expect(lines[3]).toMatch(/^! Fix serve wake\s+approve\?$/)
    expect(lines[4]).toMatch(/^! Paused one\s+paused$/)
  })

  it('truncates a long title once, keeping the value whole', async () => {
    const lines = await linesOf({
      subagents: [row({ id: 'a', name: 'Rotate every refresh token and reject the reused ones' })],
    })

    expect(lines[1]?.length).toBeLessThanOrEqual(WIDTH)
    expect(lines[1]).toContain('…')
    expect(lines[1]?.endsWith('1m 4s')).toBe(true)
  })

  it('puts the pull request inline before a teammate title', async () => {
    const lines = await linesOf({
      subagents: [
        row({
          id: 't',
          name: 'Teammate: web settings',
          agentType: 'teammate',
          value: '4m',
          pullRequest: {
            label: '#1421',
            url: 'https://example.test/1421',
            state: EPullRequestState.Open,
            checks: EChecksState.None,
            pollBacked: false,
          },
        }),
      ],
    })

    expect(lines[1]).toMatch(/^#1421 ● Teammate: web settings\s+4m$/)
  })

  it('lists teammates before sub-agents whatever the roster order', async () => {
    const lines = await linesOf({
      subagents: [
        row({ id: 's', name: 'sub one' }),
        row({ id: 't', name: 'mate one', agentType: 'teammate' }),
      ],
    })

    expect(lines[1]).toContain('mate one')
    expect(lines[2]).toContain('sub one')
  })
})

describe('the fold line', () => {
  it('folds every settled sub-agent into one summary line', async () => {
    const lines = await linesOf({
      subagents: [
        row({ id: 'run' }),
        settled('d1'),
        settled('d2'),
        settled('f1', EAgentStatus.Failed),
      ],
    })

    expect(lines).toHaveLength(3)
    expect(lines[2]).toBe('✓ 2 done · ✗ 1 failed  ▸')
  })

  it('omits a zero part', async () => {
    const onlyDone = await linesOf({ subagents: [settled('d1'), settled('d2')] })
    const onlyFailed = await linesOf({ subagents: [settled('f1', EAgentStatus.Failed)] })
    const stopped = await linesOf({ subagents: [settled('s1', EAgentStatus.Stopped)] })

    expect(onlyDone[1]).toBe('✓ 2 done  ▸')
    expect(onlyFailed[1]).toBe('✗ 1 failed  ▸')
    expect(stopped[1]).toBe('✗ 1 stopped  ▸')
  })

  it('shows the folded rows with a down chevron when expanded', async () => {
    const lines = await linesOf({ subagents: [settled('d1')], expanded: true })

    expect(lines[1]).toBe('✓ 1 done  ▾')
    expect(lines[2]).toMatch(/^✓ settled d1\s+done$/)
  })

  it('keeps the row being viewed out of the fold', async () => {
    const lines = await linesOf({
      subagents: [{ ...settled('d1'), selected: true }, settled('d2')],
    })

    expect(lines.join('\n')).toContain('settled d1')
    expect(lines.join('\n')).not.toContain('settled d2')
    expect(lines.at(-1)).toBe('✓ 1 done  ▸')
  })

  it('never folds a teammate', async () => {
    const lines = await linesOf({
      subagents: [{ ...settled('t1'), agentType: 'teammate' }],
    })

    expect(lines.join('\n')).toContain('settled t1')
    expect(lines.join('\n')).not.toContain('▸')
  })

  it('toggles from a click on the fold line', async () => {
    const toggled: string[] = []
    const setup = await mountCrew({
      subagents: [settled('d1')],
      onToggle: () => toggled.push('toggle'),
    })

    try {
      await setup.flush()
      const y = setup
        .captureCharFrame()
        .split('\n')
        .findIndex((line) => line.includes('1 done'))
      await act(async () => {
        await setup.mockMouse.click(3, y)
      })
      await setup.flush()

      expect(toggled).toEqual(['toggle'])
    } finally {
      await teardown(setup)
    }
  }, 30_000)
})

type Colour = { equals: (other: unknown) => boolean }

type Painted = { text: string; bg: Colour }

type Spans = { lines: ({ spans: Painted[] } | undefined)[] }

const paintedAt = (spans: Spans, y: number, x: number): Painted | undefined => {
  let column = 0
  for (const span of spans.lines[y]?.spans ?? []) {
    const width = [...span.text].length
    if (x < column + width) return span
    column += width
  }
  return undefined
}

describe('hover and click', () => {
  it('opens the row on click and washes it while the pointer is over it', async () => {
    const opened: string[] = []
    const setup = await mountCrew({
      subagents: [row({ id: 'a', name: 'hoverable' })],
      onOpen: (id) => opened.push(id),
    })

    try {
      await setup.flush()
      const y = setup
        .captureCharFrame()
        .split('\n')
        .findIndex((line) => line.includes('hoverable'))
      expect(
        paintedAt(setup.captureSpans() as unknown as Spans, y, 4)?.bg.equals(
          parseColor(theme.hoverBg),
        ),
      ).toBe(false)

      await act(async () => {
        await setup.mockMouse.moveTo(4, y)
      })
      await setup.flush()
      expect(
        paintedAt(setup.captureSpans() as unknown as Spans, y, 4)?.bg.equals(
          parseColor(theme.hoverBg),
        ),
      ).toBe(true)

      await act(async () => {
        await setup.mockMouse.click(4, y)
      })
      await setup.flush()
      expect(opened).toEqual(['a'])
    } finally {
      await teardown(setup)
    }
  }, 30_000)

  it('washes the fold line too', async () => {
    const setup = await mountCrew({ subagents: [settled('d1')], onToggle: () => undefined })

    try {
      await setup.flush()
      const y = setup
        .captureCharFrame()
        .split('\n')
        .findIndex((line) => line.includes('1 done'))
      await act(async () => {
        await setup.mockMouse.moveTo(4, y)
      })
      await setup.flush()

      expect(
        paintedAt(setup.captureSpans() as unknown as Spans, y, 4)?.bg.equals(
          parseColor(theme.hoverBg),
        ),
      ).toBe(true)
    } finally {
      await teardown(setup)
    }
  }, 30_000)
})
