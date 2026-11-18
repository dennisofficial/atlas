import { ENV_NAME_PATTERN } from '@dltech/atlas-core'

export const RESERVED_ENV_PREFIX = 'ATLAS_'

export type CloudSecret = { name: string; value: string }

export type ExportedEnvSecrets = { env: Record<string, string>; names: readonly string[] }

export const exportEnvSecretsOf = (args: {
  user: readonly CloudSecret[]
  project: readonly CloudSecret[]
}): ExportedEnvSecrets => {
  const env: Record<string, string> = {}
  for (const secret of [...args.user, ...args.project]) {
    if (!ENV_NAME_PATTERN.test(secret.name) || secret.name.startsWith(RESERVED_ENV_PREFIX)) continue
    env[secret.name] = secret.value
  }
  return { env, names: Object.keys(env).sort((left, right) => left.localeCompare(right)) }
}

export const envSecretsNoticeOf = (names: readonly string[]): string | null => {
  if (names.length === 0) return null
  return [
    `Atlas exported these project and personal secrets as environment variables to your shells: ${names.join(', ')}.`,
    'Use them by name (for example "$NAME" in a command) rather than asking the operator for them, and never print, log or commit their values.',
    'Change them in the project or personal Secrets settings; edits reach new shells without a restart.',
  ].join('\n\n')
}
