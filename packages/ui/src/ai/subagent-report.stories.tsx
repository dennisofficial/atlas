import type { Meta, StoryObj } from '@storybook/react'

import { EAgentDisplay } from './agent-status'
import { SubagentReports, type SubagentReportEntry } from './subagent-report'

const REPORTS: SubagentReportEntry[] = [
  {
    id: 'a1',
    agentType: 'explore',
    intent: 'Map the image optimization pipeline',
    display: EAgentDisplay.Done,
    elapsed: '4m 12s',
    report:
      'The cache is keyed on the commit SHA in `scripts/optimize-images.ts:14`, so every deploy misses.',
  },
  {
    id: 'a2',
    agentType: 'builder',
    intent: 'Add the cache key to the build script',
    display: EAgentDisplay.Failed,
    elapsed: '1m 03s',
    errorText: 'Sandbox lost connection after 9m',
  },
]

const meta = {
  title: 'AI/Subagent Reports',
  component: SubagentReports,
  args: {
    onOpen: () => undefined,
    reports: REPORTS,
  },
  decorators: [
    (Story) => (
      <div className="w-[34rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SubagentReports>

export default meta

type Story = StoryObj<typeof meta>

export const Mixed: Story = {}

export const Done: Story = { args: { reports: REPORTS.slice(0, 1) } }

export const Failed: Story = { args: { reports: REPORTS.slice(1) } }
