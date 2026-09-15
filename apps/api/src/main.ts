import { ValidationPipe, VersioningType } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
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

export async function bootstrap(): Promise<void> {
  hydrateEnvFromTierFile()
  validateEnvironment()

  const { AppModule } = await import('./api/app.module.js')
  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  app.use(helmet())
  app.set('trust proxy', 1)
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS))
  app.enableShutdownHooks()

  const shutdown = (signal: string) => {
    void app.close().then(() => process.exit(0))
    process.stderr.write(`received ${signal}, shutting down\n`)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  await app.listen(Number(process.env.PORT ?? 3400))
}

void bootstrap()
