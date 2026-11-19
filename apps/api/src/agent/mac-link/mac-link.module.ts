import { Module } from '@nestjs/common'
import type { LogPort } from '@dltech/atlas-observability'

import type { AgentHostEnv } from '../config/env'
import { AGENT_HOST_ENV, LOG } from '../host/tokens'
import { MAC_LINK, MAC_LINK_INSTANCE_ID, MAC_LINK_REGISTRY, MAC_LINK_RELAY } from './port'
import { MacLinkRegistry } from './registry'
import { createMacLinkRelay, type MacLinkRelay } from './relay'

@Module({
  providers: [
    { provide: MAC_LINK_INSTANCE_ID, useFactory: (): string => crypto.randomUUID() },
    {
      provide: MAC_LINK_RELAY,
      useFactory: (env: AgentHostEnv, instanceId: string, log: LogPort) =>
        createMacLinkRelay({ url: env.redisUrl, instanceId, log }),
      inject: [AGENT_HOST_ENV, MAC_LINK_INSTANCE_ID, LOG],
    },
    {
      provide: MAC_LINK_REGISTRY,
      useFactory: (relay: MacLinkRelay, instanceId: string, log: LogPort) =>
        new MacLinkRegistry({ relay, instanceId, log }),
      inject: [MAC_LINK_RELAY, MAC_LINK_INSTANCE_ID, LOG],
    },
    { provide: MAC_LINK, useExisting: MAC_LINK_REGISTRY },
  ],
  exports: [MAC_LINK, MAC_LINK_REGISTRY, MAC_LINK_RELAY],
})
export class MacLinkModule {}
