'use client'

import { usePrototype } from '@/proto/use-prototype'

import { THREADS } from '../shell/fixtures/app'
import { FOCUS_ID } from './agent-fixtures'
import { queueOf } from './queue-fixtures'
import { SessionView } from './session-view'
import { headerFor, THREAD_CONTROLS, tweaksOf } from './thread-tweaks'

export function ThreadRoute({ threadId }: { threadId: string }) {
  const values = usePrototype(THREAD_CONTROLS)
  const { state, tab, terminal, pod, prDesign } = tweaksOf(values)
  const thread = THREADS.find((candidate) => candidate.id === threadId)
  const signature = [
    threadId,
    state,
    tab,
    terminal,
    pod,
    prDesign,
    values.prCount,
    values.detail,
    values.queued,
  ].join('|')

  return (
    <SessionView
      key={signature}
      threadId={threadId}
      state={state}
      initialTab={tab}
      initialDetailId={values.detail ? FOCUS_ID : undefined}
      initialQueue={queueOf(values.queued)}
      initialTerminalConnection={terminal}
      header={headerFor({ thread, pod, prDesign, prCount: values.prCount })}
    />
  )
}
