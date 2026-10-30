'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Spinner } from '@dltech/atlas-ui/components/spinner'

import { clearCloudCache } from '@/lib/query-client'

import { FormError } from './auth-controls'
import { AuthHeading } from './auth-heading'
import { DESKTOP_POLL_MS, EDesktopSignInPhase, useDesktopSignIn } from './use-desktop-sign-in'

const FAILURE_COPY: Partial<Record<EDesktopSignInPhase, string>> = {
  [EDesktopSignInPhase.Expired]: 'Sign-in timed out',
  [EDesktopSignInPhase.Denied]: 'Sign-in denied',
  [EDesktopSignInPhase.Failed]: 'Could not start sign-in',
}

function WaitingCard({ onRetry, onCancel }: { onRetry: () => void; onCancel: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-4 text-sm shadow-lg"
    >
      <p className="flex items-center gap-2 text-foreground">
        <Spinner />
        Finish signing in in your browser
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Reopen browser
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function DesktopSignIn({
  title,
  description,
  next,
  pollMs = DESKTOP_POLL_MS,
  children,
}: {
  title: ReactNode
  description: ReactNode
  next: string | null
  pollMs?: number
  children?: ReactNode
}) {
  const router = useRouter()
  const { phase, start, cancel } = useDesktopSignIn({
    onSignedIn: () => {
      clearCloudCache()
      router.replace(next ?? '/threads')
    },
    pollMs,
  })
  const pending = phase === EDesktopSignInPhase.Pending
  const failure = FAILURE_COPY[phase]

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading title={title} description={description} />
      <div className="flex flex-col gap-4">
        {failure !== undefined && <FormError>{failure}</FormError>}
        {pending && <WaitingCard onRetry={() => void start()} onCancel={cancel} />}
        {!pending && (
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={phase === EDesktopSignInPhase.Starting}
            onClick={() => void start()}
          >
            {phase === EDesktopSignInPhase.Starting && <Spinner data-icon="inline-start" />}
            {failure === undefined ? 'Continue in browser' : 'Try again'}
          </Button>
        )}
      </div>
      {children}
    </div>
  )
}
