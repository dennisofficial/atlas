import { BadGatewayException, Injectable } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import {
  CloudflareRecordExistsError,
  CloudflareTunnelClient,
  PreviewReconciler,
  PreviewTunnels,
  PreviewUpstreamError,
} from '@dltech/atlas-previews'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { livePreviewPeersOf } from '../sessions/preview-peers'
import { podSessionOf } from '../sessions/session-of-thread'

const asHttpException = (failure: unknown): never => {
  if (failure instanceof PreviewUpstreamError || failure instanceof CloudflareRecordExistsError) {
    throw new BadGatewayException(failure.message)
  }
  throw failure
}

@Injectable()
export class PreviewTunnelService {
  private readonly tunnels: PreviewTunnels
  private readonly reconciler: PreviewReconciler

  constructor(env: EnvService, cipher: SecretCipherService, cloudflare: CloudflareTunnelClient) {
    const deps = {
      db,
      cipher,
      domain: env.get('PREVIEW_DOMAIN'),
      cloudflare,
      livePeersOf: (podSessionId: string) => livePreviewPeersOf({ reader: db, podSessionId }),
    }
    this.tunnels = new PreviewTunnels(deps)
    this.reconciler = new PreviewReconciler(deps)
  }

  async expose(args: {
    threadId: string
    userId: string
    port: number
  }): Promise<{ url: string; tunnelToken: string }> {
    try {
      const podSessionId = await podSessionOf({ reader: db, threadId: args.threadId })
      const exposed = await this.tunnels.expose({
        podSessionId,
        threadId: args.threadId,
        userId: args.userId,
        port: args.port,
      })
      const outcome = await this.reconciler.run({ podSessionId })
      if (outcome.kind === 'failed') throw new PreviewUpstreamError(outcome.reason)
      return exposed
    } catch (failure) {
      return asHttpException(failure)
    }
  }

  async teardown(args: { threadId: string }): Promise<void> {
    try {
      const podSessionId = await podSessionOf({ reader: db, threadId: args.threadId })
      await this.tunnels.teardown({ podSessionId })
    } catch (failure) {
      asHttpException(failure)
    }
  }
}
