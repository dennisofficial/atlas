import type { Meta, StoryObj } from '@storybook/react'

import { AgentStatusIcon, EAgentDisplay, agentDisplayLabel, needsAttention } from './agent-status'

const DISPLAYS = Object.values(EAgentDisplay)

function Gallery() {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {DISPLAYS.map((display) => (
        <li key={display} className="flex items-center gap-2">
          <AgentStatusIcon display={display} />
          <span>{agentDisplayLabel(display)}</span>
          {needsAttention(display) ? (
            <span className="text-xs text-warning">needs attention</span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

const meta = {
  title: 'AI/Agent Status',
  component: AgentStatusIcon,
  args: { display: EAgentDisplay.Running },
} satisfies Meta<typeof AgentStatusIcon>

export default meta

type Story = StoryObj<typeof meta>

export const Running: Story = {}

export const StartingSandbox: Story = { args: { display: EAgentDisplay.StartingSandbox } }

export const NeedsApproval: Story = { args: { display: EAgentDisplay.NeedsApproval } }

export const Paused: Story = { args: { display: EAgentDisplay.Paused } }

export const Failed: Story = { args: { display: EAgentDisplay.Failed } }

export const Done: Story = { args: { display: EAgentDisplay.Done } }

export const All: Story = { render: () => <Gallery /> }
