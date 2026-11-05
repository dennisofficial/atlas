import {
  accountSchema,
  accountSecretSchema,
  chooseAccount,
  EAccountChoice,
  EAuthKind,
  EAuthProvider,
  parseRef,
  toAccountId,
  type Account,
} from '@dltech/atlas-core'

import type { ModelConfig } from './agent-host-config'
import type { SecretCipher } from './secret-cipher'

const SHIPPED_DEFAULT_MODEL_ID = 'claude-haiku-4-5'
const SETTING_VALUE_PREFIX = 'atlas-setting:v1:'

export const MODEL_SETTING_KEY = 'model.id'

export type AccountRow = {
  id: string
  provider: string
  kind: string
  origin: string
  label: string
  status: string
  email: string | null
  subscription: string | null
  importedFrom: string | null
  sealedSecret: string
  createdAt: Date
  updatedAt: Date
}

const decodeSettingValue = (stored: string): unknown => {
  if (!stored.startsWith(SETTING_VALUE_PREFIX)) return stored
  try {
    return JSON.parse(stored.slice(SETTING_VALUE_PREFIX.length))
  } catch {
    return stored
  }
}

export const modelIdOf = (stored: string | undefined): string => {
  const decoded = stored === undefined ? undefined : decodeSettingValue(stored)
  if (typeof decoded !== 'string') return SHIPPED_DEFAULT_MODEL_ID
  const ref = parseRef(decoded)
  return ref !== undefined && ref.providerId === 'anthropic'
    ? ref.modelId
    : SHIPPED_DEFAULT_MODEL_ID
}

const accountOf = (row: AccountRow): Account | undefined => {
  const parsed = accountSchema.safeParse({
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    origin: row.origin,
    label: row.label,
    status: row.status,
    ...(row.email === null ? {} : { email: row.email }),
    ...(row.subscription === null ? {} : { subscription: row.subscription }),
    ...(row.importedFrom === null ? {} : { importedFrom: row.importedFrom }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
  return parsed.success ? parsed.data : undefined
}

export const modelConfigOf = (args: {
  cipher: SecretCipher
  accounts: readonly AccountRow[]
  activeAccountId: string | undefined
  modelSetting: string | undefined
}): ModelConfig => {
  const parsed = args.accounts.flatMap((row) => {
    const account = accountOf(row)
    return account === undefined ? [] : [{ account, row }]
  })
  const choice = chooseAccount({
    accounts: parsed.map((entry) => entry.account),
    provider: EAuthProvider.Anthropic,
    ...(args.activeAccountId === undefined ? {} : { preferred: toAccountId(args.activeAccountId) }),
  })
  if (choice.type !== EAccountChoice.Chosen)
    return { configured: false, gap: 'no anthropic account' }
  const chosen = parsed.find((entry) => entry.account.id === choice.account.id)
  if (chosen === undefined) return { configured: false, gap: 'no anthropic account' }
  const secret = accountSecretSchema.safeParse(
    JSON.parse(args.cipher.decrypt(chosen.row.sealedSecret)),
  )
  if (!secret.success) return { configured: false, gap: `account ${chosen.row.id} has no secret` }
  const base = {
    configured: true,
    modelId: modelIdOf(args.modelSetting),
    accountId: chosen.row.id,
  } as const
  if (secret.data.kind === EAuthKind.ApiKey) {
    return { ...base, credential: { kind: 'api-key', apiKey: secret.data.apiKey } }
  }
  const connectionId = secret.data.authority?.connectionId
  if (connectionId === undefined)
    return { configured: false, gap: 'oauth account has no cloud connection' }
  return { ...base, credential: { kind: 'oauth', connectionId } }
}
