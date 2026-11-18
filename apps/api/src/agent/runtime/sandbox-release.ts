import type { PodPeers } from '@dltech/atlas-host'

import type { VercelCredentials } from '../sandbox/constants'
import type { SandboxProvider } from '../sandbox/sandbox-provider'

export const sandboxReleaseFor =
  (args: { sandbox: SandboxProvider; podPeers?: PodPeers | undefined }) =>
  async (session: {
    sandboxSessionId: string
    sessionId: string
    credentials: VercelCredentials
  }): Promise<void> => {
    const placed =
      (await args.podPeers?.placed({
        podSessionId: session.sandboxSessionId,
        excludeSessionId: session.sessionId,
      })) ?? 0
    if (placed > 0) return
    await args.sandbox.stop({
      sandboxSessionId: session.sandboxSessionId,
      credentials: session.credentials,
    })
  }
