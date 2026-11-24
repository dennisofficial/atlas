import { useState } from 'react'

import { blockingCopyOf, type BlockingCommand } from '@dltech/atlas-client/stream'
import { Context } from '@dltech/atlas-ui/ai/context'
import { UserMessage } from '@dltech/atlas-ui/ai/message'
import { EEffort, ModelSelector } from '@dltech/atlas-ui/ai/model-selector'
import { MODELS } from '@dltech/atlas-ui/fixtures/agent'

import { ThreadComposer } from '@/features/threads/thread-composer'

import { BlockingDock } from './blocking-dock'

const meta = {
  title: 'Sessions/Blocking command',
  parameters: { layout: 'fullscreen' },
}

export default meta

const QUEUED_TEXT = 'Also cap the jitter so the fourth attempt cannot overshoot.'

const summariseFor = (seconds: number): BlockingCommand => ({
  inboxId: 105,
  name: 'summarise',
  startedAt: new Date(Date.now() - seconds * 1000).toISOString(),
  copy: blockingCopyOf('summarise') ?? { label: 'Summarising history', queued: 'Waits' },
})

const Scene = ({ queued }: { queued?: string }) => {
  const [blocking] = useState(() => summariseFor(42))
  const [value, setValue] = useState('')
  const [pending, setPending] = useState<readonly string[]>(queued === undefined ? [] : [queued])
  const [model, setModel] = useState('claude-opus')
  const [effort, setEffort] = useState(EEffort.Medium)
  const [fast, setFast] = useState(false)

  const handleSubmit = (text: string) => {
    setPending((rows) => [...rows, text])
    setValue('')
  }

  return (
    <div className="flex min-h-svh flex-col justify-end gap-4 bg-background px-4 py-6">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <UserMessage author="Dennis" timestamp="16:02">
          Why did the retry backoff stall for four minutes?
        </UserMessage>
        <p className="px-1 text-sm text-muted-foreground">
          The backoff doubles the delay, but the cap is applied after the timer starts, so the
          fourth attempt waited four minutes.
        </p>
        {pending.map((text, index) => (
          <UserMessage
            key={`${String(index)}:${text}`}
            author="Dennis"
            timestamp={blocking.copy.queued}
          >
            {text}
          </UserMessage>
        ))}
        <BlockingDock blocking={blocking} commands={undefined}>
          <ThreadComposer
            value={value}
            onValueChange={setValue}
            onSubmit={handleSubmit}
            sending={false}
            placeholder="Message Atlas…"
          >
            <ModelSelector
              models={MODELS}
              value={model}
              onValueChange={setModel}
              effort={effort}
              onEffortChange={setEffort}
              fast={fast}
              onFastChange={setFast}
            />
            <div className="ml-auto flex min-w-0">
              <Context used={80_000} limit={200_000} />
            </div>
          </ThreadComposer>
        </BlockingDock>
      </div>
    </div>
  )
}

export const StatusStrip = { render: () => <Scene /> }

export const StatusStripQueued = { render: () => <Scene queued={QUEUED_TEXT} /> }
