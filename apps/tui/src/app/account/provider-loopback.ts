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

import type { LoopbackCopy } from '../browser-return/loopback-page'
import {
  startLoopbackListener,
  type LoopbackAccepted,
  type LoopbackListener,
  type LoopbackListenerSpec,
} from '../browser-return/loopback-server'

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
  port: number
  redirectUri: string
  authorizeUrl: string
  done: Promise<ProviderLoopbackDone | undefined>
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
}): Promise<ProviderLoopback> => {
  const shape = providerLoopbackOf(args.provider)
  if (shape === undefined) throw new Error(`no loopback for ${args.provider}`)

  const held: { state: string | undefined } = { state: undefined }
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

  const redirectUri = shape.redirectUriOf(listener.port)
  let begun: ProviderSignInLoopbackBegin
  try {
    begun = await args.begin({ redirectUri })
  } catch (error) {
    listener.stop()
    throw error
  }
  held.state = begun.state

  let launched: unknown
  try {
    launched = args.open(begun.authorizeUrl)
  } catch {
    listener.stop()
  }

  void Promise.resolve(launched).then(
    (started) => {
      if (started === false) listener.stop()
    },
    () => listener.stop(),
  )

  const done = listener.outcome.then((returned) =>
    returned === undefined || 'error' in returned
      ? undefined
      : { attemptId: begun.attemptId, code: returned.code },
  )

  return {
    port: listener.port,
    redirectUri,
    authorizeUrl: begun.authorizeUrl,
    done,
    stop: listener.stop,
  }
}
