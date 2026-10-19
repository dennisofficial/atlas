import { ValidationPipe, VersioningType } from '@nestjs/common'
import { HttpAdapterHost, NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import helmet from 'helmet'
import { GlobalExceptionFilter } from './api/global-exception.filter'
import { JSON_BODY_LIMIT, userFileJsonParser } from './_lib/body-limits'
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
  // Unauthenticated webhook routes get tight body caps well under the global limit: the HMAC is
  // verified only after buffering, so anything bigger must be refused before it is read.
  app.use('/v1/github/webhooks', webhookJsonParser({ limit: GITHUB_WEBHOOK_BODY_LIMIT }))
  app.use('/v1/github/hooks', webhookJsonParser({ limit: GITHUB_WEBHOOK_BODY_LIMIT }))
  app.use('/v1/user-files', userFileJsonParser())
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT })
  app.set('trust proxy', 1)
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS))
  app.useGlobalFilters(new GlobalExceptionFilter(app.get(HttpAdapterHost).httpAdapter))

  await app.init()
  return app
}
