import type { Meta, StoryObj } from '@storybook/react'

import {
  ConnectingNotice,
  ConnectionHeader,
  DisconnectedBar,
  ETerminalConnection,
  PausedNotice,
} from './terminal-states'

const meta = {
  title: 'AI/Terminal States',
  component: ConnectionHeader,
  args: { connection: ETerminalConnection.Connected, detail: '4 vCPU · 8 GB' },
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="flex h-72 w-96 flex-col rounded-lg border border-border bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConnectionHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Connected: Story = {}

export const Connecting: Story = {
  args: { connection: ETerminalConnection.Connecting },
  render: (args) => (
    <>
      <ConnectionHeader {...args} />
      <ConnectingNotice />
    </>
  ),
}

export const Paused: Story = {
  args: { connection: ETerminalConnection.Paused },
  render: (args) => (
    <>
      <ConnectionHeader {...args} />
      <PausedNotice onResume={() => undefined} />
    </>
  ),
}

export const Disconnected: Story = {
  args: { connection: ETerminalConnection.Disconnected },
  render: (args) => (
    <>
      <ConnectionHeader {...args} />
      <div className="flex-1" />
      <DisconnectedBar onReconnect={() => undefined} />
    </>
  ),
}

export const CustomNoun: Story = {
  args: { connection: ETerminalConnection.Connecting, noun: 'sandbox' },
}
