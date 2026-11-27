'use client'

import { EReturnResult, stateOfStartLink, type ReturnOutcome } from '@dltech/atlas-core'
import { CircleCheckIcon, CircleXIcon, LogInIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Trace,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@dltech/atlas-ui/components/trace'

import { openBrowserReturn, useReturnOutcome } from '@/features/auth/browser-return'

import type { SignInItem } from '../data/transcript-items'
import { useSignInRetry } from '../sign-in/sign-in-retry'

const NEW_TAB = 'opens in a new tab'

const durableOutcomeOf = (item: SignInItem): ReturnOutcome | undefined => {
  if (item.result === undefined) return undefined
  if (item.result === 'connected') return { result: EReturnResult.Connected }
  return item.reason === undefined
    ? { result: EReturnResult.Failed }
    : { result: EReturnResult.Failed, reason: item.reason }
}

export function TranscriptSignIn({ item }: { item: SignInItem }) {
  const retry = useSignInRetry()
  const outcome = useReturnOutcome({
    state: stateOfStartLink(item.url) ?? '',
    durable: durableOutcomeOf(item),
  })

  const handleSignIn = () => {
    openBrowserReturn({ url: item.url })
  }

  const handleTryAgain = () => {
    if (retry !== null) retry(item.subject)
  }

  if (outcome?.result === EReturnResult.Connected)
    return (
      <Trace>
        <TraceLine>
          <TraceIcon>
            <CircleCheckIcon />
          </TraceIcon>
          <TraceTitle>Signed in to {item.subject}</TraceTitle>
        </TraceLine>
      </Trace>
    )

  if (outcome?.result === EReturnResult.Failed)
    return (
      <Trace>
        <TraceLine status="error">
          <TraceIcon>
            <CircleXIcon />
          </TraceIcon>
          <TraceTitle>Could not sign in to {item.subject}</TraceTitle>
          {outcome.reason === undefined ? null : (
            <TraceDescription className="min-w-0 flex-1 truncate">
              {outcome.reason}
            </TraceDescription>
          )}
          {retry === null ? null : (
            <Button size="xs" variant="outline" onClick={handleTryAgain}>
              Try again
            </Button>
          )}
        </TraceLine>
      </Trace>
    )

  return (
    <Trace>
      <TraceLine>
        <TraceIcon>
          <LogInIcon />
        </TraceIcon>
        <TraceTitle>{item.subject} needs a sign-in</TraceTitle>
        <TraceDescription>{NEW_TAB}</TraceDescription>
        <Button size="xs" variant="outline" onClick={handleSignIn}>
          Sign in
        </Button>
      </TraceLine>
    </Trace>
  )
}
