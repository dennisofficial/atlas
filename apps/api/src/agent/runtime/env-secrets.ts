import { ENV_NAME_PATTERN } from '@dltech/atlas-core'

export const RESERVED_ENV_PREFIX = 'ATLAS_'

export type CloudSecret = { name: string; value: string }

export type ExportedEnvSecrets = { env: Record<string, string>; names: readonly string[] }

export const isExportedSecretName = (name: string): boolean =>
  ENV_NAME_PATTERN.test(name) && !name.startsWith(RESERVED_ENV_PREFIX)

export const exportEnvSecretsOf = (args: {
  user: readonly CloudSecret[]
  project: readonly CloudSecret[]
}): ExportedEnvSecrets => {
  const env: Record<string, string> = {}
  for (const secret of [...args.user, ...args.project]) {
    if (!isExportedSecretName(secret.name)) continue
    env[secret.name] = secret.value
  }
  return { env, names: Object.keys(env).sort((left, right) => left.localeCompare(right)) }
}
