'use client'

import { Fragment, type ReactNode } from 'react'

import { AgentMessage, UserMessage } from '@dltech/atlas-ui/ai/message'
import { SandboxBoot } from '@dltech/atlas-ui/ai/sandbox-boot'
import { Chat, ChatItem } from '@dltech/atlas-ui/ai/chat'
import { Spinner } from '@dltech/atlas-ui/components/spinner'
import { Trace, TraceIcon, TraceLine, TraceTitle } from '@dltech/atlas-ui/components/trace'

import type { BootView } from './data/boot-view'
import { ETranscriptKind, type TranscriptItem } from './data/transcript'
import { sandboxBootPropsOf } from './sandbox-boot-props'

function Said({ item }: { item: TranscriptItem }) {
  const text = <p className="whitespace-pre-wrap">{item.text}</p>
  if (item.kind === ETranscriptKind.User) return <UserMessage>{text}</UserMessage>
  return <AgentMessage copyText={item.text}>{text}</AgentMessage>
}

export function ThreadTranscript({
  items,
  boot,
  working,
  onRetryBoot,
}: {
  items: readonly TranscriptItem[]
  boot: BootView | null
  working: boolean
  onRetryBoot: () => void
}) {
  const firstUser = items.findIndex((item) => item.kind === ETranscriptKind.User)
  const bootAt = firstUser + 1
  const bootNode: ReactNode =
    boot === null ? null : (
      <ChatItem id="sandbox-boot">
        <SandboxBoot {...sandboxBootPropsOf(boot)} onRetry={onRetryBoot} />
      </ChatItem>
    )
  return (
    <Chat>
      {bootAt === 0 ? bootNode : null}
      {items.map((item, index) => (
        <Fragment key={item.id}>
          <ChatItem id={item.id}>
            <Said item={item} />
          </ChatItem>
          {index + 1 === bootAt ? bootNode : null}
        </Fragment>
      ))}
      {working ? (
        <ChatItem id="working">
          <Trace>
            <TraceLine status="running">
              <TraceIcon>
                <Spinner />
              </TraceIcon>
              <TraceTitle>Working…</TraceTitle>
            </TraceLine>
          </Trace>
        </ChatItem>
      ) : null}
    </Chat>
  )
}
