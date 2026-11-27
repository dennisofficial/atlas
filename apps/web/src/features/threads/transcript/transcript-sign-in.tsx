'use client'

import { EMcpSignInSurface, signInUrlFor } from '@dltech/atlas-plugin-mcp/core'
import { CircleCheckIcon, CircleXIcon, LogInIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Trace,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@dltech/atlas-ui/components/trace'

import { isDesktopHost } from '@/features/desktop/desktop-attributes'

import type { SignInItem } from '../data/transcript-items'

const NEW_TAB = 'opens in a new tab'

const surfaceOfHost = (): EMcpSignInSurface =>
  typeof window !== 'undefined' && isDesktopHost(window)
    ? EMcpSignInSurface.Desktop
    : EMcpSignInSurface.Web

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
          render={
            <a
              href={signInUrlFor({ url: item.url, surface: surfaceOfHost() })}
              target="_blank"
              rel="noreferrer"
            />
          }
        >
          Sign in
        </Button>
      </TraceLine>
    </Trace>
  )
}
