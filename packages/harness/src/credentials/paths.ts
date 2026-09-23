import { homedir } from 'node:os'
import { join } from 'node:path'

import { atlasDirectory } from '../store/paths'

export const ATLAS_VAULT_NAME = 'auth.json'
export const ATLAS_VAULT_KEY_NAME = 'key'
export const ATLAS_CLOUD_NAME = 'cloud.json'
export const CLAUDE_DIRECTORY_NAME = '.claude'
export const CLAUDE_CREDENTIALS_NAME = '.credentials.json'
export const CODEX_DIRECTORY_NAME = '.codex'
export const CODEX_AUTH_NAME = 'auth.json'

export function atlasVaultFile(): string {
  return join(atlasDirectory(), ATLAS_VAULT_NAME)
}

export function atlasVaultKeyFile(): string {
  return join(atlasDirectory(), ATLAS_VAULT_KEY_NAME)
}

export function atlasCloudFile(): string {
  return join(atlasDirectory(), ATLAS_CLOUD_NAME)
}

export function claudeCredentialsFile(): string {
  return join(homedir(), CLAUDE_DIRECTORY_NAME, CLAUDE_CREDENTIALS_NAME)
}

export function codexAuthFile(): string {
  return join(homedir(), CODEX_DIRECTORY_NAME, CODEX_AUTH_NAME)
}
