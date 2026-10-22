import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { Suggestions } from '@dltech/atlas-ui/ai/suggestion'

import { SUGGESTIONS } from '../fixtures/agent'

const meta = {
  title: 'AI/Suggestion',
  component: Suggestions,
  args: { suggestions: SUGGESTIONS },
  decorators: [
    (Story) => (
      <div className="w-[28rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Suggestions>

export default meta

type Story = StoryObj<typeof meta>

export const Scrolling: Story = {}

export const Few: Story = { args: { suggestions: SUGGESTIONS.slice(0, 2) } }

function SendDemo() {
  const [sent, setSent] = useState('')
  return (
    <div className="flex flex-col gap-3">
      <Suggestions suggestions={SUGGESTIONS} onSelect={setSent} />
      <p className="text-sm text-muted-foreground">
        {sent ? 'Sent: ' + sent : 'Click a suggestion.'}
      </p>
    </div>
  )
}

export const Interactive: Story = { render: () => <SendDemo /> }
