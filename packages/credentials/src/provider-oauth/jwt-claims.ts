export type JwtClaims = Record<string, unknown> & {
  exp?: unknown
  email?: unknown
  'https://api.openai.com/profile'?: { email?: unknown }
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: unknown
    chatgpt_plan_type?: unknown
  }
}

const decodeBase64Url = (segment: string): string => {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}

/** Claims parsing only — a stored token is never signature-checked because Atlas is its audience. */
export const decodeJwtClaims = (jwt: string): JwtClaims | undefined => {
  const payload = jwt.split('.')[1]
  if (payload === undefined || payload.length === 0) return undefined

  try {
    const claims: unknown = JSON.parse(decodeBase64Url(payload))
    if (typeof claims !== 'object' || claims === null) return undefined
    return claims as JwtClaims
  } catch {
    return undefined
  }
}
