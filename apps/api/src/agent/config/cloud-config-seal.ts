import { ENV_NAME_PATTERN } from '@dltech/atlas-core'
import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'

export const DEFAULT_FILE_MODE = 0o600

const NAME_PROBLEM =
  'a name starts with a letter or underscore and holds letters, digits and underscores, up to 200 characters'

export const envNameProblem = (name: string): string | undefined =>
  ENV_NAME_PATTERN.test(name) ? undefined : NAME_PROBLEM

export const sealedOf = (args: { cipher: SecretCipher; value: unknown }): string =>
  args.cipher.encrypt(JSON.stringify(args.value))
