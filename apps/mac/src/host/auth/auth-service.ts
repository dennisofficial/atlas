import { createApiClient } from '@dltech/atlas-api-router'
import { z } from 'zod'
import { createPkcePair, type IPkcePair } from './pkce'
import { createTokenStore, type ITokenStore } from './token-store'

export type TAuthState = 'idle' | 'pending' | 'signed-in' | 'expired' | 'denied'

export interface IAuthStatus {
  state: TAuthState
  email?: string
}

export enum ECallbackOutcome {
  SignedIn = 'signed-in',
  Rejected = 'rejected',
}

export interface IAuthService {
  start: () => { authorizeUrl: string }
  callback: (url: URL) => Promise<ECallbackOutcome>
  status: () => IAuthStatus
  signOut: () => Promise<void>
  token: () => string | undefined
  adopt: (token: string) => Promise<void>
}

export interface IAuthConfig {
  home: string
  openExternal?: (url: string) => boolean
  now?: () => number
  store?: ITokenStore
  webOrigin?: string
}

export const CALLBACK_PATH = '/desktop/auth/callback'
export const PENDING_TTL_MS = 5 * 60_000
const sessionSchema = z.object({ user: z.object({ email: z.string() }) })

interface IPending extends IPkcePair {
  redirectUri: string
  deadline: number
}

export function createAuthService({
  config,
  apiOrigin,
  webOrigin,
  port,
}: {
  config: IAuthConfig
  apiOrigin: string
  webOrigin: string
  port: () => number
}): IAuthService {
  const store = config.store ?? createTokenStore({ home: config.home })
  const now = config.now ?? Date.now
  const origin = apiOrigin.replace(/\/+$/, '')
  const web = webOrigin.replace(/\/+$/, '')
  const api = createApiClient({ baseUrl: origin })
  let pending: IPending | undefined
  let failed: 'denied' | undefined

  const fetchEmail = async (token: string): Promise<string | undefined> => {
    try {
      const response = await fetch(`${origin}/api/auth/get-session`, {
        headers: { authorization: `Bearer ${token}` },
      })
      const parsed = sessionSchema.safeParse(await response.json().catch(() => undefined))
      return parsed.success ? parsed.data.user.email : undefined
    } catch {
      return undefined
    }
  }

  const revoke = async (token: string): Promise<void> => {
    await fetch(`${origin}/api/auth/sign-out`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => undefined)
  }

  const live = (): IPending | undefined =>
    pending !== undefined && now() < pending.deadline ? pending : undefined

  return {
    start: () => {
      const pair = createPkcePair()
      const redirectUri = `http://127.0.0.1:${port()}${CALLBACK_PATH}`
      pending = { ...pair, redirectUri, deadline: now() + PENDING_TTL_MS }
      failed = undefined
      const query = new URLSearchParams({
        redirect_uri: redirectUri,
        state: pair.state,
        code_challenge: pair.challenge,
        code_challenge_method: 'S256',
      })
      const authorizeUrl = `${web}/desktop/authorize?${query.toString()}`
      config.openExternal?.(authorizeUrl)
      return { authorizeUrl }
    },
    callback: async (url) => {
      const current = live()
      const code = url.searchParams.get('code')
      if (current === undefined || code === null) return ECallbackOutcome.Rejected
      if (url.searchParams.get('state') !== current.state) return ECallbackOutcome.Rejected
      pending = undefined
      try {
        const { token } = await api.desktopAuth.exchange.mutate({
          code,
          codeVerifier: current.verifier,
          redirectUri: current.redirectUri,
        })
        store.save({ token, email: await fetchEmail(token) })
        return ECallbackOutcome.SignedIn
      } catch {
        failed = 'denied'
        return ECallbackOutcome.Rejected
      }
    },
    status: () => {
      if (pending !== undefined) return { state: live() === undefined ? 'expired' : 'pending' }
      if (failed !== undefined) return { state: failed }
      if (store.token() === undefined) return { state: 'idle' }
      const email = store.email()
      return email === undefined ? { state: 'signed-in' } : { state: 'signed-in', email }
    },
    signOut: async () => {
      pending = undefined
      failed = undefined
      const token = store.token()
      store.clear()
      if (token === undefined) return
      await revoke(token)
    },
    token: () => store.token(),
    adopt: async (token) => {
      const previous = store.token()
      if (previous === token) return
      store.save({ token, email: await fetchEmail(token) })
      if (previous !== undefined) await revoke(previous)
    },
  }
}
