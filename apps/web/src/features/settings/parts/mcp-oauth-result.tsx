'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { type ReturnOutcome } from '@dltech/atlas-core'

import { useReturnOutcome } from '@/features/auth/browser-return'

import { mcpResultMessageOf } from '../data/shared/mcp-oauth'
import {
  markMcpSignInShown,
  mcpSignInsAwaitingResult,
  type McpSignInAttempt,
} from '../data/shared/mcp-signin-attempts'

const resultKeyOf = (outcome: ReturnOutcome | undefined): string | undefined =>
  outcome === undefined ? undefined : `${outcome.result}:${outcome.reason ?? ''}`

function McpSignInMessage(props: { attempt: McpSignInAttempt; reload: () => void }) {
  const outcome = useReturnOutcome({ state: props.attempt.state, durable: undefined })
  const shown = useRef<string | undefined>(undefined)
  const key = resultKeyOf(outcome)

  useEffect(() => {
    if (outcome === undefined || key === undefined || shown.current === key) return
    shown.current = key
    const message = mcpResultMessageOf({ label: props.attempt.label, outcome })
    if (message.ok) toast.success(message.message)
    else toast.error(message.message)
    markMcpSignInShown(props.attempt.state)
    props.reload()
  }, [outcome, key, props.attempt.label, props.attempt.state, props.reload])

  return null
}

export function McpOauthResult({ owner, reload }: { owner: string; reload: () => void }) {
  const attempts = mcpSignInsAwaitingResult(owner)
  return (
    <>
      {attempts.map((attempt) => (
        <McpSignInMessage key={attempt.state} attempt={attempt} reload={reload} />
      ))}
    </>
  )
}
