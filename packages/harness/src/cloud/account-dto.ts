import {
  accountSchema,
  storedAccountSchema,
  type Account,
  type StoredAccount,
} from '@dltech/atlas-core'
import { accountDtoSchema, storedAccountDtoSchema } from '@dltech/atlas-wire'

const revisionFields = (secretVersion: number | undefined): { authorizationRevision?: number } =>
  secretVersion === undefined ? {} : { authorizationRevision: secretVersion }

export const accountOfDto = (body: unknown): Account => {
  const { secretVersion, ...dto } = accountDtoSchema.parse(body)
  return accountSchema.parse({ ...dto, ...revisionFields(secretVersion) })
}

export const storedAccountOfDto = (body: unknown): StoredAccount => {
  const { secretVersion, ...dto } = storedAccountDtoSchema.parse(body)
  return storedAccountSchema.parse({
    ...dto,
    ...revisionFields(secretVersion),
  })
}
