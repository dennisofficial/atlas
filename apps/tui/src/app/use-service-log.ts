import { useEffect, useState } from 'react'

import type { SessionApi } from './session-api'
import { unavailableOf } from './use-changes'

export const SERVICE_LOG_POLL_MS = 2_000

export const POD_ASLEEP = 'The pod is asleep. Wake it to read the log.'

export const LOG_UNAVAILABLE = 'The log is unavailable.'

export type ServiceLogState =
  | { status: 'idle' }
  | { status: 'ready'; text: string }
  | { status: 'failed'; asleep: boolean }

export const serviceLogText = (state: ServiceLogState): string => {
  if (state.status === 'ready') return state.text
  if (state.status === 'failed') return state.asleep ? POD_ASLEEP : LOG_UNAVAILABLE
  return ''
}

export function useServiceLog(args: {
  api: SessionApi
  sessionId: string
  serviceId: string | undefined
  running: boolean
}): ServiceLogState {
  const { api, sessionId, serviceId, running } = args
  const [state, setState] = useState<ServiceLogState>({ status: 'idle' })

  useEffect(() => {
    if (serviceId === undefined) {
      setState({ status: 'idle' })
      return
    }

    let live = true
    const read = () => {
      void api.logService({ sessionId, serviceId }).then(
        (output) => {
          if (live) setState({ status: 'ready', text: output.text })
        },
        (failure: unknown) => {
          if (live) setState({ status: 'failed', asleep: unavailableOf(failure) })
        },
      )
    }

    read()
    if (!running) {
      return () => {
        live = false
      }
    }

    const timer = setInterval(read, SERVICE_LOG_POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [api, running, serviceId, sessionId])

  return state
}
