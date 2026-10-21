import { ENV_NAME_PATTERN, ESecretKind } from '@dltech/atlas-wire/web'
import { BadRequestException } from '@nestjs/common'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'

export function assertEnvName(name: string): void {
  if (!ENV_NAME_PATTERN.test(name)) {
    throw new BadRequestException(
      'a name starts with a letter or underscore and holds letters, digits and underscores, up to 200 characters',
    )
  }
}

export const kindOf = (stored: string): ESecretKind =>
  stored === ESecretKind.EnvVar ? ESecretKind.EnvVar : ESecretKind.Secret

export const sealSecretValue = (args: { cipher: SecretCipherService; value: string }): string =>
  args.cipher.encrypt(JSON.stringify(args.value))

export const openSecretValue = (args: { cipher: SecretCipherService; sealed: string }): string =>
  JSON.parse(args.cipher.decrypt(args.sealed)) as string
