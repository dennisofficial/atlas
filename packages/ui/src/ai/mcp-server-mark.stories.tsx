import type { Meta, StoryObj } from '@storybook/react'

import { McpServerMark } from './mcp-server-mark'

const meta = {
  title: 'AI/McpServerMark',
  component: McpServerMark,
  args: { server: 'paper' },
  decorators: [
    (Story) => (
      <div className="flex items-center gap-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof McpServerMark>

export default meta

type Story = StoryObj<typeof meta>

export const Paper: Story = {}

export const Servers: Story = {
  render: () => (
    <div className="flex items-center gap-4 text-sm text-muted-foreground">
      {['paper', 'wispr-flow', 'posthog', 'linear', 'github', 'datadog'].map((server) => (
        <span key={server} className="flex items-center gap-1.5">
          <McpServerMark server={server} />
          {server}
        </span>
      ))}
    </div>
  ),
}
