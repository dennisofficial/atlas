import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  PORTABLE_ACCOUNT_KIND,
  PORTABLE_STATE_VERSION,
  portableStateSchema,
  type PortableState,
} from '@dltech/atlas-wire'
import { CredentialError, ECredentialFailure } from '../credentials/credential-error'
import { ATLAS_VAULT_KEY_NAME, ATLAS_VAULT_NAME } from '../credentials/paths'
import { VAULT_VERSION, type VaultFile } from '../credentials/vault-file'
import { ATLAS_SECRETS_NAME } from '../secrets/paths'
import { atlasDirectory } from '../store/paths'
import { capturePortableState } from './portable-capture'
import {
  malformedSnapshot,
  openSealed,
  prevalidate,
  sealWith,
  type PlannedVault,
} from './portable-validation'
import { SANDBOX_SERVE_TOKEN_PREFIX } from './sandbox-attachment'

const OWNER_ONLY = 0o600

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

export type PortableStateInstall = {
  written: readonly string[]
  skipped: readonly string[]
}

const keyFileReads = (home: string): { text: string | undefined; hex: string | undefined } => {
  const text = readOptionalFile(join(home, ATLAS_VAULT_KEY_NAME))
  const trimmed = text?.trim()
  const hex = trimmed !== undefined && /^[0-9a-f]{64}$/.test(trimmed) ? trimmed : undefined
  return { text, hex }
}

const resealVaultAccounts = (args: {
  vault: PlannedVault['accounts']
  fromKeyHex: string
  toKeyHex: string
}): PlannedVault['accounts'] =>
  args.vault.map((account) => {
    const opened = openSealed({ keyHex: args.fromKeyHex, blob: account.secret })
    if (opened === undefined) throw malformedSnapshot()
    return { ...account, secret: sealWith({ keyHex: args.toKeyHex, plaintext: opened }) }
  })

const resealSecrets = (args: {
  names: readonly string[]
  openedSecrets: ReadonlyMap<string, string>
  toKeyHex: string
}): Record<string, string> => {
  const secrets: Record<string, string> = {}
  for (const name of args.names) {
    const opened = args.openedSecrets.get(name)
    if (opened === undefined) throw malformedSnapshot()
    secrets[name] = sealWith({ keyHex: args.toKeyHex, plaintext: opened })
  }
  return secrets
}

const writeAtomically = (args: { path: string; content: string }): void => {
  mkdirSync(dirname(args.path), { recursive: true })
  const staging = join(dirname(args.path), `.${randomBytes(8).toString('hex')}.tmp`)
  writeFileSync(staging, args.content, { mode: OWNER_ONLY })
  renameSync(staging, args.path)
}

export async function materializePortableState(args: {
  state: unknown
  home?: string | undefined
  overwriteExisting?: boolean | undefined
}): Promise<PortableStateInstall> {
  const home = args.home ?? atlasDirectory()
  const overwrite = args.overwriteExisting ?? false

  const parsed = portableStateSchema.safeParse(args.state)
  if (!parsed.success) throw malformedSnapshot()
  const state = parsed.data
  const { vault, secrets: openedSecrets } = prevalidate(state)

  for (const secret of state.secrets) {
    if (secret.name.startsWith(MCP_OAUTH_SECRET_PREFIX)) throw malformedSnapshot()
    if (secret.name.startsWith(ATTACHMENT_TOKEN_PREFIX)) throw malformedSnapshot()
  }

  const keyPath = join(home, ATLAS_VAULT_KEY_NAME)
  const vaultPath = join(home, ATLAS_VAULT_NAME)
  const secretsPath = join(home, ATLAS_SECRETS_NAME)

  const existing = keyFileReads(home)
  const vaultExists = existsSync(vaultPath)

  if (vaultExists && existing.hex === undefined) {
    throw new CredentialError({
      failure: ECredentialFailure.Unreadable,
      message: `The home at ${home} holds an account vault but no readable vault key; installing a snapshot there would strand the vault it already has. Move one of them aside first.`,
    })
  }

  const installFresh = !vaultExists || overwrite
  const effectiveKeyHex = overwrite ? state.vaultKeyHex : (existing.hex ?? state.vaultKeyHex)
  const accountsToWrite = installFresh
    ? effectiveKeyHex === state.vaultKeyHex
      ? vault.accounts
      : resealVaultAccounts({ vault: vault.accounts, fromKeyHex: state.vaultKeyHex, toKeyHex: effectiveKeyHex })
    : []

  const written: string[] = []
  const skipped: string[] = []

  if (existing.text === undefined) {
    writeAtomically({ path: keyPath, content: `${state.vaultKeyHex}\n` })
    written.push(keyPath)
  } else if (existing.hex === undefined && !vaultExists) {
    writeAtomically({ path: keyPath, content: `${state.vaultKeyHex}\n` })
    written.push(keyPath)
  } else if (overwrite && existing.hex !== state.vaultKeyHex) {
    writeAtomically({ path: keyPath, content: `${state.vaultKeyHex}\n` })
    written.push(keyPath)
  } else {
    skipped.push(keyPath)
  }

  if (installFresh) {
    const file: VaultFile = { version: VAULT_VERSION, accounts: accountsToWrite, active: vault.active }
    writeAtomically({ path: vaultPath, content: `${JSON.stringify(file, null, 2)}\n` })
    written.push(vaultPath)
  } else {
    skipped.push(vaultPath)
  }

  const secretsExists = existsSync(secretsPath)
  if (secretsExists && !overwrite) {
    skipped.push(secretsPath)
  } else if (state.secrets.length > 0) {
    const secrets = resealSecrets({
      names: state.secrets.map((secret) => secret.name),
      openedSecrets,
      toKeyHex: effectiveKeyHex,
    })
    writeAtomically({
      path: secretsPath,
      content: `${JSON.stringify({ version: 1, secrets }, null, 2)}\n`,
    })
    written.push(secretsPath)
  }

  for (const file of [state.settings, state.mcp]) {
    if (file === undefined) continue
    const path = join(home, file.name)
    if (existsSync(path) && !overwrite) {
      skipped.push(path)
      continue
    }
    writeAtomically({ path, content: file.content })
    written.push(path)
  }

  return { written, skipped }
}

export { PORTABLE_ACCOUNT_KIND, PORTABLE_STATE_VERSION, capturePortableState }
export type { PortableState }
