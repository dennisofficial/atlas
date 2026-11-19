import { ValidationPipe, VersioningType } from '@nestjs/common'
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface'
import { HttpAdapterHost, NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import helmet from 'helmet'
import type { AgentHostEnv } from './agent'
import { GlobalExceptionFilter } from './api/global-exception.filter'
import { trustedOriginsOf } from './api/platform/desktop-auth/trusted-origins'
import { EnvService } from './_core/config/env/env.service'
import { JSON_BODY_LIMIT } from './_lib/body-limits'
import {
  AGENT37_WEBHOOK_BODY_LIMIT,
  GITHUB_WEBHOOK_BODY_LIMIT,
  webhookJsonParser,
} from './_lib/webhook-body-limit'

const VALIDATION_PIPE_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
}

export const originAllowed = (args: {
  origin: string | undefined
  trustedOrigins: ReadonlySet<string>
  agentOrigins: readonly string[]
}): boolean =>
  args.origin === undefined ||
  args.trustedOrigins.has(args.origin) ||
  args.agentOrigins.includes(args.origin)

export const corsOptionsFor = (args: {
  trustedOrigins: ReadonlySet<string>
  agentOrigins: readonly string[]
}): CorsOptions => ({
  origin: (origin, allow) =>
    allow(
      null,
      originAllowed({
        origin,
        trustedOrigins: args.trustedOrigins,
        agentOrigins: args.agentOrigins,
      }),
    ),
  credentials: true,
  allowedHeaders: ['authorization', 'content-type', 'atlas-client-version', 'trpc-accept'],
  exposedHeaders: ['set-auth-token'],
})

export async function createApp(
  args: { agentEnv?: AgentHostEnv } = {},
): Promise<NestExpressApplication> {
  const { AppModule } = await import('./app.module.js')
  const agentEnv = args.agentEnv ?? (await import('./agent/index.js')).readAgentHostEnv()
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(agentEnv), {
    rawBody: true,
  })

  app.use(helmet())
  const trustedOrigins = trustedOriginsOf(app.get(EnvService))
  // The web app calls api.byatlas.io cross-origin with the session cookie, so credentialed CORS
  // needs a specific echoed origin: TRUSTED_ORIGINS ∪ WEB_ORIGIN, plus the agent's own list.
  app.enableCors(corsOptionsFor({ trustedOrigins, agentOrigins: agentEnv.trustedOrigins }))
  // Unauthenticated webhook routes get tight body caps well under the global limit: the HMAC is
  // verified only after buffering, so anything bigger must be refused before it is read.
  app.use('/v1/github/hooks', webhookJsonParser({ limit: GITHUB_WEBHOOK_BODY_LIMIT }))
  app.use('/v1/webhooks/agent37', webhookJsonParser({ limit: AGENT37_WEBHOOK_BODY_LIMIT }))
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT })
  app.set('trust proxy', 1)
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS))
  app.useGlobalFilters(new GlobalExceptionFilter(app.get(HttpAdapterHost).httpAdapter))

  app.enableShutdownHooks([], { useProcessExit: true })

  await app.init()
  return app
}
