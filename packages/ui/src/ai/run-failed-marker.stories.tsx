import type { Meta, StoryObj } from '@storybook/react'

import { RunFailedMarker } from './run-failed-marker'

const meta = {
  title: 'AI/RunFailedMarker',
  component: RunFailedMarker,
  args: { label: 'run failed after 1.2s' },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof RunFailedMarker>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
