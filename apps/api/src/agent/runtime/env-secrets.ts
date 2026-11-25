import { EConfigLayer, ENV_NAME_PATTERN, effectiveByKey } from '@dltech/atlas-core'

export const RESERVED_ENV_PREFIX = 'ATLAS_'

export type CloudSecret = { name: string; value: string }

export type ExportedEnvSecrets = { env: Record<string, string>; names: readonly string[] }

export const isExportedSecretName = (name: string): boolean =>
  ENV_NAME_PATTERN.test(name) && !name.startsWith(RESERVED_ENV_PREFIX)

export const exportEnvSecretsOf = (args: {
  user: readonly CloudSecret[]
  group: readonly CloudSecret[]
  project: readonly CloudSecret[]
}): ExportedEnvSecrets => {
  const usable = (secrets: readonly CloudSecret[]): CloudSecret[] =>
    secrets.filter((secret) => isExportedSecretName(secret.name))
  const winners = effectiveByKey({
    layers: [
      { layer: EConfigLayer.Personal, items: usable(args.user) },
      { layer: EConfigLayer.Group, items: usable(args.group) },
      { layer: EConfigLayer.Project, items: usable(args.project) },
    ],
    keyOf: (secret) => secret.name,
  })
  const env: Record<string, string> = {}
  for (const secret of winners) env[secret.name] = secret.value
  return { env, names: Object.keys(env).sort((left, right) => left.localeCompare(right)) }
}
