import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Attachment, PendingInputsState, RecordEvent } from '@dltech/atlas-core'
import {
  ALREADY_SENT_REASON,
  EStagedOutcome,
  stagedOutcomesOf,
  stagedPlacementOf,
} from '@dltech/atlas-client/stream'

export type StagedMessage = { clientId: string; text: string; attachments: readonly Attachment[] }

export type StagedState = {
  staged: readonly StagedMessage[]
  queue: readonly StagedMessage[]
  transcript: readonly StagedMessage[]
  refused: readonly StagedMessage[]
  stage: (message: StagedMessage) => void
  settle: (clientIds: ReadonlySet<string>) => void
  withdraw: (clientId: string) => StagedMessage | null
}

export function useStagedMessages(args: {
  sessionId: string
  events: readonly RecordEvent[]
  pending: PendingInputsState
  working: boolean
  onRestore: (args: {
    text: string
    attachments: readonly Attachment[]
    reason: string | undefined
  }) => void
}): StagedState {
  const { sessionId, events, pending, working } = args
  const held = useRef(new Map<string, readonly StagedMessage[]>())
  const [staged, setStaged] = useState<readonly StagedMessage[]>(() => [])
  const handled = useRef(new Set<string>())
  const [refused, setRefused] = useState<readonly StagedMessage[]>(() => [])
  const restore = useRef(args.onRestore)
  restore.current = args.onRestore

  const put = useCallback(
    (next: readonly StagedMessage[]) => {
      held.current.set(sessionId, next)
      setStaged(next)
    },
    [sessionId],
  )

  useEffect(() => {
    handled.current = new Set()
    setRefused([])
    setStaged(held.current.get(sessionId) ?? [])
  }, [sessionId])

  const stage = useCallback(
    (message: StagedMessage) => {
      put([...(held.current.get(sessionId) ?? []), message])
      setRefused((current) => current.filter((entry) => entry.text !== message.text))
    },
    [put, sessionId],
  )

  const withdraw = useCallback(
    (clientId: string): StagedMessage | null => {
      const current = held.current.get(sessionId) ?? []
      const found = current.find((entry) => entry.clientId === clientId)
      if (found === undefined) return null
      put(current.filter((entry) => entry.clientId !== clientId))
      return found
    },
    [put, sessionId],
  )

  const settle = useCallback(
    (clientIds: ReadonlySet<string>) => {
      const current = held.current.get(sessionId) ?? []
      put(current.filter((entry) => !clientIds.has(entry.clientId)))
    },
    [put, sessionId],
  )

  const outcomes = useMemo(
    () => stagedOutcomesOf({ events, clientIds: staged.map((entry) => entry.clientId) }),
    [events, staged],
  )
  const unread = useMemo(
    () =>
      new Set(
        pending.pending.flatMap((input) =>
          input.message?.clientId === undefined ? [] : [input.message.clientId],
        ),
      ),
    [pending],
  )

  useEffect(() => {
    if (staged.length === 0) return

    const settled = staged.flatMap((entry) => {
      const outcome = outcomes.get(entry.clientId)
      if (outcome === undefined) return []
      if (outcome.outcome === EStagedOutcome.Pending) return []
      if (outcome.outcome === EStagedOutcome.Posted && unread.has(entry.clientId)) return []
      return [{ entry, outcome }]
    })
    if (settled.length === 0) return

    const done: string[] = []
    const nowFailed: string[] = []

    for (const { entry, outcome } of settled) {
      if (handled.current.has(entry.clientId)) continue
      handled.current.add(entry.clientId)
      done.push(entry.clientId)

      if (outcome.outcome === EStagedOutcome.Discarded) {
        restore.current({ text: entry.text, attachments: entry.attachments, reason: undefined })
        continue
      }
      if (outcome.outcome !== EStagedOutcome.Refused) continue
      if (outcome.reason === ALREADY_SENT_REASON) continue

      nowFailed.push(entry.clientId)
      restore.current({
        text: entry.text,
        attachments: entry.attachments,
        reason: outcome.reason,
      })
    }

    if (nowFailed.length > 0) {
      const added = settled.filter(({ entry }) => nowFailed.includes(entry.clientId))
      setRefused((current) => [...current, ...added.map(({ entry }) => entry)])
    }
    if (done.length > 0) settle(new Set(done))
  }, [outcomes, settle, staged, unread])

  const placement = useMemo(
    () => stagedPlacementOf({ staged, events, working }),
    [staged, events, working],
  )

  return {
    staged,
    queue: placement.queue,
    transcript: placement.transcript,
    refused,
    stage,
    settle,
    withdraw,
  }
}
