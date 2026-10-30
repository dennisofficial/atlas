'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { EFailureAction, EFailureStatus, inFlight, type FailureScenario } from './scenarios'

const RUN_MS = 1800

export interface FailureCardProps {
  scenario: FailureScenario
  status: EFailureStatus
  onAction: (action: EFailureAction) => void
  onDismiss: () => void
}

const TOASTS: Partial<Record<EFailureAction, string>> = {
  [EFailureAction.Settings]: 'Would open Settings → Providers',
  [EFailureAction.SwitchModel]: 'Would open the model picker',
  [EFailureAction.OpenAgent]: 'Would open the agent in the Details panel',
}

export function useFailureState(scenario: FailureScenario) {
  const [status, setStatus] = useState(EFailureStatus.Failed)

  useEffect(() => {
    if (!inFlight(status)) return
    const timer = setTimeout(() => {
      setStatus(EFailureStatus.Recovered)
      toast.success('Run finished')
    }, RUN_MS)
    return () => clearTimeout(timer)
  }, [status])

  const handleAction = (action: EFailureAction) => {
    if (inFlight(status)) return
    if (action === EFailureAction.Retry) {
      if (scenario.busy) return
      toast('Retrying on the existing log, no new message')
      setStatus(EFailureStatus.Retrying)
      return
    }
    if (action === EFailureAction.Resume) {
      toast('Resume draft appended, running')
      setStatus(EFailureStatus.Resuming)
      return
    }
    const message = TOASTS[action]
    if (message !== undefined) toast(message)
  }

  const handleDismiss = () => {
    toast('Failure dismissed')
    setStatus(EFailureStatus.Dismissed)
  }

  return { status, handleAction, handleDismiss }
}
