import { ESandboxProvider } from '@dltech/atlas-protocol'
import { LogPort } from '@dltech/atlas-observability'

import type { ConfigSource } from '../config/agent-host-config'
import { fakeModelSourceOf } from './model-source'

export class JsonLog extends LogPort {
  record(entry: Parameters<LogPort['record']>[0]): void {
    console.log(JSON.stringify(entry))
  }
}

export const testSource = (): ConfigSource => ({
  read: async () => {
    const model = { configured: false as const, gap: 'scripted model in test' }
    return {
      userId: 'user-1',
      projectId: 'proj-1',
      model,
      models: fakeModelSourceOf(model),
      classifier: { on: false, reason: 'no classifier model is set' },
      quality: { enabled: false, policies: {} },
      rotation: { autoRotateAtPercent: 85 },
      sandbox: {
        configured: true,
        provider: ESandboxProvider.Vercel,
        credentials: { provider: ESandboxProvider.Vercel, token: '', teamId: '', projectId: '' },
      },
      workspace: {
        remoteUrl: null,
        baseBranch: null,
        additionalRepos: [],
        setupScript: process.env.SETUP_SCRIPT ?? '',
      },
      skills: [],
    }
  },
  models: async () => fakeModelSourceOf({ configured: false, gap: 'scripted model in test' }),
})
