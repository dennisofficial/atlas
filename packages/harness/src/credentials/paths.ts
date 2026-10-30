import { join } from 'node:path'

import { atlasDirectory } from '../store/paths'

export const ATLAS_VAULT_NAME = 'auth.json'
export const ATLAS_VAULT_KEY_NAME = 'key'
export const ATLAS_CLOUD_NAME = 'cloud.json'

export function atlasVaultFile(): string {
  return join(atlasDirectory(), ATLAS_VAULT_NAME)
}

export function atlasVaultKeyFile(): string {
  return join(atlasDirectory(), ATLAS_VAULT_KEY_NAME)
}

export function atlasCloudFile(): string {
  return join(atlasDirectory(), ATLAS_CLOUD_NAME)
}
