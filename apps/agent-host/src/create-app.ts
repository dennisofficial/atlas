import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'

import type { AgentHostEnv } from './config/env'
import { HostModule } from './host/host.module'
import { STREAM } from './host/tokens'
import { configureHttp } from './http/configure-http'
import { StreamWsAdapter } from './stream/stream-ws-adapter'
import type { StreamService } from './stream/stream-service'

export const createApp = async (env: AgentHostEnv): Promise<NestExpressApplication> => {
  const app = await NestFactory.create<NestExpressApplication>(HostModule.forRoot(env), {
    logger: false,
  })
  const stream = app.get<StreamService>(STREAM)
  app.useWebSocketAdapter(new StreamWsAdapter(app, (input) => stream.refusal(input)))
  configureHttp(app, { trustedOrigins: env.trustedOrigins })
  app.enableShutdownHooks([], { useProcessExit: true })
  return app
}
