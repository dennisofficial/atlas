import { z } from 'zod'

import type { IAuthUser } from './auth-reducer'

const sessionSchema = z.object({
  user: z.object({ email: z.string(), name: z.string().nullish() }),
})

export const fetchSession = async ({
  apiOrigin,
  token,
  fetchFn = fetch,
}: {
  apiOrigin: string
  token: string
  fetchFn?: typeof fetch
}): Promise<IAuthUser | undefined> => {
  try {
    const response = await fetchFn(`${apiOrigin}/api/auth/get-session`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!response.ok) return undefined
    const parsed = sessionSchema.safeParse(await response.json().catch(() => undefined))
    if (!parsed.success) return undefined
    const { email, name } = parsed.data.user
    return name == null ? { email } : { email, name }
  } catch {
    return undefined
  }
}

export const revokeSession = async ({
  apiOrigin,
  token,
  fetchFn = fetch,
}: {
  apiOrigin: string
  token: string
  fetchFn?: typeof fetch
}): Promise<void> => {
  await fetchFn(`${apiOrigin}/api/auth/sign-out`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  }).catch(() => undefined)
}

const signInErrorSchema = z.object({ message: z.string() })

export type TPasswordSignIn = { ok: true; token: string } | { ok: false; error: string }

export const signInWithPassword = async ({
  apiOrigin,
  email,
  password,
  fetchFn = fetch,
}: {
  apiOrigin: string
  email: string
  password: string
  fetchFn?: typeof fetch
}): Promise<TPasswordSignIn> => {
  try {
    const response = await fetchFn(`${apiOrigin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!response.ok) {
      const parsed = signInErrorSchema.safeParse(await response.json().catch(() => undefined))
      return { ok: false, error: parsed.success ? parsed.data.message : 'Sign-in failed' }
    }
    const token = response.headers.get('set-auth-token')
    if (token === null || token.length === 0) {
      return { ok: false, error: 'The server did not return a session token' }
    }
    return { ok: true, token }
  } catch {
    return { ok: false, error: 'Could not reach Atlas; check your connection' }
  }
}
