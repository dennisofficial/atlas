import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Attachment, V2Event } from '@dltech/atlas-core'
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
  failed: ReadonlySet<string>
  stage: (message: StagedMessage) => void
  settle: (clientIds: ReadonlySet<string>) => void
  withdraw: (clientId: string) => StagedMessage | null
}

export function useStagedMessages(args: {
  sessionId: string
  events: readonly V2Event[]
  working: boolean
  onRestore: (args: { text: string; reason: string | undefined }) => void
}): StagedState {
  const { sessionId, events, working } = args
  const held = useRef(new Map<string, readonly StagedMessage[]>())
  const [staged, setStaged] = useState<readonly StagedMessage[]>(() => [])
  const handled = useRef(new Set<string>())
  const failed = useRef(new Set<string>())
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(() => new Set<string>())
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
    failed.current = new Set()
    setFailedIds(new Set())
    setStaged(held.current.get(sessionId) ?? [])
  }, [sessionId])

  const stage = useCallback(
    (message: StagedMessage) => {
      put([...(held.current.get(sessionId) ?? []), message])
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

  useEffect(() => {
    if (staged.length === 0) return

    const settled = staged.flatMap((entry) => {
      const outcome = outcomes.get(entry.clientId)
      if (outcome === undefined) return []
      if (outcome.outcome === EStagedOutcome.Pending) return []
      return [{ entry, outcome }]
    })
    if (settled.length === 0) return

    const done: string[] = []
    const nowFailed: string[] = []

    for (const { entry, outcome } of settled) {
      if (handled.current.has(entry.clientId)) continue
      handled.current.add(entry.clientId)
      done.push(entry.clientId)

      if (outcome.outcome !== EStagedOutcome.Refused) continue
      if (outcome.reason === ALREADY_SENT_REASON) continue

      nowFailed.push(entry.clientId)
      restore.current({ text: entry.text, reason: outcome.reason })
    }

    if (nowFailed.length > 0) {
      failed.current = new Set([...failed.current, ...nowFailed])
      setFailedIds(new Set(failed.current))
    }
    if (done.length > 0) settle(new Set(done))
  }, [outcomes, settle, staged])

  const placement = useMemo(
    () => stagedPlacementOf({ staged, events, working }),
    [staged, events, working],
  )

  return {
    staged,
    queue: placement.queue,
    transcript: placement.transcript,
    failed: failedIds,
    stage,
    settle,
    withdraw,
  }
}
