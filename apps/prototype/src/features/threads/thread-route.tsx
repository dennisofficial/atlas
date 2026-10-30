'use client'

import { useSearchParams } from 'next/navigation'

import { usePrototype } from '@/proto/use-prototype'

import { THREADS } from '../shell/fixtures/app'
import { FailureView } from './failure-card/failure-view'
import { FOCUS_ID } from './agent-fixtures'
import { queueOf } from './queue-fixtures'
import { SessionView } from './session-view'
import { headerFor, THREAD_CONTROLS, tweaksOf } from './thread-tweaks'

export function ThreadRoute({ threadId }: { threadId: string }) {
  const values = usePrototype(THREAD_CONTROLS)
  const variant = useSearchParams().get('variant')
  const { state, tab, terminal } = tweaksOf(values)
  const thread = THREADS.find((candidate) => candidate.id === threadId)
  const signature = [threadId, state, tab, terminal, values.detail, values.queued].join('|')

  if (variant !== null) return <FailureView variant={variant.toUpperCase()} />

  return (
    <SessionView
      key={signature}
      threadId={threadId}
      state={state}
      initialTab={tab}
      initialDetailId={values.detail ? FOCUS_ID : undefined}
      initialQueue={queueOf(values.queued)}
      initialTerminalConnection={terminal}
      header={headerFor(thread)}
    />
  )
}
