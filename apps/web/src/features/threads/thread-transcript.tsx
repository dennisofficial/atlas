'use client'

import { Fragment, type ReactNode } from 'react'
import { CircleAlertIcon } from 'lucide-react'

import { AgentMessage, UserMessage } from '@dltech/atlas-ui/ai/message'
import { Reasoning } from '@dltech/atlas-ui/ai/reasoning'
import { SandboxBoot } from '@dltech/atlas-ui/ai/sandbox-boot'
import { Tool } from '@dltech/atlas-ui/ai/tool'
import { Chat, ChatItem } from '@dltech/atlas-ui/ai/chat'
import { Alert, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { Spinner } from '@dltech/atlas-ui/components/spinner'
import { Trace, TraceIcon, TraceLine, TraceTitle } from '@dltech/atlas-ui/components/trace'

import type { BootView } from './data/boot-view'
import { ETranscriptKind, isTextStreaming, type TranscriptItem } from './data/transcript'
import { sandboxBootPropsOf } from './sandbox-boot-props'

function Said({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case ETranscriptKind.User:
      return (
        <UserMessage>
          <p className="whitespace-pre-wrap">{item.text}</p>
        </UserMessage>
      )
    case ETranscriptKind.Agent:
      return (
        <AgentMessage streaming={item.streaming} copyText={item.text}>
          <p className="whitespace-pre-wrap">{item.text}</p>
        </AgentMessage>
      )
    case ETranscriptKind.Thought:
      return <Reasoning text={item.text} running={item.streaming} />
    case ETranscriptKind.Tools:
      return (
        <div className="flex flex-col gap-1">
          {item.calls.map((call) => (
            <Tool
              key={call.id}
              kind={call.kind}
              state={call.state}
              label={call.label}
              output={call.output}
              errorText={call.errorText}
              elapsed={call.elapsed}
            />
          ))}
        </div>
      )
  }
}

function WorkingLine() {
  return (
    <Trace>
      <TraceLine status="running">
        <TraceIcon>
          <Spinner />
        </TraceIcon>
        <TraceTitle>Working…</TraceTitle>
      </TraceLine>
    </Trace>
  )
}

export function ThreadTranscript({
  items,
  failure,
  boot,
  working,
  onRetryBoot,
}: {
  items: readonly TranscriptItem[]
  failure: string | null
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
      {failure === null ? null : (
        <ChatItem id="turn-failure">
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>The run failed</AlertTitle>
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        </ChatItem>
      )}
      {working && !isTextStreaming(items) ? (
        <ChatItem id="working">
          <WorkingLine />
        </ChatItem>
      ) : null}
    </Chat>
  )
}
