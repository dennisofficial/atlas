import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { z } from 'zod'

import { type PortableState } from '@dltech/atlas-wire'
import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  accountIdSchema,
  accountSecretSchema,
} from '@dltech/atlas-core'

import { CredentialError, ECredentialFailure } from '../credentials/credential-error'
import { VAULT_VERSION, vaultFileSchema, type SealedAccount, type VaultFile } from '../credentials/vault-file'
import { mcpConfigFileSchema, mcpServersOf, mcpSpecSchema } from '../mcp/config/specs'

const CIPHER_ALGORITHM = 'aes-256-gcm'
const CIPHER_NONCE_BYTES = 12
const CIPHER_TAG_BYTES = 16

export const openSealed = (args: { keyHex: string; blob: string }): string | undefined => {
  const [nonceText, tagText, ciphertextText, ...rest] = args.blob.split('.')
  if (nonceText === undefined || tagText === undefined || ciphertextText === undefined)
    return undefined
  if (rest.length > 0) return undefined

  const nonce = Buffer.from(nonceText, 'base64')
  const tag = Buffer.from(tagText, 'base64')
  if (nonce.length !== CIPHER_NONCE_BYTES || tag.length !== CIPHER_TAG_BYTES) return undefined

  try {
    const decipher = createDecipheriv(CIPHER_ALGORITHM, Buffer.from(args.keyHex, 'hex'), nonce)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64')), decipher.final()]).toString(
      'utf8',
    )
  } catch {
    return undefined
  }
}

export const sealWith = (args: { keyHex: string; plaintext: string }): string => {
  const nonce = randomBytes(CIPHER_NONCE_BYTES)
  const cipher = createCipheriv(CIPHER_ALGORITHM, Buffer.from(args.keyHex, 'hex'), nonce)
  const ciphertext = Buffer.concat([cipher.update(args.plaintext, 'utf8'), cipher.final()])
  return [nonce, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64')).join('.')
}

export const malformedSnapshot = (): CredentialError =>
  new CredentialError({
    failure: ECredentialFailure.Unreadable,
    message: 'The portable-state snapshot is not in the shape Atlas writes; nothing was installed.',
  })

export type PlannedVault = { accounts: SealedAccount[]; active: VaultFile['active'] }

export type OpenedSecrets = ReadonlyMap<string, string>

const knownValue = <S extends z.ZodType>(schema: S, value: unknown): z.output<S> => {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw malformedSnapshot()
  return parsed.data
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    throw malformedSnapshot()
  }
}

const scalarSettingsObject = (json: unknown): boolean => {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return false
  return Object.values(json).every(
    (value) => value === null || ['string', 'number', 'boolean'].includes(typeof value),
  )
}

const prevalidateJsonFile = (args: { name: string; content: string; check: (json: unknown) => boolean }): void => {
  if (!args.check(parseJson(args.content))) throw malformedSnapshot()
}

export const prevalidate = (state: PortableState): { vault: PlannedVault; secrets: OpenedSecrets } => {
  const accounts: SealedAccount[] = []
  for (const account of state.accounts) {
    const kind = knownValue(z.enum(EAuthKind), account.kind)

    const opened = openSealed({ keyHex: state.vaultKeyHex, blob: account.secret })
    if (opened === undefined) throw malformedSnapshot()

    const secret = accountSecretSchema.safeParse(parseJson(opened))
    if (!secret.success) throw malformedSnapshot()
    if (secret.data.kind !== kind) throw malformedSnapshot()

    if (secret.data.kind === EAuthKind.Oauth && secret.data.tokens.refreshToken.length > 0) {
      throw malformedSnapshot()
    }

    accounts.push({
      id: knownValue(accountIdSchema, account.id),
      provider: knownValue(z.enum(EAuthProvider), account.provider),
      kind: knownValue(z.enum(EAuthKind), account.kind),
      origin: knownValue(z.enum(EAccountOrigin), account.origin),
      label: account.label,
      status: knownValue(z.enum(EAccountStatus), account.status),
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      secret: account.secret,
      ...(account.email === undefined ? {} : { email: account.email }),
      ...(account.subscription === undefined ? {} : { subscription: account.subscription }),
    })
  }

  const ids = new Set(state.accounts.map((account) => account.id))
  const activeEntries: [EAuthProvider, SealedAccount['id']][] = []
  for (const pointer of state.active) {
    if (!ids.has(pointer.accountId)) throw malformedSnapshot()
    activeEntries.push([
      knownValue(z.enum(EAuthProvider), pointer.provider),
      knownValue(accountIdSchema, pointer.accountId),
    ])
  }

  const vault = vaultFileSchema.safeParse({
    version: VAULT_VERSION,
    accounts,
    active: Object.fromEntries(activeEntries),
  })
  if (!vault.success) throw malformedSnapshot()

  const secrets = new Map<string, string>()
  for (const secret of state.secrets) {
    const opened = openSealed({ keyHex: state.vaultKeyHex, blob: secret.value })
    if (opened === undefined) throw malformedSnapshot()
    secrets.set(secret.name, opened)
  }

  if (state.settings !== undefined) {
    prevalidateJsonFile({
      name: state.settings.name,
      content: state.settings.content,
      check: scalarSettingsObject,
    })
  }
  if (state.mcp !== undefined) {
    prevalidateJsonFile({
      name: state.mcp.name,
      content: state.mcp.content,
      check: (json) => {
        const file = mcpConfigFileSchema.safeParse(json)
        if (!file.success) return false
        return Object.entries(mcpServersOf(file.data)).every(([name, entry]) => {
          const fields = typeof entry === 'object' && entry !== null ? entry : {}
          return mcpSpecSchema.safeParse({ ...fields, name }).success
        })
      },
    })
  }

  return { vault: { accounts: vault.data.accounts, active: vault.data.active }, secrets }
}
