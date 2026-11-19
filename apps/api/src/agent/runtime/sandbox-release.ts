import type { PodPeers } from '@dltech/atlas-host'

import type { SandboxProvider, SandboxTarget } from '../sandbox/sandbox-provider'

export const sandboxReleaseFor =
  (args: { sandbox: SandboxProvider; podPeers?: PodPeers | undefined }) =>
  async (session: { sessionId: string; target: SandboxTarget }): Promise<void> => {
    const placed =
      (await args.podPeers?.placed({
        podSessionId: session.target.sandboxSessionId,
        excludeSessionId: session.sessionId,
      })) ?? 0
    if (placed > 0) return
    await args.sandbox.stop({ target: session.target })
  }
