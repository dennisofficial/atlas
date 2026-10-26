import { useRef } from 'react'
import type { Meta, StoryObj } from '@storybook/react'

import { TerminalScreen, type TerminalScreenHandle } from './terminal-screen'

const ESC = '\u001b'
const PROMPT = `${ESC}[32mdennis@pod${ESC}[0m ${ESC}[34m~/workspace${ESC}[0m ${ESC}[33m(main)${ESC}[0m $ `

const SESSION = [
  `${PROMPT}bun test\r\n`,
  `${ESC}[1mbun test v1.3.4${ESC}[0m\r\n`,
  `${ESC}[32m✓${ESC}[0m reconnects after the socket closes ${ESC}[90m[12.00ms]${ESC}[0m\r\n`,
  `${ESC}[31m✗${ESC}[0m drops stale frames ${ESC}[90m[3.10ms]${ESC}[0m\r\n`,
  `\r\n ${ESC}[32m1 pass${ESC}[0m\r\n ${ESC}[31m1 fail${ESC}[0m\r\n\r\n`,
  PROMPT,
].join('')

function Playground() {
  const ref = useRef<TerminalScreenHandle>(null)

  const handleReady = () => ref.current?.write(SESSION)

  const handleData = (data: string) => ref.current?.write(data === '\r' ? `\r\n${PROMPT}` : data)

  return (
    <div className="flex h-80 w-[40rem] flex-col rounded-lg border border-border">
      <TerminalScreen ref={ref} label="Playground" onReady={handleReady} onData={handleData} />
    </div>
  )
}

const meta = {
  title: 'AI/Terminal Screen',
  component: TerminalScreen,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof TerminalScreen>

export default meta
type Story = StoryObj<typeof meta>

export const Interactive: Story = { render: () => <Playground /> }

export const Dimmed: Story = {
  args: { dimmed: true, readOnly: true },
  render: (args) => {
    const handleReady = () => undefined
    return (
      <div className="flex h-48 w-[40rem] flex-col rounded-lg border border-border">
        <TerminalScreen {...args} onReady={handleReady} />
      </div>
    )
  },
}
