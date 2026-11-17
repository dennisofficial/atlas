import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'

import type { AgentHostEnv } from './config/env'
import { HostModule } from './host/host.module'
import { STREAM } from './host/tokens'
import { JSON_BODY_LIMIT, corsOptionsOf } from './http/cors'
import { StreamWsAdapter } from './stream/stream-ws-adapter'
import type { StreamService } from './stream/stream-service'

export const createApp = async (env: AgentHostEnv): Promise<NestExpressApplication> => {
  const app = await NestFactory.create<NestExpressApplication>(HostModule.forRoot(env), {
    logger: false,
  })
  const stream = app.get<StreamService>(STREAM)
  app.useWebSocketAdapter(new StreamWsAdapter(app, (input) => stream.refusal(input)))
  app.enableCors(corsOptionsOf(env.trustedOrigins))
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT })
  app.enableShutdownHooks([], { useProcessExit: true })
  return app
}
