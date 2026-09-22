import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'

export interface LinearConnectionCredentials {
  accessToken: string
  refreshToken: string | null
  expiresAt: number
}

export const EXPIRY_MARGIN_MS = 60_000

export function credentialsFromToken(args: {
  accessToken: string
  refreshToken: string | null
  expiresIn: number
}): LinearConnectionCredentials {
  return {
    accessToken: args.accessToken,
    refreshToken: args.refreshToken,
    expiresAt: Date.now() + args.expiresIn * 1000,
  }
}

export function isFresh(credentials: LinearConnectionCredentials): boolean {
  return credentials.expiresAt - EXPIRY_MARGIN_MS > Date.now()
}

export function sealCredentials(args: {
  cipher: SecretCipherService
  credentials: LinearConnectionCredentials
}): string {
  return args.cipher.encrypt(JSON.stringify(args.credentials))
}

export function openCredentials(args: {
  cipher: SecretCipherService
  sealed: string
}): LinearConnectionCredentials | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(args.cipher.decrypt(args.sealed))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as Record<string, unknown>
  const { accessToken, refreshToken, expiresAt } = candidate
  if (typeof accessToken !== 'string') return null
  if (refreshToken !== null && typeof refreshToken !== 'string') return null
  if (typeof expiresAt !== 'number') return null
  return { accessToken, refreshToken, expiresAt }
}
