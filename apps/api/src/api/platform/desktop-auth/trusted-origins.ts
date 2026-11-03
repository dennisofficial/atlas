import type { EnvService } from '../../../_core/config/env/env.service'

export const trustedOriginsOf = (env: EnvService): Set<string> => {
  const listed = (env.get('TRUSTED_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
  return new Set([...listed, env.get('WEB_ORIGIN')])
}
