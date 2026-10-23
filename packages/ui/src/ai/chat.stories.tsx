import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'

import { Chat, ChatItem } from './chat'
import { Checkpoint } from './checkpoint'
import { AgentMessage, UserMessage } from './message'
import { Button } from '#components/button'

const meta = {
  title: 'AI/Chat',
  component: Chat,
  args: { children: null },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Chat>

export default meta

type Story = StoryObj<typeof meta>

const SCRIPT = [
  { id: 'u1', user: true, text: 'Add a dark mode toggle to the settings page.' },
  {
    id: 'a1',
    user: false,
    text: 'next-themes is already set up, so I added a ModeToggle to the settings header.',
  },
  { id: 'u2', user: true, text: 'Persist it in a cookie.' },
  {
    id: 'a2',
    user: false,
    text: 'The theme now reads from a cookie on the server, so there is no flash on load.',
  },
  { id: 'u3', user: true, text: 'Check contrast on the charts.' },
  {
    id: 'a3',
    user: false,
    text: 'Chart colors pass AA in both schemes except chart-4 in light, which I darkened.',
  },
]

function ChatDemo() {
  const [count, setCount] = useState(SCRIPT.length)
  const handleMore = () => setCount((current) => Math.min(SCRIPT.length, current + 2))
  const handleReset = () => setCount(2)

  return (
    <div className="flex h-[28rem] flex-col gap-2 rounded-lg border">
      <Chat className="flex-1">
        {SCRIPT.slice(0, count).map((turn, index) => (
          <ChatItem key={turn.id} id={turn.id} anchor={turn.user}>
            {turn.user ? (
              <UserMessage>{turn.text}</UserMessage>
            ) : (
              <div className="flex flex-col gap-6">
                <AgentMessage copyText={turn.text}>{turn.text}</AgentMessage>
                {index < count - 1 ? <Checkpoint label={'Turn ' + (index + 1)} /> : null}
              </div>
            )}
          </ChatItem>
        ))}
      </Chat>
      <div className="flex gap-2 p-3">
        <Button size="sm" variant="outline" onClick={handleMore}>
          Next turn
        </Button>
        <Button size="sm" variant="ghost" onClick={handleReset}>
          Reset
        </Button>
      </div>
    </div>
  )
}

export const Thread: Story = { render: () => <ChatDemo /> }
