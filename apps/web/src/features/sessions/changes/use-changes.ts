'use client'

import type { SessionChangesOutput } from '@dltech/atlas-protocol'
import { useEffect, useState } from 'react'

import { CloudApiError } from '@/lib/cloud-api'

import { fetchChanges } from './changes-api'

export const REFETCH_DEBOUNCE_MS = 300

export type CheckoutChanges = SessionChangesOutput['checkouts'][number]

export type ChangesState =
  | { status: 'loading' }
  | { status: 'ready'; checkouts: CheckoutChanges[] }
  | { status: 'failed'; message: string; unavailable: boolean }

export const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : 'changes could not be read'

export const unavailableOf = (failure: unknown): boolean =>
  failure instanceof CloudApiError && failure.status === 503

export function useChanges(args: { sessionId: string; signal: string }): ChangesState {
  const [state, setState] = useState<ChangesState>({ status: 'loading' })
  const [mountSignal] = useState(args.signal)
  useEffect(() => {
    let live = true
    const delay = args.signal === mountSignal ? 0 : REFETCH_DEBOUNCE_MS
    const timer = setTimeout(() => {
      void fetchChanges({ sessionId: args.sessionId }).then(
        (output) => {
          if (live) setState({ status: 'ready', checkouts: output.checkouts })
        },
        (failure: unknown) => {
          if (!live) return
          const failed: ChangesState = {
            status: 'failed',
            message: messageOf(failure),
            unavailable: unavailableOf(failure),
          }
          setState((current) => (current.status === 'ready' ? current : failed))
        },
      )
    }, delay)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [args.sessionId, args.signal, mountSignal])
  return state
}
