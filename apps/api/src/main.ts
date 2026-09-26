import type { IncomingMessage, ServerResponse } from 'node:http'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Express } from 'express'
import helmet from 'helmet'
import { envConfigValidation } from './_core/config/env/validation'
import { contextArchiveRawParser } from './api/cloud/context-archive/context-archive-http'
import { MAX_CONTEXT_ARCHIVE_BYTES } from './api/cloud/context-archive/context-archive-limits'
import { registerGracefulShutdown } from './api/graceful-shutdown'
import { hydrateEnvFromTierFile } from './api/hydrate-env'
import { GITHUB_WEBHOOK_BODY_LIMIT, webhookJsonParser } from './_lib/webhook-body-limit'
import { DrainStateService } from './api/platform/health/drain-state.service'
import { WORKSPACE_BODY_LIMIT } from './api/platform/sandboxes/workspace-spec'

const VALIDATION_PIPE_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
}

function validateEnvironment(): void {
  const { error } = envConfigValidation.validate(process.env, {
    allowUnknown: true,
    abortEarly: false,
  })
  if (error) {
    throw new Error(`invalid environment:\n${error.message}`)
  }
}

async function createApp(): Promise<NestExpressApplication> {
  hydrateEnvFromTierFile()
  validateEnvironment()

  const { AppModule } = await import('./api/app.module.js')
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true })

  app.use(helmet())
  const rawArchiveParser = contextArchiveRawParser({ limitBytes: MAX_CONTEXT_ARCHIVE_BYTES })
  app.use('/v1/sandboxes/:threadId/context', rawArchiveParser)
  app.use('/v1/sandboxes/:threadId/transcript', rawArchiveParser)
  app.use('/v1/user-context/memory', rawArchiveParser)
  // Unauthenticated webhook routes get tight body caps well under the global limit: the HMAC is
  // verified only after buffering, so anything bigger must be refused before it is read.
  app.use('/v1/github/webhooks', webhookJsonParser({ limit: GITHUB_WEBHOOK_BODY_LIMIT }))
  app.useBodyParser('json', { limit: WORKSPACE_BODY_LIMIT })
  app.set('trust proxy', 1)
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS))

  await app.init()
  return app
}

const ready = createApp()

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const app = await ready
  const instance: Express = app.getHttpAdapter().getInstance()
  instance(request, response)
}

if (process.env.VERCEL !== '1') {
  void ready.then(async (app) => {
    registerGracefulShutdown({
      beginDrain: () => app.get(DrainStateService).beginDrain(),
      closeApp: () => app.close(),
    })

    await app.listen(Number(process.env.PORT ?? 3400))
  })
}
