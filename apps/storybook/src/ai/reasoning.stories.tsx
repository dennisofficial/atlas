import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { Reasoning } from '@dltech/atlas-ui/ai/reasoning'

import { REASONING_TEXT } from '../fixtures/agent'

const meta = {
  title: 'AI/Reasoning',
  component: Reasoning,
  args: { text: REASONING_TEXT },
  decorators: [
    (Story) => (
      <div className="w-[34rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Reasoning>

export default meta

type Story = StoryObj<typeof meta>

export const Done: Story = { args: { duration: '12s' } }

export const Running: Story = {
  args: { running: true, text: REASONING_TEXT.split('\n\n')[0] ?? '' },
}

export const Empty: Story = { args: { running: true, text: '' } }

function StreamingDemo() {
  const [length, setLength] = useState(0)
  const finished = length >= REASONING_TEXT.length

  useEffect(() => {
    if (finished) return undefined
    const timer = setTimeout(() => setLength((current) => current + 4), 30)
    return () => clearTimeout(timer)
  }, [length, finished])

  return (
    <Reasoning
      text={REASONING_TEXT.slice(0, length)}
      running={!finished}
      duration={finished ? '7s' : undefined}
    />
  )
}

export const Streaming: Story = { render: () => <StreamingDemo /> }
