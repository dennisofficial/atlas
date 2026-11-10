'use client'

import { CircleCheckIcon, CircleXIcon, LogInIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Trace,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@dltech/atlas-ui/components/trace'

import type { SignInItem } from '../data/transcript-items'

const NEW_TAB = 'opens in a new tab'

export function TranscriptSignIn({ item }: { item: SignInItem }) {
  if (item.result === 'connected')
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

  if (item.result === 'failed')
    return (
      <Trace>
        <TraceLine status="error">
          <TraceIcon>
            <CircleXIcon />
          </TraceIcon>
          <TraceTitle>Could not sign in to {item.subject}</TraceTitle>
          {item.reason === undefined ? null : (
            <TraceDescription className="min-w-0 flex-1 truncate">{item.reason}</TraceDescription>
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
        <Button
          size="xs"
          variant="outline"
          render={<a href={item.url} target="_blank" rel="noreferrer" />}
        >
          Sign in
        </Button>
      </TraceLine>
    </Trace>
  )
}
