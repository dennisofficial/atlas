import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AgentsPanel, type AgentsPanelProps } from '../agents-panel'
import { DONE_AGENTS, MANY_CALLS_AGENTS, RUNNING_AGENTS, TEAMMATES } from '../agents-panel.fixtures'
import { QueuedMessages } from '../queued-messages'
import { FILE_ONLY, TWO_QUEUED, WITH_IMAGES } from '../queued-messages.fixtures'
import { SubagentReports, reportTitle } from '../subagent-report'
import { EAgentDisplay } from '../agent-status'

const noop = () => undefined

const panel = (props: Partial<AgentsPanelProps> = {}) =>
  renderToStaticMarkup(
    <AgentsPanel
      agents={[...RUNNING_AGENTS, ...DONE_AGENTS]}
      teammates={TEAMMATES}
      onDetailChange={noop}
      onOpenTeammate={noop}
      onJumpToSpawn={noop}
      {...props}
    />,
  )

describe('AgentsPanel', () => {
  it('renders group headings with counts and the latest call line', () => {
    const html = panel()

    expect(html).toContain('Running')
    expect(html).toContain('Teammates')
    expect(html).toContain('Done')
    expect(html).toContain('Reading scripts/optimize-images.ts')
    expect(html).toContain('Show 2 more')
  })

  it('renders the empty state', () => {
    const html = panel({ agents: [], teammates: [] })

    expect(html).toContain('No agents yet')
    expect(html).toContain('Sub-agents and teammates started in this thread show up here')
  })

  it('renders the detail header, brief and tool calls', () => {
    const html = panel({ detailId: 'a1' })

    expect(html).toContain('All agents')
    expect(html).toContain('Jump to spawn')
    expect(html).toContain('87k / 200k tokens')
    expect(html).toContain('Brief from Atlas')
  })

  it('shows the total in the section label and mounts only a window of rows', () => {
    const html = panel({ agents: MANY_CALLS_AGENTS, teammates: [], detailId: 'many-running' })

    expect(html).toContain('Tool calls · 400')
    expect((html.match(/data-index="/g) ?? []).length).toBeLessThan(40)
  })

  it('renders the error text for a failed agent', () => {
    expect(panel({ detailId: 'd1' })).toContain('Sandbox lost connection after 9m')
  })
})

describe('SubagentReports', () => {
  it('titles reported and failed lines', () => {
    expect(reportTitle({ agentType: 'explore', intent: 'map', failed: false })).toBe(
      'explore · map reported',
    )
    expect(reportTitle({ agentType: 'explore', intent: 'map', failed: true })).toBe(
      'explore · map failed',
    )
  })

  it('renders one line per report', () => {
    const html = renderToStaticMarkup(
      <SubagentReports
        onOpen={noop}
        reports={[
          {
            id: 'a',
            agentType: 'explore',
            intent: 'map',
            display: EAgentDisplay.Done,
            elapsed: '4m',
          },
          {
            id: 'b',
            agentType: 'builder',
            intent: 'fix',
            display: EAgentDisplay.Failed,
            elapsed: '1m',
          },
        ]}
      />,
    )

    expect(html).toContain('explore · map reported')
    expect(html).toContain('builder · fix failed')
  })
})

describe('QueuedMessages', () => {
  const render = (messages = TWO_QUEUED, editingId?: string) =>
    renderToStaticMarkup(
      <QueuedMessages messages={messages} onSave={noop} onRemove={noop} editingId={editingId} />,
    )

  it('renders nothing for an empty queue', () => {
    expect(render([])).toBe('')
  })

  it('renders edit and remove buttons without labels', () => {
    const html = render()

    expect(html).toContain('aria-label="Edit queued message"')
    expect(html).toContain('aria-label="Remove queued message"')
    expect(html).not.toContain('Queued</')
  })

  it('renders attachments in the bubble', () => {
    const html = render([...WITH_IMAGES, ...FILE_ONLY])

    expect(html).toContain('before.png')
    expect(html).toContain('queue-design-spec.pdf')
  })

  it('swaps the bubble for an editor with attachment removal', () => {
    const html = render(WITH_IMAGES, 'w1')

    expect(html).toContain('<textarea')
    expect(html).toContain('aria-label="Add files"')
    expect(html).toContain('aria-label="Remove before.png"')
    expect(html).not.toMatch(/<button[^>]*aria-label="Edit queued message"/)
  })
})
