import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import {
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
  type Account,
  type AccountStorePort,
  type OauthTokens,
} from '@dltech/atlas-core'

import { codexAuthBlob, parseCodexAuthBlob, type CodexCredential } from './codex-auth-file'
import type { CredentialSink } from './credential-sink'
import { codexAuthFile } from './paths'

export const CODEX_SOURCE_ID = 'codex'

const OWNER_ONLY = 0o600

/**
 * Codex keeps its OAuth material in a plain file (`~/.codex/auth.json`), not the keychain, so the
 * store the sink mirrors is the file itself.
 */
export class CodexSource implements CredentialSink {
  readonly id = CODEX_SOURCE_ID

  private readonly file: string

  constructor(args: { file?: string | undefined } = {}) {
    this.file = args.file ?? codexAuthFile()
  }

  async read(): Promise<OauthTokens | undefined> {
    return (await this.credential())?.tokens
  }

  async write(tokens: OauthTokens): Promise<void> {
    let existing: string | undefined
    try {
      existing = readFileSync(this.file, 'utf8')
    } catch {
      existing = undefined
    }

    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, codexAuthBlob({ tokens, existing }), { mode: OWNER_ONLY })
    chmodSync(this.file, OWNER_ONLY)
  }

  async credential(): Promise<CodexCredential | undefined> {
    let payload: string
    try {
      payload = readFileSync(this.file, 'utf8')
    } catch {
      return undefined
    }

    try {
      return parseCodexAuthBlob(payload)
    } catch {
      return undefined
    }
  }
}

/**
 * Take up a Codex login the first time Atlas runs, so an operator who already has one never sees a
 * login screen. Imported once and only once: after that the vault is the authority, and the refresh
 * path is what keeps both stores in step.
 */
export async function importCodexAccount(args: {
  accounts: AccountStorePort
  source: CodexSource
}): Promise<Account | undefined> {
  const existing = await args.accounts.list()
  if (existing.some((account) => account.importedFrom === CODEX_SOURCE_ID)) return undefined

  const credential = await args.source.credential()
  if (credential === undefined) return undefined

  return args.accounts.add({
    provider: EAuthProvider.OpenAI,
    label: credential.plan === undefined ? 'Codex' : `Codex (${credential.plan})`,
    secret: { kind: EAuthKind.Oauth, tokens: credential.tokens },
    origin: EAccountOrigin.Imported,
    importedFrom: CODEX_SOURCE_ID,
    ...(credential.email === undefined ? {} : { email: credential.email }),
    ...(credential.plan === undefined ? {} : { subscription: credential.plan }),
  })
}
