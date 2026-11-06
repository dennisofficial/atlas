import { AuthApiError, UNREACHABLE } from '@/lib/auth-api'

const NOT_SIGNED_IN = 'Sign in to open this session.'

type SessionTokenBody = { session?: { token?: unknown } | null } | null

export async function fetchStreamToken(): Promise<string> {
  let response: Response
  try {
    response = await fetch('/api/auth/get-session', {
      credentials: 'same-origin',
      cache: 'no-store',
    })
  } catch {
    throw new AuthApiError(UNREACHABLE)
  }
  if (!response.ok) throw new AuthApiError(NOT_SIGNED_IN)
  const body = (await response.json().catch(() => null)) as SessionTokenBody
  const token = body?.session?.token
  if (typeof token !== 'string' || token.length === 0) throw new AuthApiError(NOT_SIGNED_IN)
  return token
}
