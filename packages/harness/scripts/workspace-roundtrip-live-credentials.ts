import { readFile } from 'node:fs/promises'

import { FileSecretsStore, SecretCipher } from '../src/index'
import { atlasVaultKeyFile } from '../src/credentials/paths'
import { atlasSecretsFile } from '../src/secrets/paths'
import { userSettingsFile } from '../src/settings/paths'

export type LiveVercelCredentials = { token: string; teamId: string; projectId: string }

export async function loadVercelCredentials(): Promise<LiveVercelCredentials> {
  const settings = JSON.parse(await readFile(userSettingsFile(), 'utf8')) as Record<string, string | undefined>
  const token = new FileSecretsStore({ file: atlasSecretsFile(), cipher: new SecretCipher(atlasVaultKeyFile()) }).read('sandbox.vercelToken')
  const teamId = settings['sandbox.vercelTeamId']
  const projectId = settings['sandbox.vercelProjectId']
  if (token === undefined || teamId === undefined || projectId === undefined) throw new Error('Vercel is not configured')
  return { token, teamId, projectId }
}
