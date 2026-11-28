import {
  ANTHROPIC_LOOPBACK_PATH,
  EAuthProvider,
  EReturnResult,
  OPENAI_LOOPBACK_PATH,
  OPENAI_LOOPBACK_PORTS,
  PROVIDER_LOOPBACK_HOSTS,
  anthropicLoopbackRedirectUriOf,
  openaiLoopbackRedirectUriOf,
  parsedUrlOf,
} from '@dltech/atlas-core'

import type { LoopbackCopy } from './loopback-page'
import {
  startLoopbackListener,
  type LoopbackAccepted,
  type LoopbackListener,
  type LoopbackListenerSpec,
} from './loopback-server'

export type ProviderLoopbackShape = {
  ports: readonly number[]
  redirectUriOf: (port: number) => string
  path: string
  label: string
}

export type ProviderSignInLoopbackBegin = {
  attemptId: string
  authorizeUrl: string
  state: string
}

export type ProviderLoopbackReturn = { code: string } | { error: string }

export type ProviderLoopbackDone = { attemptId: string; code: string }

export type ProviderLoopback = {
  attemptId: string
  port: number
  redirectUri: string
  authorizeUrl: string
  done: Promise<ProviderLoopbackDone | undefined>
  outcome: Promise<ProviderLoopbackReturn | undefined>
  stop: () => void
}

const SHAPES: Partial<Record<EAuthProvider, ProviderLoopbackShape>> = {
  [EAuthProvider.Anthropic]: {
    ports: [0],
    redirectUriOf: anthropicLoopbackRedirectUriOf,
    path: ANTHROPIC_LOOPBACK_PATH,
    label: 'Claude',
  },
  [EAuthProvider.OpenAI]: {
    ports: OPENAI_LOOPBACK_PORTS,
    redirectUriOf: openaiLoopbackRedirectUriOf,
    path: OPENAI_LOOPBACK_PATH,
    label: 'ChatGPT',
  },
}

export const providerLoopbackOf = (provider: EAuthProvider): ProviderLoopbackShape | undefined =>
  SHAPES[provider]

export const providerLoopbackCopyOf = (shape: ProviderLoopbackShape): LoopbackCopy => ({
  connected: `Signed in to ${shape.label}.`,
  failed: (reason) =>
    `Sign-in to ${shape.label} failed: ${reason ?? 'the browser did not come back with a code'}`,
})

export const providerReturnOf = (args: {
  url: string
  state: string
}): LoopbackAccepted<ProviderLoopbackReturn> | undefined => {
  const parsed = parsedUrlOf(args.url)
  if (parsed === undefined || parsed.searchParams.get('state') !== args.state) return undefined

  const error = parsed.searchParams.get('error')
  if (error !== null && error !== '')
    return {
      page: { result: EReturnResult.Failed, reason: error },
      value: { error },
    }

  const code = parsed.searchParams.get('code')
  if (code === null || code === '') return undefined
  return { page: { result: EReturnResult.Connected }, value: { code } }
}

const bindOnFreePort = <T>(args: {
  spec: LoopbackListenerSpec<T>
  copy: LoopbackCopy
  ports: readonly number[]
  timeoutMs?: number | undefined
}): LoopbackListener<T> => {
  let refused: unknown
  for (const port of args.ports) {
    try {
      return startLoopbackListener({
        spec: args.spec,
        copy: args.copy,
        port,
        ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
      })
    } catch (error) {
      refused = error
    }
  }
  throw refused ?? new Error('no loopback port was free')
}

export const startProviderLoopback = async (args: {
  provider: EAuthProvider
  begin: (args: { redirectUri: string }) => Promise<ProviderSignInLoopbackBegin>
  open: (url: string) => unknown
  ports?: readonly number[] | undefined
  timeoutMs?: number | undefined
  signal?: AbortSignal | undefined
}): Promise<ProviderLoopback> => {
  const isCancelled = () => args.signal?.aborted === true
  if (isCancelled()) throw new Error('the sign-in was cancelled')
  const shape = providerLoopbackOf(args.provider)
  if (shape === undefined) throw new Error(`no loopback for ${args.provider}`)

  const held: { state: string | undefined; closed: boolean } = { state: undefined, closed: false }
  const listener = bindOnFreePort({
    copy: providerLoopbackCopyOf(shape),
    ports: args.ports ?? shape.ports,
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
    spec: {
      path: shape.path,
      hosts: PROVIDER_LOOPBACK_HOSTS,
      readReturn: (url) => {
        const state = held.state
        if (state === undefined) return undefined
        return providerReturnOf({ url, state })
      },
    },
  })

  const handleAbort = () => listener.stop()
  args.signal?.addEventListener('abort', handleAbort, { once: true })
  void listener.outcome.then(() => {
    held.closed = true
    args.signal?.removeEventListener('abort', handleAbort)
  })
  const redirectUri = shape.redirectUriOf(listener.port)
  let begun: ProviderSignInLoopbackBegin
  try {
    begun = await args.begin({ redirectUri })
    if (isCancelled()) throw new Error('the sign-in was cancelled')
    if (held.closed) throw new Error('the sign-in listener stopped')
    held.state = begun.state
    const launched = await args.open(begun.authorizeUrl)
    if (launched === false) throw new Error('the browser could not open')
    if (isCancelled()) throw new Error('the sign-in was cancelled')
  } catch (error) {
    listener.stop()
    throw error
  }

  const done = listener.outcome.then((returned) =>
    returned === undefined || 'error' in returned
      ? undefined
      : { attemptId: begun.attemptId, code: returned.code },
  )

  return {
    attemptId: begun.attemptId,
    port: listener.port,
    outcome: listener.outcome,
    redirectUri,
    authorizeUrl: begun.authorizeUrl,
    done,
    stop: listener.stop,
  }
}
