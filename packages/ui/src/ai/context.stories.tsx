import type { Meta, StoryObj } from '@storybook/react'

import { Context } from './context'

const meta = {
  title: 'AI/Context',
  component: Context,
  args: { used: 52_400, limit: 200_000 },
  argTypes: { used: { control: { type: 'range', min: 0, max: 200_000, step: 1000 } } },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Context>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithBreakdown: Story = {
  args: {
    used: 148_000,
    breakdown: [
      { label: 'System prompt', tokens: 6_200 },
      { label: 'Skills', tokens: 3_100 },
      { label: 'Memory', tokens: 900 },
      { label: 'Instructions', tokens: 4_200 },
      { label: 'Tools', tokens: 14_800 },
      { label: 'MCP: posthog', tokens: 5_600 },
      { label: 'Tool results', tokens: 21_800 },
      { label: 'Conversation', tokens: 91_400 },
    ],
  },
}

export const NearlyFull: Story = { args: { used: 189_000 } }
