import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost, NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import helmet from 'helmet'
import { GlobalExceptionFilter } from './api/global-exception.filter'
import { trustedOriginsOf } from './api/platform/desktop-auth/desktop-auth.service'
import { EnvService } from './_core/config/env/env.service'
import { JSON_BODY_LIMIT } from './_lib/body-limits'
import { GITHUB_WEBHOOK_BODY_LIMIT, webhookJsonParser } from './_lib/webhook-body-limit'

const VALIDATION_PIPE_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
}

export async function createApp(): Promise<NestExpressApplication> {
  const { AppModule } = await import('./api/app.module.js')
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true })

  app.use(helmet())
  const trustedOrigins = trustedOriginsOf(app.get(EnvService))
  // The Expo web test build calls the API cross-origin with a bearer header, so no credentials
  // and no blanket origin: only TRUSTED_ORIGINS ∪ WEB_ORIGIN.
  app.enableCors({
    origin: (origin, allow) => {
      if (origin === undefined || trustedOrigins.has(origin)) allow(null, true)
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

  await app.init()
  return app
}
