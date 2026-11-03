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
