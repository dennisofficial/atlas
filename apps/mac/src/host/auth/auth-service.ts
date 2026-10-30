import {
  ECloudLoginPoll,
  beginCloudLogin,
  pollCloudLogin,
  type CloudLoginOutcome,
  type CloudLoginTicket,
} from '@dltech/atlas-harness'
import { z } from 'zod'
import { createTokenStore, type ITokenStore } from './token-store'

export type TAuthState = 'idle' | 'pending' | 'signed-in' | 'expired' | 'denied'

export interface IAuthStatus {
  state: TAuthState
  email?: string
}

export interface IAuthService {
  start: () => Promise<{ userCode: string; verificationUrl: string }>
  status: () => IAuthStatus
  signOut: () => Promise<void>
  token: () => string | undefined
}

export interface IAuthConfig {
  home: string
  openExternal?: (url: string) => boolean
  begin?: (args: { url: string }) => Promise<CloudLoginTicket>
  poll?: (args: { ticket: CloudLoginTicket }) => Promise<CloudLoginOutcome>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  store?: ITokenStore
}

const SLOW_DOWN_MS = 5_000
const sessionSchema = z.object({ user: z.object({ email: z.string() }) })

export function createAuthService({
  config,
  apiOrigin,
}: {
  config: IAuthConfig
  apiOrigin: string
}): IAuthService {
  const store = config.store ?? createTokenStore({ home: config.home })
  const begin = config.begin ?? beginCloudLogin
  const poll = config.poll ?? pollCloudLogin
  const sleep = config.sleep ?? ((ms: number) => Bun.sleep(ms))
  const now = config.now ?? Date.now
  const origin = apiOrigin.replace(/\/+$/, '')
  let attempt = 0
  let phase: 'idle' | 'pending' | 'expired' | 'denied' = 'idle'

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

  const watch = async ({ ticket, id }: { ticket: CloudLoginTicket; id: number }) => {
    const deadline = now() + ticket.expiresInMs
    let interval = ticket.intervalMs
    while (id === attempt) {
      await sleep(interval)
      if (id !== attempt) return
      if (now() >= deadline) {
        phase = 'expired'
        return
      }
      const outcome = await poll({ ticket }).catch(() => undefined)
      if (id !== attempt || outcome === undefined) continue
      if (outcome.status === ECloudLoginPoll.SlowDown) interval += SLOW_DOWN_MS
      if (outcome.status === ECloudLoginPoll.Denied) phase = 'denied'
      if (outcome.status === ECloudLoginPoll.Expired) phase = 'expired'
      if (outcome.status === ECloudLoginPoll.Approved) {
        const email = await fetchEmail(outcome.token)
        if (id !== attempt) return
        store.save({ token: outcome.token, email })
        phase = 'idle'
      }
      if (outcome.status === ECloudLoginPoll.Approved || phase !== 'pending') return
    }
  }

  return {
    start: async () => {
      attempt += 1
      const id = attempt
      const ticket = await begin({ url: origin })
      phase = 'pending'
      config.openExternal?.(ticket.verificationUrl)
      void watch({ ticket, id })
      return {
        userCode: ticket.userCode,
        verificationUrl: ticket.verificationUrl,
      }
    },
    status: () => {
      const email = store.email()
      if (phase === 'pending' || phase === 'expired' || phase === 'denied') return { state: phase }
      if (store.token() === undefined) return { state: 'idle' }
      return email === undefined ? { state: 'signed-in' } : { state: 'signed-in', email }
    },
    signOut: async () => {
      attempt += 1
      phase = 'idle'
      const token = store.token()
      store.clear()
      if (token === undefined) return
      await fetch(`${origin}/api/auth/sign-out`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: '{}',
      }).catch(() => undefined)
    },
    token: () => store.token(),
  }
}
