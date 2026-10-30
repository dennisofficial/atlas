'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Spinner } from '@dltech/atlas-ui/components/spinner'

import { formatUserCode } from '@/lib/auth-api'

import { FormError } from './auth-controls'
import { AuthHeading } from './auth-heading'
import { DESKTOP_POLL_MS, EDesktopSignInPhase, useDesktopSignIn } from './use-desktop-sign-in'

const FAILURE_COPY: Partial<Record<EDesktopSignInPhase, string>> = {
  [EDesktopSignInPhase.Expired]: 'Code expired',
  [EDesktopSignInPhase.Denied]: 'Sign-in denied',
  [EDesktopSignInPhase.Failed]: 'Could not start sign-in',
}

function CodeCard({ code }: { code: string }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-4 font-mono text-sm shadow-lg"
    >
      <p className="text-muted-foreground">Enter this code in your browser</p>
      <p className="text-xl font-medium tracking-[0.12em] text-foreground">{code}</p>
      <p className="flex items-center gap-2 text-muted-foreground">
        <Spinner />
        Waiting for approval
      </p>
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
  const { phase, userCode, start } = useDesktopSignIn({
    onSignedIn: () => router.replace(next ?? '/threads'),
    pollMs,
  })
  const pending = phase === EDesktopSignInPhase.Pending
  const failure = FAILURE_COPY[phase]

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading title={title} description={description} />
      <div className="flex flex-col gap-4">
        {failure !== undefined && <FormError>{failure}</FormError>}
        {pending && <CodeCard code={formatUserCode(userCode)} />}
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
