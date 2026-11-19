import type { Sandbox } from '@vercel/sandbox'

import { SANDBOX_QUICK_TIMEOUT_MS, type VercelCredentials } from './constants'
import { PodSizer, type PodResizeOutcome } from './sandbox-provider'
import { sandboxNameOf } from './vercel-names'
import { isSandboxMissing } from './vercel-errors'
import { liveSdk, type VercelSdk } from './vercel-sdk'

export class VercelPodSizer extends PodSizer {
  constructor(private readonly sdk: VercelSdk = liveSdk) {
    super()
  }

  async resize(args: {
    sandboxSessionId: string
    credentials: VercelCredentials
    vcpus: number
  }): Promise<PodResizeOutcome> {
    const signal = AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS)
    let sandbox: Sandbox
    try {
      sandbox = await this.sdk.get({
        ...args.credentials,
        name: sandboxNameOf(args.sandboxSessionId),
        resume: false,
        signal,
      })
    } catch (failure) {
      if (isSandboxMissing(failure)) return 'absent'
      throw failure
    }
    await sandbox.update({ resources: { vcpus: args.vcpus } }, { signal })
    if (sandbox.status === 'stopped') return 'stored'
    await sandbox.stop({ signal })
    return 'restarted'
  }
}
