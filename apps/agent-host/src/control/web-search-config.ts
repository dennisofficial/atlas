import type { WebSearchConfig } from '@dltech/atlas-plugin-sdk'

import type { SecretCipher } from '../config/secret-cipher'

const BACKEND_KEY = 'web.searchBackend'
const SECRET_PREFIX = 'search.'
const SETTING_VALUE_PREFIX = 'atlas-setting:v1:'

const decodedSetting = (stored: string): string => {
  if (!stored.startsWith(SETTING_VALUE_PREFIX)) return stored
  try {
    const parsed: unknown = JSON.parse(stored.slice(SETTING_VALUE_PREFIX.length))
    return typeof parsed === 'string' ? parsed : stored
  } catch {
    return stored
  }
}

type Row = { value?: string | null; sealedValue?: string | null }

export type WebSearchRows = {
  userSetting(args: { userId: string; key: string }): Promise<Row | null>
  projectSetting(args: { projectId: string; key: string }): Promise<Row | null>
  userSecret(args: { userId: string; name: string }): Promise<Row | null>
  projectSecret(args: { projectId: string; name: string }): Promise<Row | null>
}

const openedValue = (args: { cipher: SecretCipher; sealed: string | null }): string | undefined => {
  if (args.sealed === null) return undefined
  try {
    const parsed: unknown = JSON.parse(args.cipher.decrypt(args.sealed))
    return typeof parsed === 'string' ? parsed : undefined
  } catch {
    return undefined
  }
}

export const webSearchConfigOf = async (args: {
  rows: WebSearchRows
  cipher: SecretCipher
  userId: string
  projectId: string
}): Promise<WebSearchConfig> => {
  const [userSetting, projectSetting] = await Promise.all([
    args.rows.userSetting({ userId: args.userId, key: BACKEND_KEY }),
    args.rows.projectSetting({ projectId: args.projectId, key: BACKEND_KEY }),
  ])

  const stored = projectSetting?.value ?? userSetting?.value ?? null
  if (stored === null) return { backend: undefined, key: undefined }

  const backend = decodedSetting(stored)
  const name = `${SECRET_PREFIX}${backend}`
  const [userSecret, projectSecret] = await Promise.all([
    args.rows.userSecret({ userId: args.userId, name }),
    args.rows.projectSecret({ projectId: args.projectId, name }),
  ])

  return {
    backend,
    key: openedValue({
      cipher: args.cipher,
      sealed: projectSecret?.sealedValue ?? userSecret?.sealedValue ?? null,
    }),
  }
}
