'use client'

import { Button } from '@dltech/atlas-ui/button'
import { Card } from '@dltech/atlas-ui/card'
import { Spinner } from '@dltech/atlas-ui/spinner'
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
    <Card title="Authorize a device" subtitle="Confirm the code matches what your terminal shows">
      {step === EDeviceStep.Loading && (
        <p className="flex items-center gap-2 text-sm text-meta">
          <Spinner /> Checking the device code…
        </p>
      )}

      {step === EDeviceStep.Ready && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-meta">
            A device is asking to sign in to your Atlas account. Confirm the code matches what the
            device shows.
          </p>
          <p className="text-center font-mono text-md tracking-[0.3em] text-foreground">
            {userCode}
          </p>
          <div className="flex gap-2">
            <Button variant="primary" fullWidth onClick={() => void handleAct('approve')}>
              Approve
            </Button>
            <Button variant="destructive" fullWidth onClick={() => void handleAct('deny')}>
              Deny
            </Button>
          </div>
        </div>
      )}

      {step === EDeviceStep.Done && (
        <p className="text-sm text-foreground">
          {outcome === 'approve'
            ? 'Device authorized — you can return to your terminal.'
            : 'Device denied.'}
        </p>
      )}

      {error !== null && <p className="mt-4 text-xs text-destructive">{error}</p>}
    </Card>
  )
}
