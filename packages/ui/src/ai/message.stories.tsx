import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'

import { AgentMessage, EFeedback, HarnessMessage, UserMessage } from './message'

const SCREENSHOT_SRC = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#3f3f46"/><rect x="16" y="16" width="288" height="24" rx="4" fill="#71717a"/><rect x="16" y="56" width="200" height="12" rx="3" fill="#a1a1aa"/><rect x="16" y="80" width="240" height="12" rx="3" fill="#a1a1aa"/></svg>',
)}`

const meta = {
  title: 'AI/Message',
  component: AgentMessage,
  args: {
    children:
      'Install Dialog, then open it from the gear button. I also regenerated theme.css so the tokens spec passes.',
  },
  decorators: [
    (Story) => (
      <div className="w-[34rem] max-w-[calc(100vw-2rem)]">
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
    timestamp: '2:02 PM',
    copyText: 'Install Dialog…',
    onRetry: () => {},
    onFeedback: () => {},
  },
}

export const Streaming: Story = {
  args: {
    author: 'Atlas',
    timestamp: '2:03 PM',
    streaming: true,
    copyText: 'Reading the token generator…',
    onRetry: () => {},
    children: 'Reading the token generator and checking which',
  },
}

export const User: Story = {
  render: () => (
    <UserMessage
      author="Dennis"
      timestamp="2:01 PM"
      copyText="Rebase the ui package on shadcn and keep our colors."
      onEdit={() => {}}
      attachments={[{ id: '1', label: 'typecheck.log' }]}
    >
      Rebase the ui package on shadcn and keep our colors.
    </UserMessage>
  ),
}

export const UserWithRewind: Story = {
  render: () => (
    <UserMessage
      author="Dennis"
      timestamp="2:36 PM"
      copyText="Try the migration again without the backfill."
      onEdit={() => {}}
      onRewind={() => {}}
    >
      Try the migration again without the backfill.
    </UserMessage>
  ),
}

export const UserTimeOnly: Story = {
  render: () => (
    <UserMessage author="Dennis" timestamp="9:30 AM">
      Footer with only the time.
    </UserMessage>
  ),
}

export const UserImageOnly: Story = {
  render: () => (
    <UserMessage
      author="Dennis"
      timestamp="9:31 AM"
      images={[{ id: 'i1', src: SCREENSHOT_SRC, alt: 'shot.png' }]}
      onRewind={() => {}}
    />
  ),
}

export const Conversation: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <UserMessage
        author="Dennis"
        timestamp="2:01 PM"
        copyText="Rebase the ui package on shadcn and keep our colors."
        onEdit={() => {}}
        onRewind={() => {}}
      >
        Rebase the ui package on shadcn and keep our colors.
      </UserMessage>
      <AgentMessage
        author="Atlas"
        timestamp="2:02 PM"
        copyText="Done."
        onFeedback={() => {}}
        onRetry={() => {}}
      >
        Done. Both footers share one timestamp format and quiet action cluster.
      </AgentMessage>
      <AgentMessage author="Atlas" timestamp="2:03 PM" streaming copyText="Working…">
        Working on the follow-up
      </AgentMessage>
    </div>
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
