import type { IncomingMessage, ServerResponse } from 'node:http'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Express } from 'express'
import helmet from 'helmet'
import { envConfigValidation } from './_core/config/env/validation'
import { hydrateEnvFromTierFile } from './api/hydrate-env'

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
  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  app.use(helmet())
  app.set('trust proxy', 1)
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS))
  app.enableShutdownHooks()

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
    const shutdown = (signal: string) => {
      void app.close().then(() => process.exit(0))
      process.stderr.write(`received ${signal}, shutting down\n`)
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))

    await app.listen(Number(process.env.PORT ?? 3400))
  })
}
