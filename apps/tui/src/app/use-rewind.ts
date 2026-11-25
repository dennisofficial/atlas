import type { KeyEvent } from '@opentui/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Attachment, RecordEvent } from '@dltech/atlas-core'
import {
  mergedDraftOf,
  requestRewind,
  rewindLanded,
  rewindRefused,
  rewoundMessageOf,
} from '@dltech/atlas-client/session'
import { transcriptEventsOf } from '@dltech/atlas-client/stream'

import type { DraftControls } from '../ui/hooks/use-draft'
import {
  chooseVerb,
  clearVerb,
  isCurrentRow,
  ERewindPointKind,
  moveSelection,
  openRewind,
  resolve,
  verbsFor,
  type RewindChoice,
  type RewindState,
} from '../ui/rewind-model'
import { messageOf } from './app-next-support'
import { eventTypes } from './registered-plugins'
import { rewindCommandOf } from './rewind-pick'
import type { SessionApi } from './session-api'
import type { SessionAttachments } from './use-session-attachments'

const NOTHING_TO_REWIND = 'nothing to rewind yet'

const REWIND_REFUSED = 'that rewind was refused'

type Pending = {
  eventId: string
  text: string
  attachments: readonly Attachment[]
  inboxId: number | undefined
}

export type RewindControl = {
  state: RewindState | null
  handleOpen: () => void
  handleDismiss: () => void
  handlePick: (choice: RewindChoice) => void
  handleKey: (key: KeyEvent) => boolean
}

export function useRewind(args: {
  api: Pick<SessionApi, 'runCommand'>
  sessionId: string
  rawEvents: readonly RecordEvent[]
  draft: Pick<DraftControls, 'value' | 'setValue'> & { editor: DraftControls['editor'] }
  attachments: Pick<SessionAttachments, 'restore'>
  onProblem: (reason: string) => void
}): RewindControl {
  const [state, setState] = useState<RewindState | null>(null)
  const held = useRef<RewindState | null>(null)
  const pending = useRef<Pending | null>(null)
  const latest = useRef(args)
  latest.current = args

  const put = useCallback((next: RewindState | null) => {
    held.current = next
    setState(next)
  }, [])

  const handleOpen = useCallback(() => {
    const events = transcriptEventsOf(latest.current.rawEvents, eventTypes)
    const opened = openRewind({ events })
    if (opened === null) {
      latest.current.onProblem(NOTHING_TO_REWIND)
      return
    }
    put(opened)
  }, [put])

  const handleDismiss = useCallback(() => put(null), [put])

  const handlePick = useCallback(
    (choice: RewindChoice) => {
      put(null)
      const command = rewindCommandOf(choice)
      if (command === null) return

      if (command.name !== 'rewind') {
        void latest.current.api
          .runCommand({
            sessionId: latest.current.sessionId,
            name: command.name,
            args: command.args,
          })
          .catch((failure: unknown) => {
            latest.current.onProblem(`could not summarise — ${messageOf(failure)}`)
          })
        return
      }

      const point = choice.point
      const message =
        point.kind === ERewindPointKind.Said
          ? rewoundMessageOf({ events: latest.current.rawEvents, eventId: point.eventId })
          : undefined
      const waiting: Pending | null =
        message === undefined
          ? null
          : {
              eventId: message.eventId,
              text: message.text,
              attachments: message.attachments,
              inboxId: undefined,
            }
      pending.current = waiting

      void requestRewind({
        api: { command: latest.current.api.runCommand },
        sessionId: latest.current.sessionId,
        toSeq: point.seq,
      })
        .then((inboxId) => {
          if (waiting !== null && pending.current === waiting) waiting.inboxId = inboxId
        })
        .catch((failure: unknown) => {
          if (waiting === null || pending.current === waiting) pending.current = null
          latest.current.onProblem(`could not rewind — ${messageOf(failure)}`)
        })
    },
    [put],
  )

  const draftText = useCallback(
    (): string => latest.current.draft.editor.current?.plainText ?? latest.current.draft.value,
    [],
  )

  const { rawEvents, draft, attachments, onProblem } = args

  const actOnKey = useCallback(
    (key: KeyEvent): boolean => {
      const current = held.current
      if (current === null) return false

      if (key.name === 'escape') {
        if (current.verb === null) {
          handleDismiss()
          return true
        }
        put(clearVerb({ state: current }))
        return true
      }

      if (key.name === 'return' || key.name === 'enter') {
        if (isCurrentRow(current)) {
          handleDismiss()
          return true
        }

        if (current.verb === null) {
          const [first] = verbsFor({ state: current })
          if (first !== undefined) put(chooseVerb({ state: current, verb: first }))
          return true
        }

        const choice = resolve(current)
        if (choice !== null) handlePick(choice)
        return true
      }

      if (key.name === 'up' || key.name === 'down') {
        put(moveSelection({ state: current, delta: key.name === 'up' ? -1 : 1 }))
        return true
      }

      return false
    },
    [handleDismiss, handlePick, put],
  )

  const handleKey = useCallback(
    (key: KeyEvent): boolean => {
      const handled = actOnKey(key)
      if (handled) key.preventDefault()
      return handled
    },
    [actOnKey],
  )

  useEffect(() => {
    const waiting = pending.current
    if (waiting === null) return

    if (
      waiting.inboxId !== undefined &&
      rewindRefused({ events: rawEvents, inboxId: waiting.inboxId })
    ) {
      pending.current = null
      onProblem(REWIND_REFUSED)
      return
    }

    if (!rewindLanded({ events: rawEvents, eventId: waiting.eventId })) return
    pending.current = null
    draft.setValue(mergedDraftOf({ rewound: waiting.text, current: draftText() }))
    attachments.restore(waiting.attachments)
  }, [attachments, draft, draftText, onProblem, rawEvents])

  return useMemo(
    () => ({ state, handleOpen, handleDismiss, handlePick, handleKey }),
    [handleDismiss, handleKey, handleOpen, handlePick, state],
  )
}
