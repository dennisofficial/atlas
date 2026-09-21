import type { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { hashSessionToken, mintSessionToken } from './sandbox-tokens'

export interface SandboxSessionCredential {
  token: string
  tokenHash: string
  sealedToken: string
  rotated: boolean
}

/**
 * One token per sandbox: a stored, decryptable token is reissued as-is so the running serve's
 * in-memory copy never goes stale and forces a relaunch. Only a new row, a row that predates
 * this change, or a token that fails to decrypt falls back to minting a fresh one.
 */
export function sessionCredentialOf(args: {
  cipher: SecretCipherService
  sealedToken: string | null
  onStaleToken?: (failure: unknown) => void
}): SandboxSessionCredential {
  if (args.sealedToken !== null) {
    try {
      const token = args.cipher.decrypt(args.sealedToken)
      return { token, tokenHash: hashSessionToken(token), sealedToken: args.sealedToken, rotated: false }
    } catch (failure) {
      args.onStaleToken?.(failure)
    }
  }
  const minted = mintSessionToken()
  return {
    token: minted.token,
    tokenHash: minted.tokenHash,
    sealedToken: args.cipher.encrypt(minted.token),
    rotated: true,
  }
}
