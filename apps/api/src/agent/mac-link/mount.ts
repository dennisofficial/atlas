import type { Server } from 'node:http'
import type { NestExpressApplication } from '@nestjs/platform-express'

import { SESSION_VERIFIER, type SessionVerifier } from '../../_core/ports/session-verifier'
import { MAC_LINK_REGISTRY } from './port'
import type { MacLinkRegistry } from './registry'
import { attachMacLinkSocket, type MacLinkSocket } from './socket'

export const mountMacLink = (app: NestExpressApplication): MacLinkSocket =>
  attachMacLinkSocket({
    server: app.getHttpServer() as Server,
    verify: app.get<SessionVerifier>(SESSION_VERIFIER),
    registry: app.get<MacLinkRegistry>(MAC_LINK_REGISTRY),
  })
