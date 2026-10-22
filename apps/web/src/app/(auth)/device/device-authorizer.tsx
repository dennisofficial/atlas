'use client'

import { Alert, AlertDescription } from '@dltech/atlas-ui/components/alert'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@dltech/atlas-ui/components/card'
import { Spinner } from '@dltech/atlas-ui/components/spinner'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import {
  actOnDevice,
  AuthApiError,
  claimDeviceCode,
  normalizeUserCode,
  sessionUserPresent,
  type DeviceAction,
} from '@/lib/auth-api'

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
    <Card>
      <CardHeader>
        <CardTitle>Authorize a device</CardTitle>
        <CardDescription>Confirm the code matches what your terminal shows</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {step === EDeviceStep.Loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Checking the device code…
          </p>
        )}

        {step === EDeviceStep.Ready && (
          <>
            <p className="text-sm text-muted-foreground">
              A device is asking to sign in to your Atlas account. Confirm the code matches what the
              device shows.
            </p>
            <p
              aria-label="Device code"
              className="rounded-lg border bg-muted px-4 py-3 text-center font-mono text-2xl font-medium tracking-widest text-foreground"
            >
              {userCode}
            </p>
            <div className="flex flex-col gap-2">
              <Button size="lg" onClick={() => void handleAct('approve')}>
                Approve
              </Button>
              <Button variant="outline" size="lg" onClick={() => void handleAct('deny')}>
                Deny
              </Button>
            </div>
          </>
        )}

        {step === EDeviceStep.Done && (
          <p className="text-sm text-foreground">
            {outcome === 'approve'
              ? 'Device authorized — you can return to your terminal.'
              : 'Device denied.'}
          </p>
        )}

        {error !== null && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
