import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'

export interface ModelCredentialBlob {
  provider: string
  apiKey: string
  modelRef: string
}

export interface VercelCredentialBlob {
  token: string
}

export function sealBlob(args: {
  cipher: SecretCipherService
  blob: ModelCredentialBlob | VercelCredentialBlob
}): string {
  return args.cipher.encrypt(JSON.stringify(args.blob))
}

export function openModelCredential(args: {
  cipher: SecretCipherService
  sealed: string
}): ModelCredentialBlob | null {
  const parsed = openBlob(args)
  if (parsed === null) return null
  const { provider, apiKey, modelRef } = parsed
  if (typeof provider !== 'string' || typeof apiKey !== 'string' || typeof modelRef !== 'string') {
    return null
  }
  return { provider, apiKey, modelRef }
}

export function openVercelCredential(args: {
  cipher: SecretCipherService
  sealed: string
}): VercelCredentialBlob | null {
  const parsed = openBlob(args)
  if (parsed === null) return null
  const { token } = parsed
  if (typeof token !== 'string') return null
  return { token }
}

function openBlob(args: {
  cipher: SecretCipherService
  sealed: string
}): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(args.cipher.decrypt(args.sealed))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  return parsed as Record<string, unknown>
}
