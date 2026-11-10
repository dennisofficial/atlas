import type { z } from 'zod'

import type { SecretCipher } from '../config/secret-cipher'

export const sealJson = (args: { cipher: SecretCipher; value: unknown }): string =>
  args.cipher.encrypt(JSON.stringify(args.value))

export const unsealJson = <S extends z.ZodType>(args: {
  cipher: SecretCipher
  sealed: string
  schema: S
}): z.infer<S> => args.schema.parse(JSON.parse(args.cipher.decrypt(args.sealed)))

export const normalizeServerUrl = (url: string): string => new URL(url).toString()
