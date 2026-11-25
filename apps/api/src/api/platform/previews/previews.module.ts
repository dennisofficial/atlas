import { Module } from '@nestjs/common'
import { CloudflareTunnelClient } from '@dltech/atlas-previews'
import { EnvService } from '../../../_core/config/env/env.service'
import { PreviewTeardownService } from './preview-teardown.service'
import { PreviewTunnelService } from './preview-tunnel.service'

@Module({
  providers: [
    PreviewTunnelService,
    PreviewTeardownService,
    {
      provide: CloudflareTunnelClient,
      useFactory: (env: EnvService) =>
        new CloudflareTunnelClient({
          apiToken: env.get('CLOUDFLARE_API_TOKEN'),
          accountId: env.get('CLOUDFLARE_ACCOUNT_ID'),
          zoneId: env.get('CLOUDFLARE_ZONE_ID'),
        }),
      inject: [EnvService],
    },
  ],
  exports: [PreviewTunnelService, PreviewTeardownService],
})
export class PreviewsModule {}
