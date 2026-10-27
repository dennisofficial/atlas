import { useRef } from 'react'
import type { Meta, StoryObj } from '@storybook/react'

import { TerminalPanel } from './terminal-panel'
import { TerminalScreen, type TerminalScreenHandle } from './terminal-screen'
import { ETerminalConnection } from './terminal-states'

const ESC = '\u001b'
const GREETING = `${ESC}[90mConnected to pod · Ubuntu 24.04 · bun 1.3.4${ESC}[0m\r\n${ESC}[32mdennis@pod${ESC}[0m ${ESC}[34m~/workspace${ESC}[0m $ `

function Screen() {
  const ref = useRef<TerminalScreenHandle>(null)
  const handleReady = () => ref.current?.write(GREETING)
  return <TerminalScreen ref={ref} onReady={handleReady} />
}

const meta = {
  title: 'AI/Terminal Panel',
  component: TerminalPanel,
  args: {
    connection: ETerminalConnection.Connected,
    detail: '4 vCPU · 8 GB',
    tabs: [
      { id: 'term-1', label: 'Terminal 1' },
      { id: 'term-2', label: 'Terminal 2' },
    ],
    activeId: 'term-1',
    onActiveChange: () => undefined,
    onNew: () => undefined,
    onReconnect: () => undefined,
    children: <Screen />,
  },
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="h-96 w-[36rem] overflow-hidden rounded-lg border border-border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TerminalPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Connected: Story = {}

export const Connecting: Story = {
  args: { connection: ETerminalConnection.Connecting },
}

export const Paused: Story = {
  args: { connection: ETerminalConnection.Paused },
}

export const Disconnected: Story = {
  args: {
    connection: ETerminalConnection.Disconnected,
    disconnectedMessage: 'The pod did not start.',
  },
}
