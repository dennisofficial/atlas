import { skipToken, useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState } from 'react'

import {
  accountAccessOf,
  EAccountAccess,
  controlFailureNoteOf,
  controlOutcomeNoteOf,
  type AccountAccess,
  type ControlOutcomeNote,
} from '@dltech/atlas-client/transcript'
import { EAvailabilityControlResult, type WaitingForModel } from '@dltech/atlas-core'
import { EAvailabilityControl } from '@dltech/atlas-wire/web'

import {
  controlCloudAvailability,
  ECloudControlOutcome,
  type CloudAvailabilityControl,
} from '@/features/threads/data/model-availability-api'
import { waitingOfSessions } from '@/features/threads/data/waiting-of-sessions'
import type { ProjectThreads } from '@/features/shell/thread-partition'
import { SHELL_THREADS_KEY } from '@/lib/cloud-keys'

type ShellThreadsBox = { value: { entries: ProjectThreads[] } }

export type AccountAvailabilityView = {
  access: AccountAccess
  pending: boolean
  note: ControlOutcomeNote | null
  onPause: (() => void) | null
  onRemovePause: (() => void) | null
}

export function useAccountAvailability(args: {
  reload: () => void
  control?: CloudAvailabilityControl
}): (accountId: string) => AccountAvailabilityView {
  const control = args.control ?? controlCloudAvailability
  const { reload } = args
  const query = useQuery<ShellThreadsBox>({ queryKey: [SHELL_THREADS_KEY], queryFn: skipToken })
  const waiting = useMemo<readonly WaitingForModel[]>(
    () => waitingOfSessions(query.data?.value.entries ?? []),
    [query.data],
  )
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const [notes, setNotes] = useState<ReadonlyMap<string, ControlOutcomeNote>>(new Map())
  const guard = useRef<Set<string>>(new Set())

  const run = useCallback(
    (args: { accountId: string; access: AccountAccess; action: EAvailabilityControl }) => {
      const { accountId, access, action } = args
      if (guard.current.has(accountId) || access.key === null || access.generation === null) return
      guard.current.add(accountId)
      setPendingIds(new Set(guard.current))
      const { key, generation } = access
      void control({ key, expectedGeneration: generation, action })
        .then((outcome) => {
          const stale = outcome === ECloudControlOutcome.Stale
          const note = controlOutcomeNoteOf(
            stale ? EAvailabilityControlResult.Stale : EAvailabilityControlResult.Applied,
          )
          setNotes((prior) => new Map(prior).set(accountId, note))
          if (stale) reload()
        })
        .catch((failure: unknown) => {
          setNotes((prior) => new Map(prior).set(accountId, controlFailureNoteOf(failure)))
        })
        .finally(() => {
          guard.current.delete(accountId)
          setPendingIds(new Set(guard.current))
        })
    },
    [control, reload],
  )

  return useCallback(
    (accountId) => {
      const access = accountAccessOf({ accountId, waiting })
      const controllable = access.key !== null
      return {
        access,
        pending: pendingIds.has(accountId),
        note: notes.get(accountId) ?? null,
        onPause:
          controllable && access.access !== EAccountAccess.Paused
            ? () => run({ accountId, access, action: EAvailabilityControl.Pause })
            : null,
        onRemovePause:
          controllable && access.access === EAccountAccess.Paused
            ? () => run({ accountId, access, action: EAvailabilityControl.Resume })
            : null,
      }
    },
    [waiting, pendingIds, notes, run],
  )
}
