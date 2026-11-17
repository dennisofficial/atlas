import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost, NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import helmet from 'helmet'
import { GlobalExceptionFilter } from './api/global-exception.filter'
import { hostRootModule } from './api/host-root.module'
import { trustedOriginsOf } from './api/platform/desktop-auth/trusted-origins'
import { EnvService } from './_core/config/env/env.service'
import { JSON_BODY_LIMIT } from './_lib/body-limits'
import { GITHUB_WEBHOOK_BODY_LIMIT, webhookJsonParser } from './_lib/webhook-body-limit'

const VALIDATION_PIPE_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
}

export async function createApp(
  args: { withHost?: boolean } = {},
): Promise<NestExpressApplication> {
  const { AppModule } = await import('./api/app.module.js')
  const host = args.withHost === true ? await import('@dltech/atlas-agent-host') : undefined
  const hostEnv = host?.readAgentHostEnv()
  const rootModule =
    host === undefined || hostEnv === undefined
      ? AppModule
      : hostRootModule({ appModule: AppModule, hostModule: host.HostModule.forRoot(hostEnv) })
  const app = await NestFactory.create<NestExpressApplication>(rootModule, { rawBody: true })

  app.use(helmet())
  const trustedOrigins = trustedOriginsOf(app.get(EnvService))
  const hostOrigins = hostEnv?.trustedOrigins ?? []
  // The Expo web test build calls the API cross-origin with a bearer header, so no credentials
  // and no blanket origin: only TRUSTED_ORIGINS ∪ WEB_ORIGIN, plus the agent host's own list.
  app.enableCors({
    origin: (origin, allow) => {
      if (origin === undefined || trustedOrigins.has(origin) || hostOrigins.includes(origin))
        allow(null, true)
      else allow(null, false)
    },
    credentials: false,
    allowedHeaders: ['authorization', 'content-type', 'atlas-client-version', 'trpc-accept'],
    exposedHeaders: ['set-auth-token'],
  })
  // Unauthenticated webhook routes get tight body caps well under the global limit: the HMAC is
  // verified only after buffering, so anything bigger must be refused before it is read.
  app.use('/v1/github/hooks', webhookJsonParser({ limit: GITHUB_WEBHOOK_BODY_LIMIT }))
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT })
  app.set('trust proxy', 1)
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS))
  app.useGlobalFilters(new GlobalExceptionFilter(app.get(HttpAdapterHost).httpAdapter))

  if (host !== undefined) app.enableShutdownHooks([], { useProcessExit: true })

  await app.init()
  return app
}
