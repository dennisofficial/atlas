import { EnvService } from '../../../_core/config/env/env.service'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { VercelFetcher } from './vercel-oauth.types'
import { VercelPlanService } from './vercel-credential-plan'
import { VercelTokenRefresher } from './vercel-token-refresher'

const passThroughCipher = (): SecretCipherService =>
  ({
    encrypt: (value: string) => value,
    decrypt: (value: string) => value,
  }) as unknown as SecretCipherService

export const unknownTokenRefresher = (): VercelTokenRefresher =>
  new VercelTokenRefresher(
    passThroughCipher(),
    new EnvService({ SECRETS_ENCRYPTION_KEY: 'aa'.repeat(32) }),
    new VercelFetcher(),
  )

export const unknownPlanService = (): VercelPlanService =>
  new VercelPlanService(passThroughCipher(), unknownTokenRefresher(), new VercelFetcher())
