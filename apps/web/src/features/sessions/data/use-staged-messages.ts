import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { Attachment } from '@dltech/atlas-core'
import {
  EStagedOutcome,
  stagedOutcomesOf,
  stagedPlacementOf,
  type SessionSnapshot,
} from '@dltech/atlas-client/stream'

import { mergeWithdrawnIntoDraft, type StagedMessage } from './queued-messages'

export type StagedDraft = StagedMessage & { attachments: readonly Attachment[] }

export function useStagedMessages(args: {
  events: SessionSnapshot['events']
  working: boolean
  draft: string
  onDraftChange: (draft: string) => void
}) {
  const { events, working, draft, onDraftChange } = args
  const [staged, setStaged] = useState<readonly StagedMessage[]>([])
  const handled = useRef<ReadonlySet<string>>(new Set())
  const draftRef = useRef(draft)
  draftRef.current = draft
  const changeRef = useRef(onDraftChange)
  changeRef.current = onDraftChange

  const stage = useCallback((message: StagedDraft) => {
    setStaged((current) => [...current, message])
  }, [])

  const outcomes = useMemo(
    () => stagedOutcomesOf({ events, clientIds: staged.map((entry) => entry.clientId) }),
    [events, staged],
  )

  useEffect(() => {
    if (staged.length === 0) return
    const settled = staged.flatMap((entry) => {
      const outcome = outcomes.get(entry.clientId)
      if (outcome === undefined || outcome.outcome === EStagedOutcome.Pending) return []
      return [{ entry, outcome }]
    })
    if (settled.length === 0) return
    for (const { entry, outcome } of settled) {
      if (handled.current.has(entry.clientId)) continue
      handled.current = new Set([...handled.current, entry.clientId])
      if (outcome.outcome !== EStagedOutcome.Refused) continue
      if (outcome.reason === 'already-sent') {
        toast.error('Already sent')
        continue
      }
      changeRef.current(mergeWithdrawnIntoDraft({ withdrawn: entry.text, draft: draftRef.current }))
      if (outcome.reason !== undefined) toast.error(outcome.reason)
    }
    setStaged((current) =>
      current.filter((entry) => !settled.some((settledOne) => settledOne.entry === entry)),
    )
  }, [outcomes, staged])

  const placement = useMemo(
    () => stagedPlacementOf({ staged, events, working }),
    [staged, events, working],
  )

  return { staged, queue: placement.queue, transcript: placement.transcript, stage }
}
