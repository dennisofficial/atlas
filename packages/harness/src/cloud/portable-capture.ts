import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  PORTABLE_ACCOUNT_KIND,
  PORTABLE_MCP_NAME,
  PORTABLE_SETTINGS_NAME,
  PORTABLE_STATE_VERSION,
  portableStateSchema,
  type PortableAccount,
  type PortableState,
  type PortableTokenSource,
} from '@dltech/atlas-wire'
import { EAccountOrigin, EAccountStatus, EAuthKind, accountSecretSchema } from '@dltech/atlas-core'

import { CredentialError, ECredentialFailure } from '../credentials/credential-error'
import { ATLAS_VAULT_KEY_NAME, ATLAS_VAULT_NAME } from '../credentials/paths'
import { fileVaultBackend } from '../credentials/vault-backend'
import type { SealedAccount } from '../credentials/vault-file'
import { mcpConfigFileSchema, mcpServersOf, mcpSpecSchema } from '../mcp/config/specs'
import { ATLAS_SECRETS_NAME } from '../secrets/paths'
import { secretsFileSchema } from '../secrets/secrets-file'
import { atlasDirectory } from '../store/paths'
import { openSealed, sealWith } from './portable-validation'
import { SANDBOX_SERVE_TOKEN_PREFIX } from './sandbox-attachment'

const KEY_HEX_PATTERN = /^[0-9a-f]{64}$/
const MCP_OAUTH_SECRET_PREFIX = 'mcp-oauth:'
const ATTACHMENT_TOKEN_PREFIX = `${SANDBOX_SERVE_TOKEN_PREFIX}:`

const unreadable = (message: string): CredentialError =>
  new CredentialError({ failure: ECredentialFailure.Unreadable, message })

const missing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'

const readOptionalFile = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (missing(error)) return undefined
    throw unreadable(`The file at ${path} could not be read.`)
  }
}

const portableOriginOf = (origin: EAccountOrigin): EAccountOrigin =>
  origin === EAccountOrigin.Environment ? EAccountOrigin.Login : origin

const portableSourceOf = (importedFrom: string | undefined): PortableTokenSource | undefined => {
  if (importedFrom === undefined) return undefined
  if (importedFrom === 'claude-code' || importedFrom === 'codex') {
    return { kind: 'file', detail: importedFrom }
  }
  if (importedFrom.startsWith('environment:')) {
    return { kind: 'environment', detail: importedFrom.slice('environment:'.length) }
  }
  return { kind: 'unknown', detail: importedFrom }
}

type DecodedCarry = { sealed: SealedAccount; plaintext: string; omitted: boolean }

const UNAVAILABLE_OAUTH_SECRET = JSON.stringify({
  kind: EAuthKind.Oauth,
  tokens: { accessToken: 'unavailable', refreshToken: '', expiresAt: '1970-01-01T00:00:00.000Z' },
})

const decodeCarriedAccount = (args: {
  sealed: SealedAccount
  sourceKeyHex: string
  omitOauth: boolean
}): DecodedCarry => {
  const opened = openSealed({ keyHex: args.sourceKeyHex, blob: args.sealed.secret })
  if (opened === undefined) {
    throw unreadable('An account secret in the vault could not be decrypted; this home cannot be captured.')
  }

  let json: unknown
  try {
    json = JSON.parse(opened)
  } catch {
    throw unreadable('An account secret in the vault is not in the shape Atlas writes; this home cannot be captured.')
  }
  const secret = accountSecretSchema.safeParse(json)
  if (!secret.success) {
    throw unreadable('An account secret in the vault is not in the shape Atlas writes; this home cannot be captured.')
  }

  if (secret.data.kind !== args.sealed.kind) {
    throw new CredentialError({
      failure: ECredentialFailure.Unsupported,
      message: `The account vault at ${ATLAS_VAULT_NAME} holds an entry whose stored kind does not match its secret, so this home cannot be captured. Move it aside and sign in again with /auth.`,
    })
  }

  if (secret.data.kind === EAuthKind.Oauth && args.omitOauth) {
    return { sealed: args.sealed, plaintext: UNAVAILABLE_OAUTH_SECRET, omitted: true }
  }

  const carried =
    secret.data.kind === EAuthKind.Oauth
      ? JSON.stringify({ ...secret.data, tokens: { ...secret.data.tokens, refreshToken: '' } })
      : opened

  return { sealed: args.sealed, plaintext: carried, omitted: false }
}

const resealAccount = (args: { carry: DecodedCarry; vaultKeyHex: string }): PortableAccount => {
  const { sealed } = args.carry
  const source = portableSourceOf(sealed.importedFrom)
  return {
    id: sealed.id,
    provider: sealed.provider,
    kind: sealed.kind,
    origin: portableOriginOf(sealed.origin),
    label: sealed.label,
    status: args.carry.omitted ? EAccountStatus.Expired : sealed.status,
    createdAt: sealed.createdAt,
    updatedAt: sealed.updatedAt,
    secret: sealWith({ keyHex: args.vaultKeyHex, plaintext: args.carry.plaintext }),
    ...(sealed.email === undefined ? {} : { email: sealed.email }),
    ...(sealed.subscription === undefined ? {} : { subscription: sealed.subscription }),
    ...(source === undefined ? {} : { source }),
  }
}

const readSourceKeyHex = (keyFile: string): string | undefined => {
  const text = readOptionalFile(keyFile)
  if (text === undefined) return undefined

  const trimmed = text.trim()
  if (!KEY_HEX_PATTERN.test(trimmed)) {
    throw unreadable(
      `The vault key at ${keyFile} is not a 64-hex-character key, so this home cannot be captured.`,
    )
  }
  return trimmed
}

type CapturedSecrets = {
  carried: { name: string; value: string }[]
  mcpOauth: string[]
  attachmentTokens: string[]
}

const captureSecrets = (args: {
  secretsFile: string
  sourceKeyHex: string | undefined
  vaultKeyHex: string
}): CapturedSecrets => {
  const text = readOptionalFile(args.secretsFile)
  if (text === undefined) return { carried: [], mcpOauth: [], attachmentTokens: [] }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw unreadable(`The secrets file at ${args.secretsFile} is not valid JSON, so this home cannot be captured.`)
  }
  const parsed = secretsFileSchema.safeParse(json)
  if (!parsed.success) {
    throw unreadable(`The secrets file at ${args.secretsFile} is not in the shape Atlas writes.`)
  }

  const captured: CapturedSecrets = { carried: [], mcpOauth: [], attachmentTokens: [] }
  for (const [name, sealed] of Object.entries(parsed.data.secrets)) {
    if (name.startsWith(MCP_OAUTH_SECRET_PREFIX)) {
      captured.mcpOauth.push(name)
      continue
    }
    if (name.startsWith(ATTACHMENT_TOKEN_PREFIX)) {
      captured.attachmentTokens.push(name)
      continue
    }
    if (args.sourceKeyHex === undefined) {
      throw unreadable(`The secrets file at ${args.secretsFile} holds values this capture cannot open, because the home has no vault key.`)
    }
    const opened = openSealed({ keyHex: args.sourceKeyHex, blob: sealed })
    if (opened === undefined) {
      throw unreadable(`A secret in ${args.secretsFile} could not be decrypted; this home cannot be captured.`)
    }
    captured.carried.push({ name, value: sealWith({ keyHex: args.vaultKeyHex, plaintext: opened }) })
  }
  return captured
}

const validateSettingsContent = (args: { path: string; content: string }): void => {
  let json: unknown
  try {
    json = JSON.parse(args.content)
  } catch {
    throw unreadable(`The settings file at ${args.path} is not valid JSON, so this home cannot be captured.`)
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw unreadable(`The settings file at ${args.path} is not a settings object, so this home cannot be captured.`)
  }
  for (const value of Object.values(json)) {
    if (value === null) continue
    const kind = typeof value
    if (kind === 'string' || kind === 'number' || kind === 'boolean') continue
    throw unreadable(`The settings file at ${args.path} holds a non-scalar setting, so this home cannot be captured.`)
  }
}

const validateMcpContent = (args: { path: string; content: string }): void => {
  let json: unknown
  try {
    json = JSON.parse(args.content)
  } catch {
    throw unreadable(`The MCP file at ${args.path} is not valid JSON, so this home cannot be captured.`)
  }
  const file = mcpConfigFileSchema.safeParse(json)
  if (!file.success) {
    throw unreadable(`The MCP file at ${args.path} is not in the shape Atlas writes, so this home cannot be captured.`)
  }
  for (const [name, entry] of Object.entries(mcpServersOf(file.data))) {
    const fields = typeof entry === 'object' && entry !== null ? entry : {}
    if (!mcpSpecSchema.safeParse({ ...fields, name }).success) {
      throw unreadable(
        `The MCP file at ${args.path} holds a server entry that is not in the shape Atlas writes, so this home cannot be captured.`,
      )
    }
  }
}

export async function capturePortableState(args: {
  home?: string | undefined
  omitOauthAccountIds?: readonly string[] | undefined
}): Promise<PortableState> {
  const home = args.home ?? atlasDirectory()

  const sourceKeyHex = readSourceKeyHex(join(home, ATLAS_VAULT_KEY_NAME))
  const vaultKeyHex = randomBytes(32).toString('hex')
  const vault = fileVaultBackend(join(home, ATLAS_VAULT_NAME)).load()
  const secrets = captureSecrets({
    secretsFile: join(home, ATLAS_SECRETS_NAME),
    sourceKeyHex,
    vaultKeyHex,
  })
  const settings = readOptionalFile(join(home, PORTABLE_SETTINGS_NAME))
  const mcp = readOptionalFile(join(home, PORTABLE_MCP_NAME))

  if (sourceKeyHex === undefined && vault.accounts.length > 0) {
    throw unreadable(
      `The vault at ${join(home, ATLAS_VAULT_NAME)} holds accounts but the home has no vault key, so this home cannot be captured.`,
    )
  }

  const omitIds = new Set(args.omitOauthAccountIds ?? [])
  const carried = vault.accounts.map((account) =>
    decodeCarriedAccount({
      sealed: account,
      sourceKeyHex: sourceKeyHex ?? '',
      omitOauth: omitIds.has(account.id),
    }),
  )
  const carriedIds = new Set(carried.map((carry) => carry.sealed.id))

  if (settings !== undefined) {
    validateSettingsContent({ path: join(home, PORTABLE_SETTINGS_NAME), content: settings })
  }
  if (mcp !== undefined) {
    validateMcpContent({ path: join(home, PORTABLE_MCP_NAME), content: mcp })
  }

  const state = {
    version: PORTABLE_STATE_VERSION,
    vaultKeyHex,
    accounts: carried.map((carry) => resealAccount({ carry, vaultKeyHex })),
    active: Object.entries(vault.active)
      .filter(([, accountId]) => carriedIds.has(accountId))
      .map(([provider, accountId]) => ({ provider, accountId })),
    secrets: secrets.carried,
    omitted: {
      oauthAccounts: carried.filter((carry) => carry.omitted).map((carry) => carry.sealed.label),
      mcpOauthSecrets: secrets.mcpOauth,
      attachmentTokens: secrets.attachmentTokens,
    },
    ...(settings === undefined ? {} : { settings: { name: PORTABLE_SETTINGS_NAME, content: settings } }),
    ...(mcp === undefined ? {} : { mcp: { name: PORTABLE_MCP_NAME, content: mcp } }),
  }

  const parsed = portableStateSchema.safeParse(state)
  if (!parsed.success) {
    throw unreadable('This home holds an entry the portable-state contract cannot carry; nothing was captured.')
  }
  return parsed.data
}

export { PORTABLE_ACCOUNT_KIND }
