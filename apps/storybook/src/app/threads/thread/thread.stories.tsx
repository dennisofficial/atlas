import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { SessionView } from './session-view'
import { ETerminalConnection } from './sandbox-terminal'
import { EPodState, RUNNING_POD } from './pod-status'
import { ERightTab, ESessionState } from './session-types'

const meta = {
  title: 'App/Threads/Thread',
  component: SessionView,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SessionView>

export default meta
type Story = StoryObj<typeof meta>

export const Running: Story = {}

export const Idle: Story = { args: { state: ESessionState.Idle } }

export const ApprovalPending: Story = { args: { state: ESessionState.ApprovalPending } }

export const TerminalConnected: Story = {
  args: {
    initialTab: ERightTab.Terminal,
    initialTerminalConnection: ETerminalConnection.Connected,
  },
}

export const TerminalConnecting: Story = {
  args: {
    initialTab: ERightTab.Terminal,
    initialTerminalConnection: ETerminalConnection.Connecting,
  },
}

export const TerminalSandboxPaused: Story = {
  args: { initialTab: ERightTab.Terminal, initialTerminalConnection: ETerminalConnection.Paused },
}

export const TerminalDisconnected: Story = {
  args: {
    initialTab: ERightTab.Terminal,
    initialTerminalConnection: ETerminalConnection.Disconnected,
  },
}

export const PreviewTab: Story = {
  args: { initialTab: ERightTab.Preview, initialPreviewId: 'storybook' },
}

export const PodRunning: Story = {
  args: { header: { podStatus: { status: RUNNING_POD, defaultOpen: true } } },
}

export const PodParked: Story = {
  args: {
    state: ESessionState.Idle,
    header: {
      podStatus: { status: { ...RUNNING_POD, state: EPodState.Parked }, defaultOpen: true },
    },
  },
}

export const PodResizePending: Story = {
  args: {
    header: { podStatus: { status: { ...RUNNING_POD, pendingVcpus: 8 }, defaultOpen: true } },
  },
}
