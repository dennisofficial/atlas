import { BadGatewayException, Injectable } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import {
  CloudflareRecordExistsError,
  CloudflareTunnelClient,
  PreviewTunnels,
  PreviewUpstreamError,
} from '@dltech/atlas-previews'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'

const asHttpException = (failure: unknown): never => {
  if (failure instanceof PreviewUpstreamError || failure instanceof CloudflareRecordExistsError) {
    throw new BadGatewayException(failure.message)
  }
  throw failure
}

@Injectable()
export class PreviewTunnelService {
  private readonly tunnels: PreviewTunnels

  constructor(env: EnvService, cipher: SecretCipherService, cloudflare: CloudflareTunnelClient) {
    this.tunnels = new PreviewTunnels({
      db,
      cipher,
      domain: env.get('PREVIEW_DOMAIN'),
      cloudflare,
    })
  }

  async expose(args: {
    threadId: string
    userId: string
    port: number
  }): Promise<{ url: string; tunnelToken: string }> {
    try {
      return await this.tunnels.expose(args)
    } catch (failure) {
      return asHttpException(failure)
    }
  }

  async teardown(args: { threadId: string }): Promise<void> {
    try {
      await this.tunnels.teardown(args)
    } catch (failure) {
      asHttpException(failure)
    }
  }
}
