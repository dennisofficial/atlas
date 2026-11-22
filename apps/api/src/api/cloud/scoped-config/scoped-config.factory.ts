import type { EnvService } from '../../../_core/config/env/env.service'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { ScopedConfigService } from './scoped-config.service'

export function buildScopedConfig(args: {
  cipher: SecretCipherService
  env: EnvService
}): ScopedConfigService {
  return new ScopedConfigService(args.cipher, args.env)
}
