import { z } from 'zod'

import { UNREACHABLE } from '@/lib/auth-api'
import { CloudApiError } from '@/lib/cloud-api'

import { EDeviceKind, type SignedInDevice } from '../../fixtures/settings-security'
import { relativeTime } from './relative-time'

const sessionSchema = z.object({
  id: z.string(),
  token: z.string(),
  userAgent: z.string().nullish(),
  ipAddress: z.string().nullish(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  expiresAt: z.string(),
})

const currentSchema = z.object({
  session: z.object({ token: z.string() }).nullable(),
  user: z
    .object({ name: z.string(), email: z.string(), createdAt: z.string().optional() })
    .nullable(),
})

export type AuthSession = z.infer<typeof sessionSchema>
export type CurrentSession = z.infer<typeof currentSchema>

async function authRequest(args: { path: string; body?: unknown }): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(args.path, {
      method: args.body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: args.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: args.body === undefined ? undefined : JSON.stringify(args.body),
    })
  } catch {
    throw new CloudApiError({ message: UNREACHABLE, status: 0 })
  }
  const payload: unknown = await response.json().catch(() => null)
  if (response.ok) return payload
  const message =
    typeof payload === 'object' &&
    payload !== null &&
    'message' in payload &&
    typeof payload.message === 'string'
      ? payload.message
      : `Atlas Cloud answered ${response.status}`
  throw new CloudApiError({ message, status: response.status })
}

export async function fetchSessions(): Promise<AuthSession[]> {
  return z.array(sessionSchema).parse(await authRequest({ path: '/api/auth/list-sessions' }))
}

export async function fetchCurrentSession(): Promise<CurrentSession> {
  return currentSchema.parse(await authRequest({ path: '/api/auth/get-session' }))
}

export async function revokeSession(token: string): Promise<void> {
  await authRequest({ path: '/api/auth/revoke-session', body: { token } })
}

export async function revokeOtherSessions(): Promise<void> {
  await authRequest({ path: '/api/auth/revoke-other-sessions', body: {} })
}

export async function updateName(name: string): Promise<void> {
  await authRequest({ path: '/api/auth/update-user', body: { name } })
}

const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
  [/curl\//, 'curl'],
]
const PLATFORMS: [RegExp, string][] = [
  [/iPhone|iPad/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
]

export function deviceNameOf(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device'
  if (/^atlas/i.test(userAgent)) return userAgent
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1]
  const platform = PLATFORMS.find(([pattern]) => pattern.test(userAgent))?.[1]
  if (browser === undefined) return userAgent.slice(0, 40)
  return platform === undefined ? browser : `${browser} on ${platform}`
}

export function deviceKindOf(userAgent: string | null | undefined): EDeviceKind {
  return userAgent && /^atlas|curl\//i.test(userAgent) ? EDeviceKind.Cli : EDeviceKind.Browser
}

export function toDevice(args: {
  session: AuthSession
  currentToken: string | null
  now?: number
}): SignedInDevice {
  const { session } = args
  const active = relativeTime({
    from: session.updatedAt ?? session.createdAt,
    ...(args.now === undefined ? {} : { now: args.now }),
  })
  const meta = [session.ipAddress ? session.ipAddress : null, `Last active ${active}`]
    .filter((part) => part !== null)
    .join(' · ')
  return {
    id: session.token,
    kind: deviceKindOf(session.userAgent),
    name: deviceNameOf(session.userAgent),
    meta,
    current: session.token === args.currentToken,
  }
}
