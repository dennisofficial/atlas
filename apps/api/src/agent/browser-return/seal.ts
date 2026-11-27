import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import type { z } from 'zod'

export type JsonCipher = Pick<SecretCipher, 'encrypt' | 'decrypt'>

export const sealJson = (args: { cipher: JsonCipher; value: unknown }): string =>
  args.cipher.encrypt(JSON.stringify(args.value))

export const unsealJson = <S extends z.ZodType>(args: {
  cipher: JsonCipher
  sealed: string
  schema: S
}): z.infer<S> => args.schema.parse(JSON.parse(args.cipher.decrypt(args.sealed)))
