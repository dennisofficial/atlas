import type { Meta, StoryObj } from '@storybook/react'

import { Chat, ChatItem } from './chat'
import { REAL_TURNS } from './internal/real-transcript'
import { RealTurnView } from './internal/real-turn-view'
import { StreamButton, StreamingReply, useStreamReply } from './internal/chat-long-parts'

const meta = {
  title: 'AI/Chat Long',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function TranscriptDemo() {
  const { text, start } = useStreamReply()
  return (
    <div className="flex h-[40rem] flex-col rounded-lg border">
      <Chat className="flex-1">
        {REAL_TURNS.map((turn) => (
          <ChatItem key={turn.id} id={turn.id}>
            <RealTurnView turn={turn} />
          </ChatItem>
        ))}
        {text === null ? null : (
          <ChatItem id="stream">
            <StreamingReply text={text} />
          </ChatItem>
        )}
      </Chat>
      <StreamButton onStream={start} />
    </div>
  )
}

export const Transcript: Story = { render: () => <TranscriptDemo /> }
