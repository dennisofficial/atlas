import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'

import { AgentsPanel, type AgentsPanelProps } from './agents-panel'
import { DONE_AGENTS, MANY_CALLS_AGENTS, RUNNING_AGENTS, TEAMMATES } from './agents-panel.fixtures'

const noop = () => undefined

const meta = {
  title: 'AI/Agents Panel',
  component: AgentsPanel,
  args: {
    agents: [...RUNNING_AGENTS, ...DONE_AGENTS],
    teammates: TEAMMATES,
    onDetailChange: noop,
    onOpenTeammate: noop,
    onJumpToSpawn: noop,
  },
  decorators: [
    (Story) => (
      <div className="flex h-[36rem] w-[26rem] max-w-full flex-col rounded-lg border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AgentsPanel>

export default meta

type Story = StoryObj<typeof meta>

export const Mixed: Story = {}

export const RunningOnly: Story = { args: { agents: RUNNING_AGENTS, teammates: [] } }

export const TeammatesOnly: Story = { args: { agents: [], teammates: TEAMMATES } }

export const Empty: Story = { args: { agents: [], teammates: [] } }

export const RunningDetail: Story = { args: { detailId: 'a1' } }

export const FailedDetail: Story = { args: { detailId: 'd1' } }

export const DoneDetail: Story = { args: { detailId: 'd0' } }

export const ManyToolCalls: Story = {
  args: { agents: MANY_CALLS_AGENTS, teammates: [], detailId: 'many-running' },
}

export const ManyToolCallsDone: Story = {
  args: { agents: MANY_CALLS_AGENTS, teammates: [], detailId: 'many-done' },
}

function InteractivePanel(args: AgentsPanelProps) {
  const [detailId, setDetailId] = useState(args.detailId)
  return <AgentsPanel {...args} detailId={detailId} onDetailChange={setDetailId} />
}

export const Interactive: Story = { render: (args) => <InteractivePanel {...args} /> }

export const WithTranscript: Story = {
  args: {
    detailId: 'a1',
    renderTranscript: (agent) => (
      <div className="flex flex-1 flex-col gap-3 px-4 text-sm">
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-muted-foreground">
          {agent.brief}
        </p>
        <p>Full transcript renders here</p>
      </div>
    ),
  },
}
