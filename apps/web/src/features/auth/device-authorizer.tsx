'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import {
  actOnDevice,
  AuthApiError,
  claimDeviceCode,
  formatUserCode,
  normalizeUserCode,
  sessionUser,
  signOut,
  type DeviceAction,
} from '@/lib/auth-api'
import { clearCloudCache } from '@/lib/query-client'

import { DeviceConfirm } from './device-confirm'
import { DeviceEnterForm } from './device-enter-form'
import { DeviceResult, EDeviceResult } from './device-result'
import { DeviceConfirmSkeleton } from './auth-flow-skeletons'

enum EDeviceStep {
  Checking = 'checking',
  Ready = 'ready',
  Done = 'done',
  Expired = 'expired',
}

const messageOf = (cause: unknown, fallback: string): string =>
  cause instanceof AuthApiError ? cause.message : fallback

function DeviceFlow({ userCode }: { userCode: string }) {
  const router = useRouter()
  const display = formatUserCode(userCode)
  const returnPath = `/device?user_code=${display}`
  const [step, setStep] = useState(EDeviceStep.Checking)
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState<DeviceAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<DeviceAction | null>(null)

  useEffect(() => {
    let cancelled = false

    const claim = async () => {
      try {
        const user = await sessionUser()
        if (user === null) {
          router.replace(`/sign-in?next=${encodeURIComponent(returnPath)}`)
          return
        }
        await claimDeviceCode(userCode)
        if (cancelled) return
        setEmail(user.email)
        setStep(EDeviceStep.Ready)
      } catch {
        if (!cancelled) setStep(EDeviceStep.Expired)
      }
    }

    void claim()
    return () => {
      cancelled = true
    }
  }, [userCode, returnPath, router])

  const handleAct = async (action: DeviceAction) => {
    setPending(action)
    setError(null)
    try {
      await actOnDevice({ action, userCode })
      setOutcome(action)
      setStep(EDeviceStep.Done)
    } catch (cause) {
      setError(messageOf(cause, 'Request failed'))
    } finally {
      setPending(null)
    }
  }

  const handleSwitchAccount = async () => {
    await signOut().catch(() => undefined)
    clearCloudCache()
    router.replace(`/sign-in?next=${encodeURIComponent(returnPath)}`)
  }

  if (step === EDeviceStep.Checking) return <DeviceConfirmSkeleton />
  if (step === EDeviceStep.Expired) return <DeviceResult result={EDeviceResult.Expired} />
  if (step === EDeviceStep.Done) {
    return (
      <DeviceResult
        result={outcome === 'approve' ? EDeviceResult.Approved : EDeviceResult.Denied}
      />
    )
  }

  return (
    <DeviceConfirm
      code={display}
      email={email}
      pending={pending}
      error={error}
      onAct={(action) => void handleAct(action)}
      onSwitchAccount={() => void handleSwitchAccount()}
    />
  )
}

export function DeviceAuthorizer() {
  const userCode = normalizeUserCode(useSearchParams().get('user_code'))
  if (userCode.length === 0) return <DeviceEnterForm />
  return <DeviceFlow userCode={userCode} />
}
