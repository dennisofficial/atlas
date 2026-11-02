import { AgentMessage, UserMessage } from '@dltech/atlas-ui/ai/message'
import { Chat, ChatItem } from '@dltech/atlas-ui/ai/chat'
import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'

import { DetailsSection } from '../details/section'
import { CrewLoading, TranscriptLoading } from './agents-skeletons'

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="h-[360px] w-[380px] border bg-card p-3">{children}</div>
}

const meta = {
  title: 'Threads/Panel/Agent skeletons',
  parameters: { layout: 'fullscreen' },
}

export default meta

export const CrewLoadingState = {
  render: () => (
    <Frame>
      <CrewLoading />
    </Frame>
  ),
}

export const CrewLoaded = {
  render: () => (
    <Frame>
      <DetailsSection title="Sub-agents" count="1/3">
        {['Review the diff', 'Write tests', 'Update docs'].map((title) => (
          <DetailRow
            key={title}
            label={title}
            meta="2m"
            detail="claude-sonnet"
            icon={<span className="size-3.5 rounded-full bg-muted-foreground" />}
          />
        ))}
      </DetailsSection>
    </Frame>
  ),
}

export const TranscriptLoadingState = {
  render: () => (
    <Frame>
      <TranscriptLoading />
    </Frame>
  ),
}

export const TranscriptLoaded = {
  render: () => (
    <Frame>
      <Chat jumpKey="u">
        <ChatItem id="u">
          <UserMessage>Review the diff and report anything risky.</UserMessage>
        </ChatItem>
        <ChatItem id="a">
          <AgentMessage author="Atlas">The diff is small and safe.</AgentMessage>
        </ChatItem>
      </Chat>
    </Frame>
  ),
}
