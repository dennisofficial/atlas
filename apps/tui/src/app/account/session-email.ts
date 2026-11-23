const emailOf = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null) return null
  if (!('user' in body)) return null

  const user = body.user
  if (typeof user !== 'object' || user === null) return null
  if (!('email' in user)) return null

  return typeof user.email === 'string' && user.email !== '' ? user.email : null
}

const originOf = (apiUrl: string): string => apiUrl.replace(/\/+$/, '')

export const fetchSessionEmail = async (args: {
  apiUrl: string
  token: string
  fetchFn?: typeof fetch | undefined
}): Promise<string | null> => {
  const fetchFn = args.fetchFn ?? fetch
  try {
    const response = await fetchFn(`${originOf(args.apiUrl)}/api/auth/get-session`, {
      headers: { authorization: `Bearer ${args.token}` },
    })
    if (!response.ok) return null
    return emailOf(await response.json().catch(() => undefined))
  } catch {
    return null
  }
}

export const signOutSession = async (args: {
  apiUrl: string
  token: string
  fetchFn?: typeof fetch | undefined
}): Promise<boolean> => {
  const fetchFn = args.fetchFn ?? fetch
  try {
    const response = await fetchFn(`${originOf(args.apiUrl)}/api/auth/sign-out`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${args.token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    })
    return response.ok || response.status === 401
  } catch {
    return false
  }
}

export const isRefusal = (status: number | undefined): status is 401 | 403 =>
  status === 401 || status === 403
