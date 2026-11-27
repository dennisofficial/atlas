import React from 'react'

import type { SignInEntry } from '@dltech/atlas-client/transcript'
import { EReturnResult, stateOfStartLink, type ReturnOutcome } from '@dltech/atlas-core'

import { openBrowserReturn } from '../../../app/browser-return/open'
import { useReturnOutcome } from '../../../app/browser-return/use-return-outcome'
import type { LoopbackCopy } from '../../../app/browser-return/loopback-page'
import { createUrlOpener } from '../../../app/open-url'
import { useClickRegion } from '../../hooks/use-click-region'
import { glyph, theme, TRANSCRIPT_INSET } from '../../theme'

const SIGN_IN_LABEL = 'Sign in'

const TRY_AGAIN_LABEL = 'Try again'

const REASON_INDENT = '  '

const durableOutcomeOf = (entry: SignInEntry): ReturnOutcome | undefined => {
  if (entry.result === undefined) return undefined
  if (entry.result === 'connected') return { result: EReturnResult.Connected }
  return entry.reason === undefined
    ? { result: EReturnResult.Failed }
    : { result: EReturnResult.Failed, reason: entry.reason }
}

const copyOf = (server: string): LoopbackCopy => ({
  connected: `Signed in to ${server}`,
  failed: (reason) =>
    reason === undefined
      ? `Could not sign in to ${server}`
      : `Could not sign in to ${server}: ${reason}`,
})

export function SignInCard(props: {
  entry: SignInEntry
  width: number
  onRetry?: ((server: string) => void) | undefined
}): React.ReactNode {
  const { entry } = props
  const server = entry.subject
  const outcome = useReturnOutcome({
    state: stateOfStartLink(entry.url) ?? '',
    durable: durableOutcomeOf(entry),
  })
  const connected = outcome?.result === EReturnResult.Connected
  const failed = outcome?.result === EReturnResult.Failed
  const reason = outcome?.result === EReturnResult.Failed ? outcome.reason : undefined
  const inner = Math.max(1, props.width - TRANSCRIPT_INSET)

  const handleOpen = () => {
    openBrowserReturn({ url: entry.url, open: createUrlOpener(), copy: copyOf(server) })
  }

  const handleRetry = () => {
    props.onRetry?.(server)
  }

  const open = useClickRegion(outcome === undefined ? handleOpen : undefined)
  const retry = useClickRegion(failed && props.onRetry !== undefined ? handleRetry : undefined)

  const marker = connected ? glyph.passed : failed ? glyph.failed : glyph.available
  const mark = connected ? theme.ok : failed ? theme.warn : theme.hint
  const heading = connected ? theme.dim : failed ? theme.warn : theme.meta
  const title = connected
    ? `Signed in to ${server}`
    : failed
      ? `Could not sign in to ${server}`
      : `${server} needs a sign-in`

  return (
    <box flexDirection="column" marginBottom={1} flexShrink={0} width={props.width}>
      <text wrapMode="none" width={inner} flexShrink={0} {...open.handlers} {...open.wash}>
        <span fg={mark}>{`${marker} `}</span>
        <span fg={heading}>{title}</span>
        {outcome === undefined ? <span fg={theme.dim}>{`  ${SIGN_IN_LABEL}`}</span> : null}
      </text>
      {reason === undefined ? null : (
        <text width={inner} flexShrink={0} fg={theme.dim}>{`${REASON_INDENT}${reason}`}</text>
      )}
      {failed && props.onRetry !== undefined ? (
        <text wrapMode="none" width={inner} flexShrink={0} {...retry.handlers} {...retry.wash}>
          <span fg={theme.hint}>{`${REASON_INDENT}${glyph.retry} ${TRY_AGAIN_LABEL}`}</span>
        </text>
      ) : null}
    </box>
  )
}
