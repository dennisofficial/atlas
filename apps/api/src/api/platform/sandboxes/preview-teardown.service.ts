import { Injectable } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { CloudflareTunnelClient, PreviewTunnels } from '@dltech/atlas-previews'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'

@Injectable()
export class PreviewTeardownService {
  private readonly tunnels: PreviewTunnels

  constructor(env: EnvService, cipher: SecretCipherService, cloudflare: CloudflareTunnelClient) {
    this.tunnels = new PreviewTunnels({
      db,
      cipher,
      domain: env.get('PREVIEW_DOMAIN'),
      cloudflare,
    })
  }

  async markDeleting(args: { podSessionId: string }): Promise<void> {
    await this.tunnels.markDeleting(args)
  }

  async clearDeleting(args: { podSessionId: string }): Promise<void> {
    await this.tunnels.clearDeleting(args)
  }
}
