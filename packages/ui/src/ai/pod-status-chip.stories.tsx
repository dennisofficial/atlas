import type { Meta, StoryObj } from '@storybook/react'

import { PodStatusChip } from './pod-status-chip'
import { EPodState, type PodStatus } from './pod-status'

const RUNNING: PodStatus = {
  state: EPodState.Running,
  vcpus: 4,
  podId: 'pod_8f3k2a91',
  region: 'iad1',
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 700))

const fail = (): Promise<void> =>
  new Promise((_, reject) => setTimeout(() => reject(new Error('quota')), 700))

const meta = {
  title: 'AI/Pod Status Chip',
  component: PodStatusChip,
  args: { status: RUNNING, defaultOpen: true, onResize: settle, settingsHref: '#' },
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="flex h-80 w-96 justify-end">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PodStatusChip>

export default meta
type Story = StoryObj<typeof meta>

export const Running: Story = {}

export const Starting: Story = { args: { status: { ...RUNNING, state: EPodState.Starting } } }

export const Resuming: Story = { args: { status: { ...RUNNING, state: EPodState.Resuming } } }

export const Parked: Story = { args: { status: { ...RUNNING, state: EPodState.Parked } } }

export const Stopped: Story = { args: { status: { ...RUNNING, state: EPodState.Stopped } } }

export const ResizePending: Story = { args: { status: { ...RUNNING, pendingVcpus: 8 } } }

export const ResizeFails: Story = { args: { onResize: fail } }

export const ReadOnly: Story = { args: { onResize: undefined, settingsHref: undefined } }

export const Closed: Story = { args: { defaultOpen: false } }
