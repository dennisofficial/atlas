import { ESandboxProvider } from '@dltech/atlas-protocol'

import type { SandboxCredentials } from '../sandbox/sandbox-provider'
import type { AgentHostEnv } from './env'

export type PlatformCredentialGap = { configured: false; gap: 'platform-credential' }

export const platformCredentialsOf = (args: {
  provider: ESandboxProvider
  env: Pick<AgentHostEnv, 'platformVercel' | 'agent37'>
}): SandboxCredentials | PlatformCredentialGap => {
  if (args.provider === ESandboxProvider.Agent37) {
    const agent37 = args.env.agent37
    if (agent37 === null) return { configured: false, gap: 'platform-credential' }
    return { provider: ESandboxProvider.Agent37, apiKey: agent37.apiKey }
  }
  const vercel = args.env.platformVercel
  if (vercel === null) return { configured: false, gap: 'platform-credential' }
  return {
    provider: ESandboxProvider.Vercel,
    token: vercel.token,
    teamId: vercel.teamId,
    projectId: vercel.projectId,
  }
}
