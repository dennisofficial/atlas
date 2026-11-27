import { apiUrl } from '@/lib/api-base-url'
import { UNREACHABLE } from '@/lib/auth-api'
import { CloudApiError } from '@/lib/cloud-api'
import {
  type IAuthSession,
  type ICurrentSession,
  currentSessionSchema,
  sessionSchema,
} from '@dltech/atlas-client/settings'
import { z } from 'zod'

async function authRequest(args: { path: string; body?: unknown }): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(apiUrl(args.path), {
      method: args.body === undefined ? 'GET' : 'POST',
      credentials: 'include',
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

export async function fetchSessions(): Promise<IAuthSession[]> {
  return z.array(sessionSchema).parse(await authRequest({ path: '/api/auth/list-sessions' }))
}

export async function fetchCurrentSession(): Promise<ICurrentSession> {
  return currentSessionSchema.parse(await authRequest({ path: '/api/auth/get-session' }))
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
