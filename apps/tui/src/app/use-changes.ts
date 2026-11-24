import { useEffect, useState } from 'react'

import { httpStatusOf } from '@dltech/atlas-api-router'
import type { SessionChangesOutput } from '@dltech/atlas-protocol'

import type { SessionApi } from './session-api'

export const REFETCH_DEBOUNCE_MS = 300

export type ChangesState =
  | { status: 'idle' }
  | { status: 'ready'; checkouts: SessionChangesOutput['checkouts'] }
  | { status: 'failed'; unavailable: boolean }

export const unavailableOf = (failure: unknown): boolean =>
  httpStatusOf(failure) === 503 || plainStatusOf(failure) === 503

const plainStatusOf = (failure: unknown): number | undefined => {
  if (!(failure instanceof Error) || !('status' in failure)) return undefined
  const status: unknown = failure.status
  return typeof status === 'number' ? status : undefined
}

const failedOf = (failure: unknown): ChangesState => ({
  status: 'failed',
  unavailable: unavailableOf(failure),
})

export function useChanges(args: {
  api: SessionApi
  sessionId: string
  working: boolean
}): ChangesState {
  const { api, sessionId, working } = args
  const [state, setState] = useState<ChangesState>({ status: 'idle' })
  const [reads, setReads] = useState(0)
  const [wasWorking, setWasWorking] = useState(working)

  if (wasWorking !== working) {
    setWasWorking(working)
    if (wasWorking && !working) setReads((count) => count + 1)
  }

  useEffect(() => {
    let live = true
    const delay = reads === 0 ? 0 : REFETCH_DEBOUNCE_MS
    const timer = setTimeout(() => {
      void api.changes({ sessionId }).then(
        (output) => {
          if (live) setState({ status: 'ready', checkouts: output.checkouts })
        },
        (failure: unknown) => {
          if (!live) return
          setState((current) => (current.status === 'ready' ? current : failedOf(failure)))
        },
      )
    }, delay)

    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [api, reads, sessionId])

  return state
}
