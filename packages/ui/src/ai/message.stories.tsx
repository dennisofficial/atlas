import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'

import { AgentMessage, EFeedback, HarnessMessage, UserMessage } from './message'

const meta = {
  title: 'AI/Message',
  component: AgentMessage,
  args: {
    children:
      'Install Dialog, then open it from the gear button. I also regenerated theme.css so the tokens spec passes.',
  },
  decorators: [
    (Story) => (
      <div className="w-[34rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AgentMessage>

export default meta

type Story = StoryObj<typeof meta>

export const Agent: Story = {
  args: {
    author: 'Atlas',
    timestamp: '14:02',
    copyText: 'Install Dialog…',
    onRetry: () => {},
    onFeedback: () => {},
  },
}

export const Streaming: Story = {
  args: { streaming: true, children: 'Reading the token generator and checking which' },
}

export const User: Story = {
  render: () => (
    <UserMessage
      author="Dennis"
      timestamp="14:01"
      onEdit={() => {}}
      attachments={[{ id: '1', label: 'typecheck.log' }]}
    >
      Rebase the ui package on shadcn and keep our colors.
    </UserMessage>
  ),
}

export const UserWithRewind: Story = {
  render: () => (
    <UserMessage author="Dennis" timestamp="14:36" onEdit={() => {}} onRewind={() => {}}>
      Try the migration again without the backfill.
    </UserMessage>
  ),
}

function FeedbackDemo() {
  const [feedback, setFeedback] = useState<EFeedback>()
  return (
    <AgentMessage
      copyText="Done."
      feedback={feedback}
      onFeedback={setFeedback}
      onRetry={() => setFeedback(undefined)}
    >
      Done. Toggle the thumbs to see aria-pressed change.
    </AgentMessage>
  )
}

export const Feedback: Story = { render: () => <FeedbackDemo /> }

export const Harness: Story = {
  render: () => <HarnessMessage>Turn complete · 2 files changed</HarnessMessage>,
}
