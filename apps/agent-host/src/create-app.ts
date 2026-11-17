import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'

import type { AgentHostEnv } from './config/env'
import { HostModule } from './host/host.module'
import { configureHttp } from './http/configure-http'

export const createApp = async (env: AgentHostEnv): Promise<NestExpressApplication> => {
  const app = await NestFactory.create<NestExpressApplication>(HostModule.forRoot(env), {
    logger: false,
  })
  configureHttp(app, { trustedOrigins: env.trustedOrigins })
  app.enableShutdownHooks([], { useProcessExit: true })
  return app
}
