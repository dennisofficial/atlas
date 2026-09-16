'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import {
  actOnDevice,
  AuthApiError,
  claimDeviceCode,
  normalizeUserCode,
  sessionUserPresent,
  type DeviceAction,
} from '../../lib/auth-api'

enum EDeviceStep {
  Loading = 'loading',
  Ready = 'ready',
  Done = 'done',
  Failed = 'failed',
}

const messageOf = (cause: unknown, fallback: string): string =>
  cause instanceof AuthApiError ? cause.message : fallback

export function DeviceAuthorizer() {
  const searchParams = useSearchParams()
  const userCode = normalizeUserCode(searchParams.get('user_code'))

  const [step, setStep] = useState<EDeviceStep>(EDeviceStep.Loading)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<DeviceAction | null>(null)

  useEffect(() => {
    let cancelled = false

    const claim = async () => {
      try {
        if (!(await sessionUserPresent())) {
          const next = encodeURIComponent(`/device?user_code=${userCode}`)
          window.location.assign(`/sign-in?next=${next}`)
          return
        }
        await claimDeviceCode(userCode)
        if (!cancelled) setStep(EDeviceStep.Ready)
      } catch (cause) {
        if (cancelled) return
        setError(messageOf(cause, 'Unknown or expired device code'))
        setStep(EDeviceStep.Failed)
      }
    }

    void claim()
    return () => {
      cancelled = true
    }
  }, [userCode])

  const handleAct = async (action: DeviceAction) => {
    try {
      await actOnDevice({ action, userCode })
      setOutcome(action)
      setStep(EDeviceStep.Done)
    } catch (cause) {
      setError(messageOf(cause, 'Request failed'))
    }
  }

  return (
    <>
      <h1>Authorize a device</h1>

      {step === EDeviceStep.Loading && <p className="muted">Loading…</p>}

      {step === EDeviceStep.Ready && (
        <>
          <p className="muted">
            A device is asking to sign in to your Atlas account. Confirm the code matches what the
            device shows.
          </p>
          <p className="code">{userCode}</p>
          <button onClick={() => void handleAct('approve')}>Approve</button>
          <button className="deny" onClick={() => void handleAct('deny')}>
            Deny
          </button>
        </>
      )}

      {step === EDeviceStep.Done && (
        <p>
          {outcome === 'approve'
            ? 'Device authorized — you can return to your terminal.'
            : 'Device denied.'}
        </p>
      )}

      {error !== null && <p className="error">{error}</p>}
    </>
  )
}
