'use client'

import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { CircleCheckIcon, CircleSlashIcon, CircleXIcon, ClockIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'
import {
  Trace,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@dltech/atlas-ui/components/trace'

import {
  answerOperatorRequest,
  cancelOperatorRequest,
  type OperatorAnswerResult,
} from '../data/operator-answer'
import type { RequestItem } from '../data/transcript-items'

const PRIVACY = 'The model never sees this value.'
const WAITING = 'Waiting for the session to confirm.'

enum ESendPhase {
  Idle = 'idle',
  Sending = 'sending',
  Sent = 'sent',
}

function TranscriptRequestSettled({ item }: { item: RequestItem }) {
  const failed = item.state === 'failed'
  return (
    <Trace>
      <TraceLine {...(failed ? { status: 'error' as const } : {})}>
        <TraceIcon>
          {item.state === 'delivered' ? <CircleCheckIcon /> : null}
          {item.state === 'cancelled' ? <CircleSlashIcon /> : null}
          {item.state === 'expired' ? <ClockIcon /> : null}
          {failed ? <CircleXIcon /> : null}
        </TraceIcon>
        <TraceTitle>
          {item.state === 'delivered' ? 'The operator answered' : null}
          {item.state === 'cancelled' ? 'The operator cancelled the request' : null}
          {item.state === 'expired' ? 'The request expired' : null}
          {failed ? "Could not deliver the operator's value" : null}
        </TraceTitle>
        <TraceDescription className="min-w-0 flex-1 truncate">
          {item.reason ?? item.prompt}
        </TraceDescription>
      </TraceLine>
    </Trace>
  )
}

function TranscriptRequestPending({
  item,
  sessionId,
}: {
  item: RequestItem
  sessionId: string | undefined
}) {
  const [value, setValue] = useState('')
  const [phase, setPhase] = useState(ESendPhase.Idle)
  const [error, setError] = useState<string | null>(null)
  const sending = phase !== ESendPhase.Idle
  const canSubmit = value.length > 0 && !sending

  const settle = (work: () => Promise<OperatorAnswerResult>) => {
    setPhase(ESendPhase.Sending)
    setError(null)
    void work().then((result) => {
      if (!result.ok) {
        setPhase(ESendPhase.Idle)
        setError(result.reason)
        return
      }
      setValue('')
      setPhase(ESendPhase.Sent)
    })
  }
  const handleSubmit = () => {
    if (!canSubmit) return
    settle(() =>
      answerOperatorRequest({
        requestId: item.requestId,
        value,
        ...(sessionId === undefined ? {} : { sessionId }),
      }),
    )
  }
  const handleCancel = () => {
    if (sending) return
    settle(() => cancelOperatorRequest({ requestId: item.requestId }))
  }
  const handleSubmitEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    handleSubmit()
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      handleSubmit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      handleCancel()
    }
  }

  return (
    <form
      aria-label={item.prompt}
      onSubmit={handleSubmitEvent}
      onKeyDown={handleKeyDown}
      className="flex w-full min-w-0 flex-col gap-2"
    >
      <span className="text-sm text-muted-foreground">{item.prompt}</span>
      <fieldset disabled={sending} className="flex w-full min-w-0 flex-col gap-2">
        <Input
          type={item.secret ? 'password' : 'text'}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Paste the value"
          aria-label="Your answer"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        <div className="flex min-w-0 items-center gap-2">
          <Button size="xs" type="submit" disabled={!canSubmit}>
            Submit
          </Button>
          <Button size="xs" variant="ghost" type="button" onClick={handleCancel}>
            Cancel
          </Button>
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {phase === ESendPhase.Sent ? WAITING : PRIVACY}
          </p>
        </div>
      </fieldset>
      {error === null ? null : <p className="text-xs text-destructive">{error}</p>}
    </form>
  )
}

export function TranscriptRequest({
  item,
  sessionId,
}: {
  item: RequestItem
  sessionId?: string | undefined
}) {
  if (item.state !== 'pending') return <TranscriptRequestSettled item={item} />
  return <TranscriptRequestPending item={item} sessionId={sessionId} />
}
