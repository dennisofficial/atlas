import type { EnvService } from '../../../_core/config/env/env.service'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { VercelFetcher } from '../user-vercel/vercel-oauth.types'
import { VercelTokenRefresher } from '../user-vercel/vercel-token-refresher'
import { ScopedConfigService } from './scoped-config.service'

export function buildScopedConfig(args: {
  cipher: SecretCipherService
  env: EnvService
}): ScopedConfigService {
  return new ScopedConfigService(
    args.cipher,
    new VercelTokenRefresher(args.cipher, args.env, new VercelFetcher()),
  )
}
